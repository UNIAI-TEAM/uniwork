#!/usr/bin/env bash
# Glue between this repo and UniAI (uniai CLI). Rules: docs/engineering/UNIAI_TRACKING.md.
#
#   scripts/uniai.sh start UNI-423            assign to me, in_progress, branch from develop
#   scripts/uniai.sh sub   UNI-423 "title"    create a sub-issue under UNI-423
#   scripts/uniai.sh note  UNI-423 "message"  add a comment
#   scripts/uniai.sh block UNI-423 "why"      status blocked + comment
#   scripts/uniai.sh pr    UNI-423            push, open PR titled "UNI-423: …", in_review
#   scripts/uniai.sh done  UNI-423            status done + comment with merged sha
#   scripts/uniai.sh mine                     my open issues
#   scripts/uniai.sh new   "title"            new issue in the UniWork project (backlog)
#
# Every command prints what it changed. Nothing here touches git history except
# `start` (creates a branch) and `pr` (pushes the current branch).
set -euo pipefail

PROJECT_ID="${UNIAI_PROJECT_ID:-57602a20-04e8-4c08-abd5-415ccd882e05}"
BASE_BRANCH="${UNIAI_BASE_BRANCH:-develop}"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing $1 — see docs/engineering/UNIAI_TRACKING.md § 7"; }
need uniai; need python3

key_ok() { [[ "$1" =~ ^UNI-[0-9]+$ ]] || die "issue key must look like UNI-123, got: $1"; }

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

issue_field() { # key field
  uniai issue get "$1" --output json | json "d['$2'] if d.get('$2') is not None else ''"
}

my_member_id() {
  local email
  email="$(uniai auth status 2>&1 | sed -n 's/^User:.*(\(.*\))$/\1/p')"
  [ -n "$email" ] || die "not logged in — run: uniai login"
  uniai workspace member list --output json | python3 -c "
import sys,json
items=json.load(sys.stdin); items=items if isinstance(items,list) else items.get('members',[])
for m in items:
    u=m.get('user',m)
    if (u.get('email') or m.get('email'))=='$email': print(m.get('user_id') or m.get('id')); break
"
}

slug() { # title -> kebab ascii, max 40 chars
  python3 -c "
import sys,re,unicodedata
t=sys.argv[1]
t=unicodedata.normalize('NFD',t); t=''.join(c for c in t if unicodedata.category(c)!='Mn')
t=t.replace('đ','d').replace('Đ','D').lower()
t=re.sub(r'^[a-z]-\d+\s*[·:-]\s*','',t)          # drop leading roadmap id like 'f-08 · '
t=re.sub(r'[^a-z0-9]+','-',t).strip('-')
print(t[:40].rstrip('-'))" "$1"
}

comment() { uniai issue comment add "$1" --content-stdin >/dev/null; }

cmd_start() {
  key_ok "$1"
  local me title branch kind="${2:-feature}"
  me="$(my_member_id)"; [ -n "$me" ] || die "could not resolve your member id"
  title="$(issue_field "$1" title)"
  branch="$kind/$1-$(slug "$title")"
  uniai issue assign "$1" --to-id "$me" --output json >/dev/null
  uniai issue status "$1" in_progress >/dev/null
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout -q "$branch"
  else
    git fetch -q origin "$BASE_BRANCH" 2>/dev/null || true
    git checkout -q -b "$branch" "origin/$BASE_BRANCH" 2>/dev/null || git checkout -q -b "$branch" "$BASE_BRANCH"
  fi
  printf 'Bắt đầu trên nhánh `%s` (từ %s).' "$branch" "$BASE_BRANCH" | comment "$1"
  printf '✓ %s → in_progress, assigned to you, branch %s\n' "$1" "$branch"
}

