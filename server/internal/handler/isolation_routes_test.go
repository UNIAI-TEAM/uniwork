package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// isoClass is how a route relates to the tenant boundary.
type isoClass int

const (
	// isoScoped routes act on one organization's rows; an outsider is refused.
	isoScoped isoClass = iota
	// isoStub routes are catalogue stubs (task_stubs.go): the same 422
	// capability_unavailable for every caller and every id, so they reveal
	// nothing — but the day one is implemented it falls back to isoScoped.
	isoStub
	// isoSelf routes act on the caller's own account and name no tenant.
	isoSelf
	// isoPublic routes are reachable without a membership by design: sign-in,
	// probes, provider callbacks, and links whose secret is the credential.
	isoPublic
	// isoPlatform routes are the platform console, across tenants by design
	// and closed to anyone without users.platform_role.
	isoPlatform
	// isoRealtime routes upgrade to a WebSocket and authenticate in-band, so a
	// status code says nothing; TestIsolationRealtime speaks their protocol.
	isoRealtime
)

func (c isoClass) tenantScoped() bool { return c == isoScoped || c == isoStub }

// isoSpec is one row of the matrix. Only rows that differ from the default —
// isoScoped, no body, refused with 403/404 — are written down.
type isoSpec struct {
	class  isoClass
	reason string
	query  string
	// body builds the request for the tenant whose ids are in the path. The
	// cross-tenant pass sends A's body as B, so a body that names rows names
	// A's rows too.
	body func(w *isoWorld, tn *isoTenant) isoBody
	// skipControl explains why the owner's own call is not expected to
	// succeed in the control passes (for example a provider that is not
	// configured).
	skipControl string
	// control lists extra statuses the control pass accepts.
	control []int
	// mixedFirst names the fixture row that fills the first parameter in the
	// mixed pass, when the default row would fail a state check (a scheduled
	// meeting) before the route ever looks at the child.
	mixedFirst string
	// mixedOK explains why the mixed pass may answer: the route acts only on
	// the caller's own rows and answers a foreign id exactly as an unknown
	// one, so the answer reveals nothing. The leak, change and reference
	// checks still apply.
	mixedOK string
	// uniformAnswer explains why the cross-tenant pass may answer: the route
	// is deliberately uniform, so an outsider naming a foreign row is served
	// the same answer it gets for an id that names no row at all. The reason
	// is required; the pass then makes BOTH calls itself and holds the route
	// to a byte-identical status and body (isoUniformCheck), keeps every
	// change, leak and reference check, and fails if a document_access_requests
	// row appears in either organization. It is for a route whose single path
	// id is the whole attack surface, which the mixed pass never reaches.
	uniformAnswer string
	// controlAs names the tenant member the write control sends as when the
	// owner is not the one the route serves ("peer" answers an invitation,
	// "third" cancels the knock they made) or must stay ("third" leaves the
	// group so the owner's later writes in it still count).
	controlAs string
	// refusedAlso lists statuses that also count as a refusal on this route,
	// for a route guarded by something other than a membership (a machine
	// secret); the reason says what.
	refusedAlso []int
	// checkControl inspects a successful GET control body on routes whose
	// populated envelope must be proven over HTTP (BE-SD7-14).
	checkControl func(t *testing.T, tn *isoTenant, raw []byte)
}

func (s isoSpec) bodyFor(w *isoWorld, tn *isoTenant) isoBody {
	if s.body == nil {
		return isoBody{}
	}
	return s.body(w, tn)
}

func (s isoSpec) controlOK(status int, raw []byte) bool {
	// A stub answers its fixed capability_unavailable to its owner too. The
	// day it is implemented the control sees something else and fails, so the
	// row has to be reclassified rather than staying a stub on trust.
	if s.class == isoStub {
		return status == http.StatusUnprocessableEntity && bytes.Contains(raw, []byte("capability_unavailable"))
	}
	if status >= 200 && status < 300 {
		return true
	}
	for _, c := range s.control {
		if c == status {
			return true
		}
	}
	return false
}

// refused is the only acceptable answer to an outsider: 403 or 404, or for a
// stub its fixed 422. 401 would mean the token was not even read; anything in
// 2xx/3xx served the request; 400/409/422 means the handler reached its
// validation or state checks before deciding who is asking, which proves
// nothing about isolation — fix the order, or give the row a valid body.
//
// A uniformAnswer row is not exempted here on purpose: the anonymous and
// member-of-both passes keep requiring a real refusal (401 with no session),
// and only the cross-tenant pass relaxes the class, holding the route to
// byte-identical answers instead (isoUniformCheck).
func (s isoSpec) refused(status int, raw []byte) bool {
	for _, r := range s.refusedAlso {
		if r == status {
			return true
		}
	}
	switch status {
	case http.StatusForbidden, http.StatusNotFound:
		return true
	case http.StatusUnprocessableEntity:
		return s.class == isoStub && bytes.Contains(raw, []byte("capability_unavailable"))
	}
	return false
}

// isoWith builds a JSON body from the tenant's ids: each value names a key of
// isoTenant.ids, so the cross-tenant pass sends the other tenant's rows.
func isoWith(fields map[string]string, extra map[string]any) func(*isoWorld, *isoTenant) isoBody {
	return func(_ *isoWorld, tn *isoTenant) isoBody {
		body := map[string]any{}
		for k, v := range extra {
			body[k] = v
		}
		for field, key := range fields {
			body[field] = tn.ids[key]
		}
		return isoBody{json: body}
	}
}

// isoFile is a multipart body with one file part; its fields may name ids.
func isoFile(filename, contentType string, content []byte, fields map[string]string) func(*isoWorld, *isoTenant) isoBody {
	return func(_ *isoWorld, tn *isoTenant) isoBody {
		f := map[string]string{}
		for k, v := range fields {
			f[k] = v
		}
		if _, ok := f["client_msg_id"]; ok {
			f["client_msg_id"] = "iso-" + tn.tag
		}
		return isoBody{
			multipart: &isoMultipart{fields: f, filename: filename, contentType: contentType, content: content},
			headers:   map[string]string{"Idempotency-Key": "iso-" + tn.tag},
		}
	}
}

// isoIdem is isoWith plus an Idempotency-Key header.
func isoIdem(fields map[string]string, extra map[string]any) func(*isoWorld, *isoTenant) isoBody {
	inner := isoWith(fields, extra)
	return func(w *isoWorld, tn *isoTenant) isoBody {
		b := inner(w, tn)
		b.headers = map[string]string{"Idempotency-Key": "iso-" + tn.tag}
		return b
	}
}

// isoIdemOnly sends no body, only the tenant's seeded intent key - the key
// isolation_world_test.go commits (and leaves not_committed), so the owner's
// control reads a real intent row and the other tenant is refused on the
// document before any intent is read.
func isoIdemOnly(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{headers: map[string]string{"Idempotency-Key": "iso-intent-" + tn.tag}}
}

// isoForwardBody forwards into the tenant's own group room.
func isoForwardBody(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"target_room_ids": []any{tn.ids["room"]}}}
}

func isoJSON(v any) func(*isoWorld, *isoTenant) isoBody {
	return func(*isoWorld, *isoTenant) isoBody { return isoBody{json: v} }
}

// isoAccessRequestCreate is the DOC-07 create body: a valid level, a short
// message and no source. Every field is body-only, so a foreign document id
// cannot turn this into a 400 and the answer stays the uniform 202.
func isoAccessRequestCreate(_ *isoWorld, _ *isoTenant) isoBody {
	return isoBody{json: map[string]any{"requested_level": "view", "message": "isolation matrix"}}
}

// isoDownloadJobBody asks for the tenant's own file document as a zip.
func isoDownloadJobBody(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"document_ids": []string{tn.ids["fileDocument"]}}}
}

// isoFolderUploadBody plans one small file under the tenant's own folder.
func isoFolderUploadBody(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{
		json: map[string]any{
			"parent_id": tn.ids["folder"], "root_name": "Iso upload", "share_with_workspace": false,
			"folders": []string{}, "files": []map[string]any{{"file_key": "k1", "path": "", "filename": "iso.md", "size_bytes": 3}},
		},
		headers: map[string]string{"Idempotency-Key": "iso-folder-upload-" + tn.tag},
	}
}

// isoFolderUploadContent is the three bytes the seeded file row declares.
func isoFolderUploadContent(_ *isoWorld, _ *isoTenant) isoBody {
	return isoBody{raw: []byte("abc")}
}

// isoFolderUploadComplete completes the seeded file with an ETag no upload
// answers, so the file stays pending (parts_invalid or upload_missing).
func isoFolderUploadComplete(_ *isoWorld, tn *isoTenant) isoBody {
	return isoBody{json: map[string]any{"files": []map[string]any{{"file_key": tn.ids["folderUploadFileKey"], "etag": `"iso"`}}}}
}

// isoUnknownDocumentID is a well-formed ULID that names no row: the id the
// uniformAnswer check pairs with the foreign one, so the route's answer cannot
// depend on whether the document exists.
const isoUnknownDocumentID = "01J8X4NONEN1P2Q3R4S5T6U7V8"

// accessRequestSnapshot captures one organization's document_access_requests
// rows (id and mutable columns, across every document) so isoUniformCheck can
// prove neither the foreign-id call nor the unknown-id comparison stored or
// altered a row in either organization (BE-SD7-8).
func (w *isoWorld) accessRequestSnapshot(t *testing.T, orgID string) string {
	t.Helper()
	var snap string
	if err := w.pool.QueryRow(context.Background(), `
		SELECT coalesce(string_agg(
			id || ':' || document_id || ':' || created_by || ':' || requested_level || ':' || message || ':' || status || ':' ||
			coalesce(source_kind, '') || ':' || coalesce(source_id, '') || ':' || coalesce(decided_at::text, '') || ':' || coalesce(updated_at::text, ''),
			',' ORDER BY id
		), '')
		FROM document_access_requests
		WHERE organization_id = $1`, orgID).Scan(&snap); err != nil {
		t.Fatal(err)
	}
	return snap
}

