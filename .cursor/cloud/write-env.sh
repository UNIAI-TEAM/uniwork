#!/usr/bin/env bash
# Writes the cloud agent's .env at the repository root (the current git
# checkout): .env.example plus cloud.env overrides (later lines win, for make's
# include and for `. .env` alike). MAIL_FROM is dropped because its unquoted
# "<...>" breaks `. .env` in ensure-postgres.sh and the server's default is the
# same address.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(git rev-parse --show-toplevel)

grep -v '^MAIL_FROM=' "$root/.env.example" | cat - "$here/cloud.env" > "$root/.env"
