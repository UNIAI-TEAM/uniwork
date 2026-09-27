package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
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
	sum    string
	length int64
	err    *office.JobError
}

type scriptedEngine struct {
	mu        sync.Mutex
	key       []byte
	files     *bridgeFiles
	jobs      map[string]*scriptedJob
	grants    []office.ServiceGrant
	submitErr error
	lost      bool
	gate      chan struct{}
	cancels   int
}

func newScriptedEngine(f *officeFixture) *scriptedEngine {
	return &scriptedEngine{key: []byte(officeDevKey), files: f.files, jobs: map[string]*scriptedJob{}}
}

func (e *scriptedEngine) Sign(g office.ServiceGrant) (string, error) {
	return office.SignGrant(g, e.key)
}

func (e *scriptedEngine) status(id string) office.JobStatus {
	j := e.jobs[id]
	js := office.JobStatus{JobID: id, State: j.state, OutputFileID: j.fileID, OutputChecksum: j.sum, Error: j.err}
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
		e.jobs[g.JobID] = &scriptedJob{state: office.JobRunning, fileID: g.Output.FileID}
	}
	if env.GrantID != g.GrantID {
		return office.JobStatus{}, office.NewEngineError("grant_scope", "grant_id")
	}
	return e.status(g.JobID), nil
}

// finish plays the engine completing: it writes the output to the object
// store (the fake) and reports completed.
func (e *scriptedEngine) finish(t *testing.T, jobID string, body []byte) {
	t.Helper()
	e.mu.Lock()
	defer e.mu.Unlock()
	j := e.jobs[jobID]
	if err := e.files.WriteProviderOutput(files.ProviderOutput{FileID: files.FileID(j.fileID)}, body, "text/markdown"); err != nil {
		t.Fatal(err)
	}
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
	e.mu.Unlock()
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
		eng := newScriptedEngine(f)
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
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-committed"))
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, body)
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
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-race"))
		if err != nil {
			t.Fatal(err)
		}
		eng.finish(t, row.ID, body) // the engine is done and the object exists
		eng.mu.Lock()
		eng.gate = make(chan struct{})
		gate := eng.gate
		eng.mu.Unlock()
		refreshed := make(chan db.OfficeJob)
		go func() {
			r, _ := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID) // blocks inside Status
			refreshed <- r
		}()
		time.Sleep(50 * time.Millisecond)
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

	t.Run("commit and cancel of a completed job: whichever lands first is final", func(t *testing.T) {
		f := newOfficeFixture(t, "order\n")
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		first, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-commit-first"))
		eng.finish(t, first.ID, body)
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

		docID, verID := f.seedDocument(t, "order 2\n")
		in := f.input("k-cancel-first")
		in.DocumentID, in.BaseVersionID = docID, verID
		second, _ := svc.StartOfficeJob(ctx, f.actor, in)
		eng.finish(t, second.ID, body)
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
		eng := newScriptedEngine(f)
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
			eng.finish(t, row.ID, body)
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
		eng := newScriptedEngine(f)
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
			docID, verID := f.seedDocument(t, "outcome "+tc.reason+"\n")
			in := f.input("k-outcome-" + tc.reason)
			in.DocumentID, in.BaseVersionID = docID, verID
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
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		lost, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-lost"))
		docID, verID := f.seedDocument(t, "written\n")
		in := f.input("k-written")
		in.DocumentID, in.BaseVersionID = docID, verID
		written, _ := svc.StartOfficeJob(ctx, f.actor, in)
		eng.finish(t, written.ID, body)
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
		eng := newScriptedEngine(f)
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
		svc := f.service(newScriptedEngine(f))
		in := f.input("k-export")
		in.Operation = office.OperationExport
		if _, err := svc.StartOfficeJob(ctx, f.actor, in); office.ErrorCode(err) != "unsupported_operation" {
			t.Fatalf("export: %v", err)
		}
		if _, err := f.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{OrganizationID: f.org, WorkspaceID: f.ws, IdempotencyKey: "k-export"}); err == nil {
			t.Fatal("export persisted a job")
		}
	})

	t.Run("only the job's creator cancels it", func(t *testing.T) {
		f := newOfficeFixture(t, "mine\n")
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-mine"))
		other := Human(util.NewID())
		otherSvc := NewDocumentOfficeService(DocumentOfficeOptions{Pool: f.pool, Queries: f.q, Files: f.files, Engine: eng, Members: allowMember{other.ID}})
		if _, err := otherSvc.CancelOfficeJob(ctx, other, f.org, f.ws, row.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("other member cancel: %v", err)
		}
	})

	t.Run("metrics count each job once and keep the queue gauge on a failed probe", func(t *testing.T) {
		f := newOfficeFixture(t, "metrics\n")
		eng := newScriptedEngine(f)
		m := &countingMetrics{}
		svc := NewDocumentOfficeService(DocumentOfficeOptions{Pool: f.pool, Queries: f.q, Files: f.files, Engine: eng, Members: allowMember{f.actor.ID}, Metrics: m})
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-metrics"))
		eng.finish(t, row.ID, body)
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
		eng := newScriptedEngine(f)
		svc := f.service(eng)
		row, _ := svc.StartOfficeJob(ctx, f.actor, f.input("k-sweep"))
		eng.finish(t, row.ID, body)
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
