#!/usr/bin/env bash
# Writes the cloud agent's .env: .env.example plus cloud.env overrides (later
# lines win, for make's include and for `. .env` alike). MAIL_FROM is dropped
# because its unquoted "<...>" breaks `. .env` in ensure-postgres.sh and the
# server's default is the same address.
set -euo pipefail

cd "$(dirname "$0")/../.."

grep -v '^MAIL_FROM=' .env.example | cat - .cursor/cloud/cloud.env > .env
