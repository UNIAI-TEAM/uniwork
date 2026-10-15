# G8-19 harness contract (UNI-1414)

Owner: T1 (`worker-g7-qa-g819-t1`). T2 (comments/anchors/file-scan), T3 (inbox/deeplink/revoke) and
T4 (account/library/spec) build their row modules against this file and against
`scripts/office/g5g6g7/g8-19/fake-world.mjs`, which implements every signature below in memory.
A change to this contract lands in ONE commit together with `fake-world.mjs`, and the coordinator gets
the SHA. Source of the proposal: `reports/g7-qa/g819-breakdown.md` §3 "Contract signatures"; every
refinement against that proposal is listed in §9.

All modules are ESM (`.mjs`), Node 22, no new dependencies. Playwright comes from `e2e/node_modules`
(as `tracer.mjs` loads it); `pg` likewise (`e2e/package.json`).

## 1. Modules

| Module | Exports (stable) |
|---|---|
| `harness/world.mjs` | `seedWorld(opts)`, `loadWorld(runDir)`, `WORLD_FILE`, `SQL_MEMBERSHIP_ENV`, `SQL_MEMBERSHIP_REASON`, `SQL_MEMBERSHIP_BLOCKER` |
| `harness/api.mjs` | `createApi({apiOrigin, fetchImpl?})`, `session(userRecord, {apiOrigin, fetchImpl?})` |
| `harness/api-contract.mjs` | `API_CALLS` (document step, unchanged but for `mintLaunch.comment_id`), `G8_CALLS` (the rows of §4), `G8_API_CALLS` = both, `apiPath(name, params, table = API_CALLS)`, `assertBodyKeys(name, body, table = API_CALLS)`, `ApiError`, `failureInfo` |
| `harness/web.mjs` | `webLogin(browser, user, opts)`, `openDocument(page, opts)`, `documentUrl(opts)` (pure URL rule of §6) |
| `harness/app.mjs` | `connectApp(opts)`, `COMMENTS_API_NAMES`, `DISCUSSION_API_NAMES`, `SHELL_API_NAMES`, `editorKindOfUrl(url)` |
| `g8-19/run-row.mjs` | `runRowModule(opts, fn)`, `rowArtifactPath(runDir,row,fixture)`, `decideFromSteps(steps)`, `exitCodeFor(status)`, `parseRowArgs(argv)`, `ROW_EXIT`, `B7_ANCHOR`, `WEB_FRAME_PIN_BLOCKER`, `WEB_FRAME_PIN_OWNER` |
| `g8-19/fake-world.mjs` | `createFakeWorld(opts)`, `FAKE_TIMEOUT`, `fakeNetworkError(message)` |

Row modules (`g8-19/{comments,anchors,file-scan,inbox,deeplink,revoke,account,library}.mjs`) belong to
T2-T4. Each one exports a pure `decideG8Axx(record)` and, when run as a script, calls `runRowModule`.

## 2. Users, orgs, workspaces (the world)

| Key | Who | How it is made |
|---|---|---|
| `A` | owner of org `X`; creates `W1` and `W2` | API: register, verify (code `123456`), create org, create workspaces, complete onboarding |
| `B` | member of `W2` only (org `X` member) | API: A invites B to `W2` -> B registers + verifies -> `GET /me/invitations` -> `POST /invitations/{token}/accept` -> onboarding |
| `C` | member of `W2` only, never shared any document = the non-reader | same invite flow as B |
| `M` | owner of org `Y` (workspace `WY`) AND member of org `X` / `W1` | API: M registers, creates `Y` + `WY`. The `X` membership is a raw SQL insert (see below) |

Org keys: `X` (workspaces `W1`, `W2`), `Y` (workspace `WY`). Documents are uploaded by A into `W1`
unless a row module says otherwise.

**Second org for M (ADR 0032).** The API refuses a second active org, so the `X`/`W1` membership of M is
two raw SQL inserts, the same shape `TestIsolationMatrix` uses
(`server/internal/handler/isolation_matrix_test.go:423,427`):

```sql
INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member');
INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3);
```

