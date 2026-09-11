package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
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
