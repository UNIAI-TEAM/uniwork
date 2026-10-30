package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// isoOfficeClient and isoOfficeDeployment are the desktop client and
// deployment profile the service defaults to when nothing is configured; the
// world leaves the config empty, so they are what the allowlists hold.
const (
	isoOfficeClient     = "uniwork-office"
	isoOfficeDeployment = "default"
	isoOfficeRedirect   = "uniwork-office://auth/callback"
	isoPreviewOrigin    = "http://preview.invalid"
)

// isoSignaturePNG is a 1x1 PNG, base64 as the signature route takes it.
const isoSignaturePNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// buildOffice gives the tenant what the Office desktop bridge writes: a saved
// signature, a launch ticket and its receipt, a preview capability, a native
// device session and a consented-but-pending desktop authorization attempt.
// Signature, launch ticket and preview scope are created through the API; the
// device session and the attempt go through DesktopAuthService, because the
// browser consent and PKCE exchange are a protocol between the desktop host
// and the browser, not something one bearer can replay over HTTP.
func (w *isoWorld) buildOffice(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	out := w.call(t, "POST", "/api/v1/orgs/"+tn.orgID+"/signatures", tn.token, map[string]any{
		"label": tn.marker + " signature", "content_type": "image/png", "image": isoSignaturePNG,
	})
	tn.ids["signature"] = isoID(t, out, "signature")

	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["fileDocument"]+"/office/sessions", tn.token, map[string]any{
		"operation": "edit", "client_id": isoOfficeClient, "deployment_id": isoOfficeDeployment,
	})
	tn.ids["launchTicket"] = isoString(t, out, "launch_ticket")
	// The create response carries the ticket, never the receipt id; the
	// receipt is what revoke names.
	var receipt string
	if err := w.pool.QueryRow(ctx, `SELECT id FROM office_launch_sessions WHERE organization_id = $1 AND document_id = $2`,
		tn.orgID, tn.ids["fileDocument"]).Scan(&receipt); err != nil {
		t.Fatal(err)
	}
	tn.ids["launchSession"] = receipt

	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["document"]+"/preview/scopes", tn.token, map[string]any{
		"job_id": "iso-" + tn.tag, "assets": []any{map[string]any{"key": "images/a.png", "asset_id": tn.ids["asset"]}},
	})
	assets, _ := out["assets"].([]any)
	if len(assets) != 1 {
		t.Fatalf("preview scope of %s has %d assets: %v", tn.tag, len(assets), out)
	}
	raw := assets[0].(map[string]any)["url"].(string)
	parts := strings.Split(strings.TrimPrefix(raw, isoPreviewOrigin+"/api/v1/preview/assets/"), "/")
	if len(parts) != 2 {
		t.Fatalf("preview url %q has no capability", raw)
	}
	capability, err := url.PathUnescape(parts[0])
	if err != nil {
		t.Fatal(err)
	}
	tn.ids["previewCapability"] = capability

	attempt, session := w.desktopSession(t, tn)
	tn.ids["desktopAttempt"], tn.ids["deviceSession"] = attempt, session

	// An offline lease of that device on the file document (G5-08s): the
	// route takes the device's bearer, never a browser session.
	device, err := auth.TokenMinter{Secret: []byte("test"), TTL: time.Hour}.MintSession(tn.userID, session)
	if err != nil {
		t.Fatal(err)
	}
	out = w.call(t, "PUT", "/api/v1/documents/"+tn.ids["fileDocument"]+"/office/offline-lease", device, map[string]any{})
	tn.ids["offlineLease"] = isoString(t, out, "lease")
	// No route writes the policy row before a suspension or an operator
	// revoke bumps it; epoch 0 is what a missing row reads as.
	if _, err := w.pool.Exec(ctx, `INSERT INTO office_offline_policy (organization_id, epoch) VALUES ($1, 0)`, tn.orgID); err != nil {
		t.Fatal(err)
	}
}