It runs ONLY when `G819_ALLOW_SQL_MEMBERSHIP=1`. Otherwise `world.record.users.M.multiOrg` is
`{ status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER }`
and every other part of the world is seeded normally. When it ran:
`{ status: "SEEDED", via: "sql", reason: SQL_MEMBERSHIP_REASON }`, where `SQL_MEMBERSHIP_REASON` names
ADR 0032 and says it is a test seed only. Row modules copy `multiOrg` into their artifact.

## 3. `harness/world.mjs`

```js
const world = await seedWorld({
  runDir,                 // required; the cache lives at join(runDir, WORLD_FILE)
  apiOrigin,              // required; ports.env API_ORIGIN
  dbUrl,                  // optional; default process.env.G819_DATABASE_URL ?? process.env.DATABASE_URL
  fetchImpl,              // optional; default global fetch
  sqlClientFactory,       // optional (tests): (dbUrl) => ({ connect(), query(text, params) -> {rowCount}, end() })
  env,                    // optional; default process.env (reads G819_ALLOW_SQL_MEMBERSHIP)
  now,                    // optional; stamps emails/slugs
  reuse = true,           // reuse a cached world for the same apiOrigin
});
```

`WORLD_FILE = "g8-19-world.json"`, written with mode `0600`. It holds passwords and access tokens and is
the ONLY place they are written. Nothing in `world.mjs` prints or logs a token, password, email or the
database URL. Every error message passes through the redaction of `ApiError`.

`world.record` (JSON, the cached file minus nothing):

```js
{
  apiOrigin, seededAt,
  users: { A: { key:"A", id, email, password, token, displayName, multiOrg? }, B: {...}, C: {...}, M: {..., multiOrg} },
  orgs:  { X: { id, slug, ownerKey:"A", workspaces: { W1: { id, slug }, W2: { id, slug } } },
           Y: { id, slug, ownerKey:"M", workspaces: { WY: { id, slug } } } },
  docs:  { "<documentId>": { documentId, versionId, workspaceKey, orgKey, ownerKey, fixtureId, filename } },
  shares: { "<shareId>": { shareId, documentId, userId, level, revoked:boolean } },
}
```

Methods on the returned `world` (all async, all throw an `ApiError` on an unexpected status, since
seeding is not under test; row modules assert through `api.mjs`, which never throws on 4xx):

| Method | Returns | Server call |
|---|---|---|
| `world.upload(userKey, wsKey, fixtureId, {title?})` | `{ documentId, versionId, filename }` | `createFileDocument` |
| `world.share(ownerKey, documentId, userId, level)` | `{ shareId }` (a user share; `level` = `view`/`edit`/`manage`, `ShareDocumentSDI`) | `createDocumentShare` |
| `world.revokeShare(ownerKey, documentId, shareId)` | `{ status }` | `revokeDocumentShare` |
| `world.deactivate(ownerKey, orgKey, userId)` | `{ status }` | `deactivateOrgMember` |
| `world.session(userKey)` | the `session()` of §5 for that user | - |
| `world.user(key)` / `world.org(key)` / `world.workspace(orgKey, wsKey)` | the record entries | - |
| `world.cleanup()` | `{ leftovers: string[] }` - names of things it could not remove (org deletion request refused, SQL rows left, cache file); never throws | `requestOrganizationDeletion`, `deleteAccount` |

