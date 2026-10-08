#!/bin/sh
# Scheduled backups to a cloud-synced folder, driven by a launchd agent.
# macOS only. Independent of how the server runs (pm2, launchd, dev) — the
# agent only ever calls `npm run backup`'s code, never starts/stops Bifrost.
#
# Usage:  sh scripts/backup-agent.sh <command>
#   install      write + load the launchd agent (daily check), run it once now
#   uninstall    unload + delete the agent (backups in the cloud are kept)
#   stop         pause: unload and keep it off across logins (plist kept)
#   start        resume after stop
#   status       schedule, agent state, last run, last backup, next due
#   run [--force]  the job itself (what launchd calls); --force skips the age check
#
# The agent fires DAILY at BACKUP_SCHEDULE_TIME; `run` decides whether a backup
# is actually due (newest backup older than BACKUP_INTERVAL_DAYS). launchd has
# no "every 14 days", and a daily check survives sleep and reboots.
#
# A backup only happens while the API server answers /api/health on its own
# port (API_PORT, PLAN-36), so a stopped web host never skips a backup — a down
# API is a skip (retried at the next daily check), not a failure. In web-only
# mode (BIFROST_RUN=web) there is no hub data in use, so every run skips.
#
# Settings (.env): BACKUP_CLOUD, BACKUP_CLOUD_ROOT, BACKUP_CLOUD_SUBDIR,
# BACKUP_INTERVAL_DAYS, BACKUP_SCHEDULE_TIME, BACKUP_KEEP, BACKUP_EXCLUDE.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LABEL="local.bifrost.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

[ "$(uname -s)" = "Darwin" ] || { echo "✖ backup-agent is macOS-only (launchd)"; exit 1; }

# Setting value: the process environment wins (as with dotenv), then the first
# KEY= line in .env with surrounding whitespace and quotes stripped. Spaces
# inside are kept — iCloud's root is "Mobile Documents".
env_get() {
  eval "cur=\${$1:-}"
  [ -n "$cur" ] && { printf '%s' "$cur"; return; }
  [ -f .env ] || { printf '%s' "$2"; return; }
  v="$(grep -E "^$1=" .env | head -n 1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")" || true
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$2"
}

PORT="$(env_get PORT 4646)"
# The same default the API's config applies: API_PORT, else PORT + 1.
API_PORT="$(env_get API_PORT "$((PORT + 1))")"
RUN_MODE="$(env_get BIFROST_RUN full)"
STORAGE="$(env_get STORAGE_ROOT ./storage)"
case "$STORAGE" in /*) ;; *) STORAGE="$ROOT/${STORAGE#./}" ;; esac
LOG_DIR="$STORAGE/logs"
LOG="$LOG_DIR/backup-agent.log"
LOCK="$STORAGE/tmp/backup-agent.lock"

CLOUD="$(env_get BACKUP_CLOUD '')"
CLOUD_ROOT_OVERRIDE="$(env_get BACKUP_CLOUD_ROOT '')"
SUBDIR="$(env_get BACKUP_CLOUD_SUBDIR Bifrost/backups)"
INTERVAL_DAYS="$(env_get BACKUP_INTERVAL_DAYS 14)"
SCHEDULE="$(env_get BACKUP_SCHEDULE_TIME 02:00)"
KEEP="$(env_get BACKUP_KEEP 0)"

log() {
  mkdir -p "$LOG_DIR"
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $1 $2"
  echo "$line" >> "$LOG"
  echo "$line"
}

notify() {
  # Best effort: a missing notification must never turn a backup into a failure.
  osascript -e "display notification \"$1\" with title \"Bifrost backup\"" >/dev/null 2>&1 || true
}

fail() {
  log FAIL "$1"
  notify "Backup failed: $1"
  exit 1
}

human() {
  awk -v b="$1" 'BEGIN { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } printf (i == 1 ? "%d %s" : "%.1f %s"), b, u[i] }'
}

# Human times: 12-hour clock with AM/PM, in this Mac's local zone.
fmt_epoch() { date -r "$1" "+%a %d %b %Y, %l:%M %p %Z" | tr -s ' '; }

# "03:00" / "15:30" (the 24-hour HH:MM in .env) → "3:00 AM" / "3:30 PM".
fmt_clock() {
  h="$(echo "${1%%:*}" | sed 's/^0*//')"; [ -n "$h" ] || h=0
  m="${1#*:}"
  if [ "$h" -eq 0 ]; then echo "12:$m AM"
  elif [ "$h" -lt 12 ]; then echo "$h:$m AM"
  elif [ "$h" -eq 12 ]; then echo "12:$m PM"
  else echo "$((h - 12)):$m PM"; fi
}

