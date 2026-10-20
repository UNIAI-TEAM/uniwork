package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-2045 SV-9: the multi-document zip download job. The request writes the
// job row and its audit/outbox pair; the slow-lane consumer builds the zip
// with the caller's own gate and the single-file download's side effects.

type zipFixture struct {
	env      *docStorageEnv
	consumer *DocumentDownloadConsumer
}

func newZipFixture(t *testing.T) *zipFixture {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	c := NewDocumentDownloadConsumer(env.f.pool, env.f.q, env.svc)
	c.SetFileService(env.fake)
	return &zipFixture{env: env, consumer: c}
}

// file creates a workspace-visible file document with a fixed title and
// filename, so the zip entry names are deterministic.
func (z *zipFixture) file(t *testing.T, actor Actor, title, filename string, body []byte) string {
	t.Helper()
	res := z.env.createFile(t, actor, filename, body)
	if _, err := z.env.f.pool.Exec(context.Background(), `UPDATE documents SET title = $2 WHERE id = $1`, res.Document.ID, title); err != nil {
		t.Fatal(err)
	}
	return res.Document.ID
}

func (z *zipFixture) run(t *testing.T, job DocumentDownloadJob) error {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{
		"job_id": job.ID, "organization_id": z.env.tn.orgID, "workspace_id": z.env.tn.wsA,
	})
	return z.consumer.Handle(context.Background(), outbox.Row{ID: "ev-" + job.ID, Topic: DocumentDownloadTopic, Payload: string(payload)})
}

func (z *zipFixture) create(t *testing.T, actor Actor, ids ...string) DocumentDownloadJob {
	t.Helper()
	job, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), actor, z.env.tn.wsA, ids)
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	return job
}

// entries reads the finished zip as the creator downloads it.
func (z *zipFixture) entries(t *testing.T, actor Actor, jobID string) map[string][]byte {
	t.Helper()
	dl, err := z.env.svc.OpenDocumentDownloadJob(context.Background(), actor, z.env.tn.wsA, jobID)
	if err != nil {
		t.Fatalf("open download: %v", err)
	}
	defer dl.Reader.Close()
	body, err := io.ReadAll(dl.Reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		b, err := readZipFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, dup := out[f.Name]; dup {
			t.Fatalf("zip carries %q twice", f.Name)
		}
		out[f.Name] = b
	}
	return out
}

func (z *zipFixture) downloadLogs(t *testing.T, docID string) int {
	t.Helper()
	var n int
	if err := z.env.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM document_access_logs WHERE document_id = $1 AND action = 'download'`, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDocumentDownloadJobBuildsTheZip(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	a := z.file(t, member, "Quarterly report", "q.docx", []byte("alpha-bytes"))
	b := z.file(t, member, "Budget", "b.xlsx", []byte("bravo-bytes"))
	c := z.file(t, member, "Notes", "n.md", []byte("charlie-bytes"))
	page, err := z.env.svc.CreatePage(ctx, member, z.env.tn.wsA, CreatePageInput{Title: "A page", Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}

	job := z.create(t, member, a, b, c, page.Document.ID)
	if job.Status != "queued" || job.ExpiresAt != nil || job.FileCount != nil || len(job.Skipped) != 0 || job.DownloadReady {
		t.Fatalf("queued job = %+v", job)
	}
	var auditRows int
	if err := z.env.f.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentsDownloadJobCreated, job.ID).Scan(&auditRows); err != nil || auditRows != 1 {
		t.Fatalf("download_job_created audit rows = %d (%v), want 1", auditRows, err)
	}
	var outboxRows int
	if err := z.env.f.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'job_id' = $2`,
		DocumentDownloadTopic, job.ID).Scan(&outboxRows); err != nil || outboxRows != 1 {
		t.Fatalf("outbox rows = %d (%v), want 1", outboxRows, err)
	}

	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	done, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "ready" || !done.DownloadReady || done.FileCount == nil || *done.FileCount != 3 {
		t.Fatalf("ready job = %+v", done)
	}
	if done.ExpiresAt == nil {
		t.Fatal("ready job has no expires_at")
	}
	if d := time.Until(*done.ExpiresAt); d < 55*time.Minute || d > 61*time.Minute {
		t.Fatalf("expires_at = %v, want about one hour out", done.ExpiresAt)
	}
	if len(done.Skipped) != 1 || done.Skipped[0] != (DocumentDownloadSkip{DocumentID: page.Document.ID, Reason: "not_a_file"}) {
		t.Fatalf("skipped = %+v, want the page as not_a_file", done.Skipped)
	}

	got := z.entries(t, member, job.ID)
	want := map[string]string{"Quarterly report.docx": "alpha-bytes", "Budget.xlsx": "bravo-bytes", "Notes.md": "charlie-bytes"}
	if len(got) != len(want) {
		t.Fatalf("zip entries = %v", zipNames(got))
	}
	for name, body := range want {
		if string(got[name]) != body {
			t.Fatalf("entry %q = %q, want %q (entries %v)", name, got[name], body, zipNames(got))
		}
	}
	for _, id := range []string{a, b, c} {
		if n := z.downloadLogs(t, id); n != 1 {
			t.Fatalf("download access rows of %s = %d, want exactly 1", id, n)
		}
	}
	if n := z.downloadLogs(t, page.Document.ID); n != 0 {
		t.Fatalf("a skipped page was logged as downloaded %d times", n)
	}

	// A redelivered event neither rebuilds nor logs a second download.
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{a, b, c} {
		if n := z.downloadLogs(t, id); n != 1 {
			t.Fatalf("after a replay, download rows of %s = %d, want 1", id, n)
		}
	}
}

