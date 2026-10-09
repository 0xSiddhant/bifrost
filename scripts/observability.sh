#!/bin/sh
# Start/stop the OPTIONAL Grafana + Loki + Alloy stack (Docker containers) that
# visualise Bifrost's logs. Independent of how Bifrost runs — Alloy tails
# storage/logs/, so run Bifrost native (start-pm2.sh / start-launchd.sh) and
# this stack side by side.
#
# Usage:
#   sh scripts/observability.sh          # start (detached) + print Grafana URL
#   sh scripts/observability.sh logs     # follow the stack's logs
#   sh scripts/observability.sh down     # stop the stack
#   sh scripts/observability.sh down -v  # stop + wipe stored logs/dashboards
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# PLAN-39: the stack's own compose file, every service in the `observability`
# profile so the root docker-compose.yml can include it without starting it.
COMPOSE_FILE="compose/observability.yml"
OBS="-f $COMPOSE_FILE --profile observability"
# Compose reads ${VARS} from the .env beside the file it is given (compose/);
# point it at the repo's own when there is one.
[ -f .env ] && OBS="$OBS --env-file .env"

# Docker present + daemon up
command -v docker >/dev/null 2>&1 || { echo "✖ docker not found — install/start Docker Desktop"; exit 1; }
docker info >/dev/null 2>&1 || { echo "✖ Docker daemon not running — start Docker Desktop first"; exit 1; }

# Compose v2 (docker compose) preferred, fall back to v1 (docker-compose)
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "✖ docker compose not available"; exit 1
fi

CMD="${1:-up}"
case "$CMD" in
  logs)
    exec $DC $OBS logs -f
    ;;
  down)
    shift
    $DC $OBS down "$@"
    echo "✔ observability stack stopped."
    ;;
  up)
    echo "▶ starting Grafana + Loki + Alloy..."
    $DC $OBS up -d
    echo ""
    echo "✔ observability stack is up."
    echo "  Grafana:    http://localhost:4648   (admin / bifrost — change it)"
    echo "  Prometheus: http://localhost:4649   traces in: http://localhost:4650   Loki: :4651   Tempo: :4652"
    echo "  Dashboard:  'Bifrost' (auto-provisioned)"
    echo "  follow logs: sh scripts/observability.sh logs"
    echo "  stop:        sh scripts/observability.sh down"
    echo ""
    echo "  Data appears only while Bifrost is running and writing storage/logs/"
    echo "  (start it with sh scripts/start-pm2.sh or start-launchd.sh)."
    ;;
  *)
    echo "usage: sh scripts/observability.sh [up|logs|down]"; exit 1
    ;;
esac
