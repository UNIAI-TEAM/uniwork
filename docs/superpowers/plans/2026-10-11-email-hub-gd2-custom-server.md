# Email Hub GĐ2 — máy chủ IMAP/SMTP tùy chỉnh và APPEND vào Sent (UNI-1238)

> **Trạng thái:** in-progress — plan GĐ2 của spec OAuth/máy chủ tùy chỉnh; thực thi bằng subagent-driven-development trên nhánh `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin`, xếp chồng trên GĐ1 (PR #220) (2026-10-11).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member connect a mailbox on their own IMAP/SMTP server: host, port and security for each side, an optional login username and one password. TLS is mandatory and every dial goes through the SSRF guard. A reconnect keeps the account id and wipes the cache only when the IMAP server changes. Sent mail is filed on the server with IMAP APPEND so it shows exactly once. Every mail-server failure is logged by a classified code, never by raw error text. On the web, a method step (Tên miền riêng / Mật khẩu ứng dụng) leads to a custom-server form, and reconnecting a custom account opens that form prefilled. GĐ2 ships no OAuth/XOAUTH2, no providers endpoint, no OAuth routes, no use-oauth-popup and no Google/Microsoft buttons; those are GĐ3.

**Architecture:**
- **Resolver.** A pure resolver, `resolveEmailHubServer(email, ConnectEmailHubInput)` in the new `server/internal/service/email_hub_connect_server.go`, turns the input into one `emailHubServer` value. With no server field it picks the preset for the domain. Otherwise it returns a validated, normalized custom server with provider `"custom"`.
- **Validation errors.** A validation failure is a `CodedError`: `email_hub_invalid_server` or `email_hub_host_not_allowed`, status 400, with `Fields{"field": <sdi json name>}`. The existing `mapServiceError` answers it with no new handler case.
- **Connect.** `Connect` keeps the GĐ1 order: membership → Enabled → resolve (no dial) → duplicate check → verify → save tx. The same `emailHubServer` feeds verify, the save, the duplicate check and the audit `server_changed` flag.
- **Server change.** After commit, a change of IMAP server does four things: it raises a per-node credential_version fence, stops the IDLE watcher, forgets the mailbox map, and wipes the cache under `gov.withIMAP`.
- **Stale writes.** `UpdateEmailHubAccountSyncState` becomes conditional on `credential_version`. Fenced snapshots skip the folder pass, the cache write and the reconcile prune.
- **Error logging and returns.** One classifier, `emailHubErrCode`, gives every log line a `code`. `redactEmailHubMailErr` cleans the errors that service methods return to handlers.
- **APPEND.** `smtpclient.Send` now returns the raw MIME it sent. For custom hosts that do not file Sent themselves, `sendOutboundMail` APPENDs that MIME to the SPECIAL-USE Sent folder and stores the APPENDUID as the row's UID.
- **Client core.** The core schema gains lenient server fields. `connectEmailHubAccount` takes an optional server.
- **Views.** A new `connect-custom-server-form.tsx` holds the form. `connect-account-dialog.tsx` gains the method step and opens the custom form for a reconnect when `provider === "custom"`. `email-hub-view.tsx` (496 counted lines) is not touched.
- **No new infrastructure.** No migration, route, audit action or outbox topic.

**Tech Stack:** Go (Chi, pgx, sqlc, go-imap v1.2.1, net/smtp, golang.org/x/net/idna), PostgreSQL, TypeScript (zod 4, TanStack Query), React (packages/views, Base UI primitives), vitest, i18next.

**Spec:** docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md

## Global Constraints

- Issue UNI-1238 (parent UNI-1236). Work only in the worktree `/Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237`, on branch `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin`. The branch is stacked on GĐ1 (PR #220, not merged). `prepare-commit-msg` adds the `Refs: UNI-1238` trailer: never type it, never strip it.
- Every commit uses a Conventional prefix (`feat|fix|test|refactor(email-hub)`, `docs`). The body gives the reason and what was left out. The last line is `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `--no-verify`.
- User instruction: do NOT run full local suites. That means no unfiltered `./internal/service` run, no `make check`, no `make test-go`. Run only the targeted commands each task lists; CI runs the full shards.
- Precedence: the spec wins over this plan, and this header wins over a task. GĐ1 code is the truth about the current state; the spec's §1.1 "hiện trạng" is not.
- Out of scope (GĐ3): XOAUTH2, AccessToken, refresh, the providers endpoint, OAuth start/callback, revoke, use-oauth-popup, Google/Microsoft buttons, and removing the planned `mail_oauth` settings card.
- No migration. The one query change goes through `make sqlc` and keeps `organization_id = $n` (`TestEveryQueryNamesItsTenant`).
- Membership is checked only through `s.workspace(ctx, actor, workspaceID)`, and always before validation or the Enabled() check. Handlers build only `service.Human`.
- No new audit action. GĐ2 only adds the metadata key `server_changed` to `email_hub_account.connected`, written in the same tx through `auditRecorder.Record`.
- Logs carry ids and classified codes only. Never email, host, username, a raw `err` from imapclient/smtpclient/netguard/net/tls, or a server reply.
- A blocked hostname answers `email_hub_unreachable`, so Connect gives no DNS oracle. Only an IP literal refused at validation answers `email_hub_host_not_allowed`.
- Hosts are normalized once: trim, strip one trailing dot, strip IPv6 brackets, lowercase, IDN→punycode via `golang.org/x/net/idna` (now a direct dependency). That one value is dialled, stored and compared.
- netguard does not change and has no bypass. Service tests never dial; they use testHookVerify, testHookInitialSync, testHookSMTPSend and the new testHookAppendSent.
- API compat: server enums stay `z.string()`. New optional fields use `.optional().catch(undefined)`. Every `switch` over a server value has a `default`. An endpoint change ships with a malformed-response test.
- packages/views:
  - Every JSX text goes through `t()`, with keys in both `en.json` and `vi.json` (voice per `docs/conventions.md`).
  - Files stay at ≤ 500 counted lines.
  - No `next/*`.
  - Primitives come from `@uniwork/ui`.
  - `packages/views/email-hub/email-hub-view.tsx` must not be edited.
- knip: no unused exports, and a new export needs a non-test consumer. knip is red on the Task 7 commit only (`connect-custom-server-form.tsx` is unused until Task 8 mounts it); Task 8 runs it green.
- Ruling (controller, 2026-10-11; spec §4.5). A `custom` account whose IMAP host is `imap.gmail.com` or `outlook.office365.com` (Workspace/M365 on its own domain) does NOT APPEND (`emailhub.ServerSavesSent`), because those servers file Sent themselves. Ruled: keep the skip — a second server copy would show Sent twice.
- Ruling (spec §6.3): error keys stay flat (`email_hub.connect.error_*`), because `api-error-copy.ts` and `compose-recipients.ts` read them. New keys are added in that layout.
- Ruling (spec §3 / §5.2 step 6): after a server change the server only stops the watcher (`hubWatch.forceStop`); the client re-subscribes after the accounts refetch, as the GĐ1 ruling does.
- Ruling: APPEND waits for the per-account IMAP lock (`withIMAP`, bounded by the request context) instead of `tryWithIMAP`. Skipping on a busy lock would leave a custom account with no server copy, and the next refresh prunes the local Sent row.
- Ruling: the GĐ2 PR targets `develop` (uniai-link and CLAUDE.md require it) and says it depends on PR #220 (GĐ1).
- Addition (spec §2.1): the `credential_version` guard on `UpdateEmailHubAccountSyncState`, plus the in-memory snapshot fence (Task 3).
- Kept literally from the spec:
  - §3: an ACTIVE account that changes only its SMTP settings or username answers 409.
  - §5.2: `app_password` 8–128 is documentation only.
  - §4.5: the Sent fallback on a custom server without SPECIAL-USE is `SENT`.

## Review Focus

- Host input edge cases (Task 1 `TestResolveEmailHubServerCustom`, `TestResolveEmailHubServerBlockedIPLiteral`; Task 2 `TestEmailHubConnectRefusesBadServerBeforeDialing`). Each must end in a canonical lowercase ASCII host, or in `invalid_server`/`host_not_allowed` with the right `fields.field` and zero verify calls. Inputs: `MAIL.Example.COM.`, `[2001:db8::1]`, `::ffff:10.0.0.1`, `fe80::1%eth0`, `169.254.169.254`, `host:993`, `imaps://…`, `mail..example.com`, IDN, 254 chars, `_dmarc…`, port 8080, only `smtp_host`. A change of case or a trailing dot alone is not a server change.
- Reconnect onto another IMAP server (Task 3 `TestEmailHubReconnectToAnotherServerDropsTheCache`, `TestEmailHubReconnectSameServerKeepsTheCache`, `TestEmailHubReconnectHostCaseChangeIsNotAServerChange`, `TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion`).
  - It keeps the account id, wipes the cache before the initial sync, and stops the watcher.
  - A stale-snapshot upsert, sync_state write or reconcile prune lands nothing.
  - A change of only SMTP or the username keeps the cache.
- Sent shows exactly once (Task 5).
  - With APPENDUID, the row takes that UID. With no UIDPLUS, the row keeps a placeholder UID and is adopted on the next sync. An APPENDUID above MaxInt32 keeps the placeholder.
  - Gmail/M365 hosts skip APPEND, and scheduled sends take the same path.
  - A failed APPEND is logged by code only and the send still succeeds.
- Error classification and redaction (Task 2 classifier row, Task 4 `TestEmailHubErrCode`, `TestRedactEmailHubMailErrKeepsSentinels`, `TestEmailHubSyncLogsCodeNotHost`).
  - `tls.RecordHeaderError` maps to `tls_required`. A certificate mismatch or DNS failure maps to `unreachable`.
  - No log line and no error returned to a handler contains the host.
- Client form (Task 6 malformed field test, Task 7 form tests, Task 8 dialog tests).
  - The password is not stripped. Server field errors land on their input with aria-invalid/aria-describedby.
  - One malformed field does not empty the account list.
  - The reconnect prefill never carries a password and copes with a missing or still-loading account.
  - The security choice autofills the port until the port is edited by hand.

## File Structure

| File | Task | Change |
| --- | --- | --- |
| `server/internal/service/email_hub_connect_server.go` | 1 | NEW: `emailHubServer`, `resolveEmailHubServer`, `resolveEmailHubEndpoint`, `normalizeEmailHubHost`, the two sentinels, `emailHubServerFieldError` |
| `server/internal/service/email_hub_connect_server_test.go` | 1 | NEW: pure resolver and normalization tests |
| `server/go.mod` | 1 | `golang.org/x/net` becomes a direct dependency |
| `server/internal/service/email_hub_connect.go` | 1, 2, 3, 4 | Input fields; Connect wired to the resolver; save returns `serverChanged`; classifier learns `RecordHeaderError`; `resetEmailHubServerCache`; `emailHubErrCode`, `redactEmailHubMailErr` |
| `server/internal/service/email_hub_connect_test.go` | 2 | Custom connect, validation before dial, duplicate, server-change audit tests |
| `server/internal/service/email_hub.go` | 2, 4, 5 | View server fields; code logs; redacted Sync; hook types; APPEND in `sendOutboundMail` |
| `server/internal/handler/dto/sdi/email_hub.go`, `dto/sdo/email_hub.go` | 2 | Server fields + username |
| `server/internal/handler/email_hub.go`, `email_hub_test.go`, `email_hub_sdo_test.go` | 2 | Pass-through, mapping, 400 field test, SDO test |
| `server/internal/handler/router/email_hub.go` | 2 | Tag comment and connect description |
| `server/pkg/db/queries/email_hub.sql`, `server/pkg/db/generated/email_hub.sql.go` | 3 | `UpdateEmailHubAccountSyncState` guarded by `credential_version` |
| `server/internal/service/email_hub_governor.go`, `email_hub_governor_test.go` | 3 | `forgetMailboxes`, `fenceSnapshots`, `staleSnapshot` |
| `server/internal/service/email_hub_sync.go` | 3, 4 | Version on every sync_state write; `staleEmailHubSnapshot` fence; code logs; redacted WatchInbox |
| `server/internal/service/email_hub_account_queries_test.go`, `email_hub_server_change_test.go` (NEW) | 3 | Guard and server-change tests |
| `server/internal/service/email_hub_watcher.go`, `email_hub_folders.go`, `email_hub_body.go`, `email_hub_search.go`, `email_hub_attachments.go` | 4 | Code logs; redacted returns |
| `server/internal/service/email_hub_logging_test.go` | 4 | NEW |
| `server/internal/emailhub/smtpclient/send.go` (+ tests) | 5 | `Send` returns the raw MIME |
| `server/internal/emailhub/imapclient/session.go`, `append_test.go` (NEW), `fake_server_test.go` | 5 | `Session.Append` with APPENDUID; fake APPEND |
| `server/internal/emailhub/provider.go` (+ test) | 5 | `ServerSavesSent` |
| `server/internal/service/email_hub_sent_append.go` (NEW), `email_hub_sent_append_test.go` (NEW), `email_hub_needs_reconnect_test.go` | 5 | `appendSentCopy`; tests; new hook shape |
| `packages/core/types/email-hub.ts`, `api/endpoints/email-hub.ts` (+ test), `email-hub/hooks.ts` | 6 | Lenient server fields, `EmailHubCustomServer`, connect with a server |
| `packages/views/email-hub/connect-account-errors.ts` | 7 | NEW: `connectError(err)` with field mapping |
| `packages/views/email-hub/connect-custom-server-form.tsx` (+ test) | 7 | NEW form |
| `packages/views/email-hub/connect-account-dialog.tsx` (+ test) | 7, 8 | Shared error mapping; method step; custom reconnect |
| `packages/views/email-hub/use-email-hub-account-panel.ts`, `packages/views/settings/components/integrations-tab.tsx` | 8 | Comments only |
| `packages/core/i18n/locales/en.json`, `vi.json` | 7, 8 | Custom/method/error keys; App-Password copy rewritten |
| `docs/ops/RUNBOOK_EMAIL_HUB.md`, spec, this plan | 9 | Runbook, status lines |

---

### Task 1: Custom server resolver and validation (pure)

**Files:**
- Create: `server/internal/service/email_hub_connect_server.go`
- Modify: `server/internal/service/email_hub_connect.go:28-31`. `ConnectEmailHubInput` gains the server fields. Nothing else in the file changes; Task 2 wires `Connect`.
- Modify: `server/go.mod`. `golang.org/x/net v0.60.0` moves from the `// indirect` block (line 162) into the direct block through `go mod tidy`. `go.sum` stays the same.
- Test: `server/internal/service/email_hub_connect_server_test.go` (pure, no DB)

Nothing calls the resolver yet; staticcheck's U1000 counts test usage. The handler needs no change. `connectEmailHubAccount` (`server/internal/handler/email_hub.go:86-101`) sends any error it does not match to `h.mapServiceError`, which answers a `CodedError` with `respondErrorFields(w, ce.Status, ce.Code, ce.Msg, ce.Fields)` (`server/internal/handler/auth.go:148-154`). The client gets `400 {"error":{"code":"email_hub_invalid_server","fields":{"field":"imap_port"}}}`.

**Interfaces:**
- Consumes:
  - `emailhub.ProviderForEmail(email string) (emailhub.Provider, bool)` and `emailhub.Provider{Name, IMAPHost, IMAPPort, SMTPHost, SMTPPort}`
  - `netguard.AllowedPort(int) bool` (true only for 25/143/465/587/993)
  - `netguard.AllowedIP(netip.Addr) bool`
  - `CodedError{Code, Status, Msg, Err, Fields}` (`errors.go:93`; `Unwrap` returns `Err`)
  - `ValidationError`, `Invalid(msg)` (`errors.go:85`, `:89`)
  - `ErrEmailHubUnsupported`
  - `idna.Lookup.ToASCII`
- Produces (package `service`):
  - `ConnectEmailHubInput` gains `IMAPHost string; IMAPPort int; IMAPSecurity string; SMTPHost string; SMTPPort int; SMTPSecurity string; Username string`.
  - `type emailHubServer struct { Provider, IMAPHost string; IMAPPort int; IMAPSecurity, SMTPHost string; SMTPPort int; SMTPSecurity, Username string }`. It is comparable with `==`.
    - A preset yields `IMAPSecurity "tls"`, `SMTPSecurity "starttls"`, `Username ""`, and `Provider` set to the preset name.
    - A custom server yields `Provider "custom"`.
  - `func resolveEmailHubServer(email string, in ConnectEmailHubInput) (emailHubServer, error)`. `email` arrives already trimmed and lowercased. The checks run in this order:
    1. The address must be bare: `net/mail.ParseAddress` succeeds, the parsed address equals the input, and there is no CR/LF. Otherwise it returns `Invalid("invalid email address")`.
    2. All seven server fields zero → the preset for the domain, or `ErrEmailHubUnsupported`.
    3. Otherwise each field is checked in form order (`imap_host`, `imap_port`, `imap_security`, `smtp_host`, `smtp_port`, `smtp_security`, `username`), and the first failure is returned.
  - `func normalizeEmailHubHost(raw string) (string, bool)`
  - `var ErrEmailHubInvalidServer`, `var ErrEmailHubHostNotAllowed`
  - `func emailHubServerFieldError(sentinel error, field string) error` returns `CodedError{Code: "email_hub_invalid_server"|"email_hub_host_not_allowed", Status: 400, Msg: sentinel.Error(), Fields: {"field": field}, Err: sentinel}`. `field` is the SDI JSON name. The message never names the host.

- [ ] **Step 1: Write the failing test**

Create `server/internal/service/email_hub_connect_server_test.go`:

```go
package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

// customEmailHubInput is a valid custom-server request each case bends.
func customEmailHubInput() ConnectEmailHubInput {
	return ConnectEmailHubInput{
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 465, SMTPSecurity: "tls",
	}
}

func wantEmailHubServerErr(t *testing.T, err error, sentinel error, field, host string) {
	t.Helper()
	var ce CodedError
	if !errors.Is(err, sentinel) || !errors.As(err, &ce) || ce.Status != http.StatusBadRequest || ce.Fields["field"] != field {
		t.Fatalf("want %v on field %s, got %#v", sentinel, field, err)
	}
	if h := strings.TrimSpace(host); h != "" && strings.Contains(err.Error(), h) {
		t.Fatalf("error text names the host: %q", err.Error())
	}
}

func TestResolveEmailHubServerPreset(t *testing.T) {
	got, err := resolveEmailHubServer("user@gmail.com", ConnectEmailHubInput{})
	want := emailHubServer{
		Provider: "gmail", IMAPHost: "imap.gmail.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "smtp.gmail.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}
	if err != nil || got != want {
		t.Fatalf("gmail preset: got %+v, %v", got, err)
	}
	if _, err := resolveEmailHubServer("user@unknown.example", ConnectEmailHubInput{}); !errors.Is(err, ErrEmailHubUnsupported) {
		t.Fatalf("unknown domain without a server: want ErrEmailHubUnsupported, got %v", err)
	}
	// A login name alone is a custom request, not a silently ignored field.
	_, err = resolveEmailHubServer("user@gmail.com", ConnectEmailHubInput{Username: "ops"})
	wantEmailHubServerErr(t, err, ErrEmailHubInvalidServer, "imap_host", "")
}

func TestResolveEmailHubServerCustom(t *testing.T) {
	got, err := resolveEmailHubServer("me@example.com", ConnectEmailHubInput{
		IMAPHost: " MAIL.Example.COM. ", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "Smtp.Example.com", SMTPPort: 587, SMTPSecurity: "starttls", Username: " ops-login ",
	})
	want := emailHubServer{
		Provider: "custom", IMAPHost: "mail.example.com", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "smtp.example.com", SMTPPort: 587, SMTPSecurity: "starttls", Username: "ops-login",
	}
	if err != nil || got != want {
		t.Fatalf("custom: got %+v, %v", got, err)
	}

	hosts := []struct{ raw, want string }{
		{"mail.example.com", "mail.example.com"},
		{"[2606:4700::1111]", "2606:4700::1111"},
		{"2606:4700::1111", "2606:4700::1111"},
		{"::ffff:8.8.8.8", "8.8.8.8"},
		{"Bücher.example", "xn--bcher-kva.example"},
		{"xn--bcher-kva.example", "xn--bcher-kva.example"},
		{strings.Repeat("a", 63) + ".example.com", strings.Repeat("a", 63) + ".example.com"},
	}
	for _, h := range hosts {
		in := customEmailHubInput()
		in.IMAPHost = h.raw
		got, err := resolveEmailHubServer("me@example.com", in)
		if err != nil || got.IMAPHost != h.want {
			t.Errorf("host %q: got %q, %v; want %q", h.raw, got.IMAPHost, err, h.want)
		}
	}
	// A case-only or trailing-dot edit is the same server: Task 3 wipes the
	// cache on a server change.
	a, _ := normalizeEmailHubHost("MAIL.Example.COM.")
	b, _ := normalizeEmailHubHost("mail.example.com")
	if a != b {
		t.Fatalf("normalization differs: %q vs %q", a, b)
	}

	bad := []struct {
		name  string
		edit  func(*ConnectEmailHubInput)
		field string
		host  string
	}{
		{"host with port", func(in *ConnectEmailHubInput) { in.IMAPHost = "mail.example.com:993" }, "imap_host", "mail.example.com:993"},
		{"scheme", func(in *ConnectEmailHubInput) { in.IMAPHost = "imaps://mail.example.com" }, "imap_host", "imaps://mail.example.com"},
		{"path", func(in *ConnectEmailHubInput) { in.SMTPHost = "a/b" }, "smtp_host", "a/b"},
		{"userinfo", func(in *ConnectEmailHubInput) { in.IMAPHost = "me@mail.example.com" }, "imap_host", "me@mail.example.com"},
		{"empty label", func(in *ConnectEmailHubInput) { in.IMAPHost = "mail..example.com" }, "imap_host", "mail..example.com"},
		{"leading hyphen", func(in *ConnectEmailHubInput) { in.SMTPHost = "-bad.example.com" }, "smtp_host", "-bad.example.com"},
		{"underscore", func(in *ConnectEmailHubInput) { in.IMAPHost = "_dmarc.example.com" }, "imap_host", "_dmarc.example.com"},
		{"254 chars", func(in *ConnectEmailHubInput) { in.IMAPHost = strings.Repeat("a.", 126) + "ab" }, "imap_host", ""},
		{"64-char label", func(in *ConnectEmailHubInput) { in.IMAPHost = strings.Repeat("a", 64) + ".example.com" }, "imap_host", ""},
		{"numeric shorthand", func(in *ConnectEmailHubInput) { in.IMAPHost = "127.1" }, "imap_host", "127.1"},
		{"decimal address", func(in *ConnectEmailHubInput) { in.SMTPHost = "2130706433" }, "smtp_host", "2130706433"},
		{"bracketed v4", func(in *ConnectEmailHubInput) { in.IMAPHost = "[8.8.8.8]" }, "imap_host", "8.8.8.8"},
		{"blank host", func(in *ConnectEmailHubInput) { in.IMAPHost = "  " }, "imap_host", ""},
		{"only smtp host", func(in *ConnectEmailHubInput) {
			*in = ConnectEmailHubInput{SMTPHost: "mail.example.com"}
		}, "imap_host", ""},
		{"port 8080", func(in *ConnectEmailHubInput) { in.IMAPPort = 8080 }, "imap_port", ""},
		{"port missing", func(in *ConnectEmailHubInput) { in.IMAPPort = 0 }, "imap_port", ""},
		{"smtp port 2525", func(in *ConnectEmailHubInput) { in.SMTPPort = 2525 }, "smtp_port", ""},
		{"security ssl", func(in *ConnectEmailHubInput) { in.SMTPSecurity = "ssl" }, "smtp_security", ""},
		{"security missing", func(in *ConnectEmailHubInput) { in.IMAPSecurity = "" }, "imap_security", ""},
		{"username 321", func(in *ConnectEmailHubInput) { in.Username = strings.Repeat("u", 321) }, "username", ""},
		{"username CR", func(in *ConnectEmailHubInput) { in.Username = "ops\rRCPT" }, "username", ""},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			in := customEmailHubInput()
			c.edit(&in)
			_, err := resolveEmailHubServer("me@example.com", in)
			wantEmailHubServerErr(t, err, ErrEmailHubInvalidServer, c.field, c.host)
		})
	}
}

func TestResolveEmailHubServerBlockedIPLiteral(t *testing.T) {
	for _, host := range []string{
		"127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "[::1]", "::ffff:10.0.0.1", "fe80::1%eth0",
	} {
		in := customEmailHubInput()
		in.IMAPHost = host
		_, err := resolveEmailHubServer("me@example.com", in)
		wantEmailHubServerErr(t, err, ErrEmailHubHostNotAllowed, "imap_host", host)
	}
	in := customEmailHubInput()
	in.SMTPHost = "192.168.1.10"
	_, err := resolveEmailHubServer("me@example.com", in)
	wantEmailHubServerErr(t, err, ErrEmailHubHostNotAllowed, "smtp_host", "192.168.1.10")

	in = customEmailHubInput()
	in.IMAPHost = "8.8.8.8"
	if got, err := resolveEmailHubServer("me@example.com", in); err != nil || got.IMAPHost != "8.8.8.8" {
		t.Fatalf("public IPv4 literal: got %+v, %v", got, err)
	}
}

func TestResolveEmailHubServerRejectsHeaderInjectionAddress(t *testing.T) {
	for _, email := range []string{
		"a\r\nbcc: x@evil.test@gmail.com", "not-an-address", "bob <bob@gmail.com>", "",
	} {
		for _, in := range []ConnectEmailHubInput{{}, customEmailHubInput()} {
			var ve ValidationError
			if _, err := resolveEmailHubServer(email, in); !errors.As(err, &ve) {
				t.Fatalf("address %q: want ValidationError, got %v", email, err)
			}
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestResolveEmailHubServer'
```

Expected: the build fails with `unknown field IMAPHost in struct literal of type ConnectEmailHubInput`, along with `undefined: resolveEmailHubServer`, `emailHubServer`, `normalizeEmailHubHost`, `ErrEmailHubInvalidServer` and `ErrEmailHubHostNotAllowed`.

- [ ] **Step 3: Minimal implementation**

3a. In `server/internal/service/email_hub_connect.go`, replace lines 28-31 with:

```go
type ConnectEmailHubInput struct {
	EmailAddress string
	AppPassword  string
	// Server fields name a custom IMAP/SMTP server (spec §5.2); all zero
	// means the preset for the address domain.
	IMAPHost     string
	IMAPPort     int
	IMAPSecurity string
	SMTPHost     string
	SMTPPort     int
	SMTPSecurity string
	Username     string
}
```

3b. Create `server/internal/service/email_hub_connect_server.go`:

```go
package service

import (
	"errors"
	"net/http"
	netmail "net/mail"
	"net/netip"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

var (
	ErrEmailHubInvalidServer  = errors.New("invalid mail server settings")
	ErrEmailHubHostNotAllowed = errors.New("mail server address not allowed")
)

// emailHubServer is the one resolved server a connect verifies, stores and
// compares against the existing row. Hosts are already normalized.
type emailHubServer struct {
	Provider     string
	IMAPHost     string
	IMAPPort     int
	IMAPSecurity string
	SMTPHost     string
	SMTPPort     int
	SMTPSecurity string
	Username     string
}

// resolveEmailHubServer turns a connect request into one server without
// dialling (spec §5.2 step 2). email is the trimmed, lowercased address. With
// no server field the preset for the domain applies; with any server field all
// six are required and the provider is "custom".
func resolveEmailHubServer(email string, in ConnectEmailHubInput) (emailHubServer, error) {
	if a, err := netmail.ParseAddress(email); err != nil || a.Address != email || strings.ContainsAny(email, "\r\n") {
		return emailHubServer{}, Invalid("invalid email address")
	}
	if in.IMAPHost == "" && in.IMAPPort == 0 && in.IMAPSecurity == "" &&
		in.SMTPHost == "" && in.SMTPPort == 0 && in.SMTPSecurity == "" && in.Username == "" {
		prov, ok := emailhub.ProviderForEmail(email)
		if !ok {
			return emailHubServer{}, ErrEmailHubUnsupported
		}
		return emailHubServer{
			Provider: prov.Name, IMAPHost: prov.IMAPHost, IMAPPort: prov.IMAPPort, IMAPSecurity: "tls",
			SMTPHost: prov.SMTPHost, SMTPPort: prov.SMTPPort, SMTPSecurity: "starttls",
		}, nil
	}
	imapHost, err := resolveEmailHubEndpoint("imap", in.IMAPHost, in.IMAPPort, in.IMAPSecurity)
	if err != nil {
		return emailHubServer{}, err
	}
	smtpHost, err := resolveEmailHubEndpoint("smtp", in.SMTPHost, in.SMTPPort, in.SMTPSecurity)
	if err != nil {
		return emailHubServer{}, err
	}
	username := strings.TrimSpace(in.Username)
	if utf8.RuneCountInString(username) > 320 || strings.IndexFunc(username, unicode.IsControl) >= 0 {
		return emailHubServer{}, emailHubServerFieldError(ErrEmailHubInvalidServer, "username")
	}
	return emailHubServer{
		Provider: "custom", IMAPHost: imapHost, IMAPPort: in.IMAPPort, IMAPSecurity: in.IMAPSecurity,
		SMTPHost: smtpHost, SMTPPort: in.SMTPPort, SMTPSecurity: in.SMTPSecurity, Username: username,
	}, nil
}

// resolveEmailHubEndpoint checks one side (prefix "imap" or "smtp") in form
// order and returns its normalized host. Only an IP literal is judged against
// netguard here; a hostname is judged on the IP it resolves to at dial time.
func resolveEmailHubEndpoint(prefix, rawHost string, port int, security string) (string, error) {
	host, ok := normalizeEmailHubHost(rawHost)
	if !ok {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_host")
	}
	if ip, err := netip.ParseAddr(host); err == nil && !netguard.AllowedIP(ip) {
		return "", emailHubServerFieldError(ErrEmailHubHostNotAllowed, prefix+"_host")
	}
	if !netguard.AllowedPort(port) {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_port")
	}
	if security != "tls" && security != "starttls" {
		return "", emailHubServerFieldError(ErrEmailHubInvalidServer, prefix+"_security")
	}
	return host, nil
}

// normalizeEmailHubHost returns the one spelling of a host that is dialled,
// stored and compared, so a case or trailing-dot change is never a server
// change. It accepts a hostname (IDN becomes punycode) or an IP literal
// (IPv6 optionally in brackets); anything with a scheme, port, path or
// userinfo is refused.
func normalizeEmailHubHost(raw string) (string, bool) {
	h := strings.TrimSpace(raw)
	if strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]") {
		ip, err := netip.ParseAddr(h[1 : len(h)-1])
		if err != nil || !ip.Is6() {
			return "", false
		}
		return ip.WithZone("").Unmap().String(), true
	}
	h = strings.TrimSuffix(h, ".")
	if ip, err := netip.ParseAddr(h); err == nil {
		return ip.WithZone("").Unmap().String(), true
	}
	h, err := idna.Lookup.ToASCII(strings.ToLower(h))
	if err != nil || h == "" || len(h) > 253 {
		return "", false
	}
	labels := strings.Split(h, ".")
	for _, l := range labels {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' ||
			strings.Trim(l, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
			return "", false
		}
	}
	// An all-digit last label is no TLD but an IPv4 shorthand (127.1,
	// 2130706433) that some resolvers would turn into an address.
	if strings.Trim(labels[len(labels)-1], "0123456789") == "" {
		return "", false
	}
	return h, true
}

// emailHubServerFieldError is the 400 the client shows next to field (an SDI
// JSON name). The message never names the host: it reaches the client and
// the log.
func emailHubServerFieldError(sentinel error, field string) error {
	code := "email_hub_invalid_server"
	if errors.Is(sentinel, ErrEmailHubHostNotAllowed) {
		code = "email_hub_host_not_allowed"
	}
	return CodedError{
		Code: code, Status: http.StatusBadRequest, Msg: sentinel.Error(),
		Fields: map[string]any{"field": field}, Err: sentinel,
	}
}
```

Design notes. The controller may veto any of these.
- A zoned address (`fe80::1%eth0`) loses its zone before the netguard check. A public IPv6 address with a zone is stored without it.
- `::ffff:a.b.c.d` is stored unmapped, so the mapped and plain spellings compare equal.
- A bracketed IPv4 is invalid, because brackets are for IPv6 only.
- Security must be exactly `tls` or `starttls`.
- `username` is trimmed but keeps its case, because IMAP logins can be case-sensitive. Its length is counted in runes, to match the SDI `maxLength`.
- A `Username` with no host is a custom request: it answers invalid_server with field `imap_host`.
- A hostname that resolves to a blocked IP is not judged here. netguard refuses it at dial time, and Connect answers `email_hub_unreachable`.

3c. Make `golang.org/x/net` a direct dependency:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go mod tidy && git diff --stat go.mod go.sum
```

Expected: only `go.mod` changes. The `golang.org/x/net` line moves into the direct block.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/service/ && go vet ./internal/service/ && go tool staticcheck ./internal/service/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestResolveEmailHubServer|TestEmailHubConnectValidation'
```

Expected: `gofmt -l` prints nothing, and vet and staticcheck are clean. The run ends `ok`. `TestEmailHubConnectValidation` still passes because `Connect` is untouched.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/internal/service/email_hub_connect_server.go server/internal/service/email_hub_connect_server_test.go server/internal/service/email_hub_connect.go server/go.mod
git commit -m "feat(email-hub): resolve and validate a custom IMAP/SMTP server before any dial" -m "A connect request now resolves to one server value: the domain preset when no server field is sent, otherwise six required fields with one normalized host spelling (trim, trailing dot, brackets, lowercase, IDN to punycode), a netguard port, tls|starttls, and an optional login name of at most 320 characters with no control characters. A blocked IP literal answers email_hub_host_not_allowed and every other bad field answers email_hub_invalid_server, both 400 with fields.field set to the SDI name and no host in the text. The address must parse as a bare address, so CR/LF cannot reach an SMTP header. golang.org/x/net becomes a direct dependency for idna. Left out: wiring Connect (next task); hostnames that resolve to blocked IPs stay netguard's job at dial time." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Connect with a custom server, SDI/SDO server fields, handler mapping

**Files:**
- Modify: `server/internal/service/email_hub_connect.go`. The changes are to `Connect` (lines 33-96), `saveEmailHubConnection` (lines 108-167) and `classifyEmailHubConnectError` (lines 177-199). Also drop the `emailhub` import, which `go build` reports unused once `ProviderForEmail` moves into the resolver.
- Modify: `server/internal/service/email_hub.go`. The changes are to `EmailHubAccountView` (lines 74-83) and `accountView` (lines 707-713).
- Modify: `server/internal/handler/dto/sdi/email_hub.go`, `server/internal/handler/dto/sdo/email_hub.go`
- Modify: `server/internal/handler/email_hub.go`. The changes are to `connectEmailHubAccount` (lines 78-106) and `toEmailHubAccountSDO` (lines 476-486).
- Modify: `server/internal/handler/router/email_hub.go`. Replace the tag comment (line 10) and the description of the connect apiOp (lines 47-56).
- Test: `server/internal/service/email_hub_connect_test.go`. Append helpers and four tests, and add one classifier row after the `"smtp tls"` row (line 241).
- Test: `server/internal/handler/email_hub_test.go` (append one test) and `server/internal/handler/email_hub_sdo_test.go` (append one pure test, add the `encoding/json` import)

**Interfaces:**
- Consumes:
  - Task 1: `ConnectEmailHubInput` server fields, `emailHubServer`, `resolveEmailHubServer`, `ErrEmailHubInvalidServer`, `ErrEmailHubHostNotAllowed`.
  - GĐ1:
    - `sameEmailHubConnection(acc, authKind, imapHost string, imapPort int) bool`
    - `verifyEmailHubLogin`, `classifyEmailHubConnectError`
    - `db.UpdateEmailHubAccountCredentialsParams`, `db.CreateEmailHubAccountParams`, `db.MarkEmailHubAccountAuthFailed`
    - `imapclient.Credentials` / `smtpclient.Credentials{Host, Port, Email, Username, Password, Security}`
    - Test helpers: `stubEmailHubDial`, `connectedAudit`, `emailHubFixture`, `svc.openPassword`; in the handler package `setupEmailHubHTTP`, `doJSON`, `errorCode`.
- Produces:
  - `func (s *EmailHubService) saveEmailHubConnection(ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams, srv emailHubServer, passwordEnc string) (db.EmailHubAccount, bool, error)`. The bool is `serverChanged`: true only when the row re-read `FOR UPDATE` has a different `imap_host` (compared with `EqualFold`) or `imap_port`. A fresh insert gives false.
  - `email_hub_account.connected` metadata keys: `auth_kind`, `provider`, `reconnected`, `server_changed`.
  - `EmailHubAccountView` gains `ImapHost string; ImapPort int; ImapSecurity string; SmtpHost string; SmtpPort int; SmtpSecurity string; Username string`.
  - `sdi.ConnectEmailHubAccountSDI` gains these optional fields: `imap_host`, `imap_port`, `imap_security` (enum tls,starttls), the same three for SMTP, and `username` (maxLength 320).
  - `sdo.EmailHubAccountSDO` gains `imap_host`, `imap_port` (number), `imap_security`, `smtp_host`, `smtp_port` (number), `smtp_security`, `username`. It never carries a password.
  - The classifier maps `tls.RecordHeaderError` (value type) to `"tls_required"` / `ErrEmailHubTLSRequired`.
  - A custom server's password is used exactly as typed. A preset password is still trimmed.
  - Test helpers used by Tasks 3 and 5:
    - `customConnectInput(email string) ConnectEmailHubInput`
    - `seedCustomEmailHubAccount(t, q, box, userID, orgID, email, imapHost string) db.EmailHubAccount`
    - `connectedServerChanged(t, pool, accountID) string`

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/service/email_hub_connect_test.go`. If goimports reports a missing import (`secretbox`, `pgxpool`, `audit`, `base64`), add it.

```go
// customConnectInput is a complete custom-server connect on mail.example.com;
// tests change one field at a time.
func customConnectInput(email string) ConnectEmailHubInput {
	return ConnectEmailHubInput{
		EmailAddress: email, AppPassword: "server-password-1",
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}
}

// seedCustomEmailHubAccount stores a live password mailbox on imapHost:993,
// the row a custom Connect would produce.
func seedCustomEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email, imapHost string) db.EmailHubAccount {
	t.Helper()
	sealed, err := box.Seal([]byte("old-server-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: email, Provider: "custom",
		ImapHost: imapHost, ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: imapHost, SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// connectedServerChanged reads the server_changed flag of an account's
// connected audit row.
func connectedServerChanged(t *testing.T, pool *pgxpool.Pool, accountID string) string {
	t.Helper()
	var changed string
	if err := pool.QueryRow(context.Background(), `SELECT coalesce(max(metadata::jsonb->>'server_changed'), '')
		FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountConnected, accountID).Scan(&changed); err != nil {
		t.Fatal(err)
	}
	return changed
}

// The login check, the row and the view all carry the normalized server; the
// password of a custom server is used as typed (spec §5.2).
func TestEmailHubConnectCustomServerStoresItsSettings(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	stubEmailHubDial(svc, nil)
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "Me@Acme.Example", AppPassword: " pass word ",
		IMAPHost: " Mail.Acme.EXAMPLE. ", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "SMTP.acme.example", SMTPPort: 465, SMTPSecurity: "tls",
		Username: "mailuser",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantIMAP := imapclient.Credentials{Host: "mail.acme.example", Port: 143, Email: "me@acme.example", Username: "mailuser", Password: " pass word ", Security: "starttls"}
	wantSMTP := smtpclient.Credentials{Host: "smtp.acme.example", Port: 465, Email: "me@acme.example", Username: "mailuser", Password: " pass word ", Security: "tls"}
	if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
		t.Fatalf("verify got imap=%+v smtp=%+v", gotIMAP, gotSMTP)
	}
	row, err := q.GetEmailHubAccountByID(ctx, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Provider != "custom" || row.AuthKind != "password" ||
		row.ImapHost != "mail.acme.example" || row.ImapPort != 143 || row.ImapSecurity != "starttls" ||
		row.SmtpHost != "smtp.acme.example" || row.SmtpPort != 465 || row.SmtpSecurity != "tls" ||
		row.Username != "mailuser" {
		t.Fatalf("stored row: %+v", row)
	}
	if pw, err := svc.openPassword(row.PasswordEnc); err != nil || pw != " pass word " {
		t.Fatalf("stored password=%q err=%v", pw, err)
	}
	if view.Provider != "custom" || view.ImapHost != "mail.acme.example" || view.ImapPort != 143 ||
		view.ImapSecurity != "starttls" || view.SmtpHost != "smtp.acme.example" || view.SmtpPort != 465 ||
		view.SmtpSecurity != "tls" || view.Username != "mailuser" {
		t.Fatalf("view: %+v", view)
	}
	if n, _, reconnected := connectedAudit(t, pool, view.ID); n != 1 || reconnected != "false" {
		t.Fatalf("connected audit: n=%d reconnected=%q", n, reconnected)
	}
	if changed := connectedServerChanged(t, pool, view.ID); changed != "false" {
		t.Fatalf("a first connect changes no server, server_changed=%q", changed)
	}
}

// Membership answers first; a bad server field is refused with the field the
// client marks, before any login and without writing a row (spec §5.2 steps 1-2).
func TestEmailHubConnectRefusesBadServerBeforeDialing(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	calls := stubEmailHubDial(svc, nil)
	badPort := customConnectInput("bad@acme.example")
	badPort.IMAPPort = 8080
	blocked := customConnectInput("bad@acme.example")
	blocked.IMAPHost = "169.254.169.254"

	if _, err := svc.Connect(ctx, Human(util.NewID()), ws.ID, badPort); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member must get the membership answer before validation, got %v", err)
	}
	cases := []struct {
		name     string
		in       ConnectEmailHubInput
		sentinel error
		code     string
		field    string
	}{
		{"port outside the allowed set", badPort, ErrEmailHubInvalidServer, "email_hub_invalid_server", "imap_port"},
		{"blocked ip literal", blocked, ErrEmailHubHostNotAllowed, "email_hub_host_not_allowed", "imap_host"},
	}
	for _, tc := range cases {
		_, err := svc.Connect(ctx, Human(user.ID), ws.ID, tc.in)
		var ce CodedError
		if !errors.As(err, &ce) || !errors.Is(err, tc.sentinel) || ce.Code != tc.code || ce.Status != 400 || ce.Fields["field"] != tc.field {
			t.Errorf("%s: got %#v", tc.name, err)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a refused server must never reach the login check, verify ran %d times", n)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1`, user.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a refused connect writes no row, rows=%d err=%v", rows, err)
	}
}

// A live custom mailbox on the same IMAP server is a duplicate whatever the
// host's case, a trailing dot or the SMTP side say (spec §3).
func TestEmailHubConnectCustomDuplicateIs409(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "dup@acme.example", "mail.example.com")
	calls := stubEmailHubDial(svc, nil)
	sameHost := customConnectInput("DUP@acme.example")
	sameHost.IMAPHost = "MAIL.Example.com."
	otherSMTP := customConnectInput("dup@acme.example")
	otherSMTP.SMTPHost, otherSMTP.SMTPPort, otherSMTP.SMTPSecurity = "smtp.other.example", 465, "tls"

	for name, in := range map[string]ConnectEmailHubInput{"case and trailing dot": sameHost, "smtp only": otherSMTP} {
		if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, in); !errors.Is(err, ErrEmailHubAlreadyConnected) {
			t.Errorf("%s: expected already connected, got %v", name, err)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
}

// Reconnecting onto another IMAP server keeps the id and says so in the audit;
// the same server spelled differently is not a change (it would wipe the cache).
func TestEmailHubReconnectChangedServerFlagsIt(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	moved := seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "moved@acme.example", "mail.example.com")
	same := seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "same@acme.example", "mail.example.com")
	for _, acc := range []db.EmailHubAccount{moved, same} {
		if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
		}); err != nil || n != 1 {
			t.Fatalf("mark auth failed: n=%d err=%v", n, err)
		}
	}
	stubEmailHubDial(svc, nil)
	toNewHost := customConnectInput("moved@acme.example")
	toNewHost.IMAPHost = "imap.newhost.example"
	toNewHost.Username = "ops"
	sameHost := customConnectInput("same@acme.example")
	sameHost.IMAPHost = "Mail.Example.COM."

	cases := []struct {
		acc      db.EmailHubAccount
		in       ConnectEmailHubInput
		wantHost string
		changed  string
	}{
		{moved, toNewHost, "imap.newhost.example", "true"},
		{same, sameHost, "mail.example.com", "false"},
	}
	for _, tc := range cases {
		view, err := svc.Connect(ctx, Human(user.ID), ws.ID, tc.in)
		if err != nil {
			t.Fatal(err)
		}
		if view.ID != tc.acc.ID || view.ImapHost != tc.wantHost || view.NeedsReconnect {
			t.Errorf("%s: reconnect must keep id %s on %s, got %+v", tc.acc.EmailAddress, tc.acc.ID, tc.wantHost, view)
		}
		if n, _, reconnected := connectedAudit(t, pool, tc.acc.ID); n != 1 || reconnected != "true" {
			t.Errorf("%s: connected audit n=%d reconnected=%q", tc.acc.EmailAddress, n, reconnected)
		}
		if got := connectedServerChanged(t, pool, tc.acc.ID); got != tc.changed {
			t.Errorf("%s: server_changed=%q, want %q", tc.acc.EmailAddress, got, tc.changed)
		}
	}
	// UpdateEmailHubAccountCredentials persists the login name and auth kind (GĐ1 deferred minor).
	row, err := q.GetEmailHubAccountByID(ctx, moved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Username != "ops" || row.AuthKind != "password" || row.Provider != "custom" {
		t.Fatalf("reconnect row: username=%q auth_kind=%q provider=%q", row.Username, row.AuthKind, row.Provider)
	}
}
```

Then add one row to the `cases` table of `TestEmailHubConnectClassifiesVerifyErrorsWithoutLeakingTheHost`, right after the `"smtp tls"` row. crypto/tls returns `RecordHeaderError` by value:

```go
		{"tls to a plaintext greeter", fmt.Errorf("imap greeting %s: %w", host, tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}), ErrEmailHubTLSRequired},
```

Append to `server/internal/handler/email_hub_test.go`:

```go
// Server fields are checked before any dial, and the refusal names the field
// the client marks (spec §5.2).
func TestEmailHubConnectBadServerFieldIs400WithTheField(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/accounts", token, map[string]any{
		"email_address": "me@acme.example", "app_password": "server-password-1",
		"imap_host": "mail.acme.example", "imap_port": 8080, "imap_security": "tls",
		"smtp_host": "mail.acme.example", "smtp_port": 587, "smtp_security": "starttls",
	})
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "email_hub_invalid_server" || fields["field"] != "imap_port" {
		t.Fatalf("bad imap_port: %d %v", res.StatusCode, out)
	}
}
```

Append to `server/internal/handler/email_hub_sdo_test.go` (add `"encoding/json"` to its imports):

```go
// The account the list and connect return carries the server settings the
// reconnect form refills, and never a secret (spec §5.1).
func TestEmailHubAccountSDOCarriesServerSettingsNotSecrets(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(toEmailHubAccountSDO(service.EmailHubAccountView{
		ID: "acc-1", EmailAddress: "me@acme.example", Provider: "custom", AuthKind: "password",
		ConnectedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
		ImapHost:    "mail.acme.example", ImapPort: 143, ImapSecurity: "starttls",
		SmtpHost: "smtp.acme.example", SmtpPort: 465, SmtpSecurity: "tls", Username: "mailuser",
	}))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"imap_host": "mail.acme.example", "imap_port": float64(143), "imap_security": "starttls",
		"smtp_host": "smtp.acme.example", "smtp_port": float64(465), "smtp_security": "tls",
		"username": "mailuser",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	for _, k := range []string{"password", "password_enc", "app_password"} {
		if _, ok := got[k]; ok {
			t.Errorf("account JSON carries %q", k)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubConnectCustomServerStoresItsSettings|TestEmailHubConnectRefusesBadServerBeforeDialing|TestEmailHubConnectCustomDuplicateIs409|TestEmailHubReconnectChangedServerFlagsIt|TestEmailHubConnectClassifiesVerifyErrorsWithoutLeakingTheHost'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/ -run 'TestEmailHubConnectBadServerFieldIs400WithTheField|TestEmailHubAccountSDOCarriesServerSettingsNotSecrets'
```

Expected:
- The service run fails to build with `view.ImapHost undefined (type EmailHubAccountView has no field or method ImapHost)`, and the same for the other view fields.
- The handler run fails to build with `unknown field ImapHost in struct literal of type service.EmailHubAccountView`.

- [ ] **Step 3: Implement**

3a. In `server/internal/service/email_hub_connect.go`, replace the `Connect` doc comment and function (lines 33-96):

```go
// Connect verifies a mailbox and stores it in the order spec §5.2 fixes:
// membership, the feature switch, the fields and the server they name (no
// dial), the duplicate check, the login, then one transaction for the row and
// its audit. An address that needs a reconnect keeps its id.
func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	if !s.Enabled() {
		return EmailHubAccountView{}, ErrEmailHubNotConfigured
	}
	email := strings.ToLower(strings.TrimSpace(in.EmailAddress))
	if email == "" || strings.TrimSpace(in.AppPassword) == "" {
		return EmailHubAccountView{}, Invalid("email and app password required")
	}
	srv, err := resolveEmailHubServer(email, in)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	// An app password's edges are copy-paste noise; a server password is used as typed.
	password := in.AppPassword
	if srv.Provider != "custom" {
		password = strings.TrimSpace(password)
	}
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: actor.ID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, "password", srv.IMAPHost, srv.IMAPPort):
		return EmailHubAccountView{}, ErrEmailHubAlreadyConnected
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return EmailHubAccountView{}, err
	}
	imapCreds := imapclient.Credentials{
		Host: srv.IMAPHost, Port: srv.IMAPPort, Email: email, Username: srv.Username,
		Password: password, Security: srv.IMAPSecurity,
	}
	smtpCreds := smtpclient.Credentials{
		Host: srv.SMTPHost, Port: srv.SMTPPort, Email: email, Username: srv.Username,
		Password: password, Security: srv.SMTPSecurity,
	}
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		code, mapped := classifyEmailHubConnectError(err)
		// account_id is empty on a first connect.
		s.log.Warn("email hub connect verify failed", "code", code, "provider", srv.Provider,
			"user_id", actor.ID, "account_id", existing.ID)
		return EmailHubAccountView{}, mapped
	}
	sealed, err := s.box.Seal([]byte(password))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	row, _, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, base64.StdEncoding.EncodeToString(sealed))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	s.gov.loginSucceeded(row.ID) // a reconnect starts a fresh run of refused LOGINs
	if s.testHookInitialSync != nil {
		s.testHookInitialSync(ctx, row)
	} else if _, _, syncErr := s.syncAccount(ctx, row, false, true); syncErr != nil {
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "err", syncErr)
	}
	updated, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: row.ID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return accountView(row), nil
	}
	return accountView(updated), nil
}
```

(Task 3 binds the `_` return, and Task 4 changes the initial-sync log line.)

3b. In the same file, replace `saveEmailHubConnection` and its doc comment (lines 108-167):

```go
// saveEmailHubConnection writes verified credentials and the connected audit
// row in one transaction. It re-reads the address FOR UPDATE, because a racing
// request may have connected or disconnected the mailbox since the pre-dial
// check: a live row found there stays locked until commit, so it is updated in
// place (keeping its id; the credential_version bump makes a markAuthFailed
// with the old version match nothing); no live row means a fresh insert, and a
// concurrent insert of the same address loses on the unique index.
// serverChanged reports that the kept row moved to another IMAP server, whose
// UIDs make the cached mail meaningless (spec §3).
func (s *EmailHubService) saveEmailHubConnection(
	ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams,
	srv emailHubServer, passwordEnc string,
) (db.EmailHubAccount, bool, error) {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return db.EmailHubAccount{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	existing, err := qtx.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.EmailHubAccount{}, false, err
	}
	reconnected := err == nil
	serverChanged := reconnected &&
		(!strings.EqualFold(existing.ImapHost, srv.IMAPHost) || int(existing.ImapPort) != srv.IMAPPort)
	var row db.EmailHubAccount
	switch {
	case reconnected && sameEmailHubConnection(existing, "password", srv.IMAPHost, srv.IMAPPort):
		return db.EmailHubAccount{}, false, ErrEmailHubAlreadyConnected
	case reconnected:
		row, err = qtx.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: existing.ID, OrganizationID: byAddress.OrganizationID, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: "password", PasswordEnc: passwordEnc,
		})
	default:
		row, err = qtx.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: byAddress.UserID, OrganizationID: byAddress.OrganizationID,
			EmailAddress: byAddress.Email, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: "password", PasswordEnc: passwordEnc,
		})
		if isUniqueViolation(err) {
			return db.EmailHubAccount{}, false, ErrEmailHubAlreadyConnected // a concurrent Connect inserted first
		}
	}
	if err != nil {
		return db.EmailHubAccount{}, false, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: byAddress.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionEmailHubAccountConnected,
		ResourceType:   "email_hub_account",
		ResourceID:     row.ID,
		Metadata: map[string]any{
			"auth_kind": row.AuthKind, "provider": row.Provider,
			"reconnected": reconnected, "server_changed": serverChanged,
		},
	}); err != nil {
		return db.EmailHubAccount{}, false, err
	}
	return row, serverChanged, tx.Commit(ctx)
}
```

3c. In `classifyEmailHubConnectError`, replace the variable block and the first case:

```go
	var netErr net.Error
	var certErr *tls.CertificateVerificationError
	var recordErr tls.RecordHeaderError
	switch {
	case errors.Is(err, imapclient.ErrTLSRequired), errors.Is(err, smtpclient.ErrTLSRequired),
		errors.As(err, &recordErr): // TLS spoken to a plaintext greeter, e.g. security tls on port 143/587
		return "tls_required", ErrEmailHubTLSRequired
```

Leave the remaining cases unchanged, and delete the now-unused `emailhub` import.

3d. In `server/internal/service/email_hub.go`, extend the view and its mapper:

```go
type EmailHubAccountView struct {
	ID               string
	EmailAddress     string
	Provider         string
	ConnectedAt      time.Time
	LastSyncAt       *time.Time
	AuthKind         string
	NeedsReconnect   bool
	AuthFailedReason string
	// Server settings refill the reconnect form; the password never leaves the row.
	ImapHost     string
	ImapPort     int
	ImapSecurity string
	SmtpHost     string
	SmtpPort     int
	SmtpSecurity string
	Username     string
}
```

```go
func accountView(r db.EmailHubAccount) EmailHubAccountView {
	return EmailHubAccountView{
		ID: r.ID, EmailAddress: r.EmailAddress, Provider: r.Provider,
		ConnectedAt: r.CreatedAt.Time, LastSyncAt: lastSyncFromState(r.SyncState),
		AuthKind: r.AuthKind, NeedsReconnect: r.AuthFailedAt.Valid, AuthFailedReason: r.AuthFailedReason,
		ImapHost: r.ImapHost, ImapPort: int(r.ImapPort), ImapSecurity: r.ImapSecurity,
		SmtpHost: r.SmtpHost, SmtpPort: int(r.SmtpPort), SmtpSecurity: r.SmtpSecurity,
		Username: r.Username,
	}
}
```

3e. In `server/internal/handler/dto/sdi/email_hub.go`, replace `ConnectEmailHubAccountSDI`:

```go
// ConnectEmailHubAccountSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/accounts.
// Without imap_host the server comes from the address's domain preset; with it,
// all six server fields are required and the mailbox is stored as provider custom.
type ConnectEmailHubAccountSDI struct {
	EmailAddress string `json:"email_address" minLength:"3" maxLength:"254" format:"email" example:"you@gmail.com"`
	AppPassword  string `json:"app_password" minLength:"8" maxLength:"128" description:"Mật khẩu ứng dụng, hoặc mật khẩu hộp thư khi dùng máy chủ riêng" example:"abcd efgh ijkl mnop"`
	ImapHost     string `json:"imap_host,omitempty" maxLength:"253" description:"Máy chủ IMAP: tên miền hoặc địa chỉ IP, không kèm giao thức hay cổng. Bỏ trống để dùng cấu hình sẵn theo tên miền email" example:"mail.example.com"`
	ImapPort     int    `json:"imap_port,omitempty" description:"Cổng IMAP: 993, 143, 465, 587 hoặc 25" example:"993"`
	ImapSecurity string `json:"imap_security,omitempty" enum:"tls,starttls" description:"tls: mã hoá ngay khi kết nối; starttls: bắt buộc nâng cấp bằng STARTTLS" example:"tls"`
	SmtpHost     string `json:"smtp_host,omitempty" maxLength:"253" description:"Máy chủ SMTP: tên miền hoặc địa chỉ IP, không kèm giao thức hay cổng" example:"mail.example.com"`
	SmtpPort     int    `json:"smtp_port,omitempty" description:"Cổng SMTP: 993, 143, 465, 587 hoặc 25" example:"587"`
	SmtpSecurity string `json:"smtp_security,omitempty" enum:"tls,starttls" description:"tls: mã hoá ngay khi kết nối; starttls: bắt buộc nâng cấp bằng STARTTLS" example:"starttls"`
	Username     string `json:"username,omitempty" maxLength:"320" description:"Tên đăng nhập nếu khác địa chỉ email" example:"you"`
}
```

3f. In `server/internal/handler/dto/sdo/email_hub.go`, add these fields to `EmailHubAccountSDO`, after `AuthFailedReason`:

```go
	ImapHost     string `json:"imap_host" description:"Máy chủ IMAP đã lưu" example:"imap.gmail.com"`
	ImapPort     int    `json:"imap_port" description:"Cổng IMAP" example:"993"`
	ImapSecurity string `json:"imap_security" description:"tls hoặc starttls" example:"tls"`
	SmtpHost     string `json:"smtp_host" description:"Máy chủ SMTP đã lưu" example:"smtp.gmail.com"`
	SmtpPort     int    `json:"smtp_port" description:"Cổng SMTP" example:"587"`
	SmtpSecurity string `json:"smtp_security" description:"tls hoặc starttls" example:"starttls"`
	Username     string `json:"username" description:"Tên đăng nhập; rỗng nghĩa là dùng địa chỉ email" example:"you"`
```

3g. In `server/internal/handler/email_hub.go`, `connectEmailHubAccount` builds the full input. The `switch` stays as it is, because a `CodedError` falls through to `mapServiceError`:

```go
	acc, err := h.EmailHub.Connect(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.ConnectEmailHubInput{
		EmailAddress: in.EmailAddress, AppPassword: in.AppPassword,
		IMAPHost: in.ImapHost, IMAPPort: in.ImapPort, IMAPSecurity: in.ImapSecurity,
		SMTPHost: in.SmtpHost, SMTPPort: in.SmtpPort, SMTPSecurity: in.SmtpSecurity,
		Username: in.Username,
	})
```

and `toEmailHubAccountSDO`:

```go
func toEmailHubAccountSDO(a service.EmailHubAccountView) sdo.EmailHubAccountSDO {
	out := sdo.EmailHubAccountSDO{
		ID: a.ID, EmailAddress: a.EmailAddress, Provider: a.Provider,
		ConnectedAt: a.ConnectedAt.Format(time.RFC3339),
		AuthKind:    a.AuthKind, NeedsReconnect: a.NeedsReconnect, AuthFailedReason: a.AuthFailedReason,
		ImapHost: a.ImapHost, ImapPort: a.ImapPort, ImapSecurity: a.ImapSecurity,
		SmtpHost: a.SmtpHost, SmtpPort: a.SmtpPort, SmtpSecurity: a.SmtpSecurity,
		Username: a.Username,
	}
	if a.LastSyncAt != nil {
		out.LastSyncAt = a.LastSyncAt.Format(time.RFC3339)
	}
	return out
}
```

3h. In `server/internal/handler/router/email_hub.go`, replace line 10:

```go
// tag: email-hub — IMAP mailboxes connected with a password: an App Password on a
// preset provider, or the mailbox password on the member's own IMAP/SMTP server.
```

and replace the `description` of the `POST …/email-hub/accounts` apiOp:

```go
		description: "Verifies IMAP and SMTP login, stores encrypted credentials, and runs an initial sync. " +
			"Without imap_host the server comes from the address's domain preset (App Password); with it, all six " +
			"server fields are required (TLS mandatory, ports 993/143/465/587/25) and are checked before any dial: " +
			"400 email_hub_invalid_server or email_hub_host_not_allowed, with error.fields.field naming the field. " +
			"An address that needs a reconnect keeps its id; a live one on the same IMAP server answers 409 " +
			"email_hub_already_connected before any dial. 10 requests per 10 minutes per user.",
```

No new path parameter, so `pathParamSDI` does not change. No body field ends in `_id`, so `isoReferences` does not change.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m -race ./internal/service/ -run 'TestEmailHubConnect|TestEmailHubReconnect|TestEmailHubConcurrentConnects|TestEveryAuditedCommandWritesItsRow|TestResolveEmailHubServer'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/... -run 'EmailHub|Isolation|TestEveryBodyIDFieldHasAReferenceCase'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal && go vet ./internal/service/ ./internal/handler/... && go tool staticcheck ./internal/service/ ./internal/handler/...
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/no-pii-log.test.mjs
```

Expected: all pass, and `gofmt -l` prints nothing. The GĐ1 connect tests still pass, because presets yield `Username ""`, `tls` and `starttls`. The handler run includes the router OpenAPI tests that cover the new tags.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add server/internal/service/email_hub_connect.go server/internal/service/email_hub_connect_test.go \
  server/internal/service/email_hub.go \
  server/internal/handler/dto/sdi/email_hub.go server/internal/handler/dto/sdo/email_hub.go \
  server/internal/handler/email_hub.go server/internal/handler/email_hub_test.go \
  server/internal/handler/email_hub_sdo_test.go server/internal/handler/router/email_hub.go
git commit -m "feat(email-hub): connect a mailbox on the member's own IMAP/SMTP server" \
  -m "Connect takes optional server fields and resolves them, without dialing, into one normalized server that feeds the duplicate check, the login, the stored row and the audit. A bad field answers 400 email_hub_invalid_server or email_hub_host_not_allowed naming the field, before any LOGIN. A reconnect onto another IMAP server keeps the id and records server_changed; case or a trailing dot is not a change. TLS spoken to a plaintext greeter is classified tls_required, not a wrong password. The account SDO returns the server settings and username for the reconnect form, never the password. A custom server's password is used as typed. Left out: the cache wipe and stale-sync fence on a server change, APPEND to Sent, classified logs on the sync paths (later GD2 tasks), and the client." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Server change on reconnect: wipe cache safely and fence stale sync writes

**Files:**
- Modify: `server/pkg/db/queries/email_hub.sql:57-60` (`UpdateEmailHubAccountSyncState`)
- Regenerate: `server/pkg/db/generated/email_hub.sql.go` (`make sqlc`)
- Modify: `server/internal/service/email_hub_governor.go`:
  - add a field to the `emailHubAccountGate` struct (lines 36-47)
  - add `forgetMailboxes` after `mailboxes` (lines 72-77)
  - add `fenceSnapshots` / `staleSnapshot` after `loginSucceeded` (lines 107-109)
- Modify: `server/internal/service/email_hub_sync.go`:
  - pass the version in the three `UpdateEmailHubAccountSyncState` calls: :157 `syncAccount`, :345 `syncSingleFolder`, :473 `WatchInbox` (the handler's long-poll IDLE path, which runs outside `withIMAP`)
  - add the new `staleEmailHubSnapshot` helper
  - add the fence at the top of `syncAccountFolderSession` (:174) and of `cacheFolderItems` (:227), and inside the item loop of `upsertThreadItems` (:357)
- Modify: `server/internal/service/email_hub_connect.go`: the `Connect` doc comment, the post-save block, and a new `resetEmailHubServerCache`
- Modify: `server/internal/service/email_hub_account_queries_test.go`: change the existing call at :32-36 and add one test
- Modify: `server/internal/service/email_hub_governor_test.go`: add two tests
- Create: `server/internal/service/email_hub_server_change_test.go`

Why the fence: a worker reconcile or IMAP search that read the account before the reconnect can still get the IMAP lock after the reset. It then dials the old server. Without the fence, its upserts land old-server UIDs, and its reconcile prune (`DeleteEmailHubThreadsNotInUIDs`) or the UIDVALIDITY branch (`DeleteEmailHubThreadsInFolder`) deletes the new server's rows. `WatchInbox` runs outside `withIMAP` on the request ctx, so `forceStop` does not reach it. The SQL guard covers only `sync_state`; the in-memory fence covers the row writes on this node.

**Interfaces:**
- Consumes:
  - Task 2: `saveEmailHubConnection(...) (db.EmailHubAccount, bool, error)`, `customConnectInput`, `connectedServerChanged(t, pool, accountID)`.
  - GĐ1:
    - `cleanUpDisconnectedEmailHubAccount(ctx, q *db.Queries, accountID, organizationID string) error`
    - `(*emailHubHubWatcher).forceStop(accountID)`
    - `(*emailHubGovernor).withIMAP(accountID, fn) error`
    - `setMailboxes` / `mailboxes`
    - `testHookInitialSync`
    - Test helpers: `stubEmailHubDial`, `emailHubFixture`, `seedEmailHubAccount`, `seedEmailHubThread` (UID 42), `markSeedAccountAuthFailed`, `seedDueEmailHubScheduledSend`, `scheduledSendOutcome`
- Produces:
  - `db.UpdateEmailHubAccountSyncStateParams{ID; SyncState; OrganizationID; CredentialVersion int64}`. The query is still `:exec`. A stale version writes nothing.
  - `func (g *emailHubGovernor) forgetMailboxes(accountID string)`
  - `func (g *emailHubGovernor) fenceSnapshots(accountID string, version int64)`. It only ever raises the fence.
  - `func (g *emailHubGovernor) staleSnapshot(accountID string, version int64) bool`
  - `func (s *EmailHubService) staleEmailHubSnapshot(acc db.EmailHubAccount) bool`. When stale, it logs at Debug with `account_id` and `reason=stale_snapshot`.
  - `func (s *EmailHubService) resetEmailHubServerCache(ctx context.Context, acc db.EmailHubAccount)`. In order: fence, forceStop, then under `withIMAP` forgetMailboxes and cleanup. It logs a failure; Task 4 adds `code` to that log line.

- [ ] **Step 1: Write the failing tests**

In `server/internal/service/email_hub_account_queries_test.go`, the existing write at lines 32-36 becomes:

```go
	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, OrganizationID: org, SyncState: []byte(`{"INBOX":{"uid_validity":7}}`),
		CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}
```

Append to the same file:

```go
// A sync that read the account before a reconnect holds the old
// credential_version; its cursors belong to the old IMAP server and must not
// overwrite the reset sync_state (spec §2.1, §3).
func TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	moved, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, Provider: "custom",
		ImapHost: "mail.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "mail.example.com", SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: "sealed-new",
	})
	if err != nil {
		t.Fatal(err)
	}
	write := func(version int64, state string) {
		t.Helper()
		if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
			ID: acc.ID, OrganizationID: acc.OrganizationID, SyncState: []byte(state), CredentialVersion: version,
		}); err != nil {
			t.Fatal(err)
		}
	}
	read := func() db.EmailHubAccount {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}

	write(acc.CredentialVersion, `{"INBOX":{"uidvalidity":7,"last_uid":42}}`)
	if got := read(); string(got.SyncState) != "{}" {
		t.Fatalf("a write from the pre-reconnect snapshot landed: sync_state=%s", got.SyncState)
	}
	write(moved.CredentialVersion, `{"INBOX":{"uidvalidity":9,"last_uid":3}}`)
	if got := parseEmailHubSyncState(read().SyncState).folder(emailHubFolderInbox); got.UIDValidity != 9 || got.LastUID != 3 {
		t.Fatalf("the current snapshot must write its cursor, got %+v", got)
	}
}
```

Append to `server/internal/service/email_hub_governor_test.go`:

```go
func TestEmailHubGovernorForgetsMailboxes(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	gov.setMailboxes("acc-1", imapclient.MailboxMap{"INBOX": "Inbox"})
	gov.setMailboxes("acc-2", imapclient.MailboxMap{"INBOX": "Inbox"})
	gov.forgetMailboxes("acc-1")
	if _, ok := gov.mailboxes("acc-1"); ok {
		t.Fatal("a forgotten account must have no cached mailbox map")
	}
	if _, ok := gov.mailboxes("acc-2"); !ok {
		t.Fatal("forgetting one account dropped another's mailbox map")
	}
}

func TestEmailHubGovernorFencesStaleSnapshots(t *testing.T) {
	t.Parallel()
	gov := newEmailHubGovernor()
	if gov.staleSnapshot("acc-1", 0) {
		t.Fatal("without a fence no snapshot is stale")
	}
	gov.fenceSnapshots("acc-1", 3)
	gov.fenceSnapshots("acc-1", 2) // a late, older fence never lowers it
	if !gov.staleSnapshot("acc-1", 2) {
		t.Fatal("a snapshot older than the fence must be stale")
	}
	if gov.staleSnapshot("acc-1", 3) || gov.staleSnapshot("acc-1", 4) {
		t.Fatal("the fenced version and newer ones are current")
	}
	if gov.staleSnapshot("acc-2", 0) {
		t.Fatal("a fence is per account")
	}
}
```

Create `server/internal/service/email_hub_server_change_test.go`:

```go
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedCustomServerEmailHubAccount stores me@example.com on its own server
// (mail.example.com, IMAP 993 tls, SMTP 587 starttls) with an INBOX cursor,
// then puts it in needs_reconnect so Connect may move or refresh it.
func seedCustomServerEmailHubAccount(t *testing.T, svc *EmailHubService, q *db.Queries, userID, orgID string) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	sealed, err := svc.box.Seal([]byte("old-password"))
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: "me@example.com", Provider: "custom",
		ImapHost: "mail.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "mail.example.com", SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(emailHubSyncState{emailHubFolderInbox: {UIDValidity: 7, LastUID: 42}})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: state, OrganizationID: orgID, CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}
	return markSeedAccountAuthFailed(t, q, acc)
}

func emailHubCacheCounts(t *testing.T, pool *pgxpool.Pool, accountID string) (threads, attachments, summaries int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `SELECT
		(SELECT count(*) FROM email_hub_threads WHERE account_id = $1),
		(SELECT count(*) FROM email_hub_attachments WHERE account_id = $1),
		(SELECT count(*) FROM email_hub_thread_ai_summaries WHERE account_id = $1)`, accountID,
	).Scan(&threads, &attachments, &summaries); err != nil {
		t.Fatal(err)
	}
	return threads, attachments, summaries
}

// A reconnect onto another IMAP server keeps the id but drops everything
// cached from the old one before the first sync (spec §3): UIDs and
// UIDVALIDITY mean nothing on the new server.
func TestEmailHubReconnectToAnotherServerDropsTheCache(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if _, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Filename: "a.pdf", MimeType: "application/pdf", SizeBytes: 10, PartID: "2",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpsertEmailHubThreadAiSummary(ctx, db.UpsertEmailHubThreadAiSummaryParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, ThreadID: thread.ID, AccountID: acc.ID,
		Locale: "vi", SourceFingerprint: "fp", Summary: "old", KeyPoints: []byte("[]"), ActionItems: []byte("[]"),
		Model: "test", CreatedBy: user.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	sendID := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	watchCtx, stopWatch := context.WithCancel(ctx)
	defer stopWatch()
	svc.hubWatch.mu.Lock()
	svc.hubWatch.stop[acc.ID] = stopWatch // an IDLE loop on the old server
	svc.hubWatch.mu.Unlock()

	stubEmailHubDial(svc, nil)
	threadsAtSync, mailboxesAtSync := -1, true
	svc.testHookInitialSync = func(_ context.Context, row db.EmailHubAccount) {
		threadsAtSync, _, _ = emailHubCacheCounts(t, pool, row.ID)
		_, mailboxesAtSync = svc.gov.mailboxes(row.ID)
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "mail.newhost.example.net", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.newhost.example.net", SMTPPort: 587, SMTPSecurity: "starttls",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID {
		t.Fatalf("a server change must keep id %s, got %s", acc.ID, view.ID)
	}
	if threadsAtSync != 0 || mailboxesAtSync {
		t.Fatalf("the initial sync must start on an empty cache: threads=%d cached mailbox map=%v", threadsAtSync, mailboxesAtSync)
	}
	if threads, atts, sums := emailHubCacheCounts(t, pool, acc.ID); threads+atts+sums != 0 {
		t.Fatalf("old-server cache survived: threads=%d attachments=%d summaries=%d", threads, atts, sums)
	}
	if status, _ := scheduledSendOutcome(t, pool, sendID); status != "cancelled" {
		t.Fatalf("a pending scheduled send must be cancelled, got %q", status)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(row.SyncState) != "{}" || row.CredentialVersion != acc.CredentialVersion+1 || row.ImapHost != "mail.newhost.example.net" {
		t.Fatalf("row: sync_state=%s version=%d imap_host=%q", row.SyncState, row.CredentialVersion, row.ImapHost)
	}
	if watchCtx.Err() == nil {
		t.Fatal("a server change must stop the IDLE watcher of the old server")
	}
	if got := connectedServerChanged(t, pool, acc.ID); got != "true" {
		t.Fatalf("audit server_changed=%q, want true", got)
	}

	// Work that began against the old server (an IDLE round, a queued worker
	// sync) still holds the old snapshot: neither its threads nor its cursor land.
	ids, err := svc.upsertThreadItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{
		{UID: 7, Subject: "from the old server", SentAt: time.Now().UTC()},
	})
	if err != nil || len(ids) != 0 {
		t.Fatalf("a stale snapshot wrote threads: ids=%v err=%v", ids, err)
	}
	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: acc.SyncState, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}
	after, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 0 || string(after.SyncState) != "{}" {
		t.Fatalf("stale writes landed: threads=%d sync_state=%s", threads, after.SyncState)
	}

	// A stale reconcile must not prune the new server's rows (UID 42 is absent
	// from the old server's list and above its minimum UID).
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{
		{UID: 7, Subject: "old", SentAt: time.Now().UTC()},
	}, true); err != nil {
		t.Fatal(err)
	}
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 1 {
		t.Fatalf("a stale reconcile touched the new server's cache, threads=%d", threads)
	}
}

// assertEmailHubCacheKept checks a same-server reconnect: mail, cursor and
// mailbox map stay, only the credential moved on.
func assertEmailHubCacheKept(t *testing.T, svc *EmailHubService, q *db.Queries, pool *pgxpool.Pool, acc db.EmailHubAccount) {
	t.Helper()
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 1 {
		t.Fatalf("a same-server reconnect must keep the cache, threads=%d", threads)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := parseEmailHubSyncState(row.SyncState).folder(emailHubFolderInbox); got.UIDValidity != 7 || got.LastUID != 42 {
		t.Fatalf("a same-server reconnect must keep sync_state, got %+v", got)
	}
	if row.CredentialVersion != acc.CredentialVersion+1 {
		t.Fatalf("credential_version=%d, want %d", row.CredentialVersion, acc.CredentialVersion+1)
	}
	if _, ok := svc.gov.mailboxes(acc.ID); !ok {
		t.Fatal("a same-server reconnect must keep the cached mailbox map")
	}
	if got := connectedServerChanged(t, pool, acc.ID); got != "false" {
		t.Fatalf("audit server_changed=%q, want false", got)
	}
}

// Only the IMAP server decides what the cache means: a new SMTP server, port
// or login name on the same IMAP server keeps every cached row (spec §3).
func TestEmailHubReconnectSameServerKeepsTheCache(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	stubEmailHubDial(svc, nil)

	if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "smtp.example.com", SMTPPort: 465, SMTPSecurity: "tls", Username: "me",
	}); err != nil {
		t.Fatal(err)
	}
	assertEmailHubCacheKept(t, svc, q, pool, acc)
}

// Hosts compare after normalization: a case or trailing-dot difference is the
// same server and must not wipe the cache.
func TestEmailHubReconnectHostCaseChangeIsNotAServerChange(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	stubEmailHubDial(svc, nil)

	if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "MAIL.Example.com.", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}); err != nil {
		t.Fatal(err)
	}
	assertEmailHubCacheKept(t, svc, q, pool, acc)
}
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubReconnectToAnotherServerDropsTheCache|TestEmailHubReconnectSameServerKeepsTheCache|TestEmailHubReconnectHostCaseChangeIsNotAServerChange|TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion|TestEmailHubGovernorForgetsMailboxes|TestEmailHubGovernorFencesStaleSnapshots'
```

Expected: the build fails with `unknown field CredentialVersion in struct literal of type db.UpdateEmailHubAccountSyncStateParams`, `gov.forgetMailboxes undefined`, `gov.fenceSnapshots undefined` and `gov.staleSnapshot undefined`.

- [ ] **Step 3: Fence the sync_state write in SQL and regenerate**

In `server/pkg/db/queries/email_hub.sql`, replace lines 57-60:

```sql
-- name: UpdateEmailHubAccountSyncState :exec
-- A sync holding an older credential snapshot writes nothing: the account may
-- have moved to another IMAP server since, and its cursors mean nothing there.
UPDATE email_hub_accounts
SET sync_state = $2, updated_at = now()
WHERE id = $1 AND organization_id = $3 AND credential_version = $4;
```

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && make sqlc && git diff --stat server/pkg/db/generated/
```

Expected: only `server/pkg/db/generated/email_hub.sql.go` changes. `UpdateEmailHubAccountSyncStateParams` ends with `CredentialVersion int64`, and the `Exec` passes `arg.CredentialVersion`. If sqlc names the field differently, use its name everywhere in this task.

- [ ] **Step 4: Governor: forget the mailbox map and fence old snapshots**

In `server/internal/service/email_hub_governor.go`, add at the end of `emailHubAccountGate`:

```go
	// Snapshots with an older credential_version describe a previous IMAP
	// server; their cache writes are dropped on this node (fenceSnapshots).
	minCredentialVersion atomic.Int64
```

After `func (g *emailHubGovernor) mailboxes(...)`, add:

```go
// forgetMailboxes drops the cached mailbox map, so the next sync LISTs the
// account's current server instead of resolving names from the old one.
func (g *emailHubGovernor) forgetMailboxes(accountID string) {
	g.mailboxMu.Lock()
	defer g.mailboxMu.Unlock()
	delete(g.mailboxMaps, accountID)
}
```

After `func (g *emailHubGovernor) loginSucceeded(...)`, add:

```go
// fenceSnapshots marks every credential snapshot older than version stale on
// this node. A reconnect to another IMAP server raises it before the cache
// wipe, so work that began against the old server stops writing rows.
func (g *emailHubGovernor) fenceSnapshots(accountID string, version int64) {
	gt := g.gate(accountID)
	for {
		cur := gt.minCredentialVersion.Load()
		if version <= cur || gt.minCredentialVersion.CompareAndSwap(cur, version) {
			return
		}
	}
}

func (g *emailHubGovernor) staleSnapshot(accountID string, version int64) bool {
	return version < g.gate(accountID).minCredentialVersion.Load()
}
```

- [ ] **Step 5: Sync paths pass the snapshot version and honour the fence**

In `server/internal/service/email_hub_sync.go`, add `CredentialVersion: acc.CredentialVersion` to each of the three `UpdateEmailHubAccountSyncState` calls (in `syncAccount`, `syncSingleFolder` and `WatchInbox`):

```go
	if err := s.q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: raw, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion,
	}); err != nil {
```

Add next to `cacheFolderItems`:

```go
// staleEmailHubSnapshot reports that acc was read before a reconnect moved the
// mailbox to another IMAP server: nothing read with it may touch the cache.
func (s *EmailHubService) staleEmailHubSnapshot(acc db.EmailHubAccount) bool {
	if !s.gov.staleSnapshot(acc.ID, acc.CredentialVersion) {
		return false
	}
	s.log.Debug("email hub cache write skipped", "account_id", acc.ID, "reason", "stale_snapshot")
	return true
}
```

Make it the first statement of `syncAccountFolderSession`. This covers the UIDVALIDITY delete, and the caller's sync_state write is refused by the SQL guard:

```go
	if s.staleEmailHubSnapshot(acc) {
		return state, 0, nil
	}
```

Also make it the first statement of `cacheFolderItems`. This covers the reconcile prune:

```go
	if s.staleEmailHubSnapshot(acc) {
		return nil
	}
```

Finally, make it the first statement inside `for _, it := range items {` in `upsertThreadItems`, which IMAP search and backfill call directly:

```go
		if s.staleEmailHubSnapshot(acc) {
			return ids, lastErr
		}
```

- [ ] **Step 6: Connect resets the cache on a server change**

In `server/internal/service/email_hub_connect.go`, replace the last sentence of the `Connect` doc comment, `An address that needs a reconnect keeps its id.`, with:

```go
// A reconnect keeps the id; it keeps the cached mail too unless the IMAP
// server changed (spec §3).
```

Task 2 left `row, _, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, …)`. Change `_` to `serverChanged`, so the block from the save through `loginSucceeded` reads:

```go
	row, serverChanged, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, base64.StdEncoding.EncodeToString(sealed))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	if serverChanged {
		s.resetEmailHubServerCache(ctx, row)
	}
	s.gov.loginSucceeded(row.ID) // a reconnect starts a fresh run of refused LOGINs
```

Then add after `Connect`:

```go
// resetEmailHubServerCache runs after a reconnect moved the mailbox to another
// IMAP server and before the initial sync (spec §3). Snapshots of the old
// server stop writing first, then the IDLE watcher stops (the client starts a
// new one after it refetches the accounts), then the wipe waits for this
// node's IMAP work on the account to finish. The reconnect already committed,
// so a failed wipe is logged, not returned.
func (s *EmailHubService) resetEmailHubServerCache(ctx context.Context, acc db.EmailHubAccount) {
	ctx = context.WithoutCancel(ctx)
	s.gov.fenceSnapshots(acc.ID, acc.CredentialVersion)
	s.hubWatch.forceStop(acc.ID)
	if err := s.gov.withIMAP(acc.ID, func() error {
		s.gov.forgetMailboxes(acc.ID)
		return cleanUpDisconnectedEmailHubAccount(ctx, s.q, acc.ID, acc.OrganizationID)
	}); err != nil {
		s.log.Warn("email hub server change cleanup failed", "account_id", acc.ID)
	}
}
```

- [ ] **Step 7: Run the targeted tests**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -race -timeout 30m ./internal/service/ -run 'TestEmailHubReconnect|TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion|TestEmailHubAccountCredentialQueries|TestEmailHubGovernor|TestEmailHubConnect|TestEmailHubWatch|TestEmailHubSync|TestEmailHubDisconnect'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test -count=1 ./migrations/ -run 'TestEveryQueryNamesItsTenant'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/service ./pkg/db && go vet ./internal/service/ ./pkg/db/... && go tool staticcheck ./internal/service/
```

Expected:
- Every listed test passes, including GĐ1's `TestEmailHubReconnectKeepsTheAccountAndItsMail` (a same-server preset reconnect).
- `TestEveryQueryNamesItsTenant` passes, because the query still constrains `organization_id = $3`.
- gofmt, vet and staticcheck are clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/pkg/db/queries/email_hub.sql server/pkg/db/generated/email_hub.sql.go \
  server/internal/service/email_hub_connect.go server/internal/service/email_hub_governor.go \
  server/internal/service/email_hub_governor_test.go server/internal/service/email_hub_sync.go \
  server/internal/service/email_hub_account_queries_test.go server/internal/service/email_hub_server_change_test.go
git commit -m "feat(email-hub): drop the cache when a reconnect moves the mailbox to another IMAP server" \
  -m "UIDs and UIDVALIDITY only mean something on one IMAP server. A reconnect that changes imap_host or imap_port keeps the account id but, after commit and before the initial sync, raises a per-node credential_version fence, stops the IDLE watcher, forgets the cached mailbox map and runs the disconnect cleanup under the account's IMAP lock. The sync_state write now matches credential_version, and a fenced snapshot skips the folder pass, the cache write and the reconcile prune, which covers the WatchInbox long-poll path outside the IMAP lock. SMTP-only, username-only and case/trailing-dot host changes keep the cache. Left out: thread writes from another node's stale sync are not fenced in SQL (single replica, ADR 0025), and the server still does not restart the watcher (the client re-subscribes)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Classified logging on every mail-server path (GĐ1 ruling)

**Files:**
- Modify: `server/internal/service/email_hub_connect.go`
  - Imports: add `fmt` if missing, and `github.com/jackc/pgx/v5/pgconn`.
  - Logs: the initial-sync log line, and the cleanup log line in `resetEmailHubServerCache` (Task 3).
  - New helpers `emailHubErrCode` and `redactEmailHubMailErr`, placed after `classifyEmailHubConnectError`.
- Modify: `server/internal/service/email_hub.go`
  - Logs: the `GetThread` fetch-body log, and the six mark-* logs.
  - Return: `Sync` returns its redacted error.
- Modify: `server/internal/service/email_hub_sync.go`
  - Logs: the two list-mailboxes logs, the folder sync log, and the worker sync log.
  - Returns: three in `WatchInbox`.
- Modify: `server/internal/service/email_hub_watcher.go`: the idle failed and watcher sync failed logs.
- Modify: `server/internal/service/email_hub_folders.go`: the list-mailboxes log in `openIMAPMailboxes`; the move log and both returns in `MoveThread`.
- Modify: `server/internal/service/email_hub_body.go`: the prefetch imap failed log, and the `default` branch of `recordBodyPrefetchFailure`.
- Modify: `server/internal/service/email_hub_search.go`: the imap search failed and backfill failed logs.
- Modify: `server/internal/service/email_hub_attachments.go`: two returns in `OpenAttachment`.
- Test: `server/internal/service/email_hub_logging_test.go` (new)

Match each edit by its log message text, which stays the same. Tasks 1-3 move the GĐ1 line numbers. Some sites are left alone because they log only DB or storage errors, or our own sentinels:
- disconnect cleanup, hydrate from object storage, and the send-path cache in `email_hub.go`
- the body cache/count/list logs and the prefetch-deferred Debug line in `email_hub_body.go`
- the DB-only sites in `email_hub_sync.go` and `email_hub_watcher.go`
- all of `email_hub_retention.go`, `email_hub_schedule.go` and `email_hub_ai.go`

The send path already logs `code`. `indexSearchResults` and `backfillOlderThreads` are only called from `ListThreads`, which logs their error and never returns it.

**Interfaces:**
- Consumes:
  - `classifyEmailHubConnectError(err) (string, error)`, including Task 2's `RecordHeaderError` case
  - sentinels `ErrEmailHubReauthRequired`, `ErrNotFound`, `ErrEmailHubNotConfigured`, `ErrEmailHubSMTPDisabled`
  - `ValidationError`, `CodedError`, `*pgconn.PgError`
  - `emailHubFixture`, `seedEmailHubThread`
- Produces:
  - `func emailHubErrCode(err error) string`. It returns one of `timeout` (context.Canceled/DeadlineExceeded, checked first because DeadlineExceeded is also a `net.Error`), `auth_failed` (also for ErrEmailHubReauthRequired), `db` (*pgconn.PgError), or the classifier's `unreachable`, `host_not_allowed`, `tls_required`, `smtp_disabled`, `connect_failed`.
  - `func redactEmailHubMailErr(err error) error`. nil stays nil. A kept sentinel or context error comes back bare, because the text wrapped around it may name the host. ValidationError, CodedError and *pgconn.PgError come back as the matched value. Anything else becomes `fmt.Errorf("email hub mail server: %s", emailHubErrCode(err))`.
  - The log key is `code` everywhere. HTTP statuses do not change.

- [ ] **Step 1: Write the failing test**

Create `server/internal/service/email_hub_logging_test.go`:

```go
package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A custom IMAP host is the user's private infrastructure; .invalid never resolves.
const emailHubSecretHost = "nohost.secret-intranet.invalid"

func TestEmailHubErrCode(t *testing.T) {
	h := emailHubSecretHost
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"dns", fmt.Errorf("imap dial: %w", &net.DNSError{Err: "no such host", Name: h, IsNotFound: true}), "unreachable"},
		{"net timeout", fmt.Errorf("imap dial: %w", &net.DNSError{Err: "i/o timeout", Name: h, IsTimeout: true}), "unreachable"},
		{"certificate", fmt.Errorf("imap dial: %w", &tls.CertificateVerificationError{
			Err: errors.New("x509: certificate is valid for shared.host.example, not " + h),
		}), "unreachable"},
		{"tls against plaintext", fmt.Errorf("imap greeting %s: %w", h,
			tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}), "tls_required"},
		{"imap tls required", fmt.Errorf("imap %s: %w", h, imapclient.ErrTLSRequired), "tls_required"},
		{"imap auth", fmt.Errorf("imap login %s: %w", h, imapclient.ErrAuthFailed), "auth_failed"},
		{"smtp auth disabled", fmt.Errorf("smtp auth %s: %w", h, smtpclient.ErrSMTPAuthDisabled), "smtp_disabled"},
		{"blocked host", fmt.Errorf("dial %s:993: %w", h, netguard.ErrHostNotAllowed), "host_not_allowed"},
		{"deadline", fmt.Errorf("imap fetch %s: %w", h, context.DeadlineExceeded), "timeout"},
		{"canceled", fmt.Errorf("imap fetch %s: %w", h, context.Canceled), "timeout"},
		{"needs reconnect", ErrEmailHubReauthRequired, "auth_failed"},
		{"database", fmt.Errorf("sync state: %w", &pgconn.PgError{Code: "40001", Message: "serialization failure"}), "db"},
		{"protocol", errors.New("imap: unexpected BYE from " + h), "connect_failed"},
	}
	for _, tc := range cases {
		got := emailHubErrCode(tc.err)
		if got != tc.want {
			t.Errorf("%s: code %q, want %q", tc.name, got, tc.want)
		}
		if strings.Contains(got, "secret-intranet") {
			t.Errorf("%s: the code carries the host: %q", tc.name, got)
		}
	}
}

func TestRedactEmailHubMailErrKeepsSentinels(t *testing.T) {
	if redactEmailHubMailErr(nil) != nil {
		t.Fatal("nil must stay nil")
	}
	for _, sentinel := range []error{
		ErrEmailHubReauthRequired, ErrNotFound, ErrEmailHubNotConfigured, ErrEmailHubSMTPDisabled, context.DeadlineExceeded,
	} {
		err := redactEmailHubMailErr(fmt.Errorf("imap %s: %w", emailHubSecretHost, sentinel))
		if !errors.Is(err, sentinel) {
			t.Errorf("%v: lost its sentinel: %v", sentinel, err)
		}
		if strings.Contains(err.Error(), "secret-intranet") {
			t.Errorf("%v: still carries the host: %v", sentinel, err)
		}
	}
	var ve ValidationError
	if err := redactEmailHubMailErr(Invalid("attachment too large")); !errors.As(err, &ve) {
		t.Errorf("a validation error must stay a 400, got %v", err)
	}
	dns := fmt.Errorf("imap dial: %w", &net.DNSError{Err: "no such host", Name: emailHubSecretHost, IsNotFound: true})
	if got := redactEmailHubMailErr(dns); got.Error() != "email hub mail server: unreachable" {
		t.Errorf("DNS failure redacted to %q", got)
	}
}

// Every user-facing mail path against a host that does not resolve: what the
// handler receives and what the service logs carry a code, never the host.
func TestEmailHubSyncLogsCodeNotHost(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	ctx := context.Background()
	actor := Human(user.ID)
	sealed, err := svc.box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: user.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: "me@corp.example", Provider: "custom",
		ImapHost: emailHubSecretHost, ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: emailHubSecretHost, SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	_, syncErr := svc.Sync(ctx, actor, ws.ID, acc.ID, "", true, false, false)
	moveErr := svc.MoveThread(ctx, actor, ws.ID, acc.ID, thread.ID, emailhub.FolderArchive)
	if _, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, thread.ID, true, false); err != nil {
		t.Fatalf("a failed body fetch still serves the cached thread: %v", err)
	}
	for name, err := range map[string]error{"sync": syncErr, "move": moveErr} {
		if err == nil {
			t.Fatalf("%s: want an error from a host that does not resolve", name)
		}
		if strings.Contains(err.Error(), "secret-intranet") {
			t.Errorf("%s: the returned error carries the host: %v", name, err)
		}
		if err.Error() != "email hub mail server: unreachable" {
			t.Errorf("%s: returned %q, want the redacted unreachable code", name, err)
		}
	}
	out := logs.String()
	if strings.Contains(out, "secret-intranet") {
		t.Fatalf("the log carries the host:\n%s", out)
	}
	if !strings.Contains(out, "code=unreachable") {
		t.Fatalf("the log must carry code=unreachable:\n%s", out)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubErrCode|TestRedactEmailHubMailErrKeepsSentinels|TestEmailHubSyncLogsCodeNotHost'
```

Expected: the build fails with `undefined: emailHubErrCode` and `undefined: redactEmailHubMailErr`.

- [ ] **Step 3: Add the two helpers**

In `server/internal/service/email_hub_connect.go`, add the imports, then add after `classifyEmailHubConnectError`:

```go
// emailHubErrCode names a mail-server failure for a log line. Dial, DNS and
// TLS errors and server replies can carry the host, so logs carry this instead.
func emailHubErrCode(err error) string {
	var pgErr *pgconn.PgError
	switch {
	// Before the classifier: context.DeadlineExceeded is also a net.Error.
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, ErrEmailHubReauthRequired):
		return "auth_failed"
	case errors.As(err, &pgErr):
		return "db"
	}
	code, _ := classifyEmailHubConnectError(err)
	return code
}

// redactEmailHubMailErr is what an exported method hands a handler for a
// mail-server failure: the errors handlers map survive, anything else becomes
// its code, so mapServiceError's 500 log never prints a host.
func redactEmailHubMailErr(err error) error {
	if err == nil {
		return nil
	}
	for _, keep := range []error{
		ErrEmailHubReauthRequired, ErrNotFound, ErrEmailHubNotConfigured, ErrEmailHubSMTPDisabled,
		context.Canceled, context.DeadlineExceeded,
	} {
		if errors.Is(err, keep) {
			return keep // the bare sentinel: the text wrapped around it may name the host
		}
	}
	var ve ValidationError
	var ce CodedError
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &ve):
		return ve
	case errors.As(err, &ce):
		return ce
	case errors.As(err, &pgErr):
		return pgErr
	}
	return fmt.Errorf("email hub mail server: %s", emailHubErrCode(err))
}
```

In `Connect`:

```go
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "err", syncErr)
```
→
```go
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "code", emailHubErrCode(syncErr))
```

In `resetEmailHubServerCache` (Task 3):

```go
		s.log.Warn("email hub server change cleanup failed", "account_id", acc.ID)
```
→
```go
		s.log.Warn("email hub server change cleanup failed", "account_id", acc.ID, "code", emailHubErrCode(err))
```

- [ ] **Step 4: Log by code at every IMAP-origin site**

Each edit changes only the attribute. The message text stays the same, because `countingHandler` tests match on it.

`server/internal/service/email_hub.go`:

```go
		s.log.Warn("email hub fetch body failed", "thread_id", threadID, "err", err)
```
→
```go
		s.log.Warn("email hub fetch body failed", "thread_id", threadID, "code", emailHubErrCode(err))
```

In `syncMarkUnreadOnIMAP`, `syncMarkReadOnIMAP` and `syncMarkStarredOnIMAP`, change each of the six lines `s.log.Warn("email hub mark <unread|read|starred> imap failed", "thread_id", threadID, "err", <err|imapErr>)` to `s.log.Warn("email hub mark <unread|read|starred> imap failed", "thread_id", threadID, "code", emailHubErrCode(<err|imapErr>))`. Keep each line's own message and variable:

```go
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
```

In `Sync`:

```go
	if syncErr != nil {
		return false, syncErr
	}
```
→
```go
	if syncErr != nil {
		return false, redactEmailHubMailErr(syncErr)
	}
```

`server/internal/service/email_hub_sync.go`. Both list-mailboxes lines, in `syncAccount` and `syncSingleFolder`:

```go
			s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "code", emailHubErrCode(listErr))
```

The folder sync line:

```go
				s.log.Warn("email hub folder sync failed", "account_id", acc.ID, "folder", folder, "code", emailHubErrCode(folderErr))
```

The worker sync line:

```go
				s.log.Warn("email hub worker sync failed", "account_id", acc.ID, "reconcile", reconcile, "code", emailHubErrCode(syncErr))
```

In `WatchInbox`, three returns change:
- After `OpenSessionIdle` fails, `return false, err` (the one right after the `handleAuthError` block) becomes `return false, redactEmailHubMailErr(err)`.
- After `WatchFolder` fails, the final `return false, err` (after the context check that returns `false, nil`) becomes `return false, redactEmailHubMailErr(err)`.
- After `syncAccountFolderSession` fails, `return false, err` becomes `return false, redactEmailHubMailErr(err)`.

`server/internal/service/email_hub_watcher.go`:

```go
			s.log.Warn("email hub watcher idle failed", "account_id", accountID, "code", emailHubErrCode(err))
```
```go
			s.log.Warn("email hub watcher sync failed", "account_id", accountID, "code", emailHubErrCode(syncErr))
```

`server/internal/service/email_hub_folders.go`. In `openIMAPMailboxes`:

```go
		s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "code", emailHubErrCode(listErr))
```

In `MoveThread`:

```go
			s.log.Warn("email hub move failed", "thread_id", r.ID, "target", targetFolder, "err", err)
			return err
```
→
```go
			s.log.Warn("email hub move failed", "thread_id", r.ID, "target", targetFolder, "code", emailHubErrCode(err))
			return redactEmailHubMailErr(err)
```

and the last two lines of the function:

```go
	_, _, err = s.syncSingleFolder(ctx, acc, targetFolder, false, true, false, true)
	return redactEmailHubMailErr(err)
```

`server/internal/service/email_hub_body.go`:

```go
			s.log.Warn("email hub prefetch imap failed", "account_id", acc.ID, "code", emailHubErrCode(openErr))
```

In the `default` branch of `recordBodyPrefetchFailure`:

```go
		s.log.Warn("email hub prefetch body failed", "thread_id", threadID, "code", emailHubErrCode(err))
```

`server/internal/service/email_hub_search.go`:

```go
				s.log.Warn("email hub imap search failed",
					"account_id", acc.ID, "folder", searchFolder, "code", emailHubErrCode(indexErr))
```
```go
			s.log.Warn("email hub backfill failed",
				"account_id", acc.ID, "folder", folder, "before_uid", cursorUID, "code", emailHubErrCode(backfillErr))
```

`server/internal/service/email_hub_attachments.go`, in `OpenAttachment`:

```go
	sess, mailboxes, err := s.openIMAPInteractive(ctx, acc)
	if err != nil {
		return EmailHubAttachmentView{}, nil, redactEmailHubMailErr(err)
	}
	meta, data, err := sess.FetchAttachment(mailboxes.Resolve(thread.Folder), uint32(thread.ImapUid), row.PartID)
	_ = sess.Close()
	if err != nil {
		return EmailHubAttachmentView{}, nil, redactEmailHubMailErr(err)
	}
```

- [ ] **Step 5: Check that no raw mail-server error is still logged**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server/internal/service && grep --line-number '"err", ' email_hub.go email_hub_sync.go email_hub_watcher.go email_hub_folders.go email_hub_body.go email_hub_search.go email_hub_connect.go email_hub_attachments.go
```

Expected: only the DB and storage sites listed under **Files** as left alone remain. Every other site logs `code`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubErrCode|TestRedactEmailHubMailErrKeepsSentinels|TestEmailHubSyncLogsCodeNotHost|TestEmailHubConnectClassifiesVerifyErrorsWithoutLeakingTheHost|TestEmailHubSendFailureLogsTheClassifiedCode|TestEmailHubSyncErrorsWithoutIMAP|TestEmailHubSyncAllFoldersWithoutIMAP|TestEmailHub.*Watch|TestEmailHub.*Move|TestEmailHub.*Attachment|TestEmailHub.*Auth|TestEmailHubReconnect'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 20m ./internal/handler/... -run 'EmailHub|Isolation'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/service && go vet ./internal/service/ && go tool staticcheck ./internal/service/
```

Expected: all pass, and `gofmt -l` prints nothing. The isolation matrix still sees 403/404, because membership errors return before any redaction site.

The DB test does a real DNS lookup of a `.invalid` name. A resolver that hijacks NXDOMAIN slows it down to the dial timeout, but the code is still `unreachable`.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/internal/service/email_hub_connect.go server/internal/service/email_hub.go server/internal/service/email_hub_sync.go server/internal/service/email_hub_watcher.go server/internal/service/email_hub_folders.go server/internal/service/email_hub_body.go server/internal/service/email_hub_search.go server/internal/service/email_hub_attachments.go server/internal/service/email_hub_logging_test.go
git commit -m "fix(email-hub): log mail-server failures by code, never by raw error" -m "With custom IMAP/SMTP servers the host is the user's private infrastructure, and dial, DNS, TLS and server-reply errors print it. GD1 left the sync, watcher, initial-sync, mark, body, move, search and backfill paths logging raw err (ledger ruling: fix before custom hosts ship). Every such site now logs emailHubErrCode, and Sync, MoveThread, WatchInbox and OpenAttachment hand handlers a redacted error that keeps the sentinels mapServiceError maps, so its 500 log carries no host either. Left out: DB- and storage-only log sites keep err, the send path already logged a code, and HTTP statuses are unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: APPEND sent mail to the server's Sent folder for custom hosts

The controller ruled to keep the `ServerSavesSent` skip (see Global Constraints).

**Files:**
- Modify: `server/internal/emailhub/smtpclient/send.go:49-89`. `Send` returns `(msgID, raw, err)`.
- Modify: `server/internal/emailhub/smtpclient/send_test.go:66,76,88` and `session_test.go:36,61,101,153,168`. The call sites take three results; append `TestSendReturnsTheRawItWrote`.
- Modify: `server/internal/emailhub/imapclient/session.go`. Add `(*Session).Append` after `MarkStarred`, plus imports.
- Modify: `server/internal/emailhub/imapclient/fake_server_test.go`. The fake reads a synchronizing literal and answers APPEND, with `APPENDUID` when caps include UIDPLUS.
- Create: `server/internal/emailhub/imapclient/append_test.go`
- Modify: `server/internal/emailhub/provider.go` (+ `provider_test.go`). Add `ServerSavesSent`.
- Modify: `server/internal/service/email_hub.go`. Change the hook fields and `sendOutboundMail`. Find both by their code, because Tasks 2-4 edited this file.
- Create: `server/internal/service/email_hub_sent_append.go`, `server/internal/service/email_hub_sent_append_test.go`
- Modify: `server/internal/service/email_hub_needs_reconnect_test.go:69-79`. `countSMTPSends` uses the new hook shape.

Why: a custom server's SMTP does not file a Sent copy. Without one, the first reconcile prunes the local Sent row (placeholder UID `now.Unix() & 0x7fffffff`), and the mail vanishes from Sent (spec §4.5).
- With APPENDUID: the local row takes the real UID, and the upsert's `ON CONFLICT (account_id, folder, imap_uid)` merges it with the Sent sync.
- Without UIDPLUS: the row keeps the placeholder, and GĐ1's `AdoptEmailHubSentCopy` adopts it by Message-ID on the next Sent sync, before the prune.

**Interfaces:**
- Consumes:
  - From Task 4: `emailHubErrCode`.
  - From Task 2: `seedCustomEmailHubAccount(t, q, box, userID, orgID, email, imapHost)`.
  - From GĐ1:
    - `openIMAPWithMailboxes(ctx, acc) (*imapclient.Session, imapclient.MailboxMap, error)`. It runs `handleAuthError` on an open failure.
    - `gov.withIMAP`, `MailboxMap.Resolve` (SPECIAL-USE `\Sent`, falling back to `"SENT"` for custom), `emailhub.FolderSent`.
    - `cacheFolderItems`.
    - `seedEmailHubAccount`, `seedDueEmailHubScheduledSend`, `scheduledSendOutcome`, `runScheduledSendOnce`.
  - From go-imap v1.2.1: `(*client.Client).Execute`, `commands.Append`, `imap.ParseNumber`.
- Produces:
  - smtpclient: `func Send(ctx context.Context, c Credentials, msg Message) (string, []byte, error)`. It returns the Message-ID and the MIME exactly as written after DATA: CRLF line endings, no Bcc header, not dot-stuffed.
  - imapclient: `func (s *Session) Append(mailbox string, flags []string, date time.Time, raw []byte) (uint32, error)`. It returns the APPENDUID UID, or `0, nil` when the server reports none.
  - emailhub: `func ServerSavesSent(imapHost string) bool`. True for `imap.gmail.com` and `outlook.office365.com`, case-insensitive.
  - service:
    - `testHookSMTPSend func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error)`.
    - `testHookAppendSent func(ctx context.Context, acc db.EmailHubAccount, raw []byte) (uint32, error)`.
    - `func (s *EmailHubService) appendSentCopy(ctx context.Context, acc db.EmailHubAccount, raw []byte, at time.Time) uint32`.
  - Log line: `msg="email hub sent copy append failed"`, with `account_id` and `code` only.

- [ ] **Step 1: Write the failing tests**

1a. `server/internal/emailhub/imapclient/fake_server_test.go`. Add `"io"` and `"strconv"` to the imports, and add a `literals []string` field next to `cmds` in `fakeIMAP`. In `serve`, insert this right after the `if line == "DONE" { ... }` block and before `tag, cmd, _ := strings.Cut(line, " ")`:

```go
		if n, ok := literalSize(line); ok {
			// A synchronizing literal (APPEND): invite it, then read it and the CRLF ending the command.
			fmt.Fprint(w, "+ go\r\n")
			_ = w.Flush()
			lit := make([]byte, n)
			if _, err := io.ReadFull(r, lit); err != nil {
				return
			}
			if _, err := r.ReadString('\n'); err != nil {
				return
			}
			f.mu.Lock()
			f.literals = append(f.literals, string(lit))
			f.mu.Unlock()
		}
```

In the `switch verb` of `serve`, add before `default:`:

```go
		case "APPEND":
			if strings.Contains(f.caps, "UIDPLUS") {
				fmt.Fprintf(w, "%s OK [APPENDUID 7 42] APPEND completed\r\n", tag)
			} else {
				fmt.Fprintf(w, "%s OK done\r\n", tag)
			}
```

Append at the end of the file:

```go
// appended returns the literals the fake received, in order.
func (f *fakeIMAP) appended() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.literals...)
}

// literalSize parses a trailing synchronizing literal "{N}" (RFC 3501 §4.3).
func literalSize(line string) (int, bool) {
	open := strings.LastIndexByte(line, '{')
	if open < 0 || !strings.HasSuffix(line, "}") {
		return 0, false
	}
	n, err := strconv.Atoi(line[open+1 : len(line)-1])
	return n, err == nil
}
```

1b. Create `server/internal/emailhub/imapclient/append_test.go`:

```go
package imapclient

import (
	"bufio"
	"fmt"
	"strings"
	"testing"
	"time"
)

var appendRaw = []byte("From: user@example.com\r\nTo: dest@example.com\r\nSubject: Hi\r\n" +
	"Message-ID: <a1@example.com>\r\n\r\nHello\r\n")

func appendCommand(f *fakeIMAP) string {
	for _, c := range f.commands() {
		if strings.HasPrefix(c, "APPEND ") {
			return c
		}
	}
	return ""
}

func TestSessionAppendReturnsAPPENDUID(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "UIDPLUS"}
	sess, err := OpenSession(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess, 2*time.Second)
	at := time.Date(2026, 10, 11, 9, 30, 0, 0, time.UTC)
	uid, err := sess.Append("Sent", []string{`\Seen`}, at, appendRaw)
	if err != nil || uid != 42 {
		t.Fatalf("Append = %d, %v; want 42 from APPENDUID", uid, err)
	}
	want := fmt.Sprintf(`APPEND "Sent" (\Seen) "11-Oct-2026 09:30:00 +0000" {%d}`, len(appendRaw))
	if got := appendCommand(f); got != want {
		t.Fatalf("APPEND line = %q, want %q", got, want)
	}
	if lits := f.appended(); len(lits) != 1 || lits[0] != string(appendRaw) {
		t.Fatalf("literal = %q, want the raw message byte for byte", lits)
	}
}

func TestSessionAppendWithoutUIDPLUS(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	sess, err := OpenSession(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess, 2*time.Second)
	uid, err := sess.Append("Sent", []string{`\Seen`}, time.Now(), appendRaw)
	if err != nil || uid != 0 {
		t.Fatalf("plain OK: Append = %d, %v; want 0, nil", uid, err)
	}

	refused := &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "APPEND ") {
			return false
		}
		fmt.Fprintf(w, "%s NO [TRYCREATE] Mailbox does not exist\r\n", tag)
		return true
	}}
	sess2, err := OpenSession(refused.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer closeWithin(t, sess2, 2*time.Second)
	if uid, err := sess2.Append("SENT", []string{`\Seen`}, time.Now(), appendRaw); err == nil || uid != 0 {
		t.Fatalf("NO [TRYCREATE]: Append = %d, %v; want an error", uid, err)
	}
}
```

1c. smtpclient call sites:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && perl -pi -e 's/\b_, err := Send\(/_, _, err := Send(/' internal/emailhub/smtpclient/send_test.go internal/emailhub/smtpclient/session_test.go
```

In `session_test.go:36`, change `msgID, err := Send(testCtx(t), c, testMessage())` to `msgID, _, err := Send(testCtx(t), c, testMessage())`. Then append to `session_test.go`:

```go
// Send returns exactly what DATA carried, so the caller can file it in Sent;
// Bcc recipients get the mail but never appear in it.
func TestSendReturnsTheRawItWrote(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true})
	msg := testMessage()
	msg.Bcc = []string{"hidden@example.com"}
	msgID, raw, err := Send(testCtx(t), f.creds("tls"), msg)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if string(raw) != got.data {
		t.Fatalf("raw differs from DATA:\nraw:\n%s\ndata:\n%s", raw, got.data)
	}
	if !strings.Contains(string(raw), "Message-ID: "+msgID+"\r\n") {
		t.Fatalf("raw lacks the Message-ID header %q:\n%s", msgID, raw)
	}
	if strings.Contains(string(raw), "hidden@example.com") || strings.Contains(string(raw), "Bcc:") {
		t.Fatalf("raw leaks the Bcc recipient:\n%s", raw)
	}
	if len(got.rcpts) != 2 {
		t.Fatalf("RCPT = %v, want the To and the Bcc recipient", got.rcpts)
	}
}
```

1d. Append to `server/internal/emailhub/provider_test.go`:

```go
func TestServerSavesSent(t *testing.T) {
	t.Parallel()
	for host, want := range map[string]bool{
		"imap.gmail.com":        true,
		"OUTLOOK.office365.com": true,
		"imap.mail.yahoo.com":   false,
		"mail.example.com":      false,
		"":                      false,
	} {
		if got := ServerSavesSent(host); got != want {
			t.Errorf("ServerSavesSent(%q) = %v, want %v", host, got, want)
		}
	}
}
```

1e. In `server/internal/service/email_hub_needs_reconnect_test.go`, replace `countSMTPSends`:

```go
func countSMTPSends(svc *EmailHubService, err error) *atomic.Int32 {
	var calls atomic.Int32
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error) {
		calls.Add(1)
		if err != nil {
			return "", nil, err
		}
		return "<sent@example.com>", nil, nil
	}
	return &calls
}
```

1f. Create `server/internal/service/email_hub_sent_append_test.go`. It reuses Task 2's `seedCustomEmailHubAccount` with a random address, so it declares no seed helper of its own:

```go
package service

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const sentCopyMsgID = "<sent-copy@acme.example>"

var sentCopyRaw = []byte("From: me@acme.example\r\nTo: dest@example.com\r\nSubject: Hi\r\n" +
	"Message-ID: " + sentCopyMsgID + "\r\n\r\nBody\r\n")

// seedSentAppendAccount seeds a live custom-server mailbox on imapHost under a
// fresh address, so each send gets its own placeholder UID space.
func seedSentAppendAccount(t *testing.T, svc *EmailHubService, q *db.Queries, userID, orgID, imapHost string) db.EmailHubAccount {
	t.Helper()
	return seedCustomEmailHubAccount(t, q, svc.box, userID, orgID, strings.ToLower(util.NewID())+"@acme.example", imapHost)
}

// stubSentAppend makes SMTP succeed with sentCopyRaw and records every raw
// message APPEND receives; APPEND answers uid and appendErr.
func stubSentAppend(svc *EmailHubService, uid uint32, appendErr error) *[][]byte {
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error) {
		return sentCopyMsgID, sentCopyRaw, nil
	}
	var got [][]byte
	svc.testHookAppendSent = func(_ context.Context, _ db.EmailHubAccount, raw []byte) (uint32, error) {
		got = append(got, raw)
		return uid, appendErr
	}
	return &got
}

func sentCopyMail(accountID string) SendEmailHubInput {
	return SendEmailHubInput{AccountID: accountID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body"}
}

func sentThreadRow(t *testing.T, q *db.Queries, acc db.EmailHubAccount, id string) db.EmailHubThread {
	t.Helper()
	row, err := q.GetEmailHubThread(context.Background(), db.GetEmailHubThreadParams{
		ID: id, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.Folder != emailhub.FolderSent {
		t.Fatalf("sent row folder = %q", row.Folder)
	}
	return row
}

func sentRowCount(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM email_hub_threads WHERE account_id = $1 AND folder = $2`,
		accountID, emailhub.FolderSent).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func isPlaceholderUID(uid int32) bool {
	now := int32(time.Now().Unix() & 0x7fffffff)
	return uid > now-60 && uid <= now
}

func TestEmailHubSendAppendsCustomSentCopy(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()

	t.Run("APPENDUID becomes the local UID", func(t *testing.T) {
		acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
		appended := stubSentAppend(svc, 4242, nil)
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatal(err)
		}
		if len(*appended) != 1 || !bytes.Equal((*appended)[0], sentCopyRaw) {
			t.Fatalf("APPEND got %q, want exactly the MIME SMTP sent", *appended)
		}
		if row := sentThreadRow(t, q, acc, view.ID); row.ImapUid != 4242 {
			t.Fatalf("imap_uid = %d, want the APPENDUID 4242", row.ImapUid)
		}
	})

	t.Run("APPENDUID above int32 keeps the placeholder", func(t *testing.T) {
		acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
		stubSentAppend(svc, uint32(math.MaxInt32)+1, nil)
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatal(err)
		}
		if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
			t.Fatalf("imap_uid = %d, want the placeholder (imap_uid is INTEGER)", row.ImapUid)
		}
	})
}

// A server without UIDPLUS: the local row keeps the placeholder, and the next
// Sent reconcile adopts it by Message-ID, so the message shows exactly once.
func TestEmailHubSendWithoutAppendUIDShowsOnceAfterSync(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
	appended := stubSentAppend(svc, 0, nil)
	view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(*appended) != 1 {
		t.Fatalf("APPEND calls = %d, want 1", len(*appended))
	}
	if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
		t.Fatalf("imap_uid = %d before sync, want the placeholder", row.ImapUid)
	}

	server := []imapclient.ThreadMeta{{
		UID: 77, MessageID: sentCopyMsgID, Subject: "Hi", FromAddr: acc.EmailAddress,
		ToAddrs: []string{"dest@example.com"}, SentAt: time.Now().UTC(), IsRead: true,
	}}
	if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderSent, server, true); err != nil {
		t.Fatal(err)
	}
	if n := sentRowCount(t, pool, acc.ID); n != 1 {
		t.Fatalf("Sent rows = %d after sync, want exactly 1", n)
	}
	if row := sentThreadRow(t, q, acc, view.ID); row.ImapUid != 77 {
		t.Fatalf("local row imap_uid = %d, want the server UID 77 on the same id", row.ImapUid)
	}
}

// Gmail and Microsoft 365 file Sent themselves, also for a custom domain hosted there.
func TestEmailHubSendSkipsAppend(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	accounts := []db.EmailHubAccount{
		seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), // preset gmail
		seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "imap.gmail.com"),
		seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "outlook.office365.com"),
	}
	appended := stubSentAppend(svc, 4242, nil)
	for _, acc := range accounts {
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatalf("%s on %s: %v", acc.Provider, acc.ImapHost, err)
		}
		if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
			t.Fatalf("%s on %s: imap_uid = %d, want the placeholder", acc.Provider, acc.ImapHost, row.ImapUid)
		}
	}
	if len(*appended) != 0 {
		t.Fatalf("APPEND ran %d times for hosts that file Sent themselves", len(*appended))
	}
}

// The recipient already has the mail: a failed APPEND is logged by code and
// the send still succeeds with its local Sent row.
func TestEmailHubAppendFailureKeepsTheSend(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.secret.example")
	stubSentAppend(svc, 0, errors.New("imap append to mail.secret.example:993: NO [TRYCREATE] no mailbox"))
	view, err := svc.Send(context.Background(), Human(user.ID), ws.ID, sentCopyMail(acc.ID))
	if err != nil {
		t.Fatalf("a failed APPEND must not fail the send: %v", err)
	}
	if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
		t.Fatalf("imap_uid = %d, want the placeholder", row.ImapUid)
	}
	out := logs.String()
	if !strings.Contains(out, `msg="email hub sent copy append failed"`) || !strings.Contains(out, "code=") {
		t.Fatalf("want the append failure logged with a code:\n%s", out)
	}
	if strings.Contains(out, "mail.secret.example") || strings.Contains(out, acc.EmailAddress) {
		t.Fatalf("the log carries the host or the address:\n%s", out)
	}
}

func TestEmailHubScheduledSendAppendsCustomSentCopy(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	appended := stubSentAppend(svc, 4243, nil)

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "sent" {
		t.Fatalf("scheduled send status = %q (%q), want sent", status, lastErr)
	}
	if len(*appended) != 1 {
		t.Fatalf("APPEND calls = %d, want 1 for a scheduled send", len(*appended))
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 ./internal/emailhub/...
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubSendAppendsCustomSentCopy|TestEmailHubSendWithoutAppendUIDShowsOnceAfterSync'
```

Expected build failures:
- emailhub: `undefined: ServerSavesSent`
- imapclient: `sess.Append undefined`
- smtpclient: `assignment mismatch: 3 variables but Send returns 2 values`
- service: `cannot use func(...) (string, []byte, error) ... as func(...) (string, error)` and `svc.testHookAppendSent undefined`

- [ ] **Step 3: smtpclient Send returns the raw MIME**

In `server/internal/emailhub/smtpclient/send.go`, replace `Send` (lines 49-89). The results are unnamed, because the body declares `msgID` and `raw` with `:=`.

```go
// Send delivers a message over implicit TLS or required STARTTLS, per c.Security.
// It returns the Message-ID and the MIME exactly as written after DATA (no Bcc
// header, before dot-stuffing), which the caller can file in the Sent mailbox.
func Send(ctx context.Context, c Credentials, msg Message) (string, []byte, error) {
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	to := cleanAddrs(msg.To)
	if len(to) == 0 {
		return "", nil, fmt.Errorf("smtp: at least one recipient required")
	}
	msgID := strings.TrimSpace(msg.MessageID)
	if msgID == "" {
		msgID = newMessageID(c.Email)
	}
	raw := []byte(buildRaw(c.Email, to, msg.Cc, msg.Bcc, msg.Subject, msg.BodyText, msg.BodyHTML, msg.Attachments, msgID, msg.InReplyTo, msg.References))

	client, err := authenticate(ctx, c)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = client.Close() }()

	if err := client.Mail(c.Email); err != nil {
		return "", nil, fmt.Errorf("smtp mail from: %w", err)
	}
	for _, rcpt := range append(append(to, cleanAddrs(msg.Cc)...), cleanAddrs(msg.Bcc)...) {
		if err := client.Rcpt(rcpt); err != nil {
			return "", nil, fmt.Errorf("smtp rcpt %s: %w", rcpt, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return "", nil, fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return "", nil, fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", nil, fmt.Errorf("smtp close data: %w", err)
	}
	return msgID, raw, nil
}
```

- [ ] **Step 4: imapclient Session.Append keeps APPENDUID**

In `server/internal/emailhub/imapclient/session.go`, set the imports to:

```go
import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
)
```

Add right after `MarkStarred`:

```go
// Append stores raw in mailbox (RFC 3501 §6.3.11) and returns the UID the
// server reports through APPENDUID (RFC 4315), or 0 when it reports none.
func (s *Session) Append(mailbox string, flags []string, date time.Time, raw []byte) (uint32, error) {
	if s.cl == nil {
		return 0, fmt.Errorf("imap: session closed")
	}
	// client.Append drops the response code, so the command runs directly.
	status, err := s.cl.Execute(&commands.Append{
		Mailbox: mailbox, Flags: flags, Date: date, Message: bytes.NewBuffer(raw),
	}, nil)
	if err != nil {
		return 0, err
	}
	if err := status.Err(); err != nil {
		return 0, fmt.Errorf("imap append: %w", err)
	}
	if status.Code != "APPENDUID" || len(status.Arguments) < 2 {
		return 0, nil
	}
	uid, _ := imap.ParseNumber(status.Arguments[1]) // a malformed code means no UID, not a failed APPEND
	return uid, nil
}
```

- [ ] **Step 5: emailhub.ServerSavesSent**

Append to `server/internal/emailhub/provider.go`:

```go
// ServerSavesSent reports whether mail submitted over SMTP for a mailbox on
// this IMAP host is filed in Sent by the server itself (Gmail, Microsoft 365,
// including custom domains hosted there), so an IMAP APPEND would duplicate it.
func ServerSavesSent(imapHost string) bool {
	switch strings.ToLower(imapHost) {
	case "imap.gmail.com", "outlook.office365.com":
		return true
	}
	return false
}
```

- [ ] **Step 6: Service: APPEND after SMTP, use the APPENDUID**

6a. In `server/internal/service/email_hub.go`, replace the hook comment and the `testHookSMTPSend` field:

```go
	// scheduleWorkerOwnerFn, testHookScheduledSend, testHookSMTPSend and
	// testHookAppendSent are set only in tests.
	scheduleWorkerOwnerFn func() string
	testHookScheduledSend func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error
	testHookSMTPSend      func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error)
	testHookAppendSent    func(ctx context.Context, acc db.EmailHubAccount, raw []byte) (uint32, error)
```

6b. In `sendOutboundMail`, change `msgID, err := send(ctx, creds.SMTP, smtpclient.Message{` to `msgID, raw, err := send(ctx, creds.SMTP, smtpclient.Message{`, and replace

```go
	now := time.Now().UTC()
	snippet := imapclient.CleanSnippet(imapclient.SnippetFromBody(body, bodyHTML))
	row, err := s.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: organizationID,
		Folder: emailhub.FolderSent, ImapUid: int32(now.Unix() & 0x7fffffff),
```

with

```go
	now := time.Now().UTC()
	// Placeholder until the Sent sync adopts the server's copy by Message-ID.
	uid := int32(now.Unix() & 0x7fffffff)
	if acc.Provider == "custom" && !emailhub.ServerSavesSent(acc.ImapHost) {
		if appended := s.appendSentCopy(ctx, acc, raw, now); appended != 0 {
			uid = int32(appended)
		}
	}
	snippet := imapclient.CleanSnippet(imapclient.SnippetFromBody(body, bodyHTML))
	row, err := s.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: organizationID,
		Folder: emailhub.FolderSent, ImapUid: uid,
```

Nothing else in the upsert changes. Scheduled sends reach the same code through `deliverScheduledSendOutbound` → `sendOutboundMail`. If `send` is a local func variable typed after the hook, update its type to the three-result form.

6c. Create `server/internal/service/email_hub_sent_append.go`:

```go
package service

import (
	"context"
	"math"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// appendSentCopy files the MIME just sent over SMTP in the server's Sent
// mailbox, for hosts that do not file it themselves (spec §4.5). It returns the
// APPENDUID when the server gives one that fits imap_uid (INTEGER), otherwise 0
// and the caller keeps its placeholder UID. A failure is only logged, by code:
// the recipient already has the mail, so the send never fails and is not retried.
func (s *EmailHubService) appendSentCopy(ctx context.Context, acc db.EmailHubAccount, raw []byte, at time.Time) uint32 {
	var uid uint32
	var err error
	if s.testHookAppendSent != nil {
		uid, err = s.testHookAppendSent(ctx, acc, raw)
	} else {
		err = s.gov.withIMAP(acc.ID, func() error {
			// An auth refusal here already went through handleAuthError.
			sess, mailboxes, openErr := s.openIMAPWithMailboxes(ctx, acc)
			if openErr != nil {
				return openErr
			}
			defer sess.Close()
			var appendErr error
			uid, appendErr = sess.Append(mailboxes.Resolve(emailhub.FolderSent), []string{`\Seen`}, at, raw)
			return appendErr
		})
	}
	if err != nil {
		s.log.Warn("email hub sent copy append failed", "account_id", acc.ID, "code", emailHubErrCode(err))
		return 0
	}
	if uid > math.MaxInt32 {
		return 0 // the next Sent sync adopts the placeholder row by Message-ID
	}
	return uid
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 -race ./internal/emailhub/...
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubSendAppendsCustomSentCopy|TestEmailHubSendWithoutAppendUIDShowsOnceAfterSync|TestEmailHubSendSkipsAppend|TestEmailHubAppendFailureKeepsTheSend|TestEmailHubScheduledSendAppendsCustomSentCopy|TestEmailHubNeedsReconnect|TestEmailHubSendFailureLogsTheClassifiedCode|TestEmailHubSentSyncAdoptsTheLocalSentRow|TestEmailHubSchedule'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/emailhub ./internal/service && go vet ./internal/emailhub/... ./internal/service/ && go tool staticcheck ./internal/emailhub/... ./internal/service/
```

Expected: everything passes and `gofmt -l` prints nothing. The `TestEmailHubNeedsReconnect*` tests use gmail presets, so they never attempt an APPEND.

- [ ] **Step 8: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/internal/emailhub/smtpclient/send.go server/internal/emailhub/smtpclient/send_test.go server/internal/emailhub/smtpclient/session_test.go server/internal/emailhub/imapclient/session.go server/internal/emailhub/imapclient/append_test.go server/internal/emailhub/imapclient/fake_server_test.go server/internal/emailhub/provider.go server/internal/emailhub/provider_test.go server/internal/service/email_hub.go server/internal/service/email_hub_sent_append.go server/internal/service/email_hub_sent_append_test.go server/internal/service/email_hub_needs_reconnect_test.go
git commit -m "feat(email-hub): file sent mail in the server's Sent folder for custom hosts" -m "A custom IMAP/SMTP server keeps no Sent copy of mail submitted over SMTP, so the local Sent row with its placeholder UID was pruned at the first reconcile and the mail vanished from Sent. After a successful SMTP send, a custom account whose IMAP host is not Gmail or Microsoft 365 APPENDs the exact MIME that went out (\\Seen) to the SPECIAL-USE Sent mailbox under the per-account IMAP lock. An APPENDUID that fits imap_uid becomes the local row's UID; without UIDPLUS the placeholder stays and the Sent sync adopts it by Message-ID. smtpclient.Send returns the raw MIME; imapclient gains Session.Append, which keeps the APPENDUID code go-imap's client.Append drops. APPEND failures are logged by code and never fail or retry the send. Left out: retrying a failed APPEND, creating Sent on TRYCREATE, a name-based Sent fallback, and LITERAL+ coverage in the fake." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Known limits, for the controller:
- The send waits on the IMAP lock when a long sync holds it.
- On a server without UIDPLUS, a Sent sync that runs between APPEND and the local upsert can show the message twice until the next reconcile.
- Two sends in the same second share a placeholder UID. This is a GĐ1 issue that APPENDUID fixes only on UIDPLUS servers.

### Task 6: Client core: account schema server fields and connect endpoint with a server

**Files:**
- Modify: `packages/core/types/email-hub.ts:3-13` (`EmailHubAccountSchema`). Add the new types after `EmailHubThreadFilters` (ends at line 117).
- Modify: `packages/core/api/endpoints/email-hub.ts`:
  - type import block (lines 15-21)
  - `connectEmailHubAccount` (lines 59-67)
- Modify: `packages/core/email-hub/hooks.ts`:
  - line 8: type import
  - lines 223-224: `useConnectEmailHubAccount` mutationFn
- Test: `packages/core/api/endpoints/email-hub.test.ts`:
  - import `connectEmailHubAccount`
  - add the new cases after the `listEmailHubAccounts keeps needs_reconnect…` case, which ends at line 83

**Interfaces:**
- Consumes: the Task 2 JSON contract.
  - SDO fields `imap_host`, `imap_port` (number), `imap_security`, `smtp_host`, `smtp_port` (number), `smtp_security`, `username`.
  - SDI takes the same names plus `email_address` and `app_password`.
  - A 400 carries `error.fields.field`, which `http.ts` already surfaces as `ApiError.fields`. Read it with `errorFields(err)`.
- Produces:
  - `EmailHubAccountSchema` gains seven fields, each wrapped in `.optional().catch(undefined)`: `imap_host`, `imap_security`, `smtp_host`, `smtp_security` and `username` as `z.string()`, and `imap_port`, `smtp_port` as `z.number()`.
  - `type EmailHubServerSecurity = "tls" | "starttls"`. It is not exported, because knip would flag it with no outside consumer. Task 7 derives it with `EmailHubCustomServer["imap_security"]`.
  - `export interface EmailHubCustomServer { imap_host: string; imap_port: number; imap_security: EmailHubServerSecurity; smtp_host: string; smtp_port: number; smtp_security: EmailHubServerSecurity; username?: string }`. Its keys are the SDI JSON names.
  - `connectEmailHubAccount(workspaceId, emailAddress, appPassword, server?: EmailHubCustomServer): Promise<EmailHubAccount | null>`
  - `useConnectEmailHubAccount(wsId)` input `{ email: string; appPassword: string; server?: EmailHubCustomServer }`

- [ ] **Step 1: Write the failing tests**

In `packages/core/api/endpoints/email-hub.test.ts`, add `connectEmailHubAccount,` to the import list from `"./email-hub"`. Then add these cases inside `describe("email hub endpoints", …)`, right after the `listEmailHubAccounts keeps needs_reconnect and degrades when it is not a boolean` case. The existing `fills the reconnect fields an older server leaves out` case stays unchanged and must keep passing.

```ts
  const customServer = {
    imap_host: "mail.example.vn",
    imap_port: 993,
    imap_security: "tls",
    smtp_host: "mail.example.vn",
    smtp_port: 587,
    smtp_security: "starttls",
    username: "an",
  };

  it("listEmailHubAccounts keeps the mail server fields", async () => {
    const acc = {
      id: "acc1",
      email_address: "an@example.vn",
      provider: "custom",
      connected_at: "2026-09-01T00:00:00Z",
      auth_kind: "password",
      needs_reconnect: false,
      auth_failed_reason: "",
      ...customServer,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [acc] }));
    await expect(listEmailHubAccounts("ws1")).resolves.toEqual({ accounts: [acc] });
  });

  it("listEmailHubAccounts drops only a malformed server field and keeps an unknown auth_kind", async () => {
    const acc = {
      id: "acc1",
      email_address: "an@example.vn",
      provider: "custom",
      connected_at: "2026-09-01T00:00:00Z",
      auth_kind: "oauth_future",
      needs_reconnect: false,
      auth_failed_reason: "",
      ...customServer,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [{ ...acc, imap_port: "x", smtp_host: 7 }] }));
    const { accounts } = await listEmailHubAccounts("ws1");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.imap_port).toBeUndefined();
    expect(accounts[0]!.smtp_host).toBeUndefined();
    expect(accounts[0]).toEqual({ ...acc, imap_port: undefined, smtp_host: undefined });
    expect(accounts[0]!.auth_kind).toBe("oauth_future");
  });

  it("connectEmailHubAccount posts only the address and password when no server is given", async () => {
    const acc = { id: "acc1", email_address: "a@gmail.com", provider: "gmail", connected_at: "2026-09-01T00:00:00Z" };
    vi.mocked(fetch).mockResolvedValueOnce(json(acc, 201));
    await expect(connectEmailHubAccount("ws1", "a@gmail.com", "abcdabcdabcdabcd")).resolves.toEqual({
      ...acc,
      auth_kind: "password",
      needs_reconnect: false,
      auth_failed_reason: "",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/workspaces/ws1/email-hub/accounts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ email_address: "a@gmail.com", app_password: "abcdabcdabcdabcd" });
  });

  it("connectEmailHubAccount posts the server fields with numeric ports and the username", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        { id: "acc1", email_address: "an@example.vn", provider: "custom", connected_at: "2026-09-01T00:00:00Z", ...customServer },
        201,
      ),
    );
    const server = { ...customServer, imap_security: "tls" as const, smtp_security: "starttls" as const };
    const acc = await connectEmailHubAccount("ws1", "an@example.vn", " pass word ", server);
    expect(acc?.provider).toBe("custom");
    expect(acc?.imap_port).toBe(993);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)) as Record<string, unknown>;
    // The password goes out exactly as typed; ports are JSON numbers, because the server's decode refuses "993".
    expect(body).toEqual({ email_address: "an@example.vn", app_password: " pass word ", ...customServer });
    expect(typeof body.imap_port).toBe("number");
    expect(typeof body.smtp_port).toBe("number");
  });

  it("connectEmailHubAccount degrades to null when the response is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 1 }, 201));
    await expect(connectEmailHubAccount("ws1", "a@gmail.com", "pw")).resolves.toBeNull();
  });

  it("connectEmailHubAccount surfaces the field a server refusal names", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        {
          error: {
            code: "email_hub_host_not_allowed",
            message: "mail server address not allowed",
            fields: { field: "imap_host" },
          },
        },
        400,
      ),
    );
    await expect(
      connectEmailHubAccount("ws1", "an@example.vn", "pw", {
        ...customServer,
        imap_host: "10.0.0.1",
        imap_security: "tls",
        smtp_security: "starttls",
      }),
    ).rejects.toMatchObject({ code: "email_hub_host_not_allowed", status: 400, fields: { field: "imap_host" } });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false api/endpoints/email-hub.test.ts
```

Expected failures:
- `keeps the mail server fields`, because zod strips the unknown keys.
- `drops only a malformed server field…`, at `toEqual`.
- `posts the server fields…`, because the body carries only the address and password, and `acc?.imap_port` is undefined.

These cases already pass and pin existing behaviour: `posts only the address and password…`, `degrades to null…`, `surfaces the field…`, and the existing older-server case.

- [ ] **Step 3: Implement the schema, type, endpoint and hook**

`packages/core/types/email-hub.ts`. Replace lines 3-13:

```ts
export const EmailHubAccountSchema = z.object({
  id: z.string(),
  email_address: z.string(),
  provider: z.string(),
  connected_at: z.string(),
  last_sync_at: z.string().optional(),
  // An older server sends none of these; the defaults read as a healthy password account.
  auth_kind: z.string().default("password"),
  needs_reconnect: z.boolean().default(false),
  auth_failed_reason: z.string().default(""),
  // The mail server, so reconnecting a custom account can prefill its form. Each field
  // degrades alone: a drifted value drops that field, never the whole account.
  imap_host: z.string().optional().catch(undefined),
  imap_port: z.number().optional().catch(undefined),
  imap_security: z.string().optional().catch(undefined),
  smtp_host: z.string().optional().catch(undefined),
  smtp_port: z.number().optional().catch(undefined),
  smtp_security: z.string().optional().catch(undefined),
  username: z.string().optional().catch(undefined),
});
```

After the `EmailHubThreadFilters` interface, insert:

```ts

type EmailHubServerSecurity = "tls" | "starttls";

/** A custom IMAP/SMTP server for connect. Keys are the request's JSON names; the password travels beside it. */
export interface EmailHubCustomServer {
  imap_host: string;
  imap_port: number;
  imap_security: EmailHubServerSecurity;
  smtp_host: string;
  smtp_port: number;
  smtp_security: EmailHubServerSecurity;
  /** Login name when it is not the address; empty or absent means the address. */
  username?: string;
}
```

`packages/core/api/endpoints/email-hub.ts`. Add `type EmailHubCustomServer,` after `type EmailHubAccount,` in the type import block, then replace `connectEmailHubAccount`:

```ts
export async function connectEmailHubAccount(
  workspaceId: string,
  emailAddress: string,
  appPassword: string,
  server?: EmailHubCustomServer,
) {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/accounts`, {
    method: "POST",
    // No server keeps the GĐ1 body: the server picks the preset by the address's domain.
    body: { email_address: emailAddress, app_password: appPassword, ...server },
  });
  return parseWithFallback<EmailHubAccount | null>(raw, EmailHubAccountSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/accounts",
  });
}
```

`packages/core/email-hub/hooks.ts`. Replace line 8:

```ts
import type { EmailHubCustomServer, EmailHubThread, EmailHubThreadFilters } from "../types/email-hub";
```

In `useConnectEmailHubAccount`, replace the two `mutationFn` lines:

```ts
    mutationFn: (input: { email: string; appPassword: string; server?: EmailHubCustomServer }) =>
      api.connectEmailHubAccount(wsId, input.email, input.appPassword, input.server),
```

The dialog's existing `connect.mutate({ email: trimmed, appPassword }, …)` still compiles; Task 8 changes that call.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false api/endpoints/email-hub.test.ts email-hub
```

Expected: every case passes. In zod 4 a key missing from the input stays absent from the output, and a caught key becomes `undefined`, which `toEqual` treats as absent.

- [ ] **Step 5: Typecheck, lint and knip**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/core typecheck && pnpm --filter @uniwork/views typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && pnpm exec eslint --max-warnings 0 types/email-hub.ts api/endpoints/email-hub.ts api/endpoints/email-hub.test.ts email-hub/hooks.ts
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm knip
```

Expected:
- Both typechecks are clean, and eslint reports 0 problems.
- knip reports nothing new: `EmailHubCustomServer` is imported by the endpoint and the hook, and `EmailHubServerSecurity` is not exported.

- [ ] **Step 6: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add packages/core/types/email-hub.ts packages/core/api/endpoints/email-hub.ts \
  packages/core/api/endpoints/email-hub.test.ts packages/core/email-hub/hooks.ts
git commit -m "feat(email-hub): read mail server fields and send a custom server on connect" \
  -m "The account schema reads imap/smtp host, port, security and username so reconnecting a custom account can prefill its form. Each field is optional and caught, so one drifted value drops that field instead of emptying the account list. connectEmailHubAccount and the connect mutation take an optional server whose keys are the SDI names, with numeric ports; without one the body is unchanged from GD1. Tests pin both bodies, the malformed connect response, a refusal's fields.field and an unknown auth_kind. Left out: narrowing auth_kind, the providers endpoint and OAuth start (GD3)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Custom-server form and shared connect error mapping

**Files:**
- Create: `packages/views/email-hub/connect-account-errors.ts`
- Create: `packages/views/email-hub/connect-custom-server-form.tsx`
- Create: `packages/views/email-hub/connect-custom-server-form.test.tsx`
- Modify: `packages/views/email-hub/connect-account-dialog.tsx`:
  - line 5: the `errorCode` import
  - lines 25-47: `connectError`, which moves out to the new errors file
  - line 61: `serverError`
  - line 68: `formError`
- Modify: `packages/core/i18n/locales/vi.json:1361` and `packages/core/i18n/locales/en.json:1362`. Both lines are `error_unreachable`, the last key of `email_hub.connect`.
- Test: `packages/views/email-hub/connect-account-dialog.test.tsx` gets no change. Its existing cases must still pass.

**Interfaces:**
- Consumes:
  - From Task 6:
    - `import type { EmailHubAccount, EmailHubCustomServer } from "@uniwork/core/types/email-hub"`
    - the optional server fields on `EmailHubAccount`
  - `errorCode`, `errorFields` and `ApiError` (tests only) from `@uniwork/core/api/http`
  - `EMAIL_RE` from `../workspace/email-chips-input`
  - `FormDialogBody` and `FormDialogFooter` (prop `leading`) from `../common/form-dialog`
  - `Input`, `Label`, `Button`, `RadioGroup` and `RadioGroupItem` from `@uniwork/ui/components/ui/*`
- Produces:
  - `export type ConnectErrorField = "email" | "password" | "form" | "username" | "imap_host" | "imap_port" | "imap_security" | "smtp_host" | "smtp_port" | "smtp_security"`
  - `export function connectError(err: unknown): { field: ConnectErrorField; key: string }`. It now takes the error itself instead of the code. `email_address` maps to `"email"`, and the switch has a `default`.
  - `export function ConnectCustomServerForm(props: { formId: string; initial?: EmailHubAccount; pending: boolean; error: unknown; onCancel: () => void; onBack?: () => void; onSubmit: (input: { email: string; appPassword: string; server: EmailHubCustomServer }) => void }): JSX.Element`. It renders `FormDialogBody` and `FormDialogFooter`; the dialog owns the header. `initial` is read once, at mount.
  - i18n keys under `email_hub.connect`, in both en and vi:
    - flat: `error_invalid_server`, `error_host_not_allowed`, `error_rate_limited`, `security_tls`, `security_starttls`, `back`
    - under `custom.`: `title`, `description`, `email_placeholder`, `username`, `username_hint`, `password`, `imap_heading`, `smtp_heading`, `host`, `host_placeholder`, `port`, `security`, `error_host_required`, `error_port_format`
  - DOM contract:
    - Each field input has id `email-hub-custom-<field>`, and its error text has id `email-hub-custom-<field>-error`.
    - IMAP and SMTP are each a `<fieldset>`, with the heading as its `<legend>`.
    - The security radios come in the order SSL/TLS, then STARTTLS.

- [ ] **Step 1: Write the failing test**

Create `packages/views/email-hub/connect-custom-server-form.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import { wrap } from "../test/api-mock";
import { ConnectCustomServerForm } from "./connect-custom-server-form";

function renderForm({ error = null, initial }: { error?: unknown; initial?: EmailHubAccount } = {}) {
  const onSubmit = vi.fn();
  render(
    wrap(
      <ConnectCustomServerForm
        formId="custom-form"
        pending={false}
        error={error}
        initial={initial}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    ),
  );
  return onSubmit;
}

const imap = () => within(screen.getByRole("group", { name: "Thư đến (IMAP)" }));
const smtp = () => within(screen.getByRole("group", { name: "Thư đi (SMTP)" }));
// Radios render in the order SSL/TLS, then STARTTLS.
const TLS = 0;
const STARTTLS = 1;
const radio = (side: typeof imap, index: number) => side().getAllByRole("radio")[index]!;

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "  ha.do@congty.vn " } });
  fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "pass word 1" } });
  fireEvent.change(imap().getByLabelText("Máy chủ"), { target: { value: " mail.congty.vn " } });
  fireEvent.change(smtp().getByLabelText("Máy chủ"), { target: { value: "smtp.congty.vn" } });
}

const customAccount: EmailHubAccount = {
  id: "acc1",
  email_address: "ha.do@congty.vn",
  provider: "custom",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: true,
  auth_failed_reason: "imap_auth_failed",
  imap_host: "mail.congty.vn",
  imap_port: 143,
  imap_security: "starttls",
  smtp_host: "smtp.congty.vn",
  smtp_port: 465,
  smtp_security: "tls",
  username: "hado",
};

describe("ConnectCustomServerForm", () => {
  it("starts on SSL/TLS 993 for IMAP and STARTTLS 587 for SMTP", () => {
    renderForm();

    expect(imap().getByLabelText("Cổng")).toHaveValue("993");
    expect(radio(imap, TLS)).toHaveAttribute("aria-checked", "true");
    expect(smtp().getByLabelText("Cổng")).toHaveValue("587");
    expect(radio(smtp, STARTTLS)).toHaveAttribute("aria-checked", "true");
  });

  it("moves the port with the security mode until the port is typed by hand", () => {
    renderForm();

    fireEvent.click(radio(imap, STARTTLS));
    expect(imap().getByLabelText("Cổng")).toHaveValue("143");
    fireEvent.click(radio(smtp, TLS));
    expect(smtp().getByLabelText("Cổng")).toHaveValue("465");

    fireEvent.change(imap().getByLabelText("Cổng"), { target: { value: "10993" } });
    fireEvent.click(radio(imap, TLS));
    expect(radio(imap, TLS)).toHaveAttribute("aria-checked", "true");
    expect(imap().getByLabelText("Cổng")).toHaveValue("10993");
  });

  it("sends numbers for the ports, the password as typed, and a username only when one is given", () => {
    const onSubmit = renderForm();
    fillRequired();
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveAttribute("placeholder", "ha.do@congty.vn");

    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: "ha.do@congty.vn",
      appPassword: "pass word 1",
      server: {
        imap_host: "mail.congty.vn",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.congty.vn",
        smtp_port: 587,
        smtp_security: "starttls",
      },
    });

    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: " hado " } });
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ server: expect.objectContaining({ username: "hado" }) }),
    );
  });

  it("marks a bad email, an empty server and a non-numeric port without submitting", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ha.do" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "secret" } });
    fireEvent.change(smtp().getByLabelText("Máy chủ"), { target: { value: "smtp.congty.vn" } });
    fireEvent.change(smtp().getByLabelText("Cổng"), { target: { value: "99a" } });

    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Email chưa đúng định dạng, ví dụ ban@gmail.com.");
    expect(email).toHaveFocus();
    expect(imap().getByLabelText("Máy chủ")).toHaveAccessibleDescription("Nhập tên máy chủ, ví dụ mail.congty.vn.");
    expect(smtp().getByLabelText("Cổng")).toHaveAccessibleDescription("Nhập số cổng, ví dụ 993.");
    expect(imap().getByLabelText("Cổng")).not.toHaveAttribute("aria-invalid");
  });

  it("puts a server-refused SMTP port next to that input", () => {
    renderForm({ error: new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "smtp_port" }) });

    const port = smtp().getByLabelText("Cổng");
    expect(port).toHaveAttribute("aria-invalid", "true");
    expect(port).toHaveAttribute("aria-describedby", "email-hub-custom-smtp_port-error");
    expect(port).toHaveAccessibleDescription("Thông tin máy chủ thư này chưa đúng. Kiểm tra lại rồi thử lại.");
    expect(imap().getByLabelText("Cổng")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts a refused private address next to the IMAP server", () => {
    renderForm({ error: new ApiError("not allowed", "email_hub_host_not_allowed", 400, undefined, { field: "imap_host" }) });

    const host = imap().getByLabelText("Máy chủ");
    expect(host).toHaveAttribute("aria-invalid", "true");
    expect(host).toHaveAccessibleDescription(
      "UniWork không kết nối tới địa chỉ mạng nội bộ hoặc dải địa chỉ dành riêng. Nhập tên công khai của máy chủ thư.",
    );
  });

  it("puts a refused sign-in next to the password", () => {
    renderForm({ error: new ApiError("bad login", "email_hub_connect_failed", 400) });

    const password = screen.getByLabelText("Mật khẩu");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", "email-hub-custom-password-error");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [new ApiError("tls", "email_hub_tls_required", 400), "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    [new ApiError("down", "email_hub_unreachable", 400), "máy chủ thư"],
    [new ApiError("slow down", "rate_limited", 429), "Chờ vài phút rồi thử lại."],
    // A field name the form does not show must not match a prototype key; it reads out for the whole form.
    [new ApiError("invalid", "email_hub_invalid_server", 400, undefined, { field: "constructor" }), "Thông tin máy chủ thư này chưa đúng."],
  ])("reads %s out for the whole form", (error, text) => {
    renderForm({ error });

    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });

  it("fills a custom mailbox's servers for reconnecting, but never its password", () => {
    renderForm({ initial: customAccount });

    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("ha.do@congty.vn");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveValue("hado");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
    expect(imap().getByLabelText("Máy chủ")).toHaveValue("mail.congty.vn");
    expect(imap().getByLabelText("Cổng")).toHaveValue("143");
    expect(radio(imap, STARTTLS)).toHaveAttribute("aria-checked", "true");
    expect(smtp().getByLabelText("Máy chủ")).toHaveValue("smtp.congty.vn");
    expect(smtp().getByLabelText("Cổng")).toHaveValue("465");
    expect(radio(smtp, TLS)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Kết nối lại" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub/connect-custom-server-form.test.tsx
```

Expected: FAIL, with `Failed to resolve import "./connect-custom-server-form"`.

- [ ] **Step 3: Move and extend the error mapping**

Create `packages/views/email-hub/connect-account-errors.ts`:

```ts
import { errorCode, errorFields } from "@uniwork/core/api/http";

/** Where a connect error is read out: next to one input, or for the whole form. */
export type ConnectErrorField =
  | "email"
  | "password"
  | "form"
  | "username"
  | "imap_host"
  | "imap_port"
  | "imap_security"
  | "smtp_host"
  | "smtp_port"
  | "smtp_security";

// error.fields.field carries the SDI name (spec §5.2). A Map, so a name like "constructor" cannot hit a prototype key.
const SERVER_FIELDS = new Map<unknown, ConnectErrorField>([
  ["email_address", "email"],
  ["username", "username"],
  ["imap_host", "imap_host"],
  ["imap_port", "imap_port"],
  ["imap_security", "imap_security"],
  ["smtp_host", "smtp_host"],
  ["smtp_port", "smtp_port"],
  ["smtp_security", "smtp_security"],
]);

function fieldOf(err: unknown): ConnectErrorField {
  return SERVER_FIELDS.get(errorFields(err)?.field) ?? "form";
}

/** Which field a server error belongs to, so it is read out next to the thing to fix. */
export function connectError(err: unknown): { field: ConnectErrorField; key: string } {
  switch (errorCode(err)) {
    case "email_hub_invalid_server":
      return { field: fieldOf(err), key: "email_hub.connect.error_invalid_server" };
    case "email_hub_host_not_allowed":
      return { field: fieldOf(err), key: "email_hub.connect.error_host_not_allowed" };
    case "email_hub_connect_failed":
      return { field: "password", key: "email_hub.connect.error_connect_failed" };
    case "email_hub_unsupported":
      return { field: "email", key: "email_hub.connect.error_unsupported" };
    case "email_hub_not_configured":
      return { field: "form", key: "email_hub.connect.error_not_configured" };
    case "email_hub_already_connected":
      return { field: "email", key: "email_hub.connect.error_already_connected" };
    case "email_hub_reauth_required":
      return { field: "form", key: "email_hub.connect.error_reauth_required" };
    case "email_hub_smtp_disabled":
      return { field: "form", key: "email_hub.connect.error_smtp_disabled" };
    case "email_hub_tls_required":
      return { field: "form", key: "email_hub.connect.error_tls_required" };
    case "email_hub_unreachable":
      return { field: "form", key: "email_hub.connect.error_unreachable" };
    case "rate_limited":
      return { field: "form", key: "email_hub.connect.error_rate_limited" };
    default:
      return { field: "form", key: "email_hub.connect.error" };
  }
}
```

In `packages/views/email-hub/connect-account-dialog.tsx`:
1. Delete line 5, `import { errorCode } from "@uniwork/core/api/http";`.
2. After the `ConnectAppPasswordGuideDialog` import, add `import { connectError } from "./connect-account-errors";`.
3. Delete the local `connectError` and its doc comment (lines 25-47), together with the blank line after it.
4. Replace `const serverError = connect.isError ? connectError(errorCode(connect.error)) : null;` with `const serverError = connect.isError ? connectError(connect.error) : null;`.
5. Replace `const formError = serverError?.field === "form" ? t(serverError.key) : null;` with:

```ts
  // The app-password form has no server inputs: any error not about the email or password reads out for the whole form.
  const formError =
    serverError && serverError.field !== "email" && serverError.field !== "password" ? t(serverError.key) : null;
```

- [ ] **Step 4: Implement the form**

Create `packages/views/email-hub/connect-custom-server-form.tsx`:

```tsx
"use client";

import { useState, type ComponentProps, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount, EmailHubCustomServer } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { FormDialogBody, FormDialogFooter } from "../common/form-dialog";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { connectError, type ConnectErrorField } from "./connect-account-errors";

type EmailHubServerSecurity = EmailHubCustomServer["imap_security"];
type Side = "imap" | "smtp";
/** i18n keys of the client-side checks, by field. */
type FieldErrors = Partial<Record<ConnectErrorField, string>>;

interface ServerDraft {
  host: string;
  port: string;
  security: EmailHubServerSecurity;
  /** Set once the port is typed by hand; from then on a security change leaves it alone. */
  portEdited: boolean;
}

const SIDES: readonly Side[] = ["imap", "smtp"];
const SECURITIES: readonly EmailHubServerSecurity[] = ["tls", "starttls"];
const DEFAULT_SECURITY: Record<Side, EmailHubServerSecurity> = { imap: "tls", smtp: "starttls" };
const DEFAULT_PORT: Record<Side, Record<EmailHubServerSecurity, number>> = {
  imap: { tls: 993, starttls: 143 },
  smtp: { tls: 465, starttls: 587 },
};
// Integer format only; the server owns the allowed port set and answers email_hub_invalid_server on the field.
const PORT_RE = /^\d{1,5}$/;
/** Focus goes to the first of these that failed a client check. */
const FIELD_ORDER: readonly ConnectErrorField[] = ["email", "imap_host", "imap_port", "smtp_host", "smtp_port"];

const fieldId = (field: ConnectErrorField) => `email-hub-custom-${field}`;

function initialDraft(side: Side, account: EmailHubAccount | undefined): ServerDraft {
  const saved = side === "imap" ? account?.imap_security : account?.smtp_security;
  const security = saved === "tls" || saved === "starttls" ? saved : DEFAULT_SECURITY[side];
  const host = (side === "imap" ? account?.imap_host : account?.smtp_host) ?? "";
  const port = (side === "imap" ? account?.imap_port : account?.smtp_port) ?? DEFAULT_PORT[side][security];
  return { host, port: String(port), security, portEdited: false };
}

function TextField({
  field,
  label,
  error,
  hint,
  ...input
}: { field: ConnectErrorField; label: string; error?: string; hint?: string } & ComponentProps<typeof Input>) {
  const id = fieldId(field);
  const noteId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={noteId} {...input} />
      {error ? (
        <p id={noteId} className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-caption text-pretty text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ServerFieldset({
  side,
  draft,
  onChange,
  errorFor,
  clear,
}: {
  side: Side;
  draft: ServerDraft;
  onChange: (next: ServerDraft) => void;
  errorFor: (field: ConnectErrorField) => string | undefined;
  clear: (field: ConnectErrorField) => void;
}) {
  const { t } = useTranslation();
  const host = `${side}_host` as const;
  const port = `${side}_port` as const;
  const security = `${side}_security` as const;
  const securityId = fieldId(security);
  const securityError = errorFor(security);
  return (
    <fieldset className="grid gap-3 rounded-lg border border-border px-3 pt-1 pb-3">
      <legend className="px-1 text-label font-medium">{t(`email_hub.connect.custom.${side}_heading`)}</legend>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <TextField
          field={host}
          label={t("email_hub.connect.custom.host")}
          error={errorFor(host)}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("email_hub.connect.custom.host_placeholder")}
          value={draft.host}
          onChange={(e) => {
            onChange({ ...draft, host: e.target.value });
            clear(host);
          }}
        />
        <TextField
          field={port}
          label={t("email_hub.connect.custom.port")}
          error={errorFor(port)}
          inputMode="numeric"
          value={draft.port}
          onChange={(e) => {
            onChange({ ...draft, port: e.target.value, portEdited: true });
            clear(port);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <p id={`${securityId}-label`} className="text-label font-medium">
          {t("email_hub.connect.custom.security")}
        </p>
        <RadioGroup
          aria-labelledby={`${securityId}-label`}
          aria-describedby={securityError ? `${securityId}-error` : undefined}
          value={draft.security}
          onValueChange={(value) => {
            if (value !== "tls" && value !== "starttls") return;
            onChange({ ...draft, security: value, port: draft.portEdited ? draft.port : String(DEFAULT_PORT[side][value]) });
          }}
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          {SECURITIES.map((mode) => (
            <Label key={mode} htmlFor={`${securityId}-${mode}`} className="cursor-pointer font-normal">
              <RadioGroupItem value={mode} id={`${securityId}-${mode}`} />
              {t(`email_hub.connect.security_${mode}`)}
            </Label>
          ))}
        </RadioGroup>
        {securityError ? (
          <p id={`${securityId}-error`} className="text-caption text-destructive">
            {securityError}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

interface ConnectCustomServerFormProps {
  formId: string;
  /** Reconnect this custom mailbox: the address is fixed and its servers are filled in. The password never is. */
  initial?: EmailHubAccount;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onBack?: () => void;
  onSubmit: (input: { email: string; appPassword: string; server: EmailHubCustomServer }) => void;
}

export function ConnectCustomServerForm({
  formId,
  initial,
  pending,
  error,
  onCancel,
  onBack,
  onSubmit,
}: ConnectCustomServerFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initial?.email_address ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [drafts, setDrafts] = useState<Record<Side, ServerDraft>>(() => ({
    imap: initialDraft("imap", initial),
    smtp: initialDraft("smtp", initial),
  }));
  const [invalid, setInvalid] = useState<FieldErrors>({});

  const server = error ? connectError(error) : null;
  const errorFor = (field: ConnectErrorField) => {
    const key = invalid[field] ?? (server?.field === field ? server.key : undefined);
    return key ? t(key) : undefined;
  };
  const clear = (field: ConnectErrorField) => setInvalid((prev) => ({ ...prev, [field]: undefined }));
  const formError = server?.field === "form" ? t(server.key) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const found: FieldErrors = {};
    if (!EMAIL_RE.test(address)) found.email = "email_hub.connect.error_email_format";
    for (const side of SIDES) {
      if (!drafts[side].host.trim()) found[`${side}_host` as const] = "email_hub.connect.custom.error_host_required";
      if (!PORT_RE.test(drafts[side].port.trim())) found[`${side}_port` as const] = "email_hub.connect.custom.error_port_format";
    }
    setInvalid(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    const login = username.trim();
    const { imap, smtp } = drafts;
    onSubmit({
      email: address,
      // Sent as typed: unlike Google's grouped app passwords, a mail server password may hold spaces.
      appPassword: password,
      server: {
        imap_host: imap.host.trim(),
        imap_port: Number(imap.port.trim()),
        imap_security: imap.security,
        smtp_host: smtp.host.trim(),
        smtp_port: Number(smtp.port.trim()),
        smtp_security: smtp.security,
        ...(login ? { username: login } : {}),
      },
    });
  };

  return (
    <>
      <FormDialogBody>
        <form id={formId} className="grid gap-4" noValidate onSubmit={submit}>
          <TextField
            field="email"
            label={t("email_hub.connect.email")}
            error={errorFor("email")}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("email_hub.connect.custom.email_placeholder")}
            value={email}
            readOnly={initial !== undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              clear("email");
            }}
          />
          <TextField
            field="username"
            label={t("email_hub.connect.custom.username")}
            error={errorFor("username")}
            hint={t("email_hub.connect.custom.username_hint")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={email.trim() || undefined}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            field="password"
            label={t("email_hub.connect.custom.password")}
            error={errorFor("password")}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {SIDES.map((side) => (
            <ServerFieldset
              key={side}
              side={side}
              draft={drafts[side]}
              onChange={(next) => setDrafts((prev) => ({ ...prev, [side]: next }))}
              errorFor={errorFor}
              clear={clear}
            />
          ))}
          {formError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      </FormDialogBody>
      <FormDialogFooter
        leading={
          onBack ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onBack}>
              {t("email_hub.connect.back")}
            </Button>
          ) : undefined
        }
        onCancel={onCancel}
        submitType="submit"
        form={formId}
        submitLabel={initial ? t("email_hub.reconnect.action") : t("email_hub.connect.submit")}
        submittingLabel={t("email_hub.connect.submitting")}
        submitting={pending}
        submitDisabled={!email.trim() || !password}
      />
    </>
  );
}
```

- [ ] **Step 5: Add the i18n keys (vi first, then en)**

In `packages/core/i18n/locales/vi.json`, replace the line

```json
      "error_unreachable": "Không kết nối được tới máy chủ thư. Kiểm tra địa chỉ email rồi thử lại sau."
```

with:

```json
      "error_unreachable": "Không kết nối được tới máy chủ thư. Kiểm tra địa chỉ email rồi thử lại sau.",
      "error_invalid_server": "Thông tin máy chủ thư này chưa đúng. Kiểm tra lại rồi thử lại.",
      "error_host_not_allowed": "UniWork không kết nối tới địa chỉ mạng nội bộ hoặc dải địa chỉ dành riêng. Nhập tên công khai của máy chủ thư.",
      "error_rate_limited": "Bạn đã thử kết nối quá nhiều lần. Chờ vài phút rồi thử lại.",
      "security_tls": "SSL/TLS",
      "security_starttls": "STARTTLS",
      "back": "Quay lại",
      "custom": {
        "title": "Kết nối hộp thư tên miền riêng",
        "description": "Nhập cài đặt IMAP và SMTP của máy chủ thư. Nhà cung cấp hosting hoặc bộ phận IT có các thông tin này. Mật khẩu được mã hóa trước khi lưu.",
        "email_placeholder": "ban@congty.vn",
        "username": "Tên đăng nhập",
        "username_hint": "Để trống nếu giống địa chỉ email",
        "password": "Mật khẩu",
        "imap_heading": "Thư đến (IMAP)",
        "smtp_heading": "Thư đi (SMTP)",
        "host": "Máy chủ",
        "host_placeholder": "mail.congty.vn",
        "port": "Cổng",
        "security": "Bảo mật",
        "error_host_required": "Nhập tên máy chủ, ví dụ mail.congty.vn.",
        "error_port_format": "Nhập số cổng, ví dụ 993."
      }
```

In `packages/core/i18n/locales/en.json`, replace the line

```json
      "error_unreachable": "Couldn't reach the mail server. Check the email address and try again later."
```

with:

```json
      "error_unreachable": "Couldn't reach the mail server. Check the email address and try again later.",
      "error_invalid_server": "This mail server setting isn't valid. Check it and try again.",
      "error_host_not_allowed": "UniWork doesn't connect to private or reserved network addresses. Enter the mail server's public name.",
      "error_rate_limited": "Too many connection attempts. Wait a few minutes and try again.",
      "security_tls": "SSL/TLS",
      "security_starttls": "STARTTLS",
      "back": "Back",
      "custom": {
        "title": "Connect a mailbox on your own domain",
        "description": "Enter your mail server's IMAP and SMTP settings. Your hosting provider or IT team has them. The password is encrypted before it's stored.",
        "email_placeholder": "you@yourcompany.com",
        "username": "Username",
        "username_hint": "Leave empty if it's the same as the email address",
        "password": "Password",
        "imap_heading": "Incoming mail (IMAP)",
        "smtp_heading": "Outgoing mail (SMTP)",
        "host": "Server",
        "host_placeholder": "mail.yourcompany.com",
        "port": "Port",
        "security": "Security",
        "error_host_required": "Enter the server name, e.g. mail.yourcompany.com.",
        "error_port_format": "Enter a port number, e.g. 993."
      }
```

- [ ] **Step 6: Run the tests and targeted gates**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub/connect-custom-server-form.test.tsx email-hub/connect-account-dialog.test.tsx
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false i18n/parity.test.ts
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/i18n-duplicate-keys.test.mjs scripts/i18n-chat-key-parity.test.mjs
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/views typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && pnpm exec eslint --max-warnings 0 email-hub/connect-account-errors.ts email-hub/connect-custom-server-form.tsx email-hub/connect-custom-server-form.test.tsx email-hub/connect-account-dialog.tsx
```

Expected:
- The form file passes: 8 `it` cases plus 4 `it.each` rows.
- The GĐ1 dialog file still passes.
- Parity, duplicate keys and typecheck are clean.
- eslint reports 0 problems: no `i18next/no-literal-string`, and the form is about 300 counted lines.

knip is expected to be red on this commit only, because `connect-custom-server-form.tsx` is an unused file until Task 8 mounts it. Do not run knip here; Task 8 Step 5 runs it green.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add packages/views/email-hub/connect-account-errors.ts \
  packages/views/email-hub/connect-custom-server-form.tsx packages/views/email-hub/connect-custom-server-form.test.tsx \
  packages/views/email-hub/connect-account-dialog.tsx \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(email-hub): add the custom-server connect form and field-mapped connect errors" \
  -m "A mailbox on its own domain needs IMAP and SMTP host, port and security plus an optional login name, so the form asks for them. Choosing a security mode fills the usual port until the port is typed by hand. The password is sent as typed, because a server password may hold spaces. connectError moves out of the dialog and takes the error itself, so email_hub_invalid_server and email_hub_host_not_allowed land on the input that error.fields.field names, with aria-invalid and aria-describedby; a 429 rate_limited now has its own copy. An unknown field reads out for the whole form. The flat email_hub.connect.error_* keys stay, because api-error-copy and compose-recipients read them. Left out: the method step, mounting the form and the reconnect prefill lookup (next task), and checking the allowed port set on the client (the server owns it)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Connect dialog method step, custom reconnect prefill, copy and settings

**Files:**
- Modify: `packages/views/email-hub/connect-account-dialog.tsx` (whole file replaced)
- Test: `packages/views/email-hub/connect-account-dialog.test.tsx` (whole file replaced; the GĐ1 cases now pick the method first)
- Modify: `packages/views/email-hub/use-email-hub-account-panel.ts:42` (comment only)
- Modify: `packages/views/settings/components/integrations-tab.tsx:30-34` (doc comment only)
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`

**Interfaces:**
- Consumes:
  - From Task 7:
    - `ConnectCustomServerForm` (`<form id={formId}>`). The email is read-only and the password empty when `initial` is set, and Back shows only when `onBack` is passed.
    - `connectError(err)`
    - The keys `custom.title`, `custom.description` and `back`
  - From Task 6: the hook input `{ email; appPassword; server? }`, and `EmailHubAccount.provider` plus the server fields.
  - From GĐ1:
    - `useEmailHubAccounts(wsId)` (`hooks.ts:83`). Its data is `{ accounts }`, and it has no `enabled` option, so it fetches on mount.
    - `pickerCardClass(selected)` from `../onboarding/components/option-card`
    - `FormDialogFooter`'s `leading` slot
- Produces:
  - `ConnectAccountDialog({ wsId, open, onOpenChange, onConnected?, reconnectEmail? })`, with the same props as today. Internally it tracks `type Method = "choose" | "custom" | "app_password"`.
  - A new connect opens on `"choose"`. The step resets each time the dialog opens, never as it closes.
  - A reconnect skips the step:
    - An account with `provider === "custom"` opens the custom form prefilled.
    - Any other account opens the app-password form. So does an account that is missing or still loading; in that case submit stays disabled until the list has loaded.
  - New i18n keys (en+vi):
    - `email_hub.connect.method_description`, `method_custom`, `method_custom_hint`, `method_app_password`, `method_app_password_hint`
    - `email_hub.reconnect.dialog_description_custom`
  - Rewritten values:
    - In `email_hub.connect`: `description`, `error`, `error_connect_failed`, `error_unsupported`, `error_reauth_required`, `error_unreachable`
    - `email_hub.onboarding.body`, `email_hub.disconnect_confirm_body`
    - `settings.integrations.email_hub.meta`
  - The method step uses the existing `connect.title`, so there is no `method_title` key.

- [ ] **Step 1: Write the failing tests**

Replace `packages/views/email-hub/connect-account-dialog.test.tsx` with:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../test/api-mock";
import { ConnectAccountDialog } from "./connect-account-dialog";

const accountJSON = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: false,
  auth_failed_reason: "",
};

const customJSON = {
  id: "acc2",
  email_address: "lan@unicomhub.vn",
  provider: "custom",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: true,
  auth_failed_reason: "imap_auth_failed",
  imap_host: "imap.unicomhub.vn",
  imap_port: 993,
  imap_security: "tls",
  smtp_host: "smtp.unicomhub.vn",
  smtp_port: 465,
  smtp_security: "tls",
  username: "",
};

const ACCOUNTS_PATH = "/api/v1/workspaces/ws1/email-hub/accounts";

/** The dialog reads the account list (GET) and connects with a POST to the same path. */
function serve(list: unknown, connect: () => Promise<unknown> = () => Promise.resolve(accountJSON)) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path !== ACCOUNTS_PATH) return Promise.resolve({});
    return opts?.method === "POST" ? connect() : Promise.resolve(list);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  serve({ accounts: [] });
});

