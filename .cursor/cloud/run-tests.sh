#!/usr/bin/env bash
# One test round on a cloud runner VM, as a single command so the agent makes
# one tool call (every agent step re-reads the whole conversation, which is
# what a round costs). Run from the repository checkout:
#
#   run-tests.sh --branch B --sha S --lane L --spec-ref R --spec-sha256 H  # test round
#   run-tests.sh --branch B --provision-only                 # just prepare
#   ... --profile office                                      # another repository's stack
#
# Checks out origin/B, provisions the VM on first use (install.sh), reinstalls
# dependencies when the lockfiles change, starts the services, runs each spec
# line (one shell command per line, '#' comments; fetched from the git ref R and
# checked against sha256 H, so the agent never retypes the spec) from the repo
# root without the agent's secrets in its environment, redacts secret values
# from the logs, publishes them to refs/test-results/L/S and prints the report
# as the last stdout line: one JSON object.
#
# --profile picks the stack of the checked-out repository (default uniwork):
#   uniwork  provision.sh / install.sh / start.sh; locks pnpm-lock.yaml, server/go.sum
#   office   UNIAI-TEAM/uniwork-office (npm workspaces, Electron, Rust sidecar):
#            provision-office.sh / install-office.sh / start-office.sh; locks
#            package-lock.json, apps/sheets/native/xlsx-engine/Cargo.lock
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
state=~/.uniwork-cloud/state
results=/tmp/test-results
mkdir -p "$state"

branch="" sha="" lane="" spec_ref="" spec_sha="" provision_only=false profile=uniwork repo_url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch=$2; shift 2 ;;
    --sha) sha=$2; shift 2 ;;
    --lane) lane=$2; shift 2 ;;
    --spec-ref) spec_ref=$2; shift 2 ;;
    --spec-sha256) spec_sha=$2; shift 2 ;;
    --provision-only) provision_only=true; shift ;;
    --profile) profile=$2; shift 2 ;;
    --repo-url) repo_url=$2; shift 2 ;;
    *) echo "run-tests.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

case "$profile" in
  uniwork)
    provision_sh=provision.sh install_sh=install.sh start_sh=start.sh
    locks=(pnpm-lock.yaml server/go.sum) clean_keep=() ;;
  office)
    provision_sh=provision-office.sh install_sh=install-office.sh start_sh=start-office.sh
    locks=(package-lock.json apps/sheets/native/xlsx-engine/Cargo.lock)
    # The sidecar's cargo target dir survives the per-round clean, so builds stay warm.
    clean_keep=(-e apps/sheets/native/xlsx-engine/target) ;;
  *) echo "run-tests.sh: unknown profile $profile" >&2; exit 2 ;;
esac

# --repo-url: Cursor could not open that repository, so the VM booted on the
# uniwork checkout; work in a clone of the URL under ~/work instead (once per VM).
if [ "$repo_url" ]; then
  clone=~/work/$(basename "$repo_url" .git)
  if [ ! -d "$clone/.git" ]; then
    rm -rf "$clone" && mkdir -p ~/work
    if ! git clone -q "$repo_url" "$clone" > /tmp/runner-clone.log 2>&1; then
      echo "{\"stage_outcome\":\"failed\",\"test_verdict\":\"blocked\",\"notes\":\"could not clone $repo_url\"}"; exit 0
    fi
  fi
  cd "$clone"
fi
root=$(git rev-parse --show-toplevel)
cd "$root"
export PATH=/usr/local/go/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH

provisioned=false fresh_install=false start_seconds=0 head="" notes=""
ran_file=$(mktemp)

