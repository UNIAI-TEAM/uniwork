# UniChat N1 — Client PKCE native, scheme callback theo server, rate limit refresh theo thiết bị — Kế hoạch triển khai

> **Trạng thái:** shipped — issue UNI-1827, nhánh `feature/UNI-1827-unichat-n1-client-pkce-native-uniwork-ch`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hai app UniChat đăng nhập qua luồng PKCE sẵn có với client `uniwork-chat-desktop` / `uniwork-chat-mobile`, trang consent kiểm callback theo `redirect_uri` server trả về, refresh token mang tên client, và `/auth/desktop/refresh` giới hạn theo thiết bị dưới trần theo IP.

**Architecture:** Không đổi giao thức, bảng hay SDO. Backend: hai dòng `UserAgent` trong `service/desktop_auth.go` lấy `ClientID` từ row; router tách refresh khỏi `credentialLimit` và khỏi global limiter, bọc bằng hai `RateLimitByIdentityBucket` (trần IP trước, ngân sách thiết bị sau, mẫu `/mcp`). Frontend: `isDesktopCallbackUrl` chuyển sang `packages/views/auth/desktop-consent.tsx`, nhận `redirect_uri` của attempt thay vì danh sách scheme cứng.

**Tech Stack:** Go (chi, Redis fixed-window limiter), Next.js page + `@uniwork/views`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-auth-clients-design.md` (lát N1 của `2026-10-16-chat-native-apps-design.md`).

## Global Constraints

- Không sửa giao thức PKCE, bảng `desktop_auth_attempts` / `device_sessions` / `refresh_tokens`, audit action (spec §3.5). `start` và `exchange` vẫn dưới `credentialLimit`.
- Client và redirect chính xác (spec §3.1): `DESKTOP_AUTH_CLIENTS=uniwork-office=uniwork-office://auth/callback,uniwork-chat-desktop=uniworkchat://auth/callback|uniworkchat-dev://auth/callback,uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback`.
- Office giữ nguyên UA `uniwork-office/<platform>` (spec §3.3): `isNewDevice` không đổi hành vi.
- Quyết định builder (spec §6): header `X-UniWork-Device`; ngân sách thiết bị **60/phút** (bằng `credentialLimit` cũ, nên client không gửi header thấy đúng hành vi cũ theo IP), trần IP **600/phút**; `DesktopConsentSDO` **không thêm field** — `redirect_uri` đã có và issue cho phép "scheme (hoặc redirect)"; giữ hai client chat tách biệt.
- Redis quá 100 ms → fail open (sẵn trong `middleware.rateLimit`); không có Redis → limiter là no-op.
- Go: `gofmt`, `go vet`, `staticcheck`; TS strict, ESLint `--max-warnings 0`, file ≤ 500 dòng. Commit theo `feat(scope)` / `test(scope)` / `docs`, hook tự thêm `Refs: UNI-1827`.

## Review Focus

1. Request refresh **không có header** `X-UniWork-Device` (Office hiện hữu) phải được phục vụ với ngân sách theo IP như cũ (60/phút) — Task 3 test "no header".
2. Header `X-UniWork-Device` **không phải ULID** (rỗng, 5 ký tự, có `/`) phải rơi về IP, không mở counter riêng — Task 3 `TestDesktopDeviceKey`.
3. `callback_url` cùng scheme nhưng **khác host/path** (`uniworkchat://evil/callback`) hoặc `redirect_uri` của attempt bị hỏng (không parse được) → trang consent không mở app — Task 4 test.
4. Hai client chat **cùng một redirect** phải cùng được `Start`, nhưng Office không dùng được `uniworkchat://` và chat không dùng được `uniwork-office://` — Task 1.
5. `Refresh` của thiết bị Office sau khi đổi mã vẫn ghi đúng `uniwork-office/<platform>` (không phải chuỗi khác) — Task 2.

---

### Task 1: Ba client trong cấu hình và cấm dùng chéo redirect