// desktopSession walks the real PKCE flow for the tenant's owner: one finished
// attempt that became a device session, and a second attempt left pending
// after consent (its CSRF token is issued, so only the owner can finish it).
func (w *isoWorld) desktopSession(t *testing.T, tn *isoTenant) (pendingAttempt, deviceSession string) {
	t.Helper()
	ctx := context.Background()
	svc := w.deps.DesktopAuth
	verifier := strings.Repeat("v", 43)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	start := func(label string) string {
		attempt, err := svc.Start(ctx, service.DesktopStartInput{
			ClientID: isoOfficeClient, CodeChallenge: challenge, CodeChallengeMethod: "S256", State: "state-" + tn.tag + label,
			RedirectURI: isoOfficeRedirect, DeploymentID: isoOfficeDeployment, DeviceLabel: tn.marker + " laptop", Platform: "windows", Build: "1.0.0",
		})
		if err != nil {
			t.Fatal(err)
		}
		return attempt.ID
	}

	done := start("-done")
	consent, err := svc.Consent(ctx, tn.userID, done)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := svc.Approve(ctx, tn.userID, done, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	session, err := svc.Exchange(ctx, isoOfficeClient, code, verifier, isoOfficeRedirect, isoOfficeDeployment)
	if err != nil {
		t.Fatal(err)
	}

	pending := start("-pending")
	if _, err := svc.Consent(ctx, tn.userID, pending); err != nil {
		t.Fatal(err)
	}
	return pending, session.DeviceSessionID
}

// isoPreviewPost is the body of a preview scope for the tenant's own asset.
func isoPreviewPost(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{
		"job_id": "iso-" + tn.tag, "assets": []any{map[string]any{"key": "images/a.png", "asset_id": tn.ids["asset"]}},
	}}
}

// isoLaunchPost is the body of a launch ticket request.
func isoLaunchPost(*isoWorld, *isoTenant) isoBody {
	return isoBody{json: map[string]any{"operation": "view", "client_id": isoOfficeClient, "deployment_id": isoOfficeDeployment}}
}

// isoSignaturePost is the body of a saved signature.
func isoSignaturePost(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"label": tn.marker + " signature", "content_type": "image/png", "image": isoSignaturePNG}}
}

const isoDocxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// isoFrameDocx is the DOCX the frame fixtures and bodies upload.
var isoFrameDocx = func() []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "_rels/.rels", "word/document.xml"} {
		f, err := zw.Create(name)
		if err != nil {
			panic(err)
		}
		_, _ = f.Write([]byte("<x>" + name + "</x>"))
	}
	if err := zw.Close(); err != nil {
		panic(err)
	}
	return buf.Bytes()
}()