report() { # stage_outcome test_verdict log_ref
  STAGE=$1 VERDICT=$2 LOGREF=$3 HEAD_SHA=$head PROV=$provisioned START=$start_seconds \
  NOTES=$notes RAN=$ran_file node -e '
    const fs = require("fs");
    const ran = fs.readFileSync(process.env.RAN, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const failures = ran.filter((r) => r.result === "fail").flatMap((r) => r.failures);
    // Notes quote tails of install/push logs: scrub them like the pushed logs,
    // plus any credentials in a URL.
    const names = ["GH_TOKEN", "GITHUB_TOKEN", "CURSOR_API_KEY",
      ...(process.env.CLOUD_AGENT_ALL_SECRET_NAMES || "").split(/[\s,]+/)];
    let notes = process.env.NOTES || "";
    for (const v of names.map((n) => n && process.env[n]).filter((v) => v && v.length >= 8)) notes = notes.split(v).join("[REDACTED]");
    notes = notes.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|key_[A-Za-z0-9]{32,})\b/g, "[REDACTED]")
      .replace(/(\/\/[^\/\s:@]*:)[^@\s]+@/g, "$1[REDACTED]@");
    console.log(JSON.stringify({
      sha: process.env.HEAD_SHA, stage_outcome: process.env.STAGE, test_verdict: process.env.VERDICT,
      provisioned: process.env.PROV === "true", start_seconds: Number(process.env.START),
      ran: ran.map(({ cmd, result, duration_s, exit_code }) => ({ cmd, result, duration_s, exit_code })),
      failures, not_run: [], log_ref: process.env.LOGREF || null, notes,
    }));'
  rm -f "$ran_file"
}

if [ -n "$branch" ]; then
  if ! git fetch -q origin "$branch" || ! git reset -q --hard "origin/$branch"; then
    notes="could not check out origin/$branch"; report failed blocked ""; exit 0
  fi
  git clean -qfdx -e .env -e node_modules -e '**/node_modules' "${clean_keep[@]}"
fi
head=$(git rev-parse --short=8 HEAD)
if [ -n "$sha" ] && [ "${head:0:7}" != "${sha:0:7}" ]; then
  notes="sha mismatch: HEAD $head, wanted $sha"; report failed blocked ""; exit 0
fi

if [ ! -f "$state/installed" ]; then
  if ! bash "$here/$install_sh" > /tmp/runner-install.log 2>&1; then
    notes="$install_sh failed: $(tail -3 /tmp/runner-install.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
  touch "$state/installed"; provisioned=true; fresh_install=true
  sha256sum "${locks[@]}" > "$state/locks"
  sha256sum "$here/$provision_sh" > "$state/provision"
elif ! sha256sum -c --quiet "$state/provision" > /dev/null 2>&1; then
  # provision.sh changed on test/cursor-cloud-env: add the new stack to this warm VM.
  if ! bash "$here/$provision_sh" > /tmp/runner-provision.log 2>&1; then
    notes="$provision_sh failed: $(tail -3 /tmp/runner-provision.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
  sha256sum "$here/$provision_sh" > "$state/provision"; provisioned=true
fi
if [ "$fresh_install" = false ] && ! sha256sum -c --quiet "$state/locks" > /dev/null 2>&1; then
  if [ "$profile" = office ]; then refresh_deps() { ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci; }
  else refresh_deps() { pnpm install --frozen-lockfile && (cd server && go mod download); }; fi
  if ! refresh_deps > /tmp/runner-deps.log 2>&1; then
    notes="dependency refresh failed: $(tail -3 /tmp/runner-deps.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
  sha256sum "${locks[@]}" > "$state/locks"
fi

# packages/office-upstream/dist is gitignored, so the git clean above wipes it on a warm
# VM and every suite importing @uniwork/office-upstream/* fails to resolve. Rebuild the
# browser artifacts the branch knows how to build before any spec command runs.
[ "$profile" = uniwork ] && for builder in "build-upstream.mjs --docx-browser" "build-xlsx-browser.mjs" "build-pptx-browser.mjs"; do
  [ -f "scripts/office/${builder%% *}" ] || continue
  if ! node scripts/office/$builder > /tmp/runner-upstream.log 2>&1; then
    notes="office-upstream build failed (${builder%% *}): $(tail -3 /tmp/runner-upstream.log | tr '\n' ' ')"; report failed blocked ""; exit 0
  fi
