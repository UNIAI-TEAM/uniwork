package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// TestIsolationMatrix is the two-organization isolation matrix of ADR 0008 §5:
// every route the server registers, called by the owner of organization B with
// the ids of organization A, must refuse — and must leave A exactly as it was.
//
// Four passes over one world built by isolation_world_test.go:
//
//  1. control: each tenant's owner opens every GET route on their own ids and
//     gets an answer, so an id in the fixture is a real row and a refusal in
//     pass 2 is the tenancy check, not a typo.
//  2. cross-tenant: B's owner sends every route with A's ids. The answer is
//     403 or 404 (a stub's 422) and carries no text A wrote.
//  3. listing: B's owner sends every GET route with B's own ids. Nothing in
//     the answer belongs to A — no id, no text.
//  4. untouched: every row that carries A's organization_id hashes the same
//     before and after pass 2.
//
// A new route is covered the day it is registered: a path that names a tenant
// resource is cross-tenant by default (isoRoutes only lists bodies and the
// routes that are not), and a path with no tenant in it fails here until it is
// classified with a reason. A new table is covered by pass 4 the day it gets
// its organization_id column (TestEveryBusinessTableCarriesOrganizationID).
func TestIsolationMatrix(t *testing.T) {
	w := newIsolationServer(t)
	w.alpha = w.buildTenant(t, "alpha")
	w.bravo = w.buildTenant(t, "bravo")

	// Every tenant table holds a row of A's: a table A has nothing in can
	// neither show a missing filter in the listing pass nor a stray write in
	// the digest.
	if empty := w.emptyTenantTables(t, w.alpha); len(empty) > 0 {
		t.Fatalf("tenant tables with no row of A's (seed one in isolation_world_test.go, or list the table in isoUnseeded with a reason): %s", strings.Join(empty, ", "))
	}

	routes := isoWalk(t, w.srv.Config.Handler)
	if missing := isoUnclassified(routes); len(missing) > 0 {
		t.Fatalf("routes without a tenant in the path need a row in isoRoutes (class and reason):\n  %s", strings.Join(missing, "\n  "))
	}
	if stale := isoStaleRows(routes); len(stale) > 0 {
		t.Fatalf("isoRoutes rows that match no registered route:\n  %s", strings.Join(stale, "\n  "))
	}

	t.Run("control", func(t *testing.T) {
		for _, r := range routes {
			spec := isoSpecFor(r)
			if r.method != http.MethodGet || !spec.class.tenantScoped() || spec.skipControl != "" {
				continue
			}
			for _, tn := range []*isoTenant{w.alpha, w.bravo} {
				path, ok := isoPath(t, r.pattern, tn)
				if !ok {
					continue
				}
				path += isoQuery(spec.query, tn)
				status, raw := w.do(t, r.method, path, tn.token, spec.bodyFor(w, tn))
				if !spec.controlOK(status, raw) {
					t.Errorf("%s %s as %s owner = %d, want success on own ids: %s", r.method, r.pattern, tn.tag, status, isoClip(raw))
				}
			}
		}
	})
	if t.Failed() {
		t.FailNow()
	}

	before := w.tenantDigest(t, w.alpha)

	t.Run("cross-tenant", func(t *testing.T) {
		for _, r := range routes {
			spec := isoSpecFor(r)
			if !spec.class.tenantScoped() && spec.class != isoPlatform {
				continue
			}
			path, ok := isoPath(t, r.pattern, w.alpha)
			if !ok {
				continue
			}
			w.attack(t, r.method+" "+r.pattern, r.method, path+isoQuery(spec.query, w.alpha), spec.bodyFor(w, w.alpha), spec.refused)
		}
	})

	// No token at all, but a fresh guest session: the optional-auth routes
	// (public meetings, file content) and every other route must refuse an
	// anonymous browser holding nothing but A's ids.
	t.Run("anonymous", func(t *testing.T) {
		anon := isoCaller{name: "an anonymous guest", headers: map[string]string{
			meetings.GuestSessionHeader: meetings.SignGuestCookie("iso-anonymous-guest", []byte("test")),
		}}
		for _, r := range routes {
			spec := isoSpecFor(r)
			if !spec.class.tenantScoped() && spec.class != isoPlatform {
				continue
			}
			path, ok := isoPath(t, r.pattern, w.alpha)
			if !ok {
				continue
			}
			refused := func(status int, raw []byte) bool {
				return status == http.StatusUnauthorized || spec.refused(status, raw)
			}
			w.attackAs(t, anon, "anonymous "+r.method+" "+r.pattern, r.method, path+isoQuery(spec.query, w.alpha), spec.bodyFor(w, w.alpha), refused)
		}
	})

	// The caller's own account routes that name a row (a session) are tried
	// with A's row: B must not end A's session.
	t.Run("self", func(t *testing.T) {
		for _, r := range routes {
			spec := isoSpecFor(r)
			if spec.class != isoSelf || !strings.Contains(r.pattern, "{") {
				continue
			}
			path, ok := isoPath(t, r.pattern, w.alpha)
			if !ok {
				continue
			}
			w.attack(t, "self "+r.method+" "+r.pattern, r.method, path, spec.bodyFor(w, w.alpha), spec.refused)
		}
	})

	// The first id in the path is B's own (workspace, organization, task,
	// document, meeting…) and the rest are A's: B's owner passes the gate on
	// the parent, so only the check that the child belongs to that parent
	// stands between them and A's row.
	t.Run("mixed", func(t *testing.T) {
		for _, r := range routes {
			spec := isoSpecFor(r)
			// A public link route is mixed too: B's link secret must not
			// open an asset of A's document.
			if !spec.class.tenantScoped() && spec.class != isoPublic {
				continue
			}
			path, ok := isoMixedPath(t, r.pattern, spec.mixedFirst, w.bravo, w.alpha)
			// A route whose only other id rides in the query string
			// (?account_id=, ?call_id=) is mixed by that query.
			if !ok && spec.class.tenantScoped() && isoQueryNamesRow(spec.query) {
				path, ok = isoPath(t, r.pattern, w.bravo)
			}
			if !ok || (spec.class == isoPublic && !isoHasTwoParams(r.pattern)) {
				continue
			}
			refused := spec.refused
			if spec.mixedOK != "" {
				refused = func(status int, _ []byte) bool { return status < 500 }
			}
			w.attack(t, "mixed "+r.method+" "+r.pattern, r.method, path+isoQuery(spec.query, w.alpha), spec.bodyFor(w, w.alpha), refused)
		}
	})

	// B's own routes with A's rows named in the body: an assignee, a parent,
	// a project, a share principal. Each must be refused or ignored, and B's
	// rows must not come to point at A's.
	t.Run("references", func(t *testing.T) {
		w.referenceControls(t)
		for _, c := range isoReferences {
			path, ok := isoPath(t, c.pattern, w.bravo)
			if !ok {
				continue
			}
			refused := func(status int, _ []byte) bool { return status >= 400 && status < 500 }
			if c.allow2xx {
				refused = func(status int, _ []byte) bool { return status < 500 }
			}
			label := "references " + c.method + " " + c.pattern + " " + c.what
			raw := w.attack(t, label, c.method, path+isoQuery(c.query, w.alpha), c.build(w, w.bravo, w.alpha), refused)
			for _, bad := range c.mustNotContain {
				if strings.Contains(string(raw), bad) {
					t.Errorf("%s: answer holds %q: %s", label, bad, isoClip(raw))
				}
			}
		}
	})

	// The same mixed and reference attacks while B's owner is also a plain
	// member of A: "the caller may see that row" must not pass for "that row
	// is in this tenant". Someone in two organizations still cannot hang A's
	// rows under B's or act on A's children through a B parent.
	t.Run("member-of-both", func(t *testing.T) {
		w.joinAsMember(t, w.bravo, w.alpha)
		defer w.evictIfJoined(t, w.bravo, w.alpha)
		both := isoCaller{name: "B's owner (also a member of A)", token: w.bravo.token, member: true}
		for _, r := range routes {
			spec := isoSpecFor(r)
			if !spec.class.tenantScoped() {
				continue
			}
			path, ok := isoMixedPath(t, r.pattern, spec.mixedFirst, w.bravo, w.alpha)
			if !ok {
				continue
			}
			refused := spec.refused
			if spec.mixedOK != "" {
				refused = func(status int, _ []byte) bool { return status < 500 }
			}
			w.attackAs(t, both, "member-of-both mixed "+r.method+" "+r.pattern, r.method, path+isoQuery(spec.query, w.alpha), spec.bodyFor(w, w.alpha), refused)
		}
		for _, c := range isoReferences {
			path, ok := isoPath(t, c.pattern, w.bravo)
			if !ok {
				continue
			}
			refused := func(status int, _ []byte) bool { return status >= 400 && status < 500 }
			if c.allow2xx {
				refused = func(status int, _ []byte) bool { return status < 500 }
			}
			w.attackAs(t, both, "member-of-both references "+c.method+" "+c.pattern+" "+c.what, c.method, path+isoQuery(c.query, w.alpha), c.build(w, w.bravo, w.alpha), refused)
		}
	})

	t.Run("listing", func(t *testing.T) {
		for _, r := range routes {
			spec := isoSpecFor(r)
			if r.method != http.MethodGet || spec.class == isoPublic || spec.class == isoPlatform || spec.class == isoRealtime {
				continue
			}
			path, ok := isoPath(t, r.pattern, w.bravo)
			if !ok {
				continue
			}
			path += isoQuery(spec.query, w.bravo)
			_, raw := w.do(t, r.method, path, w.bravo.token, spec.bodyFor(w, w.bravo))
			if leak := w.alpha.leakIn(raw, ""); leak != "" {
				t.Errorf("%s %s: B's own view carries A's %s: %s", r.method, r.pattern, leak, isoClip(raw))
			}
		}
	})

	// FileService objects live in the directory /uploads/* serves; the route
	// authorizes nobody, so it must refuse every FileService key.
	t.Run("uploads", func(t *testing.T) {
		var key string
		if err := w.pool.QueryRow(context.Background(), `SELECT object_key FROM files WHERE id = $1`, w.alpha.ids["file"]).Scan(&key); err != nil {
			t.Fatal(err)
		}
		for _, token := range []string{"", w.bravo.token} {
			if status, raw := w.do(t, http.MethodGet, "/uploads/"+key, token, isoBody{}); status != http.StatusNotFound {
				t.Errorf("GET /uploads/<A's file> = %d, want 404: %s", status, isoClip(raw))
			}
		}
	})

	t.Run("untouched", func(t *testing.T) {
		if changed := isoDiff(before, w.tenantDigest(t, w.alpha)); len(changed) > 0 {
			t.Errorf("B's requests changed A's rows in: %s", strings.Join(changed, ", "))
		}
		// Device sessions and desktop attempts belong to an account, not an
		// organization, so the digest above cannot see them: A's device must
		// still be live and A's pending attempt still undecided.
		var revoked, decided bool
		if err := w.pool.QueryRow(context.Background(), `SELECT revoked_at IS NOT NULL FROM device_sessions WHERE id = $1`, w.alpha.ids["deviceSession"]).Scan(&revoked); err != nil {
			t.Fatal(err)
		}
		if revoked {
			t.Error("B's requests revoked A's device session")
		}
		if err := w.pool.QueryRow(context.Background(), `SELECT approved_at IS NOT NULL OR cancelled_at IS NOT NULL OR used_at IS NOT NULL FROM desktop_auth_attempts WHERE id = $1`, w.alpha.ids["desktopAttempt"]).Scan(&decided); err != nil {
			t.Fatal(err)
		}
		if decided {
			t.Error("B's requests approved or cancelled A's desktop attempt")
		}
	})

	// The positive control of every write: a third organization's owner
	// sends each write route on their own rows with the matrix's body and is
	// served. Without it a 403/404 to B on a write could be a body or a state
	// the route refuses to everyone, and would prove nothing about tenancy.
	// Deletes run last so they do not take rows the other writes need.
	//
	// What it proves: B's 403/404 on a write is the tenancy check only if the
	// route's own people are not refused the same way. A 400 or 409 to them
	// still shows the route decided who is asking before it read the body or
	// the state - B never got that far.
	t.Run("write-control", func(t *testing.T) {
		c := w.buildTenant(t, "charlie")
		var writes []isoRoute
		for _, r := range routes {
			spec := isoSpecFor(r)
			if !spec.class.tenantScoped() || spec.class == isoStub || spec.skipControl != "" || r.method == http.MethodGet || r.method == http.MethodHead {
				continue
			}
			writes = append(writes, r)
		}
		// Writes, then the ones that end a row, then deletes (children before
		// parents: a task's label before the task), then what ends the tenant.
		sort.SliceStable(writes, func(i, j int) bool {
			pi, pj := isoWritePhase(writes[i]), isoWritePhase(writes[j])
			if pi != pj {
				return pi < pj
			}
			return pi == 2 && strings.Count(writes[i].pattern, "/") > strings.Count(writes[j].pattern, "/")
		})
		for _, r := range writes {
			spec := isoSpecFor(r)
			path, ok := isoPath(t, r.pattern, c)
			if !ok {
				continue
			}
			token := c.token
			switch spec.controlAs {
			case "peer":
				token = c.peerToken
			case "third":
				token = c.thirdToken
			}
			status, raw := w.do(t, r.method, path+isoQuery(spec.query, c), token, spec.bodyFor(w, c))
			refusedToo := status == http.StatusForbidden || status == http.StatusNotFound || status == http.StatusUnauthorized
			if refusedToo && !spec.controlOK(status, raw) {
				t.Errorf("write control %s %s on C's own rows = %d, the refusal B got too: %s", r.method, r.pattern, status, isoClip(raw))
			}
		}
	})
}

