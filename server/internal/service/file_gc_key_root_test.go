package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// withKeyRoot runs the collector's FileService under an environment root.
func withKeyRoot(root string) gcOption {
	return func(o *FileServiceOptions) { o.KeyRoot = root }
}

// managedLocator under an environment root: only a key under this
// environment's own root is FileService's; the same layout under another
// environment's root, or at the bucket root, is someone else's object.
func TestManagedLocatorStaysUnderTheKeyRoot(t *testing.T) {
	const id = "01J8ZQ0K7V9W1Y2X3Z4A5B6R01"
	tail := "v1/orgs/org-1/workspaces/ws-1/tasks/attachments/2026/10/" + id + "/original"
	user := "v1/users/u-1/avatars/2026/10/" + id + "/original"
	for _, tc := range []struct {
		root, key, org string
		want           bool
	}{
		{"", tail, "org-1", true},
		{"develop/", "develop/" + tail, "org-1", true},
		{"develop/", "develop/" + user, "", true},
		{"envs/develop/", "envs/develop/" + tail, "org-1", true},
		// Another environment's root in the same bucket.
		{"develop/", "production/" + tail, "org-1", false},
		{"develop/", "production/" + user, "", false},
		{"", "production/" + tail, "org-1", false},
		{"develop/", "develop2/" + tail, "org-1", false},
		{"envs/develop/", "develop/" + tail, "org-1", false},
		// At the bucket root, outside this environment.
		{"develop/", tail, "org-1", false},
		{"develop/", user, "", false},
		// The root alone does not make a key managed.
		{"develop/", "develop/workspaces/ws-1/attachments/" + id + "/original", "org-1", false},
	} {
		s := &FileService{backend: storage.BackendMinIO, bucket: "uniwork", keyRoot: tc.root}
		file := db.File{
			ID: id, Storage: string(storage.BackendMinIO), Bucket: fileText("uniwork"), ObjectKey: tc.key,
			OrganizationID: fileText(tc.org),
		}
		if got, why := s.managedLocator(file, db.FileUploadSession{}, false); got != tc.want {
			t.Errorf("root %q key %q: managed = %v (%s), want %v", tc.root, tc.key, got, why, tc.want)
		}
	}
}

// A legacy locator holds a managed object whether it names the full key
// (root included) or the key below the root - a legacy reader that prepends
// S3_KEY_PREFIX itself reaches the same object from the shorter form.
func TestLegacyLocatorNamesKeyUnderTheRoot(t *testing.T) {
	const rel = "v1/orgs/o/workspaces/w/tasks/attachments/2026/10/F1/original"
	s := &FileService{keyRoot: "develop/"}
	key := "develop/" + rel
	for _, tc := range []struct {
		loc  string
		want bool
	}{
		{key, true},
		{rel, true},
		{"https://cdn.example.test/" + key + "?v=1", true},
		{"https://cdn.example.test/" + rel, true},
		{"https://s3.example.test/uniwork/" + key + "#frag", true},
		{"v1/orgs/o/workspaces/w/tasks/attachments/2026/10/F2/original", false},
		{"https://cdn.example.test/" + rel + "-thumb", false},
	} {
		if got := s.heldByLegacyLocator(key, []string{tc.loc}); got != tc.want {
			t.Errorf("heldByLegacyLocator(%q) = %v, want %v", tc.loc, got, tc.want)
		}
	}
}