func zipNames(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestDocumentDownloadJobSkipsNeverLeak(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	good := z.file(t, member, "Visible", "v.txt", []byte("visible"))

	// A restricted document the member cannot read.
	hidden := z.file(t, human(z.env.tn.aclOwner), "Secret plan", "s.txt", []byte("secret"))
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`, hidden, z.env.tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}
	// A document of another organization.
	other := newDocPermFixtureOn(z.env.f.pool).tenant(t, "zipx"+strings.ToLower(util.NewID()[20:]))
	foreign, err := z.env.svc.CreateFileDocument(ctx, Human(other.owner.ID), other.wsA, CreateFileDocumentInput{
		Title: "Foreign title", Filename: "f.txt", Body: strings.NewReader("foreign"), Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatal(err)
	}
	missing := util.NewID()

	job := z.create(t, member, good, hidden, foreign.Document.ID, missing)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	done, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "ready" || done.FileCount == nil || *done.FileCount != 1 {
		t.Fatalf("job = %+v, want ready with the one visible file", done)
	}
	want := []DocumentDownloadSkip{
		{DocumentID: hidden, Reason: "not_found"},
		{DocumentID: foreign.Document.ID, Reason: "not_found"},
		{DocumentID: missing, Reason: "not_found"},
	}
	if len(done.Skipped) != len(want) {
		t.Fatalf("skipped = %+v", done.Skipped)
	}
	for i := range want {
		if done.Skipped[i] != want[i] {
			t.Fatalf("skipped[%d] = %+v, want %+v", i, done.Skipped[i], want[i])
		}
	}
	raw, _ := json.Marshal(done.Skipped)
	for _, leak := range []string{"Secret plan", "Foreign title", "secret", "foreign"} {
		if strings.Contains(string(raw), leak) {
			t.Fatalf("skipped list leaks %q: %s", leak, raw)
		}
	}
	entries := z.entries(t, member, job.ID)
	if len(entries) != 1 || string(entries["Visible.txt"]) != "visible" {
		t.Fatalf("zip entries = %v", zipNames(entries))
	}
	for _, id := range []string{hidden, foreign.Document.ID} {
		if n := z.downloadLogs(t, id); n != 0 {
			t.Fatalf("a skipped document %s was logged as downloaded %d times", id, n)
		}
	}
}

func TestDocumentDownloadJobRechecksAccessAtBuildTime(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	keep := z.file(t, member, "Keep", "k.txt", []byte("keep"))
	lost := z.file(t, human(z.env.tn.aclOwner), "Lost", "l.txt", []byte("lost"))

	job := z.create(t, member, keep, lost)
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`, lost, z.env.tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	done, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(done.Skipped) != 1 || done.Skipped[0] != (DocumentDownloadSkip{DocumentID: lost, Reason: "not_found"}) {
		t.Fatalf("skipped = %+v, want the revoked document as not_found", done.Skipped)
	}
	if entries := z.entries(t, member, job.ID); len(entries) != 1 || entries["Keep.txt"] == nil {
		t.Fatalf("zip entries = %v", zipNames(entries))
	}
}

func TestDocumentDownloadJobNamesEntries(t *testing.T) {
	z := newZipFixture(t)
	member := human(z.env.tn.member)
	d1 := z.file(t, member, "Report", "a.txt", []byte("one"))
	d2 := z.file(t, member, "Report", "b.txt", []byte("two"))
	d3 := z.file(t, member, "Report.txt", "c.txt", []byte("three")) // the title already carries the extension
	d4 := z.file(t, member, "../../etc/passwd", "d.txt", []byte("four"))
	d5 := z.file(t, member, "a/b\\c\x01d\x1fe", "e.txt", []byte("five"))
	d6 := z.file(t, member, "  ..  ", "f.txt", []byte("six"))

	job := z.create(t, member, d1, d2, d3, d4, d5, d6)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	got := z.entries(t, member, job.ID)
	if len(got) != 6 {
		t.Fatalf("zip entries = %v, want six distinct names", zipNames(got))
	}
	for _, name := range []string{"Report.txt", "Report (2).txt", "Report (3).txt"} {
		if got[name] == nil {
			t.Fatalf("entry %q missing from %v", name, zipNames(got))
		}
	}
	for name := range got {
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") || strings.ContainsFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
			t.Fatalf("unsafe entry name %q", name)
		}
		if !strings.HasSuffix(name, ".txt") {
			t.Fatalf("entry %q lost its extension", name)
		}
	}
}