type isoRoute struct{ method, pattern string }

func isoWalk(t *testing.T, h http.Handler) []isoRoute {
	t.Helper()
	var out []isoRoute
	err := chi.Walk(h.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		out = append(out, isoRoute{method: method, pattern: strings.TrimSuffix(route, "/")})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].pattern != out[j].pattern {
			return out[i].pattern < out[j].pattern
		}
		return out[i].method < out[j].method
	})
	return out
}

// isoWritesLast are the writes the write-control pass runs at the very end,
// because other routes still need what they remove.
var isoWritesLast = map[string]string{
	"POST /api/v1/orgs/{org}/transfer-ownership":                                       "the owner stops being one",
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/accounts/{accountID}":           "the other Email Hub routes name the mailbox in their query",
	"DELETE /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}": "the thread routes name the message under a shorter path",
}

// isoWritePhase orders the write-control pass: 0 for a write, 1 for one that
// ends or hands off the row it acts on, 2 for a delete, 3 for isoWritesLast.
func isoWritePhase(r isoRoute) int {
	if _, ok := isoWritesLast[r.method+" "+r.pattern]; ok {
		return 3
	}
	if r.method == http.MethodDelete {
		return 2
	}
	switch r.pattern[strings.LastIndex(r.pattern, "/")+1:] {
	case "leave", "archive", "cancel", "end", "reject", "approve", "deactivate", "finalize", "close", "stop", "hangup", "host-transfer":
		return 1
	}
	return 0
}