**Files:**
- Modify: `.env.example:78-82` (ví dụ `DESKTOP_AUTH_CLIENTS` ba client)
- Modify: `deploy/app/env/uniwork-be.env:87` (thêm hai client chat vào `DESKTOP_AUTH_CLIENTS`, giữ `uniwork-office-dev`)
- Test: `server/internal/config/desktop_auth_clients_test.go`
- Test: `server/internal/service/desktop_auth_clients_test.go`

**Interfaces:**
- Consumes: `config.Load()`, `Config.DesktopClients()`, `DesktopAuthService.Start`, hằng `stableClient`/`stableRedirect` và helper `twoClientConfig()` trong `service/desktop_auth_clients_test.go`.
- Produces: helper `chatClientConfig() config.Config` (ba client như Global Constraints, `DesktopAuthDeploymentIDs: []string{"default"}`, TTL như `twoClientConfig`) và hằng `chatDesktopClient = "uniwork-chat-desktop"`, `chatMobileClient = "uniwork-chat-mobile"`, `chatRedirect = "uniworkchat://auth/callback"`, `chatDevRedirect = "uniworkchat-dev://auth/callback"` — Task 2 dùng lại.

- [ ] **Step 1: Test cấu hình** — thêm vào `server/internal/config/desktop_auth_clients_test.go`:

```go
func TestLoadDesktopAuthClientsAcceptsTheChatClientsSharingARedirect(t *testing.T) {
	setRequired(t)
	setDesktopAuthEnv(t, "uniwork-office=uniwork-office://auth/callback,uniwork-chat-desktop=uniworkchat://auth/callback|uniworkchat-dev://auth/callback,uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback", "", "")
	c, err := Load()
	if err != nil { t.Fatal(err) }
	want := []DesktopAuthClient{
		{ID: "uniwork-office", RedirectURIs: []string{"uniwork-office://auth/callback"}},
		{ID: "uniwork-chat-desktop", RedirectURIs: []string{"uniworkchat://auth/callback", "uniworkchat-dev://auth/callback"}},
		{ID: "uniwork-chat-mobile", RedirectURIs: []string{"uniworkchat://auth/callback", "uniworkchat-dev://auth/callback"}},
	}
	if got := c.DesktopClients(); !reflect.DeepEqual(got, want) { t.Fatalf("DesktopClients() = %#v, want %#v", got, want) }
}
```

- [ ] **Step 2: Test service** — thêm vào `server/internal/service/desktop_auth_clients_test.go` các hằng/helper ở Interfaces và:

```go
func TestDesktopAuthChatClientsShareARedirectButNotWithOffice(t *testing.T) {
	svc := NewDesktopAuthService(nil, nil, auth.TokenMinter{}, chatClientConfig()) // validateStart chạy trước mọi truy cập DB
	ok := func(client, redirect string) error {
		return svc.validateStart(DesktopStartInput{ClientID: client, RedirectURI: redirect, DeploymentID: "default", State: "s", CodeChallengeMethod: "S256", CodeChallenge: base64.RawURLEncoding.EncodeToString(func() []byte { s := sha256.Sum256([]byte(clientVerifier)); return s[:] }())})
	}
	for _, c := range []struct{ client, redirect string }{{chatDesktopClient, chatRedirect}, {chatDesktopClient, chatDevRedirect}, {chatMobileClient, chatRedirect}, {stableClient, stableRedirect}} {
		if err := ok(c.client, c.redirect); err != nil { t.Errorf("%s on %s: %v", c.client, c.redirect, err) }
	}
	for _, c := range []struct{ client, redirect string }{{stableClient, chatRedirect}, {chatDesktopClient, stableRedirect}, {chatMobileClient, "uniworkchat://auth/other"}} {
		var ve ValidationError
		if err := ok(c.client, c.redirect); !errors.As(err, &ve) { t.Errorf("%s on %s: err = %v, want ValidationError", c.client, c.redirect, err) }
	}
}
```

