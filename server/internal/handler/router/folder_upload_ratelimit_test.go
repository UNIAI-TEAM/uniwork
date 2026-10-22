package router

import (
	"net/http"
	"testing"
)

// The folder upload PLAN (UNI-2052 §9) has its own budget: 10 a minute per
// signed-in person on the folder-upload-plan bucket, one budget across every
// workspace, refused with the default rate_limited. Another person behind the
// same address keeps a whole budget, and the zip download beside it never
// draws on it.
func TestFolderUploadPlanUsesOwnLimiterBucket(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.52"
	alice := caller{ip: office, bearer: mustMint(t, minter, "user-a")}

	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads", 5)
	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w2/documents/folder-uploads", 5)
	refused := alice.sendRec(h, http.MethodPost, "/api/v1/workspaces/w3/documents/folder-uploads")
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("the 11th plan in a minute: status %d, want 429 (one folder-upload-plan budget across every workspace)", refused.Code)
	}
	if code := refusalCode(t, refused); code != "rate_limited" {
		t.Fatalf("refusal code = %q, want rate_limited", code)
	}

	caller{ip: office, bearer: mustMint(t, minter, "user-b")}.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads", 10)
	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/download-jobs", 10)
}
