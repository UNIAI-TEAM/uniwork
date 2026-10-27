package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type driveProposalTestMetrics struct {
	mu     sync.Mutex
	counts map[string]int
}

func (m *driveProposalTestMetrics) ObserveTaskProposal(result string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.counts == nil {
		m.counts = make(map[string]int)
	}
	m.counts[result]++
}

func (m *driveProposalTestMetrics) get(result string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.counts[result]
}

type fakeDriveContentReader struct {
	mu      sync.Mutex
	content service.DriveContent
	err     error
	fn      func(ctx context.Context, requesterID, workspaceID, driveFileID string, purpose service.DriveContentPurpose) (service.DriveContent, error)
}

func (f *fakeDriveContentReader) ReadForAI(ctx context.Context, requesterID, workspaceID, driveFileID string, purpose service.DriveContentPurpose) (service.DriveContent, error) {
	f.mu.Lock()
	fn := f.fn
	c := f.content
	err := f.err
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, requesterID, workspaceID, driveFileID, purpose)
	}
	if err != nil {
		return service.DriveContent{}, err
	}
	if c.DriveFileID == "" {
		c.DriveFileID = driveFileID
	}
	return c, nil
}

type fakeCreationsLoader struct {
	summary service.DriveTasksCreatedSummary
	groups  []service.DriveTaskCreationGroup
}

func (f *fakeCreationsLoader) LoadTasksCreatedSummaries(_ context.Context, _ string, _ db.WorkspaceMember, _ db.Workspace, externalFileIDs []string) (map[string]service.DriveTasksCreatedSummary, error) {
	out := make(map[string]service.DriveTasksCreatedSummary, len(externalFileIDs))
	for _, id := range externalFileIDs {
		out[id] = f.summary
	}
	return out, nil
}

func (f *fakeCreationsLoader) LoadTaskCreationGroups(_ context.Context, _ string, _ db.WorkspaceMember, _ db.Workspace, _ string, _ int) ([]service.DriveTaskCreationGroup, error) {
	return f.groups, nil
}

type driveProposalHTTPTestEnv struct {
	*driveHTTPTestEnv
	aiMu       sync.Mutex
	aiReply    func(provider.CompletionRequest) (provider.CompletionResponse, error)
	contentSvc *service.DriveContentService
	metrics    *driveProposalTestMetrics
	flagRules  *featureflag.StaticProvider
}

func newDriveProposalHTTPTestEnv(t *testing.T) *driveProposalHTTPTestEnv {
	t.Helper()
	base := newDriveHTTPTestEnv(t)
	base.srv.Close()
	base.deps.Cfg.EnableSwagger = true

	sp := featureflag.NewStaticProvider()
	sp.Set("drive_connector", featureflag.Rule{Default: true})
	base.deps.FeatureFlags = featureflag.NewService(sp)
	base.deps.DriveConnections.SetFlags(base.deps.FeatureFlags)
	base.deps.DriveFiles.SetFlags(base.deps.FeatureFlags)

	googleDocServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/export") || r.URL.Query().Get("alt") == "media" {
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			_, _ = w.Write([]byte("# Launch Plan\nSECRET_RAW_DOC_TEXT_NEVER_STORED\n- Chốt phạm vi tính năng beta"))
			return
		}
		extID := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
		base.mu.Lock()
		status := base.googleError[extID]
		base.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if status != 0 {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    status,
					"message": "simulated error",
					"errors":  []map[string]any{{"reason": "notFound"}},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           extID,
			"name":         "Spec Document " + extID,
			"mimeType":     "application/vnd.google-apps.document",
			"webViewLink":  "https://docs.google.com/document/d/" + extID + "/edit",
			"shared":       true,
			"trashed":      false,
			"modifiedTime": "2026-10-26T10:00:00Z",
			"owners":       []map[string]any{{"displayName": "Owner " + extID}},
			"permissions":  []map[string]any{{"id": "p1"}, {"id": "p2"}},
		})
	}))
	t.Cleanup(googleDocServer.Close)

	apiClient := service.NewDriveAPIClientForTest(googleDocServer.URL+"/drive/v3", googleDocServer.Client().Transport)
	base.deps.DriveFiles = service.NewDriveFileService(base.pool, base.q, base.deps.Workspaces, base.deps.DriveConnections, apiClient)
	base.deps.DriveFiles.SetFlags(base.deps.FeatureFlags)
	base.deps.Tasks.SetDriveFiles(base.deps.DriveFiles)
	base.deps.Audit.SetDriveFiles(base.deps.DriveFiles)

	contentSvc := service.NewDriveContentService(base.pool, base.q, base.deps.Workspaces, base.deps.DriveFiles, base.deps.DriveConnections, apiClient, nil)
	env := &driveProposalHTTPTestEnv{
		driveHTTPTestEnv: base,
		contentSvc:       contentSvc,
		metrics:          &driveProposalTestMetrics{},
		flagRules:        sp,
	}

	fakeProvider := &provider.Fake{
		Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
			env.aiMu.Lock()
			fn := env.aiReply
			env.aiMu.Unlock()
			if fn != nil {
				res, err := fn(req)
				if err == nil {
					return res
				}
			}
			return provider.CompletionResponse{
				Text:  `{"items":[{"title":"Chốt phạm vi tính năng beta","assignee_member_id":"","assignee_basis":"","priority":"high","priority_basis":"Chặn việc sau","start_date":"2026-10-27","start_basis":"Tuần này","due_date":"2026-11-05","due_basis":"Trước 05/11","label_ids":[],"label_basis":"","goal":"Chốt danh sách tính năng beta","checklist":["Liệt kê tính năng","Họp chốt"],"excerpt":{"section":"Mục 2","quote":"Nhóm sản phẩm chốt phạm vi beta trước ngày 05/11."},"blocked_by_indexes":[]}]}`,
				Model: "fake",
			}
		},
	}
	gw := ai.NewGateway(base.q, fakeProvider, service.NewAIQuota(service.NewEntitlementService(base.pool, base.q)), nil, ai.Options{})
	base.deps.DriveTaskProposals = service.NewDriveTaskProposalService(base.pool, base.q, base.deps.Workspaces, base.deps.DriveFiles, base.deps.DriveConnections, contentSvc, gw)
	base.deps.DriveTaskProposals.SetFlags(base.deps.FeatureFlags)
	base.deps.DriveTaskProposals.SetMetrics(env.metrics)
	base.deps.Audit.SetDriveProposalHistoryAuthorizer(base.deps.DriveTaskProposals.AuthorizeHistory)
	base.deps.DriveTaskProposals.SetTasks(base.deps.Tasks)
	base.deps.DriveFiles.SetTaskCreationsLoader(base.deps.DriveFiles)
	base.deps.DriveTaskProposals.SetTaskCreationsLoader(base.deps.DriveFiles)

	srv := httptest.NewServer(New(base.deps))
	t.Cleanup(srv.Close)
	base.srv = srv
	return env
}

func (e *driveProposalHTTPTestEnv) linkFile(t *testing.T, tk, connID, extID, taskID string) map[string]any {
	t.Helper()
	body := map[string]any{
		"connection_id":     connID,
		"external_file_ids": []string{extID},
	}
	if taskID != "" {
		body["task_id"] = taskID
	}
	res, out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/drive-files", tk, body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("linkFile(%s) = %d %v, want 200", extID, res.StatusCode, out)
	}
	results := jsonArrayAt(t, out, "results")
	if len(results) != 1 {
		t.Fatalf("linkFile(%s) results = %v, want 1 item", extID, results)
	}
	item, _ := results[0].(map[string]any)
	fileObj, _ := item["file"].(map[string]any)
	if fileObj == nil {
		t.Fatalf("linkFile(%s) item = %v, want non-nil file", extID, item)
	}
	return fileObj
}

func (e *driveProposalHTTPTestEnv) createTask(t *testing.T, tk, title string) string {
	t.Helper()
	res, out := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/tasks", tk, map[string]any{
		"title": title,
	})
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		t.Fatalf("createTask(%q) = %d %v", title, res.StatusCode, out)
	}
	return jsonStr(jsonMap(out, "task"), "id")
}

func jsonMap(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	v, _ := m[key].(map[string]any)
	return v
}

func jsonStr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func jsonArray(m map[string]any, key string) []any {
	if m == nil {
		return nil
	}
	v, _ := m[key].([]any)
	return v
}

func jsonErrCode(m map[string]any) string {
	return errorCode(m)
}