// buildOfficeFrame gives the tenant an Office Docs frame: a DOCX file
// document, a frame token minted by the owner's session (registered so do()
// sends it on the frame routes), bytes staged through the frame for a save,
// an image attached through the frame and a picture document next to it.
func (w *isoWorld) buildOfficeFrame(t *testing.T, tn *isoTenant) {
	t.Helper()
	out := w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": tn.marker + " Docx"}, filename: strings.ToLower(tn.marker) + ".docx",
		contentType: isoDocxMime, content: isoFrameDocx,
	})
	tn.ids["frameDocument"] = isoID(t, out, "document")
	// A picture next to it, which a Markdown/HTML frame would load through
	// .../linked/{linkedDocumentID} (UNI-1232).
	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": tn.marker + " Picture"}, filename: strings.ToLower(tn.marker) + ".png",
		contentType: "image/png", content: docsPNG,
	})
	tn.ids["frameSibling"] = isoID(t, out, "document")
	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["frameDocument"]+"/office/frame-token", tn.token, nil)
	tn.ids["frameToken"] = isoString(t, out, "token")
	if w.frameTokens == nil {
		w.frameTokens = map[string]string{}
	}
	// buildTenant re-registers it under the long-lived session it mints last.
	w.frameTokens[tn.token] = tn.ids["frameToken"]
	// A Markdown document that names the picture by its file name: the frame
	// routes of the text modules (resolve, linked) bind to it, since a DOCX
	// token opens neither. Its open answer carries the signed URL of the
	// picture, whose signature the linked-route checks use.
	picture := strings.ToLower(tn.marker) + ".png"
	out = w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": tn.marker + " Notes"}, filename: strings.ToLower(tn.marker) + ".md",
		contentType: "text/markdown", content: []byte("# notes\n\n![](" + picture + ")\n"),
	})
	tn.ids["frameMarkdown"] = isoID(t, out, "document")
	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["frameMarkdown"]+"/office/frame-token", tn.token, nil)
	tn.ids["frameMarkdownToken"] = isoString(t, out, "token")
	if w.frameMarkdown == nil {
		w.frameMarkdown = map[string][2]string{}
	}
	w.frameMarkdown[tn.token] = [2]string{tn.ids["frameMarkdown"], tn.ids["frameMarkdownToken"]}
	out = w.call(t, "GET", "/api/v1/office-frame/documents/"+tn.ids["frameMarkdown"], tn.token, nil)
	signed, _ := out["assets"].(map[string]any)[picture].(string)
	if _, sig, ok := strings.Cut(signed, "?sig="); ok {
		tn.ids["frameLinkedSig"] = sig
	} else {
		t.Fatalf("markdown open of %s gave no signed picture URL: %v", tn.tag, out["assets"])
	}
	base := "/api/v1/office-frame/documents/" + tn.ids["frameDocument"]
	out = w.upload(t, base+"/uploads", tn.token, isoMultipart{filename: "staged.docx", contentType: isoDocxMime, content: isoFrameDocx})
	tn.ids["frameUpload"] = isoString(t, out, "upload_id")
	out = w.upload(t, base+"/assets", tn.token, isoMultipart{filename: "frame.png", contentType: "image/png", content: docsPNG})
	tn.ids["frameAsset"] = isoString(t, out, "asset_id")
	out = w.call(t, "GET", base, tn.token, nil)
	tn.ids["frameRevision"] = isoString(t, out, "revision")
	// File-backed avatars for the owner and the peer (UNI-1986), read through
	// /api/v1/office-frame/documents/{documentID}/avatars/{userID}.
	w.upload(t, "/api/v1/me/avatar", tn.token, isoMultipart{filename: "owner-avatar.png", contentType: "image/png", content: docsPNG})
	w.upload(t, "/api/v1/me/avatar", tn.peerToken, isoMultipart{filename: "peer-avatar.png", contentType: "image/png", content: docsPNG})
	tn.ids["frameAvatarUser"] = tn.peerID

	// The source frame (UNI-1869): a DOCX task attachment under "Từ nơi khác",
	// a source token minted by the owner's session for it (registered so do()
	// sends it on /api/v1/office-frame/sources/*), and its own bytes.
	out = w.upload(t, "/api/v1/tasks/"+tn.ids["task"]+"/attachments", tn.token, isoMultipart{
		filename: strings.ToLower(tn.marker) + "-source.docx", contentType: isoDocxMime, content: isoFrameDocx,
	})
	tn.ids["sourceDocx"] = isoID(t, out, "attachment")
	out = w.call(t, "POST",
		"/api/v1/workspaces/"+tn.wsID+"/documents/sources/task%3A"+tn.ids["sourceDocx"]+"/office/frame-token", tn.token, nil)
	tn.ids["sourceFrameToken"] = isoString(t, out, "token")
	if w.frameSources == nil {
		w.frameSources = map[string]string{}
	}
	w.frameSources[tn.token] = tn.ids["sourceFrameToken"]
}

// isoFrameSign asks for a signed URL of the tenant's own frame image.
func isoFrameSign(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"asset_ids": []string{tn.ids["frameAsset"]}}}
}

// frameLinkedChecks is the signed-URL half of the sibling route (RA-1): the
// matrix rows send tokens, which this route refuses, so the owner's control
// and the credential attacks live here.
func (w *isoWorld) frameLinkedChecks(t *testing.T) {
	t.Helper()
	path := func(tn *isoTenant) string {
		return "/api/v1/office-frame/documents/" + tn.ids["frameMarkdown"] + "/linked/" + tn.ids["frameSibling"]
	}
	for _, tn := range []*isoTenant{w.alpha, w.bravo} {
		if status, raw := w.do(t, http.MethodGet, path(tn)+"?sig="+tn.ids["frameLinkedSig"], "", isoBody{}); status != http.StatusOK || len(raw) == 0 {
			t.Errorf("%s owner's signed linked URL = %d, want 200", tn.tag, status)
		}
	}
	for name, c := range map[string]struct{ url, token string }{
		"A's DOCX frame token":                {path(w.alpha), w.alpha.ids["frameToken"]},
		"A's Markdown frame token":            {path(w.alpha), w.alpha.ids["frameMarkdownToken"]},
		"B's frame tokens through the matrix": {path(w.alpha), w.bravo.token},
		"A's session token":                   {path(w.alpha), w.alpha.token},
		"no credential":                       {path(w.alpha), ""},
		"B's signature on A's path":           {path(w.alpha) + "?sig=" + w.bravo.ids["frameLinkedSig"], ""},
		"A's signature on B's path":           {path(w.bravo) + "?sig=" + w.alpha.ids["frameLinkedSig"], ""},
	} {
		if status, raw := w.do(t, http.MethodGet, c.url, c.token, isoBody{}); status != http.StatusUnauthorized {
			t.Errorf("%s on the linked route = %d, want 401: %s", name, status, isoClip(raw))
		}
	}
}

