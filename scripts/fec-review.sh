#!/usr/bin/env bash
# Review frontend files against Front-End Checklist (mcp.frontendchecklist.io).
# Usage: fec-review.sh [--min critical|high|medium|low] file...
# Exit 1 if any finding is printed. Network errors go to stderr and do not fail.
set -u
MIN=high
[ "${1:-}" = "--min" ] && { MIN=$2; shift 2; }
rc=0
for f in "$@"; do
  [ -s "$f" ] || continue
  python3 - "$f" "$MIN" <<'PY' || rc=1
import sys, json, re, time, urllib.request, urllib.error
f, mn = sys.argv[1], sys.argv[2]
code = open(f, encoding="utf-8", errors="replace").read()
# ponytail: document-level rules only apply to files that own <html>
DOC_RULES = {"doctype","lang-attribute","charset","viewport","title","meta-description","canonical","favicon","open-graph","twitter-card","robots-meta","apple-touch-icon","x-ua-compatible"}
is_doc = re.search(r"<html[\s>]", code) is not None
req = urllib.request.Request("https://mcp.frontendchecklist.io",
    data=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
      "params":{"name":"review_code","arguments":{"code":code,"minPriority":mn}}}).encode(),
    headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream"})
raw = None
for attempt in range(4):  # ponytail: 429 backoff 2/4/8s, then give up quietly
    try:
        raw = urllib.request.urlopen(req, timeout=30).read().decode(); break
    except urllib.error.HTTPError as e:
        if e.code == 429 and attempt < 3: time.sleep(2 ** (attempt + 1)); continue
        print(f"fec-review: {f}: HTTP {e.code}", file=sys.stderr); sys.exit(0)
    except Exception as e:
        print(f"fec-review: {f}: {e}", file=sys.stderr); sys.exit(0)
body = "\n".join(l[6:] for l in raw.splitlines() if l.startswith("data: ")) or raw
d = json.loads(body)
r = d.get("result",{}).get("structuredContent") or json.loads(d["result"]["content"][0]["text"])
issues = [i for i in r.get("issues",[]) if is_doc or i["rule"] not in DOC_RULES]
if not issues: sys.exit(0)
print(f"## {f}")
for i in issues:
    print(f"- [{i['priority']}] {i['rule']}: {i['issue']}")
sys.exit(1)
PY
done
exit $rc