// TestDriveProposalEndToEndNormalizationDuplicatesAndAudit verifies the full
// POST task-proposals -> GET -> POST duplicates flow, normalization of unknown
// member/label IDs, bad dates, invalid priority, cleared *_basis on dropped
// fields, blocked_by DAG cycle/out-of-range pruning, assignee_drive_access
// (granted vs unknown), possible_duplicate matching, audit rows carrying
// google_email and zero document content, and Prometheus counter recording.
func TestDriveProposalEndToEndNormalizationDuplicatesAndAudit(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-owner-prop", "owner-prop@example.com")
	linked := e.linkFile(t, e.ownerTk, ownerConn, "ext-prop-doc-1", "")
	fileID := jsonStr(linked, "id")

	// Create a workspace label and an open task + project + parent task to test matching.
	projRes, projOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/projects", e.ownerTk, map[string]any{
		"title": "Beta Launch Project",
	})
	if projRes.StatusCode != http.StatusCreated {
		t.Fatalf("create project = %d %v", projRes.StatusCode, projOut)
	}
	projectID := jsonStr(jsonMap(projOut, "project"), "id")

	lbl, err := e.q.CreateTaskLabel(context.Background(), db.CreateTaskLabelParams{
		ID:             util.NewID(),
		OrganizationID: e.orgID,
		WorkspaceID:    e.wsID,
		Name:           "Backend",
		Color:          "#3b82f6",
		Description:    "Backend work",
		CreatedBy:      e.ownerID,
		CreatedByKind:  "human",
	})
	if err != nil {
		t.Fatalf("create label: %v", err)
	}

	parentTaskID := e.createTask(t, e.ownerTk, "Epic Parent Task")
	dupRes, dupOut := doJSON(t, e.srv, "POST", "/api/v1/workspaces/"+e.wsID+"/tasks", e.ownerTk, map[string]any{
		"title":          "Chốt phạm vi tính năng beta",
		"project_id":     projectID,
		"parent_task_id": parentTaskID,
	})
	if dupRes.StatusCode != http.StatusOK && dupRes.StatusCode != http.StatusCreated {
		t.Fatalf("create duplicate candidate task = %d %v", dupRes.StatusCode, dupOut)
	}
	dupTaskID := jsonStr(jsonMap(dupOut, "task"), "id")

	// Configure AI reply with:
	// - item 0: empty title (must be dropped before indexing)
	// - item 1 (becomes index 0): valid assignee (owner, granted access), valid label + unknown label, valid dates, duplicate title match, blocked_by [1, 99, 0] (0 is self, 99 out of range -> [1])
	// - item 2 (becomes index 1): valid assignee (peer, no drive_file_access -> unknown), bad start_date, invalid priority, unknown label only -> basis cleared, blocked_by [0] (would cycle with 0->1, so dropped!)
	// - item 3 (becomes index 2): unknown assignee (foreign user ID) -> assignee_member_id dropped and assignee_basis cleared, >10 checklist items capped to 10, >300-rune quote capped to 300.
	longQuote := strings.Repeat("Trích dẫn dài ", 30)
	e.aiMu.Lock()
	e.aiReply = func(req provider.CompletionRequest) (provider.CompletionResponse, error) {
		rawItems := []map[string]any{
			{
				"title":              "   ",
				"assignee_member_id": e.ownerID,
				"assignee_basis":     "Dropped item",
				"priority":           "low",
				"priority_basis":     "Dropped",
				"start_date":         "",
				"start_basis":        "",
				"due_date":           "",
				"due_basis":          "",
				"label_ids":          []string{},
				"label_basis":        "",
				"goal":               "Should be dropped",
				"checklist":          []string{},
				"excerpt":            map[string]string{"section": "S0", "quote": "q"},
				"blocked_by_indexes": []int{},
			},
			{
				"title":              "  chốt   phạm vi tính năng BETA ",
				"assignee_member_id": e.ownerID,
				"assignee_basis":     "Tài liệu: Owner phụ trách",
				"priority":           "urgent",
				"priority_basis":     "Cần chốt ngay",
				"start_date":         "2026-10-27",
				"start_basis":        "Hôm nay",
				"due_date":           "2026-11-05",
				"due_basis":          "Mục 2: trước 05/11",
				"label_ids":          []string{lbl.ID, "01UNKNOWNLABEL000000000000"},
				"label_basis":        "Nhãn kỹ thuật",
				"goal":               "Chốt phạm vi beta",
				"checklist":          []string{"Bước 1", "Bước 2"},
				"excerpt":            map[string]string{"section": "Mục 2", "quote": "Chốt phạm vi trước 05/11"},
				"blocked_by_indexes": []int{2, 99, 1, -1, 2},
			},
			{
				"title":              "Viết tài liệu hướng dẫn",
				"assignee_member_id": e.peerID,
				"assignee_basis":     "Tài liệu: Peer viết",
				"priority":           "super_critical",
				"priority_basis":     "Sai enum priority phải xóa basis",
				"start_date":         "2026-02-30",
				"start_basis":        "Ngày không hợp lệ phải xóa basis",
				"due_date":           "not-a-date",
				"due_basis":          "Sai định dạng ngày",
				"label_ids":          []string{"01UNKNOWNLABEL000000000000"},
				"label_basis":        "Nhãn lạ phải xóa basis",
				"goal":               "Hoàn thành tài liệu",
				"checklist":          []string{},
				"excerpt":            map[string]string{"section": "Mục 3", "quote": "Peer viết hướng dẫn"},
				"blocked_by_indexes": []int{1},
			},
			{
				"title":              "Kiểm thử tải hệ thống",
				"assignee_member_id": "01FOREIGNUSER0000000000000",
				"assignee_basis":     "Người lạ ngoài workspace phải xóa basis",
				"priority":           "medium",
				"priority_basis":     "Mức vừa",
				"start_date":         "",
				"start_basis":        "Rỗng nhưng có basis phải xóa",
				"due_date":           "",
				"due_basis":          "",
				"label_ids":          []string{},
				"label_basis":        "",
				"goal":               "Đảm bảo chịu tải",
				"checklist":          []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"},
				"excerpt":            map[string]string{"section": "Mục 4", "quote": longQuote},
				"blocked_by_indexes": []int{},
			},
		}
		b, _ := json.Marshal(map[string]any{"items": rawItems})
		return provider.CompletionResponse{Text: string(b), Model: "fake"}, nil
	}
	e.aiMu.Unlock()

	proposePath := fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID)
	res, out := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{
		"prompt":          "Tách việc cho nhóm sản phẩm",
		"project_id":      projectID,
		"parent_task_id":  parentTaskID,
		"context_task_id": parentTaskID,
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("POST task-proposals = %d %v, want 201", res.StatusCode, out)
	}

	var sdoOut sdo.DriveTaskProposalSDO
	rawBytes, _ := json.Marshal(out)
	if err := json.Unmarshal(rawBytes, &sdoOut); err != nil {
		t.Fatalf("decode DriveTaskProposalSDO: %v", err)
	}
	prop := sdoOut.Proposal
	if prop.ID == "" || prop.WorkspaceID != e.wsID || prop.DriveFileID != fileID || prop.ConnectionID != ownerConn {
		t.Fatalf("proposal header = %+v", prop)
	}
	if prop.ReaderAccountEmail != "owner-prop@example.com" || prop.RequestedBy != e.ownerID || prop.Status != "ready" {
		t.Fatalf("proposal identity/status = %+v", prop)
	}
	if prop.ProjectID == nil || *prop.ProjectID != projectID || prop.ParentTaskID == nil || *prop.ParentTaskID != parentTaskID {
		t.Fatalf("proposal project/parent = %+v", prop)
	}
	if prop.TasksCreated.Count != 0 || len(prop.PriorCreations) != 0 {
		t.Fatalf("proposal tasks_created/prior_creations = %+v / %+v, want 0 and []", prop.TasksCreated, prop.PriorCreations)
	}
	if len(prop.Items) != 3 {
		t.Fatalf("len(items) = %d, want 3 (empty title dropped)", len(prop.Items))
	}

	// Item 0 checks:
	it0 := prop.Items[0]
	if it0.Index != 0 || it0.AssigneeMemberID == nil || *it0.AssigneeMemberID != e.ownerID || it0.AssigneeDriveAccess != "granted" {
		t.Fatalf("item[0] assignee = %+v, want owner with granted access", it0)
	}
	if len(it0.LabelIDs) != 1 || it0.LabelIDs[0] != lbl.ID || it0.LabelBasis != "Nhãn kỹ thuật" {
		t.Fatalf("item[0] labels = %+v (basis %q), want [%s]", it0.LabelIDs, it0.LabelBasis, lbl.ID)
	}
	if len(it0.BlockedByIndexes) != 1 || it0.BlockedByIndexes[0] != 1 {
		t.Fatalf("item[0] blocked_by_indexes = %v, want [1]", it0.BlockedByIndexes)
	}
	if it0.PossibleDuplicate == nil || it0.PossibleDuplicate.TaskID != dupTaskID || !strings.HasSuffix(it0.PossibleDuplicate.Identifier, "-2") {
		t.Fatalf("item[0] possible_duplicate = %+v, want task %s", it0.PossibleDuplicate, dupTaskID)
	}

	// Item 1 checks: peer has no drive_file_access -> unknown; bad priority/dates/labels cleared along with basis; cycle 1->0 dropped.
	it1 := prop.Items[1]
	if it1.Index != 1 || it1.AssigneeMemberID == nil || *it1.AssigneeMemberID != e.peerID || it1.AssigneeDriveAccess != "unknown" {
		t.Fatalf("item[1] assignee = %+v, want peer with unknown access", it1)
	}
	if it1.Priority != "" || it1.PriorityBasis != "" {
		t.Fatalf("item[1] priority/basis = %q/%q, want empty", it1.Priority, it1.PriorityBasis)
	}
	if it1.StartDate == nil || *it1.StartDate == "" || it1.StartBasis != service.DriveProposalDefaultStartBasis || it1.DueDate != nil || it1.DueBasis != "" {
		t.Fatalf("item[1] dates/basis = %+v, want today start_date with default basis and nil due_date", it1)
	}
	if len(it1.LabelIDs) != 0 || it1.LabelBasis != "" {
		t.Fatalf("item[1] labels/basis = %v/%q, want empty", it1.LabelIDs, it1.LabelBasis)
	}
	if len(it1.BlockedByIndexes) != 0 {
		t.Fatalf("item[1] blocked_by_indexes = %v, want [] (cycle broken)", it1.BlockedByIndexes)
	}

	// Item 2 checks: foreign assignee dropped & basis cleared; checklist capped to 10; quote capped to 300 runes.
	it2 := prop.Items[2]
	if it2.Index != 2 || it2.AssigneeMemberID != nil || it2.AssigneeBasis != "" || it2.AssigneeDriveAccess != "" {
		t.Fatalf("item[2] foreign assignee not cleared: %+v", it2)
	}
	if len(it2.Checklist) != 10 {
		t.Fatalf("item[2] len(checklist) = %d, want 10", len(it2.Checklist))
	}
	if len([]rune(it2.Excerpt.Quote)) != 300 {
		t.Fatalf("item[2] quote runes = %d, want 300", len([]rune(it2.Excerpt.Quote)))
	}

	// Grant peer access on the file, then GET the proposal: peer's assignee_drive_access updates to "granted"!
	peerConn := e.seedConnection(t, e.peerID, "sub-peer-prop", "peer-prop@example.com")
	_, _ = e.q.UpsertDriveFileAccessGranted(context.Background(), db.UpsertDriveFileAccessGrantedParams{
		ID:             util.NewID(),
		OrganizationID: e.orgID,
		WorkspaceID:    e.wsID,
		DriveFileID:    fileID,
		UserID:         e.peerID,
		ConnectionID:   peerConn,
	})

	// Also wire fakeCreationsLoader to verify Amendment A2 seam on GET.
	ownerName := "Owner"
	e.deps.DriveTaskProposals.SetTaskCreationsLoader(&fakeCreationsLoader{
		summary: service.DriveTasksCreatedSummary{Count: 2, LastCreatedByName: &ownerName},
		groups: []service.DriveTaskCreationGroup{{
			ProposalID:    prop.ID,
			CreatedAt:     time.Now().UTC(),
			CreatedByID:   e.ownerID,
			CreatedByName: "Owner",
			Tasks: []service.DriveLinkedTaskRef{{
				TaskID:     dupTaskID,
				Identifier: "UNI-2",
				Title:      "Chốt phạm vi tính năng beta",
				Status:     "todo",
			}},
		}},
	})
	defer e.deps.DriveTaskProposals.SetTaskCreationsLoader(e.deps.DriveFiles)

	getPath := fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s", e.wsID, prop.ID)
	getRes, getOut := doJSON(t, e.srv, "GET", getPath, e.ownerTk, nil)
	if getRes.StatusCode != http.StatusOK {
		t.Fatalf("GET proposal = %d %v, want 200", getRes.StatusCode, getOut)
	}
	var getSDO sdo.DriveTaskProposalSDO
	getRaw, _ := json.Marshal(getOut)
	_ = json.Unmarshal(getRaw, &getSDO)
	if getSDO.Proposal.Items[1].AssigneeDriveAccess != "granted" {
		t.Fatalf("GET proposal item[1].assignee_drive_access = %q, want granted after peer granted access", getSDO.Proposal.Items[1].AssigneeDriveAccess)
	}
	if getSDO.Proposal.TasksCreated.Count != 2 || len(getSDO.Proposal.PriorCreations) != 1 {
		t.Fatalf("GET proposal creations seam = %+v / %+v, want count=2 and 1 group", getSDO.Proposal.TasksCreated, getSDO.Proposal.PriorCreations)
	}

	// POST .../duplicates re-checks edited titles under the chosen project and parent task.
	dupCheckPath := getPath + "/duplicates"
	dcRes, dcOut := doJSON(t, e.srv, "POST", dupCheckPath, e.ownerTk, map[string]any{
		"project_id":     projectID,
		"parent_task_id": parentTaskID,
		"titles":         []string{"Tiêu đề hoàn toàn mới", "chốt phạm vi tính năng beta"},
	})
	if dcRes.StatusCode != http.StatusOK {
		t.Fatalf("POST duplicates = %d %v, want 200", dcRes.StatusCode, dcOut)
	}
	var dcSDO sdo.DriveProposalDuplicatesSDO
	dcRaw, _ := json.Marshal(dcOut)
	_ = json.Unmarshal(dcRaw, &dcSDO)
	if len(dcSDO.Duplicates) != 2 || dcSDO.Duplicates[0].PossibleDuplicate != nil || dcSDO.Duplicates[1].PossibleDuplicate == nil || dcSDO.Duplicates[1].PossibleDuplicate.TaskID != dupTaskID {
		t.Fatalf("POST duplicates = %+v, want [nil, %s]", dcSDO.Duplicates, dupTaskID)
	}

	// Verify audit row carries google_email and no document content.
	var auditMetaRaw []byte
	if err := e.pool.QueryRow(context.Background(),
		`SELECT metadata FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.created' AND resource_id = $2`,
		e.orgID, prop.ID,
	).Scan(&auditMetaRaw); err != nil {
		t.Fatalf("query drive_task_proposal.created audit row: %v", err)
	}
	if strings.Contains(string(auditMetaRaw), "SECRET_RAW_DOC_TEXT_NEVER_STORED") {
		t.Fatalf("audit row leaked document content: %s", string(auditMetaRaw))
	}
	var auditMeta map[string]any
	_ = json.Unmarshal(auditMetaRaw, &auditMeta)
	if auditMeta["google_email"] != "owner-prop@example.com" || auditMeta["drive_file_id"] != fileID {
		t.Fatalf("audit metadata = %+v, want google_email=owner-prop@example.com drive_file_id=%s", auditMeta, fileID)
	}
	if got := e.metrics.get("created"); got != 1 {
		t.Fatalf("drive_task_proposals_total{result=created} = %d, want 1", got)
	}

	// R1-8: untruncated ReadForAI -> both proposal.truncated and ai_usage_events.truncated are false.
	var propTrunc, usageTrunc bool
	if err := e.pool.QueryRow(context.Background(),
		`SELECT p.truncated, u.truncated
		 FROM drive_task_proposals p
		 JOIN ai_usage_events u ON u.id = p.usage_event_id
		 WHERE p.id = $1`,
		prop.ID,
	).Scan(&propTrunc, &usageTrunc); err != nil || propTrunc || usageTrunc {
		t.Fatalf("untruncated proposal/usage truncated = (%v, %v) err=%v, want (false, false)", propTrunc, usageTrunc, err)
	}

	// R1-1 + R1-8: HTTP POST with [null, A, B(blocked_by_indexes=[1])] and Truncated=true from ReadForAI:
	// null stays as an empty placeholder in the raw array so B's raw dependency [1] maps to A's dense index [0],
	// and Truncated=true propagates to both drive_task_proposals.truncated and ai_usage_events.truncated.
	truncReader := &fakeDriveContentReader{
		content: service.DriveContent{
			DriveFileID: fileID,
			Name:        "Truncated Spec Document",
			MimeType:    service.DriveMimeGoogleDoc,
			Text:        "Truncated content",
			Truncated:   true,
		},
	}
	e.deps.DriveTaskProposals.SetDriveContentReader(truncReader)
	defer e.deps.DriveTaskProposals.SetDriveContentReader(e.contentSvc)

	e.aiMu.Lock()
	e.aiReply = func(provider.CompletionRequest) (provider.CompletionResponse, error) {
		return provider.CompletionResponse{
			Text:  `{"items":[null,{"title":"Task A","assignee_member_id":"","assignee_basis":"","priority":"","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal A","checklist":[],"excerpt":{"section":"S1","quote":"Q1"},"blocked_by_indexes":[]},{"title":"Task B","assignee_member_id":"","assignee_basis":"","priority":"","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal B","checklist":[],"excerpt":{"section":"S2","quote":"Q2"},"blocked_by_indexes":[1]}]}`,
			Model: "fake",
		}, nil
	}
	e.aiMu.Unlock()

	resNull, outNull := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{})
	if resNull.StatusCode != http.StatusCreated {
		t.Fatalf("POST task-proposals with leading null item = %d %v, want 201", resNull.StatusCode, outNull)
	}
	var nullSDO sdo.DriveTaskProposalSDO
	nullBytes, _ := json.Marshal(outNull)
	_ = json.Unmarshal(nullBytes, &nullSDO)
	if len(nullSDO.Proposal.Items) != 2 {
		t.Fatalf("leading-null proposal len(items) = %d, want 2: %+v", len(nullSDO.Proposal.Items), nullSDO.Proposal.Items)
	}
	if nullSDO.Proposal.Items[0].Index != 0 || nullSDO.Proposal.Items[0].Title != "Task A" || len(nullSDO.Proposal.Items[0].BlockedByIndexes) != 0 {
		t.Fatalf("Task A = %+v, want Index=0 BlockedByIndexes=[]", nullSDO.Proposal.Items[0])
	}
	if nullSDO.Proposal.Items[1].Index != 1 || nullSDO.Proposal.Items[1].Title != "Task B" || len(nullSDO.Proposal.Items[1].BlockedByIndexes) != 1 || nullSDO.Proposal.Items[1].BlockedByIndexes[0] != 0 {
		t.Fatalf("Task B = %+v, want Index=1 BlockedByIndexes=[0] (raw 1 is Task A)", nullSDO.Proposal.Items[1])
	}
	if !nullSDO.Proposal.Truncated {
		t.Fatalf("proposal.truncated = false, want true")
	}
	if err := e.pool.QueryRow(context.Background(),
		`SELECT p.truncated, u.truncated
		 FROM drive_task_proposals p
		 JOIN ai_usage_events u ON u.id = p.usage_event_id
		 WHERE p.id = $1`,
		nullSDO.Proposal.ID,
	).Scan(&propTrunc, &usageTrunc); err != nil || !propTrunc || !usageTrunc {
		t.Fatalf("truncated proposal/usage truncated = (%v, %v) err=%v, want (true, true)", propTrunc, usageTrunc, err)
	}
}