- [ ] **Step 3: Chạy test, mong đợi PASS ngay** (mã `allowed` đã đúng — test này là chốt hồi quy):

Run: `cd server && go test ./internal/config/ ./internal/service/ -run 'DesktopAuthClients|ChatClients' -count=1`
Expected: PASS. Nếu test service cần DB (`testutil.DB`), bỏ `nil` pool và dùng `testutil.DB(t)` như các test bên cạnh.

- [ ] **Step 4: Sửa `.env.example` dòng 82** thành ví dụ ba client (chuỗi ở Global Constraints), giữ comment giải thích; sửa `deploy/app/env/uniwork-be.env:87` thành `uniwork-office=…,uniwork-office-dev=…,uniwork-chat-desktop=uniworkchat://auth/callback|uniworkchat-dev://auth/callback,uniwork-chat-mobile=uniworkchat://auth/callback|uniworkchat-dev://auth/callback`.

- [ ] **Step 5: Kiểm env contract**

Run: `node --test scripts/env-example.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .env.example deploy/app/env/uniwork-be.env server/internal/config/desktop_auth_clients_test.go server/internal/service/desktop_auth_clients_test.go
git commit -m "feat(auth): khai báo client PKCE uniwork-chat-desktop và uniwork-chat-mobile"
```

---

### Task 2: UserAgent của refresh token theo client

**Files:**
- Modify: `server/internal/service/desktop_auth.go:350` và `:451`
- Test: `server/internal/service/desktop_auth_test.go`

**Interfaces:**
- Consumes: `chatClientConfig()`, `chatMobileClient`, `chatRedirect` (Task 1); `q.GetRefreshTokenByHash(ctx, hashToken(raw))` trả row có `UserAgent`; `svc.Refresh(ctx, deviceID, rawToken, "default")`.
- Produces: không có.

- [ ] **Step 1: Test** — thêm vào `server/internal/service/desktop_auth_test.go`:

```go
func TestDesktopRefreshTokenUserAgentNamesTheClient(t *testing.T) {
	pool := testutil.DB(t); q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("desktop-test"), TTL: time.Minute}
	svc := NewDesktopAuthService(pool, q, minter, chatClientConfig())
	ctx := context.Background()
	for _, c := range []struct{ client, redirect, platform, want string }{
		{chatMobileClient, chatRedirect, "ios", "uniwork-chat-mobile/ios"},
		{stableClient, stableRedirect, "windows", "uniwork-office/windows"},
	} {
		u, err := NewAuthService(pool, q, minter, time.Hour, nil).Register(ctx, c.client+"-ua@example.com", "password123", "UA", "en")
		if err != nil { t.Fatal(err) }
		sum := sha256.Sum256([]byte(clientVerifier))
		attempt, err := svc.Start(ctx, DesktopStartInput{ClientID: c.client, CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: "ua-" + c.client, RedirectURI: c.redirect, DeploymentID: "default", Platform: c.platform})
		if err != nil { t.Fatal(err) }
		consent, err := svc.Consent(ctx, u.User.ID, attempt.ID); if err != nil { t.Fatal(err) }
		code, _, err := svc.Approve(ctx, u.User.ID, attempt.ID, consent.CSRFToken); if err != nil { t.Fatal(err) }
		sess, err := svc.Exchange(ctx, c.client, code, clientVerifier, c.redirect, "default"); if err != nil { t.Fatal(err) }
		if rt, err := q.GetRefreshTokenByHash(ctx, hashToken(sess.RefreshToken)); err != nil || rt.UserAgent != c.want { t.Fatalf("exchange UA = %q (%v), want %q", rt.UserAgent, err, c.want) }
		next, err := svc.Refresh(ctx, sess.DeviceSessionID, sess.RefreshToken, "default"); if err != nil { t.Fatal(err) }
		if rt, err := q.GetRefreshTokenByHash(ctx, hashToken(next.RefreshToken)); err != nil || rt.UserAgent != c.want { t.Fatalf("refresh UA = %q (%v), want %q", rt.UserAgent, err, c.want) }
	}
}
```

