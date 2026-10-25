#!/usr/bin/env bash
# Smoke-test a built standalone image (PLAN-35 criterion 18): run it the way
# compose/standalone.yml does (read-only, no capabilities), then check
# the shell, a public page's own file, that a deep link and /api/health are the 404 page with a
# 404 rather than anything proxied, robots.txt, gzip, a hashed asset's cache headers, the
# manifest's type, and that the healthcheck passes.
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

page="$(curl -fsS "$BASE/runestone")"
grep -q '<title>[^<]*Runestone' <<<"$page" || fail "/runestone is not its own prerendered page"
notfound="$(curl -sS "$BASE/no-such-page")"
grep -q 'name="robots" content="noindex"' <<<"$notfound" || fail "404.html is not the noindex 404 page"
for path in /runestone/a-deep-link /api/health; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  [ "$code" = "404" ] || fail "$path answered $code, not 404 (a backend answered?)"
  [ "$(curl -sS "$BASE$path")" = "$notfound" ] || fail "$path is not the 404 page"
done
case "$(header "$BASE/robots.txt" content-type)" in
  text/plain*) ;;
  *) fail "robots.txt is not served as text/plain" ;;
esac

asset="$(grep -o '/assets/[^"]*\.js' <<<"$shell" | head -1)"
[ -n "$asset" ] || fail "no hashed script in the shell"
case "$(header "$BASE$asset" cache-control)" in
  *immutable*) ;;
  *) fail "$asset is not cached as immutable" ;;
esac
encoding="$(curl -fsS -H 'Accept-Encoding: gzip' -D - -o /dev/null "$BASE$asset" | tr -d '\r' | grep -i '^content-encoding:' | cut -d' ' -f2-)"
[ "$encoding" = "gzip" ] || fail "$asset is not gzipped"
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

echo "standalone smoke: ok — healthy, non-root, shell, public page, 404s, robots.txt, gzip, asset headers"