const customOption = () => screen.getByRole("button", { name: /^Tên miền riêng \(IMAP\/SMTP\)/ });
const appPasswordOption = () => screen.getByRole("button", { name: /^Dùng mật khẩu ứng dụng/ });

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
}

describe("ConnectAccountDialog", () => {
  it("starts a new connect on the method step, opens the chosen form and goes back", () => {
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    expect(customOption()).toBeInTheDocument();
    expect(appPasswordOption()).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    fireEvent.click(customOption());
    expect(document.getElementById("email-hub-custom-form")).not.toBeNull();
    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(document.getElementById("email-hub-custom-form")).toBeNull();

    fireEvent.click(appPasswordOption());
    expect(screen.getByLabelText("App Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem hướng dẫn từng bước kèm minh họa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    expect(customOption()).toBeInTheDocument();
  });

  it("opens on the method step again after a close, with the password cleared", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    fireEvent.click(appPasswordOption());
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(wrap(<ConnectAccountDialog wsId="ws1" open={false} onOpenChange={onOpenChange} />));
    rerender(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));

    expect(screen.queryByLabelText("App Password")).not.toBeInTheDocument();
    fireEvent.click(appPasswordOption());
    expect(screen.getByLabelText("App Password")).toHaveValue("");
  });

  it("reconnects a custom-server mailbox in its own form, prefilled except the password", async () => {
    serve({ accounts: [accountJSON, customJSON] }, () => Promise.resolve(customJSON));
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog
          wsId="ws1"
          open
          reconnectEmail="lan@unicomhub.vn"
          onOpenChange={() => {}}
          onConnected={onConnected}
        />,
      ),
    );

    expect(await screen.findByDisplayValue("imap.unicomhub.vn")).toBeInTheDocument();
    expect(screen.getByDisplayValue("smtp.unicomhub.vn")).toBeInTheDocument();
    expect(screen.getByText("Kết nối lại lan@unicomhub.vn")).toBeInTheDocument();
    expect(
      screen.getByText("Nhập lại mật khẩu hoặc sửa cài đặt máy chủ. Thư đã đồng bộ được giữ nguyên, trừ khi bạn đổi máy chủ IMAP."),
    ).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("lan@unicomhub.vn");
    expect(email).toHaveAttribute("readonly");
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password).toHaveValue("");
    // A reconnect has no method to go back to.
    expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();

    fireEvent.change(password!, { target: { value: "n3w pass" } });
    fireEvent.submit(document.getElementById("email-hub-custom-form")!);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc2"));
    expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH, {
      method: "POST",
      body: expect.objectContaining({
        email_address: "lan@unicomhub.vn",
        app_password: "n3w pass",
        imap_host: "imap.unicomhub.vn",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.unicomhub.vn",
        smtp_port: 465,
        smtp_security: "tls",
      }),
    });
  });

  it.each([
    ["has loaded", () => Promise.resolve({ accounts: [accountJSON] }), false],
    ["is still loading", () => new Promise(() => {}), true],
  ])("reconnects a preset mailbox with the app-password form when the list %s", async (_, list, blocked) => {
    serve(list());
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="ha.do@unicomhub.com" onOpenChange={() => {}} />));

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH));
    await act(async () => {});

    expect(screen.getByLabelText("App Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(document.getElementById("email-hub-custom-form")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();

    // Until the list says the mailbox is not custom, the app-password form must not submit.
    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh" } });
    const submit = screen.getByRole("button", { name: "Kết nối lại" });
    if (blocked) expect(submit).toBeDisabled();
    else await waitFor(() => expect(submit).toBeEnabled());
  });

  it("reconnects the named mailbox with a new app password, without letting the address change", async () => {
    serve({ accounts: [accountJSON] });
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog
          wsId="ws1"
          open
          reconnectEmail="ha.do@unicomhub.com"
          onOpenChange={() => {}}
          onConnected={onConnected}
        />,
      ),
    );

    expect(screen.getByText("Kết nối lại ha.do@unicomhub.com")).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("ha.do@unicomhub.com");
    expect(email).toHaveAttribute("readonly");

    fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
    const submit = screen.getByRole("button", { name: "Kết nối lại" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc1"));
    expect(requestMock).toHaveBeenCalledWith(ACCOUNTS_PATH, {
      method: "POST",
      body: { email_address: "ha.do@unicomhub.com", app_password: "abcdefghijklmnop" },
    });
  });

  it("keeps the reconnect title and fixed address while the dialog closes", () => {
    // jsdom has no animations; an exit animation that never ends keeps the popup on screen, as a browser does mid-fade.
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [{ finished: new Promise(() => {}) }],
    });
    try {
      const { rerender } = render(
        wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="ha.do@unicomhub.com" onOpenChange={() => {}} />),
      );
      // The host clears the address together with open.
      rerender(wrap(<ConnectAccountDialog wsId="ws1" open={false} onOpenChange={() => {}} />));

      expect(screen.getByText("Kết nối lại ha.do@unicomhub.com")).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
      expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).not.toBeInTheDocument();
    } finally {
      // @ts-expect-error -- jsdom does not define it; drop the stub so other tests unmount at once.
      delete Element.prototype.getAnimations;
    }
  });

  it("puts an already-connected mailbox next to the email field", async () => {
    serve({ accounts: [] }, () => Promise.reject(new ApiError("already connected", "email_hub_already_connected", 409)));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());

    fillAndSubmit("an@gmail.com", "Kết nối");

    const error = await screen.findByText("Hộp thư này đã được kết nối. Chọn hộp thư trong mục Tài khoản, hoặc nhập địa chỉ khác.");
    expect(error).toHaveAttribute("id", "email-hub-email-error");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["email_hub_smtp_disabled", 400, "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP"],
    ["email_hub_tls_required", 400, "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    ["email_hub_unreachable", 400, "Không kết nối được tới máy chủ thư."],
    ["email_hub_reauth_required", 409, "Hộp thư này cần kết nối lại."],
  ])("reads %s out as a sentence for the whole form", async (code, status, text) => {
    serve({ accounts: [] }, () => Promise.reject(new ApiError("refused", code, status)));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    fireEvent.click(appPasswordOption());

    fillAndSubmit("an@gmail.com", "Kết nối");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});
