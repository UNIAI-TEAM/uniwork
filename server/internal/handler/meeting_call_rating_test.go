package handler

import (
	"net/http"
	"testing"
)

// The leave screens' Tốt / Tạm / Kém: a member or an active guest may rate,
// anything but the three ratings is a 400, and nobody at all is a 401.
func TestRateCallRoute(t *testing.T) {
	f := setupChatFixture(t, "callrating")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Rate"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	path := "/api/v1/meetings/" + out["meeting"].(map[string]any)["id"].(string) + "/call-rating"

	if res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]string{"rating": "good"}); res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("member rates: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]string{"rating": "great"}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown rating: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, f.srv, "POST", path, "", map[string]string{"rating": "ok"}); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no session: %d %v", res.StatusCode, out)
	}
}
