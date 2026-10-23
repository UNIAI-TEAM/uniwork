package service

// E6 FD-02 (UNI-1462): two naming commands running at once in one workspace.
// The workspace tree lock is the one order every writer keeps (§3.3), so the
// pairs below serialize - no deadlock, and the names they leave behind are
// the names a single-threaded run would leave.

import (
	"strings"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// race runs two commands at once and returns their errors.
func race(t *testing.T, a, b func() error) (error, error) {
	t.Helper()
	errs := make([]error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); <-start; errs[0] = a() }()
	go func() { defer wg.Done(); <-start; errs[1] = b() }()
	close(start)
	wg.Wait()
	for _, err := range errs {
		if err != nil && strings.Contains(err.Error(), "deadlock detected") {
			t.Fatalf("a naming pair deadlocked: %v", err)
		}
	}
	return errs[0], errs[1]
}

// liveFolderTitles lists the live folders under one parent, so a test can see
// what the two commands left behind.
func (e *folderNamesEnv) liveFolderTitles(t *testing.T, parent string) []string {
	t.Helper()
	rows, err := e.f.pool.Query(e.ctx, `
		SELECT title FROM documents
		WHERE organization_id = $1 AND workspace_id = $2 AND kind = 'folder'
		  AND archived_at IS NULL AND owner_id IS NULL AND COALESCE(parent_id, '') = $3
		ORDER BY title`, e.tn.orgID, e.tn.wsA, parent)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var title string
		if err := rows.Scan(&title); err != nil {
			t.Fatal(err)
		}
		out = append(out, title)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func (e *folderNamesEnv) move(t *testing.T, doc db.Document, parent string) error {
	t.Helper()
	_, err := e.svc.MoveDocument(e.ctx, e.member, doc.ID, MoveDocumentInput{ParentID: parent, Revision: doc.Revision})
	return err
}

func TestDocumentNameCommandRaces(t *testing.T) {
	env := newFolderNamesEnv(t)

	t.Run("rename against rename to one name", func(t *testing.T) {
		parent := env.folder(t, "", "Đích đổi tên")
		one := env.folder(t, parent.ID, "Đổi một")
		two := env.folder(t, parent.ID, "Đổi hai")
		a, b := race(t,
			func() error { return env.rename(t, one, "Tên chung") },
			func() error { return env.rename(t, two, "Tên chung") },
		)
		var refused int
		for _, err := range []error{a, b} {
			switch {
			case err == nil:
			case isCode(err, "folder_name_taken"):
				refused++
			default:
				t.Fatalf("unexpected answer: %v", err)
			}
		}
		if refused != 1 {
			t.Fatalf("refusals = %d, want exactly one (a=%v b=%v)", refused, a, b)
		}
		// The winner holds the shared name and the loser kept its own.
		got := env.liveFolderTitles(t, parent.ID)
		var won int
		for _, title := range got {
			if title == "Tên chung" {
				won++
			}
		}
		if len(got) != 2 || won != 1 {
			t.Fatalf("titles under the parent = %v, want the shared name and one kept", got)
		}
	})

	t.Run("move against move-to-root", func(t *testing.T) {
		parent := env.folder(t, "", "Đích di chuyển")
		doc := env.folder(t, parent.ID, "Đi lại")
		a, b := race(t,
			func() error { return env.move(t, doc, "") },
			func() error { return env.move(t, doc, parent.ID) },
		)
		for _, err := range []error{a, b} {
			if err != nil && !isCode(err, "revision_conflict") {
				t.Fatalf("unexpected answer: %v", err)
			}
		}
		row := env.f.live(t, doc.ID)
		if row.Title != "Đi lại" {
			t.Fatalf("title = %q, want it kept", row.Title)
		}
	})

	t.Run("move against rename in one parent", func(t *testing.T) {
		parent := env.folder(t, "", "Đích chung")
		renaming := env.folder(t, parent.ID, "Đổi thành")
		moving := env.folder(t, "", "Đổi thành")
		a, b := race(t,
			func() error { return env.rename(t, renaming, "Tên đích") },
			func() error { return env.move(t, moving, parent.ID) },
		)
		for _, err := range []error{a, b} {
			if err != nil {
				t.Fatalf("unexpected answer: %v", err)
			}
		}
		got := env.liveFolderTitles(t, parent.ID)
		seen := map[string]bool{}
		for _, title := range got {
			if seen[strings.ToLower(title)] {
				t.Fatalf("two folders share a name: %v", got)
			}
			seen[strings.ToLower(title)] = true
		}
	})

	t.Run("restore against create of one name", func(t *testing.T) {
		restoring := env.folder(t, "", "Khôi phục")
		env.archive(t, restoring.ID)
		a, b := race(t,
			func() error {
				_, err := env.svc.RestoreDocument(env.ctx, env.member, restoring.ID, ArchiveDocumentInput{IdempotencyKey: util.NewID()})
				return err
			},
			func() error { return env.createFolder(t, "", "Khôi phục") },
		)
		// Either order is right: the restore names itself "(2)" when the create
		// took the name first (a restore never refuses for a name), and the
		// create is refused when the restore came back first. What may not
		// happen is a duplicate or a refusal both ways.
		var refused int
		for _, err := range []error{a, b} {
			switch {
			case err == nil:
			case isCode(err, "folder_name_taken"):
				refused++
			default:
				t.Fatalf("unexpected answer: %v", err)
			}
		}
		if refused > 1 {
			t.Fatalf("both commands were refused (restore=%v create=%v)", a, b)
		}
		title := env.title(t, restoring.ID)
		if title != "Khôi phục" && title != "Khôi phục (2)" {
			t.Fatalf("restored title = %q", title)
		}
		titles := env.liveFolderTitles(t, "")
		seen := map[string]bool{}
		for _, one := range titles {
			if seen[one] {
				t.Fatalf("two folders share the name %q: %v", one, titles)
			}
			seen[one] = true
		}
	})
}