done

t0=$(date +%s)
if ! bash "$here/$start_sh" > /tmp/runner-start.log 2>&1; then
  notes="$start_sh failed: $(tail -3 /tmp/runner-start.log | tr '\n' ' ')"; report failed blocked ""; exit 0
fi
start_seconds=$(( $(date +%s) - t0 ))

if $provision_only; then report succeeded not_run ""; exit 0; fi

spec_file=$(mktemp)
if ! git fetch -q origin "$spec_ref" || ! git show FETCH_HEAD:spec.txt > "$spec_file" 2> /dev/null; then
  notes="could not fetch spec $spec_ref"; report failed blocked ""; exit 0
fi
if [ "$(sha256sum "$spec_file" | cut -d' ' -f1)" != "$spec_sha" ]; then
  notes="spec sha256 mismatch for $spec_ref"; report failed blocked ""; exit 0
fi

# The fork installs with ELECTRON_SKIP_BINARY_DOWNLOAD; a spec that drives the
# Electron shell gets the binary here (it then stays in node_modules until the
# next npm ci).
if [ "$profile" = office ] && grep -qE 'test:e2e|electron' "$spec_file"; then
  for d in node_modules/electron apps/shell/node_modules/electron; do
    [ -f "$d/install.js" ] && [ ! -f "$d/path.txt" ] || continue
    if ! node "$d/install.js" > /tmp/runner-electron.log 2>&1; then
      notes="electron download failed: $(tail -3 /tmp/runner-electron.log | tr '\n' ' ')"; report failed blocked ""; exit 0
    fi
  done
fi

# The agent VM carries Cursor secrets (GH_TOKEN and every name listed in
# CLOUD_AGENT_ALL_SECRET_NAMES). Test commands never see them; this script keeps
# them for its own log push and scrubs their values from the logs.
secret_names="GH_TOKEN GITHUB_TOKEN CURSOR_API_KEY ${CLOUD_AGENT_ALL_SECRET_NAMES:-}"
secret_names=${secret_names//,/ }
unset_args=()
for s in $secret_names; do unset_args+=(-u "$s"); done

rm -rf "$results" && mkdir -p "$results"
n=0 any_fail=false
while IFS= read -r cmd || [ -n "$cmd" ]; do
  cmd=${cmd%$'\r'}
  case "$cmd" in ''|'#'*) continue ;; esac
  # a..z, then za..zz, zza..: every name stays a Windows-legal file name (the
  # old ASCII walk went past z to '{' and '|', and collect aborted on '|.log').
  letter="" k=$n
  while [ "$k" -ge 26 ]; do letter="${letter}z"; k=$((k - 26)); done
  letter="$letter$(printf "\\$(printf '%03o' $((97 + k)))")"; n=$((n + 1))
  log="$results/$letter.log"
  echo "\$ $cmd" > "$log"
  t=$(date +%s)
  (cd "$root" && env "${unset_args[@]}" bash -c "$cmd") >> "$log" 2>&1
  code=$?
  dur=$(( $(date +%s) - t ))
  result=pass; [ "$code" -eq 0 ] || { result=fail; any_fail=true; }
  PROFILE=$profile CMD=$cmd RESULT=$result DUR=$dur CODE=$code LOG=$log node -e '
    const fs = require("fs");
    const lines = process.env.RESULT === "fail" ? fs.readFileSync(process.env.LOG, "utf8").split("\n") : [];
    const failures = [];
    for (const l of lines) {
      const go = l.match(/^\s*--- FAIL: (\S+)/);
      const vt = l.match(/^\s*(?:FAIL|×|✗)\s+(.+)/);
      // office: Playwright "✘  3 [project] › file:line › title", node:test "✖ name" / TAP "not ok 3 - name".
      const fork = process.env.PROFILE === "office"
        && (l.match(/^\s*✘\s+(?:\d+\s+)?(.*›.*?)(?:\s+\([\d.]+m?s\))?$/) ?? l.match(/^\s*✖\s+(.+?)(?:\s+\([\d.]+m?s\))?$/)
          ?? l.match(/^\s*not ok \d+ - (.+)/));
      if (go || vt || fork) failures.push({ test: (go ?? vt ?? fork)[1].trim(), file: "", msg: "" });
      const at = l.match(/^\s+(\S+\.(?:go|ts|tsx|js|mjs):\d+):\s*(.*)$/);
      if (at && failures.length && !failures.at(-1).file) Object.assign(failures.at(-1), { file: at[1], msg: at[2].slice(0, 200) });
      if (failures.length >= 20) break;
    }
    if (process.env.RESULT === "fail" && failures.length === 0)
      failures.push({ test: process.env.CMD, file: "", msg: `exit ${process.env.CODE}; ${lines.filter(Boolean).slice(-3).join(" | ").slice(0, 300)}` });
    console.log(JSON.stringify({ cmd: process.env.CMD, result: process.env.RESULT,
      duration_s: Number(process.env.DUR), exit_code: Number(process.env.CODE), failures }));' >> "$ran_file"
