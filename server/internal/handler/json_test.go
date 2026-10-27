package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

func TestDecodeRejectsOversizedBodyWith413(t *testing.T) {
	body := `{"email":"` + strings.Repeat("a", 64) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	rec := httptest.NewRecorder()
	var in struct {
		Email string `json:"email"`
	}
	if decode(rec, req, &in, 16) {
		t.Fatal("decode accepted a body over the limit")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
	var out sdo.ErrorSDO
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil || out.Error.Code != "payload_too_large" {
		t.Fatalf("body = %+v, err = %v", out, err)
	}
}

func TestDecodeRejectsMalformedJSONWith400(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"email":`))
	rec := httptest.NewRecorder()
	var in struct {
		Email string `json:"email"`
	}
	if decode(rec, req, &in, maxJSONBody) {
		t.Fatal("decode accepted malformed json")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestDecodeAcceptsBodyWithinLimit(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"email":"a@b.c"}`))
	rec := httptest.NewRecorder()
	var in struct {
		Email string `json:"email"`
	}
	if !decode(rec, req, &in, maxJSONBody) || in.Email != "a@b.c" {
		t.Fatalf("decode failed: status %d, in %+v", rec.Code, in)
	}
}

// Every JSON endpoint goes through decode, so the cap applies to the public
// surface too — proven on the login route, which needs no session.
func TestLoginRejectsOversizedBody(t *testing.T) {
	srv := newTestServer(t)
	payload := map[string]string{"email": "x@example.com", "password": strings.Repeat("p", maxJSONBody+1)}
	b, _ := json.Marshal(payload)
	res, err := srv.Client().Post(srv.URL+"/api/v1/auth/login", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", res.StatusCode)
	}
}

// UNI-2244: PUT /documents/{folderID}/contents-access enforces the 1 MiB cap
// and JSON syntax when h.Documents is configured; when h.Documents is nil both
// routes answer 501 storage_unavailable.
func TestFolderContentsAccessHandlersDecodeAndNilService(t *testing.T) {
	var h handlers

	// 1. Nil Documents service -> 501 storage_unavailable on both routes.
	reqNilPut := httptest.NewRequest(http.MethodPut, "/api/v1/documents/01J8X4FLD0N1P2Q3R4S5T6U7/contents-access", strings.NewReader(`{"mode":"replace","items":[]}`))
	recNilPut := httptest.NewRecorder()
	h.updateFolderContentsAccess(recNilPut, reqNilPut)
	if recNilPut.Code != http.StatusNotImplemented {
		t.Fatalf("PUT nil service = %d, want 501", recNilPut.Code)
	}
	reqNilGet := httptest.NewRequest(http.MethodGet, "/api/v1/documents/01J8X4FLD0N1P2Q3R4S5T6U7/contents-access/01J8X4FAB0N1P2Q3R4S5T6U7V8", nil)
	recNilGet := httptest.NewRecorder()
	h.getFolderContentsAccessBatch(recNilGet, reqNilGet)
	if recNilGet.Code != http.StatusNotImplemented {
		t.Fatalf("GET nil service = %d, want 501", recNilGet.Code)
	}

	// 2. With Documents service configured, malformed JSON -> 400 and oversized body -> 413.
	h.Documents = &service.DocumentService{}
	reqBad := httptest.NewRequest(http.MethodPut, "/api/v1/documents/01J8X4FLD0N1P2Q3R4S5T6U7/contents-access", strings.NewReader(`{"mode":`))
	recBad := httptest.NewRecorder()
	h.updateFolderContentsAccess(recBad, reqBad)
	if recBad.Code != http.StatusBadRequest {
		t.Fatalf("PUT malformed JSON = %d, want 400", recBad.Code)
	}
	oversized := `{"mode":"` + strings.Repeat("m", maxJSONBody+1) + `","items":[]}`
	reqBig := httptest.NewRequest(http.MethodPut, "/api/v1/documents/01J8X4FLD0N1P2Q3R4S5T6U7/contents-access", strings.NewReader(oversized))
	recBig := httptest.NewRecorder()
	h.updateFolderContentsAccess(recBig, reqBig)
	if recBig.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("PUT oversized body = %d, want 413", recBig.Code)
	}
}

// UNI-2244 BE-1: verifies isoWalk/isoUnclassified/isoStaleRows pass without DB
// and that both folder bulk access routes are classified in isoRoutes.
func TestFolderContentsAccessIsolationClassification(t *testing.T) {
	h := New(Deps{
		Admin:   &service.AdminService{},
		Storage: &storage.LocalStorage{},
	})
	routes := isoWalk(t, h)
	if missing := isoUnclassified(routes); len(missing) > 0 {
		t.Fatalf("isoUnclassified: %v", missing)
	}
	if stale := isoStaleRows(routes); len(stale) > 0 {
		t.Fatalf("isoStaleRows: %v", stale)
	}
}
