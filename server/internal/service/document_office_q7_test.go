package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeQ7 is the server half of the Q7 closing test
// (docs/office/g1g2/q7-blocker.md) with a scripted engine, so it runs on the
// test database alone: the convert gate refuses before any mutation, Cancel
// creates nothing, Accept creates an OOXML copy with provenance, and the
// source and its history do not change. TestDocumentOfficeQ7Integration runs
// the same flow on the real engine container.

// q7Result is the result shape the engine's convert handler reports.
func q7Result(source, target string) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"operation": "convert", "source_format": source, "target_format": target,
		"fidelity": map[string]any{"level": "limited", "lost": []string{"cell_formatting"}},
		"content":  map[string]any{"sheets": []string{"Sheet1"}, "cells": map[string]string{"Sheet1!A1": "replaceMe"}},
	})
	return raw
}

// finishConvert plays the engine completing a convert job with its result.
func (e *scriptedEngine) finishConvert(t *testing.T, jobID string, body []byte, result json.RawMessage) {
	t.Helper()
	e.finish(t, jobID, body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	e.mu.Lock()
	defer e.mu.Unlock()
	e.jobs[jobID].result = result
}

func q7DocCount(t *testing.T, env *docStorageEnv) int {
	t.Helper()
	return copyDocCount(t, env)
}

func TestDocumentOfficeQ7(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		xls := mustReadFixture(t, "sheets/legacy-xls.xls")
		// The converted copy's bytes: a real SpreadsheetML package, so the
		// FileService sniff types it as xlsx without a filename.
		converted := blankXLSXSeed()

		newJobs := func(eng *scriptedEngine) *DocumentOfficeService {
			eng.fake = env.fake
			return NewDocumentOfficeService(DocumentOfficeOptions{
				Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc, MaxDeadline: time.Minute,
			})
		}
		convertOnly := func() *scriptedEngine {
			eng := newScriptedEngine()
			eng.bound = map[office.Operation]bool{office.OperationConvert: true}
			return eng
		}
		startConvert := func(t *testing.T, jobs *DocumentOfficeService, docID string) db.OfficeJob {
			t.Helper()
			row, err := jobs.StartOfficeJobForDocument(ctx, member, docID, OfficeJobRequest{
				Operation: string(office.OperationConvert), TargetFormat: string(office.FormatXLSX), IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "start convert")
			return row
		}

		t.Run("the convert gate refuses before any mutation", func(t *testing.T) {
			src := env.createFile(t, member, "gate.xls", xls)
			jobs := newJobs(convertOnly())
			refusals := []struct {
				name   string
				req    OfficeJobRequest
				code   string
				reason string
			}{
				{"open an xls in place", OfficeJobRequest{Operation: "open"}, "unsupported_operation", "not_bound"},
				{"convert without a target", OfficeJobRequest{Operation: "convert"}, "unsupported_operation", "convert_pair_not_bound"},
				{"convert to the wrong target", OfficeJobRequest{Operation: "convert", TargetFormat: "docx"}, "unsupported_operation", "convert_pair_not_bound"},
			}
			for _, r := range refusals {
				r.req.IdempotencyKey = util.NewID()
				_, err := jobs.StartOfficeJobForDocument(ctx, member, src.Document.ID, r.req)
				if ee := wantOfficeCode(t, err, r.code); ee.Reason != r.reason {
					t.Fatalf("%s: reason = %q, want %q", r.name, ee.Reason, r.reason)
				}
			}
			// An engine build that binds no convert:xls is refused by the
			// capability gate, before a row or an output intent exists.
			if _, err := newJobs(newScriptedEngine()).StartOfficeJobForDocument(ctx, member, src.Document.ID, OfficeJobRequest{
				Operation: "convert", TargetFormat: "xlsx", IdempotencyKey: util.NewID(),
			}); err == nil {
				t.Fatal("an engine without convert:xls started a conversion")
			} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "not_bound" {
				t.Fatalf("unbound convert reason = %q", ee.Reason)
			}
			// A drifting engine is refused by negotiation first.
			drift := convertOnly()
			drift.engineVersion = "genoffice@deadbeef+uniwork-office.9"
			if _, err := newJobs(drift).StartOfficeJobForDocument(ctx, member, src.Document.ID, OfficeJobRequest{
				Operation: "convert", TargetFormat: "xlsx", IdempotencyKey: util.NewID(),
			}); err == nil {
				t.Fatal("a drifting engine started a conversion")
			} else {
				wantOfficeCode(t, err, "engine_incompatible")
			}
			// A target on any other operation is a caller error.
			md := env.createFile(t, member, "target.md", []byte("# Nguon\n"))
			if _, err := newJobs(newScriptedEngine()).StartOfficeJobForDocument(ctx, member, md.Document.ID, OfficeJobRequest{
				Operation: "serialize", TargetFormat: "docx", IdempotencyKey: util.NewID(),
			}); !errors.Is(err, ErrOfficeJobInvalid) {
				t.Fatalf("serialize with a target = %v", err)
			}
			if n := env.officeJobRows(t, src.Document.ID) + env.officeJobRows(t, md.Document.ID); n != 0 {
				t.Fatalf("refused starts wrote %d job rows", n)
			}
		})

		t.Run("the convert envelope carries the source tuple and never a base revision", func(t *testing.T) {
			src := env.createFile(t, member, "envelope.xls", xls)
			eng := convertOnly()
			jobs := newJobs(eng)
			row := startConvert(t, jobs, src.Document.ID)
			if row.TargetFormat.String != "xlsx" || row.Format != "xls" || row.Operation != "convert" {
				t.Fatalf("convert row = %+v", row)
			}
			g := eng.grants[len(eng.grants)-1]
			if g.Operation != office.OperationConvert || g.Format != office.FormatXLS || g.BaseVersionID != src.Version.ID ||
				g.Input == nil || g.Input.Checksum != sha(xls) {
				t.Fatalf("convert grant = %+v", g)
			}
		})

		t.Run("cancel creates nothing", func(t *testing.T) {
			src := env.createFile(t, member, "cancel.xls", xls)
			eng := convertOnly()
			jobs := newJobs(eng)
			row := startConvert(t, jobs, src.Document.ID)
			eng.finishConvert(t, row.ID, converted, q7Result("xls", "xlsx"))
			if done, err := jobs.GetOfficeJob(ctx, member, env.tn.orgID, env.tn.wsA, row.ID); err != nil || done.State != "completed" {
				t.Fatalf("convert job = %+v, %v", done, err)
			}
			if _, err := jobs.CancelOfficeJobForDocument(ctx, member, src.Document.ID, row.ID); err != nil {
				t.Fatalf("cancel: %v", err)
			}
			before := q7DocCount(t, env)
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: row.ID, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "conversion_not_accepted"); ce.Fields["reason"] != "job_cancelled" {
				t.Fatalf("cancelled accept reason = %v", ce.Fields["reason"])
			}
			if after := q7DocCount(t, env); after != before {
				t.Fatal("a cancelled conversion created a document")
			}
			if got := env.job(t, row.ID); got.CommittedVersionID.Valid {
				t.Fatal("a cancelled conversion was claimed")
			}
		})

		t.Run("accept creates an OOXML copy with provenance; the source is unchanged", func(t *testing.T) {
			src := env.createFile(t, member, "budget.xls", xls)
			srcDoc := env.doc(t, src.Document.ID)
			eng := convertOnly()
			jobs := newJobs(eng)
			row := startConvert(t, jobs, src.Document.ID)
			eng.finishConvert(t, row.ID, converted, q7Result("xls", "xlsx"))
			done, err := jobs.GetOfficeJob(ctx, member, env.tn.orgID, env.tn.wsA, row.ID)
			mustf(t, err, "refresh")
			if done.State != "completed" || len(done.Result) == 0 {
				t.Fatalf("completed convert job carries no change list: %+v", done)
			}
			// The output never becomes a version of its source.
			if _, err := env.commit(member, src.Document.ID, done.OutputFileID.String, srcDoc.Revision, util.NewID()); err == nil {
				t.Fatal("a conversion output was committed onto its source")
			}
			key := util.NewID()
			copied, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: row.ID, IdempotencyKey: key,
			})
			mustf(t, err, "accept")
			d := copied.Document
			if d.ID == src.Document.ID || d.SourceDocumentID.String != src.Document.ID || d.SourceVersionID.String != src.Version.ID ||
				d.SourceRevision.Int64 != srcDoc.Revision || d.SourceChecksumSha256.String != sha(xls) ||
				d.SourceFormat.String != "application/vnd.ms-excel" ||
				d.TargetFormat.String != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
				d.ConversionReason.String != "convert" || d.SourceEngine.String != office.TrustedEngineVersion {
				t.Fatalf("conversion provenance = %+v", d)
			}
			if copied.Version.EngineVersion.String != office.TrustedEngineVersion || copied.Version.FileID.String != done.OutputFileID.String ||
				copied.Version.MimeType.String != d.TargetFormat.String || copied.File.Filename != "budget.xlsx" {
				t.Fatalf("copy version = %+v file = %+v", copied.Version, copied.File)
			}
			if got := env.read(t, member, d.ID, 0, DocumentByteRange{}); !bytes.Equal(got, converted) {
				t.Fatal("the copy does not hold the conversion output")
			}
			if got := env.job(t, row.ID); got.CommittedVersionID.String != copied.Version.ID {
				t.Fatalf("job committed to %q, want the copy's version", got.CommittedVersionID.String)
			}
			// Source and history untouched.
			after := env.doc(t, src.Document.ID)
			if after.Revision != srcDoc.Revision || after.FileVersionID != srcDoc.FileVersionID || len(env.versions(t, after)) != 1 {
				t.Fatalf("source changed: %+v", after)
			}
			if got := env.read(t, member, src.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, xls) {
				t.Fatal("source bytes changed")
			}
			if n := env.countAudit(t, "document.created", d.ID); n != 1 {
				t.Fatalf("copy audit rows = %d", n)
			}
			// The same key replays the same copy; a new key finds the job spent.
			replayed, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: row.ID, IdempotencyKey: key,
			})
			mustf(t, err, "replay")
			if replayed.Document.ID != d.ID {
				t.Fatal("replay created a second copy")
			}
			before := q7DocCount(t, env)
			_, err = env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: row.ID, IdempotencyKey: util.NewID(),
			})
			if ce := wantCode(t, err, "conversion_not_accepted"); ce.Fields["reason"] != "job_committed" {
				t.Fatalf("spent accept reason = %v", ce.Fields["reason"])
			}
			if q7DocCount(t, env) != before {
				t.Fatal("a spent conversion created a second copy")
			}
		})

		t.Run("accept is the creator's, inside the source's tenant, without leaks", func(t *testing.T) {
			src := env.createFile(t, member, "authz.xls", xls)
			other := env.createFile(t, member, "other.xls", xls)
			eng := convertOnly()
			jobs := newJobs(eng)
			row := startConvert(t, jobs, src.Document.ID)
			eng.finishConvert(t, row.ID, converted, q7Result("xls", "xlsx"))
			if _, err := jobs.GetOfficeJob(ctx, member, env.tn.orgID, env.tn.wsA, row.ID); err != nil {
				t.Fatal(err)
			}
			before := q7DocCount(t, env)
			accept := func(actor Actor, docID string) error {
				_, err := env.svc.CopyDocument(ctx, actor, docID, CopyDocumentInput{Consent: "copy", JobID: row.ID, IdempotencyKey: util.NewID()})
				return err
			}
			// Workspace admin can edit the source but did not start the job.
			if err := accept(human(env.tn.wsAdmin), src.Document.ID); !errors.Is(err, ErrForbidden) {
				t.Fatalf("non-creator accept = %v", err)
			}
			// Another document's path never finds this job.
			if err := accept(member, other.Document.ID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("accept on another document = %v", err)
			}
			// Outsiders are refused by the document gate before the job is read.
			for _, u := range []db.User{env.tn.bMember, env.tn.outsider} {
				if err := accept(human(u), src.Document.ID); !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
					t.Fatalf("outsider accept = %v", err)
				}
			}
			if q7DocCount(t, env) != before {
				t.Fatal("a refused accept created a document")
			}
			if got := env.job(t, row.ID); got.CommittedVersionID.Valid {
				t.Fatal("a refused accept claimed the job")
			}
		})

		t.Run("a job that is not a conversion is never accepted as one", func(t *testing.T) {
			src := env.createFile(t, member, "export.pdf", pdfBody("q7-export"))
			job := env.officeJob(t, member, env.doc(t, src.Document.ID), pdfBody("q7-out"), "completed")
			_, err := env.svc.CopyDocument(ctx, member, src.Document.ID, CopyDocumentInput{Consent: "copy", JobID: job.ID, IdempotencyKey: util.NewID()})
			wantCode(t, err, "conversion_not_accepted")
		})
	})
}

