package router

import (
	"net/http"
	"testing"
)

// The folder upload batch read and cancel (UNI-2052 §9) draw on one budget:
// 120 a minute per signed-in person on the folder-upload bucket, across every
// workspace and both methods. It is not the plan's budget, and another person
// behind the same address keeps a whole one.
func TestFolderUploadBatchRoutesShareOneBucket(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.53"
	alice := caller{ip: office, bearer: mustMint(t, minter, "user-a")}

	alice.spend(t, h, http.MethodGet, "/api/v1/workspaces/w1/documents/folder-uploads/b1", 60)
	alice.spend(t, h, http.MethodDelete, "/api/v1/workspaces/w2/documents/folder-uploads/b2", 60)
	refused := alice.sendRec(h, http.MethodGet, "/api/v1/workspaces/w3/documents/folder-uploads/b3")
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("the 121st batch call in a minute: status %d, want 429 (one folder-upload budget across routes and workspaces)", refused.Code)
	}
	if code := refusalCode(t, refused); code != "rate_limited" {
		t.Fatalf("refusal code = %q, want rate_limited", code)
	}

	caller{ip: office, bearer: mustMint(t, minter, "user-b")}.spend(t, h, http.MethodGet, "/api/v1/workspaces/w1/documents/folder-uploads/b1", 120)
	// The plan keeps its own bucket.
	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads", 10)
}
