package service

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// UNI-1869 (SRC-02b): a source file opens view-only in the Office web frame.
// The source token carries a "source" principal (s/pk/pid), never a document
// id, and opens only /api/v1/office-frame/sources/* — every documents/* frame
// route refuses it before a handler runs.

// newSourceFrameService wires a DocumentSourceService (chat + tasks, as
// sourceService does) into an OfficeFrameService with a test clock.
func newSourceFrameService(t *testing.T, env *docStorageEnv, now *time.Time) (*OfficeFrameService, *memStorage) {
	t.Helper()
	sources, store := sourceService(t, env)
	s := NewOfficeFrameService(env.svc, "office-frame-test-secret-0123456789abcdef")
	s.SetSources(sources)
	s.SetClock(func() time.Time { return *now })
	return s, store
}

// TestOfficeFrameSourceTokenVerifiesOnlyItsOwnClaims pins the ofs1. wire rules:
// signature and lifetime as a document token's, every field bound, ro required,
// and the one-spelling module rule (absent = docs, explicit "docs" refused).
func TestOfficeFrameSourceTokenVerifiesOnlyItsOwnClaims(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameSourceClaims{
		Version: 1, SourceID: "chat:01J8MSG", ParentKind: "chat_dm", ParentID: "room1",
		WorkspaceID: "ws", OrganizationID: "org", UserID: "u",
		ExpiresAt: now.Add(OfficeFrameTokenTTL).UnixMilli(), Nonce: "n", ReadOnly: true,
	}
	token, err := s.sign(officeFrameSourcePrefix, claims)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.VerifySource(token)
	if err != nil || got != claims {
		t.Fatalf("VerifySource = %+v, %v", got, err)
	}
	// A module token verifies and names its module.
	withModule := claims
	withModule.Module = OfficeFrameModulePDF
	modToken, err := s.sign(officeFrameSourcePrefix, withModule)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.VerifySource(modToken); err != nil || got.ModuleName() != OfficeFrameModulePDF {
		t.Fatalf("VerifySource module = %+v, %v", got, err)
	}

	payload, sig, _ := strings.Cut(strings.TrimPrefix(token, officeFrameSourcePrefix), ".")
	other := NewOfficeFrameService(&DocumentService{}, "another-secret-0123456789abcdef-xyz")
	forged, _ := other.sign(officeFrameSourcePrefix, claims)
	badClaims := claims
	badClaims.ReadOnly = false
	notReadOnly, _ := s.sign(officeFrameSourcePrefix, badClaims)
	badClaims = claims
	badClaims.Module = OfficeFrameModuleDocs
	explicitDocs, _ := s.sign(officeFrameSourcePrefix, badClaims)
	docToken, _ := s.sign(officeFrameTokenPrefix, OfficeFrameClaims{
		Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u",
		ExpiresAt: claims.ExpiresAt, Nonce: "n",
	})
	for name, bad := range map[string]string{
		"document token (oft1.)": docToken,
		"tampered payload":       officeFrameSourcePrefix + payload[:len(payload)-2] + "xx." + sig,
		"tampered signature":     officeFrameSourcePrefix + payload + "." + sig[:len(sig)-2] + "xx",
		"forged key":             forged,
		"not read-only":          notReadOnly,
		"explicit docs module":   explicitDocs,
		"empty":                  "",
		"plain":                  "ofs1.x.y",
		"bad prefix":             strings.Replace(token, "ofs1.", "ofx1.", 1),
	} {
		if _, err := s.VerifySource(bad); err == nil {
			t.Errorf("VerifySource accepted %s", name)
		}
	}
	// Every bound field must be present.
	for name, mutate := range map[string]func(*OfficeFrameSourceClaims){
		"no source id":    func(c *OfficeFrameSourceClaims) { c.SourceID = "" },
		"no parent kind":  func(c *OfficeFrameSourceClaims) { c.ParentKind = "" },
		"no parent id":    func(c *OfficeFrameSourceClaims) { c.ParentID = "" },
		"no workspace":    func(c *OfficeFrameSourceClaims) { c.WorkspaceID = "" },
		"no organization": func(c *OfficeFrameSourceClaims) { c.OrganizationID = "" },
		"no user":         func(c *OfficeFrameSourceClaims) { c.UserID = "" },
		"unparsable id":   func(c *OfficeFrameSourceClaims) { c.SourceID = "chat" },
		"empty row id":    func(c *OfficeFrameSourceClaims) { c.SourceID = "chat:" },
		"unknown module":  func(c *OfficeFrameSourceClaims) { c.Module = "calc" },
	} {
		c := claims
		mutate(&c)
		tok, err := s.sign(officeFrameSourcePrefix, c)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.VerifySource(tok); err == nil {
			t.Errorf("VerifySource accepted claims with %s", name)
		}
	}

	now = now.Add(OfficeFrameTokenTTL)
	if _, err := s.VerifySource(token); err == nil {
		t.Fatal("VerifySource accepted an expired token")
	}
}

