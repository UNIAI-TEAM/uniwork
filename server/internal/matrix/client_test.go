package matrix

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDoJSONPostsAndDecodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/ping" {
			t.Fatalf("got %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("content-type: %s", r.Header.Get("Content-Type"))
		}
		var in map[string]string
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in["hello"] != "world" {
			t.Fatalf("body: %v %v", in, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"ok": "yes"})
	}))
	t.Cleanup(srv.Close)

	c := New(srv.URL)
	var out map[string]string
	if err := c.DoJSON(context.Background(), http.MethodPost, "/ping", map[string]string{"hello": "world"}, &out); err != nil {
		t.Fatal(err)
	}
	if out["ok"] != "yes" {
		t.Fatalf("out=%v", out)
	}
}

func TestDoJSONErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"errcode":"M_FORBIDDEN"}`)
	}))
	t.Cleanup(srv.Close)

	c := New(srv.URL)
	err := c.DoJSON(context.Background(), http.MethodPost, "/x", map[string]string{}, nil)
	he, ok := err.(*HTTPError)
	if !ok || he.Status != 401 {
		t.Fatalf("err=%v", err)
	}
	if string(he.Body) != `{"errcode":"M_FORBIDDEN"}` {
		t.Fatalf("body=%s", he.Body)
	}
}
