package service

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// This exercises the real document ACL, job rows and FileService backends.
// The scripted engine proves permission and storage behavior, not native OPEN
// model fidelity: its PDF output keeps the real storage MIME validator active.
func TestDocumentOfficeViewerOpen(t *testing.T) {
	ctx := context.Background()
	forEachDocStorageBackend(t, func(t *testing.T, env *docStorageEnv) {
		for _, route := range []string{"direct", "document wrapper"} {
			t.Run(route, func(t *testing.T) {
				editor := human(env.tn.member)
				viewer := human(env.tn.creator)
				base := pdfBody("viewer-base-" + util.NewID())
				created := env.createFile(t, editor, "viewer.pdf", base)
				if _, err := env.f.pool.Exec(ctx,
					`UPDATE documents SET visibility = 'restricted' WHERE id = $1`, created.Document.ID); err != nil {
					t.Fatal(err)
				}
				doc := env.doc(t, created.Document.ID)
				env.f.share(t, doc, DocumentPrincipalUser, viewer.ID, DocumentLevelView, editor.ID)
				otherViewer := human(env.tn.outsider)
				env.f.share(t, doc, DocumentPrincipalUser, otherViewer.ID, DocumentLevelView, editor.ID)
				versions := env.versions(t, doc)
				audits, outbox := officeViewerEventCounts(t, env, doc.ID)
				storageBeforeOpen := officeViewerStorageState(t, env)
				eng := newScriptedEngine()
				eng.fake = env.fake
				jobs := NewDocumentOfficeService(DocumentOfficeOptions{
					Pool: env.f.pool, Queries: env.f.q, Files: env.fs, Engine: eng, Documents: env.svc,
					MaxDeadline: time.Minute,
				})
				input := func() OfficeJobInput {
					return OfficeJobInput{
						OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
						BaseVersionID: doc.FileVersionID.String, BaseRevision: doc.Revision,
						Operation: office.OperationOpen, Format: office.FormatPDF, IdempotencyKey: util.NewID(),
					}
				}
				start := func(actor Actor, in OfficeJobInput) (db.OfficeJob, error) {
					if route == "direct" {
						return jobs.StartOfficeJob(ctx, actor, in)
					}
					// The HTTP path already trims operation strings; include that
					// spelling to prove the new gate uses the same OPEN identity.
					return jobs.StartOfficeJobForDocument(ctx, actor, in.DocumentID, OfficeJobRequest{
						Operation: " " + string(in.Operation) + " ", Format: string(in.Format),
						BaseRevision: in.BaseRevision, HasBaseRevision: true, IdempotencyKey: in.IdempotencyKey,
						DocumentModelRef: in.DocumentModelRef, Edits: in.Edits,
						TargetFormat: string(in.TargetFormat), Deadline: in.Deadline,
					})
				}
				refused := func(t *testing.T, actor Actor, in OfficeJobInput, want error) error {
					t.Helper()
					rows := env.officeJobRows(t, in.DocumentID)
					storage := officeViewerStorageState(t, env)
					eng.mu.Lock()
					grants := len(eng.grants)
					eng.mu.Unlock()
					row, err := start(actor, in)
					if err == nil || row.ID != "" || (want != nil && !errors.Is(err, want)) {
						t.Fatalf("refused submission = %+v, %v; want %v", row, err, want)
					}
					if env.officeJobRows(t, in.DocumentID) != rows || !reflect.DeepEqual(storage, officeViewerStorageState(t, env)) {
						t.Fatal("refused submission reserved an output or inserted a job")
					}
					eng.mu.Lock()
					defer eng.mu.Unlock()
					if len(eng.grants) != grants {
						t.Fatal("refused submission dispatched an engine grant")
					}
					return err
				}

				open := input()
				row, err := start(viewer, open)
				mustf(t, err, "viewer OPEN")
				if row.Operation != string(office.OperationOpen) || row.State != "running" ||
					row.CreatedBy != viewer.ID || row.CreatedByKind != "human" || !row.OutputFileID.Valid {
					t.Fatalf("viewer job = %+v", row)
				}
				eng.mu.Lock()
				if len(eng.grants) != 1 {
					eng.mu.Unlock()
					t.Fatal("OPEN did not dispatch exactly one grant")
				}
				grant := eng.grants[0]
				eng.mu.Unlock()
				if grant.ActorID != viewer.ID || grant.ActorKind != "human" || grant.Operation != office.OperationOpen ||
					grant.DocumentID != doc.ID || grant.BaseVersionID != doc.FileVersionID.String ||
					grant.BaseRevision != doc.Revision || grant.Input == nil || grant.Input.Checksum != sha(base) ||
					grant.Input.Length != int64(len(base)) || grant.Output == nil || grant.Output.FileID != row.OutputFileID.String {
					t.Fatalf("viewer grant lost its actor or base binding: %+v", grant)
				}
				if env.officeJobRows(t, doc.ID) != 1 || reflect.DeepEqual(storageBeforeOpen, officeViewerStorageState(t, env)) {
					t.Fatal("OPEN did not create its single transient job/output")
				}
				storageAfterOpen := officeViewerStorageState(t, env)
				assertReplay := func() {
					t.Helper()
					again, err := start(viewer, open)
					mustf(t, err, "same-actor OPEN replay")
					if again.ID != row.ID || again.GrantID != row.GrantID || again.OutputFileID != row.OutputFileID ||
						env.officeJobRows(t, doc.ID) != 1 || !reflect.DeepEqual(storageAfterOpen, officeViewerStorageState(t, env)) {
						t.Fatal("replay replaced the job, grant or output")
					}
					eng.mu.Lock()
					defer eng.mu.Unlock()
					if len(eng.grants) != 1 {
						t.Fatal("replay dispatched another grant")
					}
				}
				assertReplay()
				for _, actor := range []Actor{editor, otherViewer} {
					if err := refused(t, actor, open, nil); office.ErrorCode(err) != "job_conflict" {
						t.Fatalf("cross-actor replay = %v, want job_conflict", err)
					}
				}
				changed := open
				changed.DocumentModelRef = "different-payload"
				if err := refused(t, viewer, changed, nil); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
					t.Fatalf("changed replay = %v, want payload_fingerprint_mismatch", err)
				}

				for _, op := range []office.Operation{
					office.OperationEdit, office.OperationSerialize, office.OperationConvert, office.OperationExport,
					office.OperationCapability, "unknown", "", "OPEN",
				} {
					t.Run("viewer refuses "+string(op), func(t *testing.T) {
						in := input()
						in.Operation = op
						var want error
						if op == office.OperationEdit || op == office.OperationSerialize || op == office.OperationConvert {
							want = ErrForbidden
						}
						// Export and malformed direct input legitimately fail
						// validation before ACL; every path must refuse without writes.
						refused(t, viewer, in, want)
					})
				}
				for _, actor := range []struct {
					name  string
					actor Actor
				}{
					{"stranger", human(env.tn.bMember)},
					{"agent", agentActor(env.tn.agent)},
					{"anonymous", Actor{}},
				} {
					t.Run(actor.name+" refuses OPEN", func(t *testing.T) {
						refused(t, actor.actor, input(), nil)
					})
				}
				// Agents are refused even on a document whose ACL grants view.
				workspaceDoc := env.createFile(t, editor, "agent-view.pdf", pdfBody("agent-view-"+util.NewID())).Document
				agentInput := input()
				agentInput.DocumentID = workspaceDoc.ID
				agentInput.BaseVersionID = workspaceDoc.FileVersionID.String
				agentInput.BaseRevision = workspaceDoc.Revision
				refused(t, agentActor(env.tn.agent), agentInput, ErrForbidden)
				for _, bad := range []struct {
					name   string
					change func(*OfficeJobInput)
				}{
					{"edits", func(in *OfficeJobInput) { in.Edits = []office.EditOp{{Op: "set_cell"}} }},
					{"target", func(in *OfficeJobInput) { in.TargetFormat = office.FormatDOCX }},
					{"format override", func(in *OfficeJobInput) { in.Format = office.FormatMD }},
					{"revision override", func(in *OfficeJobInput) { in.BaseRevision++ }},
				} {
					t.Run("OPEN refuses "+bad.name, func(t *testing.T) {
						in := input()
						bad.change(&in)
						refused(t, viewer, in, nil)
					})
				}
				if _, err := jobs.CancelOfficeJob(ctx, viewer, doc.OrganizationID, doc.WorkspaceID, row.ID); !errors.Is(err, ErrForbidden) {
					t.Fatalf("viewer cancel = %v, want forbidden", err)
				}
				if _, err := jobs.CancelOfficeJobForDocument(ctx, viewer, doc.ID, row.ID); !errors.Is(err, ErrForbidden) {
					t.Fatalf("viewer wrapper cancel = %v, want forbidden", err)
				}
				eng.mu.Lock()
				cancels := eng.cancels
				eng.mu.Unlock()
				if cancels != 0 || env.job(t, row.ID).State != "running" {
					t.Fatal("viewer cancel reached the engine or changed the job")
				}

				output := pdfBody("viewer-model-" + util.NewID())
				eng.finish(t, row.ID, output, "application/pdf")
				done, err := jobs.OfficeJob(ctx, viewer, doc.ID, row.ID)
				mustf(t, err, "viewer completed status")
				if done.State != "completed" || done.OutputChecksum.String != sha(output) {
					t.Fatalf("viewer status = %+v", done)
				}
				reader, err := jobs.OpenOfficeJobOutput(ctx, viewer, doc.ID, row.ID)
				mustf(t, err, "viewer output read")
				got := readBytes(t, reader.Body)
				mustf(t, reader.Close(), "close viewer output")
				if !bytes.Equal(got, output) {
					t.Fatal("viewer output does not serve the verified bytes")
				}
				storageAfterOpen = officeViewerStorageState(t, env)
				assertReplay()
				_, err = env.commit(viewer, doc.ID, done.OutputFileID.String, doc.Revision, util.NewID())
				if !errors.Is(err, ErrForbidden) {
					t.Fatalf("viewer commit = %v, want forbidden", err)
				}
				if env.job(t, row.ID).CommittedVersionID.Valid || !reflect.DeepEqual(storageAfterOpen, officeViewerStorageState(t, env)) {
					t.Fatal("viewer commit claimed or replaced the transient output")
				}
				if env.real != nil && env.sessionStatus(t, done.OutputFileID.String) != "staged" {
					t.Fatal("OPEN output must remain staged")
				}
				if current := env.doc(t, doc.ID); !reflect.DeepEqual(current, doc) || !reflect.DeepEqual(env.versions(t, current), versions) {
					t.Fatal("OPEN or a refused mutation changed the document or its versions")
				}
				if !bytes.Equal(env.read(t, viewer, doc.ID, 0, DocumentByteRange{}), base) {
					t.Fatal("OPEN or a refused mutation changed the base bytes")
				}
				if gotAudits, gotOutbox := officeViewerEventCounts(t, env, doc.ID); gotAudits != audits || gotOutbox != outbox {
					t.Fatal("OPEN or a refused mutation wrote a business audit/outbox event")
				}
			})
		}
	})
}

// Snapshot every fake file, or count tenant file/session rows on real storage,
// so even an unattached provider reservation makes a refused request fail.
func officeViewerStorageState(t *testing.T, env *docStorageEnv) any {
	t.Helper()
	if env.fake != nil {
		return env.fake.Snapshot()
	}
	var state struct {
		Files    int
		Sessions int
	}
	if err := env.f.pool.QueryRow(context.Background(),
		`SELECT (SELECT count(*) FROM files WHERE organization_id = $1),
		        (SELECT count(*) FROM file_upload_sessions WHERE organization_id = $1)`,
		env.tn.orgID).Scan(&state.Files, &state.Sessions); err != nil {
		t.Fatal(err)
	}
	return state
}

func officeViewerEventCounts(t *testing.T, env *docStorageEnv, documentID string) (int, int) {
	t.Helper()
	var audits, outbox int
	if err := env.f.pool.QueryRow(context.Background(),
		`SELECT (SELECT count(*) FROM audit_events WHERE resource_id = $1),
		        (SELECT count(*) FROM outbox_events WHERE payload::jsonb->>'document_id' = $1)`,
		documentID).Scan(&audits, &outbox); err != nil {
		t.Fatal(err)
	}
	return audits, outbox
}
