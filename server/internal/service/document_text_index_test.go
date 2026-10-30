package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// indexRequests lists the version ids that document.text_index_requested was
// written for, for one document, oldest first.
func indexRequests(t *testing.T, env *docStorageEnv, docID string) []string {
	t.Helper()
	var out []string
	for _, p := range outboxPayloads(t, env.f.pool, topicDocumentTextIndexRequested) {
		if p["document_id"] == docID {
			if p["organization_id"] == "" || p["workspace_id"] == "" {
				t.Fatalf("payload misses a tenant id: %v", p)
			}
			out = append(out, p["version_id"])
		}
	}
	return out
}

func TestFileVersionsRequestTheirTextIndex(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	created := env.createFile(t, member, "chi-muc.pdf", pdfBody("v1"))
	first := created.Document.FileVersionID.String
	if got := indexRequests(t, env, created.Document.ID); len(got) != 1 || got[0] != first {
		t.Fatalf("create requests = %v, want [%s]", got, first)
	}

	up := env.upload(t, member, created.Document.ID, "chi-muc-v2.pdf", pdfBody("v2"))
	next, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit")
	if got := indexRequests(t, env, created.Document.ID); len(got) != 2 || got[1] != next.Version.ID {
		t.Fatalf("commit requests = %v, want the new version %s second", got, next.Version.ID)
	}

	cp, err := env.svc.CopyDocument(ctx, member, created.Document.ID, CopyDocumentInput{Consent: "copy", IdempotencyKey: util.NewID()})
	mustf(t, err, "copy")
	if got := indexRequests(t, env, cp.Document.ID); len(got) != 1 || got[0] != cp.Version.ID {
		t.Fatalf("copy requests = %v, want [%s]", got, cp.Version.ID)
	}

	rest, err := env.svc.RestoreDocumentVersion(ctx, member, created.Document.ID, RestoreDocumentVersionInput{
		Version: 1, BaseRevision: next.Document.Revision, IdempotencyKey: util.NewID(),
	})
	mustf(t, err, "restore")
	if got := indexRequests(t, env, created.Document.ID); len(got) != 3 || got[2] != rest.Version.ID {
		t.Fatalf("restore requests = %v, want the restored version %s third", got, rest.Version.ID)
	}
}

func TestNewFileVersionClearsTheIndexedText(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	created := env.createFile(t, member, "cu.pdf", pdfBody("v1"))
	_, err := env.f.pool.Exec(ctx,
		`UPDATE documents SET content_text = 'chữ cũ', search_text = search_text || ' chữ cũ' WHERE id = $1`, created.Document.ID)
	mustf(t, err, "seed text")

	up := env.upload(t, member, created.Document.ID, "cu-v2.pdf", pdfBody("v2"))
	_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "commit")

	var title, content, search string
	mustf(t, env.f.pool.QueryRow(ctx,
		`SELECT title, content_text, search_text FROM documents WHERE id = $1`, created.Document.ID).Scan(&title, &content, &search), "read")
	if content != "" || search != documentSearchText(title, "") {
		t.Fatalf("content_text = %q, search_text = %q, want empty and %q", content, search, documentSearchText(title, ""))
	}
}
