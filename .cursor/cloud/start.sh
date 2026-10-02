#!/usr/bin/env bash
# Cursor cloud agent "start" step: runs on every agent boot. Processes do not
# survive a snapshot, so Postgres, Redis and MinIO are started here, then the
# databases and the test bucket are created if missing and migrations applied.
# Acts on the current git checkout, like install.sh.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)"
export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH

[ -f .env ] || bash "$here/write-env.sh"

# Alias used by DATABASE_URL in cloud.env (see the comment there).
grep -q ' uniwork-db$' /etc/hosts || echo '127.0.0.1 uniwork-db' | sudo tee -a /etc/hosts > /dev/null

sudo pg_ctlcluster 16 main start 2> /dev/null || true
until pg_isready -h 127.0.0.1 -q; do sleep 1; done
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname = 'uniwork'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE ROLE uniwork LOGIN SUPERUSER PASSWORD 'uniwork'"
for db in uniwork uniwork_test; do
  sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 \
    || sudo -u postgres createdb -O uniwork "$db"
done

redis-cli ping > /dev/null 2>&1 || sudo redis-server --daemonize yes
until redis-cli ping > /dev/null 2>&1; do sleep 1; done

if ! curl -sf http://localhost:9000/minio/health/live > /dev/null; then
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
    nohup minio server /var/lib/minio --address :9000 --console-address :9001 > /tmp/minio.log 2>&1 &
  until curl -sf http://localhost:9000/minio/health/live > /dev/null; do sleep 1; done
fi
mc alias set local http://localhost:9000 minioadmin minioadmin > /dev/null
mc mb --ignore-existing local/uniwork-test > /dev/null

make migrate-up

echo "cloud start: postgres, redis, minio up; databases migrated"
