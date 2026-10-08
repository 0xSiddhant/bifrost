#!/usr/bin/env bash
# Smoke-test a built standalone image (PLAN-35 criterion 18): run it the way
# compose/standalone.yml does (read-only, no capabilities), then check
# the shell, a deep link, a hashed asset's cache headers, the manifest's type, that /api/health is
# the app shell rather than anything proxied, and that the healthcheck passes.
#
#   scripts/standalone-smoke.sh [image]     (default: bifrost-standalone:ci)
set -euo pipefail

IMAGE="${1:-bifrost-standalone:ci}"
PORT="${SMOKE_PORT:-18080}"
BASE="http://127.0.0.1:${PORT}"
NAME="bifrost-standalone-smoke-$$"

fail() {
  echo "standalone smoke: FAIL — $*" >&2
  docker logs "$NAME" >&2 || true
  exit 1
}
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges:true -p "127.0.0.1:${PORT}:8080" "$IMAGE" >/dev/null

status=""
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = "true" ] || fail "the container exited"
  sleep 1
done
[ "$status" = "healthy" ] || fail "healthcheck never passed (last: ${status:-none})"

[ "$(docker exec "$NAME" id -u)" != "0" ] || fail "nginx runs as root"

header() { curl -fsS -D - -o /dev/null "$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
shell="$(curl -fsS "$BASE/")"
grep -q '<div id="root"' <<<"$shell" || fail "/ is not the app shell"
[ "$(header "$BASE/" cache-control)" = "no-cache" ] || fail "/ is cached"
[ "$(header "$BASE/" x-content-type-options)" = "nosniff" ] || fail "/ lacks nosniff"
[ "$(header "$BASE/" referrer-policy)" = "strict-origin-when-cross-origin" ] || fail "/ lacks Referrer-Policy"
if header "$BASE/" server | grep -q '[0-9]'; then fail "the Server header names a version"; fi

[ "$(curl -fsS "$BASE/runestone/a-deep-link")" = "$shell" ] || fail "a deep link is not the app shell"
[ "$(curl -fsS "$BASE/api/health")" = "$shell" ] || fail "/api/health is not the app shell (a backend answered?)"

asset="$(grep -o '/assets/[^"]*\.js' <<<"$shell" | head -1)"
[ -n "$asset" ] || fail "no hashed script in the shell"
case "$(header "$BASE$asset" cache-control)" in
  *immutable*) ;;
  *) fail "$asset is not cached as immutable" ;;
esac
case "$(header "$BASE$asset" content-type)" in
  *javascript*) ;;
  *) fail "$asset is not served as JavaScript" ;;
esac
case "$(header "$BASE/manifest.webmanifest" content-type)" in
  application/manifest+json*) ;;
  *) fail "the web manifest is not served as application/manifest+json" ;;
esac
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/assets/no-such-chunk-000000.js")"
[ "$code" = "404" ] || fail "a missing asset answered $code, not 404"

echo "standalone smoke: ok — healthy, non-root, shell, deep link, /api/health is the shell, asset headers"