```

The GĐ1 cases now go through `serve()`, because the mount-time GET of the account list would use up a bare `mockRejectedValueOnce`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub/connect-account-dialog.test.tsx
```

Expected:
- These fail with `Unable to find an accessible element with the role "button" and name /^Tên miền riêng …/`: the method-step cases, the already-connected case and the four sentence cases.
- `reconnects a custom-server mailbox…` times out on `findByDisplayValue("imap.unicomhub.vn")`.
- `reconnects a preset mailbox… is still loading` fails at `toBeDisabled`.
- The other preset cases and the closing case already pass, which pins GĐ1 behaviour.

- [ ] **Step 3: Implement the dialog**

Replace `packages/views/email-hub/connect-account-dialog.tsx` with:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useConnectEmailHubAccount, useEmailHubAccounts } from "@uniwork/core/email-hub/hooks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { pickerCardClass } from "../onboarding/components/option-card";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";
import { connectError } from "./connect-account-errors";
import { ConnectCustomServerForm } from "./connect-custom-server-form";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
  /** Reconnect this mailbox: the address is fixed; the dialog picks the form by the account's provider. */
  reconnectEmail?: string;
}

const FORM_ID = "email-hub-connect-form";
const CUSTOM_FORM_ID = "email-hub-custom-form";
const METHODS = ["custom", "app_password"] as const;
type Method = "choose" | (typeof METHODS)[number];

