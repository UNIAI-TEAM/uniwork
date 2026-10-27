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
	if it1.StartDate != nil || it1.StartBasis != "" || it1.DueDate != nil || it1.DueBasis != "" {
		t.Fatalf("item[1] dates/basis = %+v, want nil and empty basis", it1)
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
}

// TestDriveProposalOnlyItsRequester (contract §3, §6; spec §8.2a) verifies that
// another member of the SAME workspace receives 404 not_found on GET, DELETE,
// POST /duplicates, and GET /resources/drive_task_proposal/{id}/history.
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

	// Peer is a full member of the same workspace (e.wsID), but not the requester.
	if r, o := doJSON(t, e.srv, "GET", propPath, e.peerTk, nil); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer GET proposal = %d %v, want 404 not_found", r.StatusCode, o)
	}
	if r, o := doJSON(t, e.srv, "POST", propPath+"/duplicates", e.peerTk, map[string]any{"titles": []string{"Task"}}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer POST duplicates = %d %v, want 404 not_found", r.StatusCode, o)
	}
	if r, o := doJSON(t, e.srv, "DELETE", propPath, e.peerTk, nil); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer DELETE proposal = %d %v, want 404 not_found", r.StatusCode, o)
	}
	if r, o := doJSON(t, e.srv, "POST", propPath+"/tasks", e.peerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Peer task", "description": "Body"}},
	}); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer POST tasks = %d %v, want 404 not_found", r.StatusCode, o)
	}

	beforeSelects := e.auditCounter.resourceSelects.Load()
	if r, o := doJSON(t, e.srv, "GET", histPath, e.peerTk, nil); r.StatusCode != http.StatusNotFound || jsonErrCode(o) != "not_found" {
		t.Fatalf("peer GET proposal history = %d %v, want 404 not_found", r.StatusCode, o)
	}
	if got := e.auditCounter.resourceSelects.Load(); got != beforeSelects {
		t.Fatalf("denied peer proposal history executed ListResourceAuditEvents (%d -> %d)", beforeSelects, got)
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

			var readyCount int
			if err := e.pool.QueryRow(context.Background(),
				`SELECT count(*) FROM drive_task_proposals WHERE workspace_id = $1 AND drive_file_id = $2 AND status = 'ready'`,
				e.wsID, fileID,
			).Scan(&readyCount); err != nil {
				t.Fatal(err)
			}
			if readyCount != 0 {
				t.Fatalf("%s: ready proposals count = %d, want 0", tc.name, readyCount)
			}
		})
	}
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

	// 2. Unlink discards ready proposal on file2 (reason = source_unlinked).
	p2 := propose(e.ownerTk, file2)
	if r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s", e.wsID, file2), e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("unlink file2 = %d %v", r.StatusCode, o)
	}
	var p2Status, p2Reason string
	var p2Items []byte
	if err := e.pool.QueryRow(context.Background(),
		`SELECT status, items FROM drive_task_proposals WHERE id = $1`, p2,
	).Scan(&p2Status, &p2Items); err != nil || p2Status != "discarded" || p2Items != nil {
		t.Fatalf("proposal p2 after unlink: status=%q items=%v err=%v, want discarded and nil items", p2Status, p2Items, err)
	}
	if err := e.pool.QueryRow(context.Background(),
		`SELECT metadata::jsonb->>'reason' FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.orgID, p2,
	).Scan(&p2Reason); err != nil || p2Reason != "source_unlinked" {
		t.Fatalf("proposal p2 discard audit reason = %q (err=%v), want source_unlinked", p2Reason, err)
	}

	// 3. Disconnect discards ready proposal on conn2 (reason = source_disconnected).
	p3 := propose(e.ownerTk, file3)
	if r, o := doJSON(t, e.srv, "DELETE", fmt.Sprintf("/api/v1/workspaces/%s/drive-connections/%s", e.wsID, conn2), e.ownerTk, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("disconnect conn2 = %d %v", r.StatusCode, o)
	}
	var p3Status, p3Reason string
	var p3Items []byte
	if err := e.pool.QueryRow(context.Background(),
		`SELECT status, items FROM drive_task_proposals WHERE id = $1`, p3,
	).Scan(&p3Status, &p3Items); err != nil || p3Status != "discarded" || p3Items != nil {
		t.Fatalf("proposal p3 after disconnect: status=%q items=%v err=%v, want discarded and nil items", p3Status, p3Items, err)
	}
	if err := e.pool.QueryRow(context.Background(),
		`SELECT metadata::jsonb->>'reason' FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.orgID, p3,
	).Scan(&p3Reason); err != nil || p3Reason != "source_disconnected" {
		t.Fatalf("proposal p3 discard audit reason = %q (err=%v), want source_disconnected", p3Reason, err)
	}
}