// isoQueryNamesRow: the query string carries a tenant row (not a date).
func isoQueryNamesRow(q string) bool {
	for _, p := range []string{"{emailAccount}", "{callID}", "{peerEmail}", "{peerID}", "{orgID}"} {
		if strings.Contains(q, p) {
			return true
		}
	}
	return false
}

func isoHasTwoParams(pattern string) bool { return len(isoParamRE.FindAllString(pattern, -1)) >= 2 }

// joinAsMember makes outsider a plain member of tenant's organization and
// workspace, the way an accepted invitation would.
func (w *isoWorld) joinAsMember(t *testing.T, outsider, tenant *isoTenant) {
	t.Helper()
	ctx := context.Background()
	if _, err := w.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
		tenant.orgID, outsider.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
		tenant.wsID, outsider.userID, tenant.orgID); err != nil {
		t.Fatal(err)
	}
}

// isoParamRE matches one chi path parameter.
var isoParamRE = regexp.MustCompile(`\{[^}]+\}`)

// isoTenantParams name a row that belongs to one organization; a route whose
// path holds one is cross-tenant tested without being listed anywhere.
var isoTenantParams = map[string]bool{
	"{workspaceID}": true, "{orgID}": true, "{org}": true, "{taskID}": true, "{meetingID}": true,
	"{documentID}": true, "{commentID}": true, "{attachmentID}": true, "{agentID}": true,
	"{conversationID}": true, "{requestId}": true, "{fileID}": true,
	// A launch receipt names a document of one organization; revoke answers
	// 404 to every account but its creator.
	"{launchSessionID}": true,
}