// isoNotificationDocumentsCheck proves the owner's control reads the one
// notification_documents row the world seeds: the tenant's own document,
// which its owner reads, comes back named and not deleted.
func isoNotificationDocumentsCheck(t *testing.T, tn *isoTenant, raw []byte) {
	t.Helper()
	var out struct {
		Documents []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Deleted bool   `json:"deleted"`
		} `json:"documents"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Errorf("GET /me/notifications/{notificationID}/documents (%s): unmarshal: %v (%s)", tn.tag, err, isoClip(raw))
		return
	}
	if len(out.Documents) != 1 || out.Documents[0].ID != tn.ids["document"] || out.Documents[0].Title == "" || out.Documents[0].Deleted {
		t.Errorf("GET /me/notifications/{notificationID}/documents (%s): documents = %v, want the tenant's own document: %s", tn.tag, out.Documents, isoClip(raw))
	}
}

// isoAccessRequestsListCheck asserts the populated manager list on
// GET /documents/{documentID}/access-requests (BE-SD7-14): the two seeded
// pending requests on accessRequestDocument carry their requester ids,
// levels, messages, and the readable-object vs null source pair.
func isoAccessRequestsListCheck(t *testing.T, tn *isoTenant, raw []byte) {
	t.Helper()
	var out struct {
		Requests []struct {
			ID             string `json:"id"`
			RequesterID    string `json:"requester_id"`
			RequestedLevel string `json:"requested_level"`
			Message        string `json:"message"`
			Source         *struct {
				Kind  string `json:"kind"`
				ID    string `json:"id"`
				Title string `json:"title"`
			} `json:"source"`
		} `json:"requests"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Errorf("GET /documents/{documentID}/access-requests (%s): unmarshal: %v (%s)", tn.tag, err, isoClip(raw))
		return
	}
	if len(out.Requests) != 2 {
		t.Errorf("GET /documents/{documentID}/access-requests (%s): len(requests) = %d, want 2: %s", tn.tag, len(out.Requests), isoClip(raw))
		return
	}
	byID := map[string]int{}
	for i, r := range out.Requests {
		byID[r.ID] = i
	}
	idxPeer, okPeer := byID[tn.ids["accessRequest"]]
	idxThird, okThird := byID[tn.ids["accessRequestDecline"]]
	if !okPeer || !okThird {
		t.Errorf("GET /documents/{documentID}/access-requests (%s): missing seeded ids (%s, %s) in %s",
			tn.tag, tn.ids["accessRequest"], tn.ids["accessRequestDecline"], isoClip(raw))
		return
	}
	peerReq := out.Requests[idxPeer]
	if peerReq.RequesterID != tn.peerID || peerReq.RequestedLevel != "view" || peerReq.Message != tn.marker+" access request message" {
		t.Errorf("GET /documents/{documentID}/access-requests (%s) peer row = %+v, want requester=%s level=view message=%q",
			tn.tag, peerReq, tn.peerID, tn.marker+" access request message")
	}
	if peerReq.Source == nil || peerReq.Source.Kind != "task" || peerReq.Source.ID != tn.ids["task"] || peerReq.Source.Title == "" {
		t.Errorf("GET /documents/{documentID}/access-requests (%s) peer source = %+v, want task %s with title",
			tn.tag, peerReq.Source, tn.ids["task"])
	}
	thirdReq := out.Requests[idxThird]
	if thirdReq.RequesterID != tn.thirdID || thirdReq.RequestedLevel != "edit" || thirdReq.Message != tn.marker+" decline access request message" {
		t.Errorf("GET /documents/{documentID}/access-requests (%s) third row = %+v, want requester=%s level=edit message=%q",
			tn.tag, thirdReq, tn.thirdID, tn.marker+" decline access request message")
	}
	if thirdReq.Source != nil {
		t.Errorf("GET /documents/{documentID}/access-requests (%s) third source = %+v, want nil", tn.tag, thirdReq.Source)
	}
}

// isoUniformCheck holds a route marked uniformAnswer to the rule its reason
// claims: the caller's answer for a foreign row must be byte-identical (status
// and body) to the same call with an id that names no row, and the attack must
// leave no new or changed document_access_requests row in either organization
// across all documents (BE-SD7-8). It returns the foreign answer so the caller
// can keep its other checks.
//
// The route is deliberately uniform (§3.1), so a mismatch means the answer
// reveals whether the document exists, and a changed snapshot means the attack
// stored or mutated a request in either tenant.
func (w *isoWorld) isoUniformCheck(t *testing.T, label, method, pattern string, spec isoSpec, foreignPath string) []byte {
	t.Helper()
	before := map[string]string{
		w.alpha.orgID: w.accessRequestSnapshot(t, w.alpha.orgID),
		w.bravo.orgID: w.accessRequestSnapshot(t, w.bravo.orgID),
	}
	foreignBody := spec.bodyFor(w, w.alpha)
	foreignStatus, foreignRaw := w.do(t, method, foreignPath, w.bravo.token, foreignBody)

	unknownPath := strings.Replace(foreignPath, w.alpha.ids["accessRequestDocument"], isoUnknownDocumentID, 1)
	if unknownPath == foreignPath {
		unknownPath = strings.Replace(foreignPath, w.alpha.ids["document"], isoUnknownDocumentID, 1)
	}
	if unknownPath == foreignPath {
		t.Errorf("%s: the pattern names no {documentID} to swap; isoUniformCheck cannot build the unknown-id call", label)
		return foreignRaw
	}
	unknownStatus, unknownRaw := w.do(t, method, unknownPath, w.bravo.token, foreignBody)
	if !isoUniformEqual(foreignStatus, foreignRaw, unknownStatus, unknownRaw) {
		t.Errorf("%s: foreign id answers %d %s, unknown id answers %d %s — a uniform route must answer both identically",
			label, foreignStatus, isoClip(foreignRaw), unknownStatus, isoClip(unknownRaw))
	}
	for _, tn := range []*isoTenant{w.alpha, w.bravo} {
		if after := w.accessRequestSnapshot(t, tn.orgID); after != before[tn.orgID] {
			t.Errorf("%s: %s's document_access_requests rows changed (%q -> %q); the attack must store or change none",
				label, tn.tag, before[tn.orgID], after)
		}
	}
	return foreignRaw
}

// isoUniformEqual is the whole rule of a uniformAnswer row: two answers are
// interchangeable when both the status and the body are the same. A 404 for
// the foreign id, or a 202 whose body names the document, fails it.
func isoUniformEqual(foreignStatus int, foreignRaw []byte, unknownStatus int, unknownRaw []byte) bool {
	return foreignStatus == unknownStatus && bytes.Equal(bytes.TrimSpace(foreignRaw), bytes.TrimSpace(unknownRaw))
}

// TestUniformAnswerComparisonIsNotATautology is the harness self-test of the
// uniformAnswer row: the comparison must accept two identical answers and
// reject a foreign id that answers anything else — a different 202 body or a
// 404 where the unknown id answered 202. It runs no server: the rule is the
// comparison, and the matrix itself is what proves the real route obeys it.
func TestUniformAnswerComparisonIsNotATautology(t *testing.T) {
	sent := []byte(`{"status":"sent"}` + "\n")
	for name, tc := range map[string]struct {
		foreignStatus int
		foreignRaw    []byte
		want          bool
	}{
		"identical answers pass":            {http.StatusAccepted, sent, true},
		"a different 202 body fails":        {http.StatusAccepted, []byte(`{"status":"sent","document_id":"01J8X4DOC0N1P2Q3R4S5T6U7"}`), false},
		"a 404 where the unknown id is 202": {http.StatusNotFound, []byte(`{"error":{"code":"not_found"}}`), false},
		"a 403 fails":                       {http.StatusForbidden, []byte(`{"error":{"code":"forbidden"}}`), false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := isoUniformEqual(tc.foreignStatus, tc.foreignRaw, http.StatusAccepted, sent); got != tc.want {
				t.Fatalf("isoUniformEqual = %v, want %v", got, tc.want)
			}
		})
	}
}

const (
	reasonAuth     = "authentication: there is no tenant before sign-in"
	reasonProbe    = "process probe or public configuration, no tenant data"
	reasonProvider = "provider callback authenticated by the provider's signature or OAuth state, not by a member"
	reasonSelf     = "the caller's own account; the listing pass checks it shows nothing of another tenant"
	reasonLink     = "the link secret in the path or body is the credential; holding it is the grant"
	reasonPlatform = "platform console: across tenants by design, closed without users.platform_role"
	reasonStub     = "catalogue stub: the same 422 capability_unavailable for every caller and id"
	reasonTicket   = "authentication: the sealed sign-in ticket in the caller's HttpOnly cookie is the credential; there is no tenant before sign-in"
	// reasonNativeTicket is the app's ticket: in the JSON body, and opened
	// only with the nonce of the sign-in that issued it.
	reasonNativeTicket = "authentication: the sealed sign-in ticket in the body, which opens only with the nonce of the sign-in that issued it, is the credential; there is no tenant before sign-in"
)

