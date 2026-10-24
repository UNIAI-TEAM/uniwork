package handler

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memWorld is a server with real flag overrides, one organization with an
// owner, a workspace and a plain member, and Ask UNI wired to the memory service.
type memWorld struct {
	srv           *httptest.Server
	q             *db.Queries
	owner, member string
	wsID, orgID   string
	ownerID       string
}

func newMemWorld(t *testing.T) *memWorld {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	gw := service.NewAIGateway(pool, q, &provider.Fake{Reply: ai.FakeReply}, ai.Options{})
	d.AskUNI = service.NewAskUNIService(pool, q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	d.AskUNI.SetFlags(d.FeatureFlags)
	d.AskUNI.SetReadTools(service.NewMcpToolService(q, d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin))
	d.AiMemory = service.NewAiMemoryService(pool, q, d.Organizations, d.Workspaces)
	d.AiMemory.SetFlags(d.FeatureFlags)
	d.AskUNI.SetMemory(d.AiMemory)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := &memWorld{srv: srv, q: q}
	w.owner, w.wsID = registerOrgWorkspace(t, srv, "aimem-owner@example.com", "Owner", "aimem")
	var memberID string
	w.member, memberID = signUp(t, srv, "aimem-member@example.com", "Member")
	w.ownerID = meID(t, srv, w.owner)
	if err := pool.QueryRow(context.Background(), `SELECT organization_id FROM workspaces WHERE id = $1`, w.wsID).Scan(&w.orgID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, memberID); err != nil {
		t.Fatal(err)
	}
	return w
}

// flag sets a flag override; scope is global or organization.
func (w *memWorld) flag(t *testing.T, key, scope, scopeID string, on bool) {
	t.Helper()
	if _, err := w.q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: key, ScopeType: scope, ScopeID: scopeID, Enabled: on, Note: "ai memory handler test", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	testFlagOverrides.Invalidate()
}

func (w *memWorld) call(t *testing.T, token, method, path string, body any) (int, map[string]any) {
	t.Helper()
	res, out := doJSON(t, w.srv, method, path, token, body)
	return res.StatusCode, out
}

func errCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func TestAiMemoryRoutesMapErrors(t *testing.T) {
	w := newMemWorld(t)
	base := "/api/v1/orgs/aimem/ai/memory"
	if s, out := w.call(t, w.owner, "GET", base, nil); s != 403 || errCode(out) != "ai_memory_disabled" {
		t.Fatalf("flag off list: %d %v", s, out)
	}
	w.flag(t, "ask_uni_memory", featureflags.ScopeGlobal, "", true)

	s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": "Tôi làm ở phòng kinh doanh"})
	if s != 201 || out["id"] == "" || out["source"] != "manual" || out["text"] != "Tôi làm ở phòng kinh doanh" {
		t.Fatalf("create: %d %v", s, out)
	}
	id, _ := out["id"].(string)
	if s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": "  tôi làm ở phòng kinh doanh "}); s != 409 || errCode(out) != "ai_memory_duplicate" {
		t.Fatalf("duplicate: %d %v", s, out)
	}
	if s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": "hai\ndòng"}); s != 400 {
		t.Fatalf("multi-line: %d %v", s, out)
	}
	if s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "mood", "text": "x"}); s != 400 {
		t.Fatalf("bad kind: %d %v", s, out)
	}

	// Someone else's entry, and an id that names nothing, answer alike and reveal no text.
	s, theirs := w.call(t, w.member, "POST", base, map[string]any{"kind": "preference", "text": "Trả lời ngắn gọn"})
	if s != 201 {
		t.Fatalf("member create: %d %v", s, theirs)
	}
	for _, mid := range []string{theirs["id"].(string), util.NewID()} {
		s, out := w.call(t, w.owner, "PATCH", base+"/"+mid, map[string]any{"text": "đổi"})
		if s != 404 || strings.Contains(fmt.Sprint(out), "Trả lời ngắn gọn") {
			t.Fatalf("patch %s: %d %v", mid, s, out)
		}
		if s, _ := w.call(t, w.owner, "DELETE", base+"/"+mid, nil); s != 404 {
			t.Fatalf("delete %s: %d", mid, s)
		}
	}
	if s, out := w.call(t, w.owner, "PATCH", base+"/"+id, map[string]any{"text": "Tôi làm ở phòng nhân sự"}); s != 200 || out["text"] != "Tôi làm ở phòng nhân sự" {
		t.Fatalf("patch own: %d %v", s, out)
	}

	// A body over 1 MiB is refused by decode.
	if s, _ := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": strings.Repeat("a", 1<<20+1)}); s != 413 {
		t.Fatalf("big body: %d", s)
	}

	// The cap: 49 more fill the list to 50, the 51st is refused.
	for i := 0; i < 49; i++ {
		if s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": fmt.Sprintf("mục số %d", i)}); s != 201 {
			t.Fatalf("fill %d: %d %v", i, s, out)
		}
	}
	if s, out := w.call(t, w.owner, "POST", base, map[string]any{"kind": "fact", "text": "mục thừa"}); s != 409 || errCode(out) != "ai_memory_full" {
		t.Fatalf("full: %d %v", s, out)
	}
	s, out = w.call(t, w.owner, "GET", base, nil)
	if entries, _ := out["entries"].([]any); s != 200 || len(entries) != 50 || out["limit"].(float64) != 50 || out["remaining"].(float64) != 0 || out["on"] != true {
		t.Fatalf("list: %d %v", s, out)
	}
	if s, _ := w.call(t, w.owner, "DELETE", base+"/"+id, nil); s != 204 {
		t.Fatalf("delete own: %d", s)
	}
	if s, out := w.call(t, w.owner, "DELETE", base, nil); s != 200 || out["deleted"].(float64) != 49 {
		t.Fatalf("clear: %d %v", s, out)
	}
	// The member's own list is untouched.
	if _, out := w.call(t, w.member, "GET", base, nil); len(out["entries"].([]any)) != 1 {
		t.Fatalf("member list: %v", out)
	}
	// A stranger to the organization is refused.
	stranger, _ := signUp(t, w.srv, "aimem-stranger@example.com", "Stranger")
	if s, _ := w.call(t, stranger, "GET", base, nil); s != 403 && s != 404 {
		t.Fatalf("stranger: %d", s)
	}
}

