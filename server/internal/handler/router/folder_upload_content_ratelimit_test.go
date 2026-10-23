package router

import (
	"net/http"
	"testing"
)

// The folder upload content route (UNI-2052 §9) skips the global 300 a
// minute: one folder of 500 files sends 500 PUTs. It has its own budget, 600
// a minute per signed-in person on folder-upload-content, and spending it
// leaves the caller's global budget whole.
func TestFolderUploadContentSkipsTheGlobalLimiter(t *testing.T) {
	h, minter := limitedMux(t)
	alice := caller{ip: "10.20.0.61", bearer: mustMint(t, minter, "user-a")}

	alice.spend(t, h, http.MethodPut, "/api/v1/workspaces/w1/documents/folder-uploads/b1/files/f-1/content", 400)
	alice.spend(t, h, http.MethodPut, "/api/v1/workspaces/w2/documents/folder-uploads/b2/files/f-2/content", 200)
	alice.wantRefused(t, h, http.MethodPut, "/api/v1/workspaces/w1/documents/folder-uploads/b1/files/f-3/content", "the 601st content PUT in a minute")
	refused := alice.sendRec(h, http.MethodPut, "/api/v1/workspaces/w1/documents/folder-uploads/b1/files/f-4/content")
	if code := refusalCode(t, refused); code != "rate_limited" {
		t.Fatalf("refusal code = %q, want rate_limited", code)
	}
	// The 600 content PUTs drew nothing from the global budget.
	alice.spend(t, h, http.MethodGet, "/api/v1/workspaces/w1/documents/download-jobs/j1", 100)
}

// COMPLETE has its own bucket, folder-upload, 120 a minute per signed-in
// person across every batch; the PLAN bucket beside it stays whole.
func TestFolderUploadCompleteUsesTheFolderUploadBucket(t *testing.T) {
	h, minter := limitedMux(t)
	alice := caller{ip: "10.20.0.62", bearer: mustMint(t, minter, "user-a")}

	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads/b1/complete", 60)
	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w2/documents/folder-uploads/b2/complete", 60)
	alice.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads/b3/complete", "the 121st COMPLETE in a minute")
	alice.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/documents/folder-uploads", 10)
}
