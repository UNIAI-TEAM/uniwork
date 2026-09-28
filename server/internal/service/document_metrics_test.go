package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// countingDocMetrics is the DocumentMetrics fake: it records every call so a
// test can prove both the label vocabulary and the wiring of a command.
type countingDocMetrics struct {
	saves     []string
	conflicts []string
	quota     []string
	sweeps    []string
	rowsFail  []string
}

func (c *countingDocMetrics) IncDocumentAccessLogFailed()           {}
func (c *countingDocMetrics) IncDocumentVersionsProtectedOverflow() {}

func (c *countingDocMetrics) ObserveDocumentSave(kind, outcome string, seconds float64) {
	if seconds < 0 {
		panic("negative save duration")
	}
	c.saves = append(c.saves, kind+"/"+outcome)
}

func (c *countingDocMetrics) IncDocumentConflict(kind, code string) {
	c.conflicts = append(c.conflicts, kind+"/"+code)
}

func (c *countingDocMetrics) IncDocumentQuotaRejected(kind string) {
	c.quota = append(c.quota, kind)
}

func (c *countingDocMetrics) ObserveDocumentWorkerSweep(worker, result string, seconds float64) {
	if seconds < 0 {
		panic("negative sweep duration")
	}
	c.sweeps = append(c.sweeps, worker+"/"+result)
}

func (c *countingDocMetrics) AddDocumentWorkerRowsFailed(worker string, n int) {
	for range n {
		c.rowsFail = append(c.rowsFail, worker)
	}
}

// The outcome vocabulary is a closed set: one row per answer a save can give.
func TestDocumentSaveResultClassification(t *testing.T) {
	for _, c := range []struct {
		name    string
		err     error
		outcome string
		code    string
	}{
		{"ok", nil, documentOutcomeOK, ""},
		{"stale page base", errRevisionConflict(3), documentOutcomeConflict, "revision_conflict"},
		{"stale file base", errDocumentVersionConflict(3), documentOutcomeConflict, "document_version_conflict"},
		{"quota", CodedError{Code: "quota_exceeded", Status: 403, Err: ErrQuotaExceeded}, documentOutcomeQuota, ""},
		{"deleted", errDocumentDeleted(), documentOutcomeGone, ""},
		{"storage down", CodedError{Code: "storage_unavailable", Status: 503}, documentOutcomeUnavailable, ""},
		{"validation", Invalid("thiếu gì đó"), documentOutcomeInvalid, ""},
		{"forbidden", ErrForbidden, documentOutcomeForbidden, ""},
		{"deactivated member", errMemberDeactivated(), documentOutcomeForbidden, ""},
		{"not found", ErrNotFound, documentOutcomeNotFound, ""},
		{"other conflict class", CodedError{Code: "engine_incompatible", Status: 409, Err: ErrConflict}, documentOutcomeConflict, ""},
		{"unknown error", errors.New("boom"), documentOutcomeError, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			outcome, code := documentSaveResult(c.err)
			if outcome != c.outcome || code != c.code {
				t.Fatalf("documentSaveResult = %q/%q, want %q/%q", outcome, code, c.outcome, c.code)
			}
		})
	}
}

func TestRecordDocumentSaveAndSweep(t *testing.T) {
	m := &countingDocMetrics{}
	s := &DocumentService{metrics: m}

	s.recordDocumentSave(documentMetricKindPage, errRevisionConflict(2), 5*time.Millisecond)
	s.recordDocumentSave(documentMetricKindPage, CodedError{Code: "quota_exceeded", Status: 403, Err: ErrQuotaExceeded}, time.Millisecond)
	s.recordDocumentSave(documentMetricKindFile, CodedError{Code: "quota_exceeded", Status: 403, Err: ErrQuotaExceeded}, time.Millisecond)
	s.recordDocumentSave(documentMetricKindPage, nil, time.Millisecond)
	s.recordDocumentSweep("purge", 0, errors.New("storage"), time.Now())
	s.recordDocumentSweep("compact", 0, nil, time.Now())

	wantSaves := []string{"page/conflict", "page/quota", "file/quota", "page/ok"}
	if len(m.saves) != len(wantSaves) {
		t.Fatalf("saves = %v, want %v", m.saves, wantSaves)
	}
	for i, want := range wantSaves {
		if m.saves[i] != want {
			t.Fatalf("saves[%d] = %q, want %q", i, m.saves[i], want)
		}
	}
	if len(m.conflicts) != 1 || m.conflicts[0] != "page/revision_conflict" {
		t.Fatalf("conflicts = %v", m.conflicts)
	}
	// Page quota is counted where the meter is consumed (consumePageBytes);
	// the file commit is counted by the save hook, so only "file" is here.
	if len(m.quota) != 1 || m.quota[0] != "file" {
		t.Fatalf("quota = %v, want [file]", m.quota)
	}
	if len(m.sweeps) != 2 || m.sweeps[0] != "purge/error" || m.sweeps[1] != "compact/ok" {
		t.Fatalf("sweeps = %v", m.sweeps)
	}
}