// isoRoutes holds every route that is not plain isoScoped-with-no-body.
var isoRoutes = map[string]isoSpec{
	// Sign-in and probes.
	"GET /healthz":                                      {class: isoPublic, reason: reasonProbe},
	"GET /readyz":                                       {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/healthz":                               {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/config":                                {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/plans":                                 {class: isoPublic, reason: reasonProbe},
	"POST /api/v1/rum":                                  {class: isoPublic, reason: reasonProbe},
	"POST /api/v1/mobile/events":                        {class: isoSelf, reason: "anonymous product counters by OS and app version: nothing is stored or returned, no tenant is named"},
	"POST /api/v1/demo-requests":                        {class: isoPublic, reason: "Anonymous pre-account intake returns only its receipt; personal fields are platform-only."},
	"GET /api/v1/admin/demo-requests":                   {class: isoPlatform, reason: reasonPlatform},
	"PATCH /api/v1/admin/demo-requests/{demoRequestID}": {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/chat-reports":                    {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/chat-reports/{chatReportID}/resolve": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"reason": "acted on with the organization's owner",
	})},
	"POST /api/v1/admin/chat-reports/{chatReportID}/remove-message": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"reason": "objectionable content taken down within 24 hours",
	})},
	"GET /api/v1/notifications/push/config": {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/auth/google/callback":      {class: isoPublic, reason: reasonAuth},
	"GET /api/v1/auth/google/start":         {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/apple/native":        {class: isoPublic, reason: "authentication: Apple's identity token, signed for this app's bundle id and carrying the hash of the request's nonce, is the credential; it names no tenant row"},
	// Sign in with Apple on the web (ADR 0049 §7): the state sealed in the
	// browser's cookie, and the identity token Apple answers the code with,
	// are the credential; the result cookie the finish reads is sealed too.
	"GET /api/v1/auth/apple/start":      {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/apple/callback":  {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/auth/apple/finish":     {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/login":           {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/logout":          {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/mfa/verify":      {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/password/forgot": {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/password/reset":  {class: isoPublic, reason: reasonAuth},
	"GET /api/v1/auth/providers":        {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/refresh":         {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/register":        {class: isoPublic, reason: reasonAuth},
	// The choice screen of a provider sign-in that found no account (ADR
	// 0049): the sealed ticket in the HttpOnly cookie is the credential, the
	// identity a provider just proved; it names no tenant row.
	"GET /api/v1/auth/sign-in-ticket":                     {class: isoPublic, reason: reasonTicket},
	"DELETE /api/v1/auth/sign-in-ticket":                  {class: isoPublic, reason: reasonTicket},
	"POST /api/v1/auth/sign-in-ticket/create":             {class: isoPublic, reason: reasonTicket},
	"POST /api/v1/auth/sign-in-ticket/claim-email":        {class: isoPublic, reason: reasonTicket},
	"POST /api/v1/auth/sign-in-ticket/claim-email/verify": {class: isoPublic, reason: reasonTicket},
	"POST /api/v1/auth/sign-in-ticket/link":               {class: isoSelf, reason: "links the ticket's identity into the caller's own account only; the account is the bearer's, the identity the sealed ticket the caller's browser holds, and no id is taken from the request"},
	// The app's own sign-in screen (ADR 0049 §8): the same credentials as
	// the browser's doors, in JSON; client_id and deployment_id are
	// allowlist values, never rows.
	"POST /api/v1/auth/native/password":                          {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/native/mfa":                               {class: isoPublic, reason: "authentication: the challenge token, signed and bound to this app's client and deployment, with the second factor is the credential; it names no tenant row"},
	"POST /api/v1/auth/native/google":                            {class: isoPublic, reason: "authentication: Google's ID token, issued to this app's own client (azp) and carrying the hash of the request's nonce, is the credential; it names no tenant row"},
	"POST /api/v1/auth/native/apple":                             {class: isoPublic, reason: "authentication: Apple's identity token, signed for this app's bundle id and carrying the hash of the request's nonce, is the credential; it names no tenant row"},
	"POST /api/v1/auth/native/register":                          {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/native/sign-in-ticket/create":             {class: isoPublic, reason: reasonNativeTicket},
	"POST /api/v1/auth/native/sign-in-ticket/claim-email":        {class: isoPublic, reason: reasonNativeTicket},
	"POST /api/v1/auth/native/sign-in-ticket/claim-email/verify": {class: isoPublic, reason: reasonNativeTicket},
	"POST /api/v1/auth/native/sign-in-ticket/discard":            {class: isoPublic, reason: reasonNativeTicket},
	"POST /api/v1/auth/native/sign-in-ticket/link":               {class: isoSelf, reason: "links the app's ticket's identity into the caller's own account only; the account is the bearer's device session's, the identity the sealed ticket the app holds with its nonce, and no id is taken from the request"},

	// MCP connector OAuth server (ADR 0031): a client is a program, and the
	// code, verifier, refresh token or client secret is the credential.
	"GET /.well-known/oauth-protected-resource":     {class: isoPublic, reason: "OAuth discovery: public metadata, no tenant (ADR 0031)"},
	"GET /.well-known/oauth-protected-resource/mcp": {class: isoPublic, reason: "OAuth discovery: public metadata, no tenant (ADR 0031)"},
	"GET /.well-known/oauth-authorization-server":   {class: isoPublic, reason: "OAuth discovery: public metadata, no tenant (ADR 0031)"},
	"GET /oauth/authorize":                          {class: isoPublic, reason: reasonAuth},
	"POST /oauth/token":                             {class: isoPublic, reason: "authentication: the one-time code with its PKCE verifier, or a refresh token, is the credential"},
	"POST /oauth/revoke":                            {class: isoPublic, reason: "authentication: the token is the credential; another client's token is left untouched (RFC 7009)"},
	"POST /oauth/register":                          {class: isoPublic, reason: "dynamic client registration: a client is a program, not tenant data"},
	"POST /mcp":                                     {class: isoPublic, reason: "MCP: the bearer is an opaque MCP token bound to one grant's organization, never a session; TestIsolationMCP holds it"},
	"GET /mcp":                                      {class: isoPublic, reason: "MCP: stateless transport answers 405 after the token check; TestIsolationMCP holds the tenant"},
	"DELETE /mcp":                                   {class: isoPublic, reason: "MCP: stateless transport answers 405 after the token check; TestIsolationMCP holds the tenant"},

	// MCP connector, web side (ADR 0031). The consent attempt and the grants
	// belong to a person; the organization routes ({org}) are scoped by their
	// path and need no row. TestIsolationMCP holds the /mcp side.
	"GET /api/v1/auth/connect/attempts/{attemptID}": {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/auth/connect/attempts/{attemptID}": {class: isoSelf,
		reason: "the caller's own attempt: B sends A's live CSRF token and B's own enabled organization against A's claimed attempt and answers 400 csrf_invalid, as for an attempt that does not exist (no existence oracle); naming an organization the caller is not in is 403 (TestIsolationMCP, TestMcpApproveRefusals); A's attempt stays undecided and unclaimed (untouched subtest)",
		// The cross-tenant passes call body with A, so mcpCSRF is A's token.
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"decision": "approve", "csrf_token": tn.ids["mcpCSRF"], "organization_id": w.bravo.orgID}}
		},
		refusedAlso: []int{http.StatusBadRequest}},
	"GET /api/v1/me/connected-apps":              {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/me/connected-apps/{grantID}": {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/orgs/{org}/mcp-policy": {
		reason: "the attack on A sends enabled false, which would switch A's connector off, so A's tenant digest catches a breach; every other tenant's own call sends true, a repeated enable that answers 200 and leaves its switch on",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"enabled": tn != w.alpha}}
		}},
	"PUT /api/v1/orgs/{org}/push-preview-policy": {
		reason: "the attack on A sends hidden true, which would hide the words of A's pushes, so A's tenant digest catches a breach; every other tenant's own call sends false, the default, which answers 200 and changes nothing",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"hidden": tn == w.alpha}}
		}},
	"PUT /api/v1/orgs/{org}/mobile-security-policy": {
		reason: "the attack on A sends both requirements true, which would lock every phone of A, so A's tenant digest catches a breach; every other tenant's own call sends both false, the default, which answers 200 and changes nothing",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"require_app_lock": tn == w.alpha, "block_screen_capture": tn == w.alpha}}
		}},
	"PUT /api/v1/orgs/{org}/mcp-policy/write": {
		reason: "the attack on A sends enabled false, which would switch A's write access off, so A's tenant digest catches a breach; every other tenant's own call sends true, a repeated enable (buildMcp turns write on) that answers 200",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"enabled": tn != w.alpha}}
		}},

	"GET /uploads/*": {class: isoPublic, reason: "legacy local-disk objects by unguessable key; FileService objects (v1/) are refused - TestServeFileRefusesFileServiceObjects and the uploads subtest"},

	// Provider callbacks.
	"POST /api/v1/integrations/livekit/webhook":             {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/billing/webhooks/vnpay":                    {class: isoPublic, reason: reasonProvider},
	"POST /api/v1/billing/webhooks/vnpay":                   {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/calendar-connections/{provider}/callback":  {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/email-hub-connections/{provider}/callback": {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/drive-connections/google/callback":         {class: isoPublic, reason: reasonProvider},

	// Links whose secret is the credential.
	"GET /api/v1/public/documents/{token}":                   {class: isoPublic, reason: reasonLink},
	"GET /api/v1/public/documents/{token}/assets/{assetID}":  {class: isoPublic, reason: reasonLink},
	"HEAD /api/v1/public/documents/{token}/assets/{assetID}": {class: isoPublic, reason: reasonLink},
	"GET /api/v1/public/documents/{token}/download":          {class: isoPublic, reason: reasonLink},
	"HEAD /api/v1/public/documents/{token}/download":         {class: isoPublic, reason: reasonLink},
	"POST /api/v1/public/meeting-invite-links/resolve":       {class: isoPublic, reason: reasonLink},

	// The caller's own account.
	"GET /api/v1/ws":                                          {class: isoRealtime, reason: "workspace WebSocket: membership is checked on the auth frame, scopes on subscribe - TestIsolationRealtime"},
	"GET /api/v1/me":                                          {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/chat/unread-summary":                      {class: isoSelf, reason: reasonSelf},
	"PATCH /api/v1/me":                                        {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/avatar":                                  {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/delete":                                  {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/ai-consent":                               {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/push-previews":                            {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/ask-uni-mode":                             {class: isoSelf, reason: "the person's own Ask UNI mode (users.ask_uni_mode): it names no tenant row, takes no id and changes only the caller's account"},
	"PUT /api/v1/me/ask-uni-memory":                           {class: isoSelf, reason: "the person's own Ask UNI memory switch (users.ask_uni_memory_off): it carries no tenant id and changes only the caller's account"},
	"DELETE /api/v1/me/ai-consent":                            {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/email/resend":                            {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/email/verify":                            {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/invitations":                              {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/confirm":                             {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/disable":                             {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/setup":                               {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/step-up":                                 {class: isoSelf, reason: "proves the caller to their own account; the token it answers is bound to the caller's own session and opens nothing of a tenant's"},
	"POST /api/v1/me/step-up/email-code":                      {class: isoSelf, reason: "mails a code to the caller's own account address; takes no id"},
	"GET /api/v1/me/sign-in-methods":                          {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/password":                                 {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/sign-in-methods/google/link":             {class: isoSelf, reason: "starts a link into the caller's own account; the link token it answers names that account and session, nothing taken from the request"},
	"POST /api/v1/me/sign-in-methods/apple/link":              {class: isoSelf, reason: "starts a link into the caller's own account; the link token it answers names that account and session, nothing taken from the request"},
	"POST /api/v1/me/sign-in-methods/google/unlink":           {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/sign-in-methods/apple/unlink":            {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/sign-in-methods/google/native":           {class: isoSelf, reason: "links the identity the app's Google token proves into the caller's own account; no id is taken from the request"},
	"POST /api/v1/me/sign-in-methods/apple/native":            {class: isoSelf, reason: "links the identity the app's Apple token proves into the caller's own account; no id is taken from the request"},
	"GET /api/v1/me/notification-preferences":                 {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/notification-preferences":                 {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notifications":                            {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notifications/{notificationID}/documents": {class: isoScoped, reason: "the caller's own notification row (it carries the tenant): B names A's id and gets the same 404 as an unknown one, and the page lists a document only after the read gate passes for the caller; control = the owner reads the seeded notification_documents row", checkControl: isoNotificationDocumentsCheck},
	"POST /api/v1/me/notifications/archive":                   {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/read":                      {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/unarchive":                 {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/unread":                    {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notifications/unread-count":               {class: isoSelf, reason: reasonSelf},
	"PATCH /api/v1/me/onboarding":                             {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/onboarding/complete":                     {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/me/push-subscriptions":                    {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/push-subscriptions":                      {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/sessions":                                 {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/sessions/revoke-others":                  {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/me/sessions/{sessionId}":                  {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/orgs":                                        {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/orgs":                                       {class: isoSelf, reason: "creates a new organization owned by the caller"},
	"GET /api/v1/workspaces":                                  {class: isoSelf, reason: reasonSelf},

	// Office desktop bridge. The credential in each public route (the PKCE
	// verifier with its one-time code, the refresh token, the preview
	// capability) is what grants it; the rows they name are attacked by the
	// references pass (device_session_id, launch tickets) and the mixed pass.
	"GET /api/v1/auth/desktop/start":      {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/desktop/exchange":  {class: isoPublic, reason: "authentication: the one-time code with its PKCE verifier is the credential"},
	"POST /api/v1/auth/desktop/refresh":   {class: isoPublic, reason: "authentication: the rotating refresh token is the credential"},
	"GET /api/v1/auth/desktop/authorize":  {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/auth/desktop/authorize": {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/auth/desktop/logout":    {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/auth/desktop/devices":    {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/auth/desktop/devices/{deviceSessionID}": {class: isoSelf, reason: reasonSelf,
		refusedAlso: []int{http.StatusOK}}, // an unknown, revoked or foreign device all answer an idempotent 200 that changes nothing; the untouched subtest checks A's device is still live
	"POST /api/v1/office/sessions/exchange":             {class: isoSelf, reason: "desktop main: the device bearer's session must be the body's device and the ticket's account; attacked in isoReferences"},
	"GET /api/v1/preview/assets/{capability}/{assetID}": {class: isoPublic, reason: "the signed preview capability in the path is the credential; it lists the only assets it opens"},
	// Office Docs web frame: refresh names no row; the frame token it carries
	// is bound to one document and re-mints only that binding. The document
	// routes are cross-tenant by default and sent with each caller's own frame
	// token (isoWorld.frameTokens).

	// Platform console.
	"GET /api/v1/admin/flags":                    {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/flags/overrides":          {class: isoPlatform, reason: reasonPlatform},
	"DELETE /api/v1/admin/flags/{key}/overrides": {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/flags/{key}/overrides":    {class: isoPlatform, reason: reasonPlatform},
	"PUT /api/v1/admin/flags/{key}/overrides":    {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/me":                       {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/plans":                    {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/invoices":                 {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/billing/payment-intents":  {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/invoices/{invoiceID}/refund": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"reason": "isolation matrix fixture",
	})},
	"POST /api/v1/admin/invoices/{invoiceID}/confirm-refund": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"reason": "isolation matrix fixture",
	})},
	"POST /api/v1/admin/invoices/{invoiceID}/revert-refund": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"reason": "isolation matrix fixture",
	})},
	"POST /api/v1/admin/plans": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"code": "iso_test_plan", "name": "ISO", "description": "", "billing_period": "none",
		"price_currency": "VND", "is_active": false, "sort_order": 99, "reason": "isolation matrix fixture",
	})},
	"PUT /api/v1/admin/plans/{code}": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"name": "Starter", "description": "", "billing_period": "none", "price_currency": "VND",
		"is_active": true, "sort_order": 0, "reason": "isolation matrix fixture",
	})},
	"PUT /api/v1/admin/plans/{code}/features/{key}": {class: isoPlatform, reason: reasonPlatform, body: isoJSON(map[string]any{
		"enabled": true, "reason": "isolation matrix fixture",
	})},
	"GET /api/v1/admin/organizations":                          {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/organizations/{orgID}":                  {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/plan":            {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/suspend":         {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/deletion":        {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/deletion/cancel": {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/unsuspend":       {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/system":                                 {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/trace/{traceID}":                        {class: isoPlatform, reason: reasonPlatform},

	// Catalogue stubs (router/tasks_stubs.go).
	"GET /api/v1/tasks/{taskID}/active-task":                                              {class: isoStub, reason: reasonStub},
	"GET /api/v1/tasks/{taskID}/messages":                                                 {class: isoStub, reason: reasonStub},
	"GET /api/v1/tasks/{taskID}/pull-requests":                                            {class: isoStub, reason: reasonStub},
	"GET /api/v1/tasks/{taskID}/task-runs":                                                {class: isoStub, reason: reasonStub},
	"GET /api/v1/tasks/{taskID}/usage":                                                    {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/cancel":                                                  {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/terminate":                                               {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/rerun":                                                   {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/retry-source-context":                                    {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/move":                                                    {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/quick-actions/{quickActionID}/render":                    {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/quick-actions/{quickActionID}/run":                       {class: isoStub, reason: reasonStub},
	"POST /api/v1/tasks/{taskID}/tasks/{agentTaskID}/cancel":                              {class: isoStub, reason: reasonStub},
	"GET /api/v1/workspaces/{workspaceID}/tasks/limit-usage":                              {class: isoStub, reason: reasonStub},
	"GET /api/v1/workspaces/{workspaceID}/tasks/search":                                   {class: isoStub, reason: reasonStub},
	"POST /api/v1/workspaces/{workspaceID}/tasks/preview-trigger":                         {class: isoStub, reason: reasonStub},
	"POST /api/v1/workspaces/{workspaceID}/tasks/quick-create":                            {class: isoStub, reason: reasonStub},
	"GET /api/v1/workspaces/{workspaceID}/squads":                                         {class: isoStub, reason: reasonStub},
	"POST /api/v1/workspaces/{workspaceID}/squads":                                        {class: isoStub, reason: reasonStub},
	"GET /api/v1/workspaces/{workspaceID}/workdir":                                        {class: isoStub, reason: reasonStub},
	"GET /api/v1/workspaces/{workspaceID}/vcs/connections":                                {class: isoStub, reason: reasonStub},
	"POST /api/v1/workspaces/{workspaceID}/vcs/connections":                               {class: isoStub, reason: reasonStub},
	"DELETE /api/v1/workspaces/{workspaceID}/vcs/connections/{connectionID}":              {class: isoStub, reason: reasonStub},
	"POST /api/v1/workspaces/{workspaceID}/vcs/connections/{connectionID}/rotate-webhook": {class: isoStub, reason: reasonStub},

	// Scoped routes that need a query or answer a fixed 422 once authorized.
	"GET /api/v1/comments/{commentID}/sub-task-preview":                               {control: []int{http.StatusUnprocessableEntity}},
	"GET /api/v1/workspaces/{workspaceID}/calendar/events":                            {query: "?from={fromDate}&to={toDate}"},
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/search":        {query: "?q=message"},
	"GET /api/v1/workspaces/{workspaceID}/chat/messages/search":                       {query: "?q=message&scope=workspace"},
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/active": {query: "?call_id={callID}"},
	"GET /api/v1/workspaces/{workspaceID}/chat/users/lookup":                          {query: "?email={peerEmail}"},
	// The organization rides in the query; the installer profile is configured in the world, so the owner is served.
	"GET /api/v1/office/desktop/download":                            {query: "?organization_id={orgID}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/labels":          {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends": {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/sidebar-counts":  {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads":         {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/projects/search":           {query: "?q=Project"},
	// The access report (UNI-1643) over the tenant's folder: the mixed pass
	// sends B's workspace with A's folder.
	"GET /api/v1/workspaces/{workspaceID}/documents/access-report":            {query: "?folder_id={folderID}"},
	"GET /api/v1/workspaces/{workspaceID}/documents/access-report/export":     {query: "?folder_id={folderID}&format=csv"},
	"GET /api/v1/workspaces/{workspaceID}/documents/access-report/summary":    {query: "?folder_id={folderID}"},
	"GET /api/v1/workspaces/{workspaceID}/documents/access-report/principals": {query: "?folder_id={folderID}"},
	// The zip download job (UNI-2045): the request names the tenant's own file;
	// the job row is queued and has no file, so its download answers 404 to its
	// own creator too. In the mixed pass B's workspace carries A's ids: the job
	// is accepted and skips them as not_found (nothing of A's in the answer).
	"POST /api/v1/workspaces/{workspaceID}/documents/download-jobs":                 {body: isoDownloadJobBody, mixedOK: "an id of another tenant is skipped as not_found like an unknown one; the job answer carries no id or text of A's"},
	"GET /api/v1/workspaces/{workspaceID}/documents/download-jobs/{jobID}/download": {control: []int{http.StatusNotFound}},
	// Folder upload PLAN (UNI-2052): the tenant's own folder as the parent, one
	// fixed Idempotency-Key per tenant so every control pass replays the same
	// batch instead of taking another of the owner's two open batches. The
	// mixed pass sends A's folder in B's workspace: lockPageParent answers 404.
	"POST /api/v1/workspaces/{workspaceID}/documents/folder-uploads":             {body: isoFolderUploadBody},
	"GET /api/v1/workspaces/{workspaceID}/task-view-preferences":                 {query: "?scope_type=workspace"},
	"GET /api/v1/workspaces/{workspaceID}/task-views":                            {query: "?scope_type=workspace"},
	"GET /api/v1/workspaces/{workspaceID}/calendar/connections/{provider}/start": {skipControl: "no OAuth client is configured in tests; the owner gets 503"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/oauth/{provider}/start":     {skipControl: "no OAuth client is configured in tests; the owner gets 404"},
	"GET /api/v1/meetings/{meetingID}/lobby-ws":                                  {class: isoRealtime, reason: "lobby WebSocket: the auth frame is checked against the knock - TestIsolationRealtime"},
	"GET /api/v1/files/{fileID}/content":                                         {skipControl: "reads need the ticket POST .../files/resolve mints; without it everyone is refused"},
	"HEAD /api/v1/files/{fileID}/content":                                        {skipControl: "reads need the ticket POST .../files/resolve mints; without it everyone is refused"},

	// Folder upload batch read and cancel (UNI-2052 w3). B naming A's batch is
	// 404 on both (the batch is the creator's alone). The seeded batch is
	// completed: the owner's GET answers it without targets and the owner's
	// DELETE answers it unchanged (no status change, no audit row), so the
	// control cancels nothing the other batch routes need.
	"GET /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}":    {},
	"DELETE /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}": {},
	// The folder upload content route and COMPLETE (UNI-2052 w2) act on the
	// seeded batch, whose one file stays pending: the PUT replaces its upload
	// each pass and COMPLETE sends an ETag that never matches, so the file
	// never lands and every control pass finds it as the first did.
	"PUT /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}/files/{fileKey}/content": {body: isoFolderUploadContent},
	"POST /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}/complete":               {body: isoFolderUploadComplete},

	"GET /api/v1/workspaces/{workspaceID}/calendar/connections/{provider}/calendars":                       {skipControl: "no OAuth client is configured in tests; the owner gets 503"},
	"PUT /api/v1/workspaces/{workspaceID}/calendar/connections/{provider}/calendars":                       {body: isoJSON(map[string]any{"calendar_ids": []string{"primary"}}), skipControl: "owner 5xx found by G8-04, owner: calendar (no provider client is configured in tests; the owner gets 503)"},
	"GET /api/v1/meetings/{meetingID}/recordings/{recordingID}/content":                                    {control: []int{http.StatusConflict}},
	"GET /api/v1/documents/{documentID}/office/jobs/{jobID}/output":                                        {control: []int{http.StatusConflict}}, // the fixture job is a serialize job: its output is not committable, and only the owner is asked
	"GET /api/v1/meetings/{meetingID}/recordings/{recordingID}/playback-url":                               {control: []int{http.StatusConflict}},
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recordings/{recordingID}/content":      {control: []int{http.StatusConflict}},
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recordings/{recordingID}/playback-url": {control: []int{http.StatusConflict}},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}":                                    {query: "?account_id={emailAccount}"},
	"PATCH /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}":                                  {body: isoWith(map[string]string{"account_id": "emailAccount"}, map[string]any{"is_read": true})},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary":                         {query: "?account_id={emailAccount}&locale=en"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summarize":                      {body: isoWith(map[string]string{"account_id": "emailAccount"}, map[string]any{"locale": "en"})},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/ai/summary/tasks":                  {body: isoWith(map[string]string{"account_id": "emailAccount"}, map[string]any{"items": []any{map[string]any{"title": "x"}}})},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/attachments/{attachmentID}":         {query: "?account_id={emailAccount}", skipControl: "the bytes come from the IMAP server, which tests do not run"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads/{threadID}/conversation":                       {query: "?account_id={emailAccount}"},
	"DELETE /api/v1/comments/{commentID}/reactions":                                                        {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/comments/{commentID}/reactions":                                                          {body: isoJSON(map[string]any{"emoji": "👍"})},
	"PUT /api/v1/comments/{commentID}":                                                                     {body: isoJSON(map[string]any{"body": "edited"})},
	"PATCH /api/v1/documents/{documentID}":                                                                 {body: isoJSON(map[string]any{"revision": "1", "title": "edited"})},
	"POST /api/v1/documents/{documentID}/assets":                                                           {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"DELETE /api/v1/documents/{documentID}/comments/{commentID}/reactions":                                 {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/documents/{documentID}/comments/{commentID}/reactions":                                   {body: isoJSON(map[string]any{"emoji": "👍"})},
	"PATCH /api/v1/documents/{documentID}/comments/{commentID}":                                            {body: isoJSON(map[string]any{"body": "edited"})},
	"POST /api/v1/documents/{documentID}/comments":                                                         {body: isoJSON(map[string]any{"body": "hello", "type": "comment"})},

	// The document edit lock (UNI-1645 §6 step 4). R1, R3, R4 and R7 carry no
	// body and the owner holds docEditLock, so they stay plain isoScoped. No
	// skipControl: every row's control is a 2xx for its own member.
	"POST /api/v1/documents/{documentID}/edit-lock":                        {body: isoWith(map[string]string{"editor_id": "docEditor"}, map[string]any{"client": "desktop"})},
	"POST /api/v1/documents/{documentID}/edit-lock/take-over":              {body: isoWith(map[string]string{"expected_lock_id": "peerEditLock"}, map[string]any{"editor_id": "01J8X4ED1T0R0000000000000A", "client": "desktop"})},
	"PUT /api/v1/documents/{documentID}/edit-lock/{lockID}/offline-hold":   {body: isoJSON(map[string]any{})},
	"POST /api/v1/documents/{documentID}/edit-requests":                    {body: isoJSON(map[string]any{}), controlAs: "third"},
	"POST /api/v1/documents/{documentID}/edit-requests/{requestID}/answer": {body: isoWith(map[string]string{"lock_id": "docEditLock"}, map[string]any{"decision": "decline"})},
	"DELETE /api/v1/documents/{documentID}/edit-requests/{requestID}":      {controlAs: "peer"},

	// R1-8: the anchors key is required, so the body must carry it or the
	// route answers 400 before it reads the document - an empty [] is the
	// valid no-op update the tenancy gate then judges.
	"PUT /api/v1/documents/{documentID}/comments/anchors": {body: isoWith(map[string]string{"version_id": "versionID"}, map[string]any{"anchors": []any{}})},
	"POST /api/v1/documents/{documentID}/copies":          {body: isoIdem(nil, map[string]any{"consent": "copy"})},
	"POST /api/v1/documents/{documentID}/move":            {body: isoJSON(map[string]any{"revision": "1", "parent_id": nil})},
	"POST /api/v1/documents/{documentID}/office/jobs":     {body: isoIdem(nil, map[string]any{"operation": "serialize"})},
	"POST /api/v1/documents/{documentID}/office/sessions": {body: isoLaunchPost},
	// G5-D1: the desktop grants with no body at all, so the outsider and the
	// control both send that, and a 400 before the tenancy gate would fail it.
	"PUT /api/v1/documents/{documentID}/office/offline-lease": {body: func(*isoWorld, *isoTenant) isoBody { return isoBody{noBody: true} }},
	"POST /api/v1/documents/{documentID}/preview/scopes":      {body: isoPreviewPost},
	"POST /api/v1/orgs/{orgID}/ai/cloud/search":               {body: isoJSON(map[string]any{"query": "iso", "kind": "web", "max_results": 1})},
	"POST /api/v1/orgs/{orgID}/ai/cloud/images":               {body: isoJSON(map[string]any{"prompt": "iso"})},
	"POST /api/v1/orgs/{orgID}/ai/cloud/media/analyze":        {body: isoJSON(map[string]any{"requirements": "iso", "media": []any{map[string]any{"mime": "image/png", "data_base64": "aXNv"}}})},
	"POST /api/v1/orgs/{orgID}/ai/cloud/transcribe":           {body: isoJSON(map[string]any{"audio": map[string]any{"mime": "audio/mpeg", "data_base64": "aXNv"}})},
	"POST /api/v1/orgs/{orgID}/signatures":                    {body: isoSignaturePost},
	// UniWork AI (G6-03a): one turn per call with the conversation held by the
	// server, so the body is a single user question. The frame's row rides the
	// tenant's DOCX frame token; the session document row rides its Markdown
	// file, whose module the server derives from the document, never the body.
	"POST /api/v1/orgs/{orgID}/ai/uniwork/chat/completions":                        {body: isoJSON(isoUniworkTurnBody)},
	"POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions":              {body: isoJSON(isoUniworkTurnBody)},
	"POST /api/v1/office-frame/documents/{documentID}/ai/uniwork/chat/completions": {body: isoJSON(isoUniworkTurnBody)},
	"POST /api/v1/documents/{documentID}/shares":                                   {body: isoWith(map[string]string{}, map[string]any{"principal_type": "workspace", "principal_id": "01J8X4WS0N1P2Q3R4S5T6U7V8", "level": "view"})},
	"POST /api/v1/documents/{documentID}/shares/batch":                             {body: isoWith(map[string]string{}, map[string]any{"principal_ids": []any{"01J8X4K2M0N1P2Q3R4S5T6U7V8"}, "level": "view"})},
	"PUT /api/v1/documents/{documentID}/access":                                    {body: isoWith(map[string]string{}, map[string]any{"items": []any{map[string]any{"principal_type": "workspace", "principal_id": "01J8X4WS0N1P2Q3R4S5T6U7V8", "level": "view"}}})},
	// The writer route (plan 5) on the same DOCX frame token. The run and the
	// conversation ride headers, never the body, so the owner's control is
	// refused 400 for want of a running turn — after the gates that decide who
	// is asking, which is all the write control needs.
	"POST /api/v1/office-frame/documents/{documentID}/ai/uniwork/write": {body: isoJSON(uniworkWriteDocsBody)},
	// UNI-2244: folder bulk access update and batch progress.
	"PUT /api/v1/documents/{folderID}/contents-access": {
		body: isoWith(map[string]string{}, map[string]any{"mode": "merge", "items": []any{map[string]any{"principal_type": "workspace", "principal_id": "01J8X4WS0N1P2Q3R4S5T6U7V8", "level": "view"}}}),
	},
	// DOC-05: a valid reason, so the cross-tenant refusal is the gate and never the 422.
	"POST /api/v1/documents/{documentID}/break-glass": {body: isoJSON(map[string]any{"reason": "Kiểm tra theo yêu cầu của kiểm toán"})},
	// DOC-07 (UNI-1631 §4.3). The create answers every well-formed id with the
	// same uniform 202, so the cross-tenant pass cannot ask for a refusal: the
	// uniformAnswer row holds B's answer byte-identical to the same call with a
	// nonexistent id, keeps every hash, leak and reference check, and fails if
	// a document_access_requests row appears in either organization. Its one
	// path id means the mixed pass never reaches it, which is why the
	// exception sits on the cross-tenant pass and not on mixedOK.
	"POST /api/v1/documents/{documentID}/access-requests": {body: isoAccessRequestCreate,
		uniformAnswer: "the create is uniform by design (§3.1): every well-formed document id answers 202 {\"status\":\"sent\"}, foreign or unknown alike, because the answer must never reveal whether a document exists. B holds no request row on A's document, so the 409/429 answers that are specific to the requester's own rows cannot appear; the pass still holds the answer byte-identical to a nonexistent id, hashes every A row, and asserts no document_access_requests row was created in either organization"},
	// The manager routes refuse an outsider like any other document route: A's
	// request id under B's own document is not found, and the control is B's
	// manager on B's document (the write-control pass). Their {documentID} names
	// the page the seeded request hangs on, so the owner's own call reaches the
	// request instead of 404ing on a document it does not belong to.
	"GET /api/v1/documents/{documentID}/access-requests":                      {checkControl: isoAccessRequestsListCheck},
	"POST /api/v1/documents/{documentID}/access-requests/{requestID}/approve": {body: isoJSON(map[string]any{"level": "view"})},
	"POST /api/v1/documents/{documentID}/access-requests/{requestID}/decline": {},
	// DOC-06 (UNI-2084 §4.2): B's owner names A's document with their own id
	// as the recipient, so the refusal is the document gate (404). The control
	// is B's owner handing B's document to its current owner - the same-owner
	// answer (200, nothing written) - so the pass reaches the route's write path
	// without moving the fixture document's owner under every later route.
	"PUT /api/v1/documents/{documentID}/owner":            {body: isoWith(map[string]string{"user_id": "owner"}, map[string]any{"previous_owner_level": "edit"})},
	"POST /api/v1/documents/{documentID}/uploads":         {body: isoFile("note.md", "text/markdown", []byte("# new\n"), nil)},
	"POST /api/v1/documents/{documentID}/versions/commit": {body: isoIdem(map[string]string{"upload_id": "docUpload"}, map[string]any{"base_revision": "1"})},
	// Large upload sessions (BIGUP-S1, contract §5). The owner's seeded session
	// is the control of each session route; the complete routes answer 422 on
	// it because no part was ever PUT, which still proves the owner reached the
	// part check. The workspace create route's write control is its
	// isoReferences parent case: a third session would cross the
	// 4-open-per-person limit that buildUploadSessions already spends two of.
	"POST /api/v1/workspaces/{workspaceID}/documents/upload-sessions":                       {body: isoUploadSessionOpen("workspace"), skipControl: "seeding a third session would cross the 4-open-per-person limit; the isoReferences parent case is this route's owner control"},
	"POST /api/v1/documents/{documentID}/upload-sessions":                                   {body: isoUploadSessionOpen("version")},
	"POST /api/v1/office-frame/documents/{documentID}/upload-sessions":                      {body: isoUploadSessionOpen("frame")},
	"GET /api/v1/upload-sessions/{sessionID}":                                               {},
	"POST /api/v1/upload-sessions/{sessionID}/complete":                                     {body: isoUploadSessionComplete, control: []int{http.StatusUnprocessableEntity}},
	"DELETE /api/v1/upload-sessions/{sessionID}":                                            {},
	"GET /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}":           {},
	"POST /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}/complete": {body: isoUploadSessionComplete, control: []int{http.StatusUnprocessableEntity}},
	"DELETE /api/v1/office-frame/documents/{documentID}/upload-sessions/{sessionID}":        {},
	// G5-07: the lookup sends the key isolation_world_test.go seeds and leaves not_committed, so the
	// owner's control reads its own intent (200 not_committed) and the other tenant is refused on the
	// document before any intent is read.
	"GET /api/v1/documents/{documentID}/versions/commit":               {body: isoIdemOnly},
	"POST /api/v1/office-frame/documents/{documentID}/uploads":         {body: isoFile("frame.docx", isoDocxMime, isoFrameDocx, nil)},
	"POST /api/v1/office-frame/documents/{documentID}/versions/commit": {body: isoIdem(map[string]string{"upload_id": "frameUpload"}, map[string]any{"base_revision": "0"})},
	"POST /api/v1/office-frame/documents/{documentID}/assets":          {body: isoFile("dot.png", "image/png", docsPNG, nil)},
	"POST /api/v1/office-frame/documents/{documentID}/assets/sign":     {body: isoFrameSign},
	"POST /api/v1/office-frame/documents/{documentID}/assets/resolve":  {body: isoJSON(map[string]any{"paths": []string{"missing.png"}})},
	// A sibling file opens through the signature alone (a frame token is refused 401, so is no
	// signature): the control and the signed-URL cases are the frame-linked subtest.
	"GET /api/v1/office-frame/documents/{documentID}/linked/{linkedDocumentID}":  {skipControl: "the signature is the credential and a capability: the frame-linked subtest holds the owner's read and the refusals", refusedAlso: []int{http.StatusUnauthorized}},
	"HEAD /api/v1/office-frame/documents/{documentID}/linked/{linkedDocumentID}": {skipControl: "the signature is the credential and a capability: the frame-linked subtest holds the owner's read and the refusals", refusedAlso: []int{http.StatusUnauthorized}},
	"GET /api/v1/office-frame/documents/{documentID}/avatars/{userID}":           {class: isoScoped, reason: "frame token credential: Authorize rechecks view on the token's document and AvatarFileOf requires an active member of that document's organization; control = owner reads a same-org avatar in control and frame-avatar", checkControl: isoFrameAvatarCheck},
	"HEAD /api/v1/office-frame/documents/{documentID}/avatars/{userID}":          {class: isoScoped, reason: "frame token credential: Authorize rechecks view on the token's document and AvatarFileOf requires an active member of that document's organization; control = owner reads a same-org avatar in frame-avatar"},
	"POST /api/v1/office-frame/documents/{documentID}/export/pdf":                {body: isoFile("current.docx", isoDocxMime, isoFrameDocx, nil), skipControl: "owner 5xx found by G8-04, owner: office frame export (the stub engine answers 501 unsupported_operation)"},
	// UNI-2004: the page export runs ExportFramePDF's job path on the fixture page.
	"POST /api/v1/documents/{documentID}/export": {body: isoJSON(map[string]any{"format": "docx"}), skipControl: "the stub engine binds no export, so the owner's page export answers 501 unsupported_operation; TestPageExport holds the owner's export"},
	// The source frame (UNI-1869): a source token, minted by the owner's
	// session for a DOCX task attachment, opens the metadata and the bytes.
	// do() sends that token on /api/v1/office-frame/sources/* (frameSources),
	// so the cross-tenant pass attacks with B's own source token and the
	// anonymous pass with none.
	"POST /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/office/frame-token": {reason: "the mint re-runs the source's own gate and binds w/o/s into the claims; a foreign workspace or source answers 403/404"},
	"GET /api/v1/office-frame/sources/{sourceFileID}":                                           {reason: "the source token binds w/o/s/parent; AuthorizeSource re-runs the source gate as the token's user, so a foreign source is not_found"},
	"GET /api/v1/office-frame/sources/{sourceFileID}/content":                                   {reason: "as the open route: the bytes stream only after AuthorizeSource re-runs the source gate"},
	"HEAD /api/v1/office-frame/sources/{sourceFileID}/content":                                  {reason: "as the open route: the headers are answered only after AuthorizeSource re-runs the source gate"},
	// GO-A7's AI on the frame token (UNI-1014): the same bodies as the session rows.
	"POST /api/v1/office-frame/documents/{documentID}/ai/cloud/search":        {body: isoJSON(map[string]any{"query": "iso", "kind": "web", "max_results": 1})},
	"POST /api/v1/office-frame/documents/{documentID}/ai/cloud/images":        {body: isoJSON(map[string]any{"prompt": "iso"})},
	"POST /api/v1/office-frame/documents/{documentID}/ai/cloud/media/analyze": {body: isoJSON(map[string]any{"requirements": "iso", "media": []any{map[string]any{"mime": "image/png", "data_base64": "aXNv"}}})},
	"POST /api/v1/office-frame/documents/{documentID}/ai/cloud/transcribe":    {body: isoJSON(map[string]any{"audio": map[string]any{"mime": "audio/mpeg", "data_base64": "aXNv"}})},
	"POST /api/v1/documents/{documentID}/versions":                            {body: isoJSON(map[string]any{"label": "v"})},
	"PUT /api/v1/meetings/{meetingID}/attendance/{participantID}":             {body: isoJSON(map[string]any{"status": "PRESENT"}), mixedFirst: "liveMeeting"},
	"PUT /api/v1/meetings/{meetingID}/invitations/{invitationID}/response":    {body: isoJSON(map[string]any{"response": "ACCEPTED"}), controlAs: "peer"},
	"PATCH /api/v1/meetings/{meetingID}/motions/{motionID}":                   {body: isoJSON(map[string]any{"title": "edited"})},
	"PATCH /api/v1/meetings/{meetingID}/notes/{noteID}":                       {body: isoJSON(map[string]any{"body": "edited"})},
	"PATCH /api/v1/meetings/{meetingID}/transcript/{segmentID}":               {body: isoJSON(map[string]any{"text": "edited"})},
	// follow-5: the write-control pass runs .../dismiss first, so the owner's
	// link of the same item answers 409 action_item_not_pending - the route
	// decided who is asking and reached the item's state.
	"POST /api/v1/meetings/{meetingID}/action-items/{actionItemID}/link": {control: []int{http.StatusConflict},
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"task_id": tn.ids["task"]}}
		}},
	"POST /api/v1/meetings/{meetingID}/motions/{motionID}/ballot":     {body: isoJSON(map[string]any{"choice": "YES"})},
	"PATCH /api/v1/meetings/{meetingID}/participants/{participantID}": {body: isoJSON(map[string]any{"standing": "OBSERVER"})},
	"POST /api/v1/meetings/{meetingID}/agent/started":                 {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"GET /api/v1/meetings/{meetingID}/agent/context":                  {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"POST /api/v1/meetings/{meetingID}/agent/segments":                {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"POST /api/v1/meetings/{meetingID}/agent/finished":                {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"POST /api/v1/meetings/{meetingID}/agent/extract":                 {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"POST /api/v1/meetings/{meetingID}/agent/translate":               {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no session gets past the agent token (see reason)", reason: "the scribe agent authenticates with a per-meeting uwma_ token (RequireMeetingAgentToken), never a session; every session caller gets 401, and TestMeetingAgentToken* holds the token across meetings and organizations"},
	"POST /api/v1/orgs/{orgID}/audit/exports": {body: func(*isoWorld, *isoTenant) isoBody {
		return isoBody{json: map[string]any{"format": "csv", "from": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), "to": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}
	}},
	"GET /api/v1/orgs/{orgID}/privacy/exports/{privacyExportID}/download": {
		skipControl: "the seeded request has no file yet; the detail route is the owner's control, and this route answers 404 until a worker attaches one",
	},
	"POST /api/v1/orgs/{orgID}/privacy/deletion": {
		body: func(_ *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"confirm_slug": tn.orgSlug}}
		},
		skipControl: "the export control in this run already holds the one open privacy request, so the owner's deletion would answer 409; TestPrivacyDeletion covers that path",
	},
	"POST /api/v1/orgs/{orgID}/privacy/deletion/cancel": {
		skipControl: "no deletion is scheduled in this run, so the owner's cancel would answer 404; TestPrivacyDeletionCoversTheDelay covers that path",
	},
	"PUT /api/v1/tasks/{taskID}":                    {body: isoJSON(map[string]any{"revision": 1, "title": "edited"})},
	"POST /api/v1/tasks/{taskID}/attachments":       {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"DELETE /api/v1/tasks/{taskID}/reactions":       {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/tasks/{taskID}/reactions":         {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/ai/proposals/{proposalID}/apply":  {control: []int{http.StatusConflict}, reason: "the seeded row is rejected, so the owner's own call reaches the row and answers 409 proposal_not_pending, which a broken route would not; the refusal to an outsider is 404 before any state check"},
	"POST /api/v1/ai/proposals/{proposalID}/reject": {control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	"POST /api/v1/ai/proposals/{proposalID}/undo":   {control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	"PATCH /api/v1/ai/proposals/{proposalID}":       {body: isoJSON(map[string]any{"changes": map[string]any{"title": "edited"}}), control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	// Ask UNI memory proposals (P4): only the asker decides them, as above.
	"POST /api/v1/ai/memory-proposals/{memoryProposalID}/apply":  {control: []int{http.StatusConflict}, reason: "the seeded memory proposal is rejected, so the owner's own call reaches the row and answers 409 proposal_not_pending, which a broken route would not; an outsider gets 404 before any membership, flag or state check"},
	"POST /api/v1/ai/memory-proposals/{memoryProposalID}/reject": {control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	"POST /api/v1/ai/memory-proposals/{memoryProposalID}/undo":   {control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	"PATCH /api/v1/ai/memory-proposals/{memoryProposalID}":       {body: isoJSON(map[string]any{"text": "edited"}), control: []int{http.StatusConflict}, reason: "as apply: the owner's own call answers 409 proposal_not_pending on the rejected seed row"},
	"POST /api/v1/ai/conversations/{conversationID}/messages/{messageID}/proposals/apply": {
		body: func(_ *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"proposal_ids": []string{tn.ids["aiProposal"]}}}
		},
		control: []int{http.StatusConflict}, reason: "as apply: the owner's own call names the rejected seed row and answers 409 proposal_not_pending; the body-id case in isoReferences applies a pending row of the tenant's own and attacks with A's"},
	"PUT /api/v1/orgs/{org}/ai/ask-write-policy": {reason: "the attack on A sends ceiling off, which would shut A's Ask UNI writes, so A's tenant digest catches a breach; every other tenant's own call sends plan, the default, which answers 200 and changes nothing",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			ceiling := "plan"
			if tn == w.alpha {
				ceiling = "off"
			}
			return isoBody{json: map[string]any{"ceiling": ceiling}}
		}},
	"POST /api/v1/orgs/{org}/ai/memory": {body: func(_ *isoWorld, tn *isoTenant) isoBody {
		return isoBody{json: map[string]any{"kind": "fact", "text": tn.marker + " added by the route"}}
	}},
	"POST /api/v1/orgs/{org}/ai/memory/import/split": {body: func(_ *isoWorld, tn *isoTenant) isoBody {
		return isoBody{json: map[string]any{"text": "- " + tn.marker + " split by the route"}}
	}},
	"POST /api/v1/orgs/{org}/ai/memory/import": {body: func(_ *isoWorld, tn *isoTenant) isoBody {
		return isoBody{json: map[string]any{"entries": []map[string]any{{"kind": "fact", "text": tn.marker + " imported by the route"}}}}
	}},
	"PATCH /api/v1/orgs/{org}/ai/memory/{memoryID}":                                                    {body: isoJSON(map[string]any{"text": "edited"})},
	"PATCH /api/v1/ai/conversations/{conversationID}":                                                  {body: isoJSON(map[string]any{"title": "renamed"})},
	"PUT /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback":                      {body: isoJSON(map[string]any{"rating": "up"})},
	"POST /api/v1/workspaces/{workspaceID}/ai/ask":                                                     {body: isoJSON(map[string]any{"question": "what is overdue?"})},
	"POST /api/v1/workspaces/{workspaceID}/ai/ask/stream":                                              {body: isoJSON(map[string]any{"question": "what is overdue?"})},
	"POST /api/v1/workspaces/{workspaceID}/ai/attachments":                                             {body: isoFile("note.pdf", "application/pdf", tinyPDF, nil)},
	"POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up":                                           {body: isoWith(map[string]string{"room_id": "room"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/icon":                                                       {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"POST /api/v1/workspaces/{workspaceID}/attachments":                                                {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/dm":                                                    {body: isoWith(map[string]string{"user_id": "peer"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/links":                            {body: isoWith(map[string]string{"target_id": "task"}, map[string]any{"target_type": "task"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/forward":                          {body: isoForwardBody},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages":                               {body: isoJSON(map[string]any{"body": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/file":                          {body: isoFile("note.pdf", "application/pdf", tinyPDF, map[string]string{"client_msg_id": ""})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/document":                      {body: isoFile("note.md", "text/markdown", []byte("# new\n"), map[string]string{"client_msg_id": "", "share_level": "comment"})},
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}":                                         {class: isoScoped, reason: "the room detail read (UNI-1966 L5) authorizes the room by the path's workspace and room id before it answers can_send_document; an outsider is refused 403/404 and A's digest catches a served room"},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/voice":                         {body: isoFile("voice.webm", "audio/webm", tinyWebM, map[string]string{"client_msg_id": "", "duration_ms": "4000"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/avatar":                                 {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/wallpaper":                              {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"PATCH /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}":                                       {body: isoJSON(map[string]any{"wallpaper": map[string]any{"preset": "sky"}})},
	"PATCH /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}":                  {body: isoJSON(map[string]any{"body": "edited"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/poll/vote":         {body: isoWith(map[string]string{"option_id": "pollOption"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/document-link":                 {body: isoWith(map[string]string{"document_id": "chatLinkDocument"}, map[string]any{"share_level": "comment"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/poll/options":      {body: isoJSON(map[string]any{"label": "new option"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/share-as-document": {body: isoIdem(nil, map[string]any{"share_level": "comment", "client_msg_id": "iso-share-as-doc"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages":           {body: isoJSON(map[string]any{"body": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/accept":                           {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/decline":                          {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/hangup":                           {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/invite":                           {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/start":                  {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/stop":                   {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync":                         {body: isoWith(map[string]string{"task_id": "task"}, nil)},
	// The folder kind (E6 FD-02): a folder create runs the duplicate-name check
	// under the workspace tree lock, and the control pass must reach it on the
	// caller's own workspace. The page kind is covered by the reference case
	// (CreateDocumentSDI.parent_id).
	"POST /api/v1/workspaces/{workspaceID}/documents":                                         {body: isoJSON(map[string]any{"title": "new", "kind": "folder"})},
	"POST /api/v1/workspaces/{workspaceID}/documents/files":                                   {body: isoFile("note.md", "text/markdown", []byte("# new\n"), map[string]string{"title": "new"})},
	"POST /api/v1/workspaces/{workspaceID}/documents/files/blank":                             {body: isoIdem(nil, map[string]any{"format": "md", "title": "new"})},
	"POST /api/v1/workspaces/{workspaceID}/documents/my-folder":                               {class: isoScoped, reason: "EnsureMyFolder (UNI-1850): workspace-scoped with no body; outsider refused, owner write-control 200"},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch":                           {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch":                             {query: "?account_id={emailAccount}"},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}":     {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}/retry": {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/watch":                                   {query: "?account_id={emailAccount}", skipControl: "owner 5xx found by G8-04, owner: email hub (no IMAP server in tests)"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/sync":                                    {query: "?account_id={emailAccount}", skipControl: "owner 5xx found by G8-04, owner: email hub (no IMAP server in tests)"},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/accounts/{accountID}":                  {},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/send":                                    {body: isoWith(map[string]string{"account_id": "emailAccount"}, map[string]any{"to": []string{"someone@example.com"}, "subject": "hi", "body_text": "hello"}), skipControl: "owner 5xx found by G8-04, owner: email hub (no SMTP server in tests)"},
	"POST /api/v1/workspaces/{workspaceID}/files/resolve":                                     {body: isoWith(map[string]string{}, map[string]any{"file_ids": []string{"01J8X4FILE0N1P2Q3R4S5T6U7V"}})},
	"PUT /api/v1/workspaces/{workspaceID}/projects/{projectID}":                               {body: isoJSON(map[string]any{"revision": 1, "title": "edited"})},
	"DELETE /api/v1/meetings/{meetingID}/attendance/{participantID}":                          {mixedFirst: "liveMeeting"},
	"POST /api/v1/meetings/{meetingID}/motions/{motionID}/open":                               {mixedFirst: "liveMeeting"},
	"POST /api/v1/meetings/{meetingID}/participants/{participantID}/publish":                  {mixedFirst: "liveMeeting"},
	"PATCH /api/v1/orgs/{org}/members/{userID}":                                               {body: isoJSON(map[string]any{"role": "admin"})},
	// DOC-06b: B's owner counts and moves the documents of B's peer to B's owner.
	// The peer's restrictedDocument is self_restricted for B's owner, who holds
	// only AdminScope on it, so it stays with the peer; peerOwnedDocument is
	// unrestricted and moves, so the control writes under the matrix.
	"GET /api/v1/orgs/{org}/members/{userID}/document-ownership":                         {},
	"POST /api/v1/orgs/{org}/members/{userID}/document-ownership":                        {body: isoWith(map[string]string{"to_user_id": "owner"}, nil)},
	"PATCH /api/v1/workspaces/{workspaceID}/members/{userID}":                            {body: isoJSON(map[string]any{"role": "admin"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/reports":                                 {body: isoWith(map[string]string{"user_id": "peer"}, map[string]any{"reason": "spam"})},
	"DELETE /api/v1/workspaces/{workspaceID}/chat/users/{userID}/block":                  {mixedOK: "unblocking deletes the caller's own block row in their own organization; any id answers ok, known or not"},
	"GET /api/v1/workspaces/{workspaceID}/resources/{resourceType}/{resourceID}/history": {mixedOK: "the history is read by workspace and resource; a foreign id returns the empty page an unknown id returns"},
	"POST /api/v1/meetings/{meetingID}/join-requests":                                    {body: isoJSON(map[string]any{"display_name": "Khách"})},
	"POST /api/v1/meeting-join-requests/{requestId}/cancel":                              {controlAs: "third"},
	"POST /api/v1/tasks/{taskID}/labels":                                                 {body: isoWith(map[string]string{"label_id": "label"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/agents":                                       {body: isoWith(map[string]string{"agent_id": "agent"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/drive-files": {body: func(_ *isoWorld, tn *isoTenant) isoBody {
		return isoBody{json: map[string]any{"connection_id": tn.ids["driveConnection"], "external_file_ids": []string{"iso-drive-" + strings.ToLower(tn.tag)}}}
	}},
	"POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access":             {body: isoWith(map[string]string{"connection_id": "driveConnection"}, nil)},
	"PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access":              {controlAs: "peer", body: isoWith(map[string]string{"connection_id": "peerDriveConnection"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind":             {body: isoWith(map[string]string{"connection_id": "driveConnection"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/drive-folders/{driveFolderID}/name":           {body: isoWith(map[string]string{"drive_connection_id": "driveConnection"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals":     {body: isoJSON(map[string]any{"prompt": "Extract tasks"})},
	"POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/duplicates": {body: isoJSON(map[string]any{"titles": []string{"Chốt phạm vi beta"}})},
	"POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks": {body: isoJSON(map[string]any{
		"items": []any{map[string]any{"index": 0, "title": "Chốt phạm vi beta", "description": "Mục tiêu"}},
	})},
	"POST /api/v1/orgs/{orgID}/billing/checkout": {body: isoJSON(map[string]any{
		"plan_code": "starter", "success_path": "/billing/ok",
	})},
	"POST /api/v1/meetings/{meetingID}/restore": {control: []int{http.StatusConflict},
		reason: "the tenant's own fixture meeting was never cancelled, so its owner's restore answers 409 invalid_meeting_state; the cross-tenant call must still be refused 403/404 and A's digest catches a restore"},
	"PATCH /api/v1/orgs/{orgID}/billing/plan":                         {body: isoJSON(map[string]any{"plan_code": "starter", "row_version": 1})},
	"POST /api/v1/meetings/{meetingID}/host-transfer":                 {body: isoWith(map[string]string{"new_host_user_id": "peer"}, nil)},
	"POST /api/v1/orgs/{org}/transfer-ownership":                      {body: isoWith(map[string]string{"to_user_id": "third"}, map[string]any{"password": "password123"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/leave": {controlAs: "third"},
	// Tenant rows named in the body rather than the path.
	"GET /api/v1/invitations/{token}":         {class: isoScoped, skipControl: "the invitation is addressed to an invitee outside the tenant; only that verified mailbox may read it"},
	"POST /api/v1/invitations/{token}/accept": {class: isoScoped, skipControl: "accepting consumes the invitation"},
	"POST /api/v1/membership-invite-links/preview": {class: isoScoped, skipControl: "link_id+secret is the grant; holding both reveals only the linked org/workspace names", body: isoJSON(map[string]any{
		"link_id": "01J8X4LNK0N1P2Q3R4S5T6U7V", "secret": "not-a-real-secret",
	})},
	"POST /api/v1/membership-invite-links/join": {class: isoScoped, skipControl: "link_id+secret is the grant; join creates membership only when the link is Active", body: isoJSON(map[string]any{
		"link_id": "01J8X4LNK0N1P2Q3R4S5T6U7V", "secret": "not-a-real-secret",
	})},
	"POST /api/v1/chat/voice/token": {body: isoWith(map[string]string{"room_id": "room", "call_id": "callID"}, nil)},
}
