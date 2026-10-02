package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The always-on half of the job lifecycle tests: a scripted engine that
// implements OfficeEngine, so the CAS races run deterministically and the
// suite needs only the test database (it runs in CI). The same behaviour is
// proven against the real engine container in TestDocumentOfficeJob.

type scriptedJob struct {
	state  office.JobState
	fileID string
	target files.WriteTarget
	sum    string
	length int64
	err    *office.JobError
	// result is the operation result a convert job reports (G2-07b).
	result json.RawMessage
}

type scriptedEngine struct {
	mu        sync.Mutex
	key       []byte
	jobs      map[string]*scriptedJob
	grants    []office.ServiceGrant
	submitErr error
	lost      bool
	gate      chan struct{}
	// statusCalls, when non-nil, receives one signal per Status entry so a
	// race test waits for "the refresh is inside Status" instead of a sleep.
	statusCalls chan struct{}
	// fake, when set, stands in for storage on fake:// write targets; nil
	// means every output goes to the grant's URL (bridge or signed).
	fake    *filesfake.Fake
	cancels int
	// bound overrides which operations the capability answer marks supported;
	// engineVersion and capabilityErr drive the negotiation tests.
	bound         map[office.Operation]bool
	engineVersion string
	capabilityErr error
}

func newScriptedEngine() *scriptedEngine {
	return &scriptedEngine{key: []byte(officeDevKey), jobs: map[string]*scriptedJob{}}
}

func (e *scriptedEngine) Sign(g office.ServiceGrant) (string, error) {
	return office.SignGrant(g, e.key)
}

func (e *scriptedEngine) status(id string) office.JobStatus {
	j := e.jobs[id]
	js := office.JobStatus{JobID: id, State: j.state, OutputFileID: j.fileID, OutputChecksum: j.sum, Error: j.err, Result: j.result}
	if j.state == office.JobCompleted {
		n := j.length
		js.OutputLength = &n
	}
	return js
}

