#!/usr/bin/env bash
# Proves that a change inside packages/ui changes the task hash of a package
# that depends on it. Without a dependency edge turbo replays a stale pass.
set -euo pipefail

hash_of() {
  # `--dry=json` shares stdout with whatever the package manager prints, so slice
  # from the first brace instead of assuming the stream is pure JSON.
  npx turbo run test --filter=@uniwork/views --dry=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));const t=j.tasks.find(t=>t.taskId==="@uniwork/views#test");console.log(t?t.hash:"NOTASK")})'
}

BEFORE="$(hash_of)"
printf '\n/* turbo cache probe */\n' >> packages/ui/lib/utils.ts
AFTER="$(hash_of)"
git checkout packages/ui/lib/utils.ts

echo "before=$BEFORE"
echo "after=$AFTER"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "FAIL: editing packages/ui did not change @uniwork/views#test hash"
  exit 1
fi
echo "PASS: hash tracks dependency sources"