export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected, reconnectEmail: reconnectProp }: ConnectAccountDialogProps) {
  const { t } = useTranslation();
  // Hosts clear the address as they close; keep the reconnect form on screen until the exit animation ends.
  const [reconnectEmail, setReconnectEmail] = useState(reconnectProp);
  if (open && reconnectProp !== reconnectEmail) setReconnectEmail(reconnectProp);
  // Reset the step as the dialog opens, not as it closes, so the closing dialog keeps the form it showed.
  const [method, setMethod] = useState<Method>("choose");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMethod("choose");
  }
  const accounts = useEmailHubAccounts(wsId);
  const reconnectAccount =
    reconnectEmail === undefined ? undefined : accounts.data?.accounts.find((acc) => acc.email_address === reconnectEmail);
  // A reconnect skips the step: a custom-server mailbox reopens its settings; any other (or one not loaded yet) asks for the app password.
  const form: Method =
    reconnectEmail === undefined ? method : reconnectAccount?.provider === "custom" ? "custom" : "app_password";
  // Until the list loads, a custom mailbox could be showing the wrong form: hold its submit.
  const reconnectLoading = reconnectEmail !== undefined && accounts.isPending;
  const [email, setEmail] = useState("");
  const address = reconnectEmail ?? email;
  const [password, setPassword] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const connect = useConnectEmailHubAccount(wsId);

  const serverError = connect.isError ? connectError(connect.error) : null;
  const emailError = emailInvalid
    ? t("email_hub.connect.error_email_format")
    : serverError?.field === "email"
      ? t(serverError.key)
      : null;
  const passwordError = serverError?.field === "password" ? t(serverError.key) : null;
  // The app-password form has no server fields; any other field's error reads for the whole form.
  const formError = serverError && serverError.field !== "email" && serverError.field !== "password" ? t(serverError.key) : null;

  const close = (next: boolean) => {
    if (connect.isPending) return;
    if (!next) {
      connect.reset();
      setEmailInvalid(false);
      // The dialog stays mounted: a cancelled app password must not wait in state for the next open.
      setPassword("");
    }
    onOpenChange(next);
  };

  const pick = (next: Method) => {
    // An error from one form must not show up on the other.
    connect.reset();
    setEmailInvalid(false);
    setMethod(next);
  };

  const run = (input: Parameters<typeof connect.mutate>[0]) =>
    connect.mutate(input, {
      onSuccess: (acc) => {
        if (acc) onConnected?.(acc.id);
        setEmail("");
        setPassword("");
        onOpenChange(false);
      },
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reconnectLoading) return;
    const trimmed = address.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailInvalid(true);
      document.getElementById("email-hub-email")?.focus();
      return;
    }
    // Google shows the app password in four groups of four; pasting it keeps the spaces.
    run({ email: trimmed, appPassword: password.replace(/\s+/g, "") });
  };

  const title = reconnectEmail
    ? t("email_hub.reconnect.dialog_title", { email: reconnectEmail })
    : form === "custom"
      ? t("email_hub.connect.custom.title")
      : t("email_hub.connect.title");
  const description = reconnectEmail
    ? form === "custom"
      ? t("email_hub.reconnect.dialog_description_custom")
      : t("email_hub.reconnect.dialog_description")
    : form === "custom"
      ? t("email_hub.connect.custom.description")
      : form === "app_password"
        ? t("email_hub.connect.description")
        : t("email_hub.connect.method_description");

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <FormDialogContent>
          <FormDialogHeader title={title} description={description} />
          {form === "choose" ? (
            <FormDialogBody>
              <div className="grid gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={cn(pickerCardClass(false), "grid gap-0.5 px-4 py-3")}
                    onClick={() => pick(m)}
                  >
                    <span className="text-body font-medium">{t(`email_hub.connect.method_${m}`)}</span>
                    <span className="text-caption text-pretty text-muted-foreground">{t(`email_hub.connect.method_${m}_hint`)}</span>
                  </button>
                ))}
              </div>
            </FormDialogBody>
          ) : form === "custom" ? (
            <ConnectCustomServerForm
              // initial is read at mount: a different mailbox, or a fresh connect, starts a fresh form.
              key={reconnectAccount?.id ?? "new"}
              formId={CUSTOM_FORM_ID}
              initial={reconnectAccount}
              pending={connect.isPending}
              error={connect.isError ? connect.error : null}
              onCancel={() => close(false)}
              onBack={reconnectEmail === undefined ? () => pick("choose") : undefined}
              onSubmit={run}
            />
          ) : (
            <>
              <FormDialogBody>
                <form id={FORM_ID} className="grid gap-4" noValidate onSubmit={submit}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="email-hub-email">{t("email_hub.connect.email")}</Label>
                    <Input
                      id="email-hub-email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={address}
                      readOnly={reconnectEmail !== undefined}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setEmailInvalid(false);
                      }}
                      placeholder={t("email_hub.connect.email_placeholder")}
                      aria-invalid={emailError ? true : undefined}
                      aria-describedby={emailError ? "email-hub-email-error" : undefined}
                    />
                    {emailError ? (
                      <p id="email-hub-email-error" className="text-caption text-destructive">
                        {emailError}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="email-hub-password">{t("email_hub.connect.app_password")}</Label>
                    <Input
                      id="email-hub-password"
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("email_hub.connect.app_password_placeholder")}
                      aria-invalid={passwordError ? true : undefined}
                      aria-describedby={passwordError ? "email-hub-password-error" : "email-hub-password-hint"}
                    />
                    {passwordError ? (
                      <p id="email-hub-password-error" className="text-caption text-destructive">
                        {passwordError}
                      </p>
                    ) : (
                      <p id="email-hub-password-hint" className="text-caption text-pretty text-muted-foreground">
                        {t("email_hub.connect.hint")}{" "}
                        <button
                          type="button"
                          className="font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground"
                          onClick={() => setGuideOpen(true)}
                        >
                          {t("email_hub.connect.guide.link")}
                        </button>
                      </p>
                    )}
                  </div>
                  {formError ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
                      {formError}
                    </p>
                  ) : null}
                </form>
              </FormDialogBody>
              <FormDialogFooter
                leading={
                  reconnectEmail === undefined ? (
                    <Button type="button" variant="ghost" size="sm" disabled={connect.isPending} onClick={() => pick("choose")}>
                      {t("email_hub.connect.back")}
                    </Button>
                  ) : undefined
                }
                onCancel={() => close(false)}
                submitType="submit"
                form={FORM_ID}
                submitLabel={reconnectEmail ? t("email_hub.reconnect.action") : t("email_hub.connect.submit")}
                submittingLabel={t("email_hub.connect.submitting")}
                submitting={connect.isPending}
                submitDisabled={!address.trim() || !password.trim() || reconnectLoading}
              />
            </>
          )}
        </FormDialogContent>
      </Dialog>
      <ConnectAppPasswordGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