cmd_sub() {
  key_ok "$1"; [ -n "${2:-}" ] || die "usage: sub UNI-123 \"title\""
  local pid aid out
  pid="$(issue_field "$1" id)"; aid="$(issue_field "$1" assignee_id)"
  out="$(uniai issue create --title "$2" --project "$PROJECT_ID" --parent "$pid" --status todo --priority "$(issue_field "$1" priority)" --output json)"
  local nid nkey; nid="$(printf '%s' "$out" | json "d['id']")"; nkey="$(printf '%s' "$out" | json "d['identifier']")"
  [ -n "$aid" ] && uniai issue assign "$nid" --to-id "$aid" --output json >/dev/null
  printf '✓ %s created under %s: %s\n' "$nkey" "$1" "$2"
}

cmd_note() { key_ok "$1"; [ -n "${2:-}" ] || die "usage: note UNI-123 \"message\""; printf '%s' "$2" | comment "$1"; printf '✓ comment added to %s\n' "$1"; }

cmd_block() {
  key_ok "$1"; [ -n "${2:-}" ] || die "usage: block UNI-123 \"why\""
  uniai issue status "$1" blocked >/dev/null
  printf 'Kẹt: %s' "$2" | comment "$1"
  printf '✓ %s → blocked\n' "$1"
}

cmd_pr() {
  key_ok "$1"; need gh
  local branch title url
  branch="$(git branch --show-current)"
  [[ "$branch" == *"$1"* ]] || die "current branch '$branch' does not carry $1 — run: make issue-start KEY=$1"
  title="$(issue_field "$1" title)"
  git push -q -u origin "$branch"
  url="$(gh pr view --json url --jq .url 2>/dev/null || true)"
  if [ -z "$url" ]; then
    url="$(gh pr create --base "$BASE_BRANCH" --head "$branch" --title "$1: $title" --body "$(printf '## UniAI\n\nIssue: %s\n\n' "$1"; sed '1,/^## Thay đổi gì/d' .github/pull_request_template.md 2>/dev/null | sed '1s/^/## Thay đổi gì\n/')")"
  fi
  uniai issue status "$1" in_review >/dev/null
  printf 'PR: %s' "$url" | comment "$1"
  printf '✓ %s → in_review, PR %s\n' "$1" "$url"
}

cmd_done() {
  key_ok "$1"
  local sha; sha="$(git rev-parse --short "origin/$BASE_BRANCH" 2>/dev/null || git rev-parse --short HEAD)"
  uniai issue status "$1" done >/dev/null
  printf 'Merged vào %s (%s). DoD: docs/engineering/DEFINITION_OF_DONE.md đã tick trong PR.' "$BASE_BRANCH" "$sha" | comment "$1"
  printf '✓ %s → done. Nhớ cập nhật docs/roadmap/FEATURE_ROADMAP.md (CÓ + ngày) và plan → shipped.\n' "$1"
}

cmd_mine() {
  local me; me="$(my_member_id)"
  for st in in_progress in_review blocked todo; do
    uniai issue list --project "$PROJECT_ID" --assignee-id "$me" --status "$st" --output json --limit 100 | python3 -c "
import sys,json
d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get('issues',[])
for i in sorted(items,key=lambda x:x['number']): print(f\"{i['identifier']:9} {i['status']:12} {i['priority']:7} {(i.get('due_date') or '')[:10]:10} {i['title'][:70]}\")"
  done
}

cmd_new() {
  [ -n "${1:-}" ] || die "usage: new \"title\""
  uniai issue create --title "$1" --project "$PROJECT_ID" --status backlog --priority medium --output json | json "d['identifier']+' created (backlog). Đặt parent = epic giai đoạn và Roadmap ID trong mô tả.'"
}

case "${1:-}" in
  start) shift; cmd_start "$@";;
  sub)   shift; cmd_sub "$@";;
  note)  shift; cmd_note "$@";;
  block) shift; cmd_block "$@";;
  pr)    shift; cmd_pr "$@";;
  done)  shift; cmd_done "$@";;
  mine)  cmd_mine;;
  new)   shift; cmd_new "$@";;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1;;
esac