// A pass that skipped failed rows is never "ok": each worker reports partial
// and adds its failed rows, a stopped pass is error, a clean pass is ok.
func TestRecordDocumentSweepRowFailures(t *testing.T) {
	for _, worker := range []string{"autoversion", "purge", "compact"} {
		t.Run(worker, func(t *testing.T) {
			m := &countingDocMetrics{}
			s := &DocumentService{metrics: m}
			s.recordDocumentSweep(worker, 2, nil, time.Now())
			s.recordDocumentSweep(worker, 1, errors.New("db gone"), time.Now())
			s.recordDocumentSweep(worker, 0, nil, time.Now())
			want := []string{worker + "/partial", worker + "/error", worker + "/ok"}
			if len(m.sweeps) != len(want) {
				t.Fatalf("sweeps = %v, want %v", m.sweeps, want)
			}
			for i := range want {
				if m.sweeps[i] != want[i] {
					t.Fatalf("sweeps = %v, want %v", m.sweeps, want)
				}
			}
			if len(m.rowsFail) != 3 {
				t.Fatalf("failed rows = %v, want 3 for %s", m.rowsFail, worker)
			}
		})
	}
}

// An upload refused by the storage.bytes reservation is counted once, at the
// upload, on the real FileService (the fake has no quota hook).
func TestDocumentUploadQuotaRejectIsCounted(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		realOnly(t, env)
		member := human(env.tn.member)
		created := env.createFile(t, member, "quota-metric.pdf", sizedPDF("quota-metric", 10<<10))
		m := &countingDocMetrics{}
		env.svc.SetMetrics(m)
		t.Cleanup(func() { env.svc.SetMetrics(nil) })

		body := sizedPDF("quota-metric-2", 20<<10)
		env.setStorageLimit(t, env.usage(t)+int64(len(body))-1)
		t.Cleanup(func() { env.setStorageLimit(t, 1<<40) })
		_, err := env.svc.UploadDocumentFile(context.Background(), member, created.Document.ID,
			DocumentUploadInput{Filename: "big.pdf", Body: bytes.NewReader(body)})
		wantCode(t, err, "quota_exceeded")
		if len(m.quota) != 1 || m.quota[0] != documentMetricKindFile {
			t.Fatalf("quota rejects = %v, want [file]", m.quota)
		}
		if len(m.saves) != 0 {
			t.Fatalf("an upload is not a save: saves = %v", m.saves)
		}
	})
}

// The wrapper is on the public command, not the private body: a save that
// wins and a save that loses the base race both land in the fake.
func TestDocumentSaveMetricsThroughUpdateDocument(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "dmet")
	metrics := &countingDocMetrics{}
	f.svc.SetMetrics(metrics)
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})

	content, err := json.Marshal(map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type": "paragraph",
				"content": []any{
					map[string]any{"type": "text", "text": "đo"},
				},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), d.ID, UpdateDocumentInput{Revision: 1, Content: content}); err != nil {
		t.Fatalf("first save: %v", err)
	}
	_, err = f.svc.UpdateDocument(f.ctx, Human(tn.aclOwner.ID), d.ID, UpdateDocumentInput{Revision: 1, Content: content})
	if !codedIs(err, "revision_conflict") {
		t.Fatalf("stale save = %v, want revision_conflict", err)
	}

	wantSaves := []string{"page/ok", "page/conflict"}
	if len(metrics.saves) != len(wantSaves) || metrics.saves[0] != wantSaves[0] || metrics.saves[1] != wantSaves[1] {
		t.Fatalf("saves = %v, want %v", metrics.saves, wantSaves)
	}
	if len(metrics.conflicts) != 1 || metrics.conflicts[0] != "page/revision_conflict" {
		t.Fatalf("conflicts = %v", metrics.conflicts)
	}
}