func TestCapabilitiesReportMemory(t *testing.T) {
	w := newMemWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/ai/capabilities"
	memory := func() map[string]any {
		s, out := w.call(t, w.owner, "GET", path, nil)
		m, _ := out["memory"].(map[string]any)
		if s != 200 || m == nil {
			t.Fatalf("capabilities: %d %v", s, out)
		}
		return m
	}
	w.flag(t, "ask_uni_agent", featureflags.ScopeGlobal, "", true)
	if m := memory(); m["enabled"] != false || m["on"] != true {
		t.Fatalf("flag off: %v", m)
	}
	w.flag(t, "ask_uni_memory", featureflags.ScopeGlobal, "", true)
	if m := memory(); m["enabled"] != true || m["on"] != true {
		t.Fatalf("flag on: %v", m)
	}
	if s, out := w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-memory", map[string]any{"enabled": false}); s != 204 {
		t.Fatalf("switch off: %d %v", s, out)
	}
	if m := memory(); m["enabled"] != true || m["on"] != false {
		t.Fatalf("switch off: %v", m)
	}
	w.flag(t, "ask_uni_agent", featureflags.ScopeGlobal, "", false)
	if m := memory(); m["enabled"] != false {
		t.Fatalf("agent off: %v", m)
	}
}

func TestSetAskUniMemoryReadsAnyOrganizationFlag(t *testing.T) {
	w := newMemWorld(t)
	put := func() (int, map[string]any) {
		return w.call(t, w.owner, "PUT", "/api/v1/me/ask-uni-memory", map[string]any{"enabled": true})
	}
	if s, out := put(); s != 403 || errCode(out) != "ai_memory_disabled" {
		t.Fatalf("no organization on: %d %v", s, out)
	}
	w.flag(t, "ask_uni_memory", featureflags.ScopeOrganization, w.orgID, true)
	if s, out := put(); s != 204 {
		t.Fatalf("organization override: %d %v", s, out)
	}
}