- [ ] **Step 2: Chạy, mong đợi FAIL** với `exchange UA = "uniwork-office/ios" … want "uniwork-chat-mobile/ios"`:

Run: `cd server && go test ./internal/service/ -run TestDesktopRefreshTokenUserAgentNamesTheClient -count=1`

- [ ] **Step 3: Sửa hai dòng** trong `service/desktop_auth.go`: dòng 350 `UserAgent: row.ClientID + "/" + row.Platform`; dòng 451 `UserAgent: device.ClientID + "/" + device.Platform`. Không đổi gì khác.

- [ ] **Step 4: Chạy lại gói service cho desktop auth**

Run: `cd server && go test ./internal/service/ -run 'Desktop' -count=1`
Expected: PASS (các test ownership/family/clients hiện có vẫn xanh).

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/desktop_auth.go server/internal/service/desktop_auth_test.go
git commit -m "feat(auth): refresh token native ghi user_agent theo client_id"
```

---

### Task 3: Rate limit `/auth/desktop/refresh` theo thiết bị dưới trần theo IP

**Files:**
- Modify: `server/internal/handler/router/router.go:94-97` (ExceptPaths + tạo limiter), `:169` (truyền vào `registerAuth`)
- Modify: `server/internal/handler/router/auth.go:22` (chữ ký `registerAuth`), `:96-97` (route refresh)
- Create: hàm `desktopDevice` trong `server/internal/handler/router/auth.go` (cạnh `registerAuth`)
- Test: `server/internal/handler/router/ratelimit_test.go` (thêm field `device` vào `caller`)
- Modify: `docs/api-sdi-sdo.md:133` (một dòng về header đọc ở middleware)

**Interfaces:**
- Consumes: `mw.RateLimitByIdentityBucket(rdb, bucket, limit, window, proxies, identity)`, `mw.ExceptPaths`, `api.With(mws...)` (chi: middleware đầu chạy trước), `mcpBearer` làm mẫu.
- Produces: `func desktopDevice(r *http.Request) string` — trả `"device:" + id` khi header `X-UniWork-Device` (sau `TrimSpace`) dài đúng 26 ký tự và chỉ gồm `0-9A-Za-z`; ngược lại `""` (rơi về IP). `registerAuth(v1 api, h Routes, credentialLimit, refreshLimit func(http.Handler) http.Handler)`; `refreshLimit` do `router.go` dựng là `func(next) = ceiling(perDevice(next))` với `ceiling = RateLimitByIdentityBucket(d.Redis, "desktop-refresh-ip", 600, time.Minute, proxies, nil)` và `perDevice = RateLimitByIdentityBucket(d.Redis, "desktop-refresh", 60, time.Minute, proxies, desktopDevice)`; refresh dùng `v1.With(refreshLimit)` thay `credentialLimit`, và `"/api/v1/auth/desktop/refresh"` được thêm vào danh sách `ExceptPaths` của global limiter (route có trần IP riêng; global 300/IP sẽ chặn đúng ca NAT nhà mạng mà lát này sửa).

- [ ] **Step 1: Test key** — thêm vào `ratelimit_test.go`:

```go
func TestDesktopDeviceKey(t *testing.T) {
	req := func(v string) *http.Request { r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/desktop/refresh", nil); if v != "" { r.Header.Set("X-UniWork-Device", v) }; return r }
	id := "01J8X4DEVN1P2Q3R4S5T6W7V8X"[:26]
	a := desktopDevice(req(id))
	if a == "" || a != desktopDevice(req(" "+id+" ")) { t.Fatalf("a ULID must key, whatever the spacing: %q", a) }
	if b := desktopDevice(req("01J8X4DEVN1P2Q3R4S5T6W7V8Y")); b == "" || b == a { t.Fatalf("another id must key differently: %q vs %q", b, a) }
	for name, v := range map[string]string{"none": "", "short": "abc", "long": id + "0", "slash": "01J8X4DEVN1P2Q3R4S5T6W7V/", "space inside": "01J8X4DEVN1P 2Q3R4S5T6W7V"} {
		if got := desktopDevice(req(v)); got != "" { t.Errorf("%s: key = %q, want the address fallback", name, got) }
	}
}
```

- [ ] **Step 2: Test ngân sách** — thêm `device string` vào `caller` (gửi `X-UniWork-Device` khi khác rỗng) và:

```go
// Spec N1 §3.4: phones behind one carrier address each refresh on their own
// budget; the address ceiling still stops a caller rotating device ids; a
// client that sends no header (Office today) keeps the old 60 a minute per address.
func TestDesktopRefreshBudgetsEachDeviceUnderAnAddressCeiling(t *testing.T) {
	h, _ := limitedMux(t)
	const path = "/api/v1/auth/desktop/refresh"
	deviceID := func(i int) string { return fmt.Sprintf("01J8X4DEVN1P2Q3R4S5T6%05d", i) } // 26 chars
	carrier := "10.40.0.1"
	for i := 0; i < 100; i++ { caller{ip: carrier, device: deviceID(i)}.spend(t, h, http.MethodPost, path, 1) }
	one := caller{ip: carrier, device: deviceID(0)}
	one.spend(t, h, http.MethodPost, path, 59)
	one.wantRefused(t, h, http.MethodPost, path, "one device's budget: 60 a minute")
	caller{ip: carrier, device: deviceID(1)}.spend(t, h, http.MethodPost, path, 1)

	rotating := caller{ip: "10.40.0.2"}
	for i := 0; i < 600; i++ { rotating.device = deviceID(1000 + i); if code := rotating.send(h, http.MethodPost, path); code == http.StatusTooManyRequests { t.Fatalf("request %d of 600 refused", i+1) } }
	rotating.device = deviceID(9999)
	rotating.wantRefused(t, h, http.MethodPost, path, "the address ceiling: 600 a minute whatever the device id")

	legacy := caller{ip: "10.40.0.3"}
	legacy.spend(t, h, http.MethodPost, path, 60)
	legacy.wantRefused(t, h, http.MethodPost, path, "no header: the address's own 60 a minute, as before")
	// start and exchange stay on the credential budget, untouched by the above.
	caller{ip: carrier}.spend(t, h, http.MethodGet, "/api/v1/auth/desktop/start", 60)
	caller{ip: carrier}.wantRefused(t, h, http.MethodGet, "/api/v1/auth/desktop/start", "credential budget still 60 a minute per address")
}
```

- [ ] **Step 3: Chạy, mong đợi FAIL** (`desktopDevice` chưa có → lỗi biên dịch; sau khi thêm hàm, test ngân sách fail ở thiết bị thứ 61 vì credentialLimit/global theo IP):

Run: `cd server && REDIS_TEST_URL=$REDIS_TEST_URL go test ./internal/handler/router/ -run 'DesktopDeviceKey|DesktopRefreshBudgets' -count=1`
(`make test-go` xuất env; nếu chạy tay, lấy `REDIS_TEST_URL` từ `.env`/Makefile.)

- [ ] **Step 4: Cài đặt** theo Interfaces: `desktopDevice` trong `router/auth.go` (comment một dòng: id không được xác minh ở router, trần IP chặn kẻ xoay vòng id); đổi chữ ký `registerAuth` và route refresh; trong `router.go` dựng `refreshLimit` và thêm path vào `ExceptPaths`. Cập nhật `description` của apiOp refresh: thêm "Gửi header `X-UniWork-Device` = `device_session_id` để được ngân sách riêng theo thiết bị (60/phút) dưới trần theo IP (600/phút); không header thì theo IP."

- [ ] **Step 5: Chạy toàn gói router + lint Go**

Run: `cd server && go test ./internal/handler/router/ -count=1 && gofmt -l ./internal/handler/router && go vet ./internal/handler/router/ && go tool staticcheck ./internal/handler/router/`
Expected: PASS, không file nào in ra từ `gofmt -l`. `TestEveryRouteFieldIsBound` và các test MCP hiện có vẫn xanh.

- [ ] **Step 6: Docs** — ở `docs/api-sdi-sdo.md:133` thay ô "chưa dùng; …" bằng: "chưa có tag; header mà middleware đọc (vd `X-UniWork-Device` của `/auth/desktop/refresh`) được nêu trong `description` của `apiOp`; khi cần schema: `query:"…"`, `header:"…"` trên SDI của đúng route".

- [ ] **Step 7: Commit**

```bash
git add server/internal/handler/router/router.go server/internal/handler/router/auth.go server/internal/handler/router/ratelimit_test.go docs/api-sdi-sdo.md
git commit -m "feat(auth): giới hạn refresh native theo thiết bị dưới trần theo IP"
```

---

### Task 4: Trang consent kiểm callback theo `redirect_uri` của attempt

**Files:**
- Modify: `packages/views/auth/desktop-consent.tsx` (thêm export `isDesktopCallbackUrl`)
- Modify: `apps/web/app/(auth)/auth/desktop/authorize/page.tsx` (xoá hàm cục bộ, import từ views, truyền `consent.redirect_uri`)
- Test: `packages/views/auth/desktop-consent.test.tsx`
- Test: `apps/web/platform/auth/desktop-consent-page.test.tsx`

**Interfaces:**
- Consumes: `DesktopConsent.redirect_uri: string` (schema `packages/core/api/endpoints/auth.ts:32`, đã có).
- Produces: `export function isDesktopCallbackUrl(value: string, redirectUri: string | undefined): boolean` — `true` khi cả hai parse được bằng `new URL` và `protocol`, `hostname`, `pathname` của `value` bằng của `redirectUri`; `false` khi `redirectUri` rỗng/undefined hoặc một trong hai không parse được.

- [ ] **Step 1: Test views** — thêm vào `packages/views/auth/desktop-consent.test.tsx` (import `isDesktopCallbackUrl`):

```ts
describe("isDesktopCallbackUrl", () => {
  const redirect = "uniworkchat://auth/callback";
  it.each([
    ["uniworkchat://auth/callback?code=c&state=s", redirect, true],
    ["uniwork-office://auth/callback?code=c", "uniwork-office://auth/callback", true],
    ["uniwork-office://auth/callback?code=c", redirect, false],
    ["evil://auth/callback?code=c", redirect, false],
    ["uniworkchat://evil/callback?code=c", redirect, false],
    ["uniworkchat://auth/other?code=c", redirect, false],
    ["https://auth/callback", redirect, false],
    ["not a url", redirect, false],
    ["uniworkchat://auth/callback", "", false],
    ["uniworkchat://auth/callback", undefined, false],
    ["uniworkchat://auth/callback", "::broken", false],
  ])("%s against %s → %s", (value, redirectUri, expected) => {
    expect(isDesktopCallbackUrl(value, redirectUri)).toBe(expected);
  });
});
```

- [ ] **Step 2: Test page** — trong `apps/web/platform/auth/desktop-consent-page.test.tsx`: đổi mock của `@uniwork/views/auth/desktop-consent` sang `async (importOriginal) => ({ ...(await importOriginal<object>()), DesktopConsentView: ({ state, callbackUrl }) => <div data-testid="consent-state" data-callback={callbackUrl ?? ""}>{state}</div> })` và thêm:

```tsx
it.each([
  ["uniworkchat://auth/callback", "uniworkchat://auth/callback?code=c&state=s", "uniworkchat://auth/callback?code=c&state=s"],
  ["uniworkchat://auth/callback", "evil://auth/callback?code=c&state=s", ""],
  ["uniworkchat://auth/callback", "uniwork-office://auth/callback?code=c&state=s", ""],
])("reopens the app only on the attempt's own scheme (%s, saved %s)", async (redirectUri, saved, expected) => {
  state.status = "authed";
  state.read.mockResolvedValue({ status: "approved", redirect_uri: redirectUri });
  sessionStorage.setItem("desktop-callback:attempt-1", saved);
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.getAttribute("data-callback")).toBe(expected);
});
```

- [ ] **Step 3: Chạy, mong đợi FAIL** (`isDesktopCallbackUrl` chưa export; page còn danh sách cứng nên `uniworkchat` bị từ chối):

Run: `pnpm --filter @uniwork/views exec vitest run auth/desktop-consent.test.tsx && pnpm --filter @uniwork/web exec vitest run platform/auth/desktop-consent-page.test.tsx`

- [ ] **Step 4: Cài đặt** — thêm `isDesktopCallbackUrl` vào cuối `packages/views/auth/desktop-consent.tsx` (hàm thuần, không hook); trong `page.tsx` xoá hàm cục bộ, import từ `@uniwork/views/auth/desktop-consent`, và truyền `value.redirect_uri` / `consent.redirect_uri` ở ba chỗ gọi (callback đã lưu khi reload, `onOpenDesktop`, kết quả approve).

- [ ] **Step 5: Chạy lại + lint/typecheck hai gói**

Run: `pnpm --filter @uniwork/views exec vitest run auth/desktop-consent.test.tsx && pnpm --filter @uniwork/web exec vitest run platform/auth/desktop-consent-page.test.tsx && pnpm --filter @uniwork/views --filter @uniwork/web lint && pnpm --filter @uniwork/views --filter @uniwork/web typecheck`
Expected: PASS, 0 warning.

- [ ] **Step 6: Commit**

```bash
git add packages/views/auth/desktop-consent.tsx packages/views/auth/desktop-consent.test.tsx "apps/web/app/(auth)/auth/desktop/authorize/page.tsx" apps/web/platform/auth/desktop-consent-page.test.tsx
git commit -m "feat(web): trang consent desktop kiểm callback theo redirect_uri của attempt"
```

---

### Task 5: Chốt spec, kiểm tra hẹp theo issue

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-unichat-auth-clients-design.md` (dòng Trạng thái → shipped; §3.2 ghi "dùng `redirect_uri` sẵn có"; §3.4 ghi ngân sách 60/600 và tên header; §6 ghi quyết định)
- Modify: dòng Trạng thái của plan này → shipped