func isoUnclassified(routes []isoRoute) []string {
	var missing []string
	for _, r := range routes {
		key := r.method + " " + r.pattern
		if _, ok := isoRoutes[key]; ok {
			continue
		}
		if !isoNamesTenant(r.pattern) {
			missing = append(missing, key)
		}
	}
	return missing
}

func isoStaleRows(routes []isoRoute) []string {
	bound := map[string]bool{}
	for _, r := range routes {
		bound[r.method+" "+r.pattern] = true
	}
	var stale []string
	for key := range isoRoutes {
		if !bound[key] {
			stale = append(stale, key)
		}
	}
	sort.Strings(stale)
	return stale
}

func isoNamesTenant(pattern string) bool {
	for _, p := range isoParamRE.FindAllString(pattern, -1) {
		if isoTenantParams[p] {
			return true
		}
	}
	return false
}

func isoSpecFor(r isoRoute) isoSpec {
	if spec, ok := isoRoutes[r.method+" "+r.pattern]; ok {
		return spec
	}
	return isoSpec{class: isoScoped}
}

// isoPath fills every parameter of pattern with the tenant's row for it; a
// parameter the fixture cannot fill is reported and the route skipped.
func isoPath(t *testing.T, pattern string, tn *isoTenant) (string, bool) {
	t.Helper()
	segs := strings.Split(pattern, "/")
	for i, s := range segs {
		if !strings.HasPrefix(s, "{") {
			continue
		}
		v := isoParam(t, pattern, segs, i, tn)
		if v == "" {
			return "", false
		}
		segs[i] = v
	}
	return strings.Join(segs, "/"), true
}