`loadWorld(runDir)` -> the record or `null` (no file / unreadable / other apiOrigin is the caller's check).

## 4. API rows (`harness/api-contract.mjs` `G8_CALLS`; `api.mjs` calls `G8_API_CALLS`)

Every row is checked against the Go router, handler and SDI struct by `api-contract.test.mjs` (the same
check as the existing rows), so a name below is a route the server registers. Path params: `documentID`,
`commentID`, `workspaceID`, `shareID`, `userID` are ids; `org` is the organization **slug** for
`deactivateOrgMember` (`handler/organization_members.go:96` `orgIDFromSlug`; verified by the contract
test); `token` is the invitation token.

| Name | Method + path (under `/api/v1`) | Body keys |
|---|---|---|
| `listDocumentComments` | GET `/documents/{documentID}/comments` (query `kind`, `since_token`) | - |
| `createDocumentComment` | POST `/documents/{documentID}/comments` | `body`, `parent_id`, `kind`, `anchor`, `base_version_id` |
| `putDocumentCommentAnchors` | PUT `/documents/{documentID}/comments/anchors` | `version_id`, `anchors` |
| `updateDocumentComment` | PATCH `/documents/{documentID}/comments/{commentID}` | `body` |
| `deleteDocumentComment` | DELETE `/documents/{documentID}/comments/{commentID}` | - |
| `resolveDocumentComment` | POST `/documents/{documentID}/comments/{commentID}/resolve` | - |
| `reopenDocumentComment` | DELETE `/documents/{documentID}/comments/{commentID}/resolve` | - |
| `listDocumentCommentRevisions` | GET `/documents/{documentID}/comments/{commentID}/revisions` | - |
| `listMentionCandidates` | GET `/documents/{documentID}/mention-candidates` (query `q`, `limit`) | - |
| `listNotifications` | GET `/me/notifications` | - |
| `unreadNotificationCount` | GET `/me/notifications/unread-count` | - |
| `markNotificationsRead` | POST `/me/notifications/read` | `ids`, `all`, `workspace_id` |
| `listDocumentShares` | GET `/documents/{documentID}/shares` | - |
| `createDocumentShare` | POST `/documents/{documentID}/shares` | `principal_type`, `principal_id`, `level` |
| `revokeDocumentShare` | DELETE `/documents/{documentID}/shares/{shareID}` | - |
| `createInvitation` | POST `/workspaces/{workspaceID}/invitations` | `email`, `role` |
| `myInvitations` | GET `/me/invitations` | - |
| `acceptInvitation` | POST `/invitations/{token}/accept` | - |
| `mintLaunch` (existing) | POST `/documents/{documentID}/office/sessions` | adds optional `comment_id` |
| `getDocument` | GET `/documents/{documentID}` | - |
| `patchDocument` (rename) | PATCH `/documents/{documentID}` | `revision`, `title` |
| `archiveDocument` | POST `/documents/{documentID}/archive` | - |
| `restoreDocument` | POST `/documents/{documentID}/restore` | - |
| `copyDocument` | POST `/documents/{documentID}/copies` | `consent`, `title` |
| `listSharedWithMe` | GET `/workspaces/{workspaceID}/documents/shared-with-me` | - |
| `deactivateOrgMember` | POST `/orgs/{org}/members/{userID}/deactivate` | - |
| `completeOnboarding` | POST `/me/onboarding/complete` | `completion_path`, `workspace_id` |

The exact body key lists are pinned in `api-contract.mjs` itself and its test; this table is the
intent. A row module never builds an `/api/v1` path by hand.

## 5. `harness/api.mjs`

```js
const api = createApi({ apiOrigin, fetchImpl });
const s = api.session(world.user("B"));          // or world.session("B"), or session(user, {apiOrigin})
const res = await s.call(name, pathParams = {}, body = undefined, { query, headers, timeoutMs = 30_000 } = {});
// res = { status: number, body: any | null, ok: boolean, error?: string }
```

- Never throws on an HTTP status (2xx-5xx all return `{status, body}`).
- A network failure or the timeout returns `{ status: 0, body: null, ok: false, error }` (also no throw).
- Throws (programming errors only): unknown `name`, wrong/missing path params, a body key the row does
  not list (`assertBodyKeys`).
- `body` is the parsed JSON, `null` for an empty body, `{ rawText }` when not JSON.
- `error` and every thrown message are redacted (no token, ticket, password).
- `s.user` is the user record; `s.userKey` its key. A session with no token sends no `authorization`.

## 6. `harness/web.mjs`

```js
const web = await webLogin(browser, user, { webOrigin, locale = "en", timeoutMs });
// web = { context, page, user, locale, setLocale(locale), close() }
const opened = await openDocument(web.page, { webOrigin, org, ws, documentId, comment, kind });
// opened = { url, status: "ok" | "no-access" | "not-found" | "error", panelCount, focusedCommentId }
```

- `org`, `ws` are slugs. `comment` -> `?comment=<id>`, `kind:"discussion"` -> `&kind=discussion`
  (mirrors `packages/views/notifications/resource-href.ts`).
- `webLogin` signs in through the D `/login` page with the user's email/password, sets the
  `uniwork-locale` cookie to `locale`, and never logs the password.
- `panelCount` = number of comment panels on the page; `focusedCommentId` = the focused thread id or
  `null`. `status` reads the S15 states the page renders.

## 7. `harness/app.mjs`

```js
const ctrl = await connectApp({ portsEnv, runDir, cdpConnector?, deepLinkDeliverer?, timeoutMs? });
```

| Member | Contract |
|---|---|
| `ctrl.browser`, `ctrl.shellPage` | the CDP browser and the shell page |
| `ctrl.signIn(user, { expectOrgChoice = false })` | drives `aiOffice.accountLogin` + the web consent as `user`; resolves `{ status, orgChoiceShown, orgApiCallsBeforeChoice }` where `status` = `aiOffice.accountStatus()` after the flow |
| `ctrl.selectOrg(orgId)` | `aiOffice.accountSelectOrg(orgId)` -> account status |
| `ctrl.signOut()` | `aiOffice.accountLogout()` -> account status |
| `ctrl.openByTicket(launchUrl)` | delivers the deep link (`uniwork-office-dev://open?ticket=...`), waits for the editor tab; `{ path, documentId, kind }` |
| `ctrl.editorPage(kind)` | the editor page whose URL kind is `kind` (`docs`/`sheets`/`slides`/`pdf`), chosen by `editorKindOfUrl(page.url())`; throws `no <kind> editor page` |
| `ctrl.comments(page)` | `{ list, create, update, remove, resolve, reopen, revisions, anchors, searchMentions, context }`: each evaluates `window.uniworkComments.<name>(input)` on `page` and resolves the `CommentsReply` envelope `{ok:true,value}` / `{ok:false,error}` UNCHANGED. Inputs are the fork shapes (`path`, `kind`, `parentId`, `body`, `anchor`, `baseVersionId`, `commentId`, `versionId`, `anchors[]`, `q`, `limit`) |
| `ctrl.discussion()` | `{ list, create, update, remove, resolve, reopen, revisions, searchMentions }` over `window.uniworkDiscussion.*` on the shell page, same envelope |
| `ctrl.aiOffice(name, ...args)` | `window.aiOffice[name](...args)` on the shell page; `name` must be in `SHELL_API_NAMES` (account*, uniwork* library/save calls) or it throws |
| `ctrl.save(path)` | `aiOffice.uniworkSave(path)` -> doc status |
| `ctrl.focus(path)` | brings the editor tab for `path` to the front and fires a window `focus` on it (forces the desktop comment poll) |
| `ctrl.selection(kind)` | `window.__genofficeControl({ cmd: "selection" })` on the `kind` editor page |
| `ctrl.evalBounded(page, fn, arg, call)` | `page.evaluate(fn, arg)` under `HARNESS_APP_STEP_TIMEOUT_MS`; on timeout throws an `Error` with `isAppStepTimeout: true` and `appStepTimeout: { call, timeoutMs, elapsedMs, reason, appLogTail }` |
| `ctrl.close()` | disconnects CDP; never kills the app (stop.sh owns it) |

`COMMENTS_API_NAMES` / `DISCUSSION_API_NAMES` are exactly the keys of the fork's `COMMENTS_CHANNELS` /
`DISCUSSION_CHANNELS` that the bridges expose as calls (fork `7d665a54`,
`packages/electron-utils/src/comments-ipc.ts:25-48,346-365`, bridges `comments-bridge.ts:34-44,72`,
`discussion-bridge.ts:20-28`). Push channels (`reveal`, `saved`, `revealPending`, `panel`) are not calls.

## 8. `g8-19/run-row.mjs`

```js
const exit = await runRowModule(
  { row: "G8-A01", fixture: "fx-docx-report-vi", runDir, timeoutMs, module: "comments", argv, repoRoot },
  async (ctx) => record,
);
process.exit(exit);
```

1. **Gate.** Reads `start.status` through `startGate` (`harness/lib.mjs`). Not `proceed` -> the start
   gate's own outcome (`blocked` -> 77 with the start blocker, else 1). `fn` is not called.
2. **ports.env.** Missing file or missing `API_ORIGIN` -> FAIL (1) with the reason.
3. **ctx** passed to `fn`:
   `{ row, fixture, runDir, repoRoot, portsEnv, apiOrigin, webOrigin, getWorld(), api, step(name, fn), block(blocker, owner), log(msg) }`.
   - `getWorld()` seeds or reuses the world (memoised).
   - `step(name, fn)` runs `fn`, stores `{ status, reason?, blocker?, owner?, elapsedMs, details? }` under
     `record.steps[name]`; a thrown error becomes `FAIL` with the redacted message; `fn` may return
     `{ status, ... }` to set it, otherwise `PASS`.
   - `block(blocker, owner)` returns a BLOCKED step result to return from a step.
4. **Record** returned by `fn`:
   `{ status?: "PASS"|"FAIL"|"BLOCKED", reason?, blocker?, owner?, steps?, details? }`. When `status` is
   absent it is `decideFromSteps(steps)`: any FAIL -> FAIL; else any BLOCKED -> BLOCKED with the blockers
   joined by `"; "`; else (at least one step) PASS; no steps -> FAIL `"no steps ran"`.
5. **Exit mapping** (`ROW_EXIT`): PASS -> 0, FAIL -> 1, BLOCKED -> 77 **only with a non-empty
   `blocker`**; a BLOCKED without a blocker is rewritten to FAIL (`"BLOCKED without a named blocker"`).
   A throw from `fn` -> FAIL (1).
6. **Watchdog.** `timeoutMs` (default `G819_ROW_TIMEOUT_MS`, else 600000): on expiry the record is FAIL
   with reason `"row watchdog"`, the step running at that moment is marked FAIL `"row watchdog"`, and the
   artifact is still written.
7. **Artifact** at `rowArtifactPath(runDir, row, fixture)` =
   `<runDir>/reports/g7-qa/<row lower-case>/<fixture>.json`, e.g.
   `<runDir>/reports/g7-qa/g8-a01/fx-docx-report-vi.json`. It is truncated at the start of the run. Its
   JSON: `{ row, fixture, module, status, exitCode, reason, blocker, owner, steps, details, startedAt, finishedAt, forkSha, appLogTail }`.
   The evidence line is written by `evidence.mjs run` (the spec wraps every module); `run-row` writes
   none itself unless `OFFICE_EVIDENCE_ID` is unset AND `G819_WRITE_EVIDENCE=1`.
8. **CLI** (`parseRowArgs`): `--row G8-Axx --fixture <id> --run-dir <dir> [--timeout-ms <ms>]`;
   `--run-dir` defaults to `HARNESS_RUN_DIR`.

Constants:

```js
// fx-xlsx-revenue-xyz: workbook sheetId 2 = "Doanh thu Q2"; the sheets reader names file sheets
// `sheet-<sheetId>` (fork apps/sheets/src/renderer/server-comments/anchor-store.ts:51-56,86-88).
export const B7_ANCHOR = Object.freeze({ format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" });
export const B7_SHEET_NAME = "Doanh thu Q2";
export const WEB_FRAME_PIN_BLOCKER = "web frame pin 05fd209 lacks G8-12..15 (R1)";
export const WEB_FRAME_PIN_OWNER = "lead-f";
```

## 9. Env knobs

| Variable | Read by | Meaning |
|---|---|---|
| `HARNESS_RUN_DIR` | run-row | default `--run-dir` |
| `OFFICE_FORK_SHA` | start.sh, run-row artifact | the spec MUST export `7d665a54` (start.sh defaults to `0d03b18`) |
| `G819_ALLOW_SQL_MEMBERSHIP` | world | `1` allows the raw SQL second-org seed for M (§2) |
| `G819_DATABASE_URL` / `DATABASE_URL` | world | Postgres for that seed only; never printed |
| `G819_ROW_TIMEOUT_MS` | run-row | watchdog per row module (default 600000) |
| `G819_WRITE_EVIDENCE` | run-row | `1` = append an evidence line when not wrapped by evidence.mjs |
| `HARNESS_APP_STEP_TIMEOUT_MS` | app | bound per CDP call (default 90000) |
| `HARNESS_DOCS_CLOSE_SETTLE_MS` | app | as G7-10 |

## 10. Fake (`g8-19/fake-world.mjs`)

```js
const fake = createFakeWorld({ sqlMembership = true, users, orgs });
// fake = { world, api, web, app, calls, script, browser }
```

- `fake.world` has the §3 shape and methods with deterministic ids (`user-A`, `org-X`, `ws-W1`,
  `doc-1`, `ver-1`, `share-1`). `sqlMembership:false` gives M the BLOCKED `multiOrg` marker.
- `fake.api` = `{ session(user) }`; `fake.world.session(key)` uses it. Same validation as §5 (unknown
  name / bad params / unknown body keys throw).
- `fake.web` = `{ webLogin, openDocument }`; `fake.app` = `{ connectApp }` -> a fake `ctrl` with every §7
  member. `fake.browser` is the opaque browser to pass to `webLogin`.
- **Scripting** (`fake.script`): `respond(key, valueOrFn)` sets a standing answer, `queue(key, valueOrFn)`
  a one-shot answer (FIFO, wins over `respond`). A function gets the recorded call and returns the answer.
  Keys: `api.<name>` (answer `{status, body}`), `web.webLogin` / `web.openDocument`,
  `app.signIn` / `app.selectOrg` / `app.signOut` / `app.openByTicket` / `app.save` / `app.focus` /
  `app.selection` / `app.evalBounded`, `app.comments.<name>`, `app.discussion.<name>`,
  `app.aiOffice.<name>`, `world.<method>` (to make a world method fail).
  - `FAKE_TIMEOUT` as an answer: an api call resolves `{status:0, ok:false, body:null, error:"timeout"}`;
    an app call rejects with the §7 `isAppStepTimeout` error; a web call rejects with a timeout error.
  - `fakeNetworkError(msg)` as an api answer resolves `{status:0, ok:false, body:null, error: msg}`.
  - An answer that is an `Error` makes the call reject with it.
- **Unscripted defaults:** api -> `{status: 501, ok:false, body:{error:"fake_unscripted", name}}`; app
  comments/discussion -> `{ok:false, error:{code:"fake_unscripted", message:name}}`; `app.aiOffice.*`,
  `app.selection`, `app.save` -> `null`; `openByTicket` -> `{path:"/fake/<doc>", documentId, kind}` parsed
  from nothing (`documentId:null`) unless scripted; `web.openDocument` ->
  `{url, status:"ok", panelCount:1, focusedCommentId: comment ?? null}` with the real URL rule of §6;
  `signIn` -> `{status:{loggedIn:true,state:"signed-in"}, orgChoiceShown:false, orgApiCallsBeforeChoice:0}`.
- **Calls** (`fake.calls`): `api`, `web`, `app`, `world` arrays of `{key, user?, args}` in call order;
  `fake.calls.all` is every call in order.

## 11. Changes against the planner proposal (§3 "Contract signatures")

1. `seedWorld` takes no `users`/`orgs` list: the world shape is fixed (§2) so every row module sees the
   same keys. M owns `Y` (made through the API) and gets `X` by SQL, instead of the reverse; same effect,
   one SQL path.
2. World methods take user **keys** (`"A"`), not user objects, plus `world.session(key)`.
3. `session(user).call` adds a 4th `opts` arg (`query`, `timeoutMs`) and returns `ok` and `error`; network
   errors resolve with `status: 0` instead of throwing.
4. `webLogin` returns `setLocale` and `close`; `openDocument` takes `webOrigin` and returns a result object.
5. `ctrl.aiOffice(name, ...args)` added (T4's library calls); `ctrl.comments(page)` adds `revisions`;
   `ctrl.discussion()` gets the whole discussion bridge.
6. `runRowModule` takes `module` and returns the exit code; the artifact dir is
   `<runDir>/reports/g7-qa/g8-aXX/<fixture>.json` (under the run dir, so the cloud collect step picks it up
   with the run dir).
7. `B7_ANCHOR.sheet` is `"sheet-2"` (the stable id the sheets reader gives the file's sheetId 2), not a
   placeholder.