```

In `packages/views/email-hub/use-email-hub-account-panel.ts:42`, replace the comment line with:

```ts
  // The dialog picks the form: provider "custom" reopens its server settings, any other asks for the app password. GĐ3 picks the OAuth popup here by auth_kind.
```

In `packages/views/settings/components/integrations-tab.tsx:30-34`, replace the doc comment with:

```tsx
/**
 * Email Hub is the one connection that works today: each person links their
 * own Gmail, Outlook or Yahoo mailbox with an app password, or a mailbox on
 * their own domain's IMAP/SMTP server (server/internal/emailhub/provider.go,
 * server/internal/service/email_hub_connect_server.go). The count is the reader's own.
 */
```

- [ ] **Step 4: Add and rewrite the i18n strings (vi first, then en)**

Use Edit with these exact old values. Each one occurs once in its file. Match the value text only, so the trailing comma does not matter.

`packages/core/i18n/locales/vi.json`:

| Key | Old value (match) | New value |
| --- | --- | --- |
| `settings.integrations.email_hub.meta` | `Hộp thư Gmail, Outlook, Yahoo qua mật khẩu ứng dụng · mỗi người tự kết nối` | `Gmail, Outlook, Yahoo hoặc máy chủ thư của tên miền riêng · mỗi người tự kết nối` |
| `email_hub.connect.description` | `Dùng App Password của Google hoặc nhà cung cấp IMAP khác. Mật khẩu được mã hóa trước khi lưu.` | `Cho Gmail, Outlook hoặc Yahoo. Dùng App Password, không dùng mật khẩu thường. Mật khẩu được mã hóa trước khi lưu.` |
| `email_hub.connect.error` | `Không kết nối được. Kiểm tra email và App Password.` | `Không kết nối được. Kiểm tra lại thông tin rồi thử lại.` |
| `email_hub.connect.error_connect_failed` | `Không đăng nhập được hộp thư. Kiểm tra lại email và App Password.` | `Máy chủ thư không chấp nhận đăng nhập. Kiểm tra mật khẩu, và tên đăng nhập nếu bạn có nhập.` |
| `email_hub.connect.error_unsupported` | `Nhà cung cấp email này chưa được hỗ trợ.` | `Chưa có cài đặt sẵn cho tên miền email này. Quay lại và chọn Tên miền riêng (IMAP/SMTP).` |
| `email_hub.connect.error_reauth_required` | `Hộp thư này cần kết nối lại. Nhập App Password mới rồi thử lại.` | `Hộp thư này cần kết nối lại. Nhập mật khẩu mới rồi thử lại.` |
| `email_hub.connect.error_unreachable` | `Không kết nối được tới máy chủ thư. Kiểm tra địa chỉ email rồi thử lại sau.` | `Không kết nối được tới máy chủ thư. Với máy chủ riêng, kiểm tra địa chỉ, cổng, kiểu bảo mật và chứng chỉ có khớp với địa chỉ đó không. Với hộp thư khác, thử lại sau.` |
| `email_hub.onboarding.body` | `Email Hub đọc và gửi thư qua IMAP bằng App Password. Mỗi hộp thư chỉ cần thiết lập một lần.` | `Email Hub đọc và gửi thư qua IMAP, bằng App Password hoặc máy chủ thư của tên miền riêng. Mỗi hộp thư chỉ cần thiết lập một lần.` |
| `email_hub.disconnect_confirm_body` | `Email của hộp thư này sẽ không còn hiện trong UniWork. Thư trên Gmail vẫn giữ nguyên; muốn dùng lại phải nhập App Password mới.` | `Email của hộp thư này sẽ không còn hiện trong UniWork. Thư trên máy chủ thư vẫn giữ nguyên; muốn dùng lại phải nhập lại mật khẩu.` |

In the same file, replace the line
`      "error_already_connected": "Hộp thư này đã được kết nối. Chọn hộp thư trong mục Tài khoản, hoặc nhập địa chỉ khác.",`
with:

```json
      "error_already_connected": "Hộp thư này đã được kết nối. Chọn hộp thư trong mục Tài khoản, hoặc nhập địa chỉ khác.",
      "method_description": "Mỗi người tự kết nối hộp thư của mình. Mật khẩu được mã hóa trước khi lưu.",
      "method_custom": "Tên miền riêng (IMAP/SMTP)",
      "method_custom_hint": "Thư trên máy chủ riêng của công ty, kèm cài đặt IMAP và SMTP",
      "method_app_password": "Dùng mật khẩu ứng dụng",
      "method_app_password_hint": "Gmail, Outlook hoặc Yahoo, bằng App Password tạo trong cài đặt tài khoản",