// TestDriveProposalOnlyItsRequester (contract §3, §6; spec §8.2a; R1-3) verifies
// that every gate miss on GET, DELETE, POST /duplicates, and
// GET /resources/drive_task_proposal/{id}/history — unknown proposal ID, wrong
// workspace, unknown workspace, non-member, and another member of the SAME
// workspace — returns the exact same 404 not_found status and JSON body.
func TestDriveProposalOnlyItsRequester(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-req-only", "req-only@example.com")
	linked := e.linkFile(t, e.ownerTk, ownerConn, "ext-req-only", "")
	fileID := jsonStr(linked, "id")

	proposePath := fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID)
	res, out := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{"prompt": "Only my proposal"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("POST task-proposals = %d %v", res.StatusCode, out)
	}
	proposalID := jsonStr(jsonMap(out, "proposal"), "id")
	propPath := fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s", e.wsID, proposalID)
	histPath := fmt.Sprintf("/api/v1/workspaces/%s/resources/drive_task_proposal/%s/history", e.wsID, proposalID)

	unknownPropID := util.NewID()
	unknownWsID := util.NewID()

	tag := strings.ToLower(util.NewID()[:8])
	regRes, regOut := doJSON(t, e.srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "drive-outsider-" + tag + "@example.com", "password": "password123", "display_name": "Outsider",
	})
	if regRes.StatusCode != http.StatusOK {
		t.Fatalf("register outsider: %d %v", regRes.StatusCode, regOut)
	}
	outsiderTk := regOut["access_token"].(string)
	verifyEmail(t, e.srv, outsiderTk)
	orgRes, orgOut := doJSON(t, e.srv, "POST", "/api/v1/orgs", outsiderTk, map[string]string{
		"name": "Outsider Org", "slug": "outsider-org-" + tag,
	})
	if orgRes.StatusCode != http.StatusCreated {
		t.Fatalf("create outsider org: %d %v", orgRes.StatusCode, orgOut)
	}
	outsiderOrgID := orgOut["organization"].(map[string]any)["id"].(string)
	wsRes, wsOut := doJSON(t, e.srv, "POST", "/api/v1/orgs/"+outsiderOrgID+"/workspaces", outsiderTk, map[string]string{
		"name": "Outsider WS", "slug": "outsider-ws-" + tag,
	})
	if wsRes.StatusCode != http.StatusCreated {
		t.Fatalf("create outsider ws: %d %v", wsRes.StatusCode, wsOut)
	}
	otherWsID := wsOut["workspace"].(map[string]any)["id"].(string)
	type surface struct {
		name   string
		method string
		path   func(wsID, pID string) string
		body   map[string]any
	}
	surfaces := []surface{
		{
			name:   "GET",
			method: "GET",
			path: func(wsID, pID string) string {
				return fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s", wsID, pID)
			},
		},
		{
			name:   "DELETE",
			method: "DELETE",
			path: func(wsID, pID string) string {
				return fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s", wsID, pID)
			},
		},
		{
			name:   "POST_duplicates",
			method: "POST",
			path: func(wsID, pID string) string {
				return fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s/duplicates", wsID, pID)
			},
			body: map[string]any{"titles": []string{"Task"}},
		},
		{
			name:   "GET_history",
			method: "GET",
			path: func(wsID, pID string) string {
				return fmt.Sprintf("/api/v1/workspaces/%s/resources/drive_task_proposal/%s/history", wsID, pID)
			},
		},
	}
	if r, o := doJSON(t, e.srv, "POST", propPath+"/tasks", e.peerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Peer task", "description": "Body"}},
	}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer POST tasks = %d %v, want 404 not_found", r.StatusCode, o)
	}

	for _, sf := range surfaces {
		// Baseline: owner requesting an unknown proposal ID in their own workspace.
		baseRes, baseOut := doJSON(t, e.srv, sf.method, sf.path(e.wsID, unknownPropID), e.ownerTk, sf.body)
		if baseRes.StatusCode != http.StatusNotFound || jsonErrCode(baseOut) != "not_found" {
			t.Fatalf("%s unknown-proposal baseline = %d %v, want 404 not_found", sf.name, baseRes.StatusCode, baseOut)
		}
		baseJSON, _ := json.Marshal(baseOut)

		for _, miss := range []struct {
			label string
			wsID  string
			pID   string
			token string
		}{
			{label: "same_workspace_peer", wsID: e.wsID, pID: proposalID, token: e.peerTk},
			{label: "wrong_workspace_unknown", wsID: unknownWsID, pID: proposalID, token: e.ownerTk},
			{label: "wrong_workspace_other_org", wsID: otherWsID, pID: proposalID, token: e.ownerTk},
			{label: "non_member_other_org_caller", wsID: e.wsID, pID: proposalID, token: outsiderTk},
		} {
			beforeSelects := e.auditCounter.resourceSelects.Load()
			r, o := doJSON(t, e.srv, sf.method, sf.path(miss.wsID, miss.pID), miss.token, sf.body)
			gotJSON, _ := json.Marshal(o)
			if r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" || string(gotJSON) != string(baseJSON) {
				t.Fatalf("%s (%s) = %d %s, want identical 404 %s", sf.name, miss.label, r.StatusCode, string(gotJSON), string(baseJSON))
			}
			if sf.name == "GET_history" {
				if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
					t.Fatalf("%s (%s) executed ListResourceAuditEvents (%d -> %d)", sf.name, miss.label, beforeSelects, got)
				}
			}
		}
	}

	// Owner (the requester) succeeds on all four routes.
	if r, _ := doJSON(t, e.srv, "GET", propPath, e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("owner GET proposal = %d, want 200", r.StatusCode)
	}
	if r, _ := doJSON(t, e.srv, "POST", propPath+"/duplicates", e.ownerTk, map[string]any{"titles": []string{"Task"}}); r.StatusCode != http.StatusOK {
		t.Fatalf("owner POST duplicates = %d, want 200", r.StatusCode)
	}
	if r, o := doJSON(t, e.srv, "GET", histPath, e.ownerTk, nil); r.StatusCode != http.StatusOK || len(jsonArrayAt(t, o, "events")) == 0 {
		t.Fatalf("owner GET proposal history = %d %v, want 200 with events", r.StatusCode, o)
	}
	if r, _ := doJSON(t, e.srv, "DELETE", propPath, e.ownerTk, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("owner DELETE proposal = %d, want 204", r.StatusCode)
	}
}