# A run-log line ("2026-09-24T11:14:54Z OK …", stored in UTC) with its
# timestamp shown in local time instead.
fmt_logline() {
  ts="${1%% *}"; rest="${1#* }"
  e="$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null)" || { echo "$1"; return; }
  echo "$(fmt_epoch "$e") — $rest"
}

json_get() { plutil -extract "$2" raw -o - "$1" 2>/dev/null; }

# Root folder of the chosen cloud service. Prints the path, or an error to stderr.
cloud_root() {
  if [ -n "$CLOUD_ROOT_OVERRIDE" ]; then printf '%s' "$CLOUD_ROOT_OVERRIDE"; return 0; fi
  case "$CLOUD" in
    dropbox)
      for key in personal.path business.path; do
        p="$(json_get "$HOME/.dropbox/info.json" "$key")" && [ -d "$p" ] && { printf '%s' "$p"; return 0; }
      done
      [ -d "$HOME/Library/CloudStorage/Dropbox" ] && { printf '%s' "$HOME/Library/CloudStorage/Dropbox"; return 0; }
      echo "Dropbox folder not found (no ~/.dropbox/info.json path, no ~/Library/CloudStorage/Dropbox)" >&2 ;;
    icloud)
      p="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
      [ -d "$p" ] && { printf '%s' "$p"; return 0; }
      echo "iCloud Drive folder not found ($p)" >&2 ;;
    onedrive)
      for p in "$HOME"/Library/CloudStorage/OneDrive*; do
        [ -d "$p" ] && { printf '%s' "$p"; return 0; }
      done
      echo "OneDrive folder not found (~/Library/CloudStorage/OneDrive*)" >&2 ;;
    gdrive)
      for p in "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive"; do
        [ -d "$p" ] && { printf '%s' "$p"; return 0; }
      done
      echo "Google Drive folder not found (~/Library/CloudStorage/GoogleDrive-*/My Drive)" >&2 ;;
    path)
      echo "BACKUP_CLOUD=path needs BACKUP_CLOUD_ROOT set to a folder" >&2 ;;
    '')
      echo "BACKUP_CLOUD is not set in .env (dropbox | icloud | onedrive | gdrive | path)" >&2 ;;
    *)
      echo "unknown BACKUP_CLOUD=\"$CLOUD\" (dropbox | icloud | onedrive | gdrive | path)" >&2 ;;
  esac
  return 1
}

# Newest completed backup folder in $1 (name only), or nothing.
newest_backup() {
  ls -1 "$1" 2>/dev/null | grep -E '^bifrost-backup-' | sort | tail -n 1
}

server_up() { curl -fsS -m 5 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; }

# ---------------------------------------------------------------- run