```

and replace the line
`      "dialog_description": "Nhập App Password mới cho hộp thư này. Thư đã đồng bộ được giữ nguyên.",`
with:

```json
      "dialog_description": "Nhập App Password mới cho hộp thư này. Thư đã đồng bộ được giữ nguyên.",
      "dialog_description_custom": "Nhập lại mật khẩu hoặc sửa cài đặt máy chủ. Thư đã đồng bộ được giữ nguyên, trừ khi bạn đổi máy chủ IMAP.",
```

`packages/core/i18n/locales/en.json`:

| Key | Old value (match) | New value |
| --- | --- | --- |
| `settings.integrations.email_hub.meta` | `Gmail, Outlook, Yahoo mailboxes via an app password · each person connects their own` | `Gmail, Outlook, Yahoo or a mail server on your own domain · each person connects their own` |
| `email_hub.connect.description` | `Use an app password from Google or another IMAP provider. It is encrypted before it is stored.` | `For Gmail, Outlook or Yahoo. Use an app password, not your usual password. It's encrypted before it's stored.` |
| `email_hub.connect.error` | `Could not connect. Check the email and App Password.` | `Couldn't connect. Check the details and try again.` |
| `email_hub.connect.error_connect_failed` | `Couldn't sign in to the mailbox. Check the email and app password.` | `The mail server didn't accept the sign-in. Check the password, and the login name if you entered one.` |
| `email_hub.connect.error_unsupported` | `This email provider is not supported yet.` | `There's no preset for this email domain. Go back and choose Own domain (IMAP/SMTP).` |
| `email_hub.connect.error_reauth_required` | `This mailbox needs reconnecting. Enter a new App Password and try again.` | `This mailbox needs reconnecting. Enter a new password and try again.` |
| `email_hub.connect.error_unreachable` | `Couldn't reach the mail server. Check the email address and try again later.` | `Couldn't reach the mail server. On your own server, check the address, port, security, and that its certificate matches that address. For other mailboxes, try again later.` |
| `email_hub.onboarding.body` | `Email Hub reads and sends through IMAP with an app password. Each mailbox is set up once.` | `Email Hub reads and sends through IMAP, with an app password or your own domain's mail server. Each mailbox is set up once.` |
| `email_hub.disconnect_confirm_body` | `Mail from this mailbox stops showing in UniWork. Nothing is deleted in Gmail; reconnecting needs a new app password.` | `Mail from this mailbox stops showing in UniWork. Nothing is deleted on the mail server; reconnecting needs the password again.` |

