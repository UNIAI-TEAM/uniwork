package handler

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func uploadUserAvatar(t *testing.T, w *officeWorld, userToken, filename string, body []byte) {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/me/avatar", userToken, nil, filename, body, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload avatar %s = %d %s", filename, res.StatusCode, raw)
	}
}

func TestOfficeFrameAvatar(t *testing.T) {
	uploadDir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", uploadDir)
	var pool *pgxpool.Pool
	w := newOfficeWorldTweaked(t, true, func(*filesfake.Fake) service.OfficeEngine {
		return newHandlerStubEngine(t)
	}, func(d *Deps, p *pgxpool.Pool) {
		pool = p
		q := db.New(p)
		stores, err := storage.BuildStores(context.Background(),
			storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: uploadDir}},
			storage.NewDefaultRegistry())
		if err != nil {
			t.Fatal(err)
		}
		fs, err := service.NewFileService(service.FileServiceOptions{
			Pool: p, Store: stores[storage.BackendLocal], SpoolDir: t.TempDir(),
			ReferenceProviders: service.FileReferenceProviders(d.Chat, d.Meetings),
			Quota:              service.NewEntitlementService(p, q),
		})
		if err != nil {
			t.Fatal(err)
		}
		d.Auth.SetFiles(fs)
		d.People.SetFiles(fs)
	})
	enableOfficeDocsWeb(t, w.q)
	ctx := context.Background()

	documentID := w.createDocx(t, "plan.docx", frameDocx(t, "avatars"))
	secondDocID := w.createDocx(t, "second.docx", frameDocx(t, "second"))
	mdID := w.createMarkdownFile(t, "# notes\n")
	token := w.mintFrameToken(t, documentID)["token"].(string)
	mdToken := w.mintFrameToken(t, mdID)["token"].(string)
	base := "/api/v1/office-frame/documents/" + documentID + "/avatars/"

	// Upload a file-backed PNG avatar for the same-org member (w.outsider is in
	// w.orgID). Pad past 512 bytes so the sniff buffer and stream reassembly are
	// both exercised.
	pngBody := append(append([]byte(nil), docsPNG...), bytes.Repeat([]byte{0}, 600)...)
	uploadUserAvatar(t, w, w.outsiderTok, "me.png", pngBody)
	fileID, err := w.q.GetUserAvatarFileID(ctx, w.outsider)
	if err != nil || !fileID.Valid || fileID.String == "" {
		t.Fatalf("GetUserAvatarFileID = %+v, %v", fileID, err)
	}
	wantETag := `"` + fileID.String + `"`

	// 1. 200 GET + security and cache headers.
	res, got := doBytes(t, w.srv, http.MethodGet, base+w.outsider, token)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET avatar = %d %s", res.StatusCode, got)
	}
	if !bytes.Equal(got, pngBody) {
		t.Fatalf("GET avatar body len = %d, want %d", len(got), len(pngBody))
	}
	for header, want := range map[string]string{
		"Content-Type":            "image/png",
		"Content-Length":          strconv.Itoa(len(pngBody)),
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "sandbox; default-src 'none'",
		"Cache-Control":           "private, max-age=300",
		"ETag":                    wantETag,
		"Vary":                    "Authorization",
		"Content-Disposition":     `inline; filename="avatar"`,
	} {
		if v := res.Header.Get(header); v != want {
			t.Errorf("GET header %s = %q, want %q", header, v, want)
		}
	}
	if ar := res.Header.Get("Accept-Ranges"); ar != "" {
		t.Errorf("Accept-Ranges = %q, want empty (no Range support)", ar)
	}

	// Range header is ignored: still 200 with the full body.
	res, got = doBytes(t, w.srv, http.MethodGet, base+w.outsider, token, "Range", "bytes=0-3")
	if res.StatusCode != http.StatusOK || len(got) != len(pngBody) {
		t.Fatalf("GET with Range = %d (%d bytes), want 200 (%d bytes)", res.StatusCode, len(got), len(pngBody))
	}

	// 2. HEAD: same headers, no body.
	headRes, headBody := doBytes(t, w.srv, http.MethodHead, base+w.outsider, token)
	if headRes.StatusCode != http.StatusOK || len(headBody) != 0 {
		t.Fatalf("HEAD avatar = %d (%d bytes), want 200 empty", headRes.StatusCode, len(headBody))
	}
	if headRes.Header.Get("Content-Type") != "image/png" ||
		headRes.Header.Get("Content-Length") != strconv.Itoa(len(pngBody)) ||
		headRes.Header.Get("ETag") != wantETag ||
		headRes.Header.Get("Cache-Control") != "private, max-age=300" ||
		headRes.Header.Get("Vary") != "Authorization" {
		t.Fatalf("HEAD headers = %v", headRes.Header)
	}

	// 3. 304 on If-None-Match (exact and weak), 200 on non-matching ETag.
	for _, inm := range []string{wantETag, "W/" + wantETag, `"other", ` + wantETag} {
		r304, b304 := doBytes(t, w.srv, http.MethodGet, base+w.outsider, token, "If-None-Match", inm)
		if r304.StatusCode != http.StatusNotModified || len(b304) != 0 {
			t.Fatalf("GET If-None-Match %s = %d (%d bytes), want 304 empty", inm, r304.StatusCode, len(b304))
		}
		if r304.Header.Get("ETag") != wantETag || r304.Header.Get("Vary") != "Authorization" {
			t.Errorf("304 headers = %v", r304.Header)
		}
	}
	if r200, b200 := doBytes(t, w.srv, http.MethodGet, base+w.outsider, token, "If-None-Match", `"stale-file-id"`); r200.StatusCode != http.StatusOK || !bytes.Equal(b200, pngBody) {
		t.Fatalf("GET non-matching If-None-Match = %d", r200.StatusCode)
	}

	// JPEG, GIF and WebP avatars also sniff and serve their canonical MIME.
	for _, c := range []struct {
		name string
		mime string
		body []byte
	}{
		{"a.jpg", "image/jpeg", sampleBody(t, "image/jpeg")},
		{"a.gif", "image/gif", sampleBody(t, "image/gif")},
		{"a.webp", "image/webp", webpLossless1x1},
	} {
		uploadUserAvatar(t, w, w.token, c.name, c.body)
		r, b := doBytes(t, w.srv, http.MethodGet, base+w.userID, token)
		if r.StatusCode != http.StatusOK || r.Header.Get("Content-Type") != c.mime || !bytes.Equal(b, c.body) {
			t.Fatalf("%s: status=%d ct=%q len=%d", c.name, r.StatusCode, r.Header.Get("Content-Type"), len(b))
		}
	}

	// 4. Every "nothing to serve" case returns a 404 body byte-identical to an
	// unknown ULID.
	unknownID := util.NewID()
	res404, want404 := doBytes(t, w.srv, http.MethodGet, base+unknownID, token)
	if res404.StatusCode != http.StatusNotFound || len(want404) == 0 {
		t.Fatalf("unknown id = %d %s, want 404", res404.StatusCode, want404)
	}
	assertUniform404 := func(label, url, bearer string, headers ...string) {
		t.Helper()
		r, b := doBytes(t, w.srv, http.MethodGet, url, bearer, headers...)
		if r.StatusCode != http.StatusNotFound || !bytes.Equal(b, want404) {
			t.Errorf("%s: GET %s = %d %q, want 404 %q", label, url, r.StatusCode, b, want404)
		}
		hr, hb := doBytes(t, w.srv, http.MethodHead, url, bearer, headers...)
		if hr.StatusCode != http.StatusNotFound || len(hb) != 0 {
			t.Errorf("%s: HEAD %s = %d (%d bytes), want 404", label, url, hr.StatusCode, len(hb))
		}
	}

	// Non-ULID and lowercase ULID.
	for _, badID := range []string{"not-a-ulid", strings.ToLower(w.outsider), "01J8X4TOO_SHORT"} {
		assertUniform404("non-ULID "+badID, base+badID, token)
	}

	// Member of another organization (even with a valid uploaded avatar).
	otherTok, otherUser := filesRegister(t, w.srv, "other-org-avatar@example.com")
	uploadUserAvatar(t, w, otherTok, "other.png", docsPNG)
	assertUniform404("other org user", base+otherUser, token)

	// Same-org member with no avatar.
	_, noAvatarUser := filesRegister(t, w.srv, "no-avatar@example.com")
	if err := w.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: noAvatarUser, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	assertUniform404("no avatar", base+noAvatarUser, token)

	// Legacy local avatar_url (avatar_file_id NULL) and foreign Google avatar_url.
	for label, rawURL := range map[string]string{
		"legacy avatar_url":  "/uploads/avatars/" + noAvatarUser + "/legacy.png",
		"foreign avatar_url": "https://lh3.googleusercontent.com/a/google-photo",
	} {
		if _, err := w.q.UpdateUserAvatar(ctx, db.UpdateUserAvatarParams{
			ID:        noAvatarUser,
			AvatarUrl: pgtype.Text{String: rawURL, Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
		assertUniform404(label, base+noAvatarUser, token)
	}

	// avatar_file_id pointing to another user's avatar file (scope mismatch).
	if _, err := w.q.UpdateUserAvatarFile(ctx, db.UpdateUserAvatarFileParams{
		ID:           noAvatarUser,
		AvatarFileID: fileID,
	}); err != nil {
		t.Fatal(err)
	}
	assertUniform404("foreign user avatar_file_id", base+noAvatarUser, token)

	// Deactivated member of the same organization (even with a valid avatar and
	// matching If-None-Match).
	deactTok, deactUser := filesRegister(t, w.srv, "deact-avatar@example.com")
	if err := w.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: deactUser, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	uploadUserAvatar(t, w, deactTok, "deact.png", docsPNG)
	if _, err := pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.orgID, deactUser); err != nil {
		t.Fatal(err)
	}
	assertUniform404("deactivated member", base+deactUser, token, "If-None-Match", wantETag)

	// Agent ID of the same organization.
	agent, err := w.q.CreateAgent(ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: w.orgID, Name: "Bot", Handle: "bot",
		OwnerUserID: w.userID, AutonomyPolicy: "{}", CreatedBy: w.userID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	assertUniform404("agent id", base+agent.ID, token)

	// Bad bytes in storage (SVG masquerading as PNG, non-image bytes) and
	// SizeBytes > 2 MiB, or deleting/deleted file status.
	var objectKey string
	if err := pool.QueryRow(ctx, `SELECT object_key FROM files WHERE id = $1`, fileID.String).Scan(&objectKey); err != nil {
		t.Fatal(err)
	}
	diskPath := filepath.Join(uploadDir, filepath.FromSlash(objectKey))
	for _, bad := range []struct {
		label string
		bytes []byte
		size  int64
	}{
		{"SVG masquerading as PNG", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), 92},
		{"non-image bytes", []byte("not an image at all, plain text payload"), 39},
		{"file > 2 MiB", pngBody, (2 << 20) + 1},
	} {
		if err := os.WriteFile(diskPath, bad.bytes, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE files SET size_bytes = $2, content_type = 'image/png' WHERE id = $1`, fileID.String, bad.size); err != nil {
			t.Fatal(err)
		}
		assertUniform404(bad.label, base+w.outsider, token)
	}

	// Restore valid PNG bytes on disk, then mark the file deleting / deleted.
	if err := os.WriteFile(diskPath, pngBody, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"deleting", "deleted"} {
		if _, err := pool.Exec(ctx, `UPDATE files SET size_bytes = $2, status = $3, deleted_at = CASE WHEN $3 = 'deleted' THEN now() ELSE NULL END WHERE id = $1`, fileID.String, len(pngBody), status); err != nil {
			t.Fatal(err)
		}
		assertUniform404("file status "+status, base+w.outsider, token)
	}

	// 5. Credential and document/module checks.
	// Token for another document -> 404 with the same body.
	assertUniform404("other document token", "/api/v1/office-frame/documents/"+secondDocID+"/avatars/"+w.userID, token)

	// Token for another module (markdown token on a docx document) -> 404.
	assertUniform404("markdown token on docx", base+w.userID, mdToken)

	// Session JWT, empty token, malformed token, or ?sig= without frame Bearer -> 401.
	for label, cred := range map[string]struct{ url, bearer string }{
		"session JWT":      {base + w.userID, w.token},
		"empty bearer":     {base + w.userID, ""},
		"malformed bearer": {base + w.userID, token + "tampered"},
		"sig query only":   {base + w.userID + "?sig=ofa1.e30.AAAA", ""},
	} {
		r, _ := doBytes(t, w.srv, http.MethodGet, cred.url, cred.bearer)
		if r.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", label, r.StatusCode)
		}
	}
}
