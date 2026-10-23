package handler

// Handler-level tests for the UNI-925 B6 saved-signature HTTP surface: the
// caller's own rows in one organization over the real router, the base64
// body decode, the content rules the service enforces, and the 404 an
// outsider gets on every route.

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http/httptest"
	"testing"
)

// signaturePNG builds the smallest real PNG the service's sniff check
// accepts.
func signaturePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 32, G: 64, B: 96, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type signatureWorld struct {
	srv      *httptest.Server
	token    string
	userID   string
	orgID    string
	outsider string
}

func newSignatureWorld(t *testing.T) *signatureWorld {
	t.Helper()
	srv := newTestServer(t)
	w := &signatureWorld{srv: srv}
	w.token, w.userID = filesRegister(t, srv, "signature-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Signature Org", "slug": "signature-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	w.outsider, _ = filesRegister(t, srv, "signature-outsider@example.com")
	return w
}

func TestSavedSignatureHTTPRoundTrip(t *testing.T) {
	w := newSignatureWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/signatures"
	image := signaturePNG(t)
	image64 := base64.StdEncoding.EncodeToString(image)

	res, out := doJSON(t, w.srv, "GET", base, w.token, nil)
	if res.StatusCode != 200 || len(out["signatures"].([]any)) != 0 {
		t.Fatalf("fresh list: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, w.srv, "POST", base, w.token, map[string]string{
		"label": "Chữ ký của tôi", "content_type": "image/png", "image": image64,
	})
	if res.StatusCode != 201 {
		t.Fatalf("save: %d %v", res.StatusCode, out)
	}
	sig := out["signature"].(map[string]any)
	id := sig["id"].(string)
	if id == "" || sig["label"] != "Chữ ký của tôi" || sig["content_type"] != "image/png" {
		t.Fatalf("saved payload: %v", sig)
	}
	if sig["image"] != image64 || sig["byte_size"].(float64) != float64(len(image)) || sig["created_at"] == "" {
		t.Fatalf("saved payload: %v", sig)
	}

	res, out = doJSON(t, w.srv, "GET", base, w.token, nil)
	if res.StatusCode != 200 || len(out["signatures"].([]any)) != 1 {
		t.Fatalf("list after save: %d %v", res.StatusCode, out)
	}

	// Delete answers the status envelope; the repeat is a 404 because the
	// row is gone.
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+id, w.token, nil)
	if res.StatusCode != 200 || out["status"] != "ok" {
		t.Fatalf("delete: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+id, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("repeat delete: %d code=%q", res.StatusCode, code)
	}
}

func TestSavedSignatureHTTPRejectsBadImage(t *testing.T) {
	w := newSignatureWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/signatures"
	image64 := base64.StdEncoding.EncodeToString(signaturePNG(t))

	cases := []struct {
		name string
		body map[string]string
	}{
		{"not base64", map[string]string{"label": "x", "content_type": "image/png", "image": "not base64!"}},
		{"declared type does not match bytes", map[string]string{"label": "x", "content_type": "image/jpeg", "image": image64}},
		{"empty label", map[string]string{"label": "  ", "content_type": "image/png", "image": image64}},
		{"empty image", map[string]string{"label": "x", "content_type": "image/png", "image": ""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, out := doJSON(t, w.srv, "POST", base, w.token, tc.body)
			if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
				t.Fatalf("%s: %d code=%q %v", tc.name, res.StatusCode, code, out)
			}
		})
	}
}

func TestSavedSignatureHTTPIsolation(t *testing.T) {
	w := newSignatureWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/signatures"
	image64 := base64.StdEncoding.EncodeToString(signaturePNG(t))

	// An outsider cannot list, save into, or delete from the organization.
	res, out := doJSON(t, w.srv, "GET", base, w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider list: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "POST", base, w.outsider, map[string]string{
		"label": "x", "content_type": "image/png", "image": image64,
	})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider save: %d code=%q", res.StatusCode, code)
	}

	// The owner's row is not the outsider's to delete, and it survives.
	res, out = doJSON(t, w.srv, "POST", base, w.token, map[string]string{
		"label": "Chữ ký", "content_type": "image/png", "image": image64,
	})
	if res.StatusCode != 201 {
		t.Fatalf("owner save: %d %v", res.StatusCode, out)
	}
	id := out["signature"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+id, w.outsider, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("outsider delete: %d code=%q", res.StatusCode, code)
	}
	res, out = doJSON(t, w.srv, "GET", base, w.token, nil)
	if res.StatusCode != 200 || len(out["signatures"].([]any)) != 1 {
		t.Fatalf("owner list after outsider delete: %d %v", res.StatusCode, out)
	}
}