// TestOfficeFrameSourceMint mints on a task docx attachment: the member gets a
// 10-minute token whose claims bind the source, its parent and its tenant; a
// non-member, an agent, an unknown id and a format no module opens are refused.
func TestOfficeFrameSourceMint(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	frame, _ := newSourceFrameService(t, env, &now)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	docx := s.attachmentWith(tn, tn.wsA, taskA, "plan.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, "")

	minted, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+docx)
	if err != nil {
		t.Fatalf("MintSource = %v", err)
	}
	if minted.Token == "" || !strings.HasPrefix(minted.Token, officeFrameSourcePrefix) {
		t.Fatalf("token = %q", minted.Token)
	}
	c := minted.Claims
	if c.SourceID != "task:"+docx || c.ParentKind != "task" || c.ParentID != taskA ||
		c.WorkspaceID != tn.wsA || c.OrganizationID != tn.orgID || c.UserID != tn.member.ID {
		t.Fatalf("claims = %+v", c)
	}
	if !c.ReadOnly {
		t.Fatal("ReadOnly = false")
	}
	if c.Module != "" || c.ModuleName() != OfficeFrameModuleDocs {
		t.Fatalf("module = %q, want absent (docs)", c.Module)
	}
	if got := time.Until(minted.ExpiresAt); minted.ExpiresAt.UnixMilli() != now.Add(OfficeFrameTokenTTL).UnixMilli() || got <= 0 {
		t.Fatalf("expires_at = %v", minted.ExpiresAt)
	}
	if _, err := frame.VerifySource(minted.Token); err != nil {
		t.Fatalf("minted token does not verify: %v", err)
	}

	// A pdf attachment carries the pdf module in m.
	pdf := s.attachmentWith(tn, tn.wsA, taskA, "scan.pdf", "application/pdf", 512, "")
	pmint, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+pdf)
	if err != nil {
		t.Fatalf("pdf MintSource = %v", err)
	}
	if pmint.Claims.Module != OfficeFrameModulePDF || pmint.Claims.ModuleName() != OfficeFrameModulePDF {
		t.Fatalf("pdf module = %q", pmint.Claims.Module)
	}

	// Refusals: agent, no service, non-member, unknown id, unmappable format.
	if _, err := frame.MintSource(s.ctx, Actor{Kind: "agent", ID: "a1"}, tn.wsA, "task:"+docx); err == nil {
		t.Error("agent mint accepted")
	}
	bare := NewOfficeFrameService(env.svc, "office-frame-test-secret-0123456789abcdef")
	if _, err := bare.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+docx); err == nil {
		t.Error("MintSource without sources accepted")
	}
	for name, id := range map[string]string{
		"unknown row":     "task:" + util.NewID(),
		"bad shape":       "task",
		"empty row":       "task:",
		"csv (no module)": "task:" + s.attachmentWith(tn, tn.wsA, taskA, "data.csv", "text/csv", 64, ""),
	} {
		if _, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, id); err == nil {
			t.Errorf("MintSource %s accepted", name)
		}
	}
	if _, err := frame.MintSource(s.ctx, human(tn.outsider), tn.wsA, "task:"+docx); err == nil {
		t.Error("non-member mint accepted")
	}
}

// TestOfficeFrameSourceMintTooLarge: a stored size over the module's cap
// (sheets, 10 MiB) is refused before a token is signed, and the refused claims
// still name the module so the flag check can answer first.
func TestOfficeFrameSourceMintTooLarge(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	frame, _ := newSourceFrameService(t, env, &now)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	big := s.attachmentWith(tn, tn.wsA, taskA, "huge.xlsx",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", OfficeFrameSheetsMaxBytes+1, "")
	minted, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+big)
	if !errors.Is(err, ErrOfficeFrameTooLarge) || minted.Token != "" {
		t.Fatalf("over-cap mint = %v token %q, want ErrOfficeFrameTooLarge and no token", err, minted.Token)
	}
	if minted.Claims.ModuleName() != OfficeFrameModuleSheets {
		t.Fatalf("refused claims module = %q, want sheets", minted.Claims.Module)
	}
}