// isoParam picks the row a parameter names. Most names are unambiguous; a few
// ({id}, {commentID}, {linkID}, …) mean a different resource under a
// different parent, so the segment before them decides.
func isoParam(t *testing.T, pattern string, segs []string, i int, tn *isoTenant) string {
	t.Helper()
	prev := ""
	if i > 0 {
		prev = segs[i-1]
	}
	under := func(s string) bool { return strings.Contains(pattern, s) }
	switch segs[i] {
	case "{workspaceID}":
		return tn.wsID
	case "{orgID}":
		return tn.orgID
	case "{org}":
		// listOrgWorkspaces and createOrgWorkspace read {org} as the id;
		// every other {org} route reads it as the slug.
		if strings.HasSuffix(pattern, "/orgs/{org}/workspaces") {
			return tn.orgID
		}
		return tn.orgSlug
	case "{wsSlug}":
		return tn.wsSlug
	case "{taskID}":
		return tn.get(t, "task")
	case "{dependsOnTaskID}":
		return tn.get(t, "task2")
	case "{labelID}":
		return tn.get(t, "label")
	case "{propertyID}":
		return tn.get(t, "property")
	case "{projectID}":
		return tn.get(t, "project")
	case "{meetingID}":
		return tn.get(t, "meeting")
	case "{participantID}":
		return tn.get(t, "participant")
	case "{motionID}":
		return tn.get(t, "motion")
	case "{invitationID}":
		return tn.get(t, "meetingInvitation")
	case "{linkId}":
		return tn.get(t, "inviteLink")
	case "{requestId}":
		return tn.get(t, "joinRequest")
	case "{roomID}":
		if prev == "channels" {
			return tn.get(t, "channel")
		}
		return tn.get(t, "room")
	case "{messageID}":
		switch {
		case strings.HasSuffix(pattern, "/file"):
			return tn.get(t, "fileMessage")
		case strings.HasSuffix(pattern, "/voice"):
			return tn.get(t, "voiceMessage")
		case strings.HasSuffix(pattern, "/poll/vote"):
			return tn.get(t, "pollMessage")
		}
		return tn.get(t, "message")
	case "{followUpID}":
		return tn.get(t, "followUp")
	case "{documentID}":
		if under("/office-frame/") || under("/office/frame-token") {
			return tn.get(t, "frameDocument")
		}
		if under("/download") || under("/office/") || under("/uploads") || under("/versions/commit") || under("/copies") {
			return tn.get(t, "fileDocument")
		}
		return tn.get(t, "document")
	case "{assetID}":
		if under("/office-frame/") {
			return tn.get(t, "frameAsset")
		}
		return tn.get(t, "asset")
	case "{signatureID}":
		return tn.get(t, "signature")
	case "{aiProvider}":
		if under("/office-frame/") {
			return isoFrameAIProvider
		}
		return isoAIProvider
	case "{launchSessionID}":
		return tn.get(t, "launchSession")
	case "{deviceSessionID}":
		return tn.get(t, "deviceSession")
	case "{capability}":
		return tn.get(t, "previewCapability")
	case "{shareID}":
		return tn.get(t, "share")
	case "{versionNo}":
		return tn.get(t, "version")
	case "{jobID}":
		return tn.get(t, "officeJob")
	case "{exportID}":
		return tn.get(t, "auditExport")
	case "{eventID}":
		return tn.get(t, "auditEvent")
	case "{departmentId}":
		return tn.get(t, "department")
	case "{invitationId}":
		return tn.get(t, "orgInvitation")
	case "{agentID}":
		return tn.get(t, "agent")
	case "{conversationID}":
		return tn.get(t, "conversation")
	case "{accountID}":
		return tn.get(t, "emailAccount")
	case "{threadID}":
		return tn.get(t, "emailThread")
	case "{scheduledSendID}":
		return tn.get(t, "scheduledSend")
	case "{fileID}":
		return tn.get(t, "file")
	case "{provider}":
		return "google"
	case "{resourceType}":
		return "task"
	case "{itemType}":
		return "task"
	case "{itemID}":
		return tn.get(t, "task")
	case "{userID}":
		return tn.peerID
	case "{commentID}":
		if strings.HasPrefix(pattern, "/api/v1/documents/") {
			return tn.get(t, "docComment")
		}
		return tn.get(t, "taskComment")
	case "{attachmentID}":
		if under("/email-hub/") {
			return tn.get(t, "emailAttachment")
		}
		return tn.get(t, "attachment")
	case "{recordingID}":
		if under("/voice/") {
			return tn.get(t, "voiceRecording")
		}
		return tn.get(t, "recording")
	case "{linkID}":
		if strings.HasPrefix(pattern, "/api/v1/documents/") {
			return tn.get(t, "docLink")
		}
		return tn.get(t, "chatLink")
	case "{resourceID}":
		if under("/projects/") {
			return tn.get(t, "projectResource")
		}
		return tn.get(t, "task")
	case "{id}":
		switch prev {
		case "task-labels":
			return tn.get(t, "label")
		case "task-properties":
			return tn.get(t, "property")
		case "task-statuses":
			return tn.get(t, "status")
		case "task-views":
			return tn.get(t, "view")
		}
	case "{token}":
		if under("/public/documents/") {
			return tn.get(t, "docLinkToken")
		}
		return tn.get(t, "invitationToken")
	case "{code}":
		return "starter"
	case "{key}":
		switch {
		case under("/admin/plans/"):
			return "members.max"
		case under("/admin/flags/"):
			return "agents_assignee"
		}
		return "documents"
	case "{traceID}":
		return "0af7651916cd43dd8448eb211c80319c"
	case "{sessionId}":
		return tn.get(t, "session")
	case "{quickActionID}", "{agentTaskID}", "{connectionID}":
		// Stubbed routes: no row exists for anyone.
		return "01J8X4STUB0N1P2Q3R4S5T6U7V"
	}
	t.Errorf("isoParam: no fixture for %s in %s", segs[i], pattern)
	return ""
}

