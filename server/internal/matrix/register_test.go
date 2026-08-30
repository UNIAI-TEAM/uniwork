package matrix

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegisterRequiresUsernamePassword(t *testing.T) {
	c := New("http://example.invalid")
	if _, err := c.Register(context.Background(), "", "p"); err == nil {
		t.Fatal("empty username accepted")
	}
	if _, err := c.Register(context.Background(), "u", ""); err == nil {
		t.Fatal("empty password accepted")
	}
}

func TestRegisterCompletesDummyUIA(t *testing.T) {
	var step int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_matrix/client/v3/register" || r.Method != http.MethodPost {
			t.Fatalf("got %s %s", r.Method, r.URL.Path)
		}
		var in map[string]any
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatal(err)
		}
		step++
		w.Header().Set("Content-Type", "application/json")
		if step == 1 {
			if in["username"] != "alice" || in["password"] != "secret" {
				t.Fatalf("first body: %v", in)
			}
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"session": "sid-1",
				"flows":   []map[string]any{{"stages": []string{"m.login.dummy"}}},
			})
			return
		}
		auth, _ := in["auth"].(map[string]any)
		if auth["type"] != "m.login.dummy" || auth["session"] != "sid-1" {
			t.Fatalf("auth: %v", in["auth"])
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"user_id":      "@alice:localhost",
			"access_token": "syt_test",
			"device_id":    "DEV1",
			"home_server":  "localhost",
		})
	}))
	t.Cleanup(srv.Close)

	got, err := New(srv.URL).Register(context.Background(), "alice", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != "@alice:localhost" || got.AccessToken != "syt_test" || got.DeviceID != "DEV1" {
		t.Fatalf("got=%+v", got)
	}
	if step != 2 {
		t.Fatalf("steps=%d", step)
	}
}
