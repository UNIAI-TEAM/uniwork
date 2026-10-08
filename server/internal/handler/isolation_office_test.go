package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"

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
// and an image attached through the frame.
func (w *isoWorld) buildOfficeFrame(t *testing.T, tn *isoTenant) {
	t.Helper()
	out := w.upload(t, "/api/v1/workspaces/"+tn.wsID+"/documents/files", tn.token, isoMultipart{
		fields: map[string]string{"title": tn.marker + " Docx"}, filename: strings.ToLower(tn.marker) + ".docx",
		contentType: isoDocxMime, content: isoFrameDocx,
	})
	tn.ids["frameDocument"] = isoID(t, out, "document")
	out = w.call(t, "POST", "/api/v1/documents/"+tn.ids["frameDocument"]+"/office/frame-token", tn.token, nil)
	tn.ids["frameToken"] = isoString(t, out, "token")
	if w.frameTokens == nil {
		w.frameTokens = map[string]string{}
	}
	// buildTenant re-registers it under the long-lived session it mints last.
	w.frameTokens[tn.token] = tn.ids["frameToken"]
	base := "/api/v1/office-frame/documents/" + tn.ids["frameDocument"]
	out = w.upload(t, base+"/uploads", tn.token, isoMultipart{filename: "staged.docx", contentType: isoDocxMime, content: isoFrameDocx})
	tn.ids["frameUpload"] = isoString(t, out, "upload_id")
	out = w.upload(t, base+"/assets", tn.token, isoMultipart{filename: "frame.png", contentType: "image/png", content: docsPNG})
	tn.ids["frameAsset"] = isoString(t, out, "asset_id")
	out = w.call(t, "GET", base, tn.token, nil)
	tn.ids["frameRevision"] = isoString(t, out, "revision")
}

// isoFrameSign asks for a signed URL of the tenant's own frame image.
func isoFrameSign(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"asset_ids": []string{tn.ids["frameAsset"]}}}
}