// isoCaller is who sends an attack: B's owner by default, an anonymous
// browser with a fresh guest session, or B's owner while also a member of A.
type isoCaller struct {
	name    string
	token   string
	headers map[string]string
	// member means the caller legitimately belongs to A as well, so a
	// membership in A after the request is expected, not a break-in.
	member bool
}

// attack sends one request as B's owner; see attackAs.
func (w *isoWorld) attack(t *testing.T, label, method, path string, body isoBody, refused func(int, []byte) bool) []byte {
	t.Helper()
	return w.attackAs(t, isoCaller{name: "B's owner", token: w.bravo.token}, label, method, path, body, refused)
}

// attackAs sends one request and holds every rule of the matrix: the answer
// is a refusal and carries nothing of A's; A's rows are as they were; no B row
// points at an A row or copies A's text; and the caller is still not a member
// of A afterwards.
func (w *isoWorld) attackAs(t *testing.T, c isoCaller, label, method, path string, body isoBody, refused func(int, []byte) bool) []byte {
	t.Helper()
	write := method != http.MethodGet && method != http.MethodHead
	var pre map[string]string
	if write {
		pre = w.tenantDigest(t, w.alpha)
	}
	// Reads write too (access logs, read markers): the reference check runs
	// after every request.
	preRefs := w.referencesTo(t, w.bravo, w.alpha)
	if len(c.headers) > 0 {
		merged := map[string]string{}
		for k, v := range body.headers {
			merged[k] = v
		}
		for k, v := range c.headers {
			merged[k] = v
		}
		body.headers = merged
	}
	status, raw := w.do(t, method, path, c.token, body)
	if !refused(status, raw) {
		t.Errorf("%s: %s = %d, want refusal: %s", label, c.name, status, isoClip(raw))
	} else if leak := w.alpha.leakIn(raw, path+isoBodyText(body)); leak != "" {
		t.Errorf("%s: answer to %s carries A's %s: %s", label, c.name, leak, isoClip(raw))
	}
	if write {
		if changed := isoDiff(pre, w.tenantDigest(t, w.alpha)); len(changed) > 0 {
			t.Errorf("%s: %s changed A's rows in %s", label, c.name, strings.Join(changed, ", "))
		}
	}
	if refs := w.referencesTo(t, w.bravo, w.alpha); strings.Join(refs, ",") != strings.Join(preRefs, ",") {
		t.Errorf("%s: B's rows now point at A's rows or copy A's text in %s", label, strings.Join(refs, ", "))
	}
	// A route that let B in would poison every row after it; say which one
	// did it and put B back outside.
	if !c.member && w.evictIfJoined(t, w.bravo, w.alpha) {
		t.Errorf("%s: B's owner became a member of A", label)
	}
	return raw
}

func isoBodyText(b isoBody) string {
	if b.json == nil {
		return ""
	}
	raw, _ := json.Marshal(b.json)
	return string(raw)
}