func TestDocumentDownloadJobValidatesTheRequest(t *testing.T) {
	z := newZipFixture(t)
	member := human(z.env.tn.member)
	one := z.file(t, member, "One", "1.txt", []byte("1"))
	many := make([]string, 101)
	for i := range many {
		many[i] = util.NewID()
	}
	cases := map[string][]string{
		"empty":       {},
		"nil":         nil,
		"101 ids":     many,
		"duplicates":  {one, one},
		"not a ulid":  {one, "not-an-id"},
		"blank id":    {one, ""},
		"path-ish id": {"../" + one},
	}
	for name, ids := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), member, z.env.tn.wsA, ids)
			var ve ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want a validation error", err)
			}
		})
	}
	// 100 distinct ids is the largest accepted request.
	hundred := many[:100]
	if _, err := z.env.svc.CreateDocumentDownloadJob(context.Background(), member, z.env.tn.wsA, hundred); err != nil {
		t.Fatalf("100 ids: %v", err)
	}
	// Nothing was queued by the refused ones.
	var n int
	if err := z.env.f.pool.QueryRow(context.Background(), `SELECT count(*) FROM document_download_jobs WHERE workspace_id = $1`, z.env.tn.wsA).Scan(&n); err != nil || n != 1 {
		t.Fatalf("jobs after refusals = %d (%v), want only the 100-id one", n, err)
	}
}

func TestDocumentDownloadJobRefusesMoreThanOneGiB(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	big := z.file(t, member, "Big", "big.bin", []byte("x"))
	small := z.file(t, member, "Small", "s.txt", []byte("s"))
	// The version snapshot is what the cap reads; the fake store need not hold a gigabyte.
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_versions SET size_bytes = $2 WHERE document_id = $1`, big, int64(1<<30)); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_versions SET size_bytes = 1 WHERE document_id = $1`, small); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.svc.CreateDocumentDownloadJob(ctx, member, z.env.tn.wsA, []string{big}); err != nil {
		t.Fatalf("exactly 1 GiB must be accepted: %v", err)
	}
	_, err := z.env.svc.CreateDocumentDownloadJob(ctx, member, z.env.tn.wsA, []string{big, small})
	ce := wantCode(t, err, "download_too_large")
	if ce.Status != 422 || ce.Fields["max_bytes"] != int64(1<<30) {
		t.Fatalf("refusal = %+v, want 422 with max_bytes 1 GiB", ce)
	}
	var n int
	if err := z.env.f.pool.QueryRow(ctx, `SELECT count(*) FROM document_download_jobs WHERE workspace_id = $1`, z.env.tn.wsA).Scan(&n); err != nil || n != 1 {
		t.Fatalf("a refused request left a job behind: %d (%v)", n, err)
	}
	// Files the caller cannot download do not count toward the cap.
	hidden := z.file(t, human(z.env.tn.aclOwner), "Hidden big", "h.bin", []byte("h"))
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted', acl_owner_id = $2 WHERE id = $1`, hidden, z.env.tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_versions SET size_bytes = $2 WHERE document_id = $1`, hidden, int64(5<<30)); err != nil {
		t.Fatal(err)
	}
	if _, err := z.env.svc.CreateDocumentDownloadJob(ctx, member, z.env.tn.wsA, []string{small, hidden}); err != nil {
		t.Fatalf("an unreadable giant must not trip the cap: %v", err)
	}
}

