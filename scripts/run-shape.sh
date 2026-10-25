# The run's shape from flags, never from .env (owner, 2026-10-09). Sourced by
# start-pm2.sh and start-launchd.sh, which take the same flags as
# `./bifrost start`:
#   --web native|docker|none   where the web host runs (default native)
#   --standalone               the web host alone, serving the standalone client
#   --otel                     the API sends traces
# Mirrors launchFor() in web/src/processes.ts, which npm start uses and which
# is unit-tested. Sets APPS (api web mdns, in start order), RUN, ADVERTISER,
# OTEL_ENABLED and SHAPE (a one-line description).

parse_run_shape() {
  WEB=native; STANDALONE=0; OTEL=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --web)
        [ $# -ge 2 ] || { echo "✖ --web needs a value: native, docker or none"; exit 2; }
        WEB="$2"; shift 2 ;;
      --web=*) WEB="${1#--web=}"; shift ;;
      --standalone) STANDALONE=1; shift ;;
      --otel) OTEL=1; shift ;;
      *) echo "✖ unknown option $1 (--web native|docker|none, --standalone, --otel)"; exit 2 ;;
    esac
  done
  case "$WEB" in
    native|docker|none) ;;
    *) echo "✖ --web must be native, docker or none (got \"$WEB\")"; exit 2 ;;
  esac
  if [ "$STANDALONE" = 1 ] && [ "$WEB" != native ]; then
    echo "✖ --standalone runs the web host here; it cannot be combined with --web $WEB"; exit 2
  fi
  if [ "$STANDALONE" = 1 ] && [ "$OTEL" = 1 ]; then
    echo "✖ --otel traces the API, and --standalone runs none"; exit 2
  fi

  # The API runs as `full` whenever a web host exists, here or in Docker, so it
  # prints the LAN address and the join QR.
  if [ "$STANDALONE" = 1 ]; then
    APPS="web"; RUN=web; ADVERTISER=web; SHAPE="the standalone client alone"
  elif [ "$WEB" = native ]; then
    APPS="api web"; RUN=full; ADVERTISER=web; SHAPE="the hub (API + web host)"
  elif [ "$WEB" = docker ]; then
    APPS="api mdns"; RUN=full; ADVERTISER=host; SHAPE="the API + bifrost-mdns; the web host runs in Docker"
  else
    APPS="api"; RUN=api; ADVERTISER=off; SHAPE="the API alone"
  fi
  if [ "$OTEL" = 1 ]; then OTEL_ENABLED=true; SHAPE="$SHAPE, traces on"; else OTEL_ENABLED=false; fi
}
