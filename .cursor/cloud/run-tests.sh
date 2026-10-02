#!/usr/bin/env bash
# One test round on a cloud runner VM, as a single command so the agent makes
# one tool call (every agent step re-reads the whole conversation, which is
# what a round costs). Run from the repository checkout:
#
#   run-tests.sh --branch B --sha S --lane L --spec-b64 X   # test round
#   run-tests.sh --branch B --provision-only                 # just prepare
#
# Checks out origin/B, provisions the VM on first use (install.sh), reinstalls
# dependencies when the lockfiles change, starts the services, runs each spec
# line (base64 of one shell command per line, '#' comments) from the repo
# root, publishes the logs to refs/test-results/L/S and prints the report as
# the last stdout line: one JSON object.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
state=~/.uniwork-cloud/state
results=/tmp/test-results
mkdir -p "$state"

branch="" sha="" lane="" spec_b64="" provision_only=false
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch=$2; shift 2 ;;
    --sha) sha=$2; shift 2 ;;
    --lane) lane=$2; shift 2 ;;
    --spec-b64) spec_b64=$2; shift 2 ;;
    --provision-only) provision_only=true; shift ;;
    *) echo "run-tests.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

root=$(git rev-parse --show-toplevel)
cd "$root"
export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH

provisioned=false start_seconds=0 head="" notes=""
ran_file=$(mktemp)

report() { # stage_outcome test_verdict log_ref
  STAGE=$1 VERDICT=$2 LOGREF=$3 HEAD_SHA=$head PROV=$provisioned START=$start_seconds \
  NOTES=$notes RAN=$ran_file node -e '
    const fs = require("fs");
    const ran = fs.readFileSync(process.env.RAN, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const failures = ran.filter((r) => r.result === "fail").flatMap((r) => r.failures);
    console.log(JSON.stringify({
      sha: process.env.HEAD_SHA, stage_outcome: process.env.STAGE, test_verdict: process.env.VERDICT,
      provisioned: process.env.PROV === "true", start_seconds: Number(process.env.START),
      ran: ran.map(({ cmd, result, duration_s, exit_code }) => ({ cmd, result, duration_s, exit_code })),
      failures, not_run: [], log_ref: process.env.LOGREF || null, notes: process.env.NOTES,
    }));'
  rm -f "$ran_file"
}

if [ -n "$branch" ]; then
  if ! git fetch -q origin "$branch" || ! git reset -q --hard "origin/$branch"; then
    notes="could not check out origin/$branch"; report failed blocked ""; exit 0
  fi
  git clean -qfdx -e .env -e node_modules -e '**/node_modules'
fi
head=$(git rev-parse --short=8 HEAD)
if [ -n "$sha" ] && [ "${head:0:7}" != "${sha:0:7}" ]; then
  notes="sha mismatch: HEAD $head, wanted $sha"; report failed blocked ""; exit 0
fi

if [ ! -f "$state/installed" ]; then
  if ! bash "$here/install.sh" > /tmp/runner-install.log 2>&1; then
    notes="install.sh failed: $(tail -3 /tmp/runner-install.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
  touch "$state/installed"; provisioned=true
  sha256sum pnpm-lock.yaml server/go.sum > "$state/locks"
elif ! sha256sum -c --quiet "$state/locks" > /dev/null 2>&1; then
  if ! { pnpm install --frozen-lockfile && (cd server && go mod download); } > /tmp/runner-deps.log 2>&1; then
    notes="dependency refresh failed: $(tail -3 /tmp/runner-deps.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
  sha256sum pnpm-lock.yaml server/go.sum > "$state/locks"
fi

t0=$(date +%s)
if ! bash "$here/start.sh" > /tmp/runner-start.log 2>&1; then
  notes="start.sh failed: $(tail -3 /tmp/runner-start.log | tr '\n' ' ')"; report failed blocked ""; exit 0
fi
start_seconds=$(( $(date +%s) - t0 ))

if $provision_only; then report succeeded not_run ""; exit 0; fi

rm -rf "$results" && mkdir -p "$results"
n=0 any_fail=false
while IFS= read -r cmd || [ -n "$cmd" ]; do
  cmd=${cmd%$'\r'}
  case "$cmd" in ''|'#'*) continue ;; esac
  letter=$(printf "\\$(printf '%03o' $((97 + n)))"); n=$((n + 1))
  log="$results/$letter.log"
  echo "\$ $cmd" > "$log"
  t=$(date +%s)
  (cd "$root" && bash -c "$cmd") >> "$log" 2>&1
  code=$?
  dur=$(( $(date +%s) - t ))
  result=pass; [ "$code" -eq 0 ] || { result=fail; any_fail=true; }
  CMD=$cmd RESULT=$result DUR=$dur CODE=$code LOG=$log node -e '
    const fs = require("fs");
    const lines = process.env.RESULT === "fail" ? fs.readFileSync(process.env.LOG, "utf8").split("\n") : [];
    const failures = [];
    for (const l of lines) {
      const go = l.match(/^\s*--- FAIL: (\S+)/);
      const vt = l.match(/^\s*(?:FAIL|×|✗)\s+(.+)/);
      if (go || vt) failures.push({ test: (go ?? vt)[1].trim(), file: "", msg: "" });
      const at = l.match(/^\s+(\S+\.(?:go|ts|tsx|js|mjs):\d+):\s*(.*)$/);
      if (at && failures.length && !failures.at(-1).file) Object.assign(failures.at(-1), { file: at[1], msg: at[2].slice(0, 200) });
      if (failures.length >= 20) break;
    }
    if (process.env.RESULT === "fail" && failures.length === 0)
      failures.push({ test: process.env.CMD, file: "", msg: `exit ${process.env.CODE}; ${lines.filter(Boolean).slice(-3).join(" | ").slice(0, 300)}` });
    console.log(JSON.stringify({ cmd: process.env.CMD, result: process.env.RESULT,
      duration_s: Number(process.env.DUR), exit_code: Number(process.env.CODE), failures }));' >> "$ran_file"
done < <(printf '%s' "$spec_b64" | base64 -d)

if [ "$n" -eq 0 ]; then notes="spec has no commands"; report failed blocked ""; exit 0; fi

log_ref="refs/test-results/$lane/$head"
origin=$(git remote get-url origin)
if ! (cd "$results" && git init -q && git add -A \
      && git -c user.name=runner -c user.email=runner@local commit -qm "$lane $head" \
      && git push -qf "$origin" "HEAD:$log_ref") > /tmp/runner-push.log 2>&1; then
  notes="log push failed: $(tail -2 /tmp/runner-push.log | tr '\n' ' ')"; log_ref=""
fi

$any_fail && verdict=fail || verdict=pass
report succeeded "$verdict" "$log_ref"