done < "$spec_file"
rm -f "$spec_file"

if [ "$n" -eq 0 ]; then notes="spec has no commands"; report failed blocked ""; exit 0; fi

SECRET_NAMES=$secret_names RESULTS=$results node -e '
  const fs = require("fs"); const path = require("path");
  const values = process.env.SECRET_NAMES.split(/\s+/).filter(Boolean)
    .map((n) => process.env[n]).filter((v) => v && v.length >= 8);
  const tokenLike = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|key_[A-Za-z0-9]{32,})\b/g;
  for (const f of fs.readdirSync(process.env.RESULTS)) {
    const p = path.join(process.env.RESULTS, f);
    let s = fs.readFileSync(p, "utf8");
    for (const v of values) s = s.split(v).join("[REDACTED]");
    fs.writeFileSync(p, s.replace(tokenLike, "[REDACTED]"));
  }'

log_ref="refs/test-results/$lane/$head"
# The VM's own credentials may not reach a repository Cursor cannot open
# (--repo-url); the fallback feeds GH_TOKEN through a credential helper so it
# is never on a command line. The VM's global git config rewrites github.com
# URLs to carry Cursor's app token (insteadOf), which wins over any helper, so
# the fallback push reads no global or system config at all.
# Cursor may set GH_TOKEN to its own app token (ghs_, cursor[bot]), so every
# secret holding a personal GitHub token (ghp_, github_pat_, gho_) is tried;
# the notes name what was tried by variable and prefix only.
push_with_gh_token() {
  local tried="" name val
  for name in GH_TOKEN GITHUB_TOKEN ${CLOUD_AGENT_ALL_SECRET_NAMES//,/ }; do
    val=${!name:-}
    case "$val" in
      ghp_*|github_pat_*|gho_*) tried="$tried $name(${val:0:4})" ;;
      ghs_*) tried="$tried $name(ghs_)"; continue ;;
      "") tried="$tried $name(unset)"; continue ;;
      *) continue ;;
    esac
    if PUSH_TOKEN=$val GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_ASKPASS= GIT_CONFIG_COUNT=0 \
      git -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$PUSH_TOKEN"; }; f' \
      push -qf "$1" "HEAD:$log_ref"; then return 0; fi
  done
  echo "fallback push failed; tokens seen:${tried:- none}"
  return 1
}
origin=$(git remote get-url origin)
if ! (cd "$results" && export GIT_TERMINAL_PROMPT=0 && git init -q && git add -A \
      && git -c user.name=runner -c user.email=runner@local commit -qm "$lane $head" \
      && { git push -qf "$origin" "HEAD:$log_ref" || push_with_gh_token "$origin"; }) > /tmp/runner-push.log 2>&1; then
  notes="log push failed: $(tail -2 /tmp/runner-push.log | tr '\n' ' ')"; log_ref=""
fi

$any_fail && verdict=fail || verdict=pass
report succeeded "$verdict" "$log_ref"