cmd_run() {
  force=0
  [ "${1:-}" = "--force" ] && force=1

  croot="$(cloud_root 2>&1)" || fail "$croot"
  [ -d "$croot" ] || fail "cloud root is not a folder: $croot"
  dest="$croot/$SUBDIR"

  # Age check against the newest completed backup's meta.
  newest="$(newest_backup "$dest")"
  if [ "$force" -eq 0 ] && [ -n "$newest" ]; then
    created="$(json_get "$dest/$newest/meta.json" createdAtEpoch)" || created=""
    if [ -n "$created" ]; then
      age_days=$(( ($(date +%s) - created) / 86400 ))
      if [ "$age_days" -lt "$INTERVAL_DAYS" ]; then
        log SKIP "not due: newest backup is $age_days day(s) old, interval is $INTERVAL_DAYS"
        return 0
      fi
    fi
  fi

  if [ "$RUN_MODE" = web ]; then
    log SKIP "web-only mode (BIFROST_RUN=web): nothing to back up"
    return 0
  fi
  if ! server_up; then
    log SKIP "API server not running on port $API_PORT — will retry at the next daily check"
    return 0
  fi

  # One run at a time (a manual run can overlap the scheduled one).
  mkdir -p "$(dirname "$LOCK")"
  if ! mkdir "$LOCK" 2>/dev/null; then
    pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log SKIP "another backup run is in progress (pid $pid)"
      return 0
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK"
  fi
  echo $$ > "$LOCK/pid"
  stage="$(mktemp -d "${TMPDIR:-/tmp}/bifrost-backup-stage.XXXXXX")"
  trap 'rm -rf "$stage" "$LOCK"' EXIT INT TERM

  command -v node >/dev/null 2>&1 || fail "node not found on PATH ($PATH)"
  log START "backing up to $dest"

  # Build locally, then move — the cloud client never syncs a half-written zip.
  # BACKUP_DIR/BACKUP_KEEP are overridden for this call only: staging holds one
  # archive, and rotation happens on the cloud folder below.
  if ! out="$(BACKUP_DIR="$stage" BACKUP_KEEP=0 ./node_modules/.bin/tsx scripts/backup.ts --meta 2>&1)"; then
    fail "backup script failed: $(echo "$out" | tail -n 1)"
  fi
  zip="$(ls "$stage"/bifrost-backup-*.zip 2>/dev/null | head -n 1)"
  [ -n "$zip" ] || fail "backup script produced no archive"
  name="$(basename "$zip" .zip)"

  mkdir -p "$dest"
  incoming="$dest/.incoming-$name"
  rm -rf "$incoming"
  mkdir "$incoming"
  mv "$zip" "$incoming/$name.zip" || fail "could not move archive into $dest"
  mv "$stage/$name.meta.json" "$incoming/meta.json" || fail "could not move meta into $dest"

  want="$(json_get "$incoming/meta.json" sha256)"
  got="$(shasum -a 256 "$incoming/$name.zip" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { rm -rf "$incoming"; fail "checksum mismatch after copy to $dest"; }
  # Same filesystem, so the rename is atomic: a folder named bifrost-backup-*
  # is always complete, which is what the age check trusts.
  mv "$incoming" "$dest/$name"

  bytes="$(json_get "$dest/$name/meta.json" archiveBytes)"
  log OK "$name ($(human "$bytes")) → $dest/$name"

  # Rotation: newest BACKUP_KEEP folders stay (0 = keep all).
  if [ "$KEEP" -gt 0 ]; then
    ls -1 "$dest" | grep -E '^bifrost-backup-' | sort -r | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
      rm -rf "${dest:?}/$old"
      log PRUNE "$old"
    done
  fi
  # Leftovers of a run killed mid-move.
  find "$dest" -maxdepth 1 -name '.incoming-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
}

# ---------------------------------------------------------------- launchd

write_plist() {
  hh="${SCHEDULE%%:*}"; mm="${SCHEDULE#*:}"
  case "$hh$mm" in *[!0-9]*|'') echo "✖ BACKUP_SCHEDULE_TIME must be HH:MM (got \"$SCHEDULE\")"; exit 1 ;; esac
  # Strip leading zeros: plist integers, and "08" isn't valid octal arithmetic.
  hh="$(echo "$hh" | sed 's/^0*//')"; [ -n "$hh" ] || hh=0
  mm="$(echo "$mm" | sed 's/^0*//')"; [ -n "$mm" ] || mm=0
  [ "$hh" -le 23 ] && [ "$mm" -le 59 ] || { echo "✖ BACKUP_SCHEDULE_TIME out of range (got \"$SCHEDULE\")"; exit 1; }
  node_dir="$(dirname "$(command -v node)")"
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$ROOT/scripts/backup-agent.sh</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$hh</integer>
    <key>Minute</key><integer>$mm</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG_DIR/backup-agent-launchd.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/backup-agent-launchd.log</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
disabled() { launchctl print-disabled "$DOMAIN" 2>/dev/null | grep -q "\"$LABEL\" => \(true\|disabled\)"; }

cmd_install() {
  command -v node >/dev/null 2>&1 || { echo "✖ node not found — install Node.js >= 20"; exit 1; }
  [ -x ./node_modules/.bin/tsx ] || { echo "✖ dependencies missing — run npm install"; exit 1; }
  croot="$(cloud_root 2>&1)" || { echo "✖ $croot"; exit 1; }
  write_plist
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl enable "$DOMAIN/$LABEL"
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "✔ agent installed: daily check at $(fmt_clock "$SCHEDULE") (local time), backup every $INTERVAL_DAYS day(s) → $croot/$SUBDIR"
  # Run once now under launchd itself, so a macOS folder-access prompt for the
  # cloud folder shows up while you're watching. The age check still applies.
  launchctl kickstart "$DOMAIN/$LABEL"
  echo "▶ first check started under launchd — see: sh scripts/backup-agent.sh status"
}

cmd_uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl enable "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "✔ agent removed (existing backups were not touched)"
}

cmd_stop() {
  [ -f "$PLIST" ] || { echo "✖ agent is not installed"; exit 1; }
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  # disable keeps it off across logins — LaunchAgents otherwise reload at login.
  launchctl disable "$DOMAIN/$LABEL"
  echo "✔ scheduled backups stopped (resume with: sh scripts/backup-agent.sh start)"
}