- [ ] **Step 1: Cập nhật hai dòng Trạng thái và ba đoạn spec** như trên (một câu mỗi chỗ).

- [ ] **Step 2: Chạy lệnh của issue**

Run: `make test-go` (hoặc hẹp: `cd server && go test ./internal/config/ ./internal/service/ ./internal/handler/router/ -count=1` với env của Makefile) và `pnpm --filter @uniwork/views exec vitest run auth/desktop-consent.test.tsx && pnpm --filter @uniwork/web exec vitest run platform/auth/desktop-consent-page.test.tsx` và `node --test scripts/governance.test.mjs scripts/env-example.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-16-unichat-auth-clients-design.md docs/superpowers/plans/2026-10-16-unichat-auth-clients.md
git commit -m "docs: chốt spec và plan lát N1 UniChat"
```

## Ngoài phạm vi (ghi nhận, không làm ở đây)

- Copy i18n `auth.desktop.title` / `approved` / `openDesktop` nêu đích danh "UniWork Office"; với client chat trang consent vẫn hiện tên Office và ô "Ứng dụng" hiện `client_id` thô. Thuộc UNI-1830/UNI-1831 (khi client thật xuất hiện) — cần ánh xạ `client_id` → tên hiển thị.
- Client Office hiện hữu chưa gửi `X-UniWork-Device`; không gửi thì giữ ngân sách 60/phút theo IP như cũ.
- Swagger không có schema header (openapi.go không đọc tag `header`); header được mô tả trong `description` của route.