// isoMixedPath fills the first parameter with from's row and every other one
// with to's. Routes with a single parameter, or whose later parameters are
// not rows of one tenant (a provider name, a version number), have no mixed
// form.
func isoMixedPath(t *testing.T, pattern, firstKey string, from, to *isoTenant) (string, bool) {
	t.Helper()
	segs := strings.Split(pattern, "/")
	first, mixed := true, false
	for i, seg := range segs {
		if !strings.HasPrefix(seg, "{") {
			continue
		}
		tn := to
		if first {
			first = false
			if firstKey != "" {
				segs[i] = from.get(t, firstKey)
				continue
			}
			tn = from
		} else if !isoSharedParams[seg] {
			mixed = true
		}
		v := isoParam(t, pattern, segs, i, tn)
		if v == "" {
			return "", false
		}
		segs[i] = v
	}
	return strings.Join(segs, "/"), mixed
}

// isoSharedParams take the same value in both tenants, so swapping them says
// nothing about isolation.
var isoSharedParams = map[string]bool{
	"{provider}": true, "{aiProvider}": true, "{resourceType}": true, "{itemType}": true, "{versionNo}": true, "{key}": true,
	"{code}":          true,
	"{quickActionID}": true, "{agentTaskID}": true, "{connectionID}": true,
}

// referencesTo lists the tables in which a row of tenant `in` names one of
// `of`'s rows: a cross-tenant reference left behind by a write.
func (w *isoWorld) referencesTo(t *testing.T, in, of *isoTenant) []string {
	t.Helper()
	ctx := context.Background()
	if w.refSQL == "" {
		rows, err := w.pool.Query(ctx, `
			SELECT c.table_name FROM information_schema.columns c
			JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
			WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND tb.table_type = 'BASE TABLE'
			ORDER BY c.table_name`)
		if err != nil {
			t.Fatal(err)
		}
		var parts []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			if _, skip := isoDigestSkip[name]; skip {
				continue
			}
			parts = append(parts, fmt.Sprintf(`SELECT %s, count(*) FROM %q x WHERE organization_id = $1 AND lower(x::text) ~ $2`, isoSQLString(name), name))
		}
		rows.Close()
		w.refSQL = strings.Join(parts, "\nUNION ALL\n")
	}
	// A's ids, and A's marker text: a B row that copied A's content without
	// an id has still carried it across.
	ids := []string{regexp.QuoteMeta(strings.ToLower(of.marker))}
	for _, id := range append([]string{of.orgID, of.wsID, of.userID, of.peerID, of.thirdID}, isoValues(of.ids)...) {
		if len(id) >= 20 {
			ids = append(ids, regexp.QuoteMeta(strings.ToLower(id)))
		}
	}
	rows, err := w.pool.Query(ctx, w.refSQL, in.orgID, strings.Join(ids, "|"))
	if err != nil {
		t.Fatalf("references: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var table string
		var n int64
		if err := rows.Scan(&table, &n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			out = append(out, fmt.Sprintf("%s(%d)", table, n))
		}
	}
	sort.Strings(out)
	return out
}

func isoValues(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

// isoQuery fills the {placeholders} a query string names with the tenant's
// values, the same way isoPath fills the path.
func isoQuery(q string, tn *isoTenant) string {
	if q == "" {
		return ""
	}
	r := strings.NewReplacer(
		"{peerEmail}", tn.peerEmail,
		"{emailAccount}", tn.ids["emailAccount"],
		"{callID}", tn.ids["callID"],
		"{peerID}", tn.peerID,
		"{orgID}", tn.orgID,
		// The calendar window around the fixture's meetings (now + 24h).
		"{fromDate}", time.Now().AddDate(0, 0, -30).Format("2006-01-02"),
		"{toDate}", time.Now().AddDate(0, 0, 60).Format("2006-01-02"),
	)
	return r.Replace(q)
}

// leakIn reports what of this tenant a response carries: its marker text, or
// one of its row ids that the request itself did not name.
func (tn *isoTenant) leakIn(raw []byte, requested string) string {
	if bytes.Contains(bytes.ToLower(raw), []byte(strings.ToLower(tn.marker))) {
		return "text (" + tn.marker + ")"
	}
	ids := []string{tn.orgID, tn.wsID, tn.userID, tn.peerID, tn.thirdID}
	for _, v := range tn.ids {
		ids = append(ids, v)
	}
	for _, id := range ids {
		if len(id) < 20 || strings.Contains(requested, id) {
			continue
		}
		if bytes.Contains(raw, []byte(id)) {
			return "id " + id
		}
	}
	return ""
}

// tenantDigest hashes every row of the tenant in one round trip: each table
// with an organization_id column by that column, plus the identity rows the
// tenant owns outside it (its organization row, its people).
func (w *isoWorld) tenantDigest(t *testing.T, tn *isoTenant) map[string]string {
	t.Helper()
	ctx := context.Background()
	if w.digestSQL == "" {
		rows, err := w.pool.Query(ctx, `
			SELECT c.table_name FROM information_schema.columns c
			JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
			WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND tb.table_type = 'BASE TABLE'
			ORDER BY c.table_name`)
		if err != nil {
			t.Fatal(err)
		}
		var parts []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				t.Fatal(err)
			}
			if _, skip := isoDigestSkip[name]; skip {
				continue
			}
			parts = append(parts, fmt.Sprintf(`SELECT %s, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM %q x WHERE organization_id = $1`,
				isoSQLString(name), name))
		}
		rows.Close()
		parts = append(parts,
			`SELECT 'organizations', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM organizations x WHERE id = $1`,
			`SELECT 'users', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM users x WHERE id = ANY($2)`,
			// Rows that belong to a person rather than an organization
			// (exempt from ADR 0008): another tenant must not touch them either.
			`SELECT 'refresh_tokens', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM refresh_tokens x WHERE user_id = ANY($2)`,
			`SELECT 'notification_preferences', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM notification_preferences x WHERE user_id = ANY($2)`,
			`SELECT 'push_subscriptions', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM push_subscriptions x WHERE user_id = ANY($2)`)
		w.digestSQL = strings.Join(parts, "\nUNION ALL\n")
	}
	rows, err := w.pool.Query(ctx, w.digestSQL, tn.orgID, []string{tn.userID, tn.peerID, tn.thirdID})
	if err != nil {
		t.Fatalf("digest: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var table, sum string
		if err := rows.Scan(&table, &sum); err != nil {
			t.Fatal(err)
		}
		out[table] = sum
	}
	return out
}

