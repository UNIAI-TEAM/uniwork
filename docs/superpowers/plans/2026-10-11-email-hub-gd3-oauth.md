# Email Hub GĐ3 — OAuth Google/Microsoft (XOAUTH2, popup, kết nối lại) (UNI-1239)

> **Trạng thái:** in-progress — plan GĐ3 của spec OAuth/máy chủ tùy chỉnh; thực thi bằng subagent-driven-development trên nhánh `feature/UNI-1239-email-hub-gd3-oauth-google-microsoft-xoa`, xếp chồng trên GĐ2 (PR #221) và GĐ1 (PR #220) (2026-10-11).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member connects Gmail/Google Workspace or Outlook.com/Microsoft 365 by signing in with Google or Microsoft in a popup, with no App Password. The server holds a refresh token for Email Hub's own OAuth client and speaks XOAUTH2 to the same IMAP/SMTP presets. Access tokens are refreshed under a per-account mutex, and every token write is conditional on `credential_version` and `oauth_access_expires_at`. `invalid_grant` moves the account to needs_reconnect and keeps the cached mail. Google refresh tokens are revoked wherever they leave the row. On the web the method step gains Google/Microsoft buttons, App Password becomes a secondary link, the planned `mail_oauth` settings card goes, and an OAuth account reconnects through the popup with `login_hint`.

**Architecture:**
- **Config.** `config.Config` gains `EmailHubGoogleClientID/Secret`, `EmailHubMicrosoftClientID/Secret`, `EmailHubMicrosoftTenant` (default `common`) and `EmailHubRedirectURL(provider)`. `.env.example` lists them in the same commit.
- **Presets.** `emailhub.Preset(name)` returns the gmail/outlook servers by name, so Workspace/M365 custom domains use them too.
- **XOAUTH2.** `imapclient.Credentials` and `smtpclient.Credentials` gain `AccessToken`. IMAP runs `AUTHENTICATE XOAUTH2` through `cl.Execute` (keeps the status code), SMTP runs one `AUTH XOAUTH2` with no PLAIN/LOGIN fallback. Error classification is unchanged.
- **Registry.** `email_hub_oauth.go` holds `emailHubOAuthProvider{name, authKind, preset, config, revokeURL, prompt}`, `ConfigureOAuth(cfg)` (called from main; nothing without the box or without both id and secret), `oauthProvider`, `oauthByKind`, `oauthCtx` (puts `oauth2.HTTPClient = s.oauthHTTP`, 15s) and `Providers`.
- **Refresh.** `credentials()` gains the `oauth_*` branch: skew 2m → per-account `*sync.Mutex` → re-read → `TokenSource.Token()` → seal → conditional `UpdateEmailHubAccountOAuthTokens`; 0 rows → re-read and use the winner's token; `invalid_grant`/`unauthorized_client` mark `oauth_invalid_grant` only when the re-read row is unchanged.
- **Start.** `StartOAuth` (membership → provider → PKCE verifier + 32-byte nonce → sealed JSON state, exp 10m) returns the URL and the nonce; the handler sets the HttpOnly `uniwork_email_oauth` cookie.
- **Callback.** `CompleteOAuth` (own file `email_hub_oauth_callback.go`) opens the state, compares the nonce in constant time, maps `access_denied`, re-checks membership, exchanges with the verifier, reads the address from the `id_token`, verifies XOAUTH2 IMAP+SMTP and saves through the same `saveEmailHubConnection` / `afterEmailHubConnect` path as `Connect`. The route sits outside `authed` (`registerEmailHubCallback` beside `registerAuth`, `credentialLimit`) and always answers a constant-script HTML page that posts `{type:"uniwork:email-hub-oauth", ok, code}` to `FRONTEND_ORIGIN`, with a hashed CSP.
- **Revoke.** `revokeEmailHubToken` is a best-effort 5s POST to Google after commit on Disconnect, Leave, DeleteAccount, a reconnect that changes the auth kind, and `markAuthFailed` for any reason but `oauth_invalid_grant`. It skips a grant another live row still holds.
- **Client.** Core gains `getEmailHubProviders`/`startEmailHubOAuth` and two hooks. Views gains `integrations/use-oauth-popup.ts` (extracted from the calendar dialog, which moves onto it), `connect-method-step.tsx`, OAuth result copy and the OAuth reconnect with `login_hint`. The settings `mail_oauth` card goes.
- **No new infrastructure.** No migration (the `oauth_*` columns exist since GĐ1), no audit action, no outbox topic.

**Tech Stack:** Go (Chi, pgx + sqlc, `golang.org/x/oauth2` v0.36, go-imap v1.2.1, `net/smtp`), PostgreSQL, Next.js/React, TanStack Query, zod, i18next, Vitest, `node --test`.

**Spec:** docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md

## Global Constraints

- Issue UNI-1239 (parent UNI-1236). Work only in `/Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237` on `feature/UNI-1239-email-hub-gd3-oauth-google-microsoft-xoa`; stacked on GĐ2 (PR #221) on GĐ1 (PR #220). The PR targets `develop`, states both dependencies; the controller opens it.
- Commits: `feat|fix|test|refactor(email-hub)` or `docs`; the body gives the reason and what was left out; last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `prepare-commit-msg` adds `Refs: UNI-1239`: never type it, never strip it. Never `--no-verify`; never put `git` and ` -n` in one Bash call (use `--line-number`).
- No full local suites (user ruling from GĐ2): no unfiltered `./internal/service`, no `make check`, no `make test-go`. Each task runs only its listed `go test -run`, vitest files, typecheck, eslint and knip. CI runs the shards.
- Precedence: the spec wins over the plan, the plan header wins over a task. The current GĐ1/GĐ2 code is the truth about present state, not spec §1.1.
- Email Hub uses its OWN OAuth client (Q3): `EMAIL_HUB_GOOGLE_*`, `EMAIL_HUB_MICROSOFT_*`. Never `GOOGLE_CLIENT_ID` or `MICROSOFT_CALENDAR_*`. Missing env hides the provider; no feature flag (Q9); OAuth needs `EMAIL_HUB_CREDENTIAL_KEY` too.
- Every variable the server reads is in `.env.example` in the same commit (`scripts/env-example.test.mjs`), so `.env.example` lands in Task 1.
- Token-endpoint HTTP goes through `golang.org/x/oauth2` on `s.oauthHTTP` via `oauthCtx`; the Google revoke is one `net/http` POST on `s.oauthHTTP`. Tests point endpoints at `httptest` servers by assigning `s.oauth`/`s.oauthHTTP` in package `service`. No exported seam, no env bypass. The calendar has no seam to reuse.
- Membership first: `Providers`, `StartOAuth`, and `CompleteOAuth` once the state and nonce are checked call `s.workspace` before any provider/config check or Exchange. Handlers build only `service.Human`; the callback builds `Human(state.UserID)` inside the service.
- Audit: no new action. OAuth connects write `email_hub_account.connected` (metadata `auth_kind`, `provider`, `reconnected`, `server_changed`) in the save tx. `markAuthFailed` keeps its audit + `email_hub.inbox_changed` in one tx.
- Writes from a credential snapshot compare `credential_version`; the token write also compares the previous `oauth_access_expires_at` (NULL matches NULL). A refresh never bumps `credential_version`.
- Logs carry ids and classified codes only (`account_id`, `user_id`, `provider`, `code`, `reason`). Never an email, token, id_token, code, state, nonce, verifier, provider error description or raw oauth2/imapclient/smtpclient error (`scripts/no-pii-log.test.mjs`).
- Every sqlc query constrains `organization_id = $n` or carries a valid `-- tenant:` line (`TestEveryQueryNamesItsTenant`). Run `make sqlc` after editing `email_hub.sql`. No migration.
- API: routes register through `apiOp` with SDI/SDO in `dto/sdi/email_hub.go` / `dto/sdo/email_hub.go`, with `description` and `example`. `{provider}` reuses the existing `pathParamSDI` cases (description made neutral). The callback sits outside `authed` on `credentialLimit`. Start uses the same `connectLimit` limiter as `POST accounts`, which keys per route, so start has its own 10/10min counter shared by Google and Microsoft.
- Isolation matrix: providers is covered by default (owner 200). Start is in `isoRoutes` with `skipControl` ("no OAuth client is configured in tests; the owner gets 404"). The callback is `isoPublic` / `reasonProvider`. No body field ends in `_id`.
- Client API compat: `parseWithFallback` with lenient schemas; every new endpoint ships a malformed-response test in `packages/core/api/endpoints/email-hub.test.ts`; every switch over a server value (`auth_kind`, OAuth result code) has a `default`.
- `packages/views`: every JSX text through `t()`, keys in en.json and vi.json per `docs/conventions.md`; error keys stay FLAT under `email_hub.connect.error_*`; files ≤500 counted lines; no `next/*`; primitives from `@uniwork/ui`. `packages/views/email-hub/email-hub-view.tsx` is not edited (at the line cap).
- knip: every new export has a non-test consumer by the end of its task. `useOAuthPopup` gets the calendar in Task 9 and the email hub in Task 10.
- Q10: web only. Desktop gets no OAuth deep link.
- Ruling (controller, 2026-10-11 — plan default accepted): spec §4.4 step 4 revokes a token received on a lost refresh race. Plan default: never revoke it (revoking a Google token ends the whole grant, killing the winner's token). Task 11 amends the spec.
- Ruling (controller, 2026-10-11 — plan default accepted): spec §5.5 revokes on `UpdateEmailHubAccountCredentials` "khi token cũ khác token mới". Plan default: revoke only when the auth kind changes (same kind = same Google grant; revoking would kill the token just stored).
- Ruling (controller, 2026-10-11 — plan default accepted): spec §5.5 does not list `markAuthFailed`. Plan default: revoke there too for every reason but `oauth_invalid_grant` (a live grant is left behind otherwise).
- Ruling (controller, 2026-10-11 — plan default accepted): the same Google mailbox can be live in two rows (another organization or user). Plan default: YES, skip the revoke while another live `oauth_google` row with that address holds a refresh token (Task 7 Step 8, `CountEmailHubOAuthGrantHolders`, `-- tenant: system`).
- Ruling (controller, 2026-10-11 — plan default accepted): spec §4.4 says refresh runs before the governor's IMAP slot. True for sync, watch, IDLE and send; backfill, mark read/star, body prefetch, IMAP search and Sent APPEND reach `credentials()` inside `withIMAP`. Plan default: accept (bounded by the 15s client); follow-up issue to hoist `credentials()` out of `withIMAP`.
- Ruling (controller, 2026-10-11 — plan default accepted): spec §6.2 has `onReconnect` open the popup directly by `auth_kind`. Plan default: `onReconnect` keeps opening the dialog, which for an `oauth_*` account shows only that provider's button with `login_hint` (one extra click; popups must open inside the click and `email-hub-view.tsx` is at its cap).
- Ruling (controller, 2026-10-11 — plan default accepted): spec §5.4 order puts membership at step 6 and the refresh-token check at step 8 (after verify). Plan default: membership right after state/nonce/provider-error (a deactivated member never spends the code), refresh-token check right after Exchange (saves two dials). Outcomes differ only in which code wins.
- Ruling (controller, 2026-10-11 — plan default accepted): provider `error` other than `access_denied` (e.g. `consent_required`, `interaction_required` from M365 admin consent) answers `failed`, per spec §5.4. Plan default: keep `failed`; the runbook explains it.
- Ruling (controller, 2026-10-11 — plan default accepted): provider env removed while OAuth accounts exist. Plan default: transient `oauth_not_configured`, no needs_reconnect; sync stops when the access token expires (runbook says so).
- Ruling (controller, 2026-10-11 — plan default accepted): spec §6.1 narrows `auth_kind` in the exported type. Plan default: schema and type stay `string` (GĐ1 deferral); `oauthProviderOf` in Task 10 switches with a `default`. No unused `EmailHubAuthKind` export (knip).
- Ruling (controller, 2026-10-11 — plan default accepted): no `account_mismatch` code. If the user picks another account than `login_hint`, the callback connects (or 409s) the proven address and the reconnect target stays needs_reconnect. The message carries no account id, so `onConnected` is not called for OAuth.
- Ruling (controller, 2026-10-11 — plan default accepted): review focus asks not to tear the listener down on `closed` (COOP). Plan default: exactly one outcome per `open()`; once COOP severs the opener no message can arrive anyway. The §10 manual checklist verifies postMessage reaches the opener.
- Ruling (controller, 2026-10-11 — plan default accepted): the callback CSP adds `frame-ancestors 'none'; base-uri 'none'` to the spec's literal `default-src 'none'; script-src 'sha256-…'`. Plan default: add them (default-src does not cover them).
- Ruling (controller, 2026-10-11 — plan default accepted): org deactivation does not revoke (F-03 keeps the row and its token). Plan default: no revoke.

## Review Focus

- Two pods refreshing one account: mutex covers re-read, refresh and write; the write matches `credential_version` AND `oauth_access_expires_at IS NOT DISTINCT FROM` the read value; a loser uses the winner's token and never revokes; `invalid_grant` marks only an unchanged row — `TestEmailHubOAuthRefreshTwoServicesOneWriter`, `TestEmailHubOAuthInvalidGrantAfterOtherPodRefreshedStaysActive`, `TestEmailHubOAuthInvalidGrantAfterReconnectStaysActive`, `TestEmailHubOAuthRefreshRacingDisconnect`, `TestUpdateEmailHubAccountOAuthTokensConditional`.
- Callback replay and tampering: sealed state with exp, `state.provider` = path, constant-time nonce, empty cookie never matches, cookie cleared on every branch, verifier only from the state, membership re-checked, constant script with one CSP hash — `TestEmailHubCompleteOAuthStateChecks`, `TestEmailHubCompleteOAuthNonMember`, `TestEmailHubOAuthCallbackClearsCookieOnEveryBranch`, `TestEmailHubOAuthCallbackPage`, `TestEmailHubOAuthStateRejectsTamperedAndExpired`.
- The account the user actually picked: claim selection (Google `email` only when `email_verified`, Microsoft `email` then `preferred_username`), lowercase/trim, bare address, XOAUTH2 verify always on the proven address — `TestEmailHubIDTokenEmail`, `TestEmailHubCompleteOAuthCreatesAccount`, `TestEmailHubCompleteOAuthRefusesBeforeVerify`.
- Popup lifecycle: blocked → visible error and no pending; start rejects → popup closed; wrong origin/type/source ignored; closed with no message → refetch, no error; listener and interval removed on result and unmount — `use-oauth-popup.test.tsx` (all cases) and the `ConnectAccountDialog sign-in with Google or Microsoft` describe in `connect-account-dialog.test.tsx`.
- Revoke on every path, revoke failing: each path revokes the token THAT statement removed, after commit, 5s bound, code-only log, never fails the command; Microsoft no-op; shared grant skipped — `TestDisconnectReturnsPreviousRefreshToken`, `TestEmailHubRevokeOnDisconnect`, `TestEmailHubRevokeOnLeaveAndAccountDeletion`, `TestEmailHubRevokeOnImapAuthFailedNotOnInvalidGrant`, `TestEmailHubRevokeFailureDoesNotFailDisconnect`, `TestEmailHubRevokeSkipsAGrantAnotherMailboxStillHolds`.

## File Structure

Server:
- `server/internal/config/config.go`, `config_test.go` — Email Hub OAuth env fields, tenant default, `EmailHubRedirectURL`.
- `.env.example` — the five `EMAIL_HUB_*` OAuth variables and the redirect URIs to register.
- `server/internal/emailhub/provider.go`, `provider_test.go` — `Preset(name)`.
- `server/internal/emailhub/imapclient/client.go`, `xoauth2.go` (new), `xoauth2_test.go` (new), `fake_server_test.go` — `Credentials.AccessToken`, `xoauth2Client`, `authenticateXOAUTH2`, shared `finishLogin`; fake AUTHENTICATE XOAUTH2.
- `server/internal/emailhub/smtpclient/send.go`, `session.go`, `auth.go`, `auth_test.go`, `fake_server_test.go` — `Credentials.AccessToken`, `xoauth2Auth`; fake AUTH XOAUTH2. `go.mod` unchanged (go-sasl stays indirect).
- `server/internal/service/email_hub_oauth.go` (new), `email_hub_oauth_test.go` (new) — provider registry, `ConfigureOAuth`, lookups, `oauthCtx`, `Providers`.
- `server/internal/service/email_hub_oauth_refresh.go` (new), `email_hub_oauth_refresh_test.go` (new) — `oauthAccessToken`, `refreshLock`, `sealSecret`, invalid_grant handling.
- `server/internal/service/email_hub_folders.go` — `credentials()` OAuth branch.
- `server/internal/service/email_hub_oauth_flow.go` (new), `email_hub_oauth_flow_test.go` (new) — `emailHubOAuthState`, `StartOAuth`, `openOAuthState`.
- `server/internal/service/email_hub_oauth_callback.go` (new), `email_hub_oauth_callback_test.go` (new) — `CompleteOAuth`, result codes, `emailHubIDTokenEmail`.
- `server/internal/service/email_hub_connect.go`, `email_hub_connect_server.go` — `emailHubSealedCredential`, `saveEmailHubConnection` returning `prev`, `afterEmailHubConnect`, `presetEmailHubServer`, `emailHubErrCode` OAuth codes.
- `server/internal/service/email_hub_oauth_revoke.go` (new), `email_hub_oauth_revoke_test.go` (new) — `revokeEmailHubToken`, `revokeReplacedEmailHubToken`.
- `server/internal/service/email_hub.go`, `email_hub_watcher.go`, `organization_members.go`, `auth.go`, `account_deletion.go` — fields, Disconnect revoke, `cleanUpEmailHubAccountsAfterCommit(hub)`, `SetEmailHub` setters, `markAuthFailed` revoke.
- `server/internal/service/email_hub_account_queries_test.go`, `email_hub_connect_test.go`, `email_hub_needs_reconnect_test.go`, `email_hub_auth_failure_test.go`, `email_hub_schedule_test.go` — callers moved onto the changed query shapes.
- `server/cmd/server/main.go` — `ConfigureOAuth(cfg)`, `orgMemberSvc.SetEmailHub`, `authSvc.SetEmailHub`.
- `server/pkg/db/queries/email_hub.sql`, `server/pkg/db/generated/email_hub.sql.go` — `UpdateEmailHubAccountOAuthTokens`, oauth_* args on Create/UpdateCredentials, `RETURNING old.*` on the three clearing statements, `CountEmailHubOAuthGrantHolders`.
- `server/internal/handler/email_hub_oauth.go` (new), `email_hub_oauth_test.go` (new) — providers, start (cookie), callback (HTML page, CSP hash, cookie clear).
- `server/internal/handler/email_hub_test.go` — `setupEmailHubHTTP` takes variadic `configure ...func(*Deps)`.
- `server/internal/handler/dto/sdi/email_hub.go`, `dto/sdo/email_hub.go` — `StartEmailHubOAuthSDI`, `EmailHubProvidersSDO`, `EmailHubOAuthStartSDO`.
- `server/internal/handler/router/email_hub.go`, `router.go`, `routes.go`, `openapi.go`, `email_hub_ratelimit_test.go`; `server/internal/handler/router.go` — routes, `registerEmailHubCallback`, `Routes` fields and mapping, neutral `{provider}` description, rate-limit pins.
- `server/internal/handler/isolation_routes_test.go` — start `skipControl`, callback `isoPublic`.

Client:
- `packages/core/types/email-hub.ts`, `api/endpoints/email-hub.ts` (+test), `email-hub/query-cache.ts`, `email-hub/hooks.ts` (+test) — schemas, types, endpoints, `emailHubKeys.providers`, two hooks.
- `packages/views/integrations/use-oauth-popup.ts` (new), `use-oauth-popup.test.tsx` (new) — shared popup hook.
- `packages/views/calendar/calendar-connections-dialog.tsx` — `connect()` on the hook.
- `packages/views/email-hub/connect-method-step.tsx` (new), `connect-account-dialog.tsx` (+test), `connect-account-errors.ts` (+ new test), `use-email-hub-account-panel.ts` — method step, OAuth results, OAuth reconnect.
- `packages/views/settings/components/integrations-tab.tsx` (+test) — `mail_oauth` card removed.
- `packages/core/i18n/locales/en.json`, `vi.json` — new keys, removed `settings.integrations.mail_oauth`, rewritten App-Password-only copy.

Docs:
- `docs/ops/RUNBOOK_EMAIL_HUB.md`, the spec, this plan — OAuth runbook, status lines.

---

### Task 1: Config, env, OAuth provider registry and the providers endpoint

**Files:**
- Modify: `server/internal/config/config.go`. Add five fields after `MicrosoftCalendarClientSecret` (line 84), `EmailHubRedirectURL` after `CalendarRedirectURL` (lines 155-157), and five reads after `MicrosoftCalendarClientSecret:` in `Load` (line 204).
- Modify: `.env.example`. Rewrite the `EMAIL_HUB_CREDENTIAL_KEY` comment (lines 114-117) and add the five variables under it.
- Modify: `server/internal/emailhub/provider.go`. Add `Preset` above `ServerSavesSent` (line 58).
- Modify: `server/internal/service/email_hub.go`. Add the `net/http` import (after `"log/slog"`, line 9), the `oauth`/`oauthHTTP` fields after `Tasks *TaskService` (line 52), and the default `oauthHTTP` in `NewEmailHubService` (line 67).
- Create: `server/internal/service/email_hub_oauth.go`
- Modify: `server/internal/handler/dto/sdo/email_hub.go`. Add `EmailHubProvidersSDO` above `EmailHubWatchSDO` (line 22).
- Modify: `server/internal/handler/router/email_hub.go`. Add one line to the route doc comment (line 13) and the providers route before the connect route (line 46).
- Modify: `server/internal/handler/router/routes.go`. Add the `GetEmailHubProviders` field after `ConnectEmailHubAccount` (line 180).
- Modify: `server/internal/handler/router.go`. Add the `GetEmailHubProviders:` mapping after `ConnectEmailHubAccount:` (line 282).
- Create: `server/internal/handler/email_hub_oauth.go`
- Modify: `server/cmd/server/main.go`. Call `emailHubSvc.ConfigureOAuth(cfg)` right after `NewEmailHubService` (line 492).
- Test: `server/internal/config/config_test.go` (append two tests), `server/internal/emailhub/provider_test.go` (append one), `server/internal/service/email_hub_oauth_test.go` (new), `server/internal/handler/email_hub_oauth_test.go` (new)

**Interfaces:**
- Consumes:
  - `config.Config{APIPublicURL}` and the existing `getenv(k, def)` in config.go.
  - `s.box` (`*secretbox.Box`). `s.workspace(ctx, actor, workspaceID) (db.Workspace, error)` (email_hub.go:122), which answers `ErrForbidden`/`ErrNotFound` for a non-member.
  - `emailhub.Provider` and the `providers` map (provider.go:16-46).
  - `golang.org/x/oauth2` v0.36.0 (already direct, go.mod:39).
  - Test helpers: `emailHubFixture` and `testEmailHubBox` (email_hub_integration_test.go); in the handler package `setupEmailHubHTTP` and `doJSON`.
- Produces:
  - Config:
    - Fields `EmailHubGoogleClientID, EmailHubGoogleClientSecret, EmailHubMicrosoftClientID, EmailHubMicrosoftClientSecret, EmailHubMicrosoftTenant string`. `EMAIL_HUB_MICROSOFT_TENANT` empty gives `"common"`.
    - `func (c Config) EmailHubRedirectURL(provider string) string`, which returns `strings.TrimRight(APIPublicURL, "/") + "/api/v1/email-hub-connections/" + provider + "/callback"`.
  - emailhub: `func Preset(name string) (Provider, bool)`. Only `"gmail"` and `"outlook"` (exact, lowercase) return true.
  - Service:
    - `type emailHubOAuthProvider struct { name, authKind string; preset emailhub.Provider; config oauth2.Config; revokeURL string; prompt string }`
    - EmailHubService fields `oauth map[string]*emailHubOAuthProvider` and `oauthHTTP *http.Client`. `NewEmailHubService` sets `oauthHTTP` to `&http.Client{Timeout: 15 * time.Second}`, so a test that assigns `s.oauth` directly still has a client (a typed-nil client in the oauth2 context would panic).
    - `func (s *EmailHubService) ConfigureOAuth(cfg config.Config)`. It registers only providers with both id and secret, and nothing when `s.box == nil`.
    - `func (s *EmailHubService) oauthProvider(name string) (*emailHubOAuthProvider, bool)`
    - `func (s *EmailHubService) oauthByKind(authKind string) (*emailHubOAuthProvider, bool)`
    - `func (s *EmailHubService) oauthCtx(ctx context.Context) context.Context`. It adds `oauth2.HTTPClient = s.oauthHTTP`.
    - `type EmailHubProviders struct{ Google, Microsoft bool }`
    - `func (s *EmailHubService) Providers(ctx context.Context, actor Actor, workspaceID string) (EmailHubProviders, error)`. It checks membership first.
    - Test helper `emailHubOAuthTestConfig() config.Config` (service test package), reused by Task 4.
  - Registry values:
    - google: authKind `oauth_google`, preset `gmail`, prompt `consent`, revokeURL `https://oauth2.googleapis.com/revoke`, AuthURL `https://accounts.google.com/o/oauth2/v2/auth`, TokenURL `https://oauth2.googleapis.com/token`, scopes `openid email https://mail.google.com/`.
    - microsoft: authKind `oauth_microsoft`, preset `outlook`, prompt `select_account`, revokeURL `""`, endpoints `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize|token`, scopes `openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`.
    - Both: `RedirectURL = cfg.EmailHubRedirectURL(name)`.
  - HTTP:
    - `sdo.EmailHubProvidersSDO{Google bool \`json:"google"\`; Microsoft bool \`json:"microsoft"\`}`
    - `Routes.GetEmailHubProviders`, mapped to `h.getEmailHubProviders`.
    - `GET /api/v1/workspaces/{workspaceID}/email-hub/providers` (authed; no rate limit beyond the global one).

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/config/config_test.go`:

```go
// Email Hub's callback sits beside the calendar's, one path per provider; a
// trailing slash on API_PUBLIC_URL must not double up (providers match byte for byte).
func TestEmailHubRedirectURL(t *testing.T) {
	t.Parallel()
	c := Config{APIPublicURL: "https://api.example.com/"}
	for provider, want := range map[string]string{
		"google":    "https://api.example.com/api/v1/email-hub-connections/google/callback",
		"microsoft": "https://api.example.com/api/v1/email-hub-connections/microsoft/callback",
	} {
		if got := c.EmailHubRedirectURL(provider); got != want {
			t.Errorf("EmailHubRedirectURL(%q) = %q, want %q", provider, got, want)
		}
	}
}

// Load reads Email Hub's own OAuth clients (spec Q3) and sends Microsoft
// sign-in to the common directory unless a tenant is named.
func TestLoadEmailHubOAuthClients(t *testing.T) {
	setRequired(t)
	t.Setenv("EMAIL_HUB_GOOGLE_CLIENT_ID", "hub-google-id")
	t.Setenv("EMAIL_HUB_GOOGLE_CLIENT_SECRET", "hub-google-secret")
	t.Setenv("EMAIL_HUB_MICROSOFT_CLIENT_ID", "hub-ms-id")
	t.Setenv("EMAIL_HUB_MICROSOFT_CLIENT_SECRET", "hub-ms-secret")
	t.Setenv("EMAIL_HUB_MICROSOFT_TENANT", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.EmailHubGoogleClientID != "hub-google-id" || c.EmailHubGoogleClientSecret != "hub-google-secret" ||
		c.EmailHubMicrosoftClientID != "hub-ms-id" || c.EmailHubMicrosoftClientSecret != "hub-ms-secret" {
		t.Fatalf("email hub clients: %+v", c)
	}
	if c.EmailHubMicrosoftTenant != "common" {
		t.Fatalf("EmailHubMicrosoftTenant = %q, want common", c.EmailHubMicrosoftTenant)
	}
	t.Setenv("EMAIL_HUB_MICROSOFT_TENANT", "contoso.onmicrosoft.com")
	if c, _ = Load(); c.EmailHubMicrosoftTenant != "contoso.onmicrosoft.com" {
		t.Fatalf("EmailHubMicrosoftTenant = %q, want the named tenant", c.EmailHubMicrosoftTenant)
	}
}
```

Append to `server/internal/emailhub/provider_test.go`:

```go
// OAuth names a provider, not a domain: a Workspace or Microsoft 365 mailbox on
// its own domain still uses the gmail/outlook servers (spec §4.4).
func TestPresetByName(t *testing.T) {
	t.Parallel()
	for name, host := range map[string]string{"gmail": "imap.gmail.com", "outlook": "outlook.office365.com"} {
		p, ok := Preset(name)
		if !ok || p.Name != name || p.IMAPHost != host || p.IMAPPort != 993 || p.SMTPPort != 587 {
			t.Errorf("Preset(%q) = %+v ok=%v", name, p, ok)
		}
	}
	for _, name := range []string{"yahoo", "custom", "", "GMAIL"} {
		if p, ok := Preset(name); ok {
			t.Errorf("Preset(%q) = %+v, want none: only the OAuth providers have a preset by name", name, p)
		}
	}
}
```

Create `server/internal/service/email_hub_oauth_test.go`:

```go
package service

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// emailHubOAuthTestConfig enables both providers with Email Hub's own clients.
// The login and calendar clients are set too, so a registry that read them
// would show in the client ids.
func emailHubOAuthTestConfig() config.Config {
	return config.Config{
		APIPublicURL:                  "https://api.example.com/",
		GoogleClientID:                "login-google-id",
		GoogleClientSecret:            "login-google-secret",
		MicrosoftCalendarClientID:     "calendar-ms-id",
		MicrosoftCalendarClientSecret: "calendar-ms-secret",
		EmailHubGoogleClientID:        "hub-google-id",
		EmailHubGoogleClientSecret:    "hub-google-secret",
		EmailHubMicrosoftClientID:     "hub-ms-id",
		EmailHubMicrosoftClientSecret: "hub-ms-secret",
		EmailHubMicrosoftTenant:       "contoso.example",
	}
}

// Each provider uses Email Hub's own client (spec Q3), its preset servers, the
// scopes of spec §5.6 and a callback under /email-hub-connections/.
func TestEmailHubConfigureOAuthUsesItsOwnClients(t *testing.T) {
	t.Parallel()
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	svc.ConfigureOAuth(emailHubOAuthTestConfig())

	g, ok := svc.oauthProvider("google")
	if !ok {
		t.Fatal("google not registered")
	}
	if g.authKind != "oauth_google" || g.preset.Name != "gmail" || g.prompt != "consent" ||
		g.revokeURL != "https://oauth2.googleapis.com/revoke" ||
		g.config.ClientID != "hub-google-id" || g.config.ClientSecret != "hub-google-secret" ||
		g.config.RedirectURL != "https://api.example.com/api/v1/email-hub-connections/google/callback" ||
		g.config.Endpoint.AuthURL != "https://accounts.google.com/o/oauth2/v2/auth" ||
		g.config.Endpoint.TokenURL != "https://oauth2.googleapis.com/token" ||
		!slices.Equal(g.config.Scopes, []string{"openid", "email", "https://mail.google.com/"}) {
		t.Fatalf("google: %+v", g)
	}
	m, ok := svc.oauthProvider("microsoft")
	if !ok {
		t.Fatal("microsoft not registered")
	}
	if m.authKind != "oauth_microsoft" || m.preset.Name != "outlook" || m.prompt != "select_account" || m.revokeURL != "" ||
		m.config.ClientID != "hub-ms-id" || m.config.ClientSecret != "hub-ms-secret" ||
		m.config.RedirectURL != "https://api.example.com/api/v1/email-hub-connections/microsoft/callback" ||
		m.config.Endpoint.AuthURL != "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/authorize" ||
		m.config.Endpoint.TokenURL != "https://login.microsoftonline.com/contoso.example/oauth2/v2.0/token" ||
		!slices.Equal(m.config.Scopes, []string{"openid", "email", "offline_access",
			"https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"}) {
		t.Fatalf("microsoft: %+v", m)
	}
	if p, ok := svc.oauthByKind("oauth_microsoft"); !ok || p != m {
		t.Fatalf("oauthByKind(oauth_microsoft) = %+v ok=%v", p, ok)
	}
	if _, ok := svc.oauthByKind("password"); ok {
		t.Fatal("a password account has no OAuth provider")
	}
	if _, ok := svc.oauthProvider("yahoo"); ok {
		t.Fatal("only google and microsoft are OAuth providers")
	}
	hc, _ := svc.oauthCtx(context.Background()).Value(oauth2.HTTPClient).(*http.Client)
	if hc == nil || hc != svc.oauthHTTP || hc.Timeout != 15*time.Second {
		t.Fatalf("oauthCtx must carry the bounded client, got %+v", hc)
	}
}

// Membership answers before anything about the deployment's OAuth clients
// (spec §5.1: without the gate a stranger would read the flags).
func TestEmailHubProvidersRequiresMember(t *testing.T) {
	svc, _, _, ws, _ := emailHubFixture(t)
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	if _, err := svc.Providers(context.Background(), Human(util.NewID()), ws.ID); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member must get the membership answer, got %v", err)
	}
}

// A provider is offered only with its own id and secret and the credential
// box that seals its state and tokens (spec §5.6, Q9).
func TestEmailHubProvidersFlags(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	full := emailHubOAuthTestConfig()
	googleNoSecret := full
	googleNoSecret.EmailHubGoogleClientSecret = ""
	microsoftNoID := full
	microsoftNoID.EmailHubMicrosoftClientID = ""
	sharedOnly := full
	sharedOnly.EmailHubGoogleClientID, sharedOnly.EmailHubGoogleClientSecret = "", ""
	sharedOnly.EmailHubMicrosoftClientID, sharedOnly.EmailHubMicrosoftClientSecret = "", ""

	cases := []struct {
		name      string
		configure bool
		box       bool
		cfg       config.Config
		want      EmailHubProviders
	}{
		{"ConfigureOAuth never called", false, true, full, EmailHubProviders{}},
		{"no credential box", true, false, full, EmailHubProviders{}},
		{"google id without secret", true, true, googleNoSecret, EmailHubProviders{Microsoft: true}},
		{"microsoft secret without id", true, true, microsoftNoID, EmailHubProviders{Google: true}},
		{"login and calendar clients only", true, true, sharedOnly, EmailHubProviders{}},
		{"both", true, true, full, EmailHubProviders{Google: true, Microsoft: true}},
	}
	for _, tc := range cases {
		box := svc.box
		if !tc.box {
			box = nil
		}
		s := NewEmailHubService(q, svc.ws, box)
		if tc.configure {
			s.ConfigureOAuth(tc.cfg)
		}
		got, err := s.Providers(context.Background(), Human(user.ID), ws.ID)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %+v err=%v, want %+v", tc.name, got, err, tc.want)
		}
	}
}
```

Create `server/internal/handler/email_hub_oauth_test.go`:

```go
package handler

import (
	"net/http"
	"testing"
)

// The owner reads which sign-in buttons to show. Tests register no OAuth
// client, so both keys are present and false.
func TestEmailHubProvidersForTheOwner(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t)
	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/email-hub/providers", token, nil)
	google, gOK := out["google"].(bool)
	microsoft, mOK := out["microsoft"].(bool)
	if res.StatusCode != http.StatusOK || !gOK || !mOK || google || microsoft {
		t.Fatalf("providers: %d %v", res.StatusCode, out)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 ./internal/config/ ./internal/emailhub/ -run 'TestEmailHubRedirectURL|TestLoadEmailHubOAuthClients|TestPresetByName'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubConfigureOAuthUsesItsOwnClients|TestEmailHubProvidersRequiresMember|TestEmailHubProvidersFlags'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/ -run 'TestEmailHubProvidersForTheOwner'
```

Expected:
- config fails to build: `c.EmailHubRedirectURL undefined (type Config has no field or method EmailHubRedirectURL)`.
- emailhub fails to build: `undefined: Preset`.
- service fails to build: `unknown field EmailHubGoogleClientID in struct literal of type config.Config`.
- handler builds and fails with `providers: 404 ...`, because the route does not exist yet.

- [ ] **Step 3: Implement**

3a. In `server/internal/config/config.go`, add five fields right after `MicrosoftCalendarClientSecret string` (line 84). Keep ONE comment above the five; a comment line between fields would break gofmt's alignment run and reflow the SMTP fields below.

```go
	// Email Hub signs in with its own OAuth clients, never the login or
	// calendar ones (spec Q3); a provider is offered only with its id, its
	// secret and EMAIL_HUB_CREDENTIAL_KEY. The tenant is the Entra directory
	// Microsoft sign-in goes to: common takes personal and work accounts.
	EmailHubGoogleClientID        string
	EmailHubGoogleClientSecret    string
	EmailHubMicrosoftClientID     string
	EmailHubMicrosoftClientSecret string
	EmailHubMicrosoftTenant       string
```

After `CalendarRedirectURL` (lines 155-157), before `func Load()`:

```go
func (c Config) EmailHubRedirectURL(provider string) string {
	return strings.TrimRight(c.APIPublicURL, "/") + "/api/v1/email-hub-connections/" + provider + "/callback"
}
```

In `Load`, right after `MicrosoftCalendarClientSecret: os.Getenv("MICROSOFT_CALENDAR_CLIENT_SECRET"),` (line 204):

```go
		EmailHubGoogleClientID:        os.Getenv("EMAIL_HUB_GOOGLE_CLIENT_ID"),
		EmailHubGoogleClientSecret:    os.Getenv("EMAIL_HUB_GOOGLE_CLIENT_SECRET"),
		EmailHubMicrosoftClientID:     os.Getenv("EMAIL_HUB_MICROSOFT_CLIENT_ID"),
		EmailHubMicrosoftClientSecret: os.Getenv("EMAIL_HUB_MICROSOFT_CLIENT_SECRET"),
		EmailHubMicrosoftTenant:       getenv("EMAIL_HUB_MICROSOFT_TENANT", "common"),
```

3b. In `.env.example`, replace the Email Hub block body (lines 114-117) with:

```
# Base64-encoded 32-byte AES key for sealing mailbox passwords and OAuth tokens at rest.
# Generate: python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
# Empty disables connect (OAuth included); list/read still work for rows already synced.
EMAIL_HUB_CREDENTIAL_KEY=
# Sign in with Google / Microsoft. Email Hub's OWN OAuth clients: never reuse
# GOOGLE_CLIENT_ID or MICROSOFT_CALENDAR_*. A provider's button shows only when
# its id and secret are both set and EMAIL_HUB_CREDENTIAL_KEY is set.
# Google: OAuth client of type "Web application", scopes openid, email and
# https://mail.google.com/ (restricted: until verification + CASA the client
# stays in Testing mode, at most 100 test users, refresh tokens expire after 7 days).
# Register callback: API_PUBLIC_URL/api/v1/email-hub-connections/google/callback
EMAIL_HUB_GOOGLE_CLIENT_ID=
EMAIL_HUB_GOOGLE_CLIENT_SECRET=
# Microsoft Entra web app, "Accounts in any organizational directory and personal
# Microsoft accounts"; delegated Office 365 Exchange Online permissions
# IMAP.AccessAsUser.All and SMTP.Send.
# Register callback: API_PUBLIC_URL/api/v1/email-hub-connections/microsoft/callback
EMAIL_HUB_MICROSOFT_CLIENT_ID=
EMAIL_HUB_MICROSOFT_CLIENT_SECRET=
# Entra directory for sign-in. Default common (personal and work accounts).
EMAIL_HUB_MICROSOFT_TENANT=common
```

3c. In `server/internal/emailhub/provider.go`, insert above the `// ServerSavesSent` doc comment (line 58):

```go
// Preset returns the servers an OAuth sign-in names: "gmail" or "outlook",
// whatever the address's domain (Workspace and Microsoft 365 custom domains).
func Preset(name string) (Provider, bool) {
	switch name {
	case "gmail":
		return providers["gmail.com"], true
	case "outlook":
		return providers["outlook.com"], true
	}
	return Provider{}, false
}
```

3d. In `server/internal/service/email_hub.go`:
- Add `"net/http"` to the import block after `"log/slog"` (line 9).
- Insert after `Tasks *TaskService` (line 52):

```go
	// oauth holds the sign-in providers ConfigureOAuth enabled; oauthHTTP
	// bounds every token and revoke call. Tests point both at httptest servers.
	oauth     map[string]*emailHubOAuthProvider
	oauthHTTP *http.Client
```

Replace line 67 (`svc := &EmailHubService{q: q, ws: ws, box: box, log: slog.Default(), gov: newEmailHubGovernor()}`) with:

```go
	svc := &EmailHubService{
		q: q, ws: ws, box: box, log: slog.Default(), gov: newEmailHubGovernor(),
		oauthHTTP: &http.Client{Timeout: 15 * time.Second},
	}
```

3e. Create `server/internal/service/email_hub_oauth.go`:

```go
package service

import (
	"context"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

// emailHubOAuthProvider is one sign-in provider Email Hub's own OAuth client
// is registered with (spec Q3). The mailbox behind it is a preset server.
type emailHubOAuthProvider struct {
	name      string // the {provider} path segment: google | microsoft
	authKind  string // email_hub_accounts.auth_kind it stores
	preset    emailhub.Provider
	config    oauth2.Config
	revokeURL string // empty: the provider has no refresh-token revoke for apps
	prompt    string
}

// ConfigureOAuth registers each provider whose client id and secret are both
// set. Without the credential box nothing is offered: it seals the state and
// the tokens (spec §5.6). main calls it once, before serving.
func (s *EmailHubService) ConfigureOAuth(cfg config.Config) {
	if s.box == nil {
		return
	}
	gmail, _ := emailhub.Preset("gmail")
	outlook, _ := emailhub.Preset("outlook")
	microsoft := "https://login.microsoftonline.com/" + cfg.EmailHubMicrosoftTenant + "/oauth2/v2.0/"
	all := []*emailHubOAuthProvider{
		{
			name: "google", authKind: "oauth_google", preset: gmail, prompt: "consent",
			revokeURL: "https://oauth2.googleapis.com/revoke",
			config: oauth2.Config{
				ClientID: cfg.EmailHubGoogleClientID, ClientSecret: cfg.EmailHubGoogleClientSecret,
				Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"},
				Scopes:   []string{"openid", "email", "https://mail.google.com/"},
			},
		},
		{
			name: "microsoft", authKind: "oauth_microsoft", preset: outlook, prompt: "select_account",
			config: oauth2.Config{
				ClientID: cfg.EmailHubMicrosoftClientID, ClientSecret: cfg.EmailHubMicrosoftClientSecret,
				Endpoint: oauth2.Endpoint{AuthURL: microsoft + "authorize", TokenURL: microsoft + "token"},
				Scopes: []string{"openid", "email", "offline_access",
					"https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"},
			},
		},
	}
	s.oauth = map[string]*emailHubOAuthProvider{}
	for _, p := range all {
		if p.config.ClientID == "" || p.config.ClientSecret == "" {
			continue
		}
		p.config.RedirectURL = cfg.EmailHubRedirectURL(p.name)
		s.oauth[p.name] = p
	}
}

func (s *EmailHubService) oauthProvider(name string) (*emailHubOAuthProvider, bool) {
	p, ok := s.oauth[name]
	return p, ok
}

func (s *EmailHubService) oauthByKind(authKind string) (*emailHubOAuthProvider, bool) {
	for _, p := range s.oauth {
		if p.authKind == authKind {
			return p, true
		}
	}
	return nil, false
}

// oauthCtx carries the bounded client oauth2 uses for every token call.
func (s *EmailHubService) oauthCtx(ctx context.Context) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, s.oauthHTTP)
}

// EmailHubProviders says which sign-in buttons the connect dialog shows.
type EmailHubProviders struct{ Google, Microsoft bool }

// Providers answers membership first, so a stranger learns nothing about the
// deployment's OAuth clients (spec §5.1).
func (s *EmailHubService) Providers(ctx context.Context, actor Actor, workspaceID string) (EmailHubProviders, error) {
	if _, err := s.workspace(ctx, actor, workspaceID); err != nil {
		return EmailHubProviders{}, err
	}
	_, google := s.oauthProvider("google")
	_, microsoft := s.oauthProvider("microsoft")
	return EmailHubProviders{Google: google, Microsoft: microsoft}, nil
}
```

3f. In `server/internal/handler/dto/sdo/email_hub.go`, insert above `// EmailHubWatchSDO is POST .../email-hub/watch.` (line 22):

```go
// EmailHubProvidersSDO is GET .../email-hub/providers: the sign-in buttons the
// connect dialog shows.
type EmailHubProvidersSDO struct {
	Google    bool `json:"google" description:"Có thể kết nối bằng đăng nhập Google" example:"true"`
	Microsoft bool `json:"microsoft" description:"Có thể kết nối bằng đăng nhập Microsoft" example:"false"`
}
```

3g. In `server/internal/handler/router/email_hub.go`, add this line above `//	GET    /api/v1/workspaces/{workspaceID}/email-hub/accounts` (line 13) in the doc comment:

```go
//	GET    /api/v1/workspaces/{workspaceID}/email-hub/providers
```

Then insert before `r.With(connectLimit).Post("/workspaces/{workspaceID}/email-hub/accounts", ...` (line 46):

```go
	r.Get("/workspaces/{workspaceID}/email-hub/providers", h.GetEmailHubProviders, apiOp{
		summary:     "Sign-in providers for connecting a mailbox",
		description: "Nhà cung cấp nào có thể kết nối hộp thư bằng đăng nhập (OAuth). Một nhà cung cấp chỉ bật khi máy chủ có OAuth client riêng của Email Hub và khoá mã hoá thông tin đăng nhập.",
		tags:        []string{"email-hub"},
		sdo:         sdo.EmailHubProvidersSDO{},
		auth:        true,
	})
```

The tag comment (lines 10-11, "connected with a password") stays until OAuth connect exists (Tasks 5/6). The route has no new path parameter and no body.

3h. In `server/internal/handler/router/routes.go`, after `ConnectEmailHubAccount        http.HandlerFunc` (line 180):

```go
	GetEmailHubProviders          http.HandlerFunc
```

3i. In `server/internal/handler/router.go`, after `ConnectEmailHubAccount:        h.connectEmailHubAccount,` (line 282):

```go
		GetEmailHubProviders:          h.getEmailHubProviders,
```

3j. Create `server/internal/handler/email_hub_oauth.go`:

```go
package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) getEmailHubProviders(w http.ResponseWriter, r *http.Request) {
	p, err := h.EmailHub.Providers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.EmailHubProvidersSDO{Google: p.Google, Microsoft: p.Microsoft})
}
```

3k. In `server/cmd/server/main.go`, right after `emailHubSvc := service.NewEmailHubService(q, wsSvc, emailHubBox)` (line 492):

```go
	emailHubSvc.ConfigureOAuth(cfg)
```

Isolation: the route sits under `/workspaces/{workspaceID}` with no other parameter, so `TestIsolationMatrix` covers it with no table entry. B's owner gets the membership refusal; A's owner is the control and gets 200 `{google:false, microsoft:false}`, because the isolation world builds the service with a box but never calls `ConfigureOAuth`. No body field, so `isoReferences` does not change.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 ./internal/config/ ./internal/emailhub/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m -race ./internal/service/ -run 'TestEmailHubConfigureOAuthUsesItsOwnClients|TestEmailHubProvidersRequiresMember|TestEmailHubProvidersFlags|TestEmailHubConnect'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/handler/... -run 'TestEmailHubProvidersForTheOwner|TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase|TestSwagger|TestEveryRouteFieldIsBound|TestEmailHubConnectBudgetsEachSignedInUser'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal ./cmd && go build ./... && go vet ./internal/config/ ./internal/emailhub/ ./internal/service/ ./internal/handler/... ./cmd/server/ && go tool staticcheck ./internal/config/ ./internal/emailhub/ ./internal/service/ ./internal/handler/... ./cmd/server/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/env-example.test.mjs
```

Expected:
- Everything passes, and `gofmt -l` prints nothing. The handler run takes about 5 minutes because of the isolation matrix.
- staticcheck reports nothing; `oauthByKind` and `oauthCtx` get production callers in Task 3, and the test file uses them until then.
- Before 3b, `scripts/env-example.test.mjs` fails with `add these to .env.example: EMAIL_HUB_GOOGLE_CLIENT_ID, EMAIL_HUB_GOOGLE_CLIENT_SECRET, EMAIL_HUB_MICROSOFT_CLIENT_ID, EMAIL_HUB_MICROSOFT_CLIENT_SECRET`. Its regex only catches single-argument getenv calls, so the tenant is listed by hand.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add .env.example server/internal/config/config.go server/internal/config/config_test.go \
  server/internal/emailhub/provider.go server/internal/emailhub/provider_test.go \
  server/internal/service/email_hub.go server/internal/service/email_hub_oauth.go server/internal/service/email_hub_oauth_test.go \
  server/internal/handler/email_hub_oauth.go server/internal/handler/email_hub_oauth_test.go \
  server/internal/handler/dto/sdo/email_hub.go server/internal/handler/router/email_hub.go \
  server/internal/handler/router/routes.go server/internal/handler/router.go server/cmd/server/main.go
git commit -m "feat(email-hub): register Email Hub's own Google and Microsoft OAuth clients and say which are on" \
  -m "Email Hub signs in with its own OAuth clients (EMAIL_HUB_GOOGLE_*, EMAIL_HUB_MICROSOFT_*, tenant default common), never the login or calendar ones, because the Gmail scope is restricted and must not pull the login client into verification. A provider is registered only with its id, its secret and the credential box that will seal its state and tokens; a missing env hides it, with no feature flag. The registry pins the preset servers by name (emailhub.Preset), the scopes, the prompt, the Google revoke URL and a callback under /api/v1/email-hub-connections/{provider}/callback. Every token call will carry one 15s client through the oauth2 context. GET .../email-hub/providers answers membership first, so a stranger learns nothing about the deployment. The five variables and the two callbacks to register are in .env.example. Left out: start, callback, XOAUTH2, refresh, revoke and the client, which are later GD3 tasks." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: XOAUTH2 for IMAP and SMTP

**Files:**
- Create: `server/internal/emailhub/imapclient/xoauth2.go` (`xoauth2Client`, `authenticateXOAUTH2`)
- Modify: `server/internal/emailhub/imapclient/client.go`:
  - `Credentials` (lines 44-51) gains `AccessToken`
  - `dial` (lines 171-216): the `login(cl, user, c.Password)` call at line 210 picks XOAUTH2 when a token is set
  - `login` (lines 248-280): the status mapping moves into `finishLogin`, which LOGIN and AUTHENTICATE share
- Modify: `server/internal/emailhub/smtpclient/send.go`: `Credentials` (lines 13-22) gains `AccessToken`
- Modify: `server/internal/emailhub/smtpclient/session.go`: `authenticate` (lines 98-123) uses XOAUTH2 when a token is set, with no PLAIN/LOGIN fallback
- Modify: `server/internal/emailhub/smtpclient/auth.go`: append `xoauth2Auth` after `loginAuth` (lines 32-65)
- Test: `server/internal/emailhub/imapclient/fake_server_test.go`:
  - `fakeIMAP` struct (lines 68-76) gains `authNo`, `authUsers` and `challengeReplies`
  - the `serve` switch (lines 159-190) gains a case `AUTHENTICATE`
  - new helpers `authenticate`, `xoauth2Fields` and `xoauth2Seen` go before `record` (line 194)
- Test: `server/internal/emailhub/imapclient/xoauth2_test.go` (new)
- Test: `server/internal/emailhub/smtpclient/fake_server_test.go`:
  - `fakeSMTPLog` (lines 47-53) gains `mechs`, and `seen` (lines 107-115) copies it
  - the `AUTH` case (lines 166-195) records the mechanism and gains a case `XOAUTH2`
  - new helper `xoauth2Fields` goes before `readBase64Line`
- Test: `server/internal/emailhub/smtpclient/auth_test.go` (append six tests and add the `slices` and `strings` imports)

`server/go.mod` does not change. `xoauth2Client` satisfies `sasl.Client` structurally, and the assignment to `responses.Authenticate.Mechanism` (a `sasl.Client` field) is the compile-time check, so nothing imports `go-sasl` directly and `go mod tidy` keeps it `// indirect`. Step 4 proves `go.mod`/`go.sum` stay unchanged.

**Interfaces:**
- Consumes:
  - go-imap v1.2.1: `client.(*Client).Execute(cmdr imap.Commander, h responses.Handler) (*imap.StatusResp, error)` (applies `cl.Timeout`, writes a `responses.Replier`'s replies); `cl.Support("SASL-IR")`; `cl.SetState`, `cl.Capability`; `commands.Authenticate{Mechanism string; InitialResponse []byte}`; `responses.Authenticate{Mechanism sasl.Client; InitialResponse []byte; RepliesCh chan []byte}` (with `Info == ""` and `InitialResponse != nil` it sends `InitialResponse` after the empty `+`; otherwise it base64-decodes the challenge, calls `Mechanism.Next` and writes the reply).
  - `net/smtp`: `smtp.Auth` and `(*smtp.Client).Auth` (on 334 it calls `Next(msg, true)`; a nil reply ends the loop; a non-nil empty reply sends an empty line; a 5xx becomes a `*textproto.Error`).
  - GD1/GD2: `ErrAuthFailed`, `ErrLoginRefused` (imapclient); `ErrAuthFailed`, `ErrSMTPAuthDisabled`, `classifyAuthErr` (smtpclient); the `Username` fallback (empty means `Email`).
- Produces:
  - `imapclient.Credentials.AccessToken string`: when non-empty, `dial` authenticates with `AUTHENTICATE XOAUTH2` and ignores `Password`.
  - `type xoauth2Client struct{ user, token string }` with `Start()` returning `"XOAUTH2"` and `"user=<u>\x01auth=Bearer <t>\x01\x01"`, and `Next` returning an empty reply.
  - `func authenticateXOAUTH2(cl *client.Client, user, token string) error`: initial response inline with SASL-IR, after the empty `+` without.
  - `func finishLogin(cl *client.Client, status *imap.StatusResp, err error) error`: `NO [AUTHENTICATIONFAILED]` → `ErrAuthFailed`; bare `NO` → `ErrLoginRefused`; other codes → `status.Err()`; OK sets `AuthenticatedState` and refreshes CAPABILITY.
  - Both IMAP paths keep the `"imap login: %w"` wrap in `dial`.
  - `smtpclient.Credentials.AccessToken string`: when non-empty, `authenticate` runs `client.Auth(&xoauth2Auth{...})` once, error through `classifyAuthErr`.
  - `type xoauth2Auth struct{ username, token, host string }` (`smtp.Auth`): `Start` refuses `!server.TLS` and `server.Name != host`; `Next` returns `[]byte{}` when `more`, `nil` otherwise.
  - `Username` stays the login identity; MAIL FROM, From and Message-ID stay `Email`.
  - Test helpers: imapclient `fakeIMAP.authNo`, `(*fakeIMAP).xoauth2Seen() (users, replies []string)`; smtpclient `fakeSMTPLog.mechs`, `xoauth2SMTPCreds(f, security, token)`. Both fakes accept only the token `"good"`.

- [ ] **Step 1: Write the failing tests**

1a. In `server/internal/emailhub/imapclient/fake_server_test.go`, add `"encoding/base64"` to the imports after `"crypto/x509/pkix"`. Then replace the tail of the `fakeIMAP` struct:

```go
	reply    func(w *bufio.Writer, tag, cmd string) bool

	mu       sync.Mutex
	cmds     []string
	literals []string
}
```

with:

```go
	reply    func(w *bufio.Writer, tag, cmd string) bool
	// authNo is the tagged answer to an XOAUTH2 token other than "good";
	// empty means Gmail's NO [AUTHENTICATIONFAILED].
	authNo string

	mu               sync.Mutex
	cmds             []string
	literals         []string
	authUsers        []string // XOAUTH2 user= values, decoded
	challengeReplies []string // what the client answered the error challenge with
}
```

In `serve`, add this case right before `case "APPEND":`. It lives in the switch because the `reply` hook only gets the writer, and AUTHENTICATE must read a continuation line:

```go
		case "AUTHENTICATE":
			if !f.authenticate(r, w, tag, cmd) {
				return
			}
```

Add these helpers right before `func (f *fakeIMAP) record(cmd string) {`:

```go
// authenticate answers AUTHENTICATE XOAUTH2 like Gmail: the initial response
// inline (SASL-IR) or after an empty "+", OK for the token "good", otherwise a
// base64 JSON error challenge, the client's reply, then a tagged NO.
func (f *fakeIMAP) authenticate(r *bufio.Reader, w *bufio.Writer, tag, cmd string) bool {
	fields := strings.Fields(cmd)
	if len(fields) < 2 || !strings.EqualFold(fields[1], "XOAUTH2") {
		fmt.Fprintf(w, "%s NO unsupported mechanism\r\n", tag)
		return true
	}
	ir := ""
	if len(fields) > 2 {
		ir = fields[2]
	} else {
		fmt.Fprint(w, "+ \r\n")
		_ = w.Flush()
		line, err := r.ReadString('\n')
		if err != nil {
			return false
		}
		ir = strings.TrimRight(line, "\r\n")
	}
	raw, _ := base64.StdEncoding.DecodeString(ir)
	user, token := xoauth2Fields(string(raw))
	f.mu.Lock()
	f.authUsers = append(f.authUsers, user)
	f.mu.Unlock()
	if token == "good" {
		fmt.Fprintf(w, "%s OK authenticated\r\n", tag)
		return true
	}
	fmt.Fprintf(w, "+ %s\r\n", base64.StdEncoding.EncodeToString([]byte(`{"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}`)))
	_ = w.Flush()
	line, err := r.ReadString('\n')
	if err != nil {
		return false
	}
	f.mu.Lock()
	f.challengeReplies = append(f.challengeReplies, strings.TrimRight(line, "\r\n"))
	f.mu.Unlock()
	no := f.authNo
	if no == "" {
		no = "NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)"
	}
	fmt.Fprintf(w, "%s %s\r\n", tag, no)
	return true
}

// xoauth2Fields reads user and token from "user=U\x01auth=Bearer T\x01\x01".
func xoauth2Fields(s string) (user, token string) {
	for _, kv := range strings.Split(s, "\x01") {
		if v, ok := strings.CutPrefix(kv, "user="); ok {
			user = v
		}
		if v, ok := strings.CutPrefix(kv, "auth=Bearer "); ok {
			token = v
		}
	}
	return user, token
}

// xoauth2Seen returns the XOAUTH2 users and challenge replies, in order.
func (f *fakeIMAP) xoauth2Seen() (users, replies []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.authUsers...), append([]string(nil), f.challengeReplies...)
}
```

1b. Create `server/internal/emailhub/imapclient/xoauth2_test.go`:

```go
package imapclient

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/emersion/go-imap"
)

// xoauth2Creds points at f with an access token instead of a password.
func xoauth2Creds(t *testing.T, f *fakeIMAP, token string) Credentials {
	t.Helper()
	c := f.start(t)
	c.Password, c.AccessToken = "", token
	return c
}

// A token authenticates with AUTHENTICATE XOAUTH2, never LOGIN: inline when the
// server offers SASL-IR, after its empty continuation when it does not.
func TestXOAUTH2Succeeds(t *testing.T) {
	t.Parallel()
	for _, caps := range []string{"AUTH=XOAUTH2 SASL-IR", "AUTH=XOAUTH2"} {
		t.Run(caps, func(t *testing.T) {
			t.Parallel()
			f := &fakeIMAP{caps: caps}
			cl, err := dial(xoauth2Creds(t, f, "good"))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cl.Logout() }()
			if cl.State() != imap.AuthenticatedState {
				t.Fatalf("state = %v, want authenticated", cl.State())
			}
			if f.sent("LOGIN") {
				t.Fatalf("a token must never fall back to LOGIN: %q", f.commands())
			}
			inline := f.sent("AUTHENTICATE XOAUTH2 ")
			if want := strings.Contains(caps, "SASL-IR"); inline != want {
				t.Fatalf("initial response inline = %v, want %v: %q", inline, want, f.commands())
			}
			if users, _ := f.xoauth2Seen(); !slices.Equal(users, []string{"user@example.com"}) {
				t.Fatalf("XOAUTH2 user = %q, want the email when Username is empty", users)
			}
		})
	}
}

func TestXOAUTH2AuthenticationFailed(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	_, err := dial(xoauth2Creds(t, f, "expired"))
	if !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("want ErrAuthFailed, got %v", err)
	}
	if strings.Contains(err.Error(), "expired") {
		t.Fatalf("the error carries the token: %v", err)
	}
}

func TestXOAUTH2BareNO(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2", authNo: "NO AUTHENTICATE failed."}
	if _, err := dial(xoauth2Creds(t, f, "expired")); !errors.Is(err, ErrLoginRefused) {
		t.Fatalf("want ErrLoginRefused, got %v", err)
	}
}

// Gmail sends its error as a JSON challenge and waits for an empty line before
// the tagged NO; a "*" cancel would answer BAD and hide the code.
func TestXOAUTH2ErrorChallengeGetsEmptyReply(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	if _, err := dial(xoauth2Creds(t, f, "expired")); err == nil {
		t.Fatal("want an error")
	}
	if _, replies := f.xoauth2Seen(); !slices.Equal(replies, []string{""}) {
		t.Fatalf("challenge replies = %q, want one empty line", replies)
	}
}

func TestXOAUTH2UsesUsername(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{caps: "AUTH=XOAUTH2 SASL-IR"}
	c := xoauth2Creds(t, f, "good")
	c.Username = "login-name"
	cl, err := dial(c)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	if users, _ := f.xoauth2Seen(); !slices.Equal(users, []string{"login-name"}) {
		t.Fatalf("XOAUTH2 user = %q, want Username", users)
	}
}
```

1c. In `server/internal/emailhub/smtpclient/fake_server_test.go`, add the field to `fakeSMTPLog` after `authUsers []string`:

```go
	mechs     []string // AUTH mechanisms tried, upper case
```

In `seen()`, after the `out.authUsers = ...` line, add:

```go
	out.mechs = append([]string(nil), f.log.mechs...)
```

In `case "AUTH":`, right after `mech, initial, _ := strings.Cut(arg, " ")`, add:

```go
			f.record(func(l *fakeSMTPLog) { l.mechs = append(l.mechs, strings.ToUpper(mech)) })
```

In the inner `switch strings.ToUpper(mech)`, add this case before its `default:`. XOAUTH2 is accepted only when `authMechs` advertises it, because the default `"PLAIN LOGIN"` must refuse it for the no-fallback test:

```go
			case "XOAUTH2":
				if !strings.Contains(f.cfg.authMechs, "XOAUTH2") {
					reply("504 5.7.4 Unrecognized authentication type")
					continue
				}
				raw, _ := base64.StdEncoding.DecodeString(initial)
				var token string
				user, token = xoauth2Fields(string(raw))
				if token != "good" {
					// Gmail: a base64 JSON error challenge, an empty client reply, then 535.
					reply("334 " + base64.StdEncoding.EncodeToString([]byte(`{"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}`)))
					answer, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if strings.TrimSpace(answer) != "" {
						reply("501 5.5.2 expected an empty reply to the error challenge")
						continue
					}
					reply("535 5.7.8 Username and Password not accepted")
					continue
				}
```

Add this helper right before `func readBase64Line(`:

```go
// xoauth2Fields reads user and token from "user=U\x01auth=Bearer T\x01\x01".
func xoauth2Fields(s string) (user, token string) {
	for _, kv := range strings.Split(s, "\x01") {
		if v, ok := strings.CutPrefix(kv, "user="); ok {
			user = v
		}
		if v, ok := strings.CutPrefix(kv, "auth=Bearer "); ok {
			token = v
		}
	}
	return user, token
}
```

1d. In `server/internal/emailhub/smtpclient/auth_test.go`, change the imports to:

```go
import (
	"errors"
	"net/smtp"
	"slices"
	"strings"
	"testing"
)
```

and append:

```go
func TestXOAUTH2AuthRefusesPlaintextAndWrongHost(t *testing.T) {
	t.Parallel()
	auth := &xoauth2Auth{username: "u", token: "t", host: "smtp.example.com"}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: false}); err == nil {
		t.Fatal("expected unencrypted connection error")
	}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "evil.example.com", TLS: true}); err == nil {
		t.Fatal("expected wrong host error")
	}
	mech, ir, err := auth.Start(&smtp.ServerInfo{Name: "smtp.example.com", TLS: true})
	if err != nil || mech != "XOAUTH2" || string(ir) != "user=u\x01auth=Bearer t\x01\x01" {
		t.Fatalf("start: mech=%q ir=%q err=%v", mech, ir, err)
	}
}

// xoauth2SMTPCreds points at f with an access token instead of a password.
func xoauth2SMTPCreds(f *fakeSMTP, security, token string) Credentials {
	c := f.creds(security)
	c.Password, c.AccessToken = "", token
	return c
}

func TestXOAUTH2Auth(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		cfg      fakeSMTPConfig
		security string
	}{
		{"implicit tls", fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2 PLAIN LOGIN"}, "tls"},
		{"starttls", fakeSMTPConfig{startTLS: true, authMechs: "XOAUTH2 PLAIN LOGIN"}, "starttls"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := newFakeSMTP(t, tc.cfg)
			if err := VerifyLogin(xoauth2SMTPCreds(f, tc.security, "good")); err != nil {
				t.Fatalf("verify: %v", err)
			}
			got := f.seen()
			if !slices.Equal(got.mechs, []string{"XOAUTH2"}) || !slices.Equal(got.authUsers, []string{"user@example.com"}) {
				t.Fatalf("mechs=%q users=%q, want one XOAUTH2 as the email", got.mechs, got.authUsers)
			}
		})
	}
}

func TestXOAUTH2Refused535(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2"})
	err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "expired"))
	if !errors.Is(err, ErrAuthFailed) {
		t.Fatalf("want ErrAuthFailed, got %v", err)
	}
	if strings.Contains(err.Error(), "expired") {
		t.Fatalf("the error carries the token: %v", err)
	}
}

func TestXOAUTH2SMTPAuthDisabled(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{
		implicitTLS: true, authMechs: "XOAUTH2",
		authReply: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox.",
	})
	if err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "good")); !errors.Is(err, ErrSMTPAuthDisabled) {
		t.Fatalf("want ErrSMTPAuthDisabled, got %v", err)
	}
}

// Username only changes the login identity; the envelope, From and Message-ID
// stay on the mailbox address.
func TestXOAUTH2MailFromStaysEmail(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "XOAUTH2"})
	c := xoauth2SMTPCreds(f, "tls", "good")
	c.Username = "login-id"
	msgID, _, err := Send(testCtx(t), c, testMessage())
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if !slices.Equal(got.authUsers, []string{"login-id"}) || !slices.Equal(got.mailFrom, []string{"user@example.com"}) {
		t.Fatalf("users=%q mail from=%q", got.authUsers, got.mailFrom)
	}
	if !strings.Contains(got.data, "From: user@example.com\r\n") || !strings.HasSuffix(msgID, "@example.com>") {
		t.Fatalf("From or Message-ID left the email address: id=%q\n%s", msgID, got.data)
	}
}

// A server without XOAUTH2 refuses it; the client never retries with PLAIN or
// LOGIN, which would send an empty password.
func TestXOAUTH2NoPlainFallback(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true, authMechs: "PLAIN"})
	if err := VerifyLogin(xoauth2SMTPCreds(f, "tls", "good")); err == nil {
		t.Fatal("want an error from a server without XOAUTH2")
	}
	if got := f.seen(); !slices.Equal(got.mechs, []string{"XOAUTH2"}) || len(got.authUsers) != 0 {
		t.Fatalf("mechs=%q users=%q, want only the refused XOAUTH2", got.mechs, got.authUsers)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 ./internal/emailhub/imapclient/ ./internal/emailhub/smtpclient/ -run 'TestXOAUTH2'
```

Expected: both packages fail to build:
- imapclient: `c.AccessToken undefined (type Credentials has no field or method AccessToken)`
- smtpclient: `undefined: xoauth2Auth` and `c.AccessToken undefined (type Credentials has no field or method AccessToken)`
- Both end with `FAIL ... [build failed]`.

- [ ] **Step 3: Implement**

3a. In `server/internal/emailhub/imapclient/client.go`, extend `Credentials`. After `Security string // "tls" or "starttls"; empty means "tls"`, add:

```go
	// AccessToken is an OAuth access token; when set, AUTHENTICATE XOAUTH2
	// replaces LOGIN and Password is ignored.
	AccessToken string
```

In `dial`, replace:

```go
	if err := login(cl, user, c.Password); err != nil {
		_ = cl.Logout()
		return nil, fmt.Errorf("imap login: %w", err)
	}
```

with this (`err` is the variable declared by `conn, err := dialTCP(...)`):

```go
	if c.AccessToken != "" {
		err = authenticateXOAUTH2(cl, user, c.AccessToken)
	} else {
		err = login(cl, user, c.Password)
	}
	if err != nil {
		_ = cl.Logout()
		return nil, fmt.Errorf("imap login: %w", err)
	}
```

Split `login`. Keep its doc comment and replace the function with:

```go
func login(cl *client.Client, user, password string) error {
	status, err := cl.Execute(&commands.Login{Username: user, Password: password}, nil)
	return finishLogin(cl, status, err)
}

// finishLogin classifies a LOGIN or AUTHENTICATE status and, on OK, moves the
// client to the authenticated state.
func finishLogin(cl *client.Client, status *imap.StatusResp, err error) error {
	if err != nil {
		return err
	}
	if status.Type == imap.StatusRespNo {
		switch status.Code {
		case "AUTHENTICATIONFAILED":
			return fmt.Errorf("%w: %s", ErrAuthFailed, status.Info)
		case "":
			return fmt.Errorf("%w: %s", ErrLoginRefused, status.Info)
		}
	}
	if err := status.Err(); err != nil {
		return err
	}
	cl.SetState(imap.AuthenticatedState, nil)
	// Capabilities change at login; refresh them as client.Login would.
	_, err = cl.Capability()
	return err
}
```

3b. Create `server/internal/emailhub/imapclient/xoauth2.go`:

```go
package imapclient

import (
	"fmt"

	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
	"github.com/emersion/go-imap/responses"
)

// xoauth2Client is the SASL XOAUTH2 mechanism (sasl.Client) Gmail and Outlook
// accept for IMAP: the user and a bearer access token in one initial response.
type xoauth2Client struct{ user, token string }

func (a *xoauth2Client) Start() (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + a.user + "\x01auth=Bearer " + a.token + "\x01\x01"), nil
}

// Next answers the only challenge XOAUTH2 has, the server's base64 JSON error,
// with an empty reply; the server then ends the exchange with a tagged NO.
func (a *xoauth2Client) Next([]byte) ([]byte, error) { return []byte{}, nil }

// authenticateXOAUTH2 runs AUTHENTICATE by hand for the reason login runs LOGIN
// by hand: client.Authenticate drops the response code finishLogin classifies.
func authenticateXOAUTH2(cl *client.Client, user, token string) error {
	mech := &xoauth2Client{user: user, token: token}
	_, ir, _ := mech.Start()
	saslIR, err := cl.Support("SASL-IR")
	if err != nil {
		return fmt.Errorf("imap capability: %w", err)
	}
	cmd := &commands.Authenticate{Mechanism: "XOAUTH2"}
	res := &responses.Authenticate{Mechanism: mech, InitialResponse: ir, RepliesCh: make(chan []byte, 10)}
	if saslIR {
		// Sent inline with the command; otherwise after the server's empty "+".
		cmd.InitialResponse, res.InitialResponse = ir, nil
	}
	status, err := cl.Execute(cmd, res)
	return finishLogin(cl, status, err)
}
```

3c. In `server/internal/emailhub/smtpclient/send.go`, extend `Credentials`. After `Security string`, add:

```go
	// AccessToken is an OAuth access token; when set, AUTH XOAUTH2 replaces
	// PLAIN/LOGIN and Password is ignored.
	AccessToken string
```

3d. In `server/internal/emailhub/smtpclient/session.go`, inside `authenticate`, insert this between the `openSession` error check and `fallback, authErr := smtpAuthWithFallback(...)`:

```go
	if c.AccessToken != "" {
		// No PLAIN/LOGIN fallback: an OAuth account has no password to offer.
		if err := client.Auth(&xoauth2Auth{username: user, token: c.AccessToken, host: c.Host}); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: %w", classifyAuthErr(err))
		}
		return client, nil
	}
```

3e. Append to `server/internal/emailhub/smtpclient/auth.go`:

```go
// xoauth2Auth is SASL XOAUTH2, the bearer-token login Gmail and Outlook accept
// for SMTP submission.
type xoauth2Auth struct {
	username string
	token    string
	host     string
}

func (a *xoauth2Auth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("unencrypted connection")
	}
	if server.Name != a.host {
		return "", nil, fmt.Errorf("wrong host name: %q does not match expected %q", server.Name, a.host)
	}
	return "XOAUTH2", []byte("user=" + a.username + "\x01auth=Bearer " + a.token + "\x01\x01"), nil
}

// Next answers the error challenge (334 + base64 JSON) with an empty line so the
// server ends with its 535; a nil reply would stop net/smtp before reading it.
func (a *xoauth2Auth) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return []byte{}, nil
	}
	return nil, nil
}
```

- [ ] **Step 4: Run the tests, the two packages and the static checks**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 -race ./internal/emailhub/imapclient/ ./internal/emailhub/smtpclient/ -run 'TestXOAUTH2' -v 2>&1 | grep -E '^(--- |ok|FAIL)'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go test -count=1 -race ./internal/emailhub/...
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l internal/emailhub && go vet ./internal/emailhub/imapclient/ ./internal/emailhub/smtpclient/ && go tool staticcheck ./internal/emailhub/imapclient/ ./internal/emailhub/smtpclient/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && go build ./... && go mod tidy && git diff --exit-code go.mod go.sum
```

Expected:
- The first command prints `--- PASS` for: imapclient `TestXOAUTH2Succeeds` (both subtests), `TestXOAUTH2AuthenticationFailed`, `TestXOAUTH2BareNO`, `TestXOAUTH2ErrorChallengeGetsEmptyReply`, `TestXOAUTH2UsesUsername`; smtpclient `TestXOAUTH2AuthRefusesPlaintextAndWrongHost`, `TestXOAUTH2Auth` (both subtests), `TestXOAUTH2Refused535`, `TestXOAUTH2SMTPAuthDisabled`, `TestXOAUTH2MailFromStaysEmail`, `TestXOAUTH2NoPlainFallback`; then `ok` for both packages.
- The second prints `ok` for every emailhub package; the existing LOGIN, STARTTLS, Username and classifier tests stay green.
- `gofmt -l` prints nothing; vet and staticcheck are silent.
- `go build ./...` passes: the service's `Credentials` literals and `==` comparisons stay valid with one more string field.
- `git diff --exit-code go.mod go.sum` exits 0 (go-sasl stays `// indirect`).

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add server/internal/emailhub/imapclient/client.go server/internal/emailhub/imapclient/xoauth2.go \
  server/internal/emailhub/imapclient/xoauth2_test.go server/internal/emailhub/imapclient/fake_server_test.go \
  server/internal/emailhub/smtpclient/send.go server/internal/emailhub/smtpclient/session.go \
  server/internal/emailhub/smtpclient/auth.go server/internal/emailhub/smtpclient/auth_test.go \
  server/internal/emailhub/smtpclient/fake_server_test.go
git commit -m "feat(email-hub): authenticate IMAP and SMTP with an OAuth access token over XOAUTH2" \
  -m "Gmail/Workspace and Outlook/M365 accept a bearer token over SASL XOAUTH2 on the same IMAP/SMTP presets, so OAuth accounts keep the UID/folder sync model (spec Q1). Credentials gain AccessToken; when it is set, IMAP runs AUTHENTICATE XOAUTH2 through cl.Execute instead of LOGIN, so the tagged status code still tells AUTHENTICATIONFAILED (ErrAuthFailed) from a bare NO (ErrLoginRefused). LOGIN and AUTHENTICATE now share finishLogin. The initial response goes inline when the server offers SASL-IR, and after the empty continuation otherwise. The provider's JSON error challenge gets an empty reply, so the server answers its NO or 535 instead of a cancel. SMTP sends AUTH XOAUTH2 once, refuses plaintext or a host mismatch like LOGIN does, never falls back to PLAIN/LOGIN, and classifies 535/534 and M365's SmtpClientAuthentication-disabled reply as before. Username stays the login identity; MAIL FROM, From and Message-ID stay the address. Left out: where the token comes from (refresh and the credentials() branch are the next tasks), OAUTHBEARER, and a direct go-sasl import, since the mechanism satisfies sasl.Client structurally and go.mod does not change." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Token refresh: per-account mutex, conditional writes, invalid_grant → needs_reconnect

**Files:**
- Modify: `server/pkg/db/queries/email_hub.sql`. Add `UpdateEmailHubAccountOAuthTokens` right after `MarkEmailHubAccountAuthFailed` (lines 107-122).
- Regenerate: `server/pkg/db/generated/email_hub.sql.go` (`make sqlc`, never edited by hand)
- Modify: `server/internal/service/email_hub_folders.go`. Replace the doc comment and `credentials` (lines 35-56) and add `"strings"` to the imports.
- Create: `server/internal/service/email_hub_oauth_refresh.go`
- Modify: `server/internal/service/email_hub.go`. Add the `refreshLocks` field to `EmailHubService` (lines 42-64, after `hubWatch`) and `"sync"` to the imports.
- Modify: `server/internal/service/email_hub_connect.go`. Add two cases to `emailHubErrCode` (lines 252-265) and `"golang.org/x/oauth2"` to the imports.
- Test: `server/internal/service/email_hub_account_queries_test.go`. Append one test and add `time` and `github.com/jackc/pgx/v5/pgtype` to the imports.
- Test: `server/internal/service/email_hub_oauth_refresh_test.go` (new)

**Interfaces:**
- Consumes:
  - Task 1: `s.oauth` (keyed by provider name), `s.oauthHTTP`, `emailHubOAuthProvider{name, authKind, preset, config, revokeURL, prompt}`, `oauthByKind`, `oauthCtx`.
  - Task 2: `imapclient.Credentials.AccessToken`, `smtpclient.Credentials.AccessToken`.
  - GD1/GD2: `markAuthFailed(ctx, acc, version, reason) bool` (email_hub_watcher.go:269; own tx on WithoutCancel + 10s, audits `auth_failed`, emits `email_hub.inbox_changed`, calls `forceStop`, which only cancels and is safe under the refresh lock); `s.openPassword(enc)` (email_hub.go:712); `db.GetEmailHubAccountParams{ID, UserID, OrganizationID}` (filters `disconnected_at IS NULL`); `MarkEmailHubAccountAuthFailed` (already clears both token columns and the expiry); test helpers `emailHubFixture`, `seedEmailHubAccount`, `seedEmailHubAccountAddr`, `seedEmailHubThread`, `emailHubCount`, `emailHubInboxChangedFor`.
- Produces:
  - `UpdateEmailHubAccountOAuthTokens :execrows` and `db.UpdateEmailHubAccountOAuthTokensParams{AccessEnc string; ExpiresAt pgtype.Timestamptz; RefreshEnc string; ID string; OrganizationID string; CredentialVersion int64; PrevExpiresAt pgtype.Timestamptz}` (always written with named fields).
  - `EmailHubService.refreshLocks sync.Map` and `func (s *EmailHubService) refreshLock(accountID string) *sync.Mutex`.
  - `func (s *EmailHubService) oauthAccessToken(ctx context.Context, acc db.EmailHubAccount) (string, error)`
  - `func (s *EmailHubService) sealSecret(v string) (string, error)` (Tasks 5 and 7 reuse it).
  - `const emailHubAccessTokenSkew = 2 * time.Minute`
  - `var errEmailHubOAuthNotConfigured` (`emailHubErrCode` → `oauth_not_configured`) and `var errEmailHubOAuthRefreshFailed` (→ `oauth_refresh_failed`, as is a raw `*oauth2.RetrieveError`).
  - `auth_failed_reason` value `"oauth_invalid_grant"`.
  - `credentials()` on an `oauth_*` row: `IMAP/SMTP.AccessToken` set, `Password` `""`, `Version` the snapshot's `credential_version`.
  - Test helpers: `newEmailHubTokenServer(t, reply) *emailHubTokenServer` (`.url`, `.refreshes`), `useEmailHubTokenServer(svc, ts)`, `oauthEmailHubAccount(t, svc, pool, acc, authKind, expires)`, `openEmailHubSecret(t, svc, enc)`, `emailHubAccountRow(t, svc, id)`, `writeEmailHubToken`, `writeEmailHubTokenError`, `newEmailHubTokenGate(callers)`, `emailHubWithin[T](t, ch)`, `emailHubSoon()`.

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/service/email_hub_account_queries_test.go`, and add `"time"` and `"github.com/jackc/pgx/v5/pgtype"` to its imports:

```go
// A refresh writes only over the token it read (spec §2.3, §4.4): a stale
// version or expiry, a failed or a disconnected row takes nothing, NULL
// matches NULL, and an empty refresh_enc keeps the stored refresh token.
func TestUpdateEmailHubAccountOAuthTokensConditional(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, org)
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts
		SET auth_kind = 'oauth_google', password_enc = '', oauth_refresh_token_enc = 'refresh-old'
		WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	at := func(d time.Duration) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: time.Now().Add(d).UTC().Truncate(time.Microsecond), Valid: true}
	}
	var never pgtype.Timestamptz // NULL: no access token yet
	write := func(id string, version int64, prev pgtype.Timestamptz, access string, expires pgtype.Timestamptz, refresh string) int64 {
		t.Helper()
		n, err := q.UpdateEmailHubAccountOAuthTokens(ctx, db.UpdateEmailHubAccountOAuthTokensParams{
			ID: id, OrganizationID: org, CredentialVersion: version, PrevExpiresAt: prev,
			AccessEnc: access, ExpiresAt: expires, RefreshEnc: refresh,
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	read := func(id string) db.EmailHubAccount {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return row
	}

	first := at(time.Hour)
	if n := write(acc.ID, acc.CredentialVersion+1, never, "access-1", first, ""); n != 0 {
		t.Fatalf("a stale credential_version wrote %d rows", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, first, "access-1", first, ""); n != 0 {
		t.Fatalf("a prev expiry the row does not hold wrote %d rows", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, never, "access-1", first, ""); n != 1 {
		t.Fatalf("a NULL prev must match a NULL expiry, wrote %d rows", n)
	}
	row := read(acc.ID)
	if row.OauthAccessTokenEnc != "access-1" || !row.OauthAccessExpiresAt.Time.Equal(first.Time) ||
		row.OauthRefreshTokenEnc != "refresh-old" || row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("first write: access=%q expires=%v refresh=%q version=%d",
			row.OauthAccessTokenEnc, row.OauthAccessExpiresAt.Time, row.OauthRefreshTokenEnc, row.CredentialVersion)
	}

	second := at(2 * time.Hour)
	if n := write(acc.ID, acc.CredentialVersion, never, "access-2", second, ""); n != 0 {
		t.Fatalf("the NULL this pod read no longer holds, yet %d rows were written", n)
	}
	if n := write(acc.ID, acc.CredentialVersion, first, "access-2", second, "refresh-new"); n != 1 {
		t.Fatalf("a rotated refresh token over the read expiry wrote %d rows", n)
	}
	if row := read(acc.ID); row.OauthAccessTokenEnc != "access-2" || row.OauthRefreshTokenEnc != "refresh-new" ||
		row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("second write: access=%q refresh=%q version=%d", row.OauthAccessTokenEnc, row.OauthRefreshTokenEnc, row.CredentialVersion)
	}

	if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: org, CredentialVersion: acc.CredentialVersion, Reason: "oauth_invalid_grant",
	}); err != nil || n != 1 {
		t.Fatalf("mark auth failed: n=%d err=%v", n, err)
	}
	// Same version, and the expiry is NULL again: only auth_failed_at stops this write.
	if n := write(acc.ID, acc.CredentialVersion, never, "access-3", second, ""); n != 0 {
		t.Fatalf("an account that needs reconnect took a token: %d rows", n)
	}

	gone := seedEmailHubAccountAddr(t, q, svc.box, user.ID, org, "gone@gmail.com")
	if n, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: gone.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil || n != 1 {
		t.Fatalf("disconnect: n=%d err=%v", n, err)
	}
	// The current version and expiry: only disconnected_at stops this write.
	if n := write(gone.ID, read(gone.ID).CredentialVersion, never, "access-1", first, ""); n != 0 {
		t.Fatalf("a disconnected account took a token: %d rows", n)
	}
}
```

Create `server/internal/service/email_hub_oauth_refresh_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubTokenServer is a fake OAuth token endpoint; refreshes counts the
// refresh_token grants it answered.
type emailHubTokenServer struct {
	url       string
	refreshes atomic.Int32
}

// newEmailHubTokenServer answers each refresh grant with reply, given the
// refresh token the service sent. Anything else is a bare 400.
func newEmailHubTokenServer(t *testing.T, reply func(w http.ResponseWriter, r *http.Request, refreshToken string)) *emailHubTokenServer {
	t.Helper()
	ts := &emailHubTokenServer{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" || r.FormValue("grant_type") != "refresh_token" ||
			r.FormValue("client_id") != "eh-client" || r.FormValue("client_secret") != "eh-secret" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		ts.refreshes.Add(1)
		reply(w, r, r.FormValue("refresh_token"))
	}))
	t.Cleanup(srv.Close)
	ts.url = srv.URL
	return ts
}

// useEmailHubTokenServer points both providers of svc at ts. AuthStyleInParams
// keeps oauth2 from probing twice, so refreshes counts real refreshes.
func useEmailHubTokenServer(svc *EmailHubService, ts *emailHubTokenServer) {
	svc.oauthHTTP = &http.Client{Timeout: 5 * time.Second}
	svc.oauth = map[string]*emailHubOAuthProvider{}
	for name, kind := range map[string]string{"google": "oauth_google", "microsoft": "oauth_microsoft"} {
		svc.oauth[name] = &emailHubOAuthProvider{name: name, authKind: kind, config: oauth2.Config{
			ClientID: "eh-client", ClientSecret: "eh-secret",
			Endpoint: oauth2.Endpoint{TokenURL: ts.url + "/token", AuthStyle: oauth2.AuthStyleInParams},
		}}
	}
}

func writeEmailHubToken(w http.ResponseWriter, access, refresh string) {
	body := map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": 3600}
	if refresh != "" {
		body["refresh_token"] = refresh
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func writeEmailHubTokenError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code, "error_description": "Token has been expired or revoked."})
}

// emailHubTokenGate holds token requests until release; arrived tells the
// test a request is in. Tests `defer gate.release()`: defers run before
// t.Cleanup, so srv.Close never waits on a held request.
type emailHubTokenGate struct {
	arrived chan struct{}
	open    chan struct{}
	release func()
}

func newEmailHubTokenGate(callers int) *emailHubTokenGate {
	g := &emailHubTokenGate{arrived: make(chan struct{}, callers), open: make(chan struct{})}
	g.release = sync.OnceFunc(func() { close(g.open) })
	return g
}

func (g *emailHubTokenGate) hold(r *http.Request) bool {
	select {
	case g.arrived <- struct{}{}:
	default:
	}
	select {
	case <-g.open:
		return true
	case <-r.Context().Done():
		return false
	}
}

// emailHubWithin receives from ch, failing the test after 10s instead of hanging it.
func emailHubWithin[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting on the token endpoint or a refresh")
	}
	var zero T
	return zero
}

// emailHubSoon is an access-token expiry inside the refresh skew.
func emailHubSoon() time.Time { return time.Now().Add(time.Minute) }

// oauthEmailHubAccount turns a seeded password mailbox into one that signs in
// with authKind. It holds refresh token "refresh-1" and access token
// "access-old", which expires at expires, both sealed as the callback stores them.
func oauthEmailHubAccount(t *testing.T, svc *EmailHubService, pool *pgxpool.Pool, acc db.EmailHubAccount, authKind string, expires time.Time) db.EmailHubAccount {
	t.Helper()
	refreshEnc, err := svc.sealSecret("refresh-1")
	if err != nil {
		t.Fatal(err)
	}
	accessEnc, err := svc.sealSecret("access-old")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE email_hub_accounts
		SET auth_kind = $2, password_enc = '', oauth_refresh_token_enc = $3,
		    oauth_access_token_enc = $4, oauth_access_expires_at = $5
		WHERE id = $1`, acc.ID, authKind, refreshEnc, accessEnc, expires); err != nil {
		t.Fatal(err)
	}
	return emailHubAccountRow(t, svc, acc.ID)
}

func emailHubAccountRow(t *testing.T, svc *EmailHubService, id string) db.EmailHubAccount {
	t.Helper()
	row, err := svc.q.GetEmailHubAccountByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// openEmailHubSecret opens a sealed column; "" stays "".
func openEmailHubSecret(t *testing.T, svc *EmailHubService, enc string) string {
	t.Helper()
	if enc == "" {
		return ""
	}
	v, err := svc.openPassword(enc)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// A token inside the skew is refreshed and stored without a version bump; the
// sessions carry it instead of a password, and the next caller, even one
// holding the old snapshot, uses the stored token without a refresh (spec §4.4).
func TestEmailHubOAuthRefreshNearExpiry(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	sent := make(chan string, 4)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, refresh string) {
		sent <- refresh
		writeEmailHubToken(w, "access-new", "")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	creds, err := svc.credentials(ctx, acc)
	if err != nil {
		t.Fatal(err)
	}
	if creds.IMAP.AccessToken != "access-new" || creds.SMTP.AccessToken != "access-new" ||
		creds.IMAP.Password != "" || creds.SMTP.Password != "" {
		t.Fatalf("creds: imap token=%q password=%q, smtp token=%q password=%q",
			creds.IMAP.AccessToken, creds.IMAP.Password, creds.SMTP.AccessToken, creds.SMTP.Password)
	}
	if creds.Version != acc.CredentialVersion || creds.IMAP.Host != acc.ImapHost || creds.SMTP.Email != acc.EmailAddress {
		t.Fatalf("creds do not mirror the row: %+v", creds)
	}
	if got := emailHubWithin(t, sent); got != "refresh-1" {
		t.Fatalf("refresh sent %q, want the stored refresh-1", got)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if openEmailHubSecret(t, svc, row.OauthAccessTokenEnc) != "access-new" ||
		openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-1" || row.CredentialVersion != acc.CredentialVersion {
		t.Fatalf("stored row: version=%d", row.CredentialVersion)
	}
	if !row.OauthAccessExpiresAt.Valid || time.Until(row.OauthAccessExpiresAt.Time) < 50*time.Minute {
		t.Fatalf("stored expiry %v, want about an hour out", row.OauthAccessExpiresAt.Time)
	}
	for name, snapshot := range map[string]db.EmailHubAccount{"fresh row": row, "stale snapshot": acc} {
		again, err := svc.credentials(ctx, snapshot)
		if err != nil || again.IMAP.AccessToken != "access-new" {
			t.Fatalf("%s: token=%q err=%v", name, again.IMAP.AccessToken, err)
		}
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("token endpoint hit %d times, want once", n)
	}
}

// Microsoft returns a new refresh token with each refresh; it is stored and
// sent on the next refresh.
func TestEmailHubOAuthRefreshStoresRotatedRefreshToken(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	sent := make(chan string, 4)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, refresh string) {
		sent <- refresh
		writeEmailHubToken(w, "access-new", "refresh-2")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_microsoft", emailHubSoon())

	if creds, err := svc.credentials(ctx, acc); err != nil || creds.IMAP.AccessToken != "access-new" {
		t.Fatalf("token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	if got := emailHubWithin(t, sent); got != "refresh-1" {
		t.Fatalf("first refresh sent %q", got)
	}
	if got := openEmailHubSecret(t, svc, emailHubAccountRow(t, svc, acc.ID).OauthRefreshTokenEnc); got != "refresh-2" {
		t.Fatalf("stored refresh token %q, want the rotated refresh-2", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts SET oauth_access_expires_at = now() WHERE id = $1`, acc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.credentials(ctx, acc); err != nil {
		t.Fatal(err)
	}
	if got := emailHubWithin(t, sent); got != "refresh-2" {
		t.Fatalf("second refresh sent %q, want the rotated refresh-2", got)
	}
}

// However many callers on one process find the token expired, the token
// endpoint is hit once: the rest wait on the account's lock or arrive after
// the write, and re-read the stored token.
func TestEmailHubOAuthRefreshOneCallPerProcess(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	gate := newEmailHubTokenGate(1)
	defer gate.release()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if gate.hold(r) {
			writeEmailHubToken(w, "access-new", "")
		}
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	const callers = 8
	type result struct {
		token string
		err   error
	}
	results := make(chan result, callers)
	run := func() {
		creds, err := svc.credentials(ctx, acc)
		results <- result{creds.IMAP.AccessToken, err}
	}
	go run()
	emailHubWithin(t, gate.arrived) // the first caller holds the lock at the token endpoint
	for range callers - 1 {
		go run()
	}
	gate.release()
	for range callers {
		if r := emailHubWithin(t, results); r.err != nil || r.token != "access-new" {
			t.Fatalf("caller got token=%q err=%v", r.token, r.err)
		}
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("%d callers refreshed %d times, want once", callers, n)
	}
}

// Two pods (two services, one database) refresh the same expired token at
// once. Exactly one write lands; the loser drops its token, uses the winner's,
// and the account never moves to needs_reconnect (spec §10, rolling update).
func TestEmailHubOAuthRefreshTwoServicesOneWriter(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	other := NewEmailHubService(q, svc.ws, svc.box) // its own refresh locks, the same rows
	gate := newEmailHubTokenGate(2)
	defer gate.release()
	var issued atomic.Int32
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		n := issued.Add(1)
		if gate.hold(r) {
			writeEmailHubToken(w, fmt.Sprintf("access-%d", n), "")
		}
	})
	useEmailHubTokenServer(svc, ts)
	useEmailHubTokenServer(other, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	type result struct {
		token string
		err   error
	}
	results := make(chan result, 2)
	for _, pod := range []*EmailHubService{svc, other} {
		go func() {
			creds, err := pod.credentials(ctx, acc)
			results <- result{creds.IMAP.AccessToken, err}
		}()
	}
	emailHubWithin(t, gate.arrived)
	emailHubWithin(t, gate.arrived) // both pods read the same expired row and are out refreshing
	gate.release()
	a, b := emailHubWithin(t, results), emailHubWithin(t, results)
	if a.err != nil || b.err != nil {
		t.Fatalf("refresh errors: %v, %v", a.err, b.err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	stored := openEmailHubSecret(t, svc, row.OauthAccessTokenEnc)
	if a.token != stored || b.token != stored {
		t.Fatalf("both pods must use the one stored token %q, got %q and %q", stored, a.token, b.token)
	}
	if row.AuthFailedAt.Valid || row.CredentialVersion != acc.CredentialVersion ||
		openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-1" {
		t.Fatalf("row after the race: auth_failed=%v version=%d", row.AuthFailedAt.Valid, row.CredentialVersion)
	}
	if n := ts.refreshes.Load(); n != 2 {
		t.Fatalf("token endpoint hit %d times, want one per pod", n)
	}
}

// A refused grant moves the account to needs_reconnect. The credential goes,
// the cached mail stays, and the system audit and inbox_changed are written once
// (spec §3, §4.4).
func TestEmailHubOAuthInvalidGrantMarksNeedsReconnect(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var code atomic.Value
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		writeEmailHubTokenError(w, http.StatusBadRequest, code.Load().(string))
	})
	useEmailHubTokenServer(svc, ts)

	for _, c := range []struct{ code, email string }{
		{"invalid_grant", "seed@gmail.com"},
		{"unauthorized_client", "second@gmail.com"},
	} {
		code.Store(c.code)
		acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, c.email), "oauth_google", emailHubSoon())
		seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
		before := ts.refreshes.Load()

		if _, err := svc.credentials(ctx, acc); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Fatalf("%s: expected ErrEmailHubReauthRequired, got %v", c.code, err)
		}
		row := emailHubAccountRow(t, svc, acc.ID)
		if !row.AuthFailedAt.Valid || row.AuthFailedReason != "oauth_invalid_grant" || row.DisconnectedAt.Valid ||
			row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid {
			t.Fatalf("%s: row auth_failed=%v reason=%q disconnected=%v refresh_cleared=%v access_cleared=%v expires=%v", c.code,
				row.AuthFailedAt.Valid, row.AuthFailedReason, row.DisconnectedAt.Valid,
				row.OauthRefreshTokenEnc == "", row.OauthAccessTokenEnc == "", row.OauthAccessExpiresAt.Valid)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
			t.Fatalf("%s: cached mail must survive, %d threads left", c.code, n)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
			WHERE action = $1 AND resource_id = $2 AND actor_kind = 'system' AND metadata::jsonb->>'reason' = 'oauth_invalid_grant'`,
			audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 1 {
			t.Fatalf("%s: expected one system auth_failed audit row, got %d", c.code, n)
		}
		if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
			t.Fatalf("%s: expected one inbox_changed event, got %d", c.code, n)
		}
		// The marked row answers before any refresh.
		if _, err := svc.credentials(ctx, row); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Fatalf("%s: a marked account must answer reauth, got %v", c.code, err)
		}
		if n := ts.refreshes.Load() - before; n != 1 {
			t.Fatalf("%s: token endpoint hit %d times, want once", c.code, n)
		}
	}
}

// Another pod rotated the grant while this one was out, so this pod's refresh
// is refused. The re-read row holds the other pod's token, which is used, and
// the account stays active.
func TestEmailHubOAuthInvalidGrantAfterOtherPodRefreshedStaysActive(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_microsoft", emailHubSoon())
	otherAccess, err := svc.sealSecret("access-other")
	if err != nil {
		t.Fatal(err)
	}
	otherRefresh, err := svc.sealSecret("refresh-rotated")
	if err != nil {
		t.Fatal(err)
	}
	otherDone := make(chan error, 1)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		n, err := svc.q.UpdateEmailHubAccountOAuthTokens(context.Background(), db.UpdateEmailHubAccountOAuthTokensParams{
			ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion,
			PrevExpiresAt: acc.OauthAccessExpiresAt, AccessEnc: otherAccess,
			ExpiresAt:  pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
			RefreshEnc: otherRefresh,
		})
		if err == nil && n != 1 {
			err = fmt.Errorf("the other pod wrote %d rows", n)
		}
		otherDone <- err
		writeEmailHubTokenError(w, http.StatusBadRequest, "invalid_grant")
	})
	useEmailHubTokenServer(svc, ts)

	creds, err := svc.credentials(ctx, acc)
	if werr := emailHubWithin(t, otherDone); werr != nil {
		t.Fatal(werr)
	}
	if err != nil || creds.IMAP.AccessToken != "access-other" {
		t.Fatalf("want the other pod's token, got token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if row.AuthFailedAt.Valid || openEmailHubSecret(t, svc, row.OauthRefreshTokenEnc) != "refresh-rotated" {
		t.Fatalf("row: auth_failed=%v reason=%q", row.AuthFailedAt.Valid, row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a grant another pod rotated is no auth failure, got %d audit rows", n)
	}
}

// A reconnect landed while this refresh was out (spec §8: invalid_grant from
// the old token after an OAuth reconnect): the bumped credential_version means
// the refusal is about a grant the row no longer holds, so the reconnected
// token is used and the account stays active.
func TestEmailHubOAuthInvalidGrantAfterReconnectStaysActive(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())
	reconnected, err := svc.sealSecret("access-reconnected")
	if err != nil {
		t.Fatal(err)
	}
	bumped := make(chan error, 1)
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		_, err := pool.Exec(context.Background(), `UPDATE email_hub_accounts
			SET credential_version = credential_version + 1, oauth_access_token_enc = $2,
			    oauth_access_expires_at = now() + interval '1 hour'
			WHERE id = $1`, acc.ID, reconnected)
		bumped <- err
		writeEmailHubTokenError(w, http.StatusBadRequest, "invalid_grant")
	})
	useEmailHubTokenServer(svc, ts)

	creds, err := svc.credentials(ctx, acc)
	if berr := emailHubWithin(t, bumped); berr != nil {
		t.Fatal(berr)
	}
	if err != nil || creds.IMAP.AccessToken != "access-reconnected" {
		t.Fatalf("want the reconnected token, got token=%q err=%v", creds.IMAP.AccessToken, err)
	}
	if row := emailHubAccountRow(t, svc, acc.ID); row.AuthFailedAt.Valid {
		t.Fatalf("a refusal of the replaced grant marked the account: reason=%q", row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a refusal of the replaced grant is no auth failure, got %d audit rows", n)
	}
}

// A disconnect that lands while a refresh is out wins: the late token is
// dropped, the row stays disconnected with no credential, and the caller is
// told to reconnect.
func TestEmailHubOAuthRefreshRacingDisconnect(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	gate := newEmailHubTokenGate(1)
	defer gate.release()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, r *http.Request, _ string) {
		if gate.hold(r) {
			writeEmailHubToken(w, "access-late", "refresh-late")
		}
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())

	errc := make(chan error, 1)
	go func() {
		_, err := svc.credentials(ctx, acc)
		errc <- err
	}()
	emailHubWithin(t, gate.arrived)
	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	gate.release()
	if err := emailHubWithin(t, errc); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("a refresh that lost to a disconnect: got %v, want ErrEmailHubReauthRequired", err)
	}
	row := emailHubAccountRow(t, svc, acc.ID)
	if !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid {
		t.Fatalf("disconnected row: disconnected=%v refresh_cleared=%v access_cleared=%v expires=%v",
			row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc == "", row.OauthAccessTokenEnc == "", row.OauthAccessExpiresAt.Valid)
	}
}

// A 5xx from the token endpoint, or a provider whose env was removed, is
// transient. It changes nothing, and the error carries a code, never the
// provider's text.
func TestEmailHubOAuthTransientRefreshKeepsState(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	ts := newEmailHubTokenServer(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
		writeEmailHubTokenError(w, http.StatusServiceUnavailable, "temporarily_unavailable")
	})
	useEmailHubTokenServer(svc, ts)
	acc := oauthEmailHubAccount(t, svc, pool, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), "oauth_google", emailHubSoon())
	unchanged := func(step string) {
		t.Helper()
		row := emailHubAccountRow(t, svc, acc.ID)
		if row.AuthFailedAt.Valid || row.CredentialVersion != acc.CredentialVersion ||
			row.OauthRefreshTokenEnc != acc.OauthRefreshTokenEnc || row.OauthAccessTokenEnc != acc.OauthAccessTokenEnc ||
			!row.OauthAccessExpiresAt.Time.Equal(acc.OauthAccessExpiresAt.Time) {
			t.Fatalf("%s changed the row: auth_failed=%v version=%d", step, row.AuthFailedAt.Valid, row.CredentialVersion)
		}
	}

	_, err := svc.credentials(ctx, acc)
	if err == nil || errors.Is(err, ErrEmailHubReauthRequired) || emailHubErrCode(err) != "oauth_refresh_failed" {
		t.Fatalf("5xx: err=%v code=%q", err, emailHubErrCode(err))
	}
	if strings.Contains(err.Error(), "expired or revoked") || strings.Contains(err.Error(), "temporarily_unavailable") {
		t.Fatal("the provider's reply must not leave the refresh")
	}
	unchanged("a 5xx")

	svc.oauth = nil // EMAIL_HUB_GOOGLE_* removed
	_, err = svc.credentials(ctx, acc)
	if !errors.Is(err, errEmailHubOAuthNotConfigured) || emailHubErrCode(err) != "oauth_not_configured" {
		t.Fatalf("no provider: err=%v code=%q", err, emailHubErrCode(err))
	}
	if n := ts.refreshes.Load(); n != 1 {
		t.Fatalf("an unconfigured provider must not reach the token endpoint, hit %d times", n)
	}
	unchanged("a missing provider")

	if code := emailHubErrCode(&oauth2.RetrieveError{ErrorCode: "invalid_request"}); code != "oauth_refresh_failed" {
		t.Fatalf("a raw oauth2 error must log as oauth_refresh_failed, got %q", code)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestUpdateEmailHubAccountOAuthTokensConditional|TestEmailHubOAuth'
```

Expected: the build fails with errors like `undefined: db.UpdateEmailHubAccountOAuthTokensParams`, `q.UpdateEmailHubAccountOAuthTokens undefined`, `svc.sealSecret undefined`, `undefined: errEmailHubOAuthNotConfigured`.

- [ ] **Step 3: Implement**

3a. In `server/pkg/db/queries/email_hub.sql`, add this right after `MarkEmailHubAccountAuthFailed`:

```sql
-- name: UpdateEmailHubAccountOAuthTokens :execrows
-- A refresh writes only over the token it read. Another pod's refresh moved
-- oauth_access_expires_at, a reconnect bumped credential_version, and a
-- disconnect or auth failure closed the row. A refresh never bumps the
-- version. An empty refresh_enc keeps the stored refresh token (only
-- Microsoft rotates it).
UPDATE email_hub_accounts
SET oauth_access_token_enc = sqlc.arg('access_enc'),
    oauth_access_expires_at = sqlc.narg('expires_at'),
    oauth_refresh_token_enc = COALESCE(NULLIF(sqlc.arg('refresh_enc')::text, ''), oauth_refresh_token_enc),
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND credential_version = sqlc.arg('credential_version')
  AND oauth_access_expires_at IS NOT DISTINCT FROM sqlc.narg('prev_expires_at')::timestamptz
  AND disconnected_at IS NULL
  AND auth_failed_at IS NULL;
```

Then regenerate:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && make sqlc
```

`server/pkg/db/generated/email_hub.sql.go` gains `func (q *Queries) UpdateEmailHubAccountOAuthTokens(ctx context.Context, arg UpdateEmailHubAccountOAuthTokensParams) (int64, error)` with the params fields listed under Interfaces. No other generated function changes.

3b. Create `server/internal/service/email_hub_oauth_refresh.go`:

```go
package service

import (
	"context"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubAccessTokenSkew: an access token closer than this to its expiry is
// refreshed first, so no IMAP or SMTP session starts on one about to lapse.
const emailHubAccessTokenSkew = 2 * time.Minute

var (
	// errEmailHubOAuthNotConfigured: the account signs in with a provider whose
	// EMAIL_HUB_* client is no longer set. Transient: restoring the env brings
	// the account back without a reconnect.
	errEmailHubOAuthNotConfigured = errors.New("email hub oauth provider not configured")
	// errEmailHubOAuthRefreshFailed stands for every refresh failure but a
	// refused grant. oauth2 folds the provider's reply into its error text, so
	// that text never leaves this file.
	errEmailHubOAuthRefreshFailed = errors.New("email hub oauth refresh failed")
)

// refreshLock keeps one process from refreshing the same grant twice; two
// pods are fenced by the conditional write instead.
func (s *EmailHubService) refreshLock(accountID string) *sync.Mutex {
	// shortcut: one mutex per account ever refreshed here, never freed; bounded by the account count, prune if that grows large.
	m, _ := s.refreshLocks.LoadOrStore(accountID, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// sealSecret seals v the way password_enc and the oauth_* columns hold it.
func (s *EmailHubService) sealSecret(v string) (string, error) {
	sealed, err := s.box.Seal([]byte(v))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// oauthAccessToken returns a usable access token for an oauth_* account. It
// refreshes the token when it is within the skew of expiry (spec §4.4).
func (s *EmailHubService) oauthAccessToken(ctx context.Context, acc db.EmailHubAccount) (string, error) {
	if token, ok, err := s.freshAccessToken(acc); ok || err != nil {
		return token, err
	}
	p, ok := s.oauthByKind(acc.AuthKind)
	if !ok {
		return "", errEmailHubOAuthNotConfigured
	}
	mu := s.refreshLock(acc.ID)
	mu.Lock()
	defer mu.Unlock()
	// The caller's snapshot may be old (the watcher keeps one); the row decides.
	read, err := s.rereadEmailHubAccount(ctx, acc)
	if err != nil {
		return "", err
	}
	if token, ok, err := s.freshAccessToken(read); ok || err != nil {
		return token, err // another caller on this process refreshed while this one waited
	}
	refresh, err := s.openPassword(read.OauthRefreshTokenEnc)
	if err != nil {
		return "", err
	}
	tok, err := p.config.TokenSource(s.oauthCtx(ctx), &oauth2.Token{RefreshToken: refresh}).Token()
	if err != nil {
		return s.oauthRefreshFailed(ctx, read, err)
	}
	accessEnc, err := s.sealSecret(tok.AccessToken)
	if err != nil {
		return "", err
	}
	var refreshEnc string // empty keeps the stored one
	if tok.RefreshToken != refresh { // Microsoft rotates; oauth2 echoes the old one when none comes back
		if refreshEnc, err = s.sealSecret(tok.RefreshToken); err != nil {
			return "", err
		}
	}
	n, err := s.q.UpdateEmailHubAccountOAuthTokens(ctx, db.UpdateEmailHubAccountOAuthTokensParams{
		ID: read.ID, OrganizationID: read.OrganizationID,
		CredentialVersion: read.CredentialVersion, PrevExpiresAt: read.OauthAccessExpiresAt,
		AccessEnc: accessEnc, ExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()},
		RefreshEnc: refreshEnc,
	})
	if err != nil {
		return "", err
	}
	if n == 0 {
		// Another pod refreshed first, or a reconnect, disconnect or auth failure
		// replaced the row. The token just received is dropped, not revoked:
		// revoking a Google access token also revokes the grant the winner holds.
		return s.currentAccessToken(ctx, read)
	}
	return tok.AccessToken, nil
}

// oauthRefreshFailed sorts a failed refresh. A refused grant marks the account
// only when the row still holds what this refresh read. If another pod wrote
// a token since (Microsoft may have rotated the grant this one sent), or a
// reconnect replaced the credential, that token is used instead. Anything else
// is transient and changes nothing.
func (s *EmailHubService) oauthRefreshFailed(ctx context.Context, read db.EmailHubAccount, err error) (string, error) {
	var re *oauth2.RetrieveError
	if !errors.As(err, &re) || (re.ErrorCode != "invalid_grant" && re.ErrorCode != "unauthorized_client") {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", errEmailHubOAuthRefreshFailed
	}
	current, err := s.rereadEmailHubAccount(ctx, read)
	if err != nil {
		return "", err
	}
	if current.CredentialVersion != read.CredentialVersion || current.OauthRefreshTokenEnc != read.OauthRefreshTokenEnc ||
		!sameEmailHubExpiry(current.OauthAccessExpiresAt, read.OauthAccessExpiresAt) {
		return s.accessTokenOf(current)
	}
	s.markAuthFailed(ctx, read, read.CredentialVersion, "oauth_invalid_grant")
	return "", ErrEmailHubReauthRequired
}

// currentAccessToken answers with the token the row holds now, written by
// another pod's refresh or by a reconnect.
func (s *EmailHubService) currentAccessToken(ctx context.Context, acc db.EmailHubAccount) (string, error) {
	row, err := s.rereadEmailHubAccount(ctx, acc)
	if err != nil {
		return "", err
	}
	return s.accessTokenOf(row)
}

// accessTokenOf is row's fresh access token. Without one, the credential the
// caller held is gone (for example, reconnected with a password).
func (s *EmailHubService) accessTokenOf(row db.EmailHubAccount) (string, error) {
	token, ok, err := s.freshAccessToken(row)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrEmailHubReauthRequired
	}
	return token, nil
}

// freshAccessToken opens acc's access token when it outlives the skew. ok is
// false when the token is missing or about to lapse.
func (s *EmailHubService) freshAccessToken(acc db.EmailHubAccount) (token string, ok bool, err error) {
	exp := acc.OauthAccessExpiresAt
	if acc.OauthAccessTokenEnc == "" || !exp.Valid || time.Until(exp.Time) <= emailHubAccessTokenSkew {
		return "", false, nil
	}
	token, err = s.openPassword(acc.OauthAccessTokenEnc)
	return token, err == nil, err
}

// rereadEmailHubAccount is the row as it is now. A disconnected or failed row
// answers ErrEmailHubReauthRequired.
func (s *EmailHubService) rereadEmailHubAccount(ctx context.Context, acc db.EmailHubAccount) (db.EmailHubAccount, error) {
	row, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: acc.ID, UserID: acc.UserID, OrganizationID: acc.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrEmailHubReauthRequired
	}
	if err != nil {
		return row, err
	}
	if row.AuthFailedAt.Valid {
		return row, ErrEmailHubReauthRequired
	}
	return row, nil
}

func sameEmailHubExpiry(a, b pgtype.Timestamptz) bool {
	return a.Valid == b.Valid && (!a.Valid || a.Time.Equal(b.Time))
}
```

3c. In `server/internal/service/email_hub_folders.go`, add `"strings"` to the standard-library imports. Then replace the `credentials` doc comment and function (lines 35-56) with:

```go
// credentials is the one place a mailbox credential is opened. An account
// that needs reconnect answers ErrEmailHubReauthRequired before any dial; an
// oauth_* account carries a fresh access token and no password.
func (s *EmailHubService) credentials(ctx context.Context, acc db.EmailHubAccount) (emailHubCreds, error) {
	if acc.AuthFailedAt.Valid {
		return emailHubCreds{}, ErrEmailHubReauthRequired
	}
	var password, accessToken string
	var err error
	if strings.HasPrefix(acc.AuthKind, "oauth_") {
		accessToken, err = s.oauthAccessToken(ctx, acc)
	} else {
		password, err = s.openPassword(acc.PasswordEnc)
	}
	if err != nil {
		return emailHubCreds{}, err
	}
	return emailHubCreds{
		IMAP: imapclient.Credentials{
			Host: acc.ImapHost, Port: int(acc.ImapPort), Email: acc.EmailAddress, Username: acc.Username,
			Password: password, AccessToken: accessToken, Security: acc.ImapSecurity,
		},
		SMTP: smtpclient.Credentials{
			Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress, Username: acc.Username,
			Password: password, AccessToken: accessToken, Security: acc.SmtpSecurity,
		},
		Version: acc.CredentialVersion,
	}, nil
}
```

3d. In `server/internal/service/email_hub.go`, add `"sync"` to the standard-library imports. In `EmailHubService`, right after the line `hubWatch *emailHubHubWatcher`, insert a blank line and then:

```go
	// refreshLocks holds one *sync.Mutex per account id (refreshLock).
	refreshLocks sync.Map
```

3e. In `server/internal/service/email_hub_connect.go`, add `"golang.org/x/oauth2"` to the third-party imports. Replace `emailHubErrCode` with:

```go
func emailHubErrCode(err error) string {
	var pgErr *pgconn.PgError
	var retrieveErr *oauth2.RetrieveError
	switch {
	// Before the classifier: context.DeadlineExceeded is also a net.Error.
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, ErrEmailHubReauthRequired):
		return "auth_failed"
	case errors.Is(err, errEmailHubOAuthNotConfigured):
		return "oauth_not_configured"
	case errors.Is(err, errEmailHubOAuthRefreshFailed), errors.As(err, &retrieveErr):
		return "oauth_refresh_failed"
	case errors.As(err, &pgErr):
		return "db"
	}
	code, _ := classifyEmailHubConnectError(err)
	return code
}
```

`redactEmailHubMailErr` needs no change; its fallback `fmt.Errorf("email hub mail server: %s", emailHubErrCode(err))` now names `oauth_refresh_failed` and `oauth_not_configured`.

Then format:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -w internal/service/email_hub.go internal/service/email_hub_folders.go internal/service/email_hub_connect.go internal/service/email_hub_oauth_refresh.go internal/service/email_hub_oauth_refresh_test.go internal/service/email_hub_account_queries_test.go
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m -race ./internal/service/ -run 'TestEmailHubOAuth|TestUpdateEmailHubAccountOAuthTokens|TestEmailHubCredentials|TestEmailHubAccountCredentialQueries|TestEmailHubAuthFailure|TestEmailHubDisconnectAuditsTheOwner'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test -count=1 ./migrations/ -run TestEveryQueryNamesItsTenant
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal ./pkg && go vet ./internal/service/ && go tool staticcheck ./internal/service/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/no-pii-log.test.mjs
```

Expected: everything passes and `gofmt -l` prints nothing. `TestEmailHubCredentialsOpenTheStoredPassword` still passes (password rows take the unchanged branch with `AccessToken ""`). The new query scopes by `organization_id`, so it needs no `-- tenant:` line. The new code logs nothing itself; callers log `emailHubErrCode`, and `markAuthFailed` logs only `account_id` and `reason`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add server/pkg/db/queries/email_hub.sql server/pkg/db/generated/email_hub.sql.go \
  server/internal/service/email_hub_oauth_refresh.go server/internal/service/email_hub_oauth_refresh_test.go \
  server/internal/service/email_hub_folders.go server/internal/service/email_hub.go \
  server/internal/service/email_hub_connect.go server/internal/service/email_hub_account_queries_test.go
git commit -m "feat(email-hub): refresh OAuth access tokens under a per-account lock with conditional writes" \
  -m "credentials() now opens oauth_* accounts too. A token within two minutes of expiry is refreshed under a per-account mutex, after a re-read of the row. The refresh goes through x/oauth2 on the service's own HTTP client, and the write is conditional on the credential_version and oauth_access_expires_at it read, so of two pods in a rolling update exactly one writes and the other uses the winner's token. A refresh never bumps the version. A Microsoft-rotated refresh token is stored. invalid_grant or unauthorized_client marks the account needs_reconnect with reason oauth_invalid_grant only when the re-read row is unchanged (no other pod's write, no reconnect), which keeps the cached mail. Any other failure is transient and returns a bare sentinel (oauth_refresh_failed, or oauth_not_configured once the env is removed), because oauth2 folds the provider's reply into its error text. Left out: the token a pod receives after losing the race is dropped, not revoked, because revoking a Google access token kills the shared grant. Also left out: callers that open IMAP inside withIMAP still refresh while holding the slot, markAuthFailed is fenced by version only, and start, callback, XOAUTH2 verify and revoke come in later tasks." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: OAuth start: PKCE + nonce cookie + sealed state

**Files:**
- Create: `server/internal/service/email_hub_oauth_flow.go` (`emailHubOAuthState`, `emailHubOAuthStateTTL`, `StartOAuth`, `openOAuthState`)
- Create: `server/internal/service/email_hub_oauth_flow_test.go`
- Modify: `server/internal/handler/email_hub_oauth.go` (Task 1): append the cookie constants, `startEmailHubOAuth` and `setEmailHubOAuthCookie`.
- Modify: `server/internal/handler/email_hub_oauth_test.go` (Task 1): append two tests.
- Modify: `server/internal/handler/email_hub_test.go:48-54`. `setupEmailHubHTTP` gains a variadic `configure ...func(*Deps)` that runs before `New(d)`. Existing callers do not change. Task 6 reuses it.
- Modify: `server/internal/handler/dto/sdi/email_hub.go`: append `StartEmailHubOAuthSDI`.
- Modify: `server/internal/handler/dto/sdo/email_hub.go`: append `EmailHubOAuthStartSDO`.
- Modify: `server/internal/handler/router/email_hub.go`: a comment-list line after line 14; the start route right after the `POST .../email-hub/accounts` apiOp (lines 46-58).
- Modify: `server/internal/handler/router/routes.go:180`: `StartEmailHubOAuth http.HandlerFunc` after `ConnectEmailHubAccount`.
- Modify: `server/internal/handler/router.go:282`: `StartEmailHubOAuth: h.startEmailHubOAuth,` after `ConnectEmailHubAccount`.
- Modify: `server/internal/handler/router/openapi.go:130-133` and `:139-143`: the `provider` and `workspaceID,provider` descriptions become neutral.
- Modify: `server/internal/handler/router/email_hub_ratelimit_test.go`: append one test.
- Modify: `server/internal/handler/isolation_routes_test.go:327`: the start row with `skipControl`, next to the calendar start row.

**Interfaces:**
- Consumes:
  - Task 1: `ConfigureOAuth`, `oauthProvider`, `emailHubOAuthProvider{name, config, prompt}` (`consent` / `select_account`), `config.Config` Email Hub fields, `EmailHubRedirectURL`, test helper `emailHubOAuthTestConfig()`.
  - Existing: `s.workspace` (a non-member gets `ErrForbidden` from `RequireMember`, workspace.go:224); `s.box.Seal`/`Open`; `Invalid(msg)` / `ValidationError`; `decode(w, r, &in, maxJSONBody)`; `oauthStateTTL = 10 * time.Minute` (handler/google.go:22); `h.Cfg.SecureCookies`; `emailHubConnectLimit` (router/router.go:153), passed into `registerEmailHub` as `connectLimit`.
  - Test helpers: service `emailHubFixture`, `testEmailHubBox`; handler `setupEmailHubHTTP`, `doJSON`; router `limitedMux`, `caller.spend` / `caller.wantRefused`, `mustMint`.
- Produces:
  - `type emailHubOAuthState struct{ UserID string \`json:"user_id"\`; OrganizationID string \`json:"organization_id"\`; WorkspaceID string \`json:"workspace_id"\`; Provider string \`json:"provider"\`; Nonce string \`json:"nonce"\`; Verifier string \`json:"verifier"\`; Exp int64 \`json:"exp"\` }`
  - `const emailHubOAuthStateTTL = 10 * time.Minute`
  - `func (s *EmailHubService) StartOAuth(ctx context.Context, actor Actor, workspaceID, provider, loginHint string) (authURL, nonce string, err error)`: membership → provider (unknown/disabled `ErrNotFound`) → `loginHint` trimmed, >320 runes or a control character `Invalid`.
  - `func (s *EmailHubService) openOAuthState(raw string) (emailHubOAuthState, bool)`: false without a box, for non-base64url, foreign seal, bad JSON, empty nonce, passed `exp`. The caller still checks `Provider`.
  - handler `const emailHubOAuthCookie = "uniwork_email_oauth"`, `const emailHubOAuthCookiePath = "/api/v1/email-hub-connections/"`, `func (h *handlers) setEmailHubOAuthCookie(w http.ResponseWriter, nonce string)`.
  - `sdi.StartEmailHubOAuthSDI{LoginHint string \`json:"login_hint,omitempty" maxLength:"320"\`}`; `sdo.EmailHubOAuthStartSDO{AuthorizationURL string \`json:"authorization_url"\`}`; `Routes.StartEmailHubOAuth`.
  - Route `POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start` on `connectLimit`; its counter is keyed by route pattern, so Google and Microsoft share one 10/10min budget, separate from `POST accounts`.
  - Handler test helper `setupEmailHubHTTP(t *testing.T, configure ...func(*Deps))`.

- [ ] **Step 1: Write the failing tests**

Create `server/internal/service/email_hub_oauth_flow_test.go`:

```go
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// Membership answers before the provider switch: an outsider hears 403 whether
// or not the provider is on, and only a member learns it is off (spec §5.3 step 1).
func TestEmailHubStartOAuthRequiresMemberFirst(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()

	if _, _, err := svc.StartOAuth(ctx, Human(util.NewID()), ws.ID, "google", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member on a disabled provider: %v, want ErrForbidden", err)
	}
	if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, "google", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member on a disabled provider: %v, want ErrNotFound", err)
	}
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	if u, nonce, err := svc.StartOAuth(ctx, Human(util.NewID()), ws.ID, "google", ""); !errors.Is(err, ErrForbidden) || u != "" || nonce != "" {
		t.Fatalf("non-member on an enabled provider: url=%q nonce=%q err=%v", u, nonce, err)
	}
}

// Only Email Hub's own providers start; the calendar's "outlook" is not one,
// and without the credential box no provider is on (spec §5.6).
func TestEmailHubStartOAuthUnknownProvider404(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	for _, provider := range []string{"outlook", "yahoo", ""} {
		if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, provider, ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("provider %q: %v, want ErrNotFound", provider, err)
		}
	}
	noBox := NewEmailHubService(q, svc.ws, nil)
	noBox.ConfigureOAuth(emailHubOAuthTestConfig())
	if _, _, err := noBox.StartOAuth(ctx, Human(user.ID), ws.ID, "google", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no credential box: %v, want ErrNotFound", err)
	}
}

// The URL asks for offline access with PKCE S256 and the provider's prompt. It
// carries the hint and Email Hub's own redirect. The state opens to who
// started the sign-in, where, and the nonce the cookie gets, and the verifier
// never leaves it (spec §5.3, §7).
func TestEmailHubStartOAuthURL(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	cfg := emailHubOAuthTestConfig()
	svc.ConfigureOAuth(cfg)

	cases := []struct{ provider, host, client, prompt, hint string }{
		{"google", "accounts.google.com", "hub-google-id", "consent", "me@gmail.com"},
		{"microsoft", "login.microsoftonline.com", "hub-ms-id", "select_account", ""},
	}
	seen := map[string]bool{}
	for _, tc := range cases {
		before := time.Now()
		raw, nonce, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, tc.provider, "  "+tc.hint+" ")
		if err != nil {
			t.Fatalf("%s: %v", tc.provider, err)
		}
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		if u.Host != tc.host || q.Get("client_id") != tc.client || q.Get("response_type") != "code" ||
			q.Get("redirect_uri") != cfg.EmailHubRedirectURL(tc.provider) {
			t.Errorf("%s: url %s", tc.provider, raw)
		}
		if q.Get("access_type") != "offline" || q.Get("code_challenge_method") != "S256" ||
			q.Get("code_challenge") == "" || q.Get("prompt") != tc.prompt {
			t.Errorf("%s: offline/PKCE/prompt params: %v", tc.provider, q)
		}
		if q.Has("login_hint") != (tc.hint != "") || q.Get("login_hint") != tc.hint {
			t.Errorf("%s: login_hint=%q, want %q", tc.provider, q.Get("login_hint"), tc.hint)
		}
		st, ok := svc.openOAuthState(q.Get("state"))
		if !ok {
			t.Fatalf("%s: the state does not open", tc.provider)
		}
		want := emailHubOAuthState{
			UserID: user.ID, OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, Provider: tc.provider,
			Nonce: nonce, Verifier: st.Verifier, Exp: st.Exp,
		}
		if st != want || len(nonce) != 43 {
			t.Errorf("%s: state %+v, nonce %q", tc.provider, st, nonce)
		}
		if st.Exp < before.Add(emailHubOAuthStateTTL).Unix() || st.Exp > time.Now().Add(emailHubOAuthStateTTL).Unix() {
			t.Errorf("%s: exp %d is not now+10m", tc.provider, st.Exp)
		}
		if st.Verifier == "" || strings.Contains(raw, st.Verifier) || q.Get("code_challenge") != oauth2.S256ChallengeFromVerifier(st.Verifier) {
			t.Errorf("%s: the verifier must stay in the state and match the challenge", tc.provider)
		}
		if seen[nonce] || seen[st.Verifier] {
			t.Errorf("%s: a nonce or verifier was reused", tc.provider)
		}
		seen[nonce], seen[st.Verifier] = true, true
	}
	var ve ValidationError
	if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, "google", strings.Repeat("a", 321)); !errors.As(err, &ve) {
		t.Fatalf("a 321-rune hint: %v, want a validation error", err)
	}
}

// A state opens only when this box sealed it, it carries a nonce, and it has
// not expired (spec §5.4 step 1).
func TestEmailHubOAuthStateRejectsTamperedAndExpired(t *testing.T) {
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	other := NewEmailHubService(nil, nil, testEmailHubBox(t))
	seal := func(s *EmailHubService, st emailHubOAuthState) string {
		plain, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := s.box.Seal(plain)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(sealed)
	}
	live := emailHubOAuthState{
		UserID: "u1", OrganizationID: "o1", WorkspaceID: "w1", Provider: "google",
		Nonce: "n1", Verifier: "v1", Exp: time.Now().Add(time.Minute).Unix(),
	}
	if got, ok := svc.openOAuthState(seal(svc, live)); !ok || got != live {
		t.Fatalf("a live state must open: %+v %v", got, ok)
	}
	expired, noNonce := live, live
	expired.Exp = time.Now().Add(-time.Second).Unix()
	noNonce.Nonce = ""
	good := seal(svc, live)
	flip := "A"
	if good[10:11] == "A" {
		flip = "B"
	}
	for name, raw := range map[string]string{
		"empty":         "",
		"not base64url": "not+base64/url!",
		"expired":       seal(svc, expired),
		"no nonce":      seal(svc, noNonce),
		"tampered":      good[:10] + flip + good[11:],
		"another box":   seal(other, live),
	} {
		if _, ok := svc.openOAuthState(raw); ok {
			t.Errorf("%s: state opened", name)
		}
	}
	if _, ok := NewEmailHubService(nil, nil, nil).openOAuthState(good); ok {
		t.Fatal("without a box nothing opens")
	}
}
```

Append to `server/internal/handler/email_hub_oauth_test.go`, adding the imports `encoding/base64`, `encoding/json`, `net/http/httptest`, `net/url`, `strings` and `github.com/unicomhub/uniwork/server/internal/config` to its import block:

```go
// Start answers the provider URL and sets the nonce cookie only the callback
// path receives. The cookie holds the nonce sealed in the state, never the
// PKCE verifier, and a provider that is off sets no cookie (spec §5.3).
func TestEmailHubOAuthStartSetsTheNonceCookie(t *testing.T) {
	srv, token, wsID, _, box := setupEmailHubHTTP(t, func(d *Deps) {
		d.EmailHub.ConfigureOAuth(config.Config{
			APIPublicURL:           "https://api.uniwork.test",
			EmailHubGoogleClientID: "g-client", EmailHubGoogleClientSecret: "g-secret",
		})
	})
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/google/start", token,
		map[string]any{"login_hint": "me@gmail.com"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start: %d %v", res.StatusCode, out)
	}
	raw, _ := out["authorization_url"].(string)
	u, err := url.Parse(raw)
	if err != nil || u.Host != "accounts.google.com" || u.Query().Get("login_hint") != "me@gmail.com" {
		t.Fatalf("authorization_url = %q (%v)", raw, err)
	}
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == emailHubOAuthCookie {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no nonce cookie")
	}
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/api/v1/email-hub-connections/" ||
		cookie.MaxAge != 600 || cookie.Secure {
		t.Fatalf("cookie = %+v", cookie)
	}
	sealed, err := base64.RawURLEncoding.DecodeString(u.Query().Get("state"))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := box.Open(sealed)
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Nonce    string `json:"nonce"`
		Verifier string `json:"verifier"`
	}
	if err := json.Unmarshal(plain, &st); err != nil {
		t.Fatal(err)
	}
	if st.Nonce == "" || cookie.Value != st.Nonce || st.Verifier == "" || strings.Contains(raw, st.Verifier) {
		t.Fatalf("cookie %q, state nonce %q; the verifier must stay sealed", cookie.Value, st.Nonce)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/microsoft/start", token, map[string]any{})
	if res.StatusCode != http.StatusNotFound || len(res.Cookies()) != 0 {
		t.Fatalf("a provider without a client: %d %v cookies=%v", res.StatusCode, out, res.Cookies())
	}
}

// Secure follows the frontend origin's scheme, like the refresh cookie.
func TestEmailHubOAuthCookieSecureFollowsConfig(t *testing.T) {
	for _, secure := range []bool{false, true} {
		h := &handlers{Deps: Deps{Cfg: config.Config{SecureCookies: secure}}}
		rec := httptest.NewRecorder()
		h.setEmailHubOAuthCookie(rec, "nonce-1")
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != emailHubOAuthCookie || cookies[0].Value != "nonce-1" || cookies[0].Secure != secure {
			t.Fatalf("secure=%v: cookies = %+v", secure, cookies)
		}
	}
}
```

In `server/internal/handler/email_hub_test.go`, change the opening of `setupEmailHubHTTP` (lines 48-54) to:

```go
func setupEmailHubHTTP(t *testing.T, configure ...func(*Deps)) (*httptest.Server, string, string, string, *secretbox.Box) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	box := testEmailHubSecretBox(t)
	q := db.New(pool)
	d.EmailHub = service.NewEmailHubService(q, d.Workspaces, box)
	for _, c := range configure {
		c(&d)
	}
	srv := httptest.NewServer(New(d))
```

The rest of the function is unchanged.

Append to `server/internal/handler/router/email_hub_ratelimit_test.go`:

```go
// UNI-1197: starting a sign-in sends the browser to a third party, so it
// takes connect's per-person, per-route budget. Google and Microsoft share
// the start route's 10, and spending them leaves the password connect's own
// 10 untouched.
func TestEmailHubOAuthStartBudgetsEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const start = "/api/v1/workspaces/w1/email-hub/oauth/google/start"
	a := caller{ip: "10.20.0.10", bearer: mustMint(t, minter, "oauth-user-a")}
	a.spend(t, h, http.MethodPost, start, 10)
	a.wantRefused(t, h, http.MethodPost, start, "10 starts per 10 minutes")
	a.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/w2/email-hub/oauth/microsoft/start", "the budget is per route, not per workspace or provider")
	a.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/email-hub/accounts", 10)
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubStartOAuth|TestEmailHubOAuthState'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/ -run 'TestEmailHubOAuthStartSetsTheNonceCookie|TestEmailHubOAuthCookieSecureFollowsConfig'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/router/ -run 'TestEmailHubOAuthStartBudgetsEachSignedInUser'
```

Expected:
- service fails to build: `svc.StartOAuth undefined`, `undefined: emailHubOAuthState`, `undefined: emailHubOAuthStateTTL`.
- handler fails to build: `undefined: emailHubOAuthCookie`, `h.setEmailHubOAuthCookie undefined`. The variadic `setupEmailHubHTTP` itself compiles.
- router fails with `POST /api/v1/workspaces/w1/email-hub/oauth/google/start: status 404, want 429 (10 starts per 10 minutes)`.

- [ ] **Step 3: Implement**

3a. Create `server/internal/service/email_hub_oauth_flow.go`:

```go
package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/oauth2"
)

// emailHubOAuthStateTTL bounds one sign-in: the sealed state and the nonce
// cookie both expire after it (spec §5.3, §7).
const emailHubOAuthStateTTL = 10 * time.Minute

// emailHubOAuthState is sealed with the Email Hub box into the OAuth state
// parameter. The callback trusts nothing else about who started the sign-in,
// and the PKCE verifier lives only here, never in a URL or a cookie.
type emailHubOAuthState struct {
	UserID         string `json:"user_id"`
	OrganizationID string `json:"organization_id"`
	WorkspaceID    string `json:"workspace_id"`
	Provider       string `json:"provider"`
	Nonce          string `json:"nonce"`
	Verifier       string `json:"verifier"`
	Exp            int64  `json:"exp"`
}

// StartOAuth begins a Google/Microsoft sign-in for the caller's mailbox (spec
// §5.3). Membership answers first. A provider without an Email Hub OAuth client
// is 404. It returns the provider URL, and the nonce the handler puts in the
// HttpOnly cookie that the callback compares with the sealed state.
func (s *EmailHubService) StartOAuth(ctx context.Context, actor Actor, workspaceID, provider, loginHint string) (authURL, nonce string, err error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return "", "", err
	}
	p, ok := s.oauthProvider(provider)
	if !ok {
		return "", "", ErrNotFound
	}
	// The SDI's maxLength is documentation only; the hint ends up in a URL.
	loginHint = strings.TrimSpace(loginHint)
	if utf8.RuneCountInString(loginHint) > 320 || strings.IndexFunc(loginHint, unicode.IsControl) >= 0 {
		return "", "", Invalid("invalid login hint")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	nonce = base64.RawURLEncoding.EncodeToString(raw)
	verifier := oauth2.GenerateVerifier()
	plain, err := json.Marshal(emailHubOAuthState{
		UserID: actor.ID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Provider: p.name, Nonce: nonce, Verifier: verifier,
		Exp: time.Now().Add(emailHubOAuthStateTTL).Unix(),
	})
	if err != nil {
		return "", "", err
	}
	sealed, err := s.box.Seal(plain)
	if err != nil {
		return "", "", err
	}
	opts := []oauth2.AuthCodeOption{oauth2.AccessTypeOffline, oauth2.S256ChallengeOption(verifier)}
	if p.prompt != "" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", p.prompt))
	}
	if loginHint != "" {
		opts = append(opts, oauth2.SetAuthURLParam("login_hint", loginHint))
	}
	return p.config.AuthCodeURL(base64.RawURLEncoding.EncodeToString(sealed), opts...), nonce, nil
}

// openOAuthState opens a state StartOAuth sealed. It is false for anything
// this box did not seal, a state without a nonce (an empty cookie must never
// match it), and an expired state. The caller still checks the provider.
func (s *EmailHubService) openOAuthState(raw string) (emailHubOAuthState, bool) {
	if s.box == nil {
		return emailHubOAuthState{}, false
	}
	sealed, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return emailHubOAuthState{}, false
	}
	plain, err := s.box.Open(sealed)
	if err != nil {
		return emailHubOAuthState{}, false
	}
	var st emailHubOAuthState
	if json.Unmarshal(plain, &st) != nil || st.Nonce == "" || time.Now().Unix() > st.Exp {
		return emailHubOAuthState{}, false
	}
	return st, true
}
```

3b. Append to `server/internal/handler/dto/sdi/email_hub.go`:

```go
// StartEmailHubOAuthSDI is POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start.
type StartEmailHubOAuthSDI struct {
	LoginHint string `json:"login_hint,omitempty" maxLength:"320" description:"Địa chỉ gợi ý để nhà cung cấp chọn sẵn tài khoản khi kết nối lại" example:"you@gmail.com"`
}
```

3c. Append to `server/internal/handler/dto/sdo/email_hub.go`:

```go
// EmailHubOAuthStartSDO is POST .../email-hub/oauth/{provider}/start.
type EmailHubOAuthStartSDO struct {
	AuthorizationURL string `json:"authorization_url" description:"URL đăng nhập của nhà cung cấp, mở trong cửa sổ bật lên" example:"https://accounts.google.com/o/oauth2/v2/auth?client_id=..."`
}
```

3d. Append to `server/internal/handler/email_hub_oauth.go`, adding `time` and `.../handler/dto/sdi` to its imports:

```go
// The nonce cookie carries the start's nonce to the callback; the sealed
// state holds the same nonce, so a state lifted into another browser does not
// complete there (spec §5.3, §7). Its path covers only the callback routes.
const (
	emailHubOAuthCookie     = "uniwork_email_oauth"
	emailHubOAuthCookiePath = "/api/v1/email-hub-connections/"
)

func (h *handlers) startEmailHubOAuth(w http.ResponseWriter, r *http.Request) {
	var in sdi.StartEmailHubOAuthSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	authURL, nonce, err := h.EmailHub.StartOAuth(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "provider"), in.LoginHint)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.setEmailHubOAuthCookie(w, nonce)
	respondJSON(w, http.StatusOK, sdo.EmailHubOAuthStartSDO{AuthorizationURL: authURL})
}

// setEmailHubOAuthCookie: Lax is what lets the browser send it on the
// top-level GET the provider redirects back to; it lives as long as the state.
func (h *handlers) setEmailHubOAuthCookie(w http.ResponseWriter, nonce string) {
	http.SetCookie(w, &http.Cookie{
		Name: emailHubOAuthCookie, Value: nonce, Path: emailHubOAuthCookiePath,
		MaxAge: int(oauthStateTTL / time.Second), HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
}
```

3e. In `server/internal/handler/router/routes.go`, after `ConnectEmailHubAccount http.HandlerFunc` (line 180):

```go
	StartEmailHubOAuth            http.HandlerFunc
```

In `server/internal/handler/router.go`, after `ConnectEmailHubAccount: h.connectEmailHubAccount,` (line 282):

```go
		StartEmailHubOAuth:            h.startEmailHubOAuth,
```

3f. In `server/internal/handler/router/email_hub.go`, add after the `POST .../email-hub/accounts` line (line 14) of the comment list:

```go
//	POST   /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start
```

Then add the route right after the closing `})` of the `POST .../email-hub/accounts` apiOp (line 58):

```go
	r.With(connectLimit).Post("/workspaces/{workspaceID}/email-hub/oauth/{provider}/start", h.StartEmailHubOAuth, apiOp{
		summary: "Start Google or Microsoft sign-in for a mailbox",
		description: "provider is google or microsoft; one without an Email Hub OAuth client answers 404. " +
			"Returns the provider's authorization URL (offline access, PKCE S256) and sets the HttpOnly " +
			"uniwork_email_oauth nonce cookie on /api/v1/email-hub-connections/ for the callback, so the web " +
			"app and the API must be same-site. login_hint pre-selects the account on a reconnect. " +
			"10 requests per 10 minutes per user.",
		tags: []string{"email-hub"},
		sdi:  sdi.StartEmailHubOAuthSDI{},
		sdo:  sdo.EmailHubOAuthStartSDO{},
		auth: true,
	})
```

3g. In `server/internal/handler/router/openapi.go`, make both `provider` descriptions neutral. In the `"provider"` case (line 132):

```go
			Provider string `path:"provider" description:"Nhà cung cấp OAuth: google hoặc outlook (lịch), google hoặc microsoft (Email Hub)" example:"google"`
```

In the `"workspaceID,provider"` case (line 142):

```go
			Provider    string `path:"provider" description:"Nhà cung cấp OAuth: google hoặc outlook (lịch), google hoặc microsoft (Email Hub)" example:"google"`
```

3h. In `server/internal/handler/isolation_routes_test.go`, add after the calendar start row (line 327):

```go
	"POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start": {skipControl: "no OAuth client is configured in tests; the owner gets 404"},
```

The matrix fills `{provider}` with `"google"` (isolation_matrix_test.go:590) and posts `{}` (isolation_world_test.go:259), so `decode` passes and B's owner gets the 403 from `RequireMember`. No new path parameter name, so `pathParamSDI` gains no case; `login_hint` does not end in `_id`, so `isoReferences` does not change.

3i. Format:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -w internal/service/email_hub_oauth_flow.go internal/service/email_hub_oauth_flow_test.go internal/handler/email_hub_oauth.go internal/handler/email_hub_oauth_test.go internal/handler/email_hub_test.go internal/handler/router.go internal/handler/router/routes.go internal/handler/router/email_hub.go internal/handler/router/openapi.go internal/handler/router/email_hub_ratelimit_test.go internal/handler/isolation_routes_test.go internal/handler/dto/sdi/email_hub.go internal/handler/dto/sdo/email_hub.go
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m -race ./internal/service/ -run 'TestEmailHubStartOAuth|TestEmailHubOAuthState'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/handler/ -run 'TestEmailHubOAuthStartSetsTheNonceCookie|TestEmailHubOAuthCookieSecureFollowsConfig|TestEmailHubConnect|TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase|TestSwaggerSpecFollowsChiRoutesAndSDI'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/router/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal && go vet ./internal/service/ ./internal/handler/... && go tool staticcheck ./internal/service/ ./internal/handler/...
```

Expected: everything passes, `gofmt -l` prints nothing. `TestIsolationMatrix` refuses B's owner and the anonymous caller on start and skips the owner's control with the 404 reason. `TestSwaggerSpecFollowsChiRoutesAndSDI` finds the new path with its SDI and SDO. The router run includes `TestEveryRouteFieldIsBound` and the existing connect budget test.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add server/internal/service/email_hub_oauth_flow.go server/internal/service/email_hub_oauth_flow_test.go \
  server/internal/handler/email_hub_oauth.go server/internal/handler/email_hub_oauth_test.go \
  server/internal/handler/email_hub_test.go \
  server/internal/handler/dto/sdi/email_hub.go server/internal/handler/dto/sdo/email_hub.go \
  server/internal/handler/router/email_hub.go server/internal/handler/router/routes.go \
  server/internal/handler/router.go server/internal/handler/router/openapi.go \
  server/internal/handler/router/email_hub_ratelimit_test.go server/internal/handler/isolation_routes_test.go
git commit -m "feat(email-hub): start a Google or Microsoft sign-in with PKCE, a nonce cookie and a sealed state" \
  -m "POST .../email-hub/oauth/{provider}/start checks membership before the provider switch, so an outsider hears 403 whether or not the provider is on. A provider without Email Hub's own OAuth client is 404. It seals who started the sign-in, where, a 32-byte nonce, the PKCE verifier and a 10-minute exp into the state with the Email Hub box, and returns the provider URL with offline access, S256, the provider's prompt and an optional login_hint (trimmed, at most 320 runes). The nonce goes into an HttpOnly Lax cookie scoped to /api/v1/email-hub-connections/ with Secure following the frontend origin, so a state replayed in another browser cannot complete. The verifier never leaves the sealed state. openOAuthState refuses a foreign, tampered, nonce-less or expired state. The route uses connect's per-person limiter, which keys per route: 10 per 10 minutes shared by Google and Microsoft. The {provider} path description is now neutral between the calendar and Email Hub. Left out: the callback, the code exchange and the HTML result page (Tasks 5-6), revoke (Task 7) and the client (Tasks 8-10)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: OAuth callback service: exchange, id_token email, verify, connect-or-reconnect on the same id

**Files:**
- Modify: `server/pkg/db/queries/email_hub.sql`. `CreateEmailHubAccount` (lines 1-9) gains `$15-$17`. `UpdateEmailHubAccountCredentials` (lines 76-105) takes the three `oauth_*` columns as args (today it writes `''`/`NULL` at :91-93).
- Regenerate: `server/pkg/db/generated/email_hub.sql.go` with `make sqlc`.
- Modify: `server/internal/service/email_hub_connect.go`: add `emailHubSealedCredential`; `Connect` (:48-118) seals through `sealSecret`, passes a password credential and calls `afterEmailHubConnect`; `saveEmailHubConnection` (:148-214) takes the credential and returns the previous row; add `afterEmailHubConnect` (the old post-commit tail at :102-110); drop the `encoding/base64` import (only :98 used it).
- Modify: `server/internal/service/email_hub_connect_server.go`. Add `presetEmailHubServer`; the preset branch of `resolveEmailHubServer` (:44-53) uses it.
- Create: `server/internal/service/email_hub_oauth_callback.go`
- Create: `server/internal/service/email_hub_oauth_callback_test.go`

Existing callers of `CreateEmailHubAccountParams` and `UpdateEmailHubAccountCredentialsParams` use keyed literals (3 in handler tests, 8 in service tests, plus `saveEmailHubConnection`); they compile unchanged, and their zero values `''`/`NULL` are what a password row means.

**Interfaces:**
- Consumes:
  - Task 1: `emailHubOAuthProvider{name, authKind, preset, config, revokeURL, prompt}`, `s.oauth`, `s.oauthHTTP`, `oauthProvider`, `oauthCtx`, `emailhub.Preset`.
  - Task 2: `imapclient.Credentials.AccessToken`, `smtpclient.Credentials.AccessToken`.
  - Task 3: `sealSecret` (std base64 of `box.Seal`, opened by `openPassword`).
  - Task 4: `emailHubOAuthState`, `openOAuthState`, `StartOAuth`.
  - GD1/GD2: `s.workspace`, `Human`, `GetActiveEmailHubAccountByAddress` (FOR UPDATE inside the save tx), `sameEmailHubConnection`, `verifyEmailHubLogin` / `testHookVerify`, `testHookInitialSync`, `resetEmailHubServerCache`, `gov.loginSucceeded`, `auditRecorder.Record`, `emailHubErrCode`, `markAuthFailed`.
  - Test helpers: `emailHubFixture`, `stubEmailHubDial`, `seedPresetEmailHubAccount`, `seedEmailHubThread`, `markSeedAccountAuthFailed`, `connectedAudit`, `connectedServerChanged`, `emailHubCount`.
- Produces:
  - `db.CreateEmailHubAccountParams` and `db.UpdateEmailHubAccountCredentialsParams` gain `OauthRefreshTokenEnc string`, `OauthAccessTokenEnc string`, `OauthAccessExpiresAt pgtype.Timestamptz`.
  - `type emailHubSealedCredential struct{ AuthKind, PasswordEnc, RefreshEnc, AccessEnc string; AccessExpiresAt pgtype.Timestamptz }`
  - `func (s *EmailHubService) saveEmailHubConnection(ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams, srv emailHubServer, cred emailHubSealedCredential) (row db.EmailHubAccount, prev db.EmailHubAccount, serverChanged bool, err error)`. `prev` is the row read FOR UPDATE before the update, zero on insert; Task 7 revokes from it.
  - `func (s *EmailHubService) afterEmailHubConnect(ctx context.Context, row db.EmailHubAccount, serverChanged bool)`
  - `func presetEmailHubServer(prov emailhub.Provider) emailHubServer`
  - `func (s *EmailHubService) CompleteOAuth(ctx context.Context, provider, rawState, code, providerError, cookieNonce string) string`
  - `func emailHubIDTokenEmail(provider, idToken string) (string, bool)`
  - Exported result codes: `EmailHubOAuthConnected = "connected"`, `EmailHubOAuthDenied = "denied"`, `EmailHubOAuthStateInvalid = "state_invalid"`, `EmailHubOAuthEmailUnavailable = "email_unavailable"`, `EmailHubOAuthIMAPNotEnabled = "imap_not_enabled"`, `EmailHubOAuthSMTPDisabled = "smtp_disabled"`, `EmailHubOAuthAlreadyConnected = "already_connected"`, `EmailHubOAuthConsentRequired = "consent_required"`, `EmailHubOAuthFailed = "failed"`.
  - Log line `email hub oauth callback failed` with keys `code`, `reason` (a fixed string or `emailHubErrCode`), `provider`, `user_id`.

Order inside `CompleteOAuth` (every refusal writes no row):
1. `ctx = context.WithoutCancel(ctx)`: the code is single-use; once spent, the connect finishes even if the popup closes.
2. Open the state. Bad state, `state.Provider != provider` or expired `exp` → `state_invalid`.
3. Cookie nonce. Empty, or failing `subtle.ConstantTimeCompare` → `state_invalid`.
4. `providerError`: `access_denied` → `denied`, anything else → `failed`.
5. Membership: `s.workspace(Human(state.UserID), state.WorkspaceID)` and the workspace org must equal `state.OrganizationID`; failure → `failed`. (Before the provider lookup and the Exchange per the global constraint; a deactivated member's code is never spent.)
6. Provider lookup; no longer configured → `failed`.
7. Exchange with `VerifierOption(state.Verifier)`, 10s, on `oauthCtx` → error `failed` (reason `exchange_<code>` for a whitelisted RFC 6749 code, else `exchange`).
8. No refresh token → `consent_required`.
9. `emailHubIDTokenEmail`; no usable address → `email_unavailable`.
10. Pre-dial duplicate check → `already_connected`.
11. XOAUTH2 verify on the preset (mandatory: it is the only proof the address is the user's). IMAP refusal → `imap_not_enabled`, `ErrSMTPAuthDisabled` → `smtp_disabled`, else `failed`.
12. Seal and save. Lost insert race → `already_connected`. Then `afterEmailHubConnect`, then `connected`.

- [ ] **Step 1: Write the failing tests**

Create `server/internal/service/email_hub_oauth_callback_test.go`:

```go
package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const emailHubAccountsOf = `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1`

// emailHubTokenEndpoint stands in for the Google and Microsoft token
// endpoints: every Exchange posts here; a test sets the reply and reads the form.
type emailHubTokenEndpoint struct {
	mu    sync.Mutex
	calls int
	form  url.Values
	reply map[string]any // nil answers 400 invalid_grant, as a replayed code does
}

func (e *emailHubTokenEndpoint) answer(reply map[string]any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.reply = reply
}

func (e *emailHubTokenEndpoint) seen() (int, url.Values) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls, e.form
}

// fakeEmailHubOAuthCallback configures both providers on svc with every
// endpoint on one httptest server, so no test reaches Google or Microsoft.
func fakeEmailHubOAuthCallback(t *testing.T, svc *EmailHubService) *emailHubTokenEndpoint {
	t.Helper()
	e := &emailHubTokenEndpoint{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			return // a revoke (Task 7) answers 200 and is not counted
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		e.mu.Lock()
		e.calls++
		e.form = r.PostForm
		reply := e.reply
		e.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if reply == nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(reply)
	}))
	t.Cleanup(srv.Close)
	svc.oauthHTTP = srv.Client()
	svc.oauth = map[string]*emailHubOAuthProvider{}
	for _, p := range []struct{ name, authKind, preset, prompt string }{
		{"google", "oauth_google", "gmail", "consent"},
		{"microsoft", "oauth_microsoft", "outlook", "select_account"},
	} {
		preset, ok := emailhub.Preset(p.preset)
		if !ok {
			t.Fatalf("no preset %q", p.preset)
		}
		svc.oauth[p.name] = &emailHubOAuthProvider{
			name: p.name, authKind: p.authKind, preset: preset, prompt: p.prompt,
			revokeURL: srv.URL + "/revoke",
			config: oauth2.Config{
				ClientID: "client-" + p.name, ClientSecret: "secret-" + p.name,
				RedirectURL: "http://api.test/api/v1/email-hub-connections/" + p.name + "/callback",
				Endpoint: oauth2.Endpoint{
					AuthURL: srv.URL + "/authorize", TokenURL: srv.URL + "/token",
					AuthStyle: oauth2.AuthStyleInParams, // one POST per Exchange, so counts are exact
				},
			},
		}
	}
	return e
}

// testEmailHubIDToken is an unsigned JWT: the callback reads only the payload
// of an id_token that came straight from the token endpoint (spec §5.4 step 5).
func testEmailHubIDToken(claims map[string]any) string {
	part := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	return part(map[string]string{"alg": "RS256", "typ": "JWT"}) + "." + part(claims) + ".c2ln"
}

// emailHubTokenReply is a full token response whose id_token carries claims.
func emailHubTokenReply(claims map[string]any) map[string]any {
	return map[string]any{
		"access_token": "access-1", "token_type": "Bearer", "expires_in": 3600,
		"refresh_token": "refresh-1", "id_token": testEmailHubIDToken(claims),
	}
}

func googleIDClaims(email string) map[string]any {
	return map[string]any{"email": email, "email_verified": true}
}

// startEmailHubTestOAuth runs the real start and returns the state the
// provider hands back and the nonce the browser holds in its cookie.
func startEmailHubTestOAuth(t *testing.T, svc *EmailHubService, userID, workspaceID, provider string) (state, nonce string) {
	t.Helper()
	authURL, nonce, err := svc.StartOAuth(context.Background(), Human(userID), workspaceID, provider, "")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	state = u.Query().Get("state")
	if state == "" || nonce == "" {
		t.Fatalf("start returned state=%q nonce=%q", state, nonce)
	}
	return state, nonce
}

// sealEmailHubTestOAuthState seals a hand-made state as StartOAuth does
// (base64url of box.Seal(JSON)); the live round trip proves the two agree.
func sealEmailHubTestOAuthState(t *testing.T, svc *EmailHubService, st emailHubOAuthState) string {
	t.Helper()
	seal := func(st emailHubOAuthState) string {
		raw, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := svc.box.Seal(raw)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(sealed)
	}
	live := st
	live.Exp = time.Now().Add(time.Minute).Unix()
	if got, ok := svc.openOAuthState(seal(live)); !ok || got != live {
		t.Fatal("this helper must seal the state the way StartOAuth does")
	}
	return seal(st)
}

func TestEmailHubIDTokenEmail(t *testing.T) {
	t.Parallel()
	tok := testEmailHubIDToken
	cases := []struct{ name, provider, idToken, want string }{
		{"google verified", "google", tok(googleIDClaims("me@gmail.com")), "me@gmail.com"},
		{"google case and spaces", "google", tok(googleIDClaims(" Me@Gmail.COM ")), "me@gmail.com"},
		{"google unverified", "google", tok(map[string]any{"email": "me@gmail.com", "email_verified": false}), ""},
		{"google verified missing", "google", tok(map[string]any{"email": "me@gmail.com"}), ""},
		{"google never uses preferred_username", "google", tok(map[string]any{"preferred_username": "me@gmail.com", "email_verified": true}), ""},
		{"microsoft email wins", "microsoft", tok(map[string]any{"email": "Me@Contoso.com", "preferred_username": "upn@contoso.com"}), "me@contoso.com"},
		{"microsoft upn fallback", "microsoft", tok(map[string]any{"preferred_username": "UPN@contoso.com"}), "upn@contoso.com"},
		{"microsoft blank email falls back", "microsoft", tok(map[string]any{"email": "  ", "preferred_username": "upn@contoso.com"}), "upn@contoso.com"},
		{"microsoft nothing", "microsoft", tok(map[string]any{"name": "Me"}), ""},
		{"display-name form", "google", tok(googleIDClaims("Me <me@gmail.com>")), ""},
		{"not an address", "microsoft", tok(map[string]any{"preferred_username": "+84901234567"}), ""},
		{"header injection", "microsoft", tok(map[string]any{"email": "me@contoso.com\r\nBcc: x@evil.test"}), ""},
		{"unknown provider", "yahoo", tok(googleIDClaims("me@yahoo.com")), ""},
		{"empty", "google", "", ""},
		{"two segments", "google", "a.b", ""},
		{"payload not base64", "google", "a.%%%.c", ""},
		{"payload not json", "google", "a." + base64.RawURLEncoding.EncodeToString([]byte("nope")) + ".c", ""},
	}
	for _, tc := range cases {
		got, ok := emailHubIDTokenEmail(tc.provider, tc.idToken)
		if got != tc.want || ok != (tc.want != "") {
			t.Errorf("%s: got (%q, %v), want %q", tc.name, got, ok, tc.want)
		}
	}
}

// A state or cookie fault answers state_invalid before the code is spent: the
// token endpoint never hears of it and no row is written (spec §5.4 steps 1-2).
func TestEmailHubCompleteOAuthStateChecks(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	st, ok := svc.openOAuthState(state)
	if !ok {
		t.Fatal("start must hand back a state the callback can open")
	}
	expired := st
	expired.Exp = time.Now().Add(-time.Second).Unix()
	emptyNonce := st
	emptyNonce.Nonce = ""
	tampered := []byte(state)
	if i := len(tampered) / 2; tampered[i] == 'A' {
		tampered[i] = 'B'
	} else {
		tampered[i] = 'A'
	}
	cases := []struct{ name, provider, state, cookie string }{
		{"not base64", "google", "%%%", nonce},
		{"tampered seal", "google", string(tampered), nonce},
		{"expired", "google", sealEmailHubTestOAuthState(t, svc, expired), nonce},
		{"provider mismatch", "microsoft", state, nonce},
		{"missing cookie", "google", state, ""},
		{"wrong cookie", "google", state, nonce + "x"},
		{"empty nonce, empty cookie", "google", sealEmailHubTestOAuthState(t, svc, emptyNonce), ""},
	}
	for _, tc := range cases {
		if got := svc.CompleteOAuth(ctx, tc.provider, tc.state, "code-1", "", tc.cookie); got != EmailHubOAuthStateInvalid {
			t.Errorf("%s: got %q, want state_invalid", tc.name, got)
		}
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("a refused state must not spend the code, token endpoint called %d times", n)
	}
	if calls.Load() != 0 || emailHubCount(t, pool, emailHubAccountsOf, user.ID) != 0 {
		t.Fatal("a refused state must neither dial nor write a row")
	}
	// The genuine pair still connects: the refusals above consumed nothing.
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
		t.Fatalf("genuine callback: got %q, want connected", got)
	}
}

func TestEmailHubCompleteOAuthDenied(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	if got := svc.CompleteOAuth(ctx, "google", state, "", "access_denied", "wrong"); got != EmailHubOAuthStateInvalid {
		t.Fatalf("the cookie check runs before the provider error: got %q", got)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "", "access_denied", nonce); got != EmailHubOAuthDenied {
		t.Fatalf("access_denied: got %q, want denied", got)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "", "server_error", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("other provider error: got %q, want failed", got)
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("a provider error has no code to exchange, token endpoint called %d times", n)
	}
}

// End to end: the real start's state and cookie, the PKCE verifier on the
// token request, an XOAUTH2 check with the new access token on the provider
// preset, then one row and its audit (spec §5.4).
func TestEmailHubCompleteOAuthCreatesAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	stubEmailHubDial(svc, nil)
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}
	cases := []struct {
		provider, email, authKind, preset string
		claims                            map[string]any
	}{
		{"google", "new@gmail.com", "oauth_google", "gmail", googleIDClaims(" New@Gmail.com ")},
		// A work account whose token has no email claim is named by its UPN.
		{"microsoft", "new@contoso.com", "oauth_microsoft", "outlook", map[string]any{"preferred_username": "New@Contoso.com"}},
	}
	for _, tc := range cases {
		state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, tc.provider)
		st, ok := svc.openOAuthState(state)
		if !ok || st.Verifier == "" {
			t.Fatalf("%s: start must seal a PKCE verifier", tc.provider)
		}
		tokens.answer(emailHubTokenReply(tc.claims))

		if got := svc.CompleteOAuth(ctx, tc.provider, state, "code-"+tc.provider, "", nonce); got != EmailHubOAuthConnected {
			t.Fatalf("%s: got %q, want connected", tc.provider, got)
		}
		_, form := tokens.seen()
		if form.Get("grant_type") != "authorization_code" || form.Get("code") != "code-"+tc.provider || form.Get("code_verifier") != st.Verifier {
			t.Fatalf("%s: token request %v, want the code and the state's verifier", tc.provider, form)
		}
		preset, _ := emailhub.Preset(tc.preset)
		wantIMAP := imapclient.Credentials{Host: preset.IMAPHost, Port: preset.IMAPPort, Email: tc.email, Security: "tls", AccessToken: "access-1"}
		wantSMTP := smtpclient.Credentials{Host: preset.SMTPHost, Port: preset.SMTPPort, Email: tc.email, Security: "starttls", AccessToken: "access-1"}
		if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
			t.Fatalf("%s: verify got imap=%+v smtp=%+v", tc.provider, gotIMAP, gotSMTP)
		}
		row, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
			OrganizationID: ws.OrganizationID, UserID: user.ID, Email: tc.email,
		})
		if err != nil {
			t.Fatal(err)
		}
		if row.AuthKind != tc.authKind || row.Provider != preset.Name || row.PasswordEnc != "" || row.Username != "" || row.AuthFailedAt.Valid {
			t.Fatalf("%s: row auth_kind=%q provider=%q password_enc=%q username=%q", tc.provider, row.AuthKind, row.Provider, row.PasswordEnc, row.Username)
		}
		if rt, err := svc.openPassword(row.OauthRefreshTokenEnc); err != nil || rt != "refresh-1" {
			t.Fatalf("%s: sealed refresh token=%q err=%v", tc.provider, rt, err)
		}
		if at, err := svc.openPassword(row.OauthAccessTokenEnc); err != nil || at != "access-1" {
			t.Fatalf("%s: sealed access token=%q err=%v", tc.provider, at, err)
		}
		if exp := row.OauthAccessExpiresAt; !exp.Valid || exp.Time.Before(time.Now().Add(50*time.Minute)) {
			t.Fatalf("%s: oauth_access_expires_at=%+v, want about an hour ahead", tc.provider, exp)
		}
		if n, kind, reconnected := connectedAudit(t, pool, row.ID); n != 1 || kind != "human" || reconnected != "false" {
			t.Fatalf("%s: connected audit n=%d kind=%q reconnected=%q", tc.provider, n, kind, reconnected)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2
			AND actor_id = $3 AND metadata::jsonb->>'auth_kind' = $4`,
			audit.ActionEmailHubAccountConnected, row.ID, user.ID, tc.authKind); n != 1 {
			t.Fatalf("%s: the connected audit must name the user and auth_kind %s", tc.provider, tc.authKind)
		}
	}
}

// Each of these is known from the token response alone, so no login is tried
// and no row written. An old refresh token is never reused (spec §5.4 step 8).
func TestEmailHubCompleteOAuthRefusesBeforeVerify(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	tokens := fakeEmailHubOAuthCallback(t, svc)
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	noRefresh := emailHubTokenReply(googleIDClaims("me@gmail.com"))
	delete(noRefresh, "refresh_token")
	noIDToken := emailHubTokenReply(nil)
	delete(noIDToken, "id_token")
	cases := []struct {
		name  string
		reply map[string]any
		want  string
	}{
		{"no refresh token", noRefresh, EmailHubOAuthConsentRequired},
		{"unverified google address", emailHubTokenReply(map[string]any{"email": "me@gmail.com", "email_verified": false}), EmailHubOAuthEmailUnavailable},
		{"no id_token", noIDToken, EmailHubOAuthEmailUnavailable},
		{"replayed code", nil, EmailHubOAuthFailed},
	}
	for _, tc := range cases {
		tokens.answer(tc.reply)
		if got := svc.CompleteOAuth(context.Background(), "google", state, "code-1", "", nonce); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("no login may be tried, verify ran %d times", n)
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 0 {
		t.Fatalf("no row may be written, got %d", n)
	}
}

// A brand-new token refused at AUTHENTICATE means IMAP is off for the
// mailbox; the log carries codes, never the address or a token (spec §5.4 step 7, §7).
func TestEmailHubCompleteOAuthVerifyFailures(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"imap bare NO", fmt.Errorf("imap: %w", imapclient.ErrLoginRefused), EmailHubOAuthIMAPNotEnabled},
		{"imap AUTHENTICATIONFAILED", fmt.Errorf("imap: %w", imapclient.ErrAuthFailed), EmailHubOAuthIMAPNotEnabled},
		{"smtp auth disabled", fmt.Errorf("smtp: %w", smtpclient.ErrSMTPAuthDisabled), EmailHubOAuthSMTPDisabled},
		{"smtp refused", fmt.Errorf("smtp: %w", smtpclient.ErrAuthFailed), EmailHubOAuthFailed},
		{"unreachable", fmt.Errorf("dial: %w", &net.DNSError{Err: "no such host", Name: "imap.gmail.com", IsNotFound: true}), EmailHubOAuthFailed},
	}
	for _, tc := range cases {
		stubEmailHubDial(svc, tc.err)
		if got := svc.CompleteOAuth(context.Background(), "google", state, "code-1", "", nonce); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 0 {
		t.Fatalf("a failed login must write no row, got %d", n)
	}
	out := logs.String()
	for _, secret := range []string{"me@gmail.com", "access-1", "refresh-1", nonce} {
		if strings.Contains(out, secret) {
			t.Fatalf("the log carries %q:\n%s", secret, out)
		}
	}
	if !strings.Contains(out, "code=imap_not_enabled") || !strings.Contains(out, "reason=unreachable") {
		t.Fatalf("the log must carry the result and the classified reason:\n%s", out)
	}
}

// Membership is decided again with the state's user, before the code is
// spent: a member deactivated since the start, or a state whose organization
// is not the workspace's, gets failed and no row (spec §5.4 step 6).
func TestEmailHubCompleteOAuthNonMember(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("me@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	st, _ := svc.openOAuthState(state)
	otherOrg := st
	otherOrg.OrganizationID = util.NewID()
	if got := svc.CompleteOAuth(ctx, "google", sealEmailHubTestOAuthState(t, svc, otherOrg), "code-1", "", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("organization mismatch: got %q, want failed", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, ws.OrganizationID, user.ID); err != nil {
		t.Fatal(err)
	}
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthFailed {
		t.Fatalf("deactivated member: got %q, want failed", got)
	}
	if n, _ := tokens.seen(); n != 0 {
		t.Fatalf("membership is checked before the exchange, token endpoint called %d times", n)
	}
	if calls.Load() != 0 || emailHubCount(t, pool, emailHubAccountsOf, user.ID) != 0 {
		t.Fatal("a non-member must neither dial nor write a row")
	}
}

// App Password → OAuth keeps the id and the cache, live or awaiting a
// reconnect (spec Q6, §3).
func TestEmailHubCompleteOAuthUpgradesPasswordInPlace(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	tokens := fakeEmailHubOAuthCallback(t, svc)
	stubEmailHubDial(svc, nil)
	for _, needsReconnect := range []bool{false, true} {
		email := fmt.Sprintf("up-%v@gmail.com", needsReconnect)
		acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, email)
		seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
		if needsReconnect {
			acc = markSeedAccountAuthFailed(t, q, acc)
		}
		state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
		tokens.answer(emailHubTokenReply(googleIDClaims(strings.ToUpper(email))))

		if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
			t.Fatalf("%s: got %q, want connected", email, got)
		}
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.AuthKind != "oauth_google" || row.PasswordEnc != "" || row.OauthRefreshTokenEnc == "" ||
			row.AuthFailedAt.Valid || row.AuthFailedReason != "" || row.DisconnectedAt.Valid {
			t.Fatalf("%s: row auth_kind=%q password_enc=%q auth_failed=%v", email, row.AuthKind, row.PasswordEnc, row.AuthFailedAt.Valid)
		}
		if row.CredentialVersion <= acc.CredentialVersion {
			t.Fatalf("%s: credential_version must move past %d, got %d", email, acc.CredentialVersion, row.CredentialVersion)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
			t.Fatalf("%s: the cache must survive an upgrade on the same server, threads=%d", email, n)
		}
		if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1 AND lower(email_address) = $2`, user.ID, email); n != 1 {
			t.Fatalf("%s: an upgrade must keep one row, got %d", email, n)
		}
		if n, _, reconnected := connectedAudit(t, pool, acc.ID); n != 1 || reconnected != "true" || connectedServerChanged(t, pool, acc.ID) != "false" {
			t.Fatalf("%s: connected audit n=%d reconnected=%q", email, n, reconnected)
		}
	}
}

// A live OAuth row of the same provider is a duplicate, answered before any
// login is tried (spec §3).
func TestEmailHubCompleteOAuthAlreadyConnected(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	prov, _ := emailhub.Preset("gmail")
	if _, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: user.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: "dup@gmail.com", Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
		AuthKind: "oauth_google", OauthRefreshTokenEnc: "sealed-refresh", OauthAccessTokenEnc: "sealed-access",
	}); err != nil {
		t.Fatal(err)
	}
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("DUP@gmail.com")))
	calls := stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")

	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthAlreadyConnected {
		t.Fatalf("got %q, want already_connected", got)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
	if n := emailHubCount(t, pool, emailHubAccountsOf, user.ID); n != 1 {
		t.Fatalf("a duplicate must write nothing, rows=%d", n)
	}
}

// A refusal seen with the password from before the OAuth reconnect matches
// no row: the new credential stays and nothing is audited (spec §8 Race).
func TestEmailHubCompleteOAuthOldVersionMarkIsNoop(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "fence@gmail.com")
	tokens := fakeEmailHubOAuthCallback(t, svc)
	tokens.answer(emailHubTokenReply(googleIDClaims("fence@gmail.com")))
	stubEmailHubDial(svc, nil)
	state, nonce := startEmailHubTestOAuth(t, svc, user.ID, ws.ID, "google")
	if got := svc.CompleteOAuth(ctx, "google", state, "code-1", "", nonce); got != EmailHubOAuthConnected {
		t.Fatalf("got %q, want connected", got)
	}

	if svc.markAuthFailed(ctx, acc, acc.CredentialVersion, "imap_auth_failed") {
		t.Fatal("a mark with the pre-reconnect version must match nothing")
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.AuthKind != "oauth_google" || row.OauthRefreshTokenEnc == "" {
		t.Fatalf("the OAuth credential must stay: auth_failed=%v auth_kind=%q", row.AuthFailedAt.Valid, row.AuthKind)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 0 {
		t.Fatalf("a stale mark must not audit, got %d rows", n)
	}
}
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubCompleteOAuth|TestEmailHubIDTokenEmail'
```

Expected: FAIL, the package does not build: `undefined: emailHubIDTokenEmail`, `svc.CompleteOAuth undefined`, `undefined: EmailHubOAuthConnected`, `unknown field OauthRefreshTokenEnc in struct literal of type db.CreateEmailHubAccountParams`.

- [ ] **Step 3: Implement**

3a. In `server/pkg/db/queries/email_hub.sql`, replace `CreateEmailHubAccount` (lines 1-9) with:

```sql
-- name: CreateEmailHubAccount :one
-- A password row passes '' and NULL for the oauth_* columns.
INSERT INTO email_hub_accounts (
  id, user_id, organization_id, email_address, provider,
  imap_host, imap_port, smtp_host, smtp_port, password_enc,
  imap_security, smtp_security, username, auth_kind,
  oauth_refresh_token_enc, oauth_access_token_enc, oauth_access_expires_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
)
RETURNING *;
```

In `UpdateEmailHubAccountCredentials`, replace the header comment (:76-79):

```sql
-- name: UpdateEmailHubAccountCredentials :one
-- Reconnect keeps the id. UIDs from another IMAP server mean nothing, so
-- sync_state resets when host or port change. The version bump fences writes
-- from older snapshots. SET expressions read the old row; RETURNING gives the
-- new one (the caller holds the old one from its FOR UPDATE read). A password
-- credential passes '' and NULL for the oauth_* columns.
```

and the three `oauth_*` lines (:91-93):

```sql
    oauth_refresh_token_enc = sqlc.arg('oauth_refresh_token_enc'),
    oauth_access_token_enc = sqlc.arg('oauth_access_token_enc'),
    oauth_access_expires_at = sqlc.narg('oauth_access_expires_at'),
```

Regenerate:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && make sqlc && git status --short server/pkg/db
```

Expected: only `email_hub.sql` and `server/pkg/db/generated/email_hub.sql.go` change; both params structs gain the three fields listed under Interfaces.

3b. In `server/internal/service/email_hub_connect_server.go`, replace the preset `return emailHubServer{...}, nil` inside `resolveEmailHubServer` (the `prov, ok := emailhub.ProviderForEmail(email)` branch) with `return presetEmailHubServer(prov), nil`, and add below `resolveEmailHubServer`:

```go
// presetEmailHubServer is a provider preset as the server a connect stores:
// implicit TLS for IMAP, STARTTLS for SMTP, the address as the login.
func presetEmailHubServer(prov emailhub.Provider) emailHubServer {
	return emailHubServer{
		Provider: prov.Name, IMAPHost: prov.IMAPHost, IMAPPort: prov.IMAPPort, IMAPSecurity: "tls",
		SMTPHost: prov.SMTPHost, SMTPPort: prov.SMTPPort, SMTPSecurity: "starttls",
	}
}
```

3c. In `server/internal/service/email_hub_connect.go`:
- Remove `"encoding/base64"` from the imports; add `"github.com/jackc/pgx/v5/pgtype"` beside the other pgx imports.
- Replace everything in `Connect` from `sealed, err := s.box.Seal([]byte(password))` (:94) through the `testHookInitialSync`/`syncAccount` block (:110) with:

```go
	passwordEnc, err := s.sealSecret(password)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	row, _, serverChanged, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv,
		emailHubSealedCredential{AuthKind: "password", PasswordEnc: passwordEnc})
	if err != nil {
		return EmailHubAccountView{}, err
	}
	s.afterEmailHubConnect(ctx, row, serverChanged)
```

The `updated, err := s.q.GetEmailHubAccount(...)` tail stays as it is.

Add after `Connect`:

```go
// afterEmailHubConnect is the post-commit tail every connect shares (spec
// §5.2 step 6): drop the old server's cache, restart the refused-LOGIN run,
// then the first sync. The row already committed, so failures are logged.
func (s *EmailHubService) afterEmailHubConnect(ctx context.Context, row db.EmailHubAccount, serverChanged bool) {
	if serverChanged {
		s.resetEmailHubServerCache(ctx, row)
	}
	s.gov.loginSucceeded(row.ID) // a reconnect starts a fresh run of refused LOGINs
	if s.testHookInitialSync != nil {
		s.testHookInitialSync(ctx, row)
	} else if _, _, syncErr := s.syncAccount(ctx, row, false, true); syncErr != nil {
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "code", emailHubErrCode(syncErr))
	}
}
```

Replace `saveEmailHubConnection` (doc comment and body, :148-214) with:

```go
// emailHubSealedCredential is a verified credential, already sealed, as one
// connect stores it: a password (PasswordEnc), or OAuth tokens with
// PasswordEnc empty. Unused fields stay '' and NULL.
type emailHubSealedCredential struct {
	AuthKind        string
	PasswordEnc     string
	RefreshEnc      string
	AccessEnc       string
	AccessExpiresAt pgtype.Timestamptz
}

// saveEmailHubConnection writes a verified credential and the connected audit
// row in one transaction. It re-reads the address FOR UPDATE, because a racing
// request may have connected or disconnected the mailbox since the pre-dial
// check: a live row found there stays locked until commit, so it is updated in
// place (keeping its id; the credential_version bump makes a markAuthFailed
// with the old version match nothing); no live row means a fresh insert, and a
// concurrent insert of the same address loses on the unique index.
// serverChanged reports that the kept row moved to another IMAP server, whose
// UIDs make the cached mail meaningless (spec §3). prev is the row as it was
// before the update (zero on insert): the credential this connect replaced.
func (s *EmailHubService) saveEmailHubConnection(
	ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams,
	srv emailHubServer, cred emailHubSealedCredential,
) (row db.EmailHubAccount, prev db.EmailHubAccount, serverChanged bool, err error) {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return row, prev, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	existing, err := qtx.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return row, prev, false, err
	}
	reconnected := err == nil
	serverChanged = reconnected &&
		(!strings.EqualFold(existing.ImapHost, srv.IMAPHost) || int(existing.ImapPort) != srv.IMAPPort)
	switch {
	case reconnected && sameEmailHubConnection(existing, cred.AuthKind, srv.IMAPHost, srv.IMAPPort):
		return row, prev, false, ErrEmailHubAlreadyConnected
	case reconnected:
		row, err = qtx.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: existing.ID, OrganizationID: byAddress.OrganizationID, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: cred.AuthKind, PasswordEnc: cred.PasswordEnc,
			OauthRefreshTokenEnc: cred.RefreshEnc, OauthAccessTokenEnc: cred.AccessEnc,
			OauthAccessExpiresAt: cred.AccessExpiresAt,
		})
	default:
		row, err = qtx.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: byAddress.UserID, OrganizationID: byAddress.OrganizationID,
			EmailAddress: byAddress.Email, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: cred.AuthKind, PasswordEnc: cred.PasswordEnc,
			OauthRefreshTokenEnc: cred.RefreshEnc, OauthAccessTokenEnc: cred.AccessEnc,
			OauthAccessExpiresAt: cred.AccessExpiresAt,
		})
		if isUniqueViolation(err) {
			return db.EmailHubAccount{}, prev, false, ErrEmailHubAlreadyConnected // a concurrent connect inserted first
		}
	}
	if err != nil {
		return db.EmailHubAccount{}, prev, false, err
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
		return db.EmailHubAccount{}, prev, false, err
	}
	if reconnected {
		prev = existing
	}
	return row, prev, serverChanged, tx.Commit(ctx)
}
```

3d. Create `server/internal/service/email_hub_oauth_callback.go`:

```go
package service

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	netmail "net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Result codes of the OAuth callback (spec §5.4). The popup page posts one to
// the opener and the dialog maps it to copy; nothing else leaves the service.
const (
	EmailHubOAuthConnected        = "connected"
	EmailHubOAuthDenied           = "denied"
	EmailHubOAuthStateInvalid     = "state_invalid"
	EmailHubOAuthEmailUnavailable = "email_unavailable"
	EmailHubOAuthIMAPNotEnabled   = "imap_not_enabled"
	EmailHubOAuthSMTPDisabled     = "smtp_disabled"
	EmailHubOAuthAlreadyConnected = "already_connected"
	EmailHubOAuthConsentRequired  = "consent_required"
	EmailHubOAuthFailed           = "failed"
)

const emailHubOAuthExchangeTimeout = 10 * time.Second

// CompleteOAuth finishes a provider sign-in and connects the mailbox it
// proves, or reconnects the live row of that address on the same id (spec
// §3, §5.4). The state is the only source of user, workspace and PKCE
// verifier; the cookie nonce binds it to the browser that started. The
// address is whatever the id_token and the XOAUTH2 login prove, which may not
// be the login_hint of a reconnect. Every refusal writes nothing and logs
// codes only.
func (s *EmailHubService) CompleteOAuth(ctx context.Context, provider, rawState, code, providerError, cookieNonce string) string {
	// The code is single-use: once spent, finish the connect even if the popup closes.
	ctx = context.WithoutCancel(ctx)
	userID := ""
	fail := func(result, reason string) string {
		s.log.Warn("email hub oauth callback failed",
			"code", result, "reason", reason, "provider", provider, "user_id", userID)
		return result
	}
	if !s.Enabled() {
		return fail(EmailHubOAuthFailed, "not_configured")
	}
	st, ok := s.openOAuthState(rawState)
	if !ok || st.Provider != provider || time.Now().Unix() > st.Exp {
		return fail(EmailHubOAuthStateInvalid, "state")
	}
	// An empty cookie never matches, even a state sealed with an empty nonce.
	if cookieNonce == "" || subtle.ConstantTimeCompare([]byte(cookieNonce), []byte(st.Nonce)) != 1 {
		return fail(EmailHubOAuthStateInvalid, "nonce")
	}
	userID = st.UserID
	switch {
	case providerError == "access_denied":
		return fail(EmailHubOAuthDenied, "access_denied")
	case providerError != "":
		return fail(EmailHubOAuthFailed, "provider_error")
	}
	// Membership first: a member deactivated since the start never spends the code.
	actor := Human(st.UserID)
	ws, err := s.workspace(ctx, actor, st.WorkspaceID)
	if err != nil || ws.OrganizationID != st.OrganizationID {
		return fail(EmailHubOAuthFailed, "membership")
	}
	p, ok := s.oauthProvider(provider)
	if !ok {
		return fail(EmailHubOAuthFailed, "provider_disabled")
	}
	exchangeCtx, cancel := context.WithTimeout(ctx, emailHubOAuthExchangeTimeout)
	defer cancel()
	tok, err := p.config.Exchange(s.oauthCtx(exchangeCtx), code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		reason := "exchange"
		var re *oauth2.RetrieveError
		if errors.As(err, &re) {
			// Only RFC 6749 codes reach the log; the provider controls this field.
			switch re.ErrorCode {
			case "invalid_grant", "invalid_client", "invalid_request", "unauthorized_client", "unsupported_grant_type":
				reason = "exchange_" + re.ErrorCode
			}
		}
		return fail(EmailHubOAuthFailed, reason)
	}
	// Without a refresh token the grant dies within the hour; an old one is
	// never reused (spec §5.4 step 8).
	if tok.RefreshToken == "" {
		return fail(EmailHubOAuthConsentRequired, "no_refresh_token")
	}
	idToken, _ := tok.Extra("id_token").(string)
	email, ok := emailHubIDTokenEmail(provider, idToken)
	if !ok {
		return fail(EmailHubOAuthEmailUnavailable, "id_token")
	}
	srv := presetEmailHubServer(p.preset)
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: st.UserID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, p.authKind, srv.IMAPHost, srv.IMAPPort):
		return fail(EmailHubOAuthAlreadyConnected, "duplicate")
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return fail(EmailHubOAuthFailed, emailHubErrCode(err))
	}
	imapCreds := imapclient.Credentials{
		Host: srv.IMAPHost, Port: srv.IMAPPort, Email: email, Security: srv.IMAPSecurity, AccessToken: tok.AccessToken,
	}
	smtpCreds := smtpclient.Credentials{
		Host: srv.SMTPHost, Port: srv.SMTPPort, Email: email, Security: srv.SMTPSecurity, AccessToken: tok.AccessToken,
	}
	// Never skippable: the XOAUTH2 login is the only proof the address is the
	// user's (Microsoft's email claim is admin-editable).
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		result := EmailHubOAuthFailed
		switch {
		// A brand-new token refused at AUTHENTICATE means IMAP is off for the
		// mailbox (M365 answers a bare NO), not a wrong credential.
		case errors.Is(err, imapclient.ErrAuthFailed), errors.Is(err, imapclient.ErrLoginRefused):
			result = EmailHubOAuthIMAPNotEnabled
		case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
			result = EmailHubOAuthSMTPDisabled
		}
		return fail(result, emailHubErrCode(err))
	}
	cred := emailHubSealedCredential{
		AuthKind:        p.authKind,
		AccessExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()},
	}
	if cred.RefreshEnc, err = s.sealSecret(tok.RefreshToken); err != nil {
		return fail(EmailHubOAuthFailed, "seal")
	}
	if cred.AccessEnc, err = s.sealSecret(tok.AccessToken); err != nil {
		return fail(EmailHubOAuthFailed, "seal")
	}
	row, _, serverChanged, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, cred)
	switch {
	case errors.Is(err, ErrEmailHubAlreadyConnected):
		return fail(EmailHubOAuthAlreadyConnected, "duplicate") // a concurrent connect won
	case err != nil:
		return fail(EmailHubOAuthFailed, emailHubErrCode(err))
	}
	s.afterEmailHubConnect(ctx, row, serverChanged)
	return EmailHubOAuthConnected
}

// emailHubIDTokenEmail reads the mailbox address from an id_token that came
// straight from the provider's token endpoint over TLS, so its signature is
// not checked again (OIDC Core §3.1.3.7). Google: email, only when
// email_verified is true. Microsoft: email, else preferred_username (the UPN,
// which may not be the primary SMTP address; the XOAUTH2 login decides). The
// result is lowercased and must be a bare address.
func emailHubIDTokenEmail(provider, idToken string) (string, bool) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	var claims struct {
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		PreferredUsername string `json:"preferred_username"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return "", false
	}
	var email string
	switch provider {
	case "google":
		if claims.EmailVerified {
			email = claims.Email
		}
	case "microsoft":
		email = claims.Email
		if strings.TrimSpace(email) == "" {
			email = claims.PreferredUsername
		}
	default:
		return "", false
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if a, err := netmail.ParseAddress(email); err != nil || a.Address != email || strings.ContainsAny(email, "\r\n") {
		return "", false
	}
	return email, true
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l internal/service pkg/db && go vet ./internal/service/ ./internal/handler/ && go tool staticcheck ./internal/service/
```

Expected: no output. `go vet` builds the handler test fixtures that use `CreateEmailHubAccountParams`.

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubConnect|TestEmailHubReconnect|TestEmailHubConcurrentConnectsLeaveOneAccount|TestEmailHubCompleteOAuth|TestEmailHubIDTokenEmail|TestEmailHubAccountCredentialQueries|TestUpdateEmailHubAccountSyncState|TestEmailHubStaleCredentialVersion|TestEveryAuditedCommandWritesItsRow'
```

Expected: PASS. New: `TestEmailHubIDTokenEmail` plus 9 `TestEmailHubCompleteOAuth*`. The GD1/GD2 Connect, reconnect, server-change, query and audit-coverage tests stay green.

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test -count=1 ./migrations/ -run 'TestEveryQueryNamesItsTenant|TestTenantReasonsSitOnTenantQueries'
```

Expected: PASS; both changed queries still constrain `organization_id`.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/pkg/db/queries/email_hub.sql server/pkg/db/generated/email_hub.sql.go server/internal/service/email_hub_connect.go server/internal/service/email_hub_connect_server.go server/internal/service/email_hub_oauth_callback.go server/internal/service/email_hub_oauth_callback_test.go && git commit -F - <<'EOF'
feat(email-hub): complete the OAuth callback and connect the mailbox it proves

A Google or Microsoft sign-in must end in the same row a password connect
makes: same duplicate check, same FOR UPDATE save, same audit, and a
reconnect of the same address keeps its id and cache, App Password to
OAuth included (spec Q6, §5.4).

CompleteOAuth opens the sealed state, compares the cookie nonce in
constant time, checks membership with the state's user before the code is
spent, exchanges with the state's PKCE verifier, and requires a refresh
token, never reusing an old one. It reads the address from the id_token
(verified Google email; Microsoft email, else the UPN) and proves it with
an XOAUTH2 IMAP and SMTP login on the preset. A refused IMAP login with a
new token means IMAP is off for the mailbox. Each outcome is one result
code, and the log carries the code, a fixed reason, provider and user_id.
Once the code is spent the connect runs on a context the closing popup
cannot cancel.

saveEmailHubConnection now stores a sealed credential of any auth kind,
and the create/update queries take the oauth_* columns. It also returns
the replaced row so the revoke can follow. The post-commit tail moved to
afterEmailHubConnect, shared with Connect.

Left out: the callback route and HTML page (next task), revoking the
replaced refresh token (prev is returned but unused until Task 7), and an
account_mismatch code for a reconnect that picks another account.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 6: OAuth callback HTTP: route outside authed, HTML postMessage page with hashed CSP

**Files:**
- Modify: `server/internal/handler/email_hub_oauth.go` (Tasks 1/4): append `emailHubOAuthScript`, `emailHubOAuthCSP`, `completeEmailHubOAuth` and `writeEmailHubOAuthPage`; add the imports `crypto/sha256`, `encoding/base64`, `encoding/json` and `io`.
- Modify: `server/internal/handler/router/email_hub.go`: append `registerEmailHubCallback` after `registerEmailHub`.
- Modify: `server/internal/handler/router/router.go`: call it on the line after `registerAuth(v1, h, credentialLimit)` (line 111).
- Modify: `server/internal/handler/router/routes.go`: field `CompleteEmailHubOAuth` after `UnsubscribeEmailHubInboxWatch` (line 198).
- Modify: `server/internal/handler/router.go` (`handler.New`): map it after `UnsubscribeEmailHubInboxWatch: h.unsubscribeEmailHubInboxWatch,` (line 300).
- Modify: `server/internal/handler/isolation_routes_test.go`: add the callback to the "Provider callbacks" block (lines 193-197); it is the longest key, so gofmt realigns the block.
- Test: `server/internal/handler/email_hub_oauth_test.go` (append)
- Test: `server/internal/handler/router/email_hub_ratelimit_test.go` (append)

`server/internal/handler/email_hub_test.go` is not touched: the variadic `setupEmailHubHTTP(t, configure ...func(*Deps))` from Task 4 builds the server with an OAuth client.

**Interfaces:**
- Consumes:
  - Task 5: `CompleteOAuth(ctx, provider, rawState, code, providerError, cookieNonce) string` and the exported constants `service.EmailHubOAuthConnected` / `service.EmailHubOAuthFailed`.
  - Task 4: `emailHubOAuthCookie`, `emailHubOAuthCookiePath`, the start route, `setupEmailHubHTTP(t, configure ...func(*Deps))`.
  - Task 1: `ConfigureOAuth`, `config.Config{EmailHubGoogleClientID, EmailHubGoogleClientSecret, APIPublicURL}`.
  - Existing: `(*service.EmailHubService).Enabled()` (service/email_hub.go:72), `h.Cfg.FrontendOrigin` / `h.Cfg.SecureCookies`, `credentialLimit` (router/router.go:83, 60/min per path and address), the `pathParamSDI` case `"provider"` (openapi.go:130), `apiOp.produces` (openapi.go:30).
  - Test helpers: `doJSON`, `readAll` (onboarding_test.go:32), `cookieNamed` (google_test.go:38), `limitedMux` / `caller`.
- Produces:
  - `func registerEmailHubCallback(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler)`: `GET /api/v1/email-hub-connections/{provider}/callback`, no auth, `credentialLimit`, `produces: "text/html"`, no SDI.
  - `Routes.CompleteEmailHubOAuth http.HandlerFunc`, mapped to `h.completeEmailHubOAuth`.
  - handler `const emailHubOAuthScript` and `var emailHubOAuthCSP string` = `default-src 'none'; script-src 'sha256-<b64 sha256 of the script>'; frame-ancestors 'none'; base-uri 'none'`, computed once.
  - `func writeEmailHubOAuthPage(w http.ResponseWriter, origin, code string)`: 200, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`, `Content-Security-Policy: emailHubOAuthCSP` (replaces the API default); a non-executing JSON data block `{"origin","ok","code"}` (`json.Marshal` escapes `<`, `>`, `&`).
  - Message contract for Tasks 9-10: `window.opener?.postMessage({type: "uniwork:email-hub-oauth", ok: boolean, code: string}, FRONTEND_ORIGIN)`, then `window.close()`.
  - Handler order: read the cookie, clear it, call `CompleteOAuth` only when `h.EmailHub != nil && h.EmailHub.Enabled()` (else `failed`), render.

- [ ] **Step 1: Write the failing tests**

1a. Append to `server/internal/handler/router/email_hub_ratelimit_test.go`:

```go
// The OAuth callback carries no session (the provider redirects the popup to
// it), so it sits on the 60/min per-address credential budget, like
// /auth/google/callback, and is not behind RequireAuth.
func TestEmailHubOAuthCallbackIsOnTheCredentialBudget(t *testing.T) {
	h, _ := limitedMux(t)
	const path = "/api/v1/email-hub-connections/google/callback"
	anonymous := caller{ip: "10.20.0.31"}
	anonymous.spend(t, h, http.MethodGet, path, 60)
	anonymous.wantRefused(t, h, http.MethodGet, path, "60 callbacks per minute per address")
}
```

1b. Append to `server/internal/handler/email_hub_oauth_test.go`, adding `crypto/sha256`, `log/slog` and `regexp` to its imports (the rest are there from Tasks 1 and 4):

```go
var (
	emailHubOAuthDataRE   = regexp.MustCompile(`<script type="application/json" id="r">([^<]*)</script>`)
	emailHubOAuthInlineRE = regexp.MustCompile(`<script>([^<]*)</script>`)
)

// emailHubOAuthPageData is the data block the callback page's script reads.
type emailHubOAuthPageData struct {
	Origin string `json:"origin"`
	OK     bool   `json:"ok"`
	Code   string `json:"code"`
}

func readEmailHubOAuthPage(t *testing.T, body string) emailHubOAuthPageData {
	t.Helper()
	m := emailHubOAuthDataRE.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("no data block in %q", body)
	}
	var d emailHubOAuthPageData
	if err := json.Unmarshal([]byte(m[1]), &d); err != nil {
		t.Fatalf("data block %q: %v", m[1], err)
	}
	return d
}

func wantEmailHubOAuthCookieCleared(t *testing.T, name string, cookies []*http.Cookie) {
	t.Helper()
	for _, c := range cookies {
		if c.Name == emailHubOAuthCookie {
			if c.MaxAge >= 0 || c.Value != "" || c.Path != emailHubOAuthCookiePath || !c.HttpOnly {
				t.Errorf("%s: nonce cookie not cleared on its path: %+v", name, c)
			}
			return
		}
	}
	t.Errorf("%s: no Set-Cookie clearing %s", name, emailHubOAuthCookie)
}

// The provider redirects the popup here with no Authorization header: the
// route must answer its page, not 401 (spec §5.1). Without an Email Hub key
// the same page answers failed, and the OpenAPI entry asks for no bearer.
func TestEmailHubOAuthCallbackIsNotBehindAuth(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}, Log: slog.Default()})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/email-hub-connections/google/callback?state=s&code=c", nil)
	req.AddCookie(&http.Cookie{Name: emailHubOAuthCookie, Value: "nonce"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("callback without a session = %d %q, want 200 text/html", rec.Code, rec.Header().Get("Content-Type"))
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != emailHubOAuthCSP {
		t.Fatalf("the page's policy must replace the API default, got %q", got)
	}
	if d := readEmailHubOAuthPage(t, rec.Body.String()); d.Code != "failed" || d.OK || d.Origin != "http://localhost:3000" {
		t.Fatalf("Email Hub off must answer failed, got %+v", d)
	}
	wantEmailHubOAuthCookieCleared(t, "email hub off", rec.Result().Cookies())

	doc := httptest.NewRecorder()
	h.ServeHTTP(doc, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get *struct {
				Security  []map[string][]string `json:"security"`
				Responses map[string]struct {
					Content map[string]json.RawMessage `json:"content"`
				} `json:"responses"`
			} `json:"get"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(doc.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	op := spec.Paths["/api/v1/email-hub-connections/{provider}/callback"].Get
	if op == nil || len(op.Security) != 0 || op.Responses["200"].Content["text/html"] == nil {
		t.Fatalf("OpenAPI callback entry = %+v, want a GET with no security answering text/html", op)
	}
}

// Every branch clears the nonce cookie on its scoped path, before the service
// runs: a missing cookie, a tampered state, and the user declining consent
// (spec §5.4 step 2). The state and cookie come from a real start.
func TestEmailHubOAuthCallbackClearsCookieOnEveryBranch(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t, func(d *Deps) {
		d.EmailHub.ConfigureOAuth(config.Config{
			APIPublicURL:               "http://localhost:8080",
			EmailHubGoogleClientID:     "email-hub-test-client",
			EmailHubGoogleClientSecret: "email-hub-test-secret",
		})
	})
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/oauth/google/start", token, map[string]string{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("start: %d %v", res.StatusCode, out)
	}
	rawURL, _ := out["authorization_url"].(string)
	authURL, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	state := authURL.Query().Get("state")
	nonce := cookieNamed(res, emailHubOAuthCookie)
	if state == "" || nonce == nil || nonce.Value == "" ||
		!strings.HasPrefix("/api/v1/email-hub-connections/google/callback", nonce.Path) {
		t.Fatalf("start must hand out a state and a nonce cookie the callback receives: state=%q cookie=%+v", state, nonce)
	}
	sent := &http.Cookie{Name: emailHubOAuthCookie, Value: nonce.Value}

	cases := []struct {
		name   string
		query  string
		cookie *http.Cookie
		code   string
	}{
		{"no cookie", "state=" + url.QueryEscape(state) + "&error=access_denied", nil, "state_invalid"},
		{"tampered state", "state=" + url.QueryEscape(state+"x") + "&code=c", sent, "state_invalid"},
		{"access denied", "state=" + url.QueryEscape(state) + "&error=access_denied", sent, "denied"},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/email-hub-connections/google/callback?"+tc.query, nil)
		if tc.cookie != nil {
			req.AddCookie(tc.cookie)
		}
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := readAll(res)
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: status %d, want 200", tc.name, res.StatusCode)
		}
		if d := readEmailHubOAuthPage(t, string(body)); d.Code != tc.code || d.OK {
			t.Errorf("%s: page %+v, want code %s", tc.name, d, tc.code)
		}
		wantEmailHubOAuthCookieCleared(t, tc.name, res.Cookies())
	}
}

// One constant script, so one hash for every result and no 'unsafe-inline';
// FRONTEND_ORIGIN and the code ride in a data block no value can close
// (spec §5.4).
func TestEmailHubOAuthCallbackPage(t *testing.T) {
	if !strings.Contains(emailHubOAuthScript, `type:"uniwork:email-hub-oauth"`) {
		t.Fatalf("the script must post the message type the client listens for: %s", emailHubOAuthScript)
	}
	for _, code := range []string{"connected", "state_invalid", "denied", "failed"} {
		rec := httptest.NewRecorder()
		writeEmailHubOAuthPage(rec, "http://localhost:3000", code)
		body := rec.Body.String()
		m := emailHubOAuthInlineRE.FindStringSubmatch(body)
		if m == nil || m[1] != emailHubOAuthScript || strings.Count(body, "<script") != 2 {
			t.Fatalf("%s: the page must run exactly the constant script: %q", code, body)
		}
		sum := sha256.Sum256([]byte(m[1]))
		want := "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
			"'; frame-ancestors 'none'; base-uri 'none'"
		if got := rec.Header().Get("Content-Security-Policy"); got != want || got != emailHubOAuthCSP || strings.Contains(got, "unsafe-inline") {
			t.Errorf("%s: CSP %q, want %q", code, got, want)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control %q, want no-store", code, got)
		}
		if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
			t.Errorf("%s: Content-Type %q", code, got)
		}
		if d := readEmailHubOAuthPage(t, body); d.Origin != "http://localhost:3000" || d.Code != code || d.OK != (code == "connected") {
			t.Errorf("%s: data block %+v", code, d)
		}
	}

	evil := `https://x.example</script><script>alert(1)</script>`
	rec := httptest.NewRecorder()
	writeEmailHubOAuthPage(rec, evil, "failed")
	body := rec.Body.String()
	if strings.Contains(body, "</script><script>alert") || strings.Count(body, "<script") != 2 {
		t.Fatalf("a crafted FRONTEND_ORIGIN broke out of the data block: %q", body)
	}
	if d := readEmailHubOAuthPage(t, body); d.Origin != evil {
		t.Fatalf("the data block must carry the origin verbatim once decoded, got %q", d.Origin)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/ -run 'TestEmailHubOAuthCallback'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/router/ -run 'TestEmailHubOAuthCallbackIsOnTheCredentialBudget'
```

Expected:
- handler fails to build: `undefined: emailHubOAuthCSP`, `undefined: emailHubOAuthScript`, `undefined: writeEmailHubOAuthPage`, ending in `FAIL github.com/unicomhub/uniwork/server/internal/handler [build failed]`.
- router fails with `GET /api/v1/email-hub-connections/google/callback: status 404, want 429 (60 callbacks per minute per address)`.

- [ ] **Step 3: Implement**

3a. Append to `server/internal/handler/email_hub_oauth.go`:

```go
// emailHubOAuthScript is the only script the callback page runs. It is a
// constant, so its CSP hash is too, whatever the result (spec §5.4); the
// origin and the result ride in the JSON data block it reads.
const emailHubOAuthScript = `const r=JSON.parse(document.getElementById("r").textContent);` +
	`window.opener?.postMessage({type:"uniwork:email-hub-oauth",ok:r.ok,code:r.code},r.origin);` +
	`window.close();`

// emailHubOAuthCSP allows that one script by hash and nothing else; it
// replaces the API default, so it restates frame-ancestors and base-uri,
// which default-src does not cover.
var emailHubOAuthCSP = func() string {
	sum := sha256.Sum256([]byte(emailHubOAuthScript))
	return "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
		"'; frame-ancestors 'none'; base-uri 'none'"
}()

// completeEmailHubOAuth is the provider's redirect target, outside the authed
// group: the sealed state names the member and the nonce cookie ties the flow
// to the browser that started it. It always answers the result page.
func (h *handlers) completeEmailHubOAuth(w http.ResponseWriter, r *http.Request) {
	var nonce string
	if c, err := r.Cookie(emailHubOAuthCookie); err == nil {
		nonce = c.Value
	}
	// Cleared on every branch: one start, one callback.
	http.SetCookie(w, &http.Cookie{
		Name: emailHubOAuthCookie, Value: "", Path: emailHubOAuthCookiePath, MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: h.Cfg.SecureCookies,
	})
	code := service.EmailHubOAuthFailed
	if h.EmailHub != nil && h.EmailHub.Enabled() {
		q := r.URL.Query()
		code = h.EmailHub.CompleteOAuth(r.Context(), chi.URLParam(r, "provider"),
			q.Get("state"), q.Get("code"), q.Get("error"), nonce)
	}
	writeEmailHubOAuthPage(w, h.Cfg.FrontendOrigin, code)
}

// writeEmailHubOAuthPage answers 200 with the postMessage page. json.Marshal
// escapes <, > and &, so no origin or code can close the data block.
func writeEmailHubOAuthPage(w http.ResponseWriter, origin, code string) {
	// Three plain fields: Marshal cannot fail.
	data, _ := json.Marshal(struct {
		Origin string `json:"origin"`
		OK     bool   `json:"ok"`
		Code   string `json:"code"`
	}{Origin: origin, OK: code == service.EmailHubOAuthConnected, Code: code})
	hdr := w.Header()
	hdr.Set("Content-Type", "text/html; charset=utf-8")
	hdr.Set("Cache-Control", "no-store")
	hdr.Set("Content-Security-Policy", emailHubOAuthCSP)
	_, _ = io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><title>UniWork</title></head><body>`+
		`<script type="application/json" id="r">`+string(data)+`</script>`+
		`<script>`+emailHubOAuthScript+`</script></body></html>`)
}
```

3b. Append to `server/internal/handler/router/email_hub.go`:

```go
// registerEmailHubCallback mounts the OAuth redirect target outside the authed
// group: the provider's redirect carries no bearer token. It is registered
// next to registerAuth, on the credential budget, like /auth/google/callback.
//
//	GET /api/v1/email-hub-connections/{provider}/callback  (credential rate limit)
func registerEmailHubCallback(v1 api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	v1.With(credentialLimit).Get("/email-hub-connections/{provider}/callback", h.CompleteEmailHubOAuth, apiOp{
		summary: "Complete Email Hub OAuth",
		description: "Provider redirect target for a mailbox connected with Google or Microsoft sign-in; no session. " +
			"Query: state, code, or error from the provider. Checks the sealed state against the nonce cookie set by " +
			"start, exchanges the code with PKCE, verifies XOAUTH2 IMAP and SMTP and connects or reconnects the mailbox. " +
			"Always answers 200 with a small HTML page that posts {type: \"uniwork:email-hub-oauth\", ok, code} to the " +
			"frontend origin and closes. code is one of connected, denied, state_invalid, email_unavailable, " +
			"imap_not_enabled, smtp_disabled, already_connected, consent_required, failed. 60 requests per minute per address.",
		tags:     []string{"email-hub"},
		produces: "text/html",
	})
}
```

3c. In `server/internal/handler/router/router.go`, after line 111 (`registerAuth(v1, h, credentialLimit)`):

```go
		registerAuth(v1, h, credentialLimit)
		// Outside authed: the provider redirects the popup here with no bearer.
		registerEmailHubCallback(v1, h, credentialLimit)
```

3d. In `server/internal/handler/router/routes.go`, after `UnsubscribeEmailHubInboxWatch http.HandlerFunc` (line 198):

```go
	UnsubscribeEmailHubInboxWatch http.HandlerFunc
	CompleteEmailHubOAuth         http.HandlerFunc
```

3e. In `server/internal/handler/router.go` (`handler.New`), after `UnsubscribeEmailHubInboxWatch: h.unsubscribeEmailHubInboxWatch,` (line 300):

```go
		UnsubscribeEmailHubInboxWatch: h.unsubscribeEmailHubInboxWatch,
		CompleteEmailHubOAuth:         h.completeEmailHubOAuth,
```

3f. In `server/internal/handler/isolation_routes_test.go`, replace the "Provider callbacks" block (lines 193-197) with:

```go
	// Provider callbacks.
	"POST /api/v1/integrations/livekit/webhook":             {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/billing/webhooks/vnpay":                    {class: isoPublic, reason: reasonProvider},
	"POST /api/v1/billing/webhooks/vnpay":                   {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/calendar-connections/{provider}/callback":  {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/email-hub-connections/{provider}/callback": {class: isoPublic, reason: reasonProvider},
```

`{provider}` already has a `pathParamSDI` case (Task 4 made its description neutral). The callback has no SDI and no body, so `isoReferences` does not change. No log line is added here; `CompleteOAuth` logs by code.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/handler/ -run 'TestEmailHub|TestIsolationMatrix|TestIsolationRealtime|TestSwaggerSpecFollowsChiRoutesAndSDI'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 ./internal/handler/router/ -run 'TestEmailHubOAuthCallbackIsOnTheCredentialBudget|TestEmailHubConnectBudgetsEachSignedInUser|TestEveryRouteFieldIsBound'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/handler && go vet ./internal/handler/... && go tool staticcheck ./internal/handler/...
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/no-pii-log.test.mjs
```

Expected: everything passes and `gofmt -l` prints nothing. `TestEmailHub` re-runs every Email Hub handler test (they all use the variadic `setupEmailHubHTTP`). `TestIsolationMatrix` accepts the callback as `isoPublic` (without the row it fails, naming the route). `TestSwaggerSpecFollowsChiRoutesAndSDI` finds the callback. `TestEveryRouteFieldIsBound` finds `Routes.CompleteEmailHubOAuth` bound.

- [ ] **Step 5: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add server/internal/handler/email_hub_oauth.go server/internal/handler/email_hub_oauth_test.go \
  server/internal/handler/isolation_routes_test.go \
  server/internal/handler/router.go server/internal/handler/router/email_hub.go \
  server/internal/handler/router/email_hub_ratelimit_test.go server/internal/handler/router/router.go \
  server/internal/handler/router/routes.go
git commit -m "feat(email-hub): OAuth callback outside the session answering a hashed-CSP postMessage page" \
  -m "The provider redirects the popup with no bearer token, so GET /email-hub-connections/{provider}/callback is registered beside registerAuth on the 60/min credential budget, not inside authed as the calendar callback is. The handler reads the nonce cookie, clears it on every branch, and hands state, code, error and nonce to CompleteOAuth. It always answers 200 with one page: a JSON data block (origin, ok, code; json.Marshal escapes < > &) and a constant script that posts {type: uniwork:email-hub-oauth, ok, code} to FRONTEND_ORIGIN and closes. Because the script is constant, its sha256 is computed once, every result carries the same CSP, and there is no unsafe-inline; the policy restates frame-ancestors and base-uri because it replaces the API default. The response is no-store. With Email Hub off, the page answers failed. The callback is isoPublic reasonProvider. Left out: the client popup and dialog (later GD3 tasks), revoke paths, and the runbook." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Revoke refresh tokens on every path

**Files:**
- Modify: `server/pkg/db/queries/email_hub.sql`: `DisconnectEmailHubAccount` (:33-43) becomes `:one` returning the old `auth_kind` and `oauth_refresh_token_enc`; `DisconnectEmailHubAccountsForUser` (:45-55) also returns those two old columns; `MarkEmailHubAccountAuthFailed` (:107-122) becomes `:one` returning the same two old columns; `CountEmailHubOAuthGrantHolders` is appended (Step 8).
- Regenerate: `server/pkg/db/generated/email_hub.sql.go` (`make sqlc`)
- Create: `server/internal/service/email_hub_oauth_revoke.go`, `server/internal/service/email_hub_oauth_revoke_test.go`
- Modify: `server/internal/service/email_hub.go`: `Disconnect` (:151-204); `cleanUpEmailHubAccountsAfterCommit` (:219-230) gains a `hub` parameter
- Modify: `server/internal/service/email_hub_watcher.go`: `markAuthFailed` (:269-312)
- Modify: `server/internal/service/email_hub_connect.go` (`Connect`) and `server/internal/service/email_hub_oauth_callback.go` (`CompleteOAuth`): one call each after the save
- Modify: `server/internal/service/organization_members.go`: struct field (:44-57), setter after `SetFiles` (:64), the `Leave` cleanup call (:403)
- Modify: `server/internal/service/auth.go` (struct field at :27-42, setter after `SetMail` at :50-53) and `server/internal/service/account_deletion.go` (the cleanup call at :168)
- Modify: `server/cmd/server/main.go`: two setters after `askUNI.SetEmailHub(emailHubSvc)` (:508)
- Modify (callers of the changed query shapes):
  - `server/internal/service/email_hub_account_queries_test.go`: :39-48, :105-109, the two calls in Task 3's `TestUpdateEmailHubAccountOAuthTokensConditional`, and one new test
  - `server/internal/service/email_hub_connect_test.go`: :138-142 and :451-455
  - `server/internal/service/email_hub_needs_reconnect_test.go`: :28-33
  - `server/internal/service/email_hub_auth_failure_test.go`: :277-281
  - `server/internal/service/email_hub_schedule_test.go`: :715

Why the token comes from the statement that removes it: a Microsoft refresh can rotate the refresh token without bumping `credential_version`, so a caller's snapshot may hold an older token than the row. `RETURNING old.*` is the value this statement took off the row, under its row lock.

Why a reconnect revokes only when the auth kind changes: Google's revoke endpoint ends the whole grant (every token Email Hub's client holds for that Google account). A reconnect matches by address, so `oauth_google → oauth_google` is the same Google account on the same client, and revoking the old token would kill the token just stored. For the same reason Step 8 skips the revoke while another live row still holds that grant.

**Interfaces:**
- Consumes:
  - Task 1: `s.oauth` (`name`, `authKind`, `revokeURL`), `s.oauthHTTP`, `oauthByKind`.
  - Task 3: `sealSecret` (tests only).
  - GD1: `openPassword` (email_hub.go:712).
  - Task 5: `saveEmailHubConnection(...) (row, prev, serverChanged, err)` (`prev` read FOR UPDATE in the save tx, zero on insert), `afterEmailHubConnect`.
  - Test helpers: `emailHubFixture`, `seedEmailHubAccountAddr`, `stubEmailHubDial`, `newEmailHubLifecycle` / `assertRevoked`, `testEmailHubBox`.
- Produces:
  - `func (q *Queries) DisconnectEmailHubAccount(ctx, arg DisconnectEmailHubAccountParams) (DisconnectEmailHubAccountRow, error)` with `DisconnectEmailHubAccountRow{AuthKind string; OauthRefreshTokenEnc string}`; no row → `pgx.ErrNoRows`.
  - `DisconnectEmailHubAccountsForUserRow{ID, OrganizationID, AuthKind, OauthRefreshTokenEnc string}`.
  - `func (q *Queries) MarkEmailHubAccountAuthFailed(ctx, arg MarkEmailHubAccountAuthFailedParams) (MarkEmailHubAccountAuthFailedRow, error)` with `MarkEmailHubAccountAuthFailedRow{AuthKind string; OauthRefreshTokenEnc string}`; stale version or already failed → `pgx.ErrNoRows`.
  - `func (q *Queries) CountEmailHubOAuthGrantHolders(ctx, arg CountEmailHubOAuthGrantHoldersParams) (int64, error)` (`-- tenant: system`).
  - `const emailHubRevokeTimeout = 5 * time.Second`
  - `func (s *EmailHubService) revokeEmailHubToken(ctx context.Context, accountID, authKind, refreshEnc string)`: never returns an error; logs `email hub revoke failed` / `email hub revoke skipped` with `account_id` and `code` only.
  - `func (s *EmailHubService) revokeReplacedEmailHubToken(ctx context.Context, prev, row db.EmailHubAccount)`
  - `func cleanUpEmailHubAccountsAfterCommit(ctx context.Context, q *db.Queries, hub *EmailHubService, rows []db.DisconnectEmailHubAccountsForUserRow)` (nil `hub` → no revoke)
  - `func (s *OrganizationMemberService) SetEmailHub(h *EmailHubService)`, `func (s *AuthService) SetEmailHub(h *EmailHubService)`
  - Log `code` values (for Task 11): `not_configured`, `unsealable`, `request`, `timeout`, `unreachable`, `status_<n>`, `grant_shared`, `lookup_failed`.

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/service/email_hub_account_queries_test.go` (`pgtype` is already imported since Task 3; `errors` and `pgx` are already imported):

```go
// Each statement that removes a refresh token returns the one it removed, so
// the caller revokes exactly that token after commit (spec §2.3, §5.5).
func TestDisconnectReturnsPreviousRefreshToken(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	assertCleared := func(acc db.EmailHubAccount, wantVersion int64) {
		t.Helper()
		row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if row.OauthRefreshTokenEnc != "" || row.OauthAccessTokenEnc != "" || row.OauthAccessExpiresAt.Valid || row.CredentialVersion != wantVersion {
			t.Fatalf("%s: refresh=%q access=%q expires=%v version=%d, want tokens cleared at version %d",
				acc.EmailAddress, row.OauthRefreshTokenEnc, row.OauthAccessTokenEnc, row.OauthAccessExpiresAt.Valid,
				row.CredentialVersion, wantVersion)
		}
	}

	one := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "one@gmail.com", "oauth_google", "refresh-one")
	params := db.DisconnectEmailHubAccountParams{ID: one.ID, UserID: user.ID, OrganizationID: org}
	got, err := q.DisconnectEmailHubAccount(ctx, params)
	if err != nil || got.AuthKind != "oauth_google" || got.OauthRefreshTokenEnc != one.OauthRefreshTokenEnc {
		t.Fatalf("disconnect returned auth_kind=%q same_token=%v err=%v; want the sealed token it removed",
			got.AuthKind, got.OauthRefreshTokenEnc == one.OauthRefreshTokenEnc, err)
	}
	assertCleared(one, one.CredentialVersion+1)
	if _, err := q.DisconnectEmailHubAccount(ctx, params); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a second disconnect: err=%v, want pgx.ErrNoRows", err)
	}

	two := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "two@gmail.com", "oauth_google", "refresh-two")
	three := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "three@outlook.com", "oauth_microsoft", "refresh-three")
	rows, err := q.DisconnectEmailHubAccountsForUser(ctx, db.DisconnectEmailHubAccountsForUserParams{
		UserID: user.ID, OrganizationID: pgtype.Text{String: org, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]db.DisconnectEmailHubAccountsForUserRow{
		two.ID:   {ID: two.ID, OrganizationID: org, AuthKind: "oauth_google", OauthRefreshTokenEnc: two.OauthRefreshTokenEnc},
		three.ID: {ID: three.ID, OrganizationID: org, AuthKind: "oauth_microsoft", OauthRefreshTokenEnc: three.OauthRefreshTokenEnc},
	}
	if len(rows) != len(want) {
		t.Fatalf("disconnect for user returned %d rows, want %d (the disconnected one is not live)", len(rows), len(want))
	}
	for _, r := range rows {
		if want[r.ID] != r {
			t.Fatalf("row %s: got auth_kind=%q, want the old auth kind and sealed token", r.ID, r.AuthKind)
		}
	}
	assertCleared(two, two.CredentialVersion+1)
	assertCleared(three, three.CredentialVersion+1)

	four := seedRevocableEmailHubAccount(t, svc, pool, user.ID, org, "four@gmail.com", "oauth_google", "refresh-four")
	mark := db.MarkEmailHubAccountAuthFailedParams{
		ID: four.ID, OrganizationID: org, CredentialVersion: four.CredentialVersion + 1, Reason: "imap_auth_failed",
	}
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, mark); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a stale snapshot marked the account: err=%v, want pgx.ErrNoRows", err)
	}
	mark.CredentialVersion = four.CredentialVersion
	marked, err := q.MarkEmailHubAccountAuthFailed(ctx, mark)
	if err != nil || marked.AuthKind != "oauth_google" || marked.OauthRefreshTokenEnc != four.OauthRefreshTokenEnc {
		t.Fatalf("mark returned auth_kind=%q same_token=%v err=%v; want the sealed token it removed",
			marked.AuthKind, marked.OauthRefreshTokenEnc == four.OauthRefreshTokenEnc, err)
	}
	assertCleared(four, four.CredentialVersion) // only a reconnect bumps the version
}
```

Create `server/internal/service/email_hub_oauth_revoke_test.go`:

```go
package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fakeEmailHubRevoke stands in for Google's revoke endpoint. svc's Google
// provider posts to it, and Microsoft has none. Every call answers status;
// status 0 never answers (the client gives up). It returns the token= values
// received so far.
func fakeEmailHubRevoke(t *testing.T, svc *EmailHubService, status int) func() []string {
	t.Helper()
	var mu sync.Mutex
	var got []string
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.ParseForm() != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		got = append(got, r.PostForm.Get("token"))
		mu.Unlock()
		if status == 0 {
			select {
			case <-r.Context().Done():
			case <-release:
			}
			return
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) }) // LIFO: unblocks a hung handler before Close waits on it
	svc.oauthHTTP = srv.Client()
	svc.oauth = map[string]*emailHubOAuthProvider{
		"google":    {name: "google", authKind: "oauth_google", revokeURL: srv.URL},
		"microsoft": {name: "microsoft", authKind: "oauth_microsoft"},
	}
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return slices.Clone(got)
	}
}

// seedRevocableEmailHubAccount stores a live mailbox at email. Under an OAuth
// authKind, it holds the sealed refresh token refresh and a live access token.
// Under "password", it is the plain seed row.
func seedRevocableEmailHubAccount(t *testing.T, svc *EmailHubService, pool *pgxpool.Pool, userID, orgID, email, authKind, refresh string) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	acc := seedEmailHubAccountAddr(t, svc.q, svc.box, userID, orgID, email)
	if authKind == "password" {
		return acc
	}
	sealedRefresh, err := svc.sealSecret(refresh)
	if err != nil {
		t.Fatal(err)
	}
	sealedAccess, err := svc.sealSecret("access-" + refresh)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts
		SET auth_kind = $2, password_enc = '', oauth_refresh_token_enc = $3,
		    oauth_access_token_enc = $4, oauth_access_expires_at = now() + interval '1 hour'
		WHERE id = $1`, acc.ID, authKind, sealedRefresh, sealedAccess); err != nil {
		t.Fatal(err)
	}
	row, err := svc.q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// A manual disconnect revokes the Google grant it removed. A Microsoft
// refresh token has no revoke endpoint, a password row has nothing to revoke,
// and a repeated disconnect finds no token left (spec §3, §5.5).
func TestEmailHubRevokeOnDisconnect(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	google := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "g@gmail.com", "oauth_google", "google-refresh")
	microsoft := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "m@outlook.com", "oauth_microsoft", "microsoft-refresh")
	password := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "pw@gmail.com", "password", "")
	for _, acc := range []db.EmailHubAccount{google, microsoft, password, google} {
		if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
			t.Fatalf("disconnect %s: %v", acc.EmailAddress, err)
		}
	}
	if got := revoked(); !slices.Equal(got, []string{"google-refresh"}) {
		t.Fatalf("revoked %q, want only the Google refresh token, once", got)
	}
}

// Leave and account deletion disconnect every mailbox in one statement and
// revoke the Google grants that statement removed, after commit (spec §5.5).
func TestEmailHubRevokeOnLeaveAndAccountDeletion(t *testing.T) {
	ctx := context.Background()
	for _, how := range []string{"leave", "delete"} {
		t.Run(how, func(t *testing.T) {
			l := newEmailHubLifecycle(t)
			revoked := fakeEmailHubRevoke(t, l.svc, http.StatusOK)
			oauth := seedRevocableEmailHubAccount(t, l.svc, l.pool, l.member.ID, l.ws.OrganizationID,
				"member@gmail.com", "oauth_google", "member-refresh")
			l.members.SetEmailHub(l.svc)
			l.auth.SetEmailHub(l.svc)
			var err error
			if how == "leave" {
				err = l.members.Leave(ctx, l.member.ID, l.ws.OrganizationID)
			} else {
				err = l.auth.DeleteAccount(ctx, l.member.ID, DeleteAccountInput{Password: "password123"})
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := revoked(); !slices.Equal(got, []string{"member-refresh"}) {
				t.Fatalf("revoked %q, want the member's Google refresh token once", got)
			}
			row, err := l.q.GetEmailHubAccountByID(ctx, oauth.ID)
			if err != nil || !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" {
				t.Fatalf("oauth mailbox after %s: disconnected=%v refresh=%q err=%v",
					how, row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc, err)
			}
			l.assertRevoked(t)
		})
	}
}

// Replacing a Google sign-in with an app password leaves a grant nothing uses
// again, so the reconnect revokes it once the new credential is committed.
func TestEmailHubRevokeOnReconnectToPassword(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	acc := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "back@gmail.com", "oauth_google", "old-refresh")
	stubEmailHubDial(svc, nil)

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "back@gmail.com", AppPassword: "new-app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID || view.AuthKind != "password" {
		t.Fatalf("reconnect: id=%s auth_kind=%q, want id %s with password", view.ID, view.AuthKind, acc.ID)
	}
	if got := revoked(); !slices.Equal(got, []string{"old-refresh"}) {
		t.Fatalf("revoked %q, want the replaced Google refresh token", got)
	}
}

// A reconnect with the same auth kind lands on the address's same Google
// grant, and Google revokes per grant, not per token. Revoking the old token
// would sign the new one out.
func TestEmailHubRevokeSkipsASameKindReconnect(t *testing.T) {
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	sealed, err := svc.sealSecret("old-refresh")
	if err != nil {
		t.Fatal(err)
	}
	prev := db.EmailHubAccount{ID: "acc-1", AuthKind: "oauth_google", OauthRefreshTokenEnc: sealed}
	row := db.EmailHubAccount{ID: "acc-1", AuthKind: "oauth_google", OauthRefreshTokenEnc: "sealed-new"}
	svc.revokeReplacedEmailHubToken(context.Background(), prev, row)
	if got := revoked(); len(got) != 0 {
		t.Fatalf("a same-kind reconnect revoked %q", got)
	}
}

// markAuthFailed removes the token. An IMAP refusal leaves the grant alive at
// Google, so it is revoked. invalid_grant means Google already ended the grant,
// so nothing is sent. A mark that matches no row revokes nothing.
func TestEmailHubRevokeOnImapAuthFailedNotOnInvalidGrant(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	refused := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "refused@gmail.com", "oauth_google", "refused-refresh")
	dead := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "dead@gmail.com", "oauth_google", "dead-refresh")

	if !svc.markAuthFailed(ctx, refused, refused.CredentialVersion, "imap_auth_failed") {
		t.Fatal("an IMAP refusal must mark the account")
	}
	if !svc.markAuthFailed(ctx, dead, dead.CredentialVersion, "oauth_invalid_grant") {
		t.Fatal("invalid_grant must mark the account")
	}
	if svc.markAuthFailed(ctx, refused, refused.CredentialVersion, "imap_auth_failed") {
		t.Fatal("an already failed account was marked again")
	}
	if got := revoked(); !slices.Equal(got, []string{"refused-refresh"}) {
		t.Fatalf("revoked %q, want only the IMAP-refused grant, once", got)
	}
}

// Revoke is best-effort after commit: an error answer or a hung endpoint
// costs at most emailHubRevokeTimeout and never fails the disconnect.
func TestEmailHubRevokeFailureDoesNotFailDisconnect(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
	}{{"server_error", http.StatusInternalServerError}, {"hang", 0}} {
		t.Run(tc.name, func(t *testing.T) {
			svc, q, user, ws, pool := emailHubFixture(t)
			ctx := context.Background()
			revoked := fakeEmailHubRevoke(t, svc, tc.status)
			acc := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "g@gmail.com", "oauth_google", "google-refresh")

			start := time.Now()
			if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
				t.Fatalf("a failed revoke failed the disconnect: %v", err)
			}
			if took := time.Since(start); took > emailHubRevokeTimeout+3*time.Second {
				t.Fatalf("disconnect took %v; the revoke must give up after %v", took, emailHubRevokeTimeout)
			}
			if got := revoked(); len(got) != 1 {
				t.Fatalf("revoke calls = %d, want 1", len(got))
			}
			row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
			if err != nil || !row.DisconnectedAt.Valid || row.OauthRefreshTokenEnc != "" {
				t.Fatalf("row after disconnect: disconnected=%v refresh=%q err=%v", row.DisconnectedAt.Valid, row.OauthRefreshTokenEnc, err)
			}
		})
	}
}

// The same Google account connected elsewhere (another organization here)
// shares the grant, so a disconnect revokes nothing until the last holder goes.
func TestEmailHubRevokeSkipsAGrantAnotherMailboxStillHolds(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	revoked := fakeEmailHubRevoke(t, svc, http.StatusOK)
	here := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "shared@gmail.com", "oauth_google", "refresh-here")
	seedRevocableEmailHubAccount(t, svc, pool, user.ID, util.NewID(), "Shared@Gmail.com", "oauth_google", "refresh-there")
	solo := seedRevocableEmailHubAccount(t, svc, pool, user.ID, ws.OrganizationID, "solo@gmail.com", "oauth_google", "refresh-solo")

	for _, acc := range []db.EmailHubAccount{here, solo} {
		if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
			t.Fatal(err)
		}
	}
	if got := revoked(); !slices.Equal(got, []string{"refresh-solo"}) {
		t.Fatalf("revoked %q, want only the grant no other mailbox holds", got)
	}
}
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHubRevoke|TestDisconnectReturnsPreviousRefreshToken'
```

Expected: the build fails, with errors such as `got.AuthKind undefined (type int64 has no field or method AuthKind)`, `unknown field AuthKind in struct literal of type db.DisconnectEmailHubAccountsForUserRow`, `svc.revokeReplacedEmailHubToken undefined`, `undefined: emailHubRevokeTimeout`, `l.members.SetEmailHub undefined`, `l.auth.SetEmailHub undefined`.

- [ ] **Step 3: Return the removed token from the three statements, add the holder count, regenerate**

In `server/pkg/db/queries/email_hub.sql`, replace `DisconnectEmailHubAccount` and `DisconnectEmailHubAccountsForUser` (lines 33-55):

```sql
-- name: DisconnectEmailHubAccount :one
-- A disconnected mailbox is never used again (connecting the address again
-- creates a new row), so its credentials go with it. RETURNING reads old, the
-- locked row as it was: the caller revokes the refresh token this removed.
UPDATE email_hub_accounts a
SET disconnected_at = now(), password_enc = '',
    oauth_refresh_token_enc = '', oauth_access_token_enc = '', oauth_access_expires_at = NULL,
    credential_version = a.credential_version + 1, updated_at = now()
FROM (
  SELECT id, auth_kind, oauth_refresh_token_enc
  FROM email_hub_accounts
  WHERE id = sqlc.arg('id')
    AND user_id = sqlc.arg('user_id')
    AND organization_id = sqlc.arg('organization_id')
    AND disconnected_at IS NULL
  FOR UPDATE
) old
WHERE a.id = old.id
RETURNING old.auth_kind, old.oauth_refresh_token_enc;

-- name: DisconnectEmailHubAccountsForUser :many
-- tenant: self
-- Account deletion (organization_id NULL: every organization) or leaving one.
-- RETURNING reads old: the refresh tokens this statement removed.
UPDATE email_hub_accounts a
SET disconnected_at = now(), password_enc = '',
    oauth_refresh_token_enc = '', oauth_access_token_enc = '', oauth_access_expires_at = NULL,
    credential_version = a.credential_version + 1, updated_at = now()
FROM (
  SELECT id, organization_id, auth_kind, oauth_refresh_token_enc
  FROM email_hub_accounts
  WHERE user_id = sqlc.arg('user_id')
    AND (sqlc.narg('organization_id')::text IS NULL OR organization_id = sqlc.narg('organization_id'))
    AND disconnected_at IS NULL
  FOR UPDATE
) old
WHERE a.id = old.id
RETURNING old.id, old.organization_id, old.auth_kind, old.oauth_refresh_token_enc;
```

Replace `MarkEmailHubAccountAuthFailed` (lines 107-122):

```sql
-- name: MarkEmailHubAccountAuthFailed :one
-- Only the snapshot that failed may mark the account: a reconnect since then
-- bumped credential_version and its new credential stays. RETURNING reads old:
-- the refresh token this statement removed. No row comes back otherwise.
UPDATE email_hub_accounts a
SET auth_failed_at = now(),
    auth_failed_reason = sqlc.arg('reason'),
    password_enc = '',
    oauth_refresh_token_enc = '',
    oauth_access_token_enc = '',
    oauth_access_expires_at = NULL,
    updated_at = now()
FROM (
  SELECT id, auth_kind, oauth_refresh_token_enc
  FROM email_hub_accounts
  WHERE id = sqlc.arg('id')
    AND organization_id = sqlc.arg('organization_id')
    AND credential_version = sqlc.arg('credential_version')
    AND disconnected_at IS NULL
    AND auth_failed_at IS NULL
  FOR UPDATE
) old
WHERE a.id = old.id
RETURNING old.auth_kind, old.oauth_refresh_token_enc;
```

Append (used in Step 8):

```sql
-- name: CountEmailHubOAuthGrantHolders :one
-- tenant: system
-- A Google grant belongs to the Google account and Email Hub's client, and
-- revoking any of its tokens ends it. Before a revoke, count the live rows of
-- any organization or user that still hold a refresh token on it. Only the
-- count leaves this query.
SELECT count(*)::bigint
FROM email_hub_accounts
WHERE auth_kind = sqlc.arg('auth_kind')
  AND lower(email_address) = lower(sqlc.arg('email')::text)
  AND disconnected_at IS NULL
  AND oauth_refresh_token_enc <> '';
```

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && make sqlc && git diff --stat server/pkg/db/generated/
```

Expected: only `server/pkg/db/generated/email_hub.sql.go` changes, with the shapes listed under Interfaces (params of the three changed queries unchanged; `CountEmailHubOAuthGrantHoldersParams{AuthKind, Email string}`). If sqlc names a field differently, use its name everywhere in this task.

- [ ] **Step 4: Move the existing callers onto the new shapes**

`server/internal/service/email_hub_account_queries_test.go`, the `mark` helper at lines 39-48 becomes:

```go
	mark := func(version int64) int64 {
		t.Helper()
		_, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: org, CredentialVersion: version, Reason: "imap_auth_failed",
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return 0
		}
		if err != nil {
			t.Fatal(err)
		}
		return 1
	}
```

The disconnect at lines 105-109 becomes:

```go
	if _, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: acc.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
```

In the same file, Task 3's `TestUpdateEmailHubAccountOAuthTokensConditional`: replace

```go
	if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: org, CredentialVersion: acc.CredentialVersion, Reason: "oauth_invalid_grant",
	}); err != nil || n != 1 {
		t.Fatalf("mark auth failed: n=%d err=%v", n, err)
	}
```

with

```go
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: org, CredentialVersion: acc.CredentialVersion, Reason: "oauth_invalid_grant",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
```

and replace

```go
	if n, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: gone.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil || n != 1 {
		t.Fatalf("disconnect: n=%d err=%v", n, err)
	}
```

with

```go
	if _, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: gone.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
```

`server/internal/service/email_hub_connect_test.go` lines 138-142 (in `TestEmailHubReconnectKeepsTheAccountAndItsMail`) become:

```go
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
```

Lines 451-455 of the same file (in `TestEmailHubReconnectChangedServerFlagsIt`) become:

```go
		if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
		}); err != nil {
			t.Fatalf("mark auth failed: %v", err)
		}
```

`server/internal/service/email_hub_needs_reconnect_test.go` lines 28-33 (in `markSeedAccountAuthFailed`) become:

```go
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
```

`server/internal/service/email_hub_auth_failure_test.go` lines 277-281 (in `TestEmailHubWatchLoopExitsOnceTheAccountNeedsReconnect`) become:

```go
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil {
		t.Fatalf("mark: %v", err)
	}
```

`server/internal/service/email_hub_schedule_test.go` line 715 becomes `cleanUpEmailHubAccountsAfterCommit(ctx, l.q, nil, rows)` (without a hub nothing is revoked; this test is about the cleanup outliving the request).

Then find any caller not listed above:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && grep -r --line-number 'MarkEmailHubAccountAuthFailed(\|DisconnectEmailHubAccount(\|cleanUpEmailHubAccountsAfterCommit(' internal/ cmd/
```

Move each extra hit onto the same shapes: `_, err :=` for a call that only needs success, `errors.Is(err, pgx.ErrNoRows)` for one that expects 0 rows, a `nil` hub for `cleanUpEmailHubAccountsAfterCommit` in a test.

- [ ] **Step 5: The revoke**

Create `server/internal/service/email_hub_oauth_revoke.go`:

```go
package service

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubRevokeTimeout bounds the best-effort revoke that runs after a command
// committed (spec §5.5).
const emailHubRevokeTimeout = 5 * time.Second

// revokeEmailHubToken tells Google that a refresh token a committed statement
// just removed from accountID's row is no longer wanted (spec §5.5). Only
// oauth_google has a revoke endpoint: Microsoft offers none for it, and a
// password row has no token. The command already committed, so this never
// fails it: an error, a non-200 or the timeout is logged by code, never with
// the token or the response. Google revokes the whole grant, every token
// Email Hub's client holds for that Google account, so callers never pass a
// token whose grant a live credential still needs.
func (s *EmailHubService) revokeEmailHubToken(ctx context.Context, accountID, authKind, refreshEnc string) {
	if refreshEnc == "" || authKind != "oauth_google" {
		return
	}
	p, ok := s.oauthByKind(authKind)
	if !ok || p.revokeURL == "" {
		s.log.Warn("email hub revoke skipped", "account_id", accountID, "code", "not_configured")
		return
	}
	token, err := s.openPassword(refreshEnc)
	if err != nil {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "unsealable")
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), emailHubRevokeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.revokeURL,
		strings.NewReader(url.Values{"token": {token}}.Encode()))
	if err != nil {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "request")
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.oauthHTTP.Do(req)
	if err != nil {
		code := "unreachable"
		if errors.Is(err, context.DeadlineExceeded) {
			code = "timeout"
		}
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", code)
		return
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "status_"+strconv.Itoa(resp.StatusCode))
	}
}

// revokeReplacedEmailHubToken revokes the refresh token a committed reconnect
// replaced. prev is the row before the save, and the zero row on a fresh
// insert. A reconnect matches by address, so the same auth kind means the same
// Google account and the same grant as the token just stored. Only a change
// of auth kind leaves a grant nobody uses.
func (s *EmailHubService) revokeReplacedEmailHubToken(ctx context.Context, prev, row db.EmailHubAccount) {
	if prev.AuthKind != row.AuthKind {
		s.revokeEmailHubToken(ctx, prev.ID, prev.AuthKind, prev.OauthRefreshTokenEnc)
	}
}
```

- [ ] **Step 6: Call it after every commit that removes a refresh token**

In `server/internal/service/email_hub.go`, replace the body of `Disconnect` from `n, err := qtx.DisconnectEmailHubAccount(` (line 166) through `return cleanUpDisconnectedEmailHubAccount(ctx, s.q, accountID, ws.OrganizationID)` (line 203) with:

```go
	old, err := qtx.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	disconnected := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if disconnected {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			Actor:          actor,
			Action:         audit.ActionEmailHubAccountDisconnected,
			ResourceType:   "email_hub_account",
			ResourceID:     accountID,
		}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if !disconnected {
		// Either not the caller's mailbox, or theirs and already disconnected.
		// The second case runs the cleanup again: the flip and the deletes
		// are not one transaction, so a cleanup that failed last time must
		// be retryable, and a repeated disconnect must not turn into a 404.
		acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if acc.UserID != actor.ID || acc.OrganizationID != ws.OrganizationID || !acc.DisconnectedAt.Valid {
			return ErrNotFound
		}
	}
	s.hubWatch.forceStop(accountID)
	// old is the zero row on a repeated disconnect: no token is left to revoke.
	s.revokeEmailHubToken(ctx, accountID, old.AuthKind, old.OauthRefreshTokenEnc)
	return cleanUpDisconnectedEmailHubAccount(ctx, s.q, accountID, ws.OrganizationID)
```

Replace `cleanUpEmailHubAccountsAfterCommit` (lines 219-230):

```go
// cleanUpEmailHubAccountsAfterCommit cleans up the mailboxes a lifecycle
// command (leave, account deletion) disconnected, and revokes the refresh
// tokens that command removed when hub is wired (nil: no revoke). That command
// already committed, so a failure is logged rather than returned. Nobody can
// retry it (the caller is gone from the organization), so it outlives the request.
func cleanUpEmailHubAccountsAfterCommit(ctx context.Context, q *db.Queries, hub *EmailHubService, rows []db.DisconnectEmailHubAccountsForUserRow) {
	ctx = context.WithoutCancel(ctx)
	for _, r := range rows {
		if err := cleanUpDisconnectedEmailHubAccount(ctx, q, r.ID, r.OrganizationID); err != nil {
			slog.Warn("email hub cleanup after disconnect failed", "account_id", r.ID, "err", err)
		}
		if hub != nil {
			hub.revokeEmailHubToken(ctx, r.ID, r.AuthKind, r.OauthRefreshTokenEnc)
		}
	}
}
```

In `server/internal/service/email_hub_watcher.go`, `markAuthFailed`:
- Replace lines 280-289 (from `n, err := qtx.MarkEmailHubAccountAuthFailed(` through the `if n == 0 { return false }` block):

```go
	old, err := qtx.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: version, Reason: reason,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
```

- Replace lines 309-310 (the `needs reconnect` log line and `forceStop`):

```go
	s.log.Warn("email hub account needs reconnect", "account_id", acc.ID, "reason", reason)
	if reason != "oauth_invalid_grant" {
		// invalid_grant: the provider already ended the grant. Any other
		// refusal leaves a live grant behind that this row no longer holds.
		s.revokeEmailHubToken(ctx, acc.ID, old.AuthKind, old.OauthRefreshTokenEnc)
	}
	s.hubWatch.forceStop(acc.ID) // last: it may cancel ctx when the watcher calls us
```

`pgx` and `errors` are already imported there.

In `server/internal/service/email_hub_connect.go` (`Connect`) and `server/internal/service/email_hub_oauth_callback.go` (`CompleteOAuth`), change `row, _, serverChanged, err := s.saveEmailHubConnection(...)` to `row, prev, serverChanged, err := s.saveEmailHubConnection(...)`, and directly after its error check, before `s.afterEmailHubConnect(ctx, row, serverChanged)`, add:

```go
	s.revokeReplacedEmailHubToken(ctx, prev, row)
```

The reconnect and its audit row have committed by then; the replaced token is the one `prev` held under the save transaction's `FOR UPDATE` lock.

- [ ] **Step 7: Wire the hub into Leave and DeleteAccount**

In `server/internal/service/organization_members.go`, add at the end of the `OrganizationMemberService` struct, after `files files.Service`:

```go
	// emailHub is optional: wired, Leave revokes the OAuth grants of the
	// mailboxes it disconnects (spec §5.5).
	emailHub *EmailHubService
```

After `SetFiles` (line 64):

```go
// SetEmailHub lets Leave revoke the refresh tokens it removes; main wires it
// once EmailHubService exists.
func (s *OrganizationMemberService) SetEmailHub(h *EmailHubService) { s.emailHub = h }
```

In `Leave`, line 403 becomes `cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.emailHub, mailboxes)`.

In `server/internal/service/auth.go`, add at the end of the `AuthService` struct, after `files files.Service`:

```go
	// emailHub is optional: wired, DeleteAccount revokes the OAuth grants of
	// the mailboxes it disconnects (spec §5.5).
	emailHub *EmailHubService
```

After `SetMail` (lines 50-53):

```go
// SetEmailHub lets DeleteAccount revoke the refresh tokens it removes; main
// wires it once EmailHubService exists.
func (s *AuthService) SetEmailHub(h *EmailHubService) { s.emailHub = h }
```

In `server/internal/service/account_deletion.go`, line 168 becomes `cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.emailHub, mailboxes)`.

In `server/cmd/server/main.go`, after `askUNI.SetEmailHub(emailHubSvc)` (line 508; `orgMemberSvc` and `authSvc` are built earlier, at :90 and :198):

```go
	// Leave and account deletion revoke the Google grants of the mailboxes they disconnect.
	orgMemberSvc.SetEmailHub(emailHubSvc)
	authSvc.SetEmailHub(emailHubSvc)
```

- [ ] **Step 8: Skip a grant another live row still holds (default ON; drop this step only if the controller rules NO)**

Without this step, a Google account connected in two organizations (or by two users) shares one grant, and a disconnect in one signs out the other: its next refresh gets `invalid_grant` and it moves to needs_reconnect.

In `revokeEmailHubToken`, insert directly after `defer cancel()`. The row that removed the token no longer counts: it is disconnected, auth-failed or reconnected, and its refresh column is empty.

```go
	acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
	if err != nil {
		s.log.Warn("email hub revoke skipped", "account_id", accountID, "code", "lookup_failed")
		return
	}
	holders, err := s.q.CountEmailHubOAuthGrantHolders(ctx, db.CountEmailHubOAuthGrantHoldersParams{
		AuthKind: authKind, Email: acc.EmailAddress,
	})
	if err != nil || holders > 0 {
		code := "grant_shared"
		if err != nil {
			code = "lookup_failed"
		}
		s.log.Info("email hub revoke skipped", "account_id", accountID, "code", code)
		return
	}
```

`TestEmailHubRevokeSkipsAGrantAnotherMailboxStillHolds` (Step 1) pins it. If the controller rules NO: delete this insert, the `CountEmailHubOAuthGrantHolders` query (re-run `make sqlc`), that test and the `util` import of the revoke test file.

- [ ] **Step 9: Run the targeted tests**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -race -timeout 30m ./internal/service/ -run 'TestEmailHubRevoke|TestDisconnectReturnsPreviousRefreshToken|TestEmailHubAccountCredentialQueries|TestUpdateEmailHubAccountOAuthTokensConditional'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHub|TestLeave|TestLeavingOrDeletingTheAccountDisconnectsEmailHub|TestDeleteAccount|TestEveryAuditedCommandWritesItsRow|TestUpdateEmailHubAccountSyncStateIgnoresAStaleVersion'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test -count=1 ./migrations/ -run 'TestEveryQueryNamesItsTenant'
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server && gofmt -l ./internal/service ./pkg/db ./cmd/server && go build ./... && go vet ./internal/service/ ./pkg/db/... ./cmd/server/ && go tool staticcheck ./internal/service/ ./cmd/server/
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/no-pii-log.test.mjs
```

Expected:
- The first run passes, including both `TestEmailHubRevokeFailureDoesNotFailDisconnect` subtests (`hang` takes about 5s).
- The second run passes: GD1/GD2's disconnect, cleanup-after-commit, reconnect and auth-failure tests, the Task 3 refresh tests, the Task 5 callback tests, `TestLeavingOrDeletingTheAccountDisconnectsEmailHub` (no hub wired there), the audit coverage test with no new action.
- `TestEveryQueryNamesItsTenant` passes: the three statements keep `organization_id = sqlc.arg(...)` or `-- tenant: self`; the count carries `-- tenant: system`.
- gofmt prints nothing; build, vet, staticcheck and the no-PII test are clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add server/pkg/db/queries/email_hub.sql server/pkg/db/generated/email_hub.sql.go \
  server/internal/service/email_hub_oauth_revoke.go server/internal/service/email_hub_oauth_revoke_test.go \
  server/internal/service/email_hub.go server/internal/service/email_hub_watcher.go \
  server/internal/service/email_hub_connect.go server/internal/service/email_hub_oauth_callback.go \
  server/internal/service/organization_members.go server/internal/service/auth.go server/internal/service/account_deletion.go \
  server/cmd/server/main.go server/internal/service/email_hub_account_queries_test.go \
  server/internal/service/email_hub_connect_test.go server/internal/service/email_hub_needs_reconnect_test.go \
  server/internal/service/email_hub_auth_failure_test.go server/internal/service/email_hub_schedule_test.go
git commit -m "feat(email-hub): revoke the Google refresh token wherever it leaves the row" \
  -m "A refresh token cleared from our row but alive at Google keeps a grant the user can no longer see or use from UniWork. DisconnectEmailHubAccount, DisconnectEmailHubAccountsForUser and MarkEmailHubAccountAuthFailed now return the auth kind and sealed refresh token they removed (RETURNING the locked old row; a Microsoft rotation never bumps the version, so a snapshot can be stale). After commit, Disconnect, Leave and DeleteAccount (through cleanUpEmailHubAccountsAfterCommit and new SetEmailHub setters wired in main), a reconnect that changes the auth kind, and markAuthFailed for any reason but oauth_invalid_grant POST that token to Google's revoke endpoint on the OAuth HTTP client. That call is best-effort, bounded at 5s, logs account_id and a code only, and never fails or rolls back the command. A revoke is skipped while another live row of any organization still holds a refresh token for the same Google account (CountEmailHubOAuthGrantHolders, tenant: system), so a disconnect in one organization does not sign the mailbox out in another. Left out: Microsoft has no revoke endpoint, so its token is only dropped on our side; a same-kind OAuth reconnect does not revoke, because Google revokes per grant and the new token shares it; a lost refresh race never revokes (Task 3); deactivation keeps the row and its token by design (F-03)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If Step 8 was dropped by ruling, remove the "A revoke is skipped while…" sentence and add "the shared-grant skip (ruled out)" to "Left out".

### Task 8: Client core: providers and start endpoints, schemas, hooks

**Files:**
- Modify: `packages/core/types/email-hub.ts`. Two schemas after `EmailHubAccountSchema` (ends at line 22); two exported types after `export type EmailHubAccount` (line 142).
- Modify: `packages/core/api/endpoints/email-hub.ts`. Two schema imports and two type imports in the import block (lines 2-23); `EMPTY_PROVIDERS` beside the other `EMPTY_*` constants (lines 29-36); two functions after `disconnectEmailHubAccount` (lines 76-80). About 434 counted lines after this task.
- Modify: `packages/core/email-hub/query-cache.ts`. `providers` in `emailHubKeys` (line 11, after `accounts`).
- Modify: `packages/core/email-hub/hooks.ts`. Extend the type import (line 8); two hooks after `useDisconnectEmailHubAccount` (lines 239-248).
- Test: `packages/core/api/endpoints/email-hub.test.ts`. Extend the import block (lines 4-23), append five cases. The unknown-`auth_kind` account case already exists (line 111, `"oauth_future"`).
- Test: `packages/core/email-hub/hooks.test.ts`. Imports, a partial `vi.mock` of the endpoints module, one new `describe`.

**Interfaces:**
- Consumes:
  - Task 1: `GET /api/v1/workspaces/{workspaceID}/email-hub/providers` → `{google: bool, microsoft: bool}`.
  - Task 4: `POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start` with `{login_hint?}` → `{authorization_url}`. The handler's `decode` answers 400 to an empty body (server/internal/handler/json.go:36-49), so the client always sends a JSON object.
  - Existing: `parseWithFallback` (`packages/core/api/schema.ts`), `request` (`credentials: "include"`, so the browser stores the nonce cookie), `enc = encodeURIComponent` (endpoints/email-hub.ts:27), `emailHubKeys` (query-cache.ts:10).
- Produces:
  - `export const EmailHubProvidersSchema = z.object({ google: z.boolean().catch(false), microsoft: z.boolean().catch(false) })`
  - `export const EmailHubOAuthStartSchema = z.object({ authorization_url: z.string() })`
  - `export type EmailHubProviders` (inferred) and `export type EmailHubOAuthProvider = "google" | "microsoft"`. `EmailHubAccount.auth_kind` stays `z.string()`; Task 10's `oauthProviderOf` switches over it with a `default` (ruling: no separate `EmailHubAuthKind` export, which would have no consumer).
  - `export async function getEmailHubProviders(workspaceId: string): Promise<EmailHubProviders>` (fallback both false)
  - `export async function startEmailHubOAuth(workspaceId: string, provider: EmailHubOAuthProvider, loginHint?: string): Promise<string | null>`: sends `{}` or `{ login_hint }`; `null` when no usable URL.
  - `emailHubKeys.providers(wsId)` = `["email-hub", wsId, "providers"] as const`
  - `export function useEmailHubProviders(wsId: string)` (useQuery, 5-minute `staleTime`)
  - `export function useStartEmailHubOAuth(wsId: string)` (useMutation, `mutationFn: (input: { provider: EmailHubOAuthProvider; loginHint?: string }) => Promise<string | null>`; leaves the cache alone).

- [ ] **Step 1: Write the failing tests**

1a. In `packages/core/api/endpoints/email-hub.test.ts`, replace the import block (lines 4-23):

```ts
import {
  connectEmailHubAccount,
  getEmailHubConversation,
  getEmailHubProviders,
  getEmailHubThread,
  getEmailHubSidebarCounts,
  getEmailHubUnreadCount,
  listEmailHubAccounts,
  listEmailHubThreads,
  patchEmailHubThread,
  cancelEmailHubScheduledSend,
  retryEmailHubScheduledSend,
  listEmailHubScheduledSends,
  sendEmailHub,
  getEmailHubThreadSummary,
  startEmailHubOAuth,
  summarizeEmailHubThread,
  subscribeEmailHubInboxWatch,
  syncEmailHub,
  unsubscribeEmailHubInboxWatch,
  watchEmailHub,
} from "./email-hub";
import type { EmailHubOAuthProvider } from "../../types/email-hub";
```

1b. Append inside `describe("email hub endpoints", …)`, just before its closing `});`:

```ts
  it("getEmailHubProviders reads which sign-ins the server offers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ google: true, microsoft: false }));
    await expect(getEmailHubProviders("ws1")).resolves.toEqual({ google: true, microsoft: false });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/workspaces/ws1/email-hub/providers");
    expect(init?.method).toBe("GET");
  });

  it("getEmailHubProviders hides both sign-ins when the response is malformed", async () => {
    // A drifted answer must never show a button whose start the server would 404.
    for (const body of [{ google: "yes" }, null, []]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getEmailHubProviders("ws1")).resolves.toEqual({ google: false, microsoft: false });
    }
  });

  it("startEmailHubOAuth posts an empty object without a hint and the hint when given", async () => {
    const googleURL = "https://accounts.google.com/o/oauth2/auth?state=s1";
    const microsoftURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=s2";
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ authorization_url: googleURL }))
      .mockResolvedValueOnce(json({ authorization_url: microsoftURL }))
      .mockResolvedValueOnce(json({ authorization_url: googleURL }));

    await expect(startEmailHubOAuth("ws1", "google")).resolves.toBe(googleURL);
    await expect(startEmailHubOAuth("ws1", "microsoft", "an@contoso.vn")).resolves.toBe(microsoftURL);
    await expect(startEmailHubOAuth("ws1", "google", "")).resolves.toBe(googleURL);

    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0]![0])).toContain("/api/v1/workspaces/ws1/email-hub/oauth/google/start");
    expect(calls[0]![1]?.method).toBe("POST");
    // The handler's decode refuses an empty body, so "no hint" is {} and never nothing.
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({});
    expect(String(calls[1]![0])).toContain("/api/v1/workspaces/ws1/email-hub/oauth/microsoft/start");
    expect(JSON.parse(String(calls[1]![1]?.body))).toEqual({ login_hint: "an@contoso.vn" });
    expect(JSON.parse(String(calls[2]![1]?.body))).toEqual({});
  });

  it("startEmailHubOAuth encodes the provider in the path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ authorization_url: "https://example.test/auth" }));
    await startEmailHubOAuth("ws1", "a/b" as string as EmailHubOAuthProvider);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/email-hub/oauth/a%2Fb/start");
  });

  it("startEmailHubOAuth degrades to null when the response is malformed", async () => {
    for (const body of [{}, { authorization_url: 7 }, { authorization_url: "" }, null]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(startEmailHubOAuth("ws1", "google")).resolves.toBeNull();
    }
  });
```

1c. In `packages/core/email-hub/hooks.test.ts`, replace the import block (lines 1-9):

```ts
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { getEmailHubProviders, startEmailHubOAuth } from "../api/endpoints/email-hub";
import {
  emailHubHasReadableBody,
  emailHubKeys,
  flushEmailHubListRefresh,
  invalidateEmailHubReadingCachesForAccount,
  invalidateEmailHubThreadsForAccount,
  setEmailHubListRefreshPaused,
  useEmailHubProviders,
  useStartEmailHubOAuth,
} from "./hooks";

// Only the two OAuth calls are faked; the cache helpers the other cases use never reach the transport.
vi.mock("../api/endpoints/email-hub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/endpoints/email-hub")>()),
  getEmailHubProviders: vi.fn(() => Promise.resolve({ google: true, microsoft: false })),
  startEmailHubOAuth: vi.fn(() => Promise.resolve("https://accounts.google.com/o/oauth2/auth?state=s1")),
}));

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}
```

1d. Append to the end of `packages/core/email-hub/hooks.test.ts`:

```ts
describe("email hub OAuth hooks", () => {
  it("useEmailHubProviders caches under emailHubKeys.providers(wsId)", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useEmailHubProviders("ws1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getEmailHubProviders).toHaveBeenCalledWith("ws1");
    expect(emailHubKeys.providers("ws1")).toEqual(["email-hub", "ws1", "providers"]);
    expect(qc.getQueryData(emailHubKeys.providers("ws1"))).toEqual({ google: true, microsoft: false });
  });

  it("useStartEmailHubOAuth resolves the authorization URL for the provider and hint", async () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useStartEmailHubOAuth("ws1"), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ provider: "google", loginHint: "an@gmail.com" })).resolves.toBe(
      "https://accounts.google.com/o/oauth2/auth?state=s1",
    );
    expect(startEmailHubOAuth).toHaveBeenCalledWith("ws1", "google", "an@gmail.com");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false api/endpoints/email-hub.test.ts email-hub/hooks.test.ts
```

Expected: the new cases fail with `TypeError: getEmailHubProviders is not a function`, `TypeError: startEmailHubOAuth is not a function`, `TypeError: useEmailHubProviders is not a function`, `TypeError: useStartEmailHubOAuth is not a function`. Existing cases pass.

- [ ] **Step 3: Minimal implementation**

3a. In `packages/core/types/email-hub.ts`, insert after the closing `});` of `EmailHubAccountSchema` (line 22):

```ts

/** Which sign-in buttons to show. Anything but `true`, a missing key included, hides that provider. */
export const EmailHubProvidersSchema = z.object({
  google: z.boolean().catch(false),
  microsoft: z.boolean().catch(false),
});

export const EmailHubOAuthStartSchema = z.object({
  authorization_url: z.string(),
});
```

After `export type EmailHubAccount = z.infer<typeof EmailHubAccountSchema>;` (line 142):

```ts
export type EmailHubProviders = z.infer<typeof EmailHubProvidersSchema>;
export type EmailHubOAuthProvider = "google" | "microsoft";
```

3b. In `packages/core/api/endpoints/email-hub.ts`, replace the import block (lines 2-23):

```ts
import {
  EmailHubAccountListSchema,
  EmailHubAccountSchema,
  EmailHubOAuthStartSchema,
  EmailHubProvidersSchema,
  EmailHubSyncSchema,
  EmailHubSidebarCountsSchema,
  EmailHubUnreadSchema,
  EmailHubConversationSchema,
  EmailHubThreadListSchema,
  EmailHubThreadSchema,
  EmailHubThreadSummarySchema,
  EmailHubInboxWatchSchema,
  EmailHubImapLabelListSchema,
  EmailHubWatchSchema,
  type EmailHubAccount,
  type EmailHubCustomServer,
  type EmailHubOAuthProvider,
  type EmailHubProviders,
  type EmailHubThreadSummary,
  type EmailHubInboxWatch,
  type EmailHubSync,
  type EmailHubThread,
  type EmailHubThreadFilters,
  type EmailHubWatch,
} from "../../types/email-hub";
```

After `const EMPTY_SIDEBAR_COUNTS = { inbox_unread: 0, snoozed_total: 0 };` (line 36):

```ts
const EMPTY_PROVIDERS: EmailHubProviders = { google: false, microsoft: false };
```

After `disconnectEmailHubAccount` (ends at line 80):

```ts

export async function getEmailHubProviders(workspaceId: string): Promise<EmailHubProviders> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/providers`);
  return parseWithFallback(raw, EmailHubProvidersSchema, EMPTY_PROVIDERS, {
    endpoint: "GET /api/v1/workspaces/{ws}/email-hub/providers",
  });
}

/** The provider's sign-in URL for the popup, or null when the answer carries none. */
export async function startEmailHubOAuth(
  workspaceId: string,
  provider: EmailHubOAuthProvider,
  loginHint?: string,
): Promise<string | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/oauth/${enc(provider)}/start`, {
    method: "POST",
    // Always a JSON object: the handler's decode answers 400 to an empty body.
    body: loginHint ? { login_hint: loginHint } : {},
  });
  const parsed = parseWithFallback<{ authorization_url: string } | null>(raw, EmailHubOAuthStartSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/oauth/{provider}/start",
  });
  return parsed?.authorization_url || null;
}
```

3c. In `packages/core/email-hub/query-cache.ts`, add after `accounts` (line 11) in `emailHubKeys`:

```ts
  providers: (wsId: string) => ["email-hub", wsId, "providers"] as const,
```

3d. In `packages/core/email-hub/hooks.ts`, replace line 8:

```ts
import type {
  EmailHubCustomServer,
  EmailHubOAuthProvider,
  EmailHubThread,
  EmailHubThreadFilters,
} from "../types/email-hub";
```

After `useDisconnectEmailHubAccount` (ends at line 248):

```ts

export function useEmailHubProviders(wsId: string) {
  return useQuery({
    queryKey: emailHubKeys.providers(wsId),
    queryFn: () => api.getEmailHubProviders(wsId),
    // Server configuration: it changes on a deploy, not while the dialog is open.
    staleTime: 5 * 60_000,
  });
}

/** Resolves the sign-in URL. The account appears only after the callback, so the cache is left alone here. */
export function useStartEmailHubOAuth(wsId: string) {
  return useMutation({
    mutationFn: (input: { provider: EmailHubOAuthProvider; loginHint?: string }) =>
      api.startEmailHubOAuth(wsId, input.provider, input.loginHint),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false api/endpoints/email-hub.test.ts email-hub/hooks.test.ts
```

Expected: every case passes. `z.boolean().catch(false)` also catches a missing key, so `{ google: "yes" }` parses to both false; `null` and `[]` fall back to `EMPTY_PROVIDERS`.

- [ ] **Step 5: Typecheck, lint and knip**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/core typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && pnpm exec eslint --max-warnings 0 types/email-hub.ts api/endpoints/email-hub.ts api/endpoints/email-hub.test.ts email-hub/query-cache.ts email-hub/hooks.ts email-hub/hooks.test.ts
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm knip
```

Expected: typecheck clean; eslint 0 problems (`api/endpoints/email-hub.ts` ~434 counted lines, `hooks.ts` ~265); knip reports nothing new (both endpoints are imported by `hooks.ts`, schemas and both types by the endpoint file, both hooks by `hooks.test.ts`; Task 10 adds the production consumers).

- [ ] **Step 6: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add packages/core/types/email-hub.ts packages/core/api/endpoints/email-hub.ts \
  packages/core/api/endpoints/email-hub.test.ts packages/core/email-hub/query-cache.ts \
  packages/core/email-hub/hooks.ts packages/core/email-hub/hooks.test.ts
git commit -m "feat(email-hub): client endpoints and hooks for OAuth providers and start" \
  -m "The connect dialog has to know which sign-in buttons the server can serve, and it has to fetch the provider's sign-in URL for the popup. getEmailHubProviders degrades to both hidden, so a drifted answer never shows a button whose start would 404. startEmailHubOAuth always sends a JSON object, because the handler's decode refuses an empty body. It carries login_hint only when the hint is set, and it returns null when the answer has no URL. The providers query is server configuration, so it stays fresh for five minutes. The start mutation leaves the cache alone: the account exists only after the callback, and the dialog refetches the accounts on the popup's outcome. Left out: the popup helper, the Google/Microsoft buttons and the OAuth reconnect (Tasks 9 and 10), and narrowing EmailHubAccount.auth_kind, which stays a string so an unknown kind still parses; Task 10 switches over it with a default." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Extract use-oauth-popup and move the calendar onto it

**Files:**
- Create: `packages/views/integrations/use-oauth-popup.ts` (new directory; views import it by relative path, so no `package.json` exports entry)
- Create: `packages/views/integrations/use-oauth-popup.test.tsx`
- Modify: `packages/views/calendar/calendar-connections-dialog.tsx` (366 lines): the hook import after line 50; `connect()` (lines 68-96); line 215 `onClick={() => void connect(provider)}` loses the `void`.
- Test: the calendar dialog has no test file; its three paths (blocked/failed → error, closed → refetch) are pinned through the hook's test.

**Interfaces:**
- Consumes: `runtimeConfig()` from `@uniwork/core/runtime-config` (`apiUrl`); in tests `configureRuntime` / `resetRuntimeConfig`. `startCalendarConnection(workspaceId, provider): Promise<string>` (unchanged, `""` when malformed).
- Produces:
  - `export type OAuthPopupOutcome = { kind: "blocked" } | { kind: "failed" } | { kind: "closed" } | { kind: "message"; ok: boolean; code: string }`
  - `export function useOAuthPopup(opts: { name: string; messageType?: string; onOutcome: (outcome: OAuthPopupOutcome) => void }): { open: (start: () => Promise<string | null | undefined>) => void; pending: boolean }`
  - Contract: each accepted `open()` reports exactly one outcome; an `open()` while one is running is ignored (the window name is shared); nothing is reported after unmount, and a popup whose URL arrives after unmount is closed; a message is accepted only when `event.origin === new URL(runtimeConfig().apiUrl, window.location.href).origin`, `event.source === popup`, `data.type === messageType` and `typeof data.code === "string"` (`ok` is `data.ok === true`); without `messageType` no listener is attached and only the 400ms closed poll reports.

- [ ] **Step 1: Write the failing test**

Create `packages/views/integrations/use-oauth-popup.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { useOAuthPopup, type OAuthPopupOutcome } from "./use-oauth-popup";

const API = "https://api.uniwork.test";
const TYPE = "uniwork:email-hub-oauth";
const AUTH_URL = "https://accounts.google.test/o/oauth2/v2/auth?state=s";

type FakePopup = { closed: boolean; close: () => void; location: { href: string } };
type Start = () => Promise<string | null | undefined>;

function fakePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    location: { href: "" },
  };
  return popup;
}

function post(source: unknown, data: unknown, origin = API) {
  const event = new MessageEvent("message", { data, origin });
  // jsdom only accepts a real Window as MessageEventInit.source, so the fake popup is attached by hand.
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

function setup(messageType: string | undefined = TYPE) {
  const onOutcome = vi.fn<(outcome: OAuthPopupOutcome) => void>();
  const hook = renderHook(() =>
    useOAuthPopup({ name: "uniwork-test-oauth", messageType, onOutcome }),
  );
  return { onOutcome, hook };
}

async function openWith(hook: ReturnType<typeof setup>["hook"], start: Start) {
  await act(async () => {
    hook.result.current.open(start);
  });
}

function tick() {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

let popup: FakePopup;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  configureRuntime({ apiUrl: API });
  popup = fakePopup();
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetRuntimeConfig();
});

describe("useOAuthPopup", () => {
  it("reports a blocked popup without starting or going pending", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    const { onOutcome, hook } = setup();
    const start = vi.fn<Start>();

    await openWith(hook, start);

    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "uniwork-test-oauth",
      "popup,width=560,height=720",
    );
    expect(start).not.toHaveBeenCalled();
    expect(onOutcome.mock.calls).toEqual([[{ kind: "blocked" }]]);
    expect(hook.result.current.pending).toBe(false);
  });

  it.each([
    ["start rejects", () => Promise.reject(new Error("boom"))],
    ["start returns no URL", () => Promise.resolve("")],
  ])("closes the popup and reports failed when %s", async (_, start: Start) => {
    const { onOutcome, hook } = setup();

    await openWith(hook, start);

    expect(popup.close).toHaveBeenCalled();
    expect(onOutcome.mock.calls).toEqual([[{ kind: "failed" }]]);
    expect(hook.result.current.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores foreign messages, then reports the popup's message once", async () => {
    const { onOutcome, hook } = setup();

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    expect(popup.location.href).toBe(AUTH_URL);
    expect(hook.result.current.pending).toBe(true);

    post(popup, { type: TYPE, ok: true, code: "connected" }, "https://evil.test");
    post(popup, { type: "uniwork:other", ok: true, code: "connected" });
    post({}, { type: TYPE, ok: true, code: "connected" });
    post(popup, { type: TYPE, ok: true, code: 1 });
    post(popup, "connected");
    expect(onOutcome).not.toHaveBeenCalled();

    post(popup, { type: TYPE, ok: "yes", code: "already_connected" });
    expect(onOutcome.mock.calls).toEqual([
      [{ kind: "message", ok: false, code: "already_connected" }],
    ]);
    expect(hook.result.current.pending).toBe(false);

    popup.closed = true;
    tick();
    post(popup, { type: TYPE, ok: true, code: "connected" });
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports closed when the popup closes without a message", async () => {
    const { onOutcome, hook } = setup(undefined);

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    // Without messageType no listener is attached: even a well-formed message is not an outcome.
    post(popup, { type: TYPE, ok: true, code: "connected" });
    tick();
    expect(onOutcome).not.toHaveBeenCalled();

    popup.closed = true;
    tick();
    tick();

    expect(onOutcome.mock.calls).toEqual([[{ kind: "closed" }]]);
    expect(hook.result.current.pending).toBe(false);
  });

  it("reports nothing after unmount and leaves no listener or interval", async () => {
    const { onOutcome, hook } = setup();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    await openWith(hook, () => Promise.resolve(AUTH_URL));
    hook.unmount();

    expect(removeSpy).toHaveBeenCalledWith("message", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    post(popup, { type: TYPE, ok: true, code: "connected" });
    popup.closed = true;
    tick();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("closes a popup whose URL arrives after unmount", async () => {
    const { onOutcome, hook } = setup();
    let resolve: (url: string) => void = () => {};
    const start = () =>
      new Promise<string>((r) => {
        resolve = r;
      });

    await openWith(hook, start);
    hook.unmount();
    await act(async () => {
      resolve(AUTH_URL);
    });

    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("");
    expect(onOutcome).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false integrations/use-oauth-popup.test.tsx
```

Expected: FAIL with `Failed to resolve import "./use-oauth-popup" from "integrations/use-oauth-popup.test.tsx"`.

- [ ] **Step 3: Implement the hook**

Create `packages/views/integrations/use-oauth-popup.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "@uniwork/core/runtime-config";

export type OAuthPopupOutcome =
  | { kind: "blocked" }
  | { kind: "failed" }
  | { kind: "closed" }
  | { kind: "message"; ok: boolean; code: string };

const POPUP_FEATURES = "popup,width=560,height=720";
const CLOSED_POLL_MS = 400;

/**
 * Runs one OAuth sign-in in a popup. Call open() from the click handler: the
 * window opens synchronously on about:blank so popup blockers let it through,
 * and only then is the authorization URL awaited. Each accepted open() reports
 * exactly one outcome, and nothing is reported after unmount.
 */
export function useOAuthPopup({
  name,
  messageType,
  onOutcome,
}: {
  name: string;
  messageType?: string;
  onOutcome: (outcome: OAuthPopupOutcome) => void;
}): { open: (start: () => Promise<string | null | undefined>) => void; pending: boolean } {
  const [pending, setPending] = useState(false);
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const open = useCallback(
    (start: () => Promise<string | null | undefined>) => {
      // One popup at a time: the window name is shared, so a second open would retarget the first.
      if (stopRef.current) return;
      const popup = window.open("about:blank", name, POPUP_FEATURES);
      if (!popup) {
        onOutcomeRef.current({ kind: "blocked" });
        return;
      }
      let done = false;
      let timer: number | undefined;
      let onMessage: ((event: MessageEvent) => void) | undefined;
      const stop = () => {
        done = true;
        stopRef.current = null;
        window.clearInterval(timer);
        if (onMessage) window.removeEventListener("message", onMessage);
      };
      const finish = (outcome: OAuthPopupOutcome) => {
        if (done) return;
        stop();
        setPending(false);
        onOutcomeRef.current(outcome);
      };
      stopRef.current = stop;
      setPending(true);
      void (async () => {
        let url: string | null | undefined;
        try {
          url = await start();
        } catch {
          url = null;
        }
        if (done) {
          // Unmounted while the URL was on its way: leave no orphan window.
          popup.close();
          return;
        }
        if (!url) {
          popup.close();
          finish({ kind: "failed" });
          return;
        }
        popup.location.href = url;
        if (messageType) {
          // A relative apiUrl (same-origin proxy) resolves against the page instead of throwing.
          const origin = new URL(runtimeConfig().apiUrl, window.location.href).origin;
          onMessage = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== popup) return;
            const data: unknown = event.data;
            if (typeof data !== "object" || data === null) return;
            const { type, ok, code } = data as Record<string, unknown>;
            if (type !== messageType || typeof code !== "string") return;
            finish({ kind: "message", ok: ok === true, code });
          };
          window.addEventListener("message", onMessage);
        }
        timer = window.setInterval(() => {
          if (popup.closed) finish({ kind: "closed" });
        }, CLOSED_POLL_MS);
      })();
    },
    [name, messageType],
  );

  return { open, pending };
}
```

Assigning the ref during render follows `packages/views/chat/use-chat-message-deep-link.ts:38`; reading it in the effect cleanup follows `packages/views/office/pdf/print/use-pdf-print.ts:50`.

- [ ] **Step 4: Move the calendar onto the hook**

In `packages/views/calendar/calendar-connections-dialog.tsx`:

1. After the `./calendar-provider-icons` import (line 50):

```tsx
import { CalendarProviderIcon } from "./calendar-provider-icons";
import { useOAuthPopup } from "../integrations/use-oauth-popup";
```

2. Replace `connect` (lines 68-96, from `const connect = async (provider: CalendarProvider) => {` through its closing `};`) with:

```tsx
  // The calendar callback page only closes itself, so the closed poll is the signal.
  const oauthPopup = useOAuthPopup({
    name: "uniwork-calendar-oauth",
    onOutcome: (outcome) => {
      setConnecting(null);
      if (outcome.kind === "blocked" || outcome.kind === "failed") setError(true);
      else void refreshCalendar();
    },
  });

  const connect = (provider: CalendarProvider) => {
    setError(false);
    setConnecting(provider);
    oauthPopup.open(() => startCalendarConnection(workspaceId, provider));
  };
```

3. Line 215: replace `onClick={() => void connect(provider)}` with `onClick={() => connect(provider)}`.

`useState` and `startCalendarConnection` stay imported. Behaviour is unchanged (blocked → error; start throws or `""` → popup closed, error; closed → `connecting` cleared and `calendarKeys.all(workspaceId)` invalidated; `connecting` still disables the trigger). The poll is now also cleared on unmount, which used to leak.

- [ ] **Step 5: Run the tests and targeted gates**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false integrations/use-oauth-popup.test.tsx calendar
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/views typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && pnpm exec eslint --max-warnings 0 integrations/use-oauth-popup.ts integrations/use-oauth-popup.test.tsx calendar/calendar-connections-dialog.tsx
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm knip
```

Expected: vitest PASS (7 hook tests plus the calendar suite); typecheck clean; eslint 0 problems; knip clean (`useOAuthPopup` is used by the calendar dialog, `OAuthPopupOutcome` by the test; Task 10 adds the second production consumer).

- [ ] **Step 6: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && git add packages/views/integrations/use-oauth-popup.ts \
  packages/views/integrations/use-oauth-popup.test.tsx \
  packages/views/calendar/calendar-connections-dialog.tsx
git commit -m "refactor(email-hub): extract the OAuth popup into use-oauth-popup and move the calendar onto it" \
  -m "Email Hub's Google and Microsoft sign-in needs the same popup the calendar opens: about:blank synchronously inside the click so blockers let it through, then the authorization URL, then a closed poll. The hook adds what Email Hub needs on top: an optional postMessage listener that accepts a message only from the API origin in runtime config, from that popup and with the expected type, and exactly one outcome per open. The listener and the poll are removed on the outcome and on unmount, which the calendar used to leak. The calendar passes no message type, because its callback page only closes itself, and keeps its behaviour: blocked or failed shows the error, closed refetches. Left out: the Email Hub consumer (next task), and a calendar dialog test, since the hook's test pins the three paths it maps." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Connect dialog: Google/Microsoft buttons, OAuth results, OAuth reconnect with login_hint; settings card removed

**Files:**
- Create: `packages/views/email-hub/connect-method-step.tsx` (the method step and the single provider card an OAuth reconnect reuses)
- Modify: `packages/views/email-hub/connect-account-dialog.tsx` (whole file replaced; ~299 non-blank lines)
- Test: `packages/views/email-hub/connect-account-dialog.test.tsx`: the header block (lines 1-56) replaced, one `describe` appended; GD2 cases unchanged.
- Modify: `packages/views/email-hub/connect-account-errors.ts` (append `oauthResultKey`)
- Create (test): `packages/views/email-hub/connect-account-errors.test.ts`
- Modify: `packages/views/email-hub/use-email-hub-account-panel.ts:42` (comment only)
- Modify: `packages/views/settings/components/integrations-tab.tsx`: `:3` drop the `Mail` import; `:21-28` `PLANNED` keeps only `webhooks`; `:30-35` doc comment.
- Test: `packages/views/settings/components/integrations-tab.test.tsx`, lines 32-38 and 54-64
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`
- Not modified: `packages/views/email-hub/email-hub-view.tsx` (line cap); `email-hub-view-dialogs.tsx` already passes `reconnectEmail` through.

**Interfaces:**
- Consumes:
  - Task 8: `useEmailHubProviders(wsId)` (`data` undefined while loading/failed), `useStartEmailHubOAuth(wsId).mutateAsync({ provider, loginHint? })` → `string | null`, `emailHubKeys.accounts(wsId)` (re-exported from `@uniwork/core/email-hub/hooks`), types `EmailHubOAuthProvider` and `EmailHubProviders` from `@uniwork/core/types/email-hub`.
  - Task 9: `useOAuthPopup({ name, messageType?, onOutcome })` → `{ open(start), pending }` and `type OAuthPopupOutcome`. It checks `event.origin`, `event.source === popup` and `data.type`, so dialog tests attach the fake popup as `source`.
  - Task 6: message `{ type: "uniwork:email-hub-oauth", ok, code }` with `code` ∈ `connected | denied | state_invalid | email_unavailable | imap_not_enabled | smtp_disabled | already_connected | consent_required | failed`.
  - GD1/GD2: `ConnectCustomServerForm`, `ConnectAppPasswordGuideDialog`, `pickerCardClass` (`../onboarding/components/option-card`), `FormDialogBody/Content/Footer/Header`, `connectError`, `EmailHubAccount.auth_kind` (lenient string) and `.provider`.
- Produces:
  - `ConnectMethodStep({ providers, pending, onPick, onOAuth })` (`providers: EmailHubProviders | undefined`, `pending: boolean`, `onPick: (method: "custom" | "app_password") => void`, `onOAuth: (provider: EmailHubOAuthProvider) => void`)
  - `OAuthProviderButton({ provider, pending, onClick })`
  - `oauthResultKey(code: string): string` (switch, `default` → `email_hub.connect.error_oauth_failed`; `already_connected` and `smtp_disabled` reuse the existing keys)
  - Dialog behaviour: a new connect shows the Google card (if `providers.google`), the Microsoft card (if `providers.microsoft`), the Own domain card, then the `method_app_password_hint` sentence with the `method_app_password` text link. OAuth outcomes: `message ok` → invalidate `emailHubKeys.accounts(wsId)` and `onOpenChange(false)`; `message !ok` → alert `t(oauthResultKey(code))`; `blocked` → `error_popup_blocked`; `failed` → `error_oauth_failed`; `closed` → invalidate the accounts, no error. Reconnect: `auth_kind` `oauth_google` / `oauth_microsoft` shows `reconnect.dialog_description_oauth` and one provider card that starts with `loginHint = reconnectEmail`; any other `auth_kind` (the switch `default`) keeps the GD2 logic.
  - New flat i18n keys (en+vi): `email_hub.connect.method_google`, `method_google_hint`, `method_microsoft`, `method_microsoft_hint`, `error_popup_blocked`, `error_oauth_denied`, `error_oauth_state_invalid`, `error_oauth_email_unavailable`, `error_oauth_imap_not_enabled`, `error_oauth_consent_required`, `error_oauth_failed`; `email_hub.reconnect.dialog_description_oauth`. Removed: `settings.integrations.mail_oauth`. Rewritten: `settings.integrations.email_hub.meta`, `email_hub.connect.method_description`, `email_hub.connect.method_app_password_hint`, `email_hub.onboarding.body`, `email_hub.disconnect_confirm_body`.

- [ ] **Step 1: Write the failing tests**

Create `packages/views/email-hub/connect-account-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { oauthResultKey } from "./connect-account-errors";

const i18n = initI18n();

describe("oauthResultKey", () => {
  it.each([
    ["denied", "email_hub.connect.error_oauth_denied"],
    ["state_invalid", "email_hub.connect.error_oauth_state_invalid"],
    ["email_unavailable", "email_hub.connect.error_oauth_email_unavailable"],
    ["imap_not_enabled", "email_hub.connect.error_oauth_imap_not_enabled"],
    ["smtp_disabled", "email_hub.connect.error_smtp_disabled"],
    ["already_connected", "email_hub.connect.error_already_connected"],
    ["consent_required", "email_hub.connect.error_oauth_consent_required"],
    ["failed", "email_hub.connect.error_oauth_failed"],
  ])("maps %s to %s, a sentence in both locales", (code, key) => {
    expect(oauthResultKey(code)).toBe(key);
    for (const lng of ["vi", "en"]) expect(i18n.exists(key, { lng }), `${lng} ${key}`).toBe(true);
  });

  it.each(["", "constructor", "a_code_from_a_newer_server"])("falls back to the generic sentence for %j", (code) => {
    expect(oauthResultKey(code)).toBe("email_hub.connect.error_oauth_failed");
  });
});
```

In `packages/views/email-hub/connect-account-dialog.test.tsx`, replace everything from line 1 through the end of `fillAndSubmit` (line 56) with:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { runtimeConfig } from "@uniwork/core/runtime-config";
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

const microsoftJSON = {
  id: "acc3",
  email_address: "lan@contoso.vn",
  provider: "outlook",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "oauth_microsoft",
  needs_reconnect: true,
  auth_failed_reason: "oauth_invalid_grant",
};

const ACCOUNTS_PATH = "/api/v1/workspaces/ws1/email-hub/accounts";
const PROVIDERS_PATH = "/api/v1/workspaces/ws1/email-hub/providers";
const startPath = (provider: string) => `/api/v1/workspaces/ws1/email-hub/oauth/${provider}/start`;
const AUTH_URL = "https://login.example.test/authorize?state=s";
const NO_PROVIDERS = { google: false, microsoft: false };
const BOTH = { google: true, microsoft: true };

/** The dialog reads the account list (GET) and connects with a POST to the same path; OAuth reads providers and posts start. */
function serve(
  list: unknown,
  connect: () => Promise<unknown> = () => Promise.resolve(accountJSON),
  oauth: { providers?: unknown; start?: () => Promise<unknown> } = {},
) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === PROVIDERS_PATH) return Promise.resolve(oauth.providers ?? NO_PROVIDERS);
    if (path.endsWith("/start")) return oauth.start ? oauth.start() : Promise.resolve({ authorization_url: AUTH_URL });
    if (path !== ACCOUNTS_PATH) return Promise.resolve({});
    return opts?.method === "POST" ? connect() : Promise.resolve(list);
  });
}

beforeEach(() => {
  requestMock.mockReset();
  serve({ accounts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const customOption = () => screen.getByRole("button", { name: /^Tên miền riêng \(IMAP\/SMTP\)/ });
const appPasswordOption = () => screen.getByRole("button", { name: /^Dùng mật khẩu ứng dụng/ });
const googleOption = () => screen.queryByRole("button", { name: /^Đăng nhập bằng Google/ });
const microsoftOption = () => screen.queryByRole("button", { name: /^Đăng nhập bằng Microsoft/ });

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
}

type FakePopup = { closed: boolean; close: () => void; location: { href: string } };

/** window.open answers a fake popup; the dialog only points it at a URL or closes it. */
function fakePopup() {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    location: { href: "" },
  };
  const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return { popup, open };
}

type RequestCall = [string, { method?: string; body?: { login_hint?: string } }?];
const calls = () => requestMock.mock.calls as RequestCall[];
const startCall = (provider: string) => calls().find(([path]) => path === startPath(provider));
const accountListReads = () => calls().filter(([path, opts]) => path === ACCOUNTS_PATH && opts?.method !== "POST").length;

/** What the callback page posts to its opener (spec §5.4), from the API origin and the popup the hook trusts. */
function postResult(popup: FakePopup, ok: boolean, code: string) {
  const event = new MessageEvent("message", {
    origin: new URL(runtimeConfig().apiUrl, window.location.href).origin,
    data: { type: "uniwork:email-hub-oauth", ok, code },
  });
  // jsdom refuses a non-Window MessageEventInit.source; the hook checks event.source === popup.
  Object.defineProperty(event, "source", { value: popup });
  act(() => {
    window.dispatchEvent(event);
  });
}

async function startGoogleSignIn(popup: FakePopup) {
  fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ }));
  await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
}
```

At the end of the same file, after the closing `});` of `describe("ConnectAccountDialog", …)`, append:

```tsx
describe("ConnectAccountDialog sign-in with Google or Microsoft", () => {
  it.each([
    ["neither", NO_PROVIDERS, false, false],
    ["Google only", { google: true, microsoft: false }, true, false],
    ["both", BOTH, true, true],
  ])("offers %s on the method step, as the server enables them", async (_, providers, google, microsoft) => {
    serve({ accounts: [] }, undefined, { providers });
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === PROVIDERS_PATH)).toBe(true));
    await act(async () => {});
    await waitFor(() => {
      expect(googleOption() !== null).toBe(google);
      expect(microsoftOption() !== null).toBe(microsoft);
    });
    // The password ways stay either way: the own-domain card, and the app password demoted to a text link.
    expect(customOption()).toBeInTheDocument();
    expect(appPasswordOption()).toHaveClass("underline");
  });

  it("opens the popup on the click, before start answers, and sends no login_hint for a new mailbox", async () => {
    let answer: (value: unknown) => void = () => {};
    serve({ accounts: [] }, undefined, {
      providers: BOTH,
      start: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const { popup, open } = fakePopup();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fireEvent.click(await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ }));

    // In the click's own task, so the browser counts it as user-initiated and does not block it.
    expect(open.mock.calls[0]?.slice(0, 2)).toEqual(["about:blank", "uniwork-email-oauth"]);
    await waitFor(() => expect(startCall("google")).toBeDefined());
    expect(popup.location.href).toBe("");
    expect(startCall("google")?.[1]?.method).toBe("POST");
    expect(startCall("google")?.[1]?.body?.login_hint).toBeUndefined();

    await act(async () => answer({ authorization_url: AUTH_URL }));
    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
  });

  it("closes the dialog and refetches the accounts when the popup reports connected", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);
    const reads = accountListReads();

    postResult(popup, true, "connected");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(reads));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refetches the accounts without an error when the popup closes with no message", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);
    const reads = accountListReads();

    popup.closed = true;

    // The real 400ms poll: no fake timers needed.
    await waitFor(() => expect(accountListReads()).toBeGreaterThan(reads), { timeout: 2000 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    ["imap_not_enabled", "Đăng nhập được nhưng hộp thư này đang tắt IMAP"],
    ["denied", "quản trị viên của tổ chức cần duyệt UniWork"],
    ["a_code_from_a_newer_server", "Không hoàn tất được việc đăng nhập."],
  ])("reads the %s result out as a sentence and keeps the dialog open", async (code, text) => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    const onOpenChange = vi.fn();
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={onOpenChange} />));
    await startGoogleSignIn(popup);

    postResult(popup, false, code);

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("says the popup was blocked, without calling start or staying busy", async () => {
    serve({ accounts: [] }, undefined, { providers: BOTH });
    vi.spyOn(window, "open").mockReturnValue(null);
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));
    const google = await screen.findByRole("button", { name: /^Đăng nhập bằng Google/ });

    fireEvent.click(google);

    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt đã chặn cửa sổ đăng nhập");
    expect(startCall("google")).toBeUndefined();
    expect(google).toBeEnabled();
  });

  it("reconnects a Microsoft mailbox with one sign-in button that hints its address", async () => {
    serve({ accounts: [microsoftJSON] }, undefined, { providers: BOTH });
    const { popup } = fakePopup();
    render(wrap(<ConnectAccountDialog wsId="ws1" open reconnectEmail="lan@contoso.vn" onOpenChange={() => {}} />));

    const microsoft = await screen.findByRole("button", { name: /^Đăng nhập bằng Microsoft/ });
    expect(screen.getByText("Kết nối lại lan@contoso.vn")).toBeInTheDocument();
    expect(screen.getByText(/^Đăng nhập lại bằng đúng tài khoản này/)).toBeInTheDocument();
    expect(googleOption()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Tên miền riêng/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dùng mật khẩu ứng dụng/ })).toBeNull();
    expect(screen.queryByLabelText("App Password")).toBeNull();

    fireEvent.click(microsoft);

    await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
    expect(startCall("microsoft")?.[1]).toEqual(
      expect.objectContaining({ method: "POST", body: expect.objectContaining({ login_hint: "lan@contoso.vn" }) }),
    );
  });
});
```

The GD2 password and custom reconnect cases above it are unchanged; they pin that a `password` account keeps the GD2 forms (providers default to off, and `/^Dùng mật khẩu ứng dụng/` still finds the link by its text).

In `packages/views/settings/components/integrations-tab.test.tsx`, replace the first case (lines 32-38) with:

```tsx
  it("lists Email Hub as the real connection, linked to the Email screen", async () => {
    renderTab([]);
    const available = screen.getByRole("list", { name: "Dùng được" });
    expect(within(available).getByText("Email Hub")).toBeInTheDocument();
    expect(within(available).getByText(/^Đăng nhập bằng Google hoặc Microsoft/)).toBeInTheDocument();
    expect(await within(available).findByText("Bạn chưa kết nối")).toBeInTheDocument();
    expect(within(available).getByRole("link", { name: "Kết nối hộp thư" })).toHaveAttribute("href", "/acme/team/email");
  });
```

Replace the last case (lines 54-64) with:

```tsx
  it("shows only documented plans, locked, and prints the description once", () => {
    renderTab([]);
    const planned = screen.getByRole("list", { name: "Trong lộ trình" });
    expect(within(planned).getAllByText("Sắp có")).toHaveLength(1);
    expect(within(planned).getByText("Webhook")).toBeInTheDocument();
    // Google and Microsoft sign-in shipped inside Email Hub (GĐ3); it is no longer a plan.
    expect(within(planned).queryByText("Gmail và Microsoft 365")).toBeNull();
    expect(within(planned).queryByRole("link")).toBeNull();
    expect(within(planned).queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Slack/i)).toBeNull();
    expect(screen.getAllByText(/Nối UniWork với công cụ bạn đang dùng/)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub/connect-account-dialog.test.tsx email-hub/connect-account-errors.test.ts settings/components/integrations-tab.test.tsx
```

Expected FAIL:
- `connect-account-errors.test.ts`: all 11 rows fail with `TypeError: oauthResultKey is not a function`.
- Dialog: the three `offers …` rows fail ("neither" at `toHaveClass("underline")`, the others inside `waitFor` on `googleOption() !== null`); the popup, connected, closed, three result and blocked cases time out on `/^Đăng nhập bằng Google/`; the Microsoft reconnect case times out on `/^Đăng nhập bằng Microsoft/`. The 12 GD2 cases still pass.
- Integrations tab: the first case fails on `/^Đăng nhập bằng Google hoặc Microsoft/`, the planned case on `toHaveLength(1)` (it has 2).

- [ ] **Step 3: Implement**

Append to `packages/views/email-hub/connect-account-errors.ts`:

```ts
/** The sentence for an OAuth callback result (spec §5.4). "connected" closes the dialog and never reaches here. */
export function oauthResultKey(code: string): string {
  switch (code) {
    case "denied":
      return "email_hub.connect.error_oauth_denied";
    case "state_invalid":
      return "email_hub.connect.error_oauth_state_invalid";
    case "email_unavailable":
      return "email_hub.connect.error_oauth_email_unavailable";
    case "imap_not_enabled":
      return "email_hub.connect.error_oauth_imap_not_enabled";
    case "smtp_disabled":
      return "email_hub.connect.error_smtp_disabled";
    case "already_connected":
      return "email_hub.connect.error_already_connected";
    case "consent_required":
      return "email_hub.connect.error_oauth_consent_required";
    default:
      return "email_hub.connect.error_oauth_failed";
  }
}
```

Create `packages/views/email-hub/connect-method-step.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import type { EmailHubOAuthProvider, EmailHubProviders } from "@uniwork/core/types/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { pickerCardClass } from "../onboarding/components/option-card";

const OAUTH_PROVIDERS = ["google", "microsoft"] as const satisfies readonly EmailHubOAuthProvider[];
const cardClass = cn(pickerCardClass(false), "grid gap-0.5 px-4 py-3 disabled:pointer-events-none disabled:opacity-50");

/** One sign-in card: the method step lists one per enabled provider; an OAuth reconnect shows only its own. */
export function OAuthProviderButton({
  provider,
  pending,
  onClick,
}: {
  provider: EmailHubOAuthProvider;
  pending: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button type="button" className={cardClass} disabled={pending} aria-busy={pending || undefined} onClick={onClick}>
      <span className="text-body font-medium">{t(`email_hub.connect.method_${provider}`)}</span>
      <span className="text-caption text-pretty text-muted-foreground">{t(`email_hub.connect.method_${provider}_hint`)}</span>
    </button>
  );
}

/**
 * How a new mailbox connects: Google and Microsoft sign-in when the server has their client
 * (spec §5.6, Q9), then the own-domain server, then the app password as a secondary link.
 */
export function ConnectMethodStep({
  providers,
  pending,
  onPick,
  onOAuth,
}: {
  /** Undefined while loading or after a failed read: only the password ways are offered. */
  providers: EmailHubProviders | undefined;
  /** A sign-in popup is open; its cards hold still so a second click cannot open another. */
  pending: boolean;
  onPick: (method: "custom" | "app_password") => void;
  onOAuth: (provider: EmailHubOAuthProvider) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {OAUTH_PROVIDERS.filter((provider) => providers?.[provider]).map((provider) => (
          <OAuthProviderButton key={provider} provider={provider} pending={pending} onClick={() => onOAuth(provider)} />
        ))}
        <button type="button" className={cardClass} onClick={() => onPick("custom")}>
          <span className="text-body font-medium">{t("email_hub.connect.method_custom")}</span>
          <span className="text-caption text-pretty text-muted-foreground">{t("email_hub.connect.method_custom_hint")}</span>
        </button>
      </div>
      <p className="text-caption text-pretty text-muted-foreground">
        {t("email_hub.connect.method_app_password_hint")}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground"
          onClick={() => onPick("app_password")}
        >
          {t("email_hub.connect.method_app_password")}
        </button>
      </p>
    </div>
  );
}
```

Replace `packages/views/email-hub/connect-account-dialog.tsx` with:

```tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  emailHubKeys,
  useConnectEmailHubAccount,
  useEmailHubAccounts,
  useEmailHubProviders,
  useStartEmailHubOAuth,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubOAuthProvider } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { useOAuthPopup, type OAuthPopupOutcome } from "../integrations/use-oauth-popup";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";
import { connectError, oauthResultKey } from "./connect-account-errors";
import { ConnectCustomServerForm } from "./connect-custom-server-form";
import { ConnectMethodStep, OAuthProviderButton } from "./connect-method-step";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
  /** Reconnect this mailbox: the address is fixed; the dialog picks the way back in by the account's auth_kind and provider. */
  reconnectEmail?: string;
}

const FORM_ID = "email-hub-connect-form";
const CUSTOM_FORM_ID = "email-hub-custom-form";
type Method = "choose" | "custom" | "app_password";

/** The provider an OAuth mailbox signs in again with; null for a password mailbox. */
function oauthProviderOf(authKind: string | undefined): EmailHubOAuthProvider | null {
  switch (authKind) {
    case "oauth_google":
      return "google";
    case "oauth_microsoft":
      return "microsoft";
    default:
      return null;
  }
}

export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected, reconnectEmail: reconnectProp }: ConnectAccountDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // Hosts clear the address as they close; keep the reconnect form on screen until the exit animation ends.
  const [reconnectEmail, setReconnectEmail] = useState(reconnectProp);
  if (open && reconnectProp !== reconnectEmail) setReconnectEmail(reconnectProp);
  // An i18n key: the OAuth result comes from the popup, outside any mutation's error state.
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Reset the step as the dialog opens, not as it closes, so the closing dialog keeps the form it showed.
  const [method, setMethod] = useState<Method>("choose");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMethod("choose");
      setOauthError(null);
    }
  }
  const accounts = useEmailHubAccounts(wsId);
  const providers = useEmailHubProviders(wsId);
  const startOAuth = useStartEmailHubOAuth(wsId);
  const reconnectAccount =
    reconnectEmail === undefined ? undefined : accounts.data?.accounts.find((acc) => acc.email_address === reconnectEmail);
  // A reconnect skips the step: an OAuth mailbox signs in again with its provider, a custom-server one reopens its
  // settings; any other (or one not loaded yet) asks for the app password.
  const reconnectProvider = oauthProviderOf(reconnectAccount?.auth_kind);
  const form: Method =
    reconnectEmail === undefined ? method : reconnectAccount?.provider === "custom" ? "custom" : "app_password";
  // Until the account is known (list loading, failed or without it), a custom mailbox could be showing the wrong form: hold the submit.
  const reconnectLoading = reconnectEmail !== undefined && !reconnectAccount;
  const [email, setEmail] = useState("");
  const address = reconnectEmail ?? email;
  const [password, setPassword] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const connect = useConnectEmailHubAccount(wsId);

  const refetchAccounts = () => {
    void queryClient.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
  };

  const onOAuthOutcome = (outcome: OAuthPopupOutcome) => {
    switch (outcome.kind) {
      case "message":
        if (outcome.ok) {
          refetchAccounts();
          onOpenChange(false);
        } else {
          setOauthError(oauthResultKey(outcome.code));
        }
        return;
      case "closed":
        // Closed without a message (cancelled, or the message was lost): the list says whether it connected.
        refetchAccounts();
        return;
      case "blocked":
        setOauthError("email_hub.connect.error_popup_blocked");
        return;
      default:
        setOauthError("email_hub.connect.error_oauth_failed");
    }
  };
  const popup = useOAuthPopup({ name: "uniwork-email-oauth", messageType: "uniwork:email-hub-oauth", onOutcome: onOAuthOutcome });

  const signIn = (provider: EmailHubOAuthProvider) => {
    setOauthError(null);
    // login_hint preselects the mailbox being reconnected; the server connects whichever account the user actually picks.
    popup.open(() => startOAuth.mutateAsync({ provider, loginHint: reconnectEmail }));
  };

  const serverError = connect.isError ? connectError(connect.error) : null;
  const emailError = emailInvalid
    ? t("email_hub.connect.error_email_format")
    : serverError?.field === "email"
      ? t(serverError.key)
      : null;
  const passwordError = serverError?.field === "password" ? t(serverError.key) : null;
  // The app-password form has no server fields; any other field's error reads for the whole form.
  const formError = serverError && serverError.field !== "email" && serverError.field !== "password" ? t(serverError.key) : null;
  const oauthAlert = oauthError ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
      {t(oauthError)}
    </p>
  ) : null;

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
    setOauthError(null);
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
    ? reconnectProvider
      ? t("email_hub.reconnect.dialog_description_oauth")
      : form === "custom"
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
              <ConnectMethodStep providers={providers.data} pending={popup.pending} onPick={pick} onOAuth={signIn} />
              {oauthAlert}
            </FormDialogBody>
          ) : reconnectProvider ? (
            <FormDialogBody>
              <OAuthProviderButton
                provider={reconnectProvider}
                pending={popup.pending}
                onClick={() => signIn(reconnectProvider)}
              />
              {oauthAlert}
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

Changes from GD2: the method step moved to `ConnectMethodStep` (so `cn` and `pickerCardClass` are no longer imported here); `oauthProviderOf` adds the `auth_kind` switch with its `default`; the OAuth reconnect body branches on `reconnectProvider`, not a fourth `Method`, because only a reconnect reaches it; while the list loads, a reconnect still shows the app-password form with submit held (GD2 Ruling 12) and swaps to the provider card once the account says `oauth_*`.

In `packages/views/email-hub/use-email-hub-account-panel.ts:42`, replace the comment line with:

```ts
  // The dialog picks the way back in from the account: auth_kind oauth_* opens its provider's sign-in popup with login_hint, provider "custom" reopens its server settings, any other asks for the app password.
```

In `packages/views/settings/components/integrations-tab.tsx`:
- Line 3 becomes `import { Lock, Webhook } from "lucide-react";`.
- Delete these three lines from `PLANNED`:

```tsx
  // docs/roadmap/FEATURE_ROADMAP.md A-10 (Email integration: Gmail / Microsoft
  // Graph), docs/vision/PROJECT_VISION.md §5.2 mục 18.
  { key: "mail_oauth", icon: Mail },
```

- Replace the `EmailHubRow` doc comment (lines 30-35) with:

```tsx
/**
 * Email Hub is the one connection that works today: each person links their
 * own mailbox by signing in with Google or Microsoft
 * (server/internal/service/email_hub_oauth_callback.go), with an app password for
 * Gmail, Outlook or Yahoo (server/internal/emailhub/provider.go), or on their
 * own domain's IMAP/SMTP server (server/internal/service/email_hub_connect_server.go).
 * The count is the reader's own.
 */
```

- [ ] **Step 4: Add, rewrite and remove the i18n strings (vi first, then en)**

Use Edit with these exact old values; each occurs once in its file.

`packages/core/i18n/locales/vi.json`:

| Key | Old value (match) | New value |
| --- | --- | --- |
| `settings.integrations.email_hub.meta` | `Gmail, Outlook, Yahoo hoặc máy chủ thư của tên miền riêng · mỗi người tự kết nối` | `Đăng nhập bằng Google hoặc Microsoft, hoặc dùng mật khẩu cho Yahoo và máy chủ tên miền riêng · mỗi người tự kết nối` |
| `email_hub.connect.method_description` | `Mỗi người tự kết nối hộp thư của mình. Mật khẩu được mã hóa trước khi lưu.` | `Mỗi người tự kết nối hộp thư của mình. Thông tin đăng nhập được mã hóa trước khi lưu.` |
| `email_hub.onboarding.body` | `Email Hub đọc và gửi thư qua IMAP, bằng App Password hoặc máy chủ thư của tên miền riêng. Mỗi hộp thư chỉ cần thiết lập một lần.` | `Email Hub đọc và gửi thư qua IMAP: đăng nhập bằng Google hoặc Microsoft, hoặc dùng App Password hay máy chủ thư của tên miền riêng. Mỗi hộp thư chỉ cần thiết lập một lần.` |
| `email_hub.disconnect_confirm_body` | `Email của hộp thư này sẽ không còn hiện trong UniWork. Thư trên máy chủ thư vẫn giữ nguyên; muốn dùng lại phải nhập lại mật khẩu.` | `Email của hộp thư này sẽ không còn hiện trong UniWork. Thư trên máy chủ thư vẫn giữ nguyên; muốn dùng lại phải đăng nhập hoặc nhập lại mật khẩu.` |

Delete these four lines (currently vi.json:460-463):

```json
      "mail_oauth": {
        "title": "Gmail và Microsoft 365",
        "meta": "Đăng nhập bằng tài khoản Google hoặc Microsoft, gắn thread email vào việc và dự án"
      },
```

Replace the line
`      "method_app_password_hint": "Gmail, Outlook hoặc Yahoo, bằng App Password tạo trong cài đặt tài khoản",`
with:

```json
      "method_app_password_hint": "Gmail, Outlook và Yahoo cũng kết nối được bằng App Password.",
      "method_google": "Đăng nhập bằng Google",
      "method_google_hint": "Gmail hoặc Google Workspace, không cần App Password",
      "method_microsoft": "Đăng nhập bằng Microsoft",
      "method_microsoft_hint": "Outlook.com hoặc Microsoft 365, không cần App Password",
      "error_popup_blocked": "Trình duyệt đã chặn cửa sổ đăng nhập. Cho phép cửa sổ bật lên (pop-up) với UniWork rồi thử lại.",
      "error_oauth_denied": "Bạn đã hủy đăng nhập hoặc chưa cấp quyền cho UniWork. Với Microsoft 365, có thể quản trị viên của tổ chức cần duyệt UniWork trước.",
      "error_oauth_state_invalid": "Phiên đăng nhập đã hết hạn hoặc được mở ở trình duyệt khác. Thử lại từ cửa sổ này.",
      "error_oauth_email_unavailable": "Tài khoản này không cho biết địa chỉ email đã xác minh. Đăng nhập bằng tài khoản sở hữu hộp thư.",
      "error_oauth_imap_not_enabled": "Đăng nhập được nhưng hộp thư này đang tắt IMAP. Bật IMAP trong cài đặt hộp thư, hoặc nhờ quản trị viên bật, rồi thử lại.",
      "error_oauth_consent_required": "Google hoặc Microsoft chưa cấp quyền truy cập lâu dài. Thử lại và cho phép mọi quyền UniWork yêu cầu.",
      "error_oauth_failed": "Không hoàn tất được việc đăng nhập. Thử lại.",
```

Replace the line
`      "dialog_description_custom": "Nhập lại mật khẩu hoặc sửa cài đặt máy chủ. Thư đã đồng bộ được giữ nguyên, trừ khi bạn đổi máy chủ IMAP.",`
with:

```json
      "dialog_description_custom": "Nhập lại mật khẩu hoặc sửa cài đặt máy chủ. Thư đã đồng bộ được giữ nguyên, trừ khi bạn đổi máy chủ IMAP.",
      "dialog_description_oauth": "Đăng nhập lại bằng đúng tài khoản này; chọn tài khoản khác sẽ kết nối thêm một hộp thư khác. Thư đã đồng bộ được giữ nguyên.",
```

`packages/core/i18n/locales/en.json`:

| Key | Old value (match) | New value |
| --- | --- | --- |
| `settings.integrations.email_hub.meta` | `Gmail, Outlook, Yahoo or a mail server on your own domain · each person connects their own` | `Sign in with Google or Microsoft, or use a password for Yahoo and your own domain's server · each person connects their own` |
| `email_hub.connect.method_description` | `Each person connects their own mailbox. The password is encrypted before it's stored.` | `Each person connects their own mailbox. Sign-in details are encrypted before they're stored.` |
| `email_hub.onboarding.body` | `Email Hub reads and sends through IMAP, with an app password or your own domain's mail server. Each mailbox is set up once.` | `Email Hub reads and sends through IMAP: sign in with Google or Microsoft, or use an app password or your own domain's mail server. Each mailbox is set up once.` |
| `email_hub.disconnect_confirm_body` | `Mail from this mailbox stops showing in UniWork. Nothing is deleted on the mail server; reconnecting needs the password again.` | `Mail from this mailbox stops showing in UniWork. Nothing is deleted on the mail server; reconnecting means signing in or entering the password again.` |

Delete these four lines (currently en.json:461-464):

```json
      "mail_oauth": {
        "title": "Gmail and Microsoft 365",
        "meta": "Sign in with a Google or Microsoft account and attach email threads to tasks and projects"
      },
```

Replace the line
`      "method_app_password_hint": "Gmail, Outlook or Yahoo, with an app password from your account settings",`
with:

```json
      "method_app_password_hint": "Gmail, Outlook and Yahoo also connect with an app password.",
      "method_google": "Sign in with Google",
      "method_google_hint": "Gmail or Google Workspace, no app password needed",
      "method_microsoft": "Sign in with Microsoft",
      "method_microsoft_hint": "Outlook.com or Microsoft 365, no app password needed",
      "error_popup_blocked": "Your browser blocked the sign-in window. Allow pop-ups for UniWork, then try again.",
      "error_oauth_denied": "Sign-in was cancelled or UniWork wasn't given access. On Microsoft 365, your organization's admin may need to approve UniWork first.",
      "error_oauth_state_invalid": "The sign-in expired or was opened in another browser. Try again from this window.",
      "error_oauth_email_unavailable": "This account didn't share a verified email address. Sign in with the account that owns the mailbox.",
      "error_oauth_imap_not_enabled": "Signed in, but IMAP is turned off for this mailbox. Turn it on in the mailbox settings, or ask your admin, then try again.",
      "error_oauth_consent_required": "Google or Microsoft didn't grant lasting access. Try again and allow every permission UniWork asks for.",
      "error_oauth_failed": "Couldn't finish signing in. Try again.",
```

Replace the line
`      "dialog_description_custom": "Enter the password again, or fix the server settings. Mail already synced stays unless you change the IMAP server.",`
with:

```json
      "dialog_description_custom": "Enter the password again, or fix the server settings. Mail already synced stays unless you change the IMAP server.",
      "dialog_description_oauth": "Sign in again with this same account; picking a different one connects it as another mailbox. Mail already synced stays as it is.",
```

If an Edit says an old value does not match, read the current line and match it exactly; do not invent text. Then check that nothing else still uses the removed key or asserts the rewritten copy:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && grep -rn "mail_oauth\|Gmail và Microsoft 365\|Gmail and Microsoft 365\|bằng App Password hoặc máy chủ\|phải nhập lại mật khẩu\.\|Mật khẩu được mã hóa trước khi lưu\.\"\|bằng App Password tạo trong" packages apps e2e --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules || true
```

Expected: only the `queryByText("Gmail và Microsoft 365")` line in `integrations-tab.test.tsx`. Fix any other hit.

- [ ] **Step 5: Run the tests to verify they pass, then the targeted gates**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub settings/components/integrations-tab.test.tsx integrations/use-oauth-popup.test.tsx calendar
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core && NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false i18n/parity.test.ts
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && node --test scripts/i18n-duplicate-keys.test.mjs scripts/i18n-chat-key-parity.test.mjs
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm --filter @uniwork/core typecheck && pnpm --filter @uniwork/views typecheck
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/views && pnpm exec eslint --max-warnings 0 email-hub/connect-method-step.tsx email-hub/connect-account-dialog.tsx email-hub/connect-account-dialog.test.tsx email-hub/connect-account-errors.ts email-hub/connect-account-errors.test.ts email-hub/use-email-hub-account-panel.ts settings/components/integrations-tab.tsx settings/components/integrations-tab.test.tsx
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm knip
```

Expected: everything green.
- Dialog: 12 GD2 cases plus 11 new tests (3 provider rows, popup, connected, closed, 3 result rows, blocked, Microsoft reconnect).
- Errors: 11 rows. Integrations tab: 4 cases. `use-oauth-popup.test.tsx` and the calendar suite still pass; every other email-hub views test passes (empty state and account menu render the rewritten copy).
- Parity and duplicate-key tests pass; `mail_oauth` is gone from both files.
- Typecheck passes (`onPick` accepts `pick: (next: Method) => void`; `mutateAsync` matches Task 8's input).
- eslint 0 problems; the dialog stays under `max-lines` 500.
- knip clean: `useOAuthPopup` has two consumers, `useEmailHubProviders`, `useStartEmailHubOAuth`, `oauthResultKey`, `ConnectMethodStep` and `OAuthProviderButton` are each used, and the `Mail` import is gone.

- [ ] **Step 6: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add packages/views/email-hub/connect-method-step.tsx packages/views/email-hub/connect-account-dialog.tsx \
  packages/views/email-hub/connect-account-dialog.test.tsx packages/views/email-hub/connect-account-errors.ts \
  packages/views/email-hub/connect-account-errors.test.ts packages/views/email-hub/use-email-hub-account-panel.ts \
  packages/views/settings/components/integrations-tab.tsx packages/views/settings/components/integrations-tab.test.tsx \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(email-hub): sign in with Google or Microsoft from the connect dialog and reconnect OAuth mailboxes through the popup" \
  -m "The method step now leads with Sign in with Google and Sign in with Microsoft, each shown only when the server has that provider's Email Hub client (GET providers, spec Q9). Then comes Own domain, with the app password demoted to a text link that keeps the GD1 form and its guide. A click opens the popup synchronously through the shared useOAuthPopup and only then asks start for the URL. The callback's codes read out as flat email_hub.connect.error_* sentences through oauthResultKey, whose default is a generic failure; denied mentions Microsoft 365 admin consent. connected refetches the account list and closes the dialog; a popup closed without a message only refetches. A reconnect switches on auth_kind: oauth_google/oauth_microsoft shows that provider's card alone and sends login_hint = the address, and any other kind keeps the GD2 custom or app-password form. Settings drops the planned mail_oauth card, now shipped, and the Email Hub meta, onboarding and disconnect copy mention sign-in. Left out: provider logos (the calendar marks are calendar artwork), onConnected for OAuth (the message carries no account id), mapping a start-time 429 to its own sentence, and hiding the reconnect card when that provider is later unconfigured (start answers 404, which reads as the generic failure)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Check visually in both themes (the contrast e2e does not cover them): the provider cards disabled while a popup is open, the app-password text link under the cards, and the destructive alert under the method step.

### Task 11: Runbook, status lines, targeted verification (PR opened by the controller)

**Files:**
- Modify: `docs/ops/RUNBOOK_EMAIL_HUB.md`:
  - line 3 (header) gains UNI-1239;
  - step 1 of `### Tài khoản Email Hub cần kết nối lại`: the count query gains `auth_kind`; the reason table gains an `oauth_invalid_grant` row and the `imap_auth_failed` row gains the OAuth case; the indented "Sau GĐ3 (OAuth) sẽ có thêm lý do…" paragraph is replaced;
  - a new `## Cấu hình OAuth (Google, Microsoft)` immediately before `## Triệu chứng và cách xử lý`;
  - `### Kết nối Google / Microsoft thất bại (mã callback)` and `### Thu hồi token OAuth` immediately before `### Migration dedupe và unique index`;
  - `## Checklist thủ công trước khi đóng GĐ3` appended at the end.
  - Nothing goes under `docs/runbooks/` (alert-bound runbooks only, read by `scripts/alerts-runbooks.test.mjs`).
- Modify: `docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md`: `:3` status, `:6` `**Issue:**`, §4.4 step 4 (`:313-315`) and §5.5 (`:491-495`) to match the plan-header revoke rulings.
- Modify: `docs/superpowers/plans/2026-10-11-email-hub-gd3-oauth.md` line 3 (status).
- Not modified: `server/coverage.floor`, `packages/core/vitest.config.ts:27`, `packages/views/vitest.config.ts:29` (Step 6).
- Must stay green: `scripts/governance.test.mjs` (incl. "every plan says whether it shipped", governance.test.mjs:229-241), `env-example`, `no-pii-log`, `alerts-runbooks`, `i18n-duplicate-keys`, `i18n-chat-key-parity`, `lucide-aliases`, `no-legacy-tokens`.

**Interfaces:**
- Consumes (text only; Step 2 confirms each string in the shipped code): the five `EMAIL_HUB_*` OAuth env names (tenant default `common`), plus `EMAIL_HUB_CREDENTIAL_KEY`, `API_PUBLIC_URL`, `FRONTEND_ORIGIN`, `NEXT_PUBLIC_API_URL`; the three routes; redirect URI `API_PUBLIC_URL/api/v1/email-hub-connections/{google|microsoft}/callback`; the nine callback codes; message `{type: "uniwork:email-hub-oauth", ok, code}`; cookie `uniwork_email_oauth` (`Path=/api/v1/email-hub-connections/`, `Max-Age=600`); `auth_kind` values `password`, `oauth_google`, `oauth_microsoft`; reason `oauth_invalid_grant`; marking codes `invalid_grant`, `unauthorized_client`; logs `email hub revoke failed` / `email hub revoke skipped` (`account_id`, `code`) and `email hub oauth callback failed`; Google revoke URL; scopes; prompts `consent` / `select_account`; `emailHubAccessTokenSkew` (2 min); audit metadata `auth_kind`, `provider`, `reconnected`, `server_changed`.
- Produces: no code; verification lines for the PR body.

- [ ] **Step 1: Write the failing check**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
r=docs/ops/RUNBOOK_EMAIL_HUB.md
s=docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md
p=docs/superpowers/plans/2026-10-11-email-hub-gd3-oauth.md
! grep -q 'Sau GĐ3 (OAuth) sẽ có thêm' "$r" \
  && grep -q 'oauth_invalid_grant' "$r" \
  && grep -q 'EMAIL_HUB_MICROSOFT_TENANT' "$r" \
  && grep -q '/api/v1/email-hub-connections/google/callback' "$r" \
  && grep -q '/api/v1/email-hub-connections/microsoft/callback' "$r" \
  && grep -q 'email hub revoke failed' "$r" \
  && grep -q 'consent_required' "$r" \
  && grep -q 'NEXT_PUBLIC_API_URL' "$r" \
  && grep -q 'Checklist thủ công trước khi đóng GĐ3' "$r" \
  && grep -q 'UNI-1239' "$r" \
  && grep -q 'GĐ3 = UNI-1239' "$s" \
  && ! grep -q 'GĐ3 (OAuth) chưa bắt đầu' "$s" \
  && grep -q '^> \*\*Trạng thái:\*\* in-progress — GĐ3 đã triển khai' "$p" \
  && echo OK || echo MISSING
```

- [ ] **Step 2: Run it to confirm it fails, then check the shipped strings**

Expected: `MISSING`.

Before editing, confirm each string the runbook quotes. Every grep must print at least one hit; the loop must print nothing. If one comes back empty, find the real string in the code and use that; do not invent one. If shipped behaviour differs from Step 3's text, write what the code does and report the difference; do not patch code in this task.

Run this block on its own (no `git` in it: `block-no-verify` refuses a call holding `git` and ` -n` together).

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server
grep -rn '"oauth_invalid_grant"' internal/service/ | grep -v _test
grep -rn '"invalid_grant"\|"unauthorized_client"' internal/service/email_hub_oauth_refresh.go
for c in connected denied state_invalid email_unavailable imap_not_enabled smtp_disabled already_connected consent_required failed; do
  grep -q "\"$c\"" internal/service/email_hub_oauth_callback.go || echo "missing code $c"
done
grep -rn 'email hub revoke failed\|email hub revoke skipped\|email hub oauth callback failed' internal/service/ | grep -v _test
grep -rn 'oauth2.googleapis.com/revoke' internal/service/ | grep -v _test
grep -rn 'revokeEmailHubToken(\|revokeReplacedEmailHubToken(' internal/service/ | grep -v _test
grep -rn 'https://mail.google.com/\|IMAP.AccessAsUser.All\|SMTP.Send\|offline_access' internal/service/email_hub_oauth.go
grep -rn '"consent"\|"select_account"' internal/service/email_hub_oauth*.go
grep -rn 'emailHubAccessTokenSkew' internal/service/email_hub_oauth_refresh.go
grep -rn 'email_verified\|preferred_username' internal/service/email_hub_oauth_callback.go
grep -rn 'EMAIL_HUB_GOOGLE_CLIENT_ID\|EMAIL_HUB_GOOGLE_CLIENT_SECRET\|EMAIL_HUB_MICROSOFT_CLIENT_ID\|EMAIL_HUB_MICROSOFT_CLIENT_SECRET\|EMAIL_HUB_MICROSOFT_TENANT' internal/config/config.go ../.env.example
grep -rn '"common"\|email-hub-connections' internal/config/config.go
grep -rn 'uniwork_email_oauth\|uniwork:email-hub-oauth\|no-store\|sha256-' internal/handler/email_hub_oauth.go
grep -rn 'uniwork:email-hub-oauth' ../packages/views/ | grep -v '\.test\.'
grep -rn 'email-hub-connections/{provider}/callback\|oauth/{provider}/start\|email-hub/providers' internal/handler/router/email_hub.go
grep -rn 's.log\.' internal/service/email_hub_oauth_callback.go internal/service/email_hub_oauth_refresh.go internal/service/email_hub_oauth_revoke.go
grep -rn 'CountEmailHubOAuthGrantHolders' pkg/db/queries/email_hub.sql
```

Read these results against the code:
1. The revoke call sites must cover Disconnect (`email_hub.go`), `cleanUpEmailHubAccountsAfterCommit`, `revokeReplacedEmailHubToken` in Connect (`email_hub_connect.go`) and CompleteOAuth (`email_hub_oauth_callback.go`), and `markAuthFailed`; none may sit in `email_hub_oauth_refresh.go` (a lost refresh race never revokes). A different set is a Task 7 gap: report it.
2. In `email_hub_oauth_callback.go`, confirm a provider `error=` other than `access_denied` answers `failed`, and Google `email_verified=false` answers `email_unavailable`.
3. Every OAuth log line carries only ids, `code` and `reason`. The callback's `email hub oauth callback failed` line exists; if not, delete the sentence starting "Mỗi kết quả khác `connected`" from Step 3c-2.
4. The last grep: if `CountEmailHubOAuthGrantHolders` exists (Task 7 Step 8, default), Step 3c-2 keeps the paragraph tagged **[skip shipped]**; otherwise the one tagged **[no skip]**. Keep exactly one.

- [ ] **Step 3: Write the docs**

**3a.** In `docs/ops/RUNBOOK_EMAIL_HUB.md`, replace line 3 with:

```markdown
> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237, UNI-1238, UNI-1239
```

**3b.** In `### Tài khoản Email Hub cần kết nối lại`, replace the step-1 query, the whole reason table, and the indented "Sau GĐ3" paragraph after it. Step 3 (`Không có thao tác SQL nào…`) and everything after it stay.

```diff
 1. Đếm theo lý do:
 
 ```sql
-SELECT auth_failed_reason, provider, count(*), min(auth_failed_at), max(auth_failed_at)
+SELECT auth_kind, auth_failed_reason, provider, count(*), min(auth_failed_at), max(auth_failed_at)
 FROM email_hub_accounts
 WHERE auth_failed_at IS NOT NULL AND disconnected_at IS NULL
-GROUP BY auth_failed_reason, provider
-ORDER BY 3 DESC;
+GROUP BY auth_kind, auth_failed_reason, provider
+ORDER BY 4 DESC;
 ```
```

Then replace the four table lines and the three-line paragraph with:

```markdown
| `auth_failed_reason` | Nguồn | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- | --- |
| `imap_auth_failed` | IMAP `NO [AUTHENTICATIONFAILED]` | Người dùng đổi mật khẩu tài khoản hoặc thu hồi App Password; Google tắt App Password khi tắt 2FA. Với tài khoản OAuth (`auth_kind` `oauth_*`): access token vừa làm mới vẫn bị IMAP từ chối, thường do IMAP bị tắt cho hộp thư sau khi đã kết nối (M365: `Set-CASMailbox <user> -ImapEnabled $false`) | Người dùng bấm *Kết nối lại*: App Password thì nhập mật khẩu mới, OAuth thì đăng nhập lại trong popup. Refresh token Google của dòng được thu hồi (mục *Thu hồi token OAuth*) |
| `imap_login_refused` | 3 lần liên tiếp IMAP trả NO không kèm mã (`emailHubRefusedLoginsBeforeDisconnect`) | IMAP bị tắt trong cài đặt hộp thư; máy chủ chặn IP; mật khẩu sai với máy chủ không trả mã chuẩn | Bật IMAP trong cài đặt hộp thư rồi kết nối lại |
| `smtp_auth_failed` | SMTP 535/534 (không phải trường hợp SMTP AUTH bị tắt) | Mật khẩu SMTP khác mật khẩu IMAP, hoặc đã bị thu hồi | Kết nối lại |
| `oauth_invalid_grant` | Token endpoint trả `invalid_grant` hoặc `unauthorized_client` khi làm mới access token, và dòng **chưa** bị pod khác làm mới hay kết nối lại kể từ lúc đọc | Google client còn ở chế độ *Testing*: refresh token hết hạn sau 7 ngày (mục *Google Cloud*). Người dùng gỡ quyền ứng dụng ở tài khoản Google/Microsoft. Người dùng đổi mật khẩu Google: Google thu hồi token có scope Gmail. Quản trị viên Workspace/Entra thu hồi phiên. Refresh token Microsoft không được dùng quá 90 ngày | Người dùng bấm *Kết nối lại*, popup mở sẵn đúng tài khoản (`login_hint`). Grant đã chết nên server không revoke |

   Tài khoản Gmail trong chế độ *Testing* rơi về `needs_reconnect` theo đợt, 7 ngày sau lần kết
   nối. Nhìn theo ngày để phân biệt đợt này với một sự cố phía nhà cung cấp:

```sql
SELECT date_trunc('day', auth_failed_at) AS day, count(*)
FROM email_hub_accounts
WHERE auth_kind = 'oauth_google' AND auth_failed_reason = 'oauth_invalid_grant'
  AND disconnected_at IS NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```
```

**3c-1.** Insert this block immediately before the line `## Triệu chứng và cách xử lý`:

````markdown
## Cấu hình OAuth (Google, Microsoft)

Người dùng kết nối Gmail/Google Workspace hoặc Outlook.com/Microsoft 365 bằng cách đăng nhập
trong popup, không cần App Password. Server giữ refresh token (seal bằng box Email Hub) và
đăng nhập IMAP/SMTP bằng XOAUTH2 vào đúng các máy chủ preset (`imap.gmail.com`,
`outlook.office365.com`), kể cả trên tên miền riêng của Workspace/M365. Email Hub có
**OAuth client riêng**. Không dùng `GOOGLE_CLIENT_ID` (đăng nhập, lịch) hay
`MICROSOFT_CALENDAR_*`, vì scope Gmail là restricted và kéo theo verification + CASA.

### Biến môi trường

| Biến | Ý nghĩa |
| --- | --- |
| `EMAIL_HUB_GOOGLE_CLIENT_ID`, `EMAIL_HUB_GOOGLE_CLIENT_SECRET` | Client OAuth Google của Email Hub. Thiếu một trong hai thì nút Google bị ẩn |
| `EMAIL_HUB_MICROSOFT_CLIENT_ID`, `EMAIL_HUB_MICROSOFT_CLIENT_SECRET` | App Entra của Email Hub. Thiếu một trong hai thì nút Microsoft bị ẩn |
| `EMAIL_HUB_MICROSOFT_TENANT` | Mặc định `common`: tài khoản công việc/trường học lẫn tài khoản cá nhân (Outlook.com). `organizations` bỏ tài khoản cá nhân; một tenant id chỉ nhận một tổ chức |
| `EMAIL_HUB_CREDENTIAL_KEY` | Có từ GĐ1. Thiếu thì **cả hai** nút bị ẩn, vì box này seal cả token lẫn state OAuth |
| `API_PUBLIC_URL` | Gốc của redirect URI: `API_PUBLIC_URL/api/v1/email-hub-connections/google/callback` và `…/microsoft/callback` |
| `FRONTEND_ORIGIN` | Trang callback chỉ `postMessage` kết quả tới origin này |

Không có feature flag: env là công tắc, và đổi env phải khởi động lại server. Kiểm tra bằng
`GET /api/v1/workspaces/{workspaceID}/email-hub/providers`, kết quả là
`{"google":true,"microsoft":true}` khi bật cả hai. Desktop không có OAuth (chỉ web).

Gỡ env của một nhà cung cấp khi còn tài khoản OAuth của nó: tài khoản **không** chuyển
`needs_reconnect` (lỗi tạm thời `oauth_not_configured`), nhưng sync và gửi dừng khi access token
hiện có hết hạn (khoảng 1 giờ). Đặt lại env và khởi động lại thì tài khoản chạy tiếp, không cần
kết nối lại.

### Google Cloud

1. Dùng một project Google Cloud riêng cho Email Hub, không dùng project của client đăng nhập.
2. *Google Auth Platform* → *Audience*: chọn loại *External*. *Data access*: thêm `openid`,
   `email` và `https://mail.google.com/`.
3. *Clients* → *Create client* → *Web application*. *Authorized redirect URI* là
   `API_PUBLIC_URL/api/v1/email-hub-connections/google/callback`, đúng từng ký tự và không
   có `/` cuối. Sai URI thì popup dừng ở trang lỗi của Google
   `Error 400: redirect_uri_mismatch`, và callback không chạy.
4. Chép client id và secret vào `EMAIL_HUB_GOOGLE_CLIENT_ID` / `EMAIL_HUB_GOOGLE_CLIENT_SECRET`.

**Chế độ Testing.** Trước khi Google duyệt, client ở *Testing*:

- Tối đa 100 test user, khai báo ở *Audience* → *Test users*. Người ngoài danh sách bị Google
  chặn ngay trên trang đăng nhập (`Error 403: access_denied`) nên callback không chạy. Đóng
  popup thì dialog chỉ tải lại danh sách tài khoản và không báo lỗi.
- Test user thấy màn hình "Google hasn't verified this app" và phải bấm *Continue*.
- Refresh token hết hạn sau 7 ngày. Tài khoản rơi về `needs_reconnect` với lý do
  `oauth_invalid_grant`, thư đã cache còn nguyên. Đây không phải lỗi.

Verification cho scope restricted `https://mail.google.com/` cần thẩm định bảo mật CASA, làm
lại hằng năm. Việc này kéo dài vài tuần và chạy song song với GĐ3, không chặn merge. Sau khi
chuyển *In production*, refresh token mới không còn hạn 7 ngày. Tài khoản kết nối trong lúc
còn Testing có thể phải kết nối lại một lần nữa.

### Microsoft Entra

1. *Microsoft Entra admin center* → *App registrations* → *New registration*. *Supported
   account types*: "Accounts in any organizational directory and personal Microsoft accounts".
2. *Redirect URI*: nền tảng *Web*, `API_PUBLIC_URL/api/v1/email-hub-connections/microsoft/callback`.
   Sai URI thì popup dừng ở lỗi `AADSTS50011`.
3. *Certificates & secrets* → *New client secret*. Chép **Value** (không phải *Secret ID*) vào
   `EMAIL_HUB_MICROSOFT_CLIENT_SECRET`. Secret có hạn (tối đa 24 tháng), nên đặt lịch xoay
   vòng. Khi secret hết hạn:
   - Token endpoint trả `invalid_client`. Đó là lỗi tạm thời, nên tài khoản vẫn `active` và
     không chuyển `needs_reconnect`.
   - Sync và gửi dừng khi access token hiện có hết hạn (khoảng 1 giờ), và kết nối mới trả
     `failed`.
   - Tạo secret mới, đổi env, khởi động lại. Không cần người dùng kết nối lại.
4. *API permissions* → *Add a permission* → *APIs my organization uses* → *Office 365
   Exchange Online* → *Delegated*: `IMAP.AccessAsUser.All`, `SMTP.Send`. Thêm *Microsoft
   Graph* delegated: `openid`, `email`, `offline_access`.
5. Nên thêm *Token configuration* → *Add optional claim* → *ID* → `email`. Không có claim
   `email`, server lấy `preferred_username` (UPN), và UPN có thể khác địa chỉ SMTP chính
   (xem `email_unavailable` và *SendAsDenied* ở dưới).

Tenant M365 của khách hàng có thể chặn:

- **Bắt admin consent.** Người dùng thấy "Need admin approval". Kết quả là `denied` khi
  Microsoft trả `error=access_denied`, hoặc `failed` khi trả mã khác (`consent_required`,
  `interaction_required`). Quản trị viên tenant tự kết nối một lần và tích *Consent on behalf
  of your organization*, hoặc vào *Enterprise applications* → app → *Permissions* → *Grant
  admin consent*.
- **SMTP AUTH bị tắt.** Kết quả là `smtp_disabled`, và không có dòng nào được ghi. Xử lý như
  mục *Gửi thất bại với `smtp_disabled`*.
- **IMAP bị tắt cho hộp thư.** Kết quả là `imap_not_enabled`. Xử lý bằng
  `Set-CASMailbox <user> -ImapEnabled $true`.

### Web và API phải cùng site

- **Cookie nonce.** Nonce chống tráo tài khoản nằm trong cookie `uniwork_email_oauth`
  (`HttpOnly`, `SameSite=Lax`, `Path=/api/v1/email-hub-connections/`, `Max-Age=600`).
  - API đặt cookie này trong phản hồi của
    `POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start`, là một fetch có
    credential từ web.
  - Trình duyệt chặn cookie bên thứ ba (Safari, Firefox ETP, Chrome khi chặn third-party
    cookie) bỏ cookie đặt từ một fetch khác site.
  - Vì vậy web và API phải chung tên miền đăng ký, ví dụ `app.example.com` và
    `api.example.com`. `localhost:3000` và `localhost:8080` cũng dùng được.
  - Khác site thì **mọi** callback trả `state_invalid`.
- **Origin của tin nhắn.** Web chỉ nhận tin nhắn của popup từ origin của
  `NEXT_PUBLIC_API_URL`, trong khi trang callback chạy ở `API_PUBLIC_URL`.
  - Hai origin này phải giống nhau, và `FRONTEND_ORIGIN` phải đúng origin người dùng mở web.
  - Lệch một trong hai thì tin nhắn bị bỏ. Dialog chỉ biết popup đã đóng và tải lại danh
    sách tài khoản.
  - Kết nối thành công vẫn hiện tài khoản mới. Kết nối thất bại không báo lỗi gì, nên người
    dùng tưởng chưa có chuyện gì xảy ra.
- **CSP của trang callback.** Trang callback gửi
  `Content-Security-Policy: default-src 'none'; script-src 'sha256-…'; frame-ancestors 'none'; base-uri 'none'`
  và `Cache-Control: no-store`. Proxy chèn thêm CSP riêng cho `/api/v1/email-hub-connections/`
  có thể chặn script, khiến popup đứng ở trang trắng. Để nguyên header của API trên đường này.

### Hai pod cùng làm mới token

Access token còn hạn dưới 2 phút thì được làm mới, dưới một mutex theo account id trong
process. Bước làm mới chạy thế này:

1. Đọc lại dòng.
2. Gọi token endpoint.
3. Ghi `UpdateEmailHubAccountOAuthTokens`, có điều kiện theo `credential_version` và
   `oauth_access_expires_at` đã đọc ở bước 1.

Trong cửa sổ rolling update (ADR 0025, maxSurge 1), hai pod có thể cùng làm mới một tài
khoản:

- Chỉ một lệnh ghi thành công. Pod thua đọc lại dòng và dùng token của pod thắng.
- Pod thua **không** revoke token vừa nhận, vì revoke một token Google thu hồi cả grant, tức
  cả token của pod thắng.
- `invalid_grant` chỉ đánh hỏng tài khoản khi refresh token, `credential_version` và
  `oauth_access_expires_at` của dòng chưa đổi kể từ lần đọc. Microsoft xoay vòng refresh token,
  nên lần pod khác vừa xoay không làm tài khoản rơi về `needs_reconnect`.
- Làm mới token không tăng `credential_version`.
- Không cần làm gì khi deploy. Một đợt `oauth_invalid_grant` ngay sau deploy là nguyên nhân
  khác, không phải hai pod tranh nhau.

````

**3c-2.** Insert this block immediately before the line `### Migration dedupe và unique index`:

````markdown
### Kết nối Google / Microsoft thất bại (mã callback)

Luồng kết nối:

1. Dialog mở popup và gọi `POST …/email-hub/oauth/{provider}/start`. Lệnh này có hạn mức
   riêng 10 lần / 10 phút mỗi người (Google và Microsoft dùng chung), tách khỏi hạn mức của
   `POST …/email-hub/accounts`; quá hạn mức thì trả `429 rate_limited`.
2. Người dùng đăng nhập ở Google/Microsoft.
3. Nhà cung cấp chuyển về `GET /api/v1/email-hub-connections/{provider}/callback`. Route này
   nằm ngoài nhóm cần đăng nhập, dưới `credentialLimit` (60 lần/phút/IP).
4. Callback trả một trang HTML nhỏ. Trang `postMessage`
   `{type: "uniwork:email-hub-oauth", ok, code}` về `FRONTEND_ORIGIN` rồi tự đóng.
5. Dialog hiện kết quả theo `code`.

Popup bị trình duyệt chặn thì dialog báo lỗi ngay, không gọi start. Trang callback không chứa
email hay văn bản lỗi thô.

| `code` | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `connected` | Đã kết nối mới, hoặc kết nối lại trên cùng account id. Một tài khoản App Password cùng địa chỉ chuyển sang OAuth và giữ id | Không |
| `denied` | Người dùng bấm *Hủy* ở trang nhà cung cấp, hoặc tenant M365 bắt admin consent (`error=access_denied`) | Thử lại; admin consent xem mục *Microsoft Entra* |
| `state_invalid` | Không có dòng nào được ghi. Các trường hợp: state hỏng hoặc quá 10 phút; provider trong state khác provider trên đường dẫn; cookie `uniwork_email_oauth` thiếu hoặc không khớp. Cookie thiếu khi popup chạy ở trình duyệt hay profile khác, trình duyệt chặn cookie, hoặc web và API khác site | Thử lại trong 10 phút trên cùng trình duyệt. Nếu **mọi** người đều gặp, kiểm tra mục *Web và API phải cùng site* |
| `email_unavailable` | `id_token` không cho địa chỉ dùng được. Google: claim `email` trống hoặc `email_verified=false`. Microsoft: cả `email` lẫn `preferred_username` trống | Google: dùng tài khoản có email đã xác minh. Microsoft: thêm optional claim `email` cho app |
| `imap_not_enabled` | Token mới nhưng IMAP từ chối `AUTHENTICATE XOAUTH2`, tức IMAP bị tắt cho hộp thư (M365 trả NO trần) | M365: `Set-CASMailbox <user> -ImapEnabled $true`. Workspace: quản trị viên bật IMAP cho người dùng |
| `smtp_disabled` | IMAP được, nhưng SMTP AUTH bị tắt cho hộp thư hoặc tenant | Như mục *Gửi thất bại với `smtp_disabled`*, rồi kết nối lại |
| `already_connected` | Địa chỉ đã có tài khoản `active` cùng `auth_kind` trong tổ chức. Không dòng nào đổi | Không phải lỗi |
| `consent_required` | Phản hồi token không có refresh token (hiếm, vì đã gửi `prompt=consent` và `access_type=offline`) | Người dùng gỡ quyền của app ở tài khoản Google rồi kết nối lại |
| `failed` | Mọi trường hợp còn lại, gồm: đổi code thất bại (code dùng lại, client secret sai hoặc hết hạn), `error=` khác `access_denied`, người dùng đã bị vô hiệu hoá hoặc rời workspace sau khi bấm nút, SMTP lỗi khác `smtp_disabled`, lỗi DB | Xem log `email hub oauth callback failed` theo `user_id` và `provider`; trường `reason` cho biết bước hỏng (`exchange_invalid_grant`, `exchange_invalid_client`, `membership`, `provider_error`, …) |

Mỗi kết quả khác `connected` có dòng log `email hub oauth callback failed` kèm `user_id`,
`provider`, `code` và `reason`. Log không bao giờ chứa email, token, `code` của nhà cung cấp,
state, nonce hay mô tả lỗi của nhà cung cấp.

Người dùng có thể chọn một tài khoản Google/Microsoft khác `login_hint` khi kết nối lại.
Callback kết nối, hoặc trả `already_connected` cho, đúng địa chỉ mà `id_token` và lần đăng
nhập XOAUTH2 chứng minh. Tài khoản cần kết nối lại ban đầu vẫn ở `needs_reconnect`.

Microsoft với UPN khác địa chỉ SMTP chính: IMAP XOAUTH2 có thể chấp nhận UPN, nên kết nối
thành công. Nhưng lệnh gửi bị Exchange từ chối (`SendAsDenied`), và API trả 502 chung. Xử lý
là thêm optional claim `email` cho app, rồi ngắt kết nối và kết nối lại. Địa chỉ đã lưu không
tự đổi.

Xem các lần kết nối OAuth của một tài khoản:

```sql
SELECT occurred_at,
       metadata::jsonb->>'auth_kind'      AS auth_kind,
       metadata::jsonb->>'provider'       AS provider,
       metadata::jsonb->>'reconnected'    AS reconnected,
       metadata::jsonb->>'server_changed' AS server_changed
FROM audit_events
WHERE action = 'email_hub_account.connected' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 10;
```

### Thu hồi token OAuth

Chỉ Google có revoke: `POST https://oauth2.googleapis.com/revoke`. Microsoft không có endpoint
thu hồi refresh token cho ứng dụng, nên server chỉ xoá token phía mình. Người dùng gỡ quyền ở
trang tài khoản Microsoft nếu muốn.

Server revoke refresh token mà chính câu lệnh vừa xoá khỏi dòng, sau khi commit, ở các đường:

- ngắt kết nối thủ công;
- rời tổ chức và xoá tài khoản UniWork (`cleanUpEmailHubAccountsAfterCommit`);
- kết nối lại đổi kiểu đăng nhập khỏi oauth_google (sang App Password hoặc máy chủ tùy chỉnh).
  Kết nối lại oauth_google → oauth_google không revoke: cùng tài khoản Google, cùng grant,
  revoke sẽ giết token vừa lưu;
- tài khoản chuyển `needs_reconnect` với lý do khác `oauth_invalid_grant`.

Không revoke khi `oauth_invalid_grant` (grant đã chết), khi thua cuộc đua làm mới token (mục
*Hai pod cùng làm mới token*), và khi thành viên bị vô hiệu hoá (dòng và token được giữ, F-03).

Revoke là best-effort:

- Hạn 5 giây, không thử lại.
- Lỗi, hết hạn, hay Google trả 400 đều không làm lệnh thất bại hoặc rollback.
- Lỗi chỉ để lại một dòng Warn `email hub revoke failed` kèm `account_id` và `code`
  (`unsealable`, `request`, `timeout`, `unreachable`, `status_<n>`); bỏ qua có chủ đích là dòng
  `email hub revoke skipped` (`not_configured`, `grant_shared`, `lookup_failed`).
- Khi revoke thất bại, grant còn hiệu lực ở Google tới khi người dùng gỡ quyền của app trong
  tài khoản Google. Server không còn giữ token nào.

**[skip shipped]** Nếu một dòng khác còn sống (bất kỳ tổ chức nào) dùng cùng địa chỉ với
`auth_kind = 'oauth_google'` và còn refresh token, server bỏ qua revoke (`grant_shared`). Lý do:
grant Google là của cặp (người dùng Google, client), nên revoke ở một tổ chức sẽ làm hộp thư ở
tổ chức kia rơi về `needs_reconnect`.

**[no skip]** Một địa chỉ Gmail kết nối OAuth ở hai tổ chức dùng chung một grant Google. Ngắt
kết nối ở một tổ chức sẽ revoke grant đó, và tài khoản ở tổ chức kia rơi về `needs_reconnect`
(`oauth_invalid_grant`) ở lần làm mới kế tiếp. Người dùng kết nối lại ở tổ chức đó.
````

Keep exactly one of the two bold-tagged paragraphs (Step 2, item 4) and delete its tag (`**[skip shipped]** ` or `**[no skip]** `). If `[no skip]` is kept, also drop `grant_shared` and `lookup_failed` from the revoke codes above.

**3c-3.** Append at the end of the file:

```markdown

## Checklist thủ công trước khi đóng GĐ3

Chạy trên môi trường có env OAuth thật. Không tự động hoá được: Google/Microsoft không chạy
trong CI.

- [ ] Gmail cá nhân: kết nối bằng Google, sync Hộp thư đến, gửi một thư.
- [ ] Google Workspace trên tên miền riêng: như trên.
- [ ] Outlook.com: kết nối bằng Microsoft, sync, gửi.
- [ ] M365 có SMTP AUTH bật: kết nối, gửi.
- [ ] M365 có SMTP AUTH tắt: kết nối trả `smtp_disabled`, không có dòng nào được ghi.
- [ ] Một kết nối thất bại (ví dụ M365 SMTP AUTH tắt) hiện đúng câu lỗi trong dialog, và kết nối
      thành công tự đóng dialog: chứng minh postMessage tới được cửa sổ mở. Nếu không, popup bị
      COOP cắt opener; ghi lại để chuyển sang kênh khác (ví dụ BroadcastChannel trên trang
      callback cùng origin web).
- [ ] Máy chủ cPanel/Dovecot qua 993 + 465 và qua 143 + 587.
- [ ] Gửi từ tài khoản cPanel: thư nằm trong Sent trên máy chủ và hiện đúng một lần.
- [ ] Gỡ quyền ứng dụng ở Google rồi ở Microsoft: tài khoản về `needs_reconnect`
      (`oauth_invalid_grant`), thư đã cache còn.
- [ ] Kết nối lại qua *Kết nối lại*: popup gợi ý đúng địa chỉ, cùng account id, cùng luồng thư.
- [ ] Kết nối lại nhưng chọn một tài khoản khác trong popup: tài khoản cũ vẫn `needs_reconnect`.
- [ ] Ngắt kết nối một tài khoản Google: quyền của app biến mất khỏi trang quyền của tài khoản Google.
- [ ] Popup bị chặn: dialog báo lỗi, không treo ở trạng thái đang chờ.
- [ ] Đóng popup giữa chừng: dialog không báo lỗi và tải lại danh sách tài khoản.
```

**3d.** In the spec, replace line 3 and line 6 (GĐ3 stays open until the manual checklist runs and the PR merges, so the status stays `in-progress`):

```diff
-> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1, PR #220 vào `develop`. GĐ2 (máy chủ tùy chỉnh, UNI-1238) triển khai theo plan GĐ2 trên nhánh `feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin`, xếp chồng lên GĐ1. GĐ3 (OAuth) chưa bắt đầu.
+> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1, PR #220 vào `develop`. GĐ2 (máy chủ tùy chỉnh, UNI-1238) triển khai theo plan GĐ2, PR #221, xếp chồng lên GĐ1. GĐ3 (OAuth, UNI-1239) triển khai theo plan GĐ3 trên nhánh `feature/UNI-1239-email-hub-gd3-oauth-google-microsoft-xoa`, xếp chồng lên GĐ2; checklist thủ công §10 và Google verification chưa xong.
@@
-**Issue:** cha UNI-1236; GĐ1 = UNI-1237, GĐ2 = UNI-1238; GĐ3 chưa có issue. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
+**Issue:** cha UNI-1236; GĐ1 = UNI-1237, GĐ2 = UNI-1238, GĐ3 = UNI-1239. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
```

Then align §4.4 step 4 and §5.5 with the plan-header revoke rulings:

```diff
-     `0` dòng → pod khác đã làm mới hoặc credential đã đổi / tài khoản đã ngắt: bỏ token vừa
-     nhận (Google: revoke best-effort), không log nó, đọc lại dòng; còn active và có token
-     mới → dùng, ngược lại `ErrEmailHubReauthRequired`.
+     `0` dòng → pod khác đã làm mới hoặc credential đã đổi / tài khoản đã ngắt: bỏ token vừa
+     nhận, **không revoke** (revoke một token Google thu hồi cả grant, tức cả token của pod
+     thắng), không log nó, đọc lại dòng; còn active và có token mới → dùng, ngược lại
+     `ErrEmailHubReauthRequired`.
```

```diff
-Revoke best-effort sau commit (timeout 5 giây, lỗi chỉ ghi log) ở **mọi** nơi refresh token
-rời khỏi dòng: ngắt kết nối thủ công; `DisconnectEmailHubAccountsForUser` (rời tổ chức, xoá
-tài khoản — gom vào `cleanUpEmailHubAccountsAfterCommit`); `UpdateEmailHubAccountCredentials`
-khi token cũ khác token mới; và token vừa nhận nhưng không ghi được (§4.4 bước 4). Token cũ
-lấy từ `RETURNING` / `:one` của chính câu lệnh xoá nó.
+Revoke best-effort sau commit (timeout 5 giây, lỗi chỉ ghi log) ở **mọi** nơi refresh token
+rời khỏi dòng: ngắt kết nối thủ công; `DisconnectEmailHubAccountsForUser` (rời tổ chức, xoá
+tài khoản — gom vào `cleanUpEmailHubAccountsAfterCommit`); `UpdateEmailHubAccountCredentials`
+khi kết nối lại đổi auth_kind (cùng auth_kind là cùng grant, không revoke); và
+`MarkEmailHubAccountAuthFailed` với lý do khác `oauth_invalid_grant` (grant đã chết thì không
+cần revoke). Token vừa nhận nhưng không ghi được (§4.4 bước 4) **không** revoke. Bỏ qua revoke
+khi một dòng còn sống khác (bất kỳ tổ chức nào) vẫn giữ grant Google của cùng địa chỉ. Token cũ
+lấy từ `RETURNING` / `:one` của chính câu lệnh xoá nó (khi kết nối lại: từ dòng đọc FOR UPDATE).
```

If an old line does not match exactly, read it and change only the parts named above. If Task 7 Step 8 was dropped by ruling, also drop the "Bỏ qua revoke khi…" sentence.

**3e.** In `docs/superpowers/plans/2026-10-11-email-hub-gd3-oauth.md`, replace line 3 (`> **Trạng thái:** …`) with:

```markdown
> **Trạng thái:** in-progress — GĐ3 đã triển khai trên nhánh `feature/UNI-1239-email-hub-gd3-oauth-google-microsoft-xoa` (2026-10-11), xếp chồng lên GĐ2 (PR #221) và GĐ1 (PR #220); kiểm chứng bằng test có chọn lọc ở máy, bộ test đầy đủ chạy trên CI. Checklist thủ công spec §10 và Google verification chưa xong. PR chờ review.
```

- [ ] **Step 4: Run the check and the doc contract tests**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
# Step 1 block again → expected: OK
node --test scripts/governance.test.mjs scripts/env-example.test.mjs scripts/no-pii-log.test.mjs scripts/alerts-runbooks.test.mjs scripts/i18n-duplicate-keys.test.mjs scripts/i18n-chat-key-parity.test.mjs scripts/lucide-aliases.test.mjs scripts/no-legacy-tokens.test.mjs
```

Expected: the check prints `OK`; every test passes (`# fail 0`); "every plan says whether it shipped" covers this plan's line 3.

- [ ] **Step 5: Targeted verification (no full suites, per the user)**

Keep each block's summary line for the PR body. Do not run `make check`, `make test-go`, `./internal/service/` without `-run`, or an unfiltered `pnpm test`.

5a. List the Go tests this branch added that the `-run` filters below would miss. Run it in its own Bash call (it contains `git`). Expected: no output; append each printed name to the matching filter as `|Name`.

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git diff origin/feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin...HEAD -- server/internal/service/ | grep -oE '^\+func Test[A-Za-z0-9_]+' | sed 's/^+func //' | grep -vE 'TestEmailHub|TestResolveEmailHub|TestUpdateEmailHubAccount|TestParseEmailHubSyncState|TestRedactEmailHubMailErr|TestLeavingOrDeletingTheAccountDisconnectsEmailHub|TestEveryAuditedCommandWritesItsRow|TestDisconnectReturnsPreviousRefreshToken'
git diff origin/feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin...HEAD -- server/internal/handler/ server/internal/config/ | grep -oE '^\+func Test[A-Za-z0-9_]+' | sed 's/^+func //' | grep -vE 'EmailHub|Isolation|EveryBodyIDFieldHasAReferenceCase|Swagger|EveryRouteFieldIsBound'
```

5b. Go:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/server
gofmt -l internal/ pkg/ cmd/                  # expected: no output
go build ./...
go mod tidy -diff                             # expected: no output (go-sasl stays indirect)
go vet ./internal/service/ ./internal/emailhub/... ./internal/handler/... ./internal/config/ ./pkg/db/ ./cmd/server/
go tool staticcheck ./internal/service/ ./internal/emailhub/... ./internal/handler/... ./internal/config/ ./pkg/db/ ./cmd/server/
go test -count=1 ./internal/emailhub/...      # no DB; includes imapclient/smtpclient XOAUTH2 fakes
go test -count=1 ./internal/config/ -run 'EmailHub'
go test -count=1 ./internal/                  # arch tests
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' \
  go test -count=1 -timeout 30m ./internal/service/ -run 'TestEmailHub|TestResolveEmailHub|TestUpdateEmailHubAccount|TestParseEmailHubSyncState|TestRedactEmailHubMailErr|TestLeavingOrDeletingTheAccountDisconnectsEmailHub|TestEveryAuditedCommandWritesItsRow|TestDisconnectReturnsPreviousRefreshToken'
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' \
  go test -count=1 -timeout 30m ./internal/handler/... -run 'EmailHub|Isolation|EveryBodyIDFieldHasAReferenceCase|Swagger|EveryRouteFieldIsBound'
TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' \
  go test -count=1 ./migrations/ -run 'TestEveryQueryNamesItsTenant'
```

Then, in its own Bash call (it contains `git`):

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && make sqlc && git status --porcelain server/pkg/db   # expected: no output
```

The service run must report `--- PASS` for `TestEmailHubOAuthRefreshTwoServicesOneWriter`, `TestEmailHubOAuthInvalidGrantAfterOtherPodRefreshedStaysActive` and `TestEmailHubOAuthRefreshRacingDisconnect`; quote those three lines. No service or handler test may call Google or Microsoft (every token, revoke and callback test uses an `httptest` server); report any that needs network.

5c. TS:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237/packages/core
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub api/endpoints/email-hub.test.ts i18n/parity.test.ts
cd ../views
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --coverage.enabled=false email-hub integrations/use-oauth-popup.test.tsx settings/components/integrations-tab.test.tsx calendar
cd ../..
pnpm --filter @uniwork/core typecheck && pnpm --filter @uniwork/views typecheck && pnpm --filter @uniwork/web typecheck
pnpm knip
```

The `calendar` filter runs every calendar test (`calendar-connections-dialog.tsx` has no test of its own; `calendar-toolbar.tsx` renders it; its popup behaviour is pinned by `use-oauth-popup.test.tsx`).

ESLint only on the TS files this branch touched since GĐ2 (develop has pre-existing lint errors elsewhere), in its own Bash call:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237 && pnpm exec eslint --max-warnings 0 $(git diff --name-only --diff-filter=AM origin/feature/UNI-1238-email-hub-gd2-may-chu-imap-smtp-tuy-chin...HEAD -- 'packages/**/*.ts' 'packages/**/*.tsx')
```

If a check fails because of GĐ3 code, fix it in a separate `fix(email-hub): …` commit that names the check, then re-run only that block.

- [ ] **Step 6: Coverage numbers (no change)**

Leave every coverage threshold as it is: they measure whole packages (Go: the merged profile), only a full run produces those numbers, and the user ruled out full local runs. CI measures them (TS only prints a drop at `GATE_LEVEL=fast`; the Go floor blocks at every level). Say this in the PR body.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add docs/ops/RUNBOOK_EMAIL_HUB.md docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md docs/superpowers/plans/2026-10-11-email-hub-gd3-oauth.md
git commit -m "docs(email-hub): runbook for Google/Microsoft OAuth connects, token refresh and revoke" \
  -m "GD3 lets members connect Gmail/Workspace and Outlook/M365 by signing in, so on-call needs the setup and failure modes that come with it. The runbook covers: registering Email Hub's own Google client and Entra app (redirect URIs, scopes, tenant default common); the env that switches each provider on and what removing it does; the same-site cookie and NEXT_PUBLIC_API_URL == API_PUBLIC_URL origin requirements; what each callback code means; the new oauth_invalid_grant reason, including the 7-day wave while Google keeps the client in Testing mode; why two pods refreshing the same account during a rolling update are harmless; and where refresh tokens are revoked (Google only, best effort, skipped for a shared grant, 'email hub revoke failed'). The spec's §4.4/§5.5 now match the rulings that a lost refresh race never revokes, a same-kind reconnect never revokes, and markAuthFailed revokes for every reason but oauth_invalid_grant. Spec and plan status lines name GD3 = UNI-1239, still in progress. Left out: coverage floors (no full local run to measure them, by request; CI measures) and the §10 manual checklist, which is listed in the runbook but not run here." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Report for the PR body (controller opens the PR)**

Return one line for each of these:
1. The Step 4 result, with each node test's `# pass` / `# fail` line.
2. Each Step 5 command with its summary line (`ok …` / `Test Files … passed` / knip clean / eslint clean), plus the three named refresh-race tests' `--- PASS` lines.
3. Step 2 findings: the revoke call sites found; whether the shared-grant skip shipped and which paragraph was kept; every place where shipped behaviour differed from Step 3's text and what was written instead.
4. "Coverage floors unchanged and not measured locally (user request); the CI full shards measure them."
5. What was not run: a full `./internal/service` run with `-race`, `make check`, E2E; the §10 manual checklist (needs real Google/Microsoft credentials); Google verification/CASA (in progress outside the repo).
6. Merge order: stacked on GĐ2 (PR #221), which is stacked on GĐ1 (PR #220); targets `develop`; merges after both.