In the same file, replace the line
`      "error_already_connected": "This mailbox is already connected. Pick it under Accounts, or enter another address.",`
with:

```json
      "error_already_connected": "This mailbox is already connected. Pick it under Accounts, or enter another address.",
      "method_description": "Each person connects their own mailbox. The password is encrypted before it's stored.",
      "method_custom": "Own domain (IMAP/SMTP)",
      "method_custom_hint": "Mail on your company's own server, with its IMAP and SMTP settings",
      "method_app_password": "Use an app password",
      "method_app_password_hint": "Gmail, Outlook or Yahoo, with an app password from your account settings",
```

and replace the line
`      "dialog_description": "Enter a new App Password for this mailbox. Mail already synced stays as it is.",`
with:

```json
      "dialog_description": "Enter a new App Password for this mailbox. Mail already synced stays as it is.",
      "dialog_description_custom": "Enter the password again, or fix the server settings. Mail already synced stays unless you change the IMAP server.",
```

If an Edit says an old value does not match, read the current line and match it exactly; do not invent text. Then check that no test asserts the rewritten strings:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && grep -rn "Thư trên Gmail vẫn giữ\|IMAP bằng App Password\|Nhà cung cấp email này chưa\|Kiểm tra email và App Password\|Không đăng nhập được hộp thư" packages apps e2e --include='*.test.*' --include='*.spec.*' || true
```

Expected: no output. Update any hit to the new copy.

- [ ] **Step 5: Run the tests to verify they pass, then the targeted gates**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub settings/components/integrations-tab.test.tsx
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false i18n/parity.test.ts
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/i18n-duplicate-keys.test.mjs scripts/i18n-chat-key-parity.test.mjs
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/views typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && pnpm exec eslint --max-warnings 0 email-hub/connect-account-dialog.tsx email-hub/connect-account-dialog.test.tsx email-hub/use-email-hub-account-panel.ts settings/components/integrations-tab.tsx
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm knip
```