func (e *scriptedEngine) Submit(_ context.Context, token string, env office.Envelope) (office.JobStatus, error) {
	g, err := office.VerifyGrant(token, e.key)
	if err != nil {
		return office.JobStatus{}, office.NewEngineError("grant_scope", "signature")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.submitErr != nil {
		return office.JobStatus{}, e.submitErr
	}
	e.grants = append(e.grants, g)
	if _, ok := e.jobs[g.JobID]; !ok {
		e.jobs[g.JobID] = &scriptedJob{state: office.JobRunning, fileID: g.Output.FileID, target: files.WriteTarget{
			URL: g.Output.URL, Method: g.Output.Method, Headers: g.Output.Headers,
			ExpiresAt: time.UnixMilli(g.Output.ExpiresAt),
		}}
	}
	if env.GrantID != g.GrantID {
		return office.JobStatus{}, office.NewEngineError("grant_scope", "grant_id")
	}
	return e.status(g.JobID), nil
}

// finish plays the engine completing: it PUTs the output to the grant's
// write target - the bridge listener for the fake, the signed URL for a real
// FileService backend - and reports completed.
func (e *scriptedEngine) finish(t *testing.T, jobID string, body []byte, contentType string) {
	t.Helper()
	e.mu.Lock()
	j := e.jobs[jobID]
	e.mu.Unlock()
	if e.fake != nil {
		if err := e.fake.WriteProviderOutput(files.ProviderOutput{FileID: files.FileID(j.fileID)}, body, contentType); err != nil {
			t.Fatal(err)
		}
	} else {
		putWriteTarget(t, j.target, body, contentType)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	sum := sha256.Sum256(body)
	j.state, j.sum, j.length = office.JobCompleted, hex.EncodeToString(sum[:]), int64(len(body))
}

func (e *scriptedEngine) fail(jobID string, state office.JobState, code, reason string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.jobs[jobID].state = state
	e.jobs[jobID].err = &office.JobError{Code: code, Reason: reason}
}

func (e *scriptedEngine) Status(_ context.Context, jobID, token string) (office.JobStatus, error) {
	if _, err := office.VerifyGrant(token, e.key); err != nil {
		return office.JobStatus{}, office.NewEngineError("grant_scope", "signature")
	}
	e.mu.Lock()
	gate := e.gate
	entered := e.statusCalls
	e.mu.Unlock()
	if entered != nil {
		entered <- struct{}{}
	}
	if gate != nil {
		<-gate
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.jobs[jobID]; !ok || e.lost {
		return office.JobStatus{}, office.NewEngineError("not_found", "")
	}
	return e.status(jobID), nil
}

func (e *scriptedEngine) Cancel(_ context.Context, jobID, _ string) (office.JobStatus, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.cancels++
	j, ok := e.jobs[jobID]
	if !ok {
		return office.JobStatus{}, office.NewEngineError("not_found", "")
	}
	if j.state == office.JobRunning || j.state == office.JobAccepted {
		j.state = office.JobCancelled
	}
	return e.status(jobID), nil
}

func (e *scriptedEngine) Ready(context.Context) (office.Readiness, error) {
	return office.Readiness{Status: "ready", QueueDepth: 3}, nil
}

// Capability answers the identity the service negotiates against and the
// operations this double binds: open/edit/serialize (the ops the lifecycle
// tests submit). A test that needs a refusal sets bound + capabilityErr.
func (e *scriptedEngine) Capability(_ context.Context, format office.Format) (office.CapabilityResult, error) {
	if e.capabilityErr != nil {
		return office.CapabilityResult{}, e.capabilityErr
	}
	bound := e.bound
	if bound == nil {
		bound = map[office.Operation]bool{office.OperationOpen: true, office.OperationEdit: true, office.OperationSerialize: true}
	}
	rows := make([]office.CapabilityEntry, 0, len(bound))
	for _, op := range []office.Operation{office.OperationCapability, office.OperationOpen, office.OperationEdit, office.OperationSerialize, office.OperationConvert, office.OperationExport} {
		rows = append(rows, office.CapabilityEntry{
			Operation: string(op), Supported: bound[op], Runtime: office.RuntimeInternalService, EvidenceLevel: office.EvidenceProven,
		})
	}
	version := office.TrustedEngineVersion
	if e.engineVersion != "" {
		version = e.engineVersion
	}
	return office.CapabilityResult{EngineVersion: version, Format: format, Capabilities: rows}, nil
}

type countingMetrics struct {
	mu       sync.Mutex
	outcomes []string
	ready    []bool
	depth    []int
}

func (m *countingMetrics) ObserveOfficeJob(_ string, outcome string, _ time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.outcomes = append(m.outcomes, outcome)
}

func (m *countingMetrics) SetOfficeEngine(ready bool, depth int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ready = append(m.ready, ready)
	m.depth = append(m.depth, depth)
}

func TestDocumentOfficeLifecycle(t *testing.T) {
	ctx := context.Background()
	body := []byte("# out\n")

	t.Run("the dispatch grant binds actor, scope, base, input, output and deadline", func(t *testing.T) {
		f := newOfficeFixture(t, "bind me\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-bind"))
		if err != nil {
			t.Fatal(err)
		}
		if len(eng.grants) != 1 {
			t.Fatalf("grants: %d", len(eng.grants))
		}
		g := eng.grants[0]
		sum := sha256.Sum256([]byte("bind me\n"))
		if g.JobID != row.ID || g.GrantID != row.GrantID || g.ActorID != f.actor.ID || g.ActorKind != "human" ||
			g.OrganizationID != f.org || g.WorkspaceID != f.ws || g.DocumentID != f.doc ||
			g.BaseVersionID != f.ver || g.BaseRevision != f.rev || g.Operation != office.OperationSerialize ||
			g.Input == nil || g.Input.Checksum != hex.EncodeToString(sum[:]) || g.Output == nil ||
			g.Output.FileID != row.OutputFileID.String || g.DeadlineAt != row.DeadlineAt.Time.UnixMilli() ||
			g.ExpiresAt > g.DeadlineAt {
			t.Fatalf("grant does not bind the job: %+v", g)
		}
		if row.State != "running" || !row.DispatchedAt.Valid {
			t.Fatalf("row after dispatch: %+v", row)
		}
	})

	t.Run("a same-key retry after the output was committed replays the committed job", func(t *testing.T) {
		f := newOfficeFixture(t, "commit me\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-committed"))
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, body, "text/markdown")
		done, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || done.State != "completed" {
			t.Fatalf("complete: %+v %v", done, err)
		}
		newVersion := util.NewID()
		if _, err := svc.ClaimOfficeJobOutputInTx(ctx, f.q, f.org, f.ws, row.ID, newVersion); err != nil {
			t.Fatal(err)
		}
		// What the G1-03 commit does to the document: a new revision and
		// current version. The base the job named is no longer current.
		if _, err := f.pool.Exec(ctx, `UPDATE documents SET revision = revision + 1, file_version_id = $1 WHERE id = $2`, newVersion, f.doc); err != nil {
			t.Fatal(err)
		}
		again, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-committed"))
		if err != nil || again.ID != row.ID || again.CommittedVersionID.String != newVersion {
			t.Fatalf("committed replay: %+v %v", again, err)
		}
		changed := f.input("k-committed")
		changed.DocumentModelRef = "other"
		if _, err := svc.StartOfficeJob(ctx, f.actor, changed); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("changed payload after commit: %v", err)
		}
		if len(eng.grants) != 1 {
			t.Fatalf("replay dispatched again: %d grants", len(eng.grants))
		}
	})

	t.Run("cancel wins against a completion the engine reports late", func(t *testing.T) {
		f := newOfficeFixture(t, "race\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-race"))
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, body, "text/markdown") // the engine is done and the object exists
		eng.mu.Lock()
		eng.gate = make(chan struct{})
		eng.statusCalls = make(chan struct{}, 8)
		gate := eng.gate
		eng.mu.Unlock()
		refreshed := make(chan db.OfficeJob)
		go func() {
			r, _ := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID) // blocks inside Status
			refreshed <- r
		}()
		<-eng.statusCalls // the refresh is inside Status, parked on the gate
		cancelled, err := svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || cancelled.State != "cancelled" {
			t.Fatalf("cancel: %+v %v", cancelled, err)
		}
		close(gate)
		late := <-refreshed
		if late.State != "cancelled" {
			t.Fatalf("late completion overwrote the cancel: %+v", late)
		}
		if _, err := svc.ClaimOfficeJobOutputInTx(ctx, f.q, f.org, f.ws, row.ID, util.NewID()); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("cancelled output committable: %v", err)
		}
	})

	t.Run("provider output cancellation settles as a retryable commit failure", func(t *testing.T) {
		f := newOfficeFixture(t, "output cancellation\n")
		eng := newScriptedEngine()
		eng.fake = f.files.Fake
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-output-canceled"))
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, body, "text/markdown")
		if err := f.files.CancelUpload(ctx, files.CancelInput{
			Actor:  audit.User(f.actor.ID),
			Scope:  files.Scope{OrganizationID: f.org, WorkspaceID: f.ws},
			FileID: files.FileID(row.OutputFileID.String),
		}); err != nil {
			t.Fatalf("cancel provider output: %v", err)
		}
		done, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil {
			t.Fatal(err)
		}
		if done.State != string(office.JobFailed) || done.ErrorCode.String != "commit_failed" || done.ErrorReason.String != "output_upload_canceled" {
			t.Fatalf("canceled output job = %+v", done)
		}
	})

	t.Run("commit and cancel of a completed job: whichever lands first is final", func(t *testing.T) {
		f := newOfficeFixture(t, "order\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		first, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-commit-first"))
		eng.finish(t, first.ID, body, "text/markdown")
		if _, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, first.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ClaimOfficeJobOutputInTx(ctx, f.q, f.org, f.ws, first.ID, util.NewID()); err != nil {
			t.Fatal(err)
		}
		after, err := svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, first.ID)
		if err != nil || after.State != "completed" {
			t.Fatalf("cancel after commit: %+v %v", after, err)
		}

		docID, verID, rev := f.seedDocument(t, "order 2\n")
		in := f.input("k-cancel-first")
		in.DocumentID, in.BaseVersionID, in.BaseRevision = docID, verID, rev
		second, _ := svc.StartOfficeJob(ctx, f.actor, in)
		eng.finish(t, second.ID, body, "text/markdown")
		if _, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, second.ID); err != nil {
			t.Fatal(err)
		}
		if c, err := svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, second.ID); err != nil || c.State != "cancelled" {
			t.Fatalf("cancel of completed-uncommitted: %+v %v", c, err)
		}
		if _, err := svc.ClaimOfficeJobOutputInTx(ctx, f.q, f.org, f.ws, second.ID, util.NewID()); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("commit after cancel: %v", err)
		}
	})

	t.Run("a retryable dispatch refusal keeps the job for the same key; a final one settles it", func(t *testing.T) {
		f := newOfficeFixture(t, "busy\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		for _, cause := range []error{office.NewEngineError("engine_overloaded", "queue_full"), office.ErrServiceAuth} {
			eng.submitErr = cause
			key := "k-busy-" + office.ErrorCode(cause)
			row, err := svc.StartOfficeJob(ctx, f.actor, f.input(key))
			if !errors.Is(err, cause) && office.ErrorCode(err) != office.ErrorCode(cause) {
				t.Fatalf("%v: %v", cause, err)
			}
			if row.State != "accepted" || row.DispatchedAt.Valid {
				t.Fatalf("%v: row %+v", cause, row)
			}
			eng.submitErr = nil
			again, err := svc.StartOfficeJob(ctx, f.actor, f.input(key))
			if err != nil || again.ID != row.ID || again.GrantID != row.GrantID || again.State != "running" {
				t.Fatalf("%v: redispatch %+v %v", cause, again, err)
			}
			eng.finish(t, row.ID, body, "text/markdown")
			if done, _ := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID); done.State != "completed" {
				t.Fatalf("%v: %+v", cause, done)
			}
		}
		eng.submitErr = office.NewEngineError("unsupported_operation", "not_bound")
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-final"))
		if office.ErrorCode(err) != "unsupported_operation" || row.State != "failed" || row.ErrorCode.String != "unsupported_operation" {
			t.Fatalf("final refusal: %+v %v", row, err)
		}
		eng.submitErr = nil
		again, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-final"))
		if err != nil || again.ID != row.ID || again.State != "failed" {
			t.Fatalf("retry of a failed key: %+v %v", again, err)
		}
	})

	t.Run("engine outcomes map onto the row", func(t *testing.T) {
		f := newOfficeFixture(t, "outcomes\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		cases := []struct {
			state        office.JobState
			code, reason string
			wantState    string
			wantCode     string
		}{
			{office.JobFailed, "engine_crashed", "memory_limit", "failed", "engine_crashed"},
			{office.JobCrashed, "engine_crashed", "signal_SIGKILL", "failed", "engine_crashed"},
			{office.JobTimedOut, "engine_timeout", "cpu_limit", "timed_out", "engine_timeout"},
			{office.JobCancelled, "engine_cancelled", "cancel_requested", "cancelled", "engine_cancelled"},
		}
		for i, tc := range cases {
			docID, verID, rev := f.seedDocument(t, "outcome "+tc.reason+"\n")
			in := f.input("k-outcome-" + tc.reason)
			in.DocumentID, in.BaseVersionID, in.BaseRevision = docID, verID, rev
			row, err := svc.StartOfficeJob(ctx, f.actor, in)
			if err != nil {
				t.Fatal(err)
			}
			eng.fail(row.ID, tc.state, tc.code, tc.reason)
			got, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
			if err != nil || got.State != tc.wantState || got.ErrorCode.String != tc.wantCode {
				t.Fatalf("case %d: %+v %v", i, got, err)
			}
		}
	})

	t.Run("an engine that lost the job settles from the provider-output intent", func(t *testing.T) {
		f := newOfficeFixture(t, "lost\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		lost, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-lost"))
		docID, verID, rev := f.seedDocument(t, "written\n")
		in := f.input("k-written")
		in.DocumentID, in.BaseVersionID, in.BaseRevision = docID, verID, rev
		written, _ := svc.StartOfficeJob(ctx, f.actor, in)
		eng.finish(t, written.ID, body, "text/markdown")
		eng.mu.Lock()
		eng.lost = true
		eng.mu.Unlock()
		n, err := f.service(eng).ReconcileOfficeJobs(ctx) // a restarted Go process
		if err != nil || n != 2 {
			t.Fatalf("reconcile: %d %v", n, err)
		}
		a, _ := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, lost.ID)
		b, _ := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, written.ID)
		sum := sha256.Sum256(body)
		if a.State != "failed" || a.ErrorReason.String != "engine_lost_job" || b.State != "completed" || b.OutputChecksum.String != hex.EncodeToString(sum[:]) {
			t.Fatalf("lost=%+v written=%+v", a, b)
		}
	})

	t.Run("Go's clock times out a job the engine keeps running, and tells the engine", func(t *testing.T) {
		f := newOfficeFixture(t, "slow\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-slow"))
		f.offset.Store(int64(time.Minute))
		done, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || done.State != "timed_out" || eng.cancels != 1 {
			t.Fatalf("go deadline: %+v %v cancels=%d", done, err, eng.cancels)
		}
	})

	t.Run("export is refused before a row or an output intent exists", func(t *testing.T) {
		f := newOfficeFixture(t, "export\n")
		svc := f.service(newScriptedEngine())
		in := f.input("k-export")
		in.Operation = office.OperationExport
		if _, err := svc.StartOfficeJob(ctx, f.actor, in); office.ErrorCode(err) != "unsupported_operation" {
			t.Fatalf("export: %v", err)
		}
		if _, err := f.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{OrganizationID: f.org, WorkspaceID: f.ws, IdempotencyKey: "k-export"}); err == nil {
			t.Fatal("export persisted a job")
		}
	})

	t.Run("office commands take the document ACL, not workspace membership", func(t *testing.T) {
		f := newOfficeFixture(t, "acl\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		if _, err := f.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, f.doc); err != nil {
			t.Fatal(err)
		}
		// A stranger never reaches a job: the document is not found for them.
		editInput := f.input("k-acl-none")
		editInput.Operation = office.OperationEdit
		editInput.Edits = []office.EditOp{{Op: "set_cell"}}
		if _, err := svc.StartOfficeJob(ctx, human(f.tn.bMember), editInput); !errors.Is(err, ErrNotFound) {
			t.Fatalf("stranger submit: %v", err)
		}
		// A viewer may read a job's status but may neither submit edits nor cancel.
		docRow, err := f.q.GetDocumentByID(ctx, f.doc)
		if err != nil {
			t.Fatal(err)
		}
		f.pf.share(t, docRow, DocumentPrincipalUser, f.tn.creator.ID, DocumentLevelView, f.tn.member.ID)
		viewer := human(f.tn.creator)
		viewerEdit := f.input("k-acl-view")
		viewerEdit.Operation = office.OperationEdit
		viewerEdit.Edits = []office.EditOp{{Op: "set_cell"}}
		if _, err := svc.StartOfficeJob(ctx, viewer, viewerEdit); !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer submit: %v", err)
		}
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-acl-edit"))
		if err != nil {
			t.Fatalf("editor submit: %v", err)
		}
		if _, err := svc.GetOfficeJob(ctx, viewer, f.org, f.ws, row.ID); err != nil {
			t.Fatalf("viewer status: %v", err)
		}
		if _, err := svc.CancelOfficeJob(ctx, viewer, f.org, f.ws, row.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("viewer cancel: %v", err)
		}
		// Agents and anonymous actors never reach an office command.
		if _, err := svc.StartOfficeJob(ctx, agentActor(f.tn.agent), f.input("k-acl-agent")); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent submit: %v", err)
		}
		if _, err := svc.GetOfficeJob(ctx, agentActor(f.tn.agent), f.org, f.ws, row.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent status: %v", err)
		}
	})

	t.Run("edit payloads are bounded and operation-scoped before storage", func(t *testing.T) {
		f := newOfficeFixture(t, "edit validation\n")
		svc := f.service(newScriptedEngine())
		badOp := f.input("k-edit-empty-op")
		badOp.Operation = office.OperationEdit
		badOp.Edits = []office.EditOp{{}}
		if _, err := svc.StartOfficeJob(ctx, f.actor, badOp); !errors.Is(err, ErrOfficeJobInvalid) {
			t.Fatalf("empty edit op = %v", err)
		}
		wrongOperation := f.input("k-serialize-edits")
		wrongOperation.Edits = []office.EditOp{{Op: "set_cell"}}
		if _, err := svc.StartOfficeJob(ctx, f.actor, wrongOperation); !errors.Is(err, ErrOfficeJobInvalid) {
			t.Fatalf("serialize edits = %v", err)
		}
		tooMany := f.input("k-edit-too-many")
		tooMany.Operation = office.OperationEdit
		tooMany.Edits = make([]office.EditOp, 10_001)
		for i := range tooMany.Edits {
			tooMany.Edits[i].Op = "set_cell"
		}
		if _, err := svc.StartOfficeJob(ctx, f.actor, tooMany); !errors.Is(err, ErrOfficeJobInvalid) {
			t.Fatalf("too many edits = %v", err)
		}
	})

	t.Run("only the job's creator cancels it", func(t *testing.T) {
		f := newOfficeFixture(t, "mine\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-mine"))
		other := human(f.tn.creator) // another member with edit on the document
		if _, err := svc.CancelOfficeJob(ctx, other, f.org, f.ws, row.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("other member cancel: %v", err)
		}
	})

	t.Run("metrics count each job once and keep the queue gauge on a failed probe", func(t *testing.T) {
		f := newOfficeFixture(t, "metrics\n")
		eng := newScriptedEngine()
		m := &countingMetrics{}
		svc := NewDocumentOfficeService(DocumentOfficeOptions{Pool: f.pool, Queries: f.q, Files: f.files, Engine: eng, Documents: f.docs, Metrics: m})
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-metrics"))
		eng.finish(t, row.ID, body, "text/markdown")
		_, _ = svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		_, _ = svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, row.ID) // completed -> cancelled
		if len(m.outcomes) != 1 || m.outcomes[0] != "completed" {
			t.Fatalf("outcomes: %v", m.outcomes)
		}
		if _, err := svc.EngineReady(ctx); err != nil || len(m.depth) != 1 || m.depth[0] != 3 {
			t.Fatalf("probe: %v %v", err, m.depth)
		}
	})

	t.Run("the reconciler sweeps on its interval and stops with its context", func(t *testing.T) {
		f := newOfficeFixture(t, "sweep\n")
		eng := newScriptedEngine()
		svc := f.service(eng)
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-sweep"))
		eng.finish(t, row.ID, body, "text/markdown")
		runCtx, cancel := context.WithCancel(ctx)
		stopped := make(chan struct{})
		go func() { svc.RunReconciler(runCtx); close(stopped) }()
		end := time.Now().Add(5 * time.Second)
		for {
			got, _ := f.q.GetOfficeJob(ctx, db.GetOfficeJobParams{ID: row.ID, OrganizationID: f.org, WorkspaceID: f.ws})
			if got.State == "completed" {
				break
			}
			if time.Now().After(end) {
				t.Fatal("reconciler never settled the job")
			}
			time.Sleep(50 * time.Millisecond)
		}
		cancel()
		select {
		case <-stopped:
		case <-time.After(2 * time.Second):
			t.Fatal("reconciler did not stop")
		}
	})
}
