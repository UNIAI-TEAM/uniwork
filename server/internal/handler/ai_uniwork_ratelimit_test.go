package handler

// BE3A-2 on the wire: a vendor 429 the Gateway translated reaches the client
// as 429 ai_rate_limited together with the Retry-After header the client backs
// off by (A5: the vendor's wait, 30 s when it sent none, never over 300 s).
// internal/ai pins the translation itself; this pins the header the handler
// sets from the refusal's fields, on the real router and the real store. It
// skips with the rest of the suite when TEST_DATABASE_URL is absent, which the
// cloud round runs.

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// uniworkRateLimitTurn posts one question to a UniWork route and answers the
// status, the Retry-After header and the error code.
func uniworkRateLimitTurn(t *testing.T, w *isoWorld, path, token string, body any) (int, string, string) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+path, strings.NewReader(string(payload)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	e, _ := out["error"].(map[string]any)
	code, _ := e["code"].(string)
	return res.StatusCode, res.Header.Get("Retry-After"), code
}

func TestAIUniworkUpstreamRateLimitedHeader(t *testing.T) {
	w := newUniworkWorld(t)
	tn := w.alpha
	body := map[string]any{"messages": []any{map[string]any{"role": "user", "content": "hỏi"}}}
	for _, tc := range []struct {
		name   string
		vendor time.Duration
		want   string
	}{
		{"vendor wait", 45 * time.Second, "45"},
		{"no wait given", 0, "30"},
		{"wait over the clamp", 10 * time.Minute, "300"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w.uniworkProvider.Err = &provider.StatusError{Status: http.StatusTooManyRequests, RetryAfter: tc.vendor}
			status, retry, code := uniworkRateLimitTurn(t, w, tn.uniworkOrgPath(), tn.token, body)
			if status != http.StatusTooManyRequests || code != "ai_rate_limited" {
				t.Fatalf("turn = %d %s, want 429 ai_rate_limited", status, code)
			}
			if retry != tc.want {
				t.Fatalf("Retry-After = %q, want %q", retry, tc.want)
			}
		})
	}
}