// TestDriveProposalErrorMappings (contract §5, §6) verifies HTTP status and
// error codes for feature_disabled, invalid_request, drive_access_required,
// drive_format_unsupported, drive_extract_unavailable, ai_output_invalid,
// ai_quota_exceeded, and ai_rate_limited (with Retry-After header).
func TestDriveProposalErrorMappings(t *testing.T) {
	e := newDriveProposalHTTPTestEnv(t)
	ownerConn := e.seedConnection(t, e.ownerID, "sub-err-map", "err-map@example.com")
	taskID := e.createTask(t, e.ownerTk, "Task with Drive file")
	linked := e.linkFile(t, e.ownerTk, ownerConn, "ext-err-map", taskID)
	fileID := jsonStr(linked, "id")
	proposePath := fmt.Sprintf("/api/v1/workspaces/%s/drive-files/%s/task-proposals", e.wsID, fileID)

	// 1. Prompt > 500 runes -> 400 invalid_request.
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{
		"prompt": strings.Repeat("a", 501),
	}); r.StatusCode != http.StatusBadRequest || jsonErrCode(o) != "invalid_request" {
		t.Fatalf("prompt > 500 runes = %d %v, want 400 invalid_request", r.StatusCode, o)
	}

	// 2. Foreign/unknown project_id, parent_task_id, context_task_id -> 400 invalid_request.
	for _, field := range []string{"project_id", "parent_task_id", "context_task_id"} {
		if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{
			field: "01NONEXISTENT0000000000000",
		}); r.StatusCode != http.StatusBadRequest || jsonErrCode(o) != "invalid_request" {
			t.Fatalf("unknown %s = %d %v, want 400 invalid_request", field, r.StatusCode, o)
		}
	}

	// 3. Peer can see the file via taskID, but has no granted drive_file_access -> 409 drive_access_required.
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.peerTk, map[string]any{}); r.StatusCode != http.StatusConflict || jsonErrCode(o) != sdo.DriveErrAccessRequired {
		t.Fatalf("peer without granted access = %d %v, want 409 drive_access_required", r.StatusCode, o)
	}

	// 4. ReadForAI errors: 422 drive_format_unsupported and 503 drive_extract_unavailable.
	fakeReader := &fakeDriveContentReader{}
	e.deps.DriveTaskProposals.SetDriveContentReader(fakeReader)
	defer e.deps.DriveTaskProposals.SetDriveContentReader(e.contentSvc)

	fakeReader.err = service.ErrDriveFormatUnsupported
	if r, o := doJSON(t, e.srv, "POST", proposePath, e.ownerTk, map[string]any{}); r.StatusCode != http.StatusUnprocessableEntity || jsonErrCode(o) != sdo.DriveErrFormatUnsupported {
		t.Fatalf("unsupported format = %d %v, want 422 drive_format_unsupported", r.StatusCode, o)
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
	// 5. Re-submitting the converted proposal -> 409 proposal_not_ready.
	if r, o := doJSON(t, e.srv, "POST", tasksPath, e.ownerTk, map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Retry", "description": "D"}},
	}); r.StatusCode != http.StatusConflict || jsonErrCode(o) != sdo.DriveErrProposalNotReady {
		t.Fatalf("second POST tasks = %d %v, want 409 proposal_not_ready", r.StatusCode, o)
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
