package handler

import (
	"bytes"
	"encoding/json"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDemoRequestHTTPReceipt(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	h := &handlers{Deps: Deps{DemoRequests: service.NewDemoRequestService(pool, q)}}
	body := []byte(`{"full_name":"Lan","work_email":"lan@example.com","company_name":"Acme","team_size":"11-50","message":"","locale":"vi"}`)
	call := func(key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/demo-requests", bytes.NewReader(body))
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		h.createDemoRequest(w, r)
		return w
	}
	invalid := call("")
	if invalid.Code != 400 {
		t.Fatalf("missing key: %d %s", invalid.Code, invalid.Body.String())
	}
	first := call("demo-request-http-key")
	if first.Code != 201 {
		t.Fatalf("create: %d %s", first.Code, first.Body.String())
	}
	var receipt map[string]string
	if err := json.Unmarshal(first.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt["request_id"] == "" || len(receipt) != 1 {
		t.Fatalf("public response is not a minimal receipt: %+v", receipt)
	}
	again := call("demo-request-http-key")
	if again.Body.String() != first.Body.String() {
		t.Fatal("retry produced a new receipt")
	}
}