cmd_start() {
  [ -f "$PLIST" ] || { echo "✖ agent is not installed — run: sh scripts/backup-agent.sh install"; exit 1; }
  launchctl enable "$DOMAIN/$LABEL"
  loaded || launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "✔ scheduled backups running: daily check at $(fmt_clock "$SCHEDULE") (local time), backup every $INTERVAL_DAYS day(s)"
}

cmd_status() {
  echo "Bifrost scheduled backup"
  echo ""
  if [ ! -f "$PLIST" ]; then
    state="not installed"
  elif disabled; then
    state="stopped (paused — resume with: start)"
  elif loaded; then
    state="scheduled"
  else
    state="installed but not loaded (run: start)"
  fi
  echo "  Agent state:        $state"
  if [ -f "$PLIST" ]; then
    hh="$(plutil -extract StartCalendarInterval.Hour raw -o - "$PLIST" 2>/dev/null || echo '?')"
    mm="$(plutil -extract StartCalendarInterval.Minute raw -o - "$PLIST" 2>/dev/null || echo '?')"
    installed="$(printf '%02d:%02d' "$hh" "$mm")"
    printf '  Daily check at:     %s every day, local time (%s on the 24-hour clock)' "$(fmt_clock "$installed")" "$installed"
    [ "$installed" = "$SCHEDULE" ] || printf ' — .env now says %s, re-run install to apply' "$(fmt_clock "$SCHEDULE")"
    echo ""
  else
    echo "  Daily check at:     $(fmt_clock "$SCHEDULE") every day, local time (from .env, not installed)"
  fi
  echo "  Backup every:       $INTERVAL_DAYS day(s)"
  echo "  Keep newest:        $([ "$KEEP" -gt 0 ] && echo "$KEEP backups" || echo "all backups")"
  echo "  Excluded folders:   $(env_get BACKUP_EXCLUDE '(none)')"
  if loaded; then
    code="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk -F'= ' '/last exit code/ { print $2; exit }')"
    echo "  Last launchd exit:  ${code:-never ran since load}"
  fi
  echo "  API right now:      $(server_up && echo "running on port $API_PORT" || echo "NOT running on port $API_PORT (backups will skip)")"
  echo ""

  if croot="$(cloud_root 2>&1)"; then
    dest="$croot/$SUBDIR"
    echo "  Cloud service:      ${CLOUD:-custom}$([ -n "$CLOUD_ROOT_OVERRIDE" ] && echo ' (BACKUP_CLOUD_ROOT override)')"
    echo "  Destination:        $dest"
    count="$(ls -1 "$dest" 2>/dev/null | grep -cE '^bifrost-backup-' || true)"
    total="$(du -sk "$dest" 2>/dev/null | cut -f1 || echo 0)"
    echo "  Backups stored:     ${count:-0} ($(human "$(( ${total:-0} * 1024 ))") total)"
    newest="$(newest_backup "$dest")"
    if [ -n "$newest" ] && created="$(json_get "$dest/$newest/meta.json" createdAtEpoch)"; then
      age_days=$(( ($(date +%s) - created) / 86400 ))
      echo "  Last backup:        $(fmt_epoch "$created") ($age_days day(s) ago)"
      echo "  Last backup name:   $newest"
      echo "  Last backup size:   $(human "$(json_get "$dest/$newest/meta.json" archiveBytes)")"
      echo "  Next backup due:    $(fmt_epoch $(( created + INTERVAL_DAYS * 86400 ))) (runs at the first daily check after this)"
    else
      echo "  Last backup:        none yet"
      echo "  Next backup due:    at the next daily check"
    fi
  else
    echo "  Destination:        ✖ $croot"
  fi
  echo ""

  if [ -f "$LOG" ]; then
    last="$(grep -E ' (OK|SKIP|FAIL) ' "$LOG" | tail -n 1 || true)"
    ok="$(grep ' OK ' "$LOG" | tail -n 1 || true)"
    fl="$(grep ' FAIL ' "$LOG" | tail -n 1 || true)"
    echo "  Last run:           $([ -n "$last" ] && fmt_logline "$last" || echo never)"
    echo "  Last success:       $([ -n "$ok" ] && fmt_logline "$ok" || echo none)"
    echo "  Last failure:       $([ -n "$fl" ] && fmt_logline "$fl" || echo none)"
    echo "  Run log:            $LOG"
  else
    echo "  Last run:           never"
  fi
}

case "${1:-}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  stop) cmd_stop ;;
  start) cmd_start ;;
  status) cmd_status ;;
  run) shift; cmd_run "${1:-}" ;;
  *)
    echo "usage: sh scripts/backup-agent.sh {install|uninstall|stop|start|status|run [--force]}"
    exit 1 ;;
esac