// TestDriveProposalConcurrentSourceChanges (contract §2.6, §6; spec §8.2b)
// holds inside the fake AI call while the connection is disconnected, the file
// is unlinked, or the caller's read account is switched/rebound, then releases
// the AI call and verifies 409 drive_source_changed with zero ready rows left.
func TestDriveProposalConcurrentSourceChanges(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(t *testing.T, e *driveProposalHTTPTestEnv, fileID, conn1, conn2 string)
	}{
		{
			name: "disconnect_during_ai",
			mutate: func(t *testing.T, e *driveProposalHTTPTestEnv, _, conn1, _ string) {
				r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-connections/%s", e.wsID, conn1), e.ownerTk, nil)
				if r.StatusCode != http.StatusOK {
					t.Fatalf("concurrent disconnect = %d %v, want 200", r.StatusCode, o)
				}
			},
		},
		{
			name: "unlink_during_ai",
			mutate: func(t *testing.T, e *driveProposalHTTPTestEnv, fileID, _, _ string) {
				r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s", e.wsID, fileID), e.ownerTk, nil)
				if r.StatusCode != http.StatusOK {
					t.Fatalf("concurrent unlink = %d %v, want 200", r.StatusCode, o)
				}
			},
		},
		{
			name: "rebind_during_ai",
			mutate: func(t *testing.T, e *driveProposalHTTPTestEnv, fileID, _, conn2 string) {
				r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/rebind", e.wsID, fileID), e.ownerTk, map[string]any{
					"connection_id": conn2,
				})
				if r.StatusCode != http.StatusOK {
					t.Fatalf("concurrent rebind = %d %v, want 200", r.StatusCode, o)
				}
			},
		},
		{
			name: "credential_version_change_during_ai",
			mutate: func(t *testing.T, e *driveProposalHTTPTestEnv, _, conn1, _ string) {
				if _, err := e.pool.Exec(context.Background(),
					`UPDATE drive_connections SET credential_version = credential_version + 1, updated_at = now() WHERE id = $1`,
					conn1,
				); err != nil {
					t.Fatalf("bump credential_version on %s: %v", conn1, err)
				}
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newDriveProposalHTTPTestEnv(t)
			conn1 := e.seedConnection(t, e.ownerID, "sub-race-1-"+tc.name, "race1-"+tc.name+"@example.com")
			conn2 := e.seedConnection(t, e.ownerID, "sub-race-2-"+tc.name, "race2-"+tc.name+"@example.com")
			linked := e.linkFile(t, e.ownerTk, conn1, "ext-race-"+tc.name, "")
			fileID := jsonStr(linked, "id")

			inAI := make(chan struct{})
			releaseAI := make(chan struct{})
			var once sync.Once
			e.aiMu.Lock()
			e.aiReply = func(req provider.CompletionRequest) (provider.CompletionResponse, error) {
				once.Do(func() { close(inAI) })
				<-releaseAI
				return provider.CompletionResponse{
					Text:  `{"items":[{"title":"Task from race","assignee_member_id":"","assignee_basis":"","priority":"","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal","checklist":[],"excerpt":{"section":"S1","quote":"Quote"},"blocked_by_indexes":[]}]}`,
					Model: "fake",
				}, nil
			}
			e.aiMu.Unlock()

			type result struct {
				status int
				body   map[string]any
			}
			done := make(chan result, 1)
			go func() {
				r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID), e.ownerTk, map[string]any{})
				done <- result{status: r.StatusCode, body: o}
			}()

			<-inAI
			tc.mutate(t, e, fileID, conn1, conn2)
			close(releaseAI)

			got := <-done
			if got.status != http.StatusConflict || jsonErrCode(got.body) != sdo.DriveErrSourceChanged {
				t.Fatalf("%s: POST task-proposals = %d %v, want 409 drive_source_changed", tc.name, got.status, got.body)
			}

			var totalCount, createdAudits int
			if err := e.pool.QueryRow(context.Background(),
				`SELECT count(*) FROM drive_task_proposals WHERE workspace_id = $1 AND drive_file_id = $2`,
				e.wsID, fileID,
			).Scan(&totalCount); err != nil {
				t.Fatal(err)
			}
			if totalCount != 0 {
				t.Fatalf("%s: proposals count = %d, want 0", tc.name, totalCount)
			}
			if err := e.pool.QueryRow(context.Background(),
				`SELECT count(*) FROM audit_events WHERE organization_id = $1 AND workspace_id = $2 AND action = 'drive_task_proposal.created'`,
				e.orgID, e.wsID,
			).Scan(&createdAudits); err != nil {
				t.Fatal(err)
			}
			if createdAudits != 0 {
				t.Fatalf("%s: drive_task_proposal.created audit count = %d, want 0", tc.name, createdAudits)
			}
		})
	}

	// R1-4 + R1-10: credential_version replacement while ReadForAI is paused must
	// compare against the pre-ReadForAI snapshot (not a post-read fallback) and
	// refuse with 409 drive_source_changed and 0 rows.
	t.Run("credential_version_change_during_read", func(t *testing.T) {
		e := newDriveProposalHTTPTestEnv(t)
		conn1 := e.seedConnection(t, e.ownerID, "sub-race-read-1", "raceread1@example.com")
		linked := e.linkFile(t, e.ownerTk, conn1, "ext-race-read", "")
		fileID := jsonStr(linked, "id")

		inRead := make(chan struct{})
		releaseRead := make(chan struct{})
		var once sync.Once
		fakeReader := &fakeDriveContentReader{
			fn: func(ctx context.Context, requesterID, workspaceID, driveFileID string, purpose service.DriveContentPurpose) (service.DriveContent, error) {
				once.Do(func() { close(inRead) })
				<-releaseRead
				return service.DriveContent{
					DriveFileID: driveFileID,
					Name:        "Read Race Doc",
					MimeType:    service.DriveMimeGoogleDoc,
					Text:        "# Read Race\n- Task 1",
				}, nil
			},
		}
		e.deps.DriveTaskProposals.SetDriveContentReader(fakeReader)
		defer e.deps.DriveTaskProposals.SetDriveContentReader(e.contentSvc)

		type result struct {
			status int
			body   map[string]any
		}
		done := make(chan result, 1)
		go func() {
			r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID), e.ownerTk, map[string]any{})
			done <- result{status: r.StatusCode, body: o}
		}()

		<-inRead
		if _, err := e.pool.Exec(context.Background(),
			`UPDATE drive_connections SET credential_version = credential_version + 1, updated_at = now() WHERE id = $1`,
			conn1,
		); err != nil {
			t.Fatalf("bump credential_version during read: %v", err)
		}
		close(releaseRead)

		got := <-done
		if got.status != http.StatusConflict || jsonErrCode(got.body) != sdo.DriveErrSourceChanged {
			t.Fatalf("credential_version_change_during_read: POST = %d %v, want 409 drive_source_changed", got.status, got.body)
		}
		var count int
		if err := e.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM drive_task_proposals WHERE workspace_id = $1 AND drive_file_id = $2`,
			e.wsID, fileID,
		).Scan(&count); err != nil || count != 0 {
			t.Fatalf("credential_version_change_during_read: proposals count = %d (err=%v), want 0", count, err)
		}
	})
}

// TestDriveProposalDiscardHooksAndIdempotentDelete verifies that:
//   - DELETE on a ready proposal transitions it to discarded (items = NULL),
//     GET returns status=discarded with items=[], and repeating DELETE is 204
//     idempotent without writing a second audit row;
//   - Unlink and Disconnect (plus org Leave) discard ready proposals in the
//     same transaction with reason=source_unlinked / source_disconnected.
func TestDriveProposalDiscardHooksAndIdempotentDelete(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	conn1 := e.seedConnection(t, e.ownerID, "sub-disc-1", "disc1@example.com")
	conn2 := e.seedConnection(t, e.ownerID, "sub-disc-2", "disc2@example.com")
	file1 := jsonStr(e.linkFile(t, e.ownerTk, conn1, "ext-disc-1", ""), "id")
	file2 := jsonStr(e.linkFile(t, e.ownerTk, conn1, "ext-disc-2", ""), "id")
	file3 := jsonStr(e.linkFile(t, e.ownerTk, conn2, "ext-disc-3", ""), "id")

	propose := func(tk, fID string) string {
		r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fID), tk, map[string]any{})
		if r.StatusCode != http.StatusCreated {
			t.Fatalf("POST task-proposals(%s) = %d %v", fID, r.StatusCode, o)
		}
		return jsonStr(jsonMap(o, "proposal"), "id")
	}

	// 1. User DELETE & idempotency.
	p1 := propose(e.ownerTk, file1)
	p1Path := fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s", e.wsID, p1)
	if r, _ := doJSON(t, e.srv, "DELETE", p1Path, e.ownerTk, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("first DELETE = %d, want 204", r.StatusCode)
	}
	if r, _ := doJSON(t, e.srv, "DELETE", p1Path, e.ownerTk, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("second DELETE (idempotent) = %d, want 204", r.StatusCode)
	}
	var discardAuditCount int
	if err := e.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.orgID, p1,
	).Scan(&discardAuditCount); err != nil || discardAuditCount != 1 {
		t.Fatalf("discard audit count after 2 DELETEs = %d (err=%v), want 1", discardAuditCount, err)
	}
	// GET on a discarded proposal still returns 200 with status="discarded" and items=[].
	if r, o := doJSON(t, e.srv, "GET", p1Path, e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("GET discarded proposal = %d %v, want 200", r.StatusCode, o)
	} else {
		pMap := jsonMap(o, "proposal")
		if jsonStr(pMap, "status") != "discarded" || len(jsonArray(pMap, "items")) != 0 {
			t.Fatalf("GET discarded proposal = %+v, want status=discarded items=[]", pMap)
		}
	}

	// 2. Unlink discards ready proposals on file2 (reason = source_unlinked) using
	// each proposal's saved connection_id (R1-7), and rolls back atomically if a
	// later step in Unlink fails (R1-11).
	p2 := propose(e.ownerTk, file2)

	// Peer connects their own account, grants access on file2, and creates a proposal on file2.
	peerConn := e.seedConnection(t, e.peerID, "sub-disc-peer", "peer-disc@example.com")
	if _, err := e.q.UpsertDriveFileAccessGranted(context.Background(), db.UpsertDriveFileAccessGrantedParams{
		ID:             util.NewID(),
		OrganizationID: e.orgID,
		WorkspaceID:    e.wsID,
		DriveFileID:    file2,
		UserID:         e.peerID,
		ConnectionID:   peerConn,
	}); err != nil {
		t.Fatalf("grant peer access on file2: %v", err)
	}
	p2Peer := propose(e.peerTk, file2)

	// Owner rebinds file2 from conn1 (disc1@example.com) to conn2 (disc2@example.com)
	// BEFORE unlinking file2. p2 was read with conn1, so its discard audit must
	// still name disc1@example.com / sub-disc-1 (not disc2@example.com).
	if r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/rebind", e.wsID, file2), e.ownerTk, map[string]any{
		"connection_id": conn2,
	}); r.StatusCode != http.StatusOK {
		t.Fatalf("rebind file2 to conn2 = %d %v, want 200", r.StatusCode, o)
	}

	p3 := propose(e.ownerTk, file3)

	// R1-11: install a trigger that fails the outer Unlink / Disconnect audit step
	// AFTER the proposal discard hook has run, proving that file/connection state,
	// proposal status/items, and discard audit rows all roll back together.
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION uni_test_b5_hook_rollback() RETURNS trigger
		LANGUAGE plpgsql AS $fn$
		BEGIN
		  IF NEW.organization_id = '`+e.orgID+`' AND NEW.action IN ('drive_file.unlinked', 'drive_connection.disconnected') THEN
		    RAISE EXCEPTION 'simulated post-hook audit failure';
		  END IF;
		  RETURN NEW;
		END;
		$fn$`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `DROP TRIGGER IF EXISTS uni_test_b5_hook_rollback ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `
		CREATE TRIGGER uni_test_b5_hook_rollback
		BEFORE INSERT ON audit_events
		FOR EACH ROW EXECUTE FUNCTION uni_test_b5_hook_rollback()`); err != nil {
		t.Fatal(err)
	}
	dropHookTrigger := func() {
		_, _ = e.pool.Exec(ctx, `DROP TRIGGER IF EXISTS uni_test_b5_hook_rollback ON audit_events`)
		_, _ = e.pool.Exec(ctx, `DROP FUNCTION IF EXISTS uni_test_b5_hook_rollback()`)
	}
	t.Cleanup(dropHookTrigger)

	if r, _ := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s", e.wsID, file2), e.ownerTk, nil); r.StatusCode < 500 {
		t.Fatalf("unlink file2 with failing post-hook trigger = %d, want 5xx", r.StatusCode)
	}
	var file2Unlinked bool
	if err := e.pool.QueryRow(ctx, `SELECT unlinked_at IS NOT NULL FROM drive_files WHERE id = $1`, file2).Scan(&file2Unlinked); err != nil || file2Unlinked {
		t.Fatalf("file2 unlinked after rollback = %v (err=%v), want false", file2Unlinked, err)
	}
	for _, propID := range []string{p2, p2Peer} {
		var st string
		var it []byte
		if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, propID).Scan(&st, &it); err != nil || st != "ready" || len(it) == 0 {
			t.Fatalf("proposal %s after unlink rollback: status=%q len(items)=%d err=%v, want ready with items", propID, st, len(it), err)
		}
		var audCnt int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`, e.orgID, propID).Scan(&audCnt); err != nil || audCnt != 0 {
			t.Fatalf("proposal %s discard audit count after unlink rollback = %d (err=%v), want 0", propID, audCnt, err)
		}
	}

	if r, _ := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-connections/%s", e.wsID, conn2), e.ownerTk, nil); r.StatusCode < 500 {
		t.Fatalf("disconnect conn2 with failing post-hook trigger = %d, want 5xx", r.StatusCode)
	}
	var conn2Disc bool
	if err := e.pool.QueryRow(ctx, `SELECT disconnected_at IS NOT NULL FROM drive_connections WHERE id = $1`, conn2).Scan(&conn2Disc); err != nil || conn2Disc {
		t.Fatalf("conn2 disconnected after rollback = %v (err=%v), want false", conn2Disc, err)
	}
	var p3Status string
	var p3Items []byte
	if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, p3).Scan(&p3Status, &p3Items); err != nil || p3Status != "ready" || len(p3Items) == 0 {
		t.Fatalf("proposal p3 after disconnect rollback: status=%q len(items)=%d err=%v, want ready with items", p3Status, len(p3Items), err)
	}
	var p3AudCnt int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`, e.orgID, p3).Scan(&p3AudCnt); err != nil || p3AudCnt != 0 {
		t.Fatalf("proposal p3 discard audit count after disconnect rollback = %d (err=%v), want 0", p3AudCnt, err)
	}

	dropHookTrigger()

	// Now run Unlink without the trigger: both p2 and p2Peer are discarded and their
	// audit rows record each proposal's own saved connection (conn1 for p2, peerConn for p2Peer).
	if r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s", e.wsID, file2), e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("unlink file2 = %d %v", r.StatusCode, o)
	}
	for _, exp := range []struct {
		propID    string
		wantConn  string
		wantEmail string
		wantSub   string
	}{
		{propID: p2, wantConn: conn1, wantEmail: "disc1@example.com", wantSub: "sub-disc-1"},
		{propID: p2Peer, wantConn: peerConn, wantEmail: "peer-disc@example.com", wantSub: "sub-disc-peer"},
	} {
		var st, reason, email, sub, cid string
		var it []byte
		if err := e.pool.QueryRow(ctx,
			`SELECT status, items FROM drive_task_proposals WHERE id = $1`, exp.propID,
		).Scan(&st, &it); err != nil || st != "discarded" || it != nil {
			t.Fatalf("proposal %s after unlink: status=%q items=%v err=%v, want discarded and nil items", exp.propID, st, it, err)
		}
		if err := e.pool.QueryRow(ctx,
			`SELECT metadata::jsonb->>'reason', metadata::jsonb->>'connection_id', metadata::jsonb->>'google_email', metadata::jsonb->>'google_sub'
			 FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
			e.orgID, exp.propID,
		).Scan(&reason, &cid, &email, &sub); err != nil || reason != "source_unlinked" || cid != exp.wantConn || email != exp.wantEmail || sub != exp.wantSub {
			t.Fatalf("proposal %s discard audit = (reason=%q conn=%q email=%q sub=%q) err=%v, want (source_unlinked, %q, %q, %q)",
				exp.propID, reason, cid, email, sub, err, exp.wantConn, exp.wantEmail, exp.wantSub)
		}
	}

	// 3. Disconnect discards ready proposal on conn2 (reason = source_disconnected).
	if r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-connections/%s", e.wsID, conn2), e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("disconnect conn2 = %d %v", r.StatusCode, o)
	}
	var p3Reason, p3Conn, p3Email, p3Sub string
	if err := e.pool.QueryRow(ctx,
		`SELECT status, items FROM drive_task_proposals WHERE id = $1`, p3,
	).Scan(&p3Status, &p3Items); err != nil || p3Status != "discarded" || p3Items != nil {
		t.Fatalf("proposal p3 after disconnect: status=%q items=%v err=%v, want discarded and nil items", p3Status, p3Items, err)
	}
	if err := e.pool.QueryRow(ctx,
		`SELECT metadata::jsonb->>'reason', metadata::jsonb->>'connection_id', metadata::jsonb->>'google_email', metadata::jsonb->>'google_sub'
		 FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.orgID, p3,
	).Scan(&p3Reason, &p3Conn, &p3Email, &p3Sub); err != nil || p3Reason != "source_disconnected" || p3Conn != conn2 || p3Email != "disc2@example.com" || p3Sub != "sub-disc-2" {
		t.Fatalf("proposal p3 discard audit = (reason=%q conn=%q email=%q sub=%q) err=%v, want (source_disconnected, %q, disc2@example.com, sub-disc-2)",
			p3Reason, p3Conn, p3Email, p3Sub, err, conn2)
	}
}

// TestDriveProposalErrorMappings (contract §5, §6; R1-4, R1-5, R1-6, R1-9)
// verifies HTTP status and error codes for feature_disabled, invalid_request,
// 404 not_found on unknown/foreign references, pre-read 409 drive_access_required
// without calling ReadForAI, 422 drive_format_unsupported for all four coded
// reader format/unreadability errors, 503 drive_extract_unavailable,
// 502 ai_output_invalid, and OpenAPI status codes (201 create, 204 delete).
func TestDriveProposalErrorMappings(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-err-map", "err-map@example.com")
	taskID := e.createTask(t, e.ownerTk, "Task with Drive file")
	linked := e.linkFile(t, e.ownerTk, ownerConn, "ext-err-map", taskID)
	fileID := jsonStr(linked, "id")
	proposePath := fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID)

	// Create one valid proposal so we can also test unknown references on POST .../duplicates.
	okRes, okOut := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{})
	if okRes.StatusCode != http.StatusCreated {
		t.Fatalf("initial POST task-proposals = %d %v, want 201", okRes.StatusCode, okOut)
	}
	propID := jsonStr(jsonMap(okOut, "proposal"), "id")
	dupPath := fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s/duplicates", e.wsID, propID)

	// 1. Prompt > 500 runes -> 400 invalid_request.
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{
		"prompt": strings.Repeat("a", 501),
	}); r.StatusCode != http.StatusBadRequest || jsonErrCode(o) != "invalid_request" {
		t.Fatalf("prompt > 500 runes = %d %v, want 400 invalid_request", r.StatusCode, o)
	}

	// 2. R1-5: Foreign/unknown project_id, parent_task_id, context_task_id -> 404 not_found on POST task-proposals and POST duplicates.
	for _, field := range []string{"project_id", "parent_task_id", "context_task_id"} {
		if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{
			field: "01NONEXISTENT0000000000000",
		}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
			t.Fatalf("propose unknown %s = %d %v, want 404 not_found", field, r.StatusCode, o)
		}
	}
	for _, field := range []string{"project_id", "parent_task_id"} {
		if r, o := doJSON(t, e.srv, "POST", dupPath, e.ownerTk, map[string]any{
			field:    "01NONEXISTENT0000000000000",
			"titles": []string{"Task title"},
		}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
			t.Fatalf("duplicates unknown %s = %d %v, want 404 not_found", field, r.StatusCode, o)
		}
	}

	// 3. R1-4: Peer has no granted drive_file_access -> 409 drive_access_required
	// BEFORE ReadForAI is invoked, even if a fake ReadForAI would grant access and
	// bump credential_version.
	peerConn := e.seedConnection(t, e.peerID, "sub-peer-err-map", "peer-err-map@example.com")
	var readCalled atomic.Bool
	fakeReader := &fakeDriveContentReader{
		fn: func(ctx context.Context, requesterID, workspaceID, driveFileID string, purpose service.DriveContentPurpose) (service.DriveContent, error) {
			readCalled.Store(true)
			_, _ = e.q.UpsertDriveFileAccessGranted(ctx, db.UpsertDriveFileAccessGrantedParams{
				ID:             util.NewID(),
				OrganizationID: e.orgID,
				WorkspaceID:    workspaceID,
				DriveFileID:    driveFileID,
				UserID:         requesterID,
				ConnectionID:   peerConn,
			})
			_, _ = e.pool.Exec(ctx, `UPDATE drive_connections SET credential_version = credential_version + 1 WHERE id = $1`, peerConn)
			return service.DriveContent{
				DriveFileID: driveFileID,
				Name:        "Should Never Be Read",
				MimeType:    service.DriveMimeGoogleDoc,
				Text:        "Should not happen",
			}, nil
		},
	}
	e.deps.DriveTaskProposals.SetDriveContentReader(fakeReader)
	defer e.deps.DriveTaskProposals.SetDriveContentReader(e.contentSvc)

	if r, o := doJSON(t, e.srv, "POST", proposePath, e.peerTk, map[string]any{}); r.StatusCode != http.StatusConflict || jsonErrCode(o) != sdo.DriveErrAccessRequired {
		t.Fatalf("peer without granted access = %d %v, want 409 drive_access_required", r.StatusCode, o)
	}
	if readCalled.Load() {
		t.Fatalf("ReadForAI was called when caller had no initial granted drive_file_access")
	}

	// 4. R1-6: ReadForAI errors: bare ErrDriveFormatUnsupported and all four coded
	// reader format/unreadability errors (drive_file_too_large, password_required,
	// corrupted, not_office_file) map to 422 drive_format_unsupported; 503
	// drive_extract_unavailable stays distinct.
	fakeReader.fn = nil
	for _, formatErr := range []error{
		service.ErrDriveFormatUnsupported,
		service.CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "drive_file_too_large",
			Msg:    "Tệp Google Drive vượt quá giới hạn dung lượng đọc của UNI.",
			Err:    service.ErrDriveFormatUnsupported,
		},
		service.CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "password_required",
			Msg:    "Tệp đặt mật khẩu nên UNI không đọc được.",
			Fields: map[string]any{"reason": "password_required"},
			Err:    service.ErrDriveFileUnreadable,
		},
		service.CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "corrupted",
			Msg:    "Tệp Office bị hỏng hoặc không đọc được.",
			Fields: map[string]any{"reason": "corrupted"},
			Err:    service.ErrDriveFileUnreadable,
		},
		service.CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "not_office_file",
			Msg:    "UNI chưa đọc được định dạng này.",
			Fields: map[string]any{"reason": "not_office_file"},
			Err:    service.ErrDriveFormatUnsupported,
		},
	} {
		fakeReader.err = formatErr
		if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{}); r.StatusCode != http.StatusUnprocessableEntity || jsonErrCode(o) != sdo.DriveErrFormatUnsupported {
			t.Fatalf("reader error %v = %d %v, want 422 drive_format_unsupported", formatErr, r.StatusCode, o)
		}
	}

	fakeReader.err = service.ErrDriveExtractUnavailable
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{}); r.StatusCode != http.StatusServiceUnavailable || jsonErrCode(o) != sdo.DriveErrExtractUnavailable {
		t.Fatalf("extract unavailable = %d %v, want 503 drive_extract_unavailable", r.StatusCode, o)
	}

	// 5. AI invalid output -> 502 ai_output_invalid.
	fakeReader.err = nil
	fakeReader.content = service.DriveContent{
		DriveFileID: fileID,
		Name:        "Spec Document",
		MimeType:    service.DriveMimeGoogleDoc,
		Text:        "Some content",
	}
	e.aiMu.Lock()
	e.aiReply = func(provider.CompletionRequest) (provider.CompletionResponse, error) {
		return provider.CompletionResponse{Text: `not-json-at-all`, Model: "fake"}, nil
	}
	e.aiMu.Unlock()
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{}); r.StatusCode != http.StatusBadGateway || jsonErrCode(o) != "ai_output_invalid" {
		t.Fatalf("ai invalid output = %d %v, want 502 ai_output_invalid", r.StatusCode, o)
	}

	// 6. Feature flag off -> 404 feature_disabled.
	var callCount atomic.Int32
	e.flagRules.Set("drive_connector", featureflag.Rule{Default: false})
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != sdo.DriveErrFeatureDisabled {
		t.Fatalf("flag off = %d %v, want 404 feature_disabled (calls=%d)", r.StatusCode, o, callCount.Load())
	}
	e.flagRules.Set("drive_connector", featureflag.Rule{Default: true})

	// 7. R1-9: Generated OpenAPI spec advertises 201 on POST task-proposals (with
	// "20" max items in description) and 204 on DELETE drive-task-proposals/{proposalID}.
	swagRes, swagDoc := doJSON(t, e.srv, "GET", "/swagger/doc.json", "", nil)
	if swagRes.StatusCode != http.StatusOK {
		t.Fatalf("GET /swagger/doc.json = %d, want 200", swagRes.StatusCode)
	}
	paths := jsonMap(swagDoc, "paths")
	postOp := jsonMap(jsonMap(paths, "/api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals"), "post")
	if jsonMap(jsonMap(postOp, "responses"), "201") == nil {
		t.Fatalf("OpenAPI POST task-proposals responses = %+v, want 201", jsonMap(postOp, "responses"))
	}
	if desc := jsonStr(postOp, "description"); !strings.Contains(desc, "20") || strings.Contains(desc, "25") {
		t.Fatalf("OpenAPI POST task-proposals description = %q, want 20 (not 25)", desc)
	}
	itemPath := jsonMap(paths, "/api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}")
	delOp := jsonMap(itemPath, "delete")
	if jsonMap(jsonMap(delOp, "responses"), "204") == nil {
		t.Fatalf("OpenAPI DELETE drive-task-proposals/{proposalID} responses = %+v, want 204", jsonMap(delOp, "responses"))
	}
	getOp := jsonMap(itemPath, "get")
	if getDesc := jsonStr(getOp, "description"); !strings.Contains(getDesc, "converted") || !strings.Contains(getDesc, "discarded") {
		t.Fatalf("OpenAPI GET drive-task-proposals/{proposalID} description = %q, want terminal/expired state wording", getDesc)
	}
}

// TestCreateTasksFromDriveProposalHTTPAndProvenance verifies the HTTP contract
// of POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks
// (spec §8.5, §8.8):
//   - 201 sdo.DriveProposalTasksCreatedSDO with task_ids and 0-based items[{index, task_id}].
//   - Intra-batch dependency edge created in the same transaction.
//   - 409 active_duplicate_task with fields.item_indexes, and allow_duplicate override.
//   - 422 parent_cycle on cyclic blocked_by_indexes.
//   - 400 invalid_request on unselected blocked_by_indexes or out-of-range index.
//   - 409 proposal_not_ready on second submit, 410 proposal_expired on expired proposal,
//     and 409 drive_source_changed when the caller's access is lost before convert.
//   - tasks_created and task_creations / prior_creations populated on GET /drive-files,
//     GET /drive-files/{id}, GET /tasks/{id}/drive-files, and subsequent POST /task-proposals.
func TestCreateTasksFromDriveProposalHTTPAndProvenance(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-http-b6", "http-b6@example.com")
	linked := e.linkFile(t, e.ownerTk, ownerConn, "ext-http-b6", "")
	fileID := jsonStr(linked, "id")

	e.aiMu.Lock()
	e.aiReply = func(provider.CompletionRequest) (provider.CompletionResponse, error) {
		return provider.CompletionResponse{
			Text: `{"items":[
				{"title":"HTTP Task 0","assignee_member_id":"","assignee_basis":"","priority":"high","priority_basis":"","start_date":"2026-10-27","start_basis":"","due_date":"2026-11-05","due_basis":"","label_ids":[],"label_basis":"","goal":"G0","checklist":["C0"],"excerpt":{"section":"S0","quote":"Q0"},"blocked_by_indexes":[]},
				{"title":"HTTP Task 1","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"G1","checklist":[],"excerpt":{"section":"S1","quote":"Q1"},"blocked_by_indexes":[0]}
			]}`,
			Model: "fake",
		}, nil
	}
	e.aiMu.Unlock()

	proposePath := fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID)
	propRes, propOut := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{"prompt": "Extract HTTP tasks"})
	if propRes.StatusCode != http.StatusCreated {
		t.Fatalf("POST task-proposals = %d %v, want 201", propRes.StatusCode, propOut)
	}
	proposalID := jsonStr(jsonMap(propOut, "proposal"), "id")
	tasksPath := fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s/tasks", e.wsID, proposalID)

	// 1. Cycle in blocked_by_indexes -> 422 parent_cycle.
	if r, o := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{
			map[string]any{"index": 0, "title": "Cycle 0", "description": "D0", "blocked_by_indexes": []int{1}},
			map[string]any{"index": 1, "title": "Cycle 1", "description": "D1", "blocked_by_indexes": []int{0}},
		},
	}); r.StatusCode != http.StatusUnprocessableEntity || jsonErrCode(o) != "parent_cycle" {
		t.Fatalf("cycle POST tasks = %d %v, want 422 parent_cycle", r.StatusCode, o)
	}

	// 2. Reference to unselected index -> 400 invalid_request.
	if r, o := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{
			map[string]any{"index": 1, "title": "Only 1", "description": "D1", "blocked_by_indexes": []int{0}},
		},
	}); r.StatusCode != http.StatusBadRequest || jsonErrCode(o) != "invalid_request" {
		t.Fatalf("unselected blocked_by POST tasks = %d %v, want 400 invalid_request", r.StatusCode, o)
	}

	// 3. Duplicate refusal -> 409 active_duplicate_task with fields.item_indexes.
	_ = e.createTask(t, e.ownerTk, "Existing Duplicate HTTP Task")
	dupRes, dupOut := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{
			map[string]any{"index": 0, "title": "existing duplicate http task", "description": "D0"},
			map[string]any{"index": 1, "title": "Fresh Task 1", "description": "D1"},
		},
	})
	if dupRes.StatusCode != http.StatusConflict || jsonErrCode(dupOut) != "active_duplicate_task" {
		t.Fatalf("duplicate POST tasks = %d %v, want 409 active_duplicate_task", dupRes.StatusCode, dupOut)
	}
	errFields := jsonMap(jsonMap(dupOut, "error"), "fields")
	itemIndexes := jsonArray(errFields, "item_indexes")
	if len(itemIndexes) != 1 || itemIndexes[0] != float64(0) {
		t.Fatalf("active_duplicate_task fields.item_indexes = %v, want [0]", itemIndexes)
	}

	// 4. Successful batch create (with allow_duplicate: true on item 0, blocked_by_indexes: [0] on item 1,
	// and excerpt-bearing descriptions) -> 201 Created.
	wantHTTPDesc0 := "## Mục tiêu\nMục HTTP 0\n\n> **Trích đoạn (S0):** \"Q0 — trích dẫn gốc giữ nguyên\""
	wantHTTPDesc1 := "## Mục tiêu\nMục HTTP 1\n\n> **Trích đoạn (S1):** \"Q1\""
	createRes, createOut := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{
			map[string]any{
				"index":              0,
				"title":              "Existing Duplicate HTTP Task",
				"description":        wantHTTPDesc0,
				"priority":           "high",
				"start_date":         "2026-10-27",
				"due_date":           "2026-11-05",
				"allow_duplicate":    true,
				"blocked_by_indexes": []int{},
			},
			map[string]any{
				"index":              1,
				"title":              "Confirmed HTTP Task 1",
				"description":        wantHTTPDesc1,
				"priority":           "medium",
				"blocked_by_indexes": []int{0},
			},
		},
	})
	if createRes.StatusCode != http.StatusCreated {
		t.Fatalf("POST tasks = %d %v, want 201", createRes.StatusCode, createOut)
	}
	var createdSDO sdo.DriveProposalTasksCreatedSDO
	rawCreated, _ := json.Marshal(createOut)
	if err := json.Unmarshal(rawCreated, &createdSDO); err != nil {
		t.Fatalf("unmarshal DriveProposalTasksCreatedSDO: %v", err)
	}
	if len(createdSDO.TaskIDs) != 2 || len(createdSDO.Items) != 2 ||
		createdSDO.Items[0].Index != 0 || createdSDO.Items[0].TaskID != createdSDO.TaskIDs[0] ||
		createdSDO.Items[1].Index != 1 || createdSDO.Items[1].TaskID != createdSDO.TaskIDs[1] {
		t.Fatalf("createdSDO = %+v", createdSDO)
	}

	// 5. Re-submitting the converted proposal -> 409 proposal_not_ready.
	if r, o := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Retry", "description": "D"}},
	}); r.StatusCode != http.StatusConflict || jsonErrCode(o) != sdo.DriveErrProposalNotReady {
		t.Fatalf("second POST tasks = %d %v, want 409 proposal_not_ready", r.StatusCode, o)
	}

	// Delete the converted proposal row (simulating hourly retention sweep) and verify task description
	// with excerpt and §8.8 tasks_created / task_creations survive proposal deletion (R8, R9).
	if _, err := e.pool.Exec(context.Background(), `DELETE FROM drive_task_proposals WHERE id = $1`, proposalID); err != nil {
		t.Fatalf("delete converted proposal %s: %v", proposalID, err)
	}
	var gotTask0Desc string
	if err := e.pool.QueryRow(context.Background(), `SELECT description FROM tasks WHERE id = $1`, createdSDO.TaskIDs[0]).Scan(&gotTask0Desc); err != nil || gotTask0Desc != wantHTTPDesc0 {
		t.Fatalf("task[0] description after proposal delete = %q (err=%v), want %q", gotTask0Desc, err, wantHTTPDesc0)
	}
	// Re-submitting after the proposal row is purged -> 404 not_found.
	if r, o := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Retry", "description": "D"}},
	}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("post-delete POST tasks = %d %v, want 404 not_found", r.StatusCode, o)
	}

	// 6. Verify §8.8 on GET /drive-files/{id}, GET /drive-files, GET /tasks/{id}/drive-files, and next POST /task-proposals.
	fileRes, fileOut := doJSON(t, e.srv, "GET", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s", e.wsID, fileID), e.ownerTk, nil)
	if fileRes.StatusCode != http.StatusOK {
		t.Fatalf("GET drive-file = %d %v, want 200", fileRes.StatusCode, fileOut)
	}
	fileDTO := jsonMap(fileOut, "file")
	tcSummary := jsonMap(fileDTO, "tasks_created")
	if tcSummary["count"] != float64(2) || jsonStr(tcSummary, "last_created_at") == "" {
		t.Fatalf("GET drive-file tasks_created = %v, want count=2 and last_created_at", tcSummary)
	}
	tcGroups := jsonArray(fileDTO, "task_creations")
	if len(tcGroups) != 1 {
		t.Fatalf("GET drive-file task_creations = %v, want 1 group", tcGroups)
	}

	taskCardsRes, taskCardsOut := doJSON(t, e.srv, "GET", fmt.Sprintf("/api/v1/tasks/%s/drive-files", createdSDO.TaskIDs[0]), e.ownerTk, nil)
	if taskCardsRes.StatusCode != http.StatusOK {
		t.Fatalf("GET task drive-files = %d %v, want 200", taskCardsRes.StatusCode, taskCardsOut)
	}
	cardList := jsonArray(taskCardsOut, "files")
	if len(cardList) != 1 || jsonMap(cardList[0].(map[string]any), "tasks_created")["count"] != float64(2) {
		t.Fatalf("GET task drive-files cards = %v, want 1 card with tasks_created.count=2", cardList)
	}

	// Next proposal on the same file includes prior_creations and tasks_created!
	prop2Res, prop2Out := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{})
	if prop2Res.StatusCode != http.StatusCreated {
		t.Fatalf("POST second task-proposals = %d %v, want 201", prop2Res.StatusCode, prop2Out)
	}
	prop2Obj := jsonMap(prop2Out, "proposal")
	if jsonMap(prop2Obj, "tasks_created")["count"] != float64(2) || len(jsonArray(prop2Obj, "prior_creations")) != 1 {
		t.Fatalf("second proposal prior_creations = %v / %v, want count=2 and 1 group", jsonMap(prop2Obj, "tasks_created"), jsonArray(prop2Obj, "prior_creations"))
	}

	// Expired proposal -> 410 proposal_expired.
	propExpRes, propExpOut := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{})
	if propExpRes.StatusCode != http.StatusCreated {
		t.Fatalf("POST expired task-proposals = %d %v, want 201", propExpRes.StatusCode, propExpOut)
	}
	propExpID := jsonStr(jsonMap(propExpOut, "proposal"), "id")
	if _, err := e.pool.Exec(context.Background(), `UPDATE drive_task_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, propExpID); err != nil {
		t.Fatalf("expire proposal %s: %v", propExpID, err)
	}
	if r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s/tasks", e.wsID, propExpID), e.ownerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "After expiry", "description": "D"}},
	}); r.StatusCode != http.StatusGone || jsonErrCode(o) != sdo.DriveErrProposalExpired {
		t.Fatalf("POST tasks on expired proposal = %d %v, want 410 proposal_expired", r.StatusCode, o)
	}

	// Mark access lost on fileID -> POST .../tasks on prop2 returns 409 drive_source_changed.
	prop2ID := jsonStr(prop2Obj, "id")
	_, _ = e.q.MarkDriveFileAccessLost(context.Background(), db.MarkDriveFileAccessLostParams{
		OrganizationID: e.orgID,
		WorkspaceID:    e.wsID,
		DriveFileID:    fileID,
		UserID:         e.ownerID,
		ConnectionID:   ownerConn,
	})
	if r, o := doJSON(t, e.srv, "POST", fmt.Sprintf("/api/v1/workspaces/%s/drive-task-proposals/%s/tasks", e.wsID, prop2ID), e.ownerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "After access lost", "description": "D"}},
	}); r.StatusCode != http.StatusConflict || jsonErrCode(o) != sdo.DriveErrSourceChanged {
		t.Fatalf("POST tasks after access lost = %d %v, want 409 drive_source_changed", r.StatusCode, o)
	}
}