// End to end under a root: a released file minted under the root is
// deleted like any managed file; a row whose key sits under another
// environment's root (or at the bucket root) is quarantined and its object
// stays; a legacy column naming a rooted key - with or without the root -
// holds it.
func TestFileGCUnderKeyRoot(t *testing.T) {
	const root = "develop/"
	h := newGCHarness(t, FileGCDestructive, withKeyRoot(root))
	ctx := context.Background()

	gone := h.claimedAndReleased(t, "rooted-gone", 30*time.Hour)
	if key := h.file(t, gone).ObjectKey; !strings.HasPrefix(key, root+storage.FileServiceKeyPrefix+"orgs/") {
		t.Fatalf("minted key %q is not under %q", key, root)
	}
	sharedFull := h.claimedAndReleased(t, "rooted-shared-full", 30*time.Hour)
	sharedRel := h.claimedAndReleased(t, "rooted-shared-rel", 30*time.Hour)
	fullKey := h.file(t, sharedFull).ObjectKey
	relKey := strings.TrimPrefix(h.file(t, sharedRel).ObjectKey, root)
	for i, key := range []string{fullKey, relKey} {
		if _, err := h.pool.Exec(ctx, `INSERT INTO attachments
			(id, organization_id, workspace_id, task_id, uploader_type, uploader_id, object_key, filename, content_type, size_bytes)
			VALUES ($1, $2, $3, 'task-legacy', 'member', $4, $5, 'a.bin', 'text/plain', 5)`,
			[]string{"att-root-full", "att-root-rel"}[i], t3Org, t3WS, t3User, key); err != nil {
			t.Fatalf("seed legacy attachment: %v", err)
		}
	}

	old := h.clock.Now().Add(-48 * time.Hour)
	foreign := []struct{ id, key string }{
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6R11", "production/v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/tasks/attachments/2026/09/01J8ZQ0K7V9W1Y2X3Z4A5B6R11/original"},
		{"01J8ZQ0K7V9W1Y2X3Z4A5B6R12", "v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/tasks/attachments/2026/09/01J8ZQ0K7V9W1Y2X3Z4A5B6R12/original"},
	}
	for _, f := range foreign {
		if _, err := h.pool.Exec(ctx, `INSERT INTO files (id, organization_id, storage, object_key, original_filename, status, content_type, size_bytes, ready_at)
			VALUES ($1, $2, 'local', $3, 'other.bin', 'ready', 'text/plain', 5, $4)`, f.id, t3Org, f.key, old); err != nil {
			t.Fatalf("seed %s: %v", f.id, err)
		}
		row := h.file(t, files.FileID(f.id))
		if _, err := h.store.ObjectStore.Put(ctx, locator(row), strings.NewReader("old!\n"), storage.WriteInfo{SizeBytes: 5}); err != nil {
			t.Fatalf("put %s: %v", f.key, err)
		}
		if err := h.svc.enqueueJob(ctx, h.svc.q, row, fileJobCleanup, h.clock.Now()); err != nil {
			t.Fatal(err)
		}
	}

	rep := h.sweep(t)
	if e := entry(t, rep, gone, fileJobCleanup); e.Action != FileGCDeleted {
		t.Fatalf("rooted managed file = %+v, want deleted", e)
	}
	if h.objectExists(t, h.file(t, gone)) {
		t.Fatal("rooted managed object still there")
	}
	for _, id := range []files.FileID{sharedFull, sharedRel} {
		if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCQuarantined || e.Reason != "legacy_locator_shared" {
			t.Fatalf("%s = %+v, want quarantined legacy_locator_shared", id, e)
		}
		if !h.objectExists(t, h.wantStatus(t, id, files.StatusReady)) {
			t.Fatalf("%s: shared object deleted", id)
		}
	}
	for _, f := range foreign {
		id := files.FileID(f.id)
		if e := entry(t, rep, id, fileJobCleanup); e.Action != FileGCQuarantined || e.Reason != "unmanaged_locator" {
			t.Fatalf("%s = %+v, want quarantined unmanaged_locator", f.key, e)
		}
		if !h.objectExists(t, h.wantStatus(t, id, files.StatusReady)) {
			t.Fatalf("%s: object outside the root deleted", f.key)
		}
	}
	if h.gcs.deletes != 1 {
		t.Fatalf("storage saw %d deletes, want only the rooted managed one", h.gcs.deletes)
	}
}