// TestOfficeFrameSourceAuthorizeRegates: the token is verified statelessly but
// every read re-runs the source gate as the token's user, then the claims are
// checked against what the lookup still finds.
func TestOfficeFrameSourceAuthorizeRegates(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	frame, _ := newSourceFrameService(t, env, &now)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	docx := s.attachmentWith(tn, tn.wsA, taskA, "plan.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, "")

	minted, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+docx)
	if err != nil {
		t.Fatal(err)
	}
	ws, item, err := frame.AuthorizeSource(s.ctx, minted.Claims)
	if err != nil {
		t.Fatalf("AuthorizeSource = %v", err)
	}
	if ws.ID != tn.wsA || item.ID != "task:"+docx || item.Parent.ID != taskA {
		t.Fatalf("AuthorizeSource = %v %+v", ws.ID, item)
	}
	// A claims mismatch is not_found, exactly like a moved/renamed source.
	otherTask := s.task(tn, tn.wsA)
	for name, mutate := range map[string]func(*OfficeFrameSourceClaims){
		"other workspace":    func(c *OfficeFrameSourceClaims) { c.WorkspaceID = tn.wsB },
		"other organization": func(c *OfficeFrameSourceClaims) { c.OrganizationID = "org-x" },
		"other parent kind":  func(c *OfficeFrameSourceClaims) { c.ParentKind = "meeting" },
		"other parent id":    func(c *OfficeFrameSourceClaims) { c.ParentID = otherTask },
	} {
		c := minted.Claims
		mutate(&c)
		if _, _, err := frame.AuthorizeSource(s.ctx, c); err == nil {
			t.Errorf("AuthorizeSource with %s accepted", name)
		}
	}

	// Losing workspace membership after the mint stops the next call.
	s.exec(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, tn.wsA, tn.member.ID)
	if _, _, err := frame.AuthorizeSource(s.ctx, minted.Claims); err == nil {
		t.Error("AuthorizeSource after member removal accepted")
	}
}

// TestOfficeFrameSourceOpenStreamsBytes: OpenSource returns the file the
// download route would serve — the lookup item plus the domain's bytes.
func TestOfficeFrameSourceOpenStreamsBytes(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	frame, store := newSourceFrameService(t, env, &now)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	body := []byte("source bytes")
	docx := s.attachmentWith(tn, tn.wsA, taskA, "plan.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", int64(len(body)), "")
	store.objects["workspaces/"+tn.wsA+"/attachments/"+docx+"/plan.docx"] = body

	minted, err := frame.MintSource(s.ctx, human(tn.member), tn.wsA, "task:"+docx)
	if err != nil {
		t.Fatal(err)
	}
	f, err := frame.OpenSource(s.ctx, minted.Claims)
	if err != nil {
		t.Fatalf("OpenSource = %v", err)
	}
	defer f.Body.Close()
	if string(readBytes(t, f.Body)) != string(body) {
		t.Fatal("OpenSource returned other bytes")
	}
	if f.Item.ID != "task:"+docx || f.Size != int64(len(body)) {
		t.Fatalf("file = %+v size %d", f.Item, f.Size)
	}
}

// TestViewSourceRunsTheLookupGateOnly: ViewSource answers metadata without
// opening bytes — it is the mint's authorization step.
func TestViewSourceRunsTheLookupGateOnly(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, store := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	docx := s.attachmentWith(tn, tn.wsA, taskA, "plan.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1024, "")
	// No bytes in the store at all: ViewSource must not touch the object.
	_ = store
	ws, item, err := svc.ViewSource(s.ctx, human(tn.member), tn.wsA, "task:"+docx)
	if err != nil {
		t.Fatalf("ViewSource = %v", err)
	}
	if ws.ID != tn.wsA || item.ID != "task:"+docx || item.Parent.Kind != "task" || item.Parent.ID != taskA {
		t.Fatalf("ViewSource = %+v %+v", ws, item)
	}
	if _, _, err := svc.ViewSource(s.ctx, human(tn.outsider), tn.wsA, "task:"+docx); err == nil {
		t.Error("ViewSource for a non-member accepted")
	}
}

// The token never outlives its own TTL: expiry is a VerifySource refusal.
func TestOfficeFrameSourceTokenExpiryIsVerified(t *testing.T) {
	now := time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameSourceClaims{
		Version: 1, SourceID: "task:01J8ATT", ParentKind: "task", ParentID: "t1",
		WorkspaceID: "ws", OrganizationID: "org", UserID: "u",
		ExpiresAt: now.Add(-time.Second).UnixMilli(), Nonce: "n", ReadOnly: true,
	}
	token, err := s.sign(officeFrameSourcePrefix, claims)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.VerifySource(token); err == nil {
		t.Fatal("VerifySource accepted an already-expired token")
	}
}