func TestCreateTasksFromDriveProposalUnavailableAndBodyValidation(t *testing.T) {
	t.Parallel()
	h := &handlers{}

	// 1. Nil DriveTaskProposals service -> 503 drive_unavailable.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/w1/drive-task-proposals/p1/tasks", strings.NewReader(`{"items":[{"index":0,"title":"T","description":"D"}]}`))
	h.CreateTasksFromDriveProposal(rec, req)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), sdo.DriveErrUnavailable) {
		t.Fatalf("nil service = %d %s, want 503 %s", rec.Code, rec.Body.String(), sdo.DriveErrUnavailable)
	}

	// 2. Malformed JSON with non-nil service -> 400 invalid_request via decode.
	hWithSvc := &handlers{Deps: Deps{DriveTaskProposals: &service.DriveTaskProposalService{}}}
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/w1/drive-task-proposals/p1/tasks", strings.NewReader(`{not-json`))
	hWithSvc.CreateTasksFromDriveProposal(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("malformed JSON = %d %s, want 400", rec2.Code, rec2.Body.String())
	}

	// 3. toDriveProposalTasksCreatedSDO maps nil TaskIDs to empty slice [] and preserves 0-based index mappings.
	sdoOut := toDriveProposalTasksCreatedSDO(service.CreateTasksFromProposalResult{
		TaskIDs: nil,
		Items: []service.CreatedDriveProposalTask{
			{Index: 0, TaskID: "01TASK0"},
			{Index: 3, TaskID: "01TASK3"},
		},
	})
	if sdoOut.TaskIDs == nil || len(sdoOut.TaskIDs) != 0 || len(sdoOut.Items) != 2 || sdoOut.Items[1].Index != 3 || sdoOut.Items[1].TaskID != "01TASK3" {
		t.Fatalf("toDriveProposalTasksCreatedSDO = %+v", sdoOut)
	}
}