func TestDocumentDownloadJobIsPrivateToItsCreator(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Mine", "m.txt", []byte("mine"))
	job := z.create(t, member, doc)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	for name, who := range map[string]Actor{
		"workspace admin":  human(z.env.tn.wsAdmin),
		"another member":   human(z.env.tn.creator),
		"organization own": human(z.env.tn.owner),
		"outsider":         human(z.env.tn.outsider),
	} {
		if _, err := z.env.svc.GetDocumentDownloadJob(ctx, who, z.env.tn.wsA, job.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s GET = %v, want not found", name, err)
		}
		if _, err := z.env.svc.OpenDocumentDownloadJob(ctx, who, z.env.tn.wsA, job.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s download = %v, want not found", name, err)
		}
	}
	// The creator reads it through the wrong workspace as not found too.
	if _, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsB, job.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong workspace GET = %v, want not found", err)
	}
	if _, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, util.NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown job GET = %v, want not found", err)
	}
}

func TestDocumentDownloadJobFailsWhenNothingCanBeDownloaded(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	page, err := z.env.svc.CreatePage(ctx, member, z.env.tn.wsA, CreatePageInput{Title: "Only a page", Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	job := z.create(t, member, page.Document.ID, util.NewID())
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	done, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if done.Status != "failed" || done.Error != "nothing_to_download" || done.DownloadReady || done.FileCount != nil {
		t.Fatalf("job = %+v, want failed/nothing_to_download", done)
	}
	if len(done.Skipped) != 2 {
		t.Fatalf("skipped = %+v, want both reasons kept", done.Skipped)
	}
	if _, err := z.env.svc.OpenDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("download of a failed job = %v, want not found", err)
	}
}

func TestDocumentDownloadJobExpiresAndReleasesTheZip(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Soon gone", "g.txt", []byte("gone"))
	job := z.create(t, member, doc)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	var fileID string
	if err := z.env.f.pool.QueryRow(ctx, `SELECT file_id FROM document_download_jobs WHERE id = $1`, job.ID).Scan(&fileID); err != nil || fileID == "" {
		t.Fatalf("ready job has no file (%v)", err)
	}
	provider := DocumentDownloadReferenceProvider()
	held := func() bool {
		m, err := provider.HeldBy(ctx, z.env.f.q, []files.FileID{files.FileID(fileID)})
		if err != nil {
			t.Fatal(err)
		}
		return len(m) == 1
	}
	if !held() {
		t.Fatal("the reference provider does not hold a live zip")
	}
	// The sweep leaves a zip inside its window alone.
	releaseExpiredDocumentDownloads(ctx, z.env.f.pool, z.env.f.q, z.env.fake)
	if !held() {
		t.Fatal("the sweep released a zip before it expired")
	}

	if _, err := z.env.f.pool.Exec(ctx, `UPDATE document_download_jobs SET expires_at = now() - interval '1 second' WHERE id = $1`, job.ID); err != nil {
		t.Fatal(err)
	}
	expired, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Status != "expired" || expired.DownloadReady {
		t.Fatalf("expired job = %+v", expired)
	}
	_, err = z.env.svc.OpenDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if ce := wantCode(t, err, "document_download_expired"); ce.Status != 410 {
		t.Fatalf("expired download = %+v, want 410", ce)
	}
	releaseExpiredDocumentDownloads(ctx, z.env.f.pool, z.env.f.q, z.env.fake)
	if held() {
		t.Fatal("the sweep kept the expired zip referenced")
	}
	var after *string
	if err := z.env.f.pool.QueryRow(ctx, `SELECT file_id FROM document_download_jobs WHERE id = $1`, job.ID).Scan(&after); err != nil || after != nil {
		t.Fatalf("file_id after release = %v (%v), want NULL", after, err)
	}
	again, err := z.env.svc.GetDocumentDownloadJob(ctx, member, z.env.tn.wsA, job.ID)
	if err != nil || again.Status != "expired" {
		t.Fatalf("after release job = %+v (%v), want expired", again, err)
	}
}

func TestDocumentDownloadJobTenantQueriesStayInTheirWorkspace(t *testing.T) {
	z := newZipFixture(t)
	ctx := context.Background()
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Mine", "m.txt", []byte("mine"))
	job := z.create(t, member, doc)
	// The consumer answers a payload that names another tenant's pair as a no-op, never a build.
	payload, _ := json.Marshal(map[string]string{"job_id": job.ID, "organization_id": util.NewID(), "workspace_id": z.env.tn.wsA})
	err := z.consumer.Handle(ctx, outbox.Row{ID: "ev-x", Topic: DocumentDownloadTopic, Payload: string(payload)})
	if err != nil {
		t.Fatalf("a mismatched payload must be ignored, got %v", err)
	}
	var status string
	if err := z.env.f.pool.QueryRow(ctx, `SELECT status FROM document_download_jobs WHERE id = $1`, job.ID).Scan(&status); err != nil || status != "queued" {
		t.Fatalf("status = %q (%v), want still queued", status, err)
	}
}