Expected: all green.
- The 12 dialog cases pass: 6 `it` plus 2 + 4 `it.each` rows.
- Every email-hub views test passes, including those for the empty state and the account menu, which render the rewritten copy.
- Typecheck passes. `onSubmit={run}` accepts the form's `{ email; appPassword; server }`.
- eslint reports 0 problems. The dialog is about 265 counted lines.
- knip reports nothing new: `connectError` and `ConnectCustomServerForm` are used.

- [ ] **Step 6: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add packages/views/email-hub/connect-account-dialog.tsx packages/views/email-hub/connect-account-dialog.test.tsx \
  packages/views/email-hub/use-email-hub-account-panel.ts packages/views/settings/components/integrations-tab.tsx \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(email-hub): choose own-domain or app-password connect and reconnect custom servers prefilled" \
  -m "A new connect opens on a method step with two equal options: Own domain (IMAP/SMTP) opens the custom-server form, and the app password keeps the GD1 form with its guide; both have a Back control. The step resets when the dialog opens, not when it closes, so the closing dialog keeps its content. A reconnect looks the account up in the cached account list: provider custom reopens its server settings with the password empty; anything else asks for the app password, and while the list is still loading that form cannot submit. Copy that assumed an App Password everywhere now says password, points unsupported domains at Own domain, names host, port, security and certificate on unreachable, and no longer says Gmail on disconnect or onboarding. The settings meta mentions own-domain servers. Left out: the OAuth buttons and the mail_oauth settings card (GD3), and a separate method_title key." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Check visually in both themes, which the contrast e2e does not cover:
- the method-step cards (`pickerCardClass(false)`, a class helper imported from onboarding)
- the ghost Back button in the footer's `leading` slot

### Task 9: Runbook, spec status, targeted verification (PR opened by the controller)

**Files:**
- Modify: `docs/ops/RUNBOOK_EMAIL_HUB.md`. Line 3 is the header (add UNI-1238). Lines 86-100 are the whole `### Kết nối thất bại` section, including the GĐ1 raw-`err` caveat at 98-100. Three sections replace it, placed before `### Migration dedupe và unique index`.
- Modify: `docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md:3` (status) and `:6` (`**Issue:**`).
- Modify: this plan's `> **Trạng thái:**` line (line 3).
- Not modified: `server/coverage.floor` (70), `packages/core/vitest.config.ts:27` (70/68/59/72), `packages/views/vitest.config.ts:29` (83/76/79/85). See Step 6.
- Must stay green: `scripts/governance.test.mjs`, `scripts/alerts-runbooks.test.mjs` (it reads only `docs/runbooks/`), `scripts/no-pii-log.test.mjs`.

**Interfaces:**
- Consumes (text only):
  - API codes:
    - `email_hub_invalid_server` and `email_hub_host_not_allowed`, both with `error.fields.field`
    - `email_hub_unsupported`, `email_hub_unreachable`, `email_hub_tls_required`, `email_hub_connect_failed`, `email_hub_smtp_disabled`, `email_hub_already_connected`, `rate_limited`
  - The `code` log key, with values `unreachable`, `host_not_allowed`, `tls_required`, `auth_failed`, `smtp_disabled`, `connect_failed`, `timeout`, `db`
  - The redacted error text `email hub mail server: <code>`
  - Log messages `email hub sent copy append failed` and `email hub server change cleanup failed`
  - Audit metadata `server_changed`
  - `emailhub.ServerSavesSent`
  - Allowed ports 25/143/465/587/993
  - `audit_events.metadata` is `TEXT`, so cast it with `::jsonb`.
- Produces: no code; verification lines for the controller's PR body.

- [ ] **Step 1: Write the failing check**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
r=docs/ops/RUNBOOK_EMAIL_HUB.md
s=docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md
! grep -q 'cho tới GĐ2' "$r" \
  && grep -q 'email_hub_invalid_server' "$r" \
  && grep -q 'email_hub_host_not_allowed' "$r" \
  && grep -q 'email hub sent copy append failed' "$r" \
  && grep -q 'server_changed' "$r" \
  && grep -q 'UNI-1238' "$r" \
  && grep -q 'GĐ2 = UNI-1238' "$s" \
  && echo OK || echo MISSING
```

- [ ] **Step 2: Run it to confirm it fails, then check the shipped strings**

Expected: `MISSING`.

Before editing, confirm each string the runbook quotes exists in the code. The first eight greps must each print at least one hit. If one comes back empty, find the real string in the code and use that; do not invent one.

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server
grep -rn '"email_hub_invalid_server"\|"email_hub_host_not_allowed"' internal/service/ | grep -v _test
grep -rn '"timeout"\|"db"' internal/service/email_hub_connect.go
grep -rn 'email hub sent copy append failed' internal/service/ | grep -v _test
grep -rn 'email hub server change cleanup failed' internal/service/ | grep -v _test
grep -rn 'email hub mail server: %s' internal/service/ | grep -v _test
grep -rn '"server_changed"' internal/service/ | grep -v _test
grep -rn 'func ServerSavesSent' internal/emailhub/
grep -rn 'RecordHeaderError' internal/service/email_hub_connect.go
# Leftover "until GĐ2" caveats: expected no output
grep -rn 'cho tới GĐ2\|until GĐ2\|until GD2' internal/ ../docs/ops/ | grep -v '_test.go' || true
# Raw err at log sites: every remaining hit must be a DB or storage error, never IMAP/SMTP/dial
grep -n '"err", ' internal/service/email_hub.go internal/service/email_hub_sync.go internal/service/email_hub_watcher.go internal/service/email_hub_body.go internal/service/email_hub_folders.go internal/service/email_hub_search.go internal/service/email_hub_attachments.go internal/service/email_hub_connect.go internal/service/email_hub_sent_append.go
```

Read each remaining hit of the last grep against its call. If one still logs a raw mail-server `err`, Task 4 is incomplete: report it to the controller and do not patch code in this task.

- [ ] **Step 3: Write the docs**

**3a.** In `docs/ops/RUNBOOK_EMAIL_HUB.md`, replace line 3 with:

```markdown
> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237, UNI-1238
```

**3b.** Replace everything from `### Kết nối thất bại` through the line ending `cho tới GĐ2, khi máy chủ tùy chỉnh ra mắt.` with the block below. Leave `### Migration dedupe và unique index` and everything after it as is.

````markdown
### Kết nối thất bại

Trường máy chủ được kiểm tra trước mọi lần dial, nên ba mã đầu không bao giờ chạm mạng.

| Mã API | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `email_hub_unsupported` (400) | Không có trường máy chủ và tên miền không thuộc danh sách nhà cung cấp có sẵn (`emailhub.ProviderForEmail`) | Chọn *Tên miền riêng* và nhập máy chủ IMAP/SMTP |
| `email_hub_invalid_server` (400) | Có trường máy chủ nhưng thiếu một trong sáu trường, hoặc một trường sai định dạng: host có scheme, cổng hay đường dẫn (`imaps://…`, `mail.example.com:993`), nhãn rỗng (`mail..example.com`), dài quá 253 ký tự; port ngoài `25, 143, 465, 587, 993`; bảo mật khác `tls`/`starttls`; tên đăng nhập quá 320 ký tự. `error.fields.field` là tên trường SDI (`imap_host`, `smtp_port`, `username`, …) | Client hiện lỗi ngay cạnh ô đó. Port gửi dạng chuỗi (`"imap_port": "993"`) không tới được bước này: `decode` trả `400 invalid_request` |
| `email_hub_host_not_allowed` (400) | Host là IP literal thuộc dải `netguard` chặn (loopback, private, link-local như `169.254.169.254`, kể cả dạng IPv4-mapped `::ffff:10.0.0.1`) | Dùng hostname hoặc IP công khai của máy chủ thư |
| `email_hub_already_connected` (409) | Địa chỉ đã có tài khoản `active` cùng kiểu xác thực, cùng host + port IMAP (đã chuẩn hoá); kiểm tra chạy trước khi dial. Chỉ đổi SMTP hoặc tên đăng nhập trên một tài khoản `active` cũng nhận mã này | Không phải lỗi. Muốn đổi riêng phần SMTP của tài khoản đang chạy thì ngắt kết nối rồi kết nối lại (cache tải lại từ đầu) |
| `email_hub_unreachable` (400) | DNS không phân giải; TCP/TLS không xong trong hạn; chứng chỉ không khớp host đã nhập (hay gặp ở cPanel dùng chứng chỉ chung của máy chủ); chọn STARTTLS cho cổng 993/465 (treo ở lời chào tới hết hạn); **hoặc** hostname phân giải ra IP bị `netguard` chặn | Cố ý gộp chung để API không thành công cụ dò mạng nội bộ. Hỏi nhà cung cấp hosting hostname ghi trên chứng chỉ (thường là `server.<hosting>`, không phải `mail.<tên miền>`) và kiểm tra cặp cổng/bảo mật |
| `email_hub_tls_required` (400) | Máy chủ không có TLS ngầm định, không quảng bá `STARTTLS`, hoặc bảo mật không khớp cổng (chọn TLS cho 143/587 thì máy chủ chào bằng văn bản thường) | Cặp thường dùng: IMAP 993 + TLS hoặc 143 + STARTTLS; SMTP 465 + TLS hoặc 587 + STARTTLS. Hộp thư không có TLS không được hỗ trợ |
| `email_hub_connect_failed` (400) | Máy chủ từ chối đăng nhập | Sai mật khẩu, hoặc máy chủ cần tên đăng nhập khác địa chỉ email (điền ô *Tên đăng nhập*) |
| `email_hub_smtp_disabled` (400) | Như mục M365 ở trên, phát hiện ngay lúc kết nối | Bật SMTP AUTH rồi kết nối lại |
| `rate_limited` (429) | Quá 10 lần kết nối / 10 phút cho mỗi người dùng (cần Redis) | Chờ vài phút |

Mọi dòng log trên đường chạm máy chủ thư chỉ ghi mã đã phân loại ở khoá `code`, kèm
`account_id` / `thread_id` / `user_id` / `provider`. Các đường đó gồm: kết nối, gửi, APPEND,
sync, watcher IDLE, tải body và attachment, tìm IMAP, chuyển thư mục, đánh dấu. Các mã gồm
`unreachable`, `host_not_allowed`, `tls_required`, `auth_failed`, `smtp_disabled`,
`connect_failed`, `timeout`, `db`.

Host, email, tên đăng nhập và phản hồi thô của máy chủ không có trong log. Lỗi trả lên handler
cũng đã được rút gọn thành `email hub mail server: <code>`, nên log 500 mặc định cũng không
chứa host.

Khi log có `host_not_allowed` mà API trả `email_hub_unreachable`, hostname đã phân giải ra IP
bị chặn. Khi IP literal bị chặn, API trả thẳng `email_hub_host_not_allowed`.

Cần biết máy chủ của một tài khoản thì đọc dòng của nó. Không dán kết quả ra kênh chung:

```sql
SELECT provider, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security
FROM email_hub_accounts WHERE id = '<account_id>';
```

### Kết nối lại đổi máy chủ

Kết nối lại một tài khoản `needs_reconnect` giữ nguyên id. Host được so sánh sau khi chuẩn hoá
(chữ thường, bỏ dấu chấm cuối, punycode), nên `MAIL.Example.COM.` và `mail.example.com` là
cùng một máy chủ.

Chỉ khi host hoặc port IMAP thật sự đổi, `sync_state` mới về rỗng, ngay trong transaction kết
nối. Sau commit, server làm các bước sau:

1. Dừng watcher IDLE. Client đăng ký lại sau khi tải lại danh sách tài khoản.
2. Quên bản đồ thư mục đã cache.
3. Xoá threads, attachments, tóm tắt AI và huỷ hẹn giờ gửi của tài khoản.
4. Sync lại từ đầu.

Công việc đọc tài khoản trước lần kết nối lại (một lượt sync, IDLE hay tìm IMAP còn chạy) bị
chặn trên node này theo `credential_version`, nên không ghi được thread, không prune được, và
lệnh ghi `sync_state` có điều kiện `credential_version` nên cũng không ghi được.

Đổi riêng SMTP hoặc tên đăng nhập thì giữ nguyên cache. Nếu bước dọn cache lỗi, kết nối vẫn
thành công: có một dòng Warn `email hub server change cleanup failed` kèm `account_id` và
`code`, và lần sync sau ghi đè dữ liệu cũ.

Xem các lần kết nối lại có đổi máy chủ:

```sql
SELECT occurred_at,
       metadata::jsonb->>'provider'       AS provider,
       metadata::jsonb->>'reconnected'    AS reconnected,
       metadata::jsonb->>'server_changed' AS server_changed
FROM audit_events
WHERE action = 'email_hub_account.connected' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 10;
```

### Thư đã gửi thiếu trong Sent trên máy chủ (APPEND)

Áp dụng cho `provider = 'custom'` có máy chủ IMAP không phải Gmail hay Microsoft
(`emailhub.ServerSavesSent`). Sau khi SMTP gửi xong, server `APPEND` đúng bản MIME đã gửi (cờ
`\Seen`) vào thư mục SPECIAL-USE `\Sent`, không có thì vào `SENT`. Hẹn giờ gửi đi cùng đường
này.

Tài khoản `custom` trỏ vào `imap.gmail.com` hoặc `outlook.office365.com` (Workspace/M365 trên
tên miền riêng) không APPEND, vì máy chủ tự lưu thư đã gửi.

- Thành công: máy chủ có UIDPLUS thì dòng Sent cục bộ nhận ngay UID thật. Không có UIDPLUS
  thì dòng giữ UID tạm, và lần sync Sent kế tiếp hợp nhất theo `Message-ID`. Cả hai trường
  hợp, Sent hiện đúng một bản.
- Thất bại: chỉ ghi log `email hub sent copy append failed` kèm `account_id` và `code`. Lần
  gửi vẫn thành công (201) và không thử lại. Thư tới người nhận nhưng không có bản trong Sent
  trên máy chủ, và dòng Sent cục bộ (UID tạm) biến mất ở lần làm mới Sent kế tiếp.
  - `auth_failed` đi qua luồng *cần kết nối lại* như mọi lỗi xác thực khác.
  - Lý do khác thường là hộp thư đầy quota, hoặc máy chủ không có thư mục Sent. Người dùng
    tạo thư mục Sent hoặc giải phóng dung lượng trong webmail.
````

**3c.** In the spec, replace line 3 and line 6. GĐ3 is still open, so the status stays `in-progress`:

```diff
-> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1 trong `docs/superpowers/plans/`, PR mở vào `develop`; GĐ2 (máy chủ tùy chỉnh) và GĐ3 (OAuth) chưa bắt đầu.
+> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1, PR #220 vào `develop`. GĐ2 (máy chủ tùy chỉnh, UNI-1238) triển khai theo plan GĐ2 trên nhánh `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin`, xếp chồng lên GĐ1. GĐ3 (OAuth) chưa bắt đầu.
@@
-**Issue:** GĐ1 = UNI-1237; GĐ2, GĐ3 chưa có issue. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
+**Issue:** cha UNI-1236; GĐ1 = UNI-1237, GĐ2 = UNI-1238; GĐ3 chưa có issue. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
```

If either old line does not match exactly, read it and keep everything except the parts about GĐ2.

**3d.** In this plan, replace line 3 (`> **Trạng thái:** …`) with:

```markdown
> **Trạng thái:** in-progress — GĐ2 đã triển khai trên nhánh `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin` (2026-10-11), kiểm chứng bằng test có chọn lọc ở máy; bộ test đầy đủ chạy trên CI. PR chờ review.
```

- [ ] **Step 4: Run the check and the doc contract tests**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
# Step 1 block again → expected: OK
node --test scripts/governance.test.mjs scripts/alerts-runbooks.test.mjs scripts/no-pii-log.test.mjs scripts/i18n-duplicate-keys.test.mjs scripts/i18n-chat-key-parity.test.mjs
```

Expected: the check prints `OK`, and every test passes.

- [ ] **Step 5: Targeted verification (no full suites, per the user)**

Keep each block's summary line for the PR body. Do not run `make check`, `make test-go`, `./internal/service/` without `-run`, or an unfiltered `pnpm test`.

Go:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server
gofmt -l internal/ pkg/                       # expected: no output
go vet ./internal/service/ ./internal/emailhub/... ./internal/handler/... ./pkg/db/
go tool staticcheck ./internal/service/ ./internal/emailhub/... ./internal/handler/... ./pkg/db/
go test -count=1 ./internal/emailhub/...      # no DB
go test -count=1 ./internal/                  # arch tests
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' \
  go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHub|TestResolveEmailHub|TestUpdateEmailHubAccountSyncState|TestEveryAuditedCommandWritesItsRow'
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' \
  go test -count=1 -timeout 30m ./internal/handler/... -run 'EmailHub|Isolation|EveryBodyIDFieldHasAReferenceCase|Swagger|EveryRouteFieldIsBound'
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' \
  go test -count=1 ./migrations/ -run 'TestEveryQueryNamesItsTenant'
cd .. && make sqlc && git status --porcelain server/pkg/db   # expected: no output
```

TS:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub i18n/parity.test.ts
cd ../views
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub settings/components/integrations-tab.test.tsx
cd ../..
pnpm --filter @uniwork/core typecheck && pnpm --filter @uniwork/views typecheck && pnpm --filter @uniwork/web typecheck
pnpm exec eslint --max-warnings 0 $(git diff --name-only --diff-filter=AM "$(git merge-base HEAD origin/feature/UNI-1237-email-hub-gd1-nen-tang-migration-netguar)"...HEAD -- 'packages/**/*.ts' 'packages/**/*.tsx')
pnpm knip
```

ESLint runs only on the TS files this branch touched, because develop has pre-existing lint errors in unrelated files. If the GĐ1 ref does not exist, use `git merge-base HEAD origin/develop` and say so in the report.

If a check fails because of GĐ2 code, fix it in a separate `fix(email-hub): …` commit that names the check, then re-run only that block.

- [ ] **Step 6: Coverage numbers (no change)**

Leave every coverage threshold as it is. They measure whole packages, or the whole merged profile for Go, and only a full run produces those numbers. The user ruled out full local runs. CI measures them: TS only prints a drop at `GATE_LEVEL=fast`, while the Go floor blocks at every level. Say this in the PR body.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add docs/ops/RUNBOOK_EMAIL_HUB.md docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md docs/superpowers/plans/2026-10-11-email-hub-gd2-custom-server.md
git commit -m "docs(email-hub): runbook for custom-server connects, server changes and Sent APPEND" \
  -m "GD2 ships custom IMAP/SMTP servers, so on-call needs the new 400 codes (invalid_server with fields.field, host_not_allowed) and how unreachable/tls_required now also cover certificate and port/security mismatches. The GD1 caveat that sync/watcher/body/move/mark paths log raw err is gone because every mail-server log site now writes a classified code. Adds what a server-changing reconnect wipes (audit server_changed) and what a failed APPEND leaves behind. Spec and plan status lines name GD2 = UNI-1238. Left out: coverage floors (no full local run to measure them, by request; CI measures) and any OAuth/GD3 material." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Report for the PR body (controller opens the PR)**

Return one line for each of these:
1. The Step 4 result.
2. Each Step 5 command with its summary line.
3. The Step 2 raw-`err` audit, naming which remaining hits are DB/storage only.
4. "Coverage floors unchanged and not measured locally (user request); the CI full shards measure them."
5. What was not run: a full `./internal/service` run with `-race`, `make check`, E2E.
6. Merge order. This branch is stacked on GĐ1 (PR #220). PR #218 (UNI-1234) also edits `email-hub-account-menu.tsx` and both locale files, so whichever PR lands later rebases.
