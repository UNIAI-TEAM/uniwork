package service

// E6 FD-02 (UNI-1462) restore names: the final parent and the final name of
// every member of a restore batch are decided while the rows are still in the
// trash, against the live siblings of the parent they come back under and
// against the names the batch itself gives out (§3.3).

import (
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// setArchiveBatch stamps rows an older binary (or a test) left in the trash
// with one batch id: nothing else writes that column outside ArchiveDocument.
func setArchiveBatch(t *testing.T, env *folderNamesEnv, batch string, ids ...string) {
	t.Helper()
	if _, err := env.f.pool.Exec(env.ctx,
		`UPDATE documents SET archive_batch_id = $1 WHERE id = ANY($2) AND archived_at IS NOT NULL`, batch, ids); err != nil {
		t.Fatal(err)
	}
}

func (e *folderNamesEnv) archivedFolder(t *testing.T, parent, title string, position float64) db.Document {
	t.Helper()
	return e.f.treeDoc(t, e.tn, treeDocSpec{
		ws: e.tn.wsA, visibility: documentVisibilityWorkspace,
		aclOwner: e.tn.member.ID, createdBy: e.tn.member.ID,
		kind: DocumentKindFolder, title: title, parent: parent, position: position, archived: true,
	})
}

func TestDocumentRestoreNames(t *testing.T) {
	env := newFolderNamesEnv(t)

	t.Run("a restored folder yields to a live sibling under the old parent", func(t *testing.T) {
		parent := env.folder(t, "", "Cha cũ")
		child := env.folder(t, parent.ID, "Con")
		env.archive(t, child.ID)
		env.folder(t, parent.ID, "Con")
		res, err := env.svc.RestoreDocument(env.ctx, env.member, child.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if res.View.Document.Title != "Con (2)" || res.View.Document.ParentID.String != parent.ID {
			t.Fatalf("restored = %q under %v", res.View.Document.Title, res.View.Document.ParentID)
		}
		env.assertRestoreAudit(t, child.ID, "Con (2)")
	})

	t.Run("a restored folder yields to a live sibling at the root", func(t *testing.T) {
		mine := env.folder(t, "", "Gốc cũ")
		env.archive(t, mine.ID)
		env.folder(t, "", "Gốc cũ")
		res, err := env.svc.RestoreDocument(env.ctx, env.member, mine.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if res.View.Document.Title != "Gốc cũ (2)" || res.View.Document.ParentID.Valid {
			t.Fatalf("restored = %q parent %v", res.View.Document.Title, res.View.Document.ParentID)
		}
	})

	t.Run("an orphan re-roots and yields to the name at the root", func(t *testing.T) {
		parent := env.folder(t, "", "Cha đi vắng")
		child := env.folder(t, parent.ID, "Mồ côi")
		env.archive(t, child.ID)
		env.archive(t, parent.ID)
		env.folder(t, "", "Mồ côi")
		res, err := env.svc.RestoreDocument(env.ctx, env.member, child.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if res.View.Document.ParentID.Valid {
			t.Fatalf("orphan still points at %v", res.View.Document.ParentID)
		}
		if res.View.Document.Title != "Mồ côi (2)" {
			t.Fatalf("title = %q, want Mồ côi (2)", res.View.Document.Title)
		}
		if !env.archived(t, parent.ID) {
			t.Fatal("the parent left the trash with a batch it is not part of")
		}
	})

	t.Run("two orphans of one old batch with one name come back distinct", func(t *testing.T) {
		batch := util.NewID()
		live := env.folder(t, "", "Gốc trùng")
		// first sits at the root; second sits under an unmanaged intermediate
		// folder gone in the same batch, so when first is restored, gone stays
		// in the trash and second detaches to the root, where the live folder
		// already holds the name.
		first := env.archivedFolder(t, "", "Gốc trùng", 0)
		gone := env.f.treeDoc(t, env.tn, treeDocSpec{
			ws: env.tn.wsA, visibility: documentVisibilityRestricted,
			aclOwner: env.tn.aclOwner.ID, createdBy: env.tn.aclOwner.ID,
			kind: DocumentKindFolder, title: "Cha mất", parent: first.ID, archived: true,
		})
		second := env.archivedFolder(t, gone.ID, "Gốc trùng", 1)
		setArchiveBatch(t, env, batch, first.ID, gone.ID, second.ID)
		res, err := env.svc.RestoreDocument(env.ctx, env.member, first.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Affected) != 2 {
			t.Fatalf("restored %v, want the two managed members", res.Affected)
		}
		names := map[string]string{}
		for _, id := range []string{first.ID, second.ID} {
			row := env.f.live(t, id)
			if row.ParentID.Valid {
				t.Fatalf("orphan %s still points at %v", id, row.ParentID)
			}
			names[id] = row.Title
		}
		// Deterministic: position 0 takes the first free number, position 1 the
		// next, both past the live sibling's name and each other's.
		if names[first.ID] != "Gốc trùng (2)" || names[second.ID] != "Gốc trùng (3)" {
			t.Fatalf("names = %v, want (2) and (3)", names)
		}
		if env.f.live(t, live.ID).Title != "Gốc trùng" {
			t.Fatal("the live sibling moved")
		}
		for _, id := range []string{first.ID, second.ID} {
			env.assertRestoreAudit(t, id, names[id])
		}
	})

	t.Run("a node the caller cannot manage stays in the trash while the managed item restores", func(t *testing.T) {
		batch := util.NewID()
		mine := env.folder(t, "", "Của tôi")
		env.archive(t, mine.ID)
		theirs := env.f.treeDoc(t, env.tn, treeDocSpec{
			ws: env.tn.wsA, visibility: documentVisibilityRestricted,
			aclOwner: env.tn.aclOwner.ID, createdBy: env.tn.aclOwner.ID,
			kind: DocumentKindFolder, title: "Của người khác", parent: mine.ID, archived: true,
		})
		setArchiveBatch(t, env, batch, mine.ID, theirs.ID)
		res, err := env.svc.RestoreDocument(env.ctx, env.member, mine.ID, ArchiveDocumentInput{})
		if err != nil {
			t.Fatalf("restore of mine with an unmanageable child = %v, want nil", err)
		}
		if len(res.Affected) != 1 || res.Affected[0] != mine.ID {
			t.Fatalf("restored = %v, want [%s]", res.Affected, mine.ID)
		}
		if env.archived(t, mine.ID) || !env.archived(t, theirs.ID) {
			t.Fatal("want mine live and theirs still in the trash")
		}
		if got := env.title(t, theirs.ID); got != "Của người khác" {
			t.Fatalf("unmanaged node was renamed: %q", got)
		}
		if _, err := env.svc.RestoreDocument(env.ctx, env.member, theirs.ID, ArchiveDocumentInput{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("restore of invisible node = %v, want not found", err)
		}
	})
}

// archive trashes one document and returns it.
func (e *folderNamesEnv) archive(t *testing.T, id string) {
	t.Helper()
	if _, err := e.svc.ArchiveDocument(e.ctx, e.member, id, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("archive %s: %v", id, err)
	}
}

func (e *folderNamesEnv) archived(t *testing.T, id string) bool {
	t.Helper()
	var archived bool
	if err := e.f.pool.QueryRow(e.ctx, `SELECT archived_at IS NOT NULL FROM documents WHERE id = $1`, id).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	return archived
}

func (e *folderNamesEnv) title(t *testing.T, id string) string {
	t.Helper()
	var title string
	if err := e.f.pool.QueryRow(e.ctx, `SELECT title FROM documents WHERE id = $1`, id).Scan(&title); err != nil {
		t.Fatal(err)
	}
	return title
}

// assertRestoreAudit holds the per-member audit row: the restored action and a
// diff naming the title the member came back with.
func (e *folderNamesEnv) assertRestoreAudit(t *testing.T, id, title string) {
	t.Helper()
	var changes string
	if err := e.f.pool.QueryRow(e.ctx,
		`SELECT changes::text FROM audit_events WHERE action = $1 AND resource_id = $2`,
		string(audit.ActionDocumentRestored), id).Scan(&changes); err != nil {
		t.Fatalf("no document.restored audit row for %s: %v", id, err)
	}
	if !strings.Contains(changes, title) {
		t.Fatalf("restore audit diff for %s does not carry %q: %s", id, title, changes)
	}
}