func isoSQLString(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func isoDiff(before, after map[string]string) []string {
	var changed []string
	for table, sum := range before {
		if after[table] != sum {
			changed = append(changed, table)
		}
	}
	for table := range after {
		if _, ok := before[table]; !ok {
			changed = append(changed, table)
		}
	}
	sort.Strings(changed)
	return changed
}

// evictIfJoined reports whether outsider holds any membership in tenant and
// removes it, so one broken route does not let every later row through.
func (w *isoWorld) evictIfJoined(t *testing.T, outsider, tenant *isoTenant) bool {
	t.Helper()
	ctx := context.Background()
	var joined bool
	if err := w.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2)
		    OR EXISTS (SELECT 1 FROM workspace_members wm JOIN workspaces ws ON ws.id = wm.workspace_id
		               WHERE ws.organization_id = $1 AND wm.user_id = $2)`, tenant.orgID, outsider.userID).Scan(&joined); err != nil {
		t.Fatal(err)
	}
	if !joined {
		return false
	}
	for _, q := range []string{
		`DELETE FROM workspace_members wm USING workspaces ws WHERE ws.id = wm.workspace_id AND ws.organization_id = $1 AND wm.user_id = $2`,
		`DELETE FROM organization_member_profiles WHERE organization_id = $1 AND user_id = $2`,
		`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
	} {
		if _, err := w.pool.Exec(ctx, q, tenant.orgID, outsider.userID); err != nil {
			t.Fatal(err)
		}
	}
	return true
}

// emptyTenantTables lists the tables with an organization_id column that
// hold no row of tn's.
func (w *isoWorld) emptyTenantTables(t *testing.T, tn *isoTenant) []string {
	t.Helper()
	ctx := context.Background()
	rows, err := w.pool.Query(ctx, `
		SELECT c.table_name FROM information_schema.columns c
		JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
		WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND tb.table_type = 'BASE TABLE'
		ORDER BY c.table_name`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	var empty []string
	for _, table := range tables {
		if _, skip := isoUnseeded[table]; skip {
			continue
		}
		var has bool
		if err := w.pool.QueryRow(ctx, fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %q WHERE organization_id = $1)`, table), tn.orgID).Scan(&has); err != nil {
			t.Fatal(err)
		}
		if !has {
			empty = append(empty, table)
		}
	}
	return empty
}

// isoUnseeded lists tenant tables the fixture leaves empty, with the reason
// no route of the API can fill them.
var isoUnseeded = map[string]string{
	"task_source_contexts":    "no code path writes it today; only the files backfill reads it",
	"invoices":                "written by a billing provider's webhook; the manual provider in tests issues none",
	"billing_payment_intents": "created only by owner checkout; isolation matrix does not run paid checkout",
	"file_backfill_items":     "operator ledger of cmd/files-backfill, exempt from ADR 0008 (tenantExemptTables)",
	"meeting_reminders":       "written only by the meeting reminder job (internal/notification); no route fills it",
}

// isoDigestSkip lists tenant tables a refused request is allowed to write:
// the security trail of the refusal itself.
var isoDigestSkip = map[string]string{}

func isoClip(raw []byte) string {
	s := string(raw)
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}