// TestDocumentOfficeEngineRollback: a version a newer engine build committed
// is not opened by this build (engine_incompatible, no job row), capability
// withdraws every engine action for it, and download plus restore of an
// older version stay available.
func TestDocumentOfficeEngineRollback(t *testing.T) {
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		ctx := context.Background()
		member := human(env.tn.member)
		const newer = "genoffice@ffffffff+uniwork-office.9"
		jobs := NewDocumentOfficeService(DocumentOfficeOptions{
			Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: newScriptedEngine(), Documents: env.svc, MaxDeadline: time.Minute,
		})

		v1 := []byte("# Ban goc\n")
		v2 := []byte("# Ban cua engine moi\n")
		src := env.createFile(t, member, "rollback.md", v1)
		up := env.upload(t, member, src.Document.ID, "rollback.md", v2)
		committed, err := env.commit(member, src.Document.ID, up.UploadID, src.Document.Revision, util.NewID())
		mustf(t, err, "commit v2")
		// Stamp v2 as the newer build's output: the state a rollback of the
		// engine pin leaves behind.
		if _, err := env.f.pool.Exec(ctx, `UPDATE document_versions SET engine_name = 'genoffice', engine_version = $2 WHERE id = $1`,
			committed.Version.ID, newer); err != nil {
			t.Fatal(err)
		}

		_, err = jobs.StartOfficeJobForDocument(ctx, member, src.Document.ID, OfficeJobRequest{Operation: "open", IdempotencyKey: util.NewID()})
		if ee := wantOfficeCode(t, err, "engine_incompatible"); ee.Reason != "version_engine:"+newer {
			t.Fatalf("rollback refusal reason = %q", ee.Reason)
		}
		if n := env.officeJobRows(t, src.Document.ID); n != 0 {
			t.Fatalf("an unreadable version wrote %d job rows", n)
		}
		caps, err := jobs.Capability(ctx, member, src.Document.ID)
		mustf(t, err, "capability")
		for _, row := range caps.Operations {
			if row.Operation == officeBlankOperation {
				continue
			}
			if row.ProductSupported {
				t.Fatalf("capability row %s still supported on an unreadable version: %+v", row.Operation, row)
			}
		}
		if row := capabilityRow(t, caps, "edit"); !row.EngineBound {
			t.Fatalf("the build's own binding must stay visible: %+v", row)
		}
		// Download and history stay: both versions read back.
		if got := env.read(t, member, src.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, v2) {
			t.Fatal("the unreadable version is not downloadable")
		}
		if got := env.read(t, member, src.Document.ID, 1, DocumentByteRange{}); !bytes.Equal(got, v1) {
			t.Fatal("the older committed version does not read back")
		}
		// Recovery: restoring the version this build wrote reopens it.
		restored, err := env.svc.RestoreFileVersion(ctx, member, src.Document.ID, RestoreFileVersionInput{
			Version: 1, BaseRevision: env.doc(t, src.Document.ID).Revision, IdempotencyKey: util.NewID(),
		})
		mustf(t, err, "restore v1")
		if restored.Version.EngineVersion.String != "" {
			t.Fatalf("restore carried an engine stamp: %+v", restored.Version)
		}
		if _, err := jobs.StartOfficeJobForDocument(ctx, member, src.Document.ID, OfficeJobRequest{Operation: "open", IdempotencyKey: util.NewID()}); err != nil {
			t.Fatalf("open after restore: %v", err)
		}
		if !office.CanReadEngineVersion("") || !office.CanReadEngineVersion(office.TrustedEngineVersion) || office.CanReadEngineVersion(newer) {
			t.Fatal("CanReadEngineVersion table drifted")
		}
	})
}
