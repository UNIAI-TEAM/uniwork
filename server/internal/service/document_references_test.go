package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AC-5: the documents.versions / documents.assets reference providers must
// hold current and old versions, archived-but-not-purged documents, assets
// inside the 7-day orphan hold, and must release assets past the hold and
// ids nothing references (cross-tenant or unknown).

const (
	docOrgA  = "01ORGREF00000000000000000A"
	docOrgB  = "01ORGREF00000000000000000B"
	docWsA   = "01WSREF000000000000000000A"
	docWsB   = "01WSREF000000000000000000B"
	docActor = "01USRREF000000000000000000A"
	docID    = "01DOCREF000000000000000000"
	archID   = "01DOCREFARCH00000000000000"
	otherID  = "01DOCREFOTHER0000000000000"
)

func docVersionRow(id, docIDv string, version int, fileID string) map[string]any {
	return map[string]any{
		"id": id, "organization_id": docOrgA, "workspace_id": docWsA,
		"document_id": docIDv, "version": version, "kind": "file", "reason": "upload",
		"file_id":    fileID,
		"created_by": docActor, "created_by_kind": "human",
	}
}

func TestDocumentVersionHeldBy(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	q := db.New(pool)

	// A live document with two versions: v2 is current (file_version_id
	// points at it), v1 is history.
	insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
		"id": docID, "organization_id": docOrgA, "workspace_id": docWsA,
		"kind": "file", "file_version_id": "01DVCUR00000000000000000",
		"current_version": 2}))
	insertRow(t, ctx, pool, "document_versions", docVersionRow("01DVOLD00000000000000000", docID, 1, "01FVEROLD00000000000000000"))
	insertRow(t, ctx, pool, "document_versions", docVersionRow("01DVCUR00000000000000000", docID, 2, "01FVERCUR00000000000000000"))

	// An archived document (not yet purged) with its own version.
	insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
		"id": archID, "organization_id": docOrgA, "workspace_id": docWsA,
		"kind": "file", "file_version_id": "01DVARCH0000000000000000",
		"current_version": 1, "archived_at": time.Now().Add(-time.Hour),
		"purge_after": time.Now().Add(30 * 24 * time.Hour)}))
	insertRow(t, ctx, pool, "document_versions", docVersionRow("01DVARCH0000000000000000", archID, 1, "01FVERARCH0000000000000000"))

	// Another tenant's document: its file ids must never answer for ours.
	insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
		"id": otherID, "organization_id": docOrgB, "workspace_id": docWsB,
		"kind":            "file",
		"file_version_id": "01DVOTHER000000000000000", "current_version": 1}))
	insertRow(t, ctx, pool, "document_versions", map[string]any{
		"id": "01DVOTHER000000000000000", "organization_id": docOrgB, "workspace_id": docWsB,
		"document_id": otherID, "version": 1, "kind": "file", "reason": "upload",
		"file_id":    "01FVEROTHER00000000000000",
		"created_by": docActor, "created_by_kind": "human"})

	p := DocumentVersionReferenceProvider{}
	held, err := p.HeldBy(ctx, q, []files.FileID{
		"01FVERCUR00000000000000000", // current version -> active
		"01FVEROLD00000000000000000", // superseded version -> version_history
		"01FVERARCH0000000000000000", // archived doc -> soft_deleted
		"01FVEROTHER00000000000000",  // org B's file -> still held by org B's row
		"01FVERNONE0000000000000000", // unreferenced -> not held
	})
	if err != nil {
		t.Fatal(err)
	}

	if held["01FVERCUR00000000000000000"] != files.HoldActive {
		t.Errorf("current version hold = %q", held["01FVERCUR00000000000000000"])
	}
	if held["01FVEROLD00000000000000000"] != files.HoldVersionHistory {
		t.Errorf("old version hold = %q", held["01FVEROLD00000000000000000"])
	}
	if held["01FVERARCH0000000000000000"] != files.HoldSoftDeleted {
		t.Errorf("archived version hold = %q", held["01FVERARCH0000000000000000"])
	}
	if _, ok := held["01FVERNONE0000000000000000"]; ok {
		t.Error("unreferenced id must not be held")
	}
	// The cross-tenant row still holds its own file: the collector never
	// deletes org B's file because org A asked. Conversely our tenants
	// query is what keeps org A's row from holding org B's files - see
	// TestFileReferenceQueriesRun.
	if held["01FVEROTHER00000000000000"] != files.HoldActive {
		t.Errorf("org B file hold = %q", held["01FVEROTHER00000000000000"])
	}
}

func TestDocumentAssetHeldBy(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	q := db.New(pool)
	now := time.Now()

	insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
		"id": docID, "organization_id": docOrgA, "workspace_id": docWsA, "kind": "page"}))
	insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
		"id": archID, "organization_id": docOrgA, "workspace_id": docWsA, "kind": "page",
		"archived_at": now.Add(-time.Hour), "purge_after": now.Add(30 * 24 * time.Hour)}))

	asset := func(id, docIDv, fileID string, orphanedAt *time.Time) map[string]any {
		m := map[string]any{
			"id": id, "organization_id": docOrgA, "workspace_id": docWsA,
			"document_id": docIDv, "file_id": fileID, "mime_type": "image/png",
			"size_bytes": 100, "created_by": docActor, "created_by_kind": "human"}
		if orphanedAt != nil {
			m["orphaned_at"] = *orphanedAt
		}
		return m
	}

	inHold := now.Add(-3 * 24 * time.Hour)   // 3 days ago - inside the hold
	pastHold := now.Add(-8 * 24 * time.Hour) // 8 days ago - past the hold
	oldOrphan := now.Add(-10 * 24 * time.Hour)

	insertRow(t, ctx, pool, "document_assets", asset("01DAALIVE000000000000000", docID, "01FASLIVE0000000000000000", nil))
	insertRow(t, ctx, pool, "document_assets", asset("01DAHOLD0000000000000000", docID, "01FASHOLD0000000000000000", &inHold))
	insertRow(t, ctx, pool, "document_assets", asset("01DAPAST0000000000000000", docID, "01FASPAST0000000000000000", &pastHold))
	// Orphaned long ago, but the parent document is archived -> soft_deleted wins.
	insertRow(t, ctx, pool, "document_assets", asset("01DAARCH0000000000000000", archID, "01FASARCH0000000000000000", &oldOrphan))

	p := DocumentAssetReferenceProvider{}
	held, err := p.HeldBy(ctx, q, []files.FileID{
		"01FASLIVE0000000000000000",
		"01FASHOLD0000000000000000",
		"01FASPAST0000000000000000",
		"01FASARCH0000000000000000",
		"01FASNONE0000000000000000",
	})
	if err != nil {
		t.Fatal(err)
	}

	if held["01FASLIVE0000000000000000"] != files.HoldActive {
		t.Errorf("live asset hold = %q", held["01FASLIVE0000000000000000"])
	}
	if held["01FASHOLD0000000000000000"] != files.HoldRetention {
		t.Errorf("in-hold asset hold = %q", held["01FASHOLD0000000000000000"])
	}
	if _, ok := held["01FASPAST0000000000000000"]; ok {
		t.Error("asset past the 7-day hold must be released")
	}
	if held["01FASARCH0000000000000000"] != files.HoldSoftDeleted {
		t.Errorf("archived doc asset hold = %q", held["01FASARCH0000000000000000"])
	}
	if _, ok := held["01FASNONE0000000000000000"]; ok {
		t.Error("unreferenced asset must not be held")
	}
}