func isoFrameAvatarCheck(t *testing.T, tn *isoTenant, raw []byte) {
	t.Helper()
	if !bytes.Equal(raw, docsPNG) {
		t.Errorf("%s frame avatar control body = %d bytes, want docsPNG (%d bytes)", tn.tag, len(raw), len(docsPNG))
	}
}

// frameAvatarChecks pins the cross-tenant and credential cases of the frame
// avatar route (UNI-1986): the owner reads a same-organization avatar with
// their frame token, A's frame token on A's document + B's user answers the
// same 404 body as an unknown ULID, and B's frame token cannot read A's user.
func (w *isoWorld) frameAvatarChecks(t *testing.T) {
	t.Helper()
	path := func(docID, userID string) string {
		return "/api/v1/office-frame/documents/" + docID + "/avatars/" + userID
	}
	for _, tn := range []*isoTenant{w.alpha, w.bravo} {
		for _, uid := range []string{tn.userID, tn.peerID} {
			status, raw := w.do(t, http.MethodGet, path(tn.ids["frameDocument"], uid), tn.ids["frameToken"], isoBody{})
			if status != http.StatusOK || !bytes.Equal(raw, docsPNG) {
				t.Errorf("%s frame avatar %s = %d (%d bytes), want 200 docsPNG", tn.tag, uid, status, len(raw))
			}
			hStatus, hRaw := w.do(t, http.MethodHead, path(tn.ids["frameDocument"], uid), tn.ids["frameToken"], isoBody{})
			if hStatus != http.StatusOK || len(hRaw) != 0 {
				t.Errorf("%s HEAD frame avatar %s = %d (%d bytes), want 200 empty", tn.tag, uid, hStatus, len(hRaw))
			}
		}
	}
	status404, want404 := w.do(t, http.MethodGet, path(w.alpha.ids["frameDocument"], "01J8X4NONEXISTENT000000000"), w.alpha.ids["frameToken"], isoBody{})
	if status404 != http.StatusNotFound || len(want404) == 0 {
		t.Fatalf("unknown frame avatar = %d %s, want 404", status404, isoClip(want404))
	}
	for name, c := range map[string]struct{ url, token string }{
		"A's document + B's owner via A's frame token": {path(w.alpha.ids["frameDocument"], w.bravo.userID), w.alpha.ids["frameToken"]},
		"A's document + B's peer via A's frame token":  {path(w.alpha.ids["frameDocument"], w.bravo.peerID), w.alpha.ids["frameToken"]},
		"A's document + A's owner via B's frame token": {path(w.alpha.ids["frameDocument"], w.alpha.userID), w.bravo.ids["frameToken"]},
		"A's document + A's peer via B's frame token":  {path(w.alpha.ids["frameDocument"], w.alpha.peerID), w.bravo.ids["frameToken"]},
	} {
		status, raw := w.do(t, http.MethodGet, c.url, c.token, isoBody{})
		if status != http.StatusNotFound || !bytes.Equal(raw, want404) {
			t.Errorf("%s = %d %q, want uniform 404 %q", name, status, raw, want404)
		}
	}
	for name, c := range map[string]struct{ url, token string }{
		"A's session token": {path(w.alpha.ids["frameDocument"], w.alpha.peerID), w.alpha.peerToken},
		"no credential":     {path(w.alpha.ids["frameDocument"], w.alpha.peerID), ""},
	} {
		if status, raw := w.do(t, http.MethodGet, c.url, c.token, isoBody{}); status != http.StatusUnauthorized {
			t.Errorf("%s on the frame avatar route = %d, want 401: %s", name, status, isoClip(raw))
		}
	}
}
