package handler

import (
	"bytes"
	"net/http"
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
	// controlAs names the tenant member the write control sends as when the
	// owner is not the one the route serves ("peer" answers an invitation,
	// "third" cancels the knock they made) or must stay ("third" leaves the
	// group so the owner's later writes in it still count).
	controlAs string
	// refusedAlso lists statuses that also count as a refusal on this route,
	// for a route guarded by something other than a membership (a machine
	// secret); the reason says what.
	refusedAlso []int
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

func isoJSON(v any) func(*isoWorld, *isoTenant) isoBody {
	return func(*isoWorld, *isoTenant) isoBody { return isoBody{json: v} }
}

const (
	reasonAuth     = "authentication: there is no tenant before sign-in"
	reasonProbe    = "process probe or public configuration, no tenant data"
	reasonProvider = "provider callback authenticated by the provider's signature or OAuth state, not by a member"
	reasonSelf     = "the caller's own account; the listing pass checks it shows nothing of another tenant"
	reasonLink     = "the link secret in the path or body is the credential; holding it is the grant"
	reasonPlatform = "platform console: across tenants by design, closed without users.platform_role"
	reasonStub     = "catalogue stub: the same 422 capability_unavailable for every caller and id"
)

// isoRoutes holds every route that is not plain isoScoped-with-no-body.
var isoRoutes = map[string]isoSpec{
	// Sign-in and probes.
	"GET /healthz":                          {class: isoPublic, reason: reasonProbe},
	"GET /readyz":                           {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/config":                    {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/plans":                     {class: isoPublic, reason: reasonProbe},
	"POST /api/v1/rum":                      {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/notifications/push/config": {class: isoPublic, reason: reasonProbe},
	"GET /api/v1/auth/google/callback":      {class: isoPublic, reason: reasonAuth},
	"GET /api/v1/auth/google/start":         {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/login":               {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/logout":              {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/mfa/verify":          {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/password/forgot":     {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/password/reset":      {class: isoPublic, reason: reasonAuth},
	"GET /api/v1/auth/providers":            {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/refresh":             {class: isoPublic, reason: reasonAuth},
	"POST /api/v1/auth/register":            {class: isoPublic, reason: reasonAuth},

	"GET /uploads/*": {class: isoPublic, reason: "legacy local-disk objects by unguessable key; FileService objects (v1/) are refused - TestServeFileRefusesFileServiceObjects and the uploads subtest"},

	// Provider callbacks.
	"POST /api/v1/integrations/livekit/webhook":            {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/billing/webhooks/vnpay":                   {class: isoPublic, reason: reasonProvider},
	"POST /api/v1/billing/webhooks/vnpay":                  {class: isoPublic, reason: reasonProvider},
	"GET /api/v1/calendar-connections/{provider}/callback": {class: isoPublic, reason: reasonProvider},

	// Links whose secret is the credential.
	"GET /api/v1/public/documents/{token}":                   {class: isoPublic, reason: reasonLink},
	"GET /api/v1/public/documents/{token}/assets/{assetID}":  {class: isoPublic, reason: reasonLink},
	"HEAD /api/v1/public/documents/{token}/assets/{assetID}": {class: isoPublic, reason: reasonLink},
	"GET /api/v1/public/documents/{token}/download":          {class: isoPublic, reason: reasonLink},
	"HEAD /api/v1/public/documents/{token}/download":         {class: isoPublic, reason: reasonLink},
	"POST /api/v1/public/meeting-invite-links/resolve":       {class: isoPublic, reason: reasonLink},

	// The caller's own account.
	"GET /api/v1/ws":                            {class: isoRealtime, reason: "workspace WebSocket: membership is checked on the auth frame, scopes on subscribe - TestIsolationRealtime"},
	"GET /api/v1/me":                            {class: isoSelf, reason: reasonSelf},
	"PATCH /api/v1/me":                          {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/avatar":                    {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/delete":                    {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/email/resend":              {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/email/verify":              {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/invitations":                {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/confirm":               {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/disable":               {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/mfa/setup":                 {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notification-preferences":   {class: isoSelf, reason: reasonSelf},
	"PUT /api/v1/me/notification-preferences":   {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notifications":              {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/archive":     {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/read":        {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/unarchive":   {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/notifications/unread":      {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/notifications/unread-count": {class: isoSelf, reason: reasonSelf},
	"PATCH /api/v1/me/onboarding":               {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/onboarding/complete":       {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/me/push-subscriptions":      {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/push-subscriptions":        {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/me/sessions":                   {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/me/sessions/revoke-others":    {class: isoSelf, reason: reasonSelf},
	"DELETE /api/v1/me/sessions/{sessionId}":    {class: isoSelf, reason: reasonSelf},
	"GET /api/v1/orgs":                          {class: isoSelf, reason: reasonSelf},
	"POST /api/v1/orgs":                         {class: isoSelf, reason: "creates a new organization owned by the caller"},
	"GET /api/v1/workspaces":                    {class: isoSelf, reason: reasonSelf},

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
	"POST /api/v1/office-frame/token": {class: isoSelf, reason: "the frame token is the credential and names its own document; refresh re-mints only that binding"},

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
	"GET /api/v1/admin/organizations":                    {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/organizations/{orgID}":            {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/plan":      {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/suspend":   {class: isoPlatform, reason: reasonPlatform},
	"POST /api/v1/admin/organizations/{orgID}/unsuspend": {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/system":                           {class: isoPlatform, reason: reasonPlatform},
	"GET /api/v1/admin/trace/{traceID}":                  {class: isoPlatform, reason: reasonPlatform},

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
	"GET /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/active": {query: "?call_id={callID}"},
	"GET /api/v1/workspaces/{workspaceID}/chat/users/lookup":                          {query: "?email={peerEmail}"},
	// The organization rides in the query; the installer profile is configured in the world, so the owner is served.
	"GET /api/v1/office/desktop/download":                                        {query: "?organization_id={orgID}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/labels":                      {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends":             {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/sidebar-counts":              {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/email-hub/threads":                     {query: "?account_id={emailAccount}"},
	"GET /api/v1/workspaces/{workspaceID}/projects/search":                       {query: "?q=Project"},
	"GET /api/v1/workspaces/{workspaceID}/task-view-preferences":                 {query: "?scope_type=workspace"},
	"GET /api/v1/workspaces/{workspaceID}/task-views":                            {query: "?scope_type=workspace"},
	"GET /api/v1/workspaces/{workspaceID}/calendar/connections/{provider}/start": {skipControl: "no OAuth client is configured in tests; the owner gets 503"},
	"GET /api/v1/meetings/{meetingID}/lobby-ws":                                  {class: isoRealtime, reason: "lobby WebSocket: the auth frame is checked against the knock - TestIsolationRealtime"},
	"GET /api/v1/files/{fileID}/content":                                         {skipControl: "reads need the ticket POST .../files/resolve mints; without it everyone is refused"},
	"HEAD /api/v1/files/{fileID}/content":                                        {skipControl: "reads need the ticket POST .../files/resolve mints; without it everyone is refused"},

	"GET /api/v1/workspaces/{workspaceID}/calendar/connections/{provider}/calendars":                       {skipControl: "no OAuth client is configured in tests; the owner gets 503"},
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
	"POST /api/v1/documents/{documentID}/copies":                                                           {body: isoIdem(nil, map[string]any{"consent": "copy"})},
	"POST /api/v1/documents/{documentID}/move":                                                             {body: isoJSON(map[string]any{"revision": "1", "parent_id": nil})},
	"POST /api/v1/documents/{documentID}/office/jobs":                                                      {body: isoIdem(nil, map[string]any{"operation": "serialize"})},
	"POST /api/v1/documents/{documentID}/office/sessions":                                                  {body: isoLaunchPost},
	"POST /api/v1/documents/{documentID}/preview/scopes":                                                   {body: isoPreviewPost},
	"POST /api/v1/orgs/{orgID}/signatures":                                                                 {body: isoSignaturePost},
	"POST /api/v1/documents/{documentID}/shares":                                                           {body: isoWith(map[string]string{}, map[string]any{"principal_type": "workspace", "principal_id": "01J8X4WS0N1P2Q3R4S5T6U7V8", "level": "view"})},
	"POST /api/v1/documents/{documentID}/uploads":                                                          {body: isoFile("note.md", "text/markdown", []byte("# new\n"), nil)},
	"POST /api/v1/documents/{documentID}/versions/commit":                                                  {body: isoIdem(map[string]string{"upload_id": "docUpload"}, map[string]any{"base_revision": "1"})},
	"POST /api/v1/office-frame/documents/{documentID}/uploads":                                             {body: isoFile("frame.docx", isoDocxMime, isoFrameDocx, nil)},
	"POST /api/v1/office-frame/documents/{documentID}/versions/commit":                                     {body: isoIdem(map[string]string{"upload_id": "frameUpload"}, map[string]any{"base_revision": "0"})},
	"POST /api/v1/office-frame/documents/{documentID}/assets":                                              {body: isoFile("dot.png", "image/png", docsPNG, nil)},
	"POST /api/v1/office-frame/documents/{documentID}/assets/sign":                                         {body: isoFrameSign},
	"POST /api/v1/documents/{documentID}/versions":                                                         {body: isoJSON(map[string]any{"label": "v"})},
	"PUT /api/v1/meetings/{meetingID}/attendance/{participantID}":                                          {body: isoJSON(map[string]any{"status": "PRESENT"}), mixedFirst: "liveMeeting"},
	"PUT /api/v1/meetings/{meetingID}/invitations/{invitationID}/response":                                 {body: isoJSON(map[string]any{"response": "ACCEPTED"}), controlAs: "peer"},
	"PATCH /api/v1/meetings/{meetingID}/motions/{motionID}":                                                {body: isoJSON(map[string]any{"title": "edited"})},
	"POST /api/v1/meetings/{meetingID}/motions/{motionID}/ballot":                                          {body: isoJSON(map[string]any{"choice": "YES"})},
	"PATCH /api/v1/meetings/{meetingID}/participants/{participantID}":                                      {body: isoJSON(map[string]any{"standing": "OBSERVER"})},
	"POST /api/v1/meetings/{meetingID}/transcript/agent":                                                   {refusedAlso: []int{http.StatusUnauthorized}, skipControl: "no member gets past the agent secret (see reason)", reason: "the STT agent authenticates with MEETING_STT_AGENT_SECRET, not a membership; a member is refused the same way"},
	"POST /api/v1/orgs/{orgID}/audit/exports": {body: func(*isoWorld, *isoTenant) isoBody {
		return isoBody{json: map[string]any{"format": "csv", "from": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), "to": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}}
	}},
	"PUT /api/v1/tasks/{taskID}":                                                               {body: isoJSON(map[string]any{"revision": 1, "title": "edited"})},
	"POST /api/v1/tasks/{taskID}/attachments":                                                  {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"DELETE /api/v1/tasks/{taskID}/reactions":                                                  {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/tasks/{taskID}/reactions":                                                    {body: isoJSON(map[string]any{"emoji": "👍"})},
	"POST /api/v1/workspaces/{workspaceID}/ai/ask":                                             {body: isoJSON(map[string]any{"question": "what is overdue?"})},
	"POST /api/v1/workspaces/{workspaceID}/ai/chat/catch-up":                                   {body: isoWith(map[string]string{"room_id": "room"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/attachments":                                        {body: isoFile("pixel.png", "image/png", docsPNG, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/dm":                                            {body: isoWith(map[string]string{"user_id": "peer"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/messages":                                      {body: isoJSON(map[string]any{"body": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/messages/{messageID}/links":                    {body: isoWith(map[string]string{"target_id": "task"}, map[string]any{"target_type": "task"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages":                       {body: isoJSON(map[string]any{"body": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/file":                  {body: isoFile("note.pdf", "application/pdf", tinyPDF, map[string]string{"client_msg_id": ""})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/voice":                 {body: isoFile("voice.webm", "audio/webm", tinyWebM, map[string]string{"client_msg_id": "", "duration_ms": "4000"})},
	"PATCH /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}":          {body: isoJSON(map[string]any{"body": "edited"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/poll/vote": {body: isoWith(map[string]string{"option_id": "pollOption"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages":   {body: isoJSON(map[string]any{"body": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/accept":                   {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/hangup":                   {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/invite":                   {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/start":          {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/recording/stop":           {body: isoWith(map[string]string{"call_id": "callID"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync":                 {body: isoWith(map[string]string{"task_id": "task"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/documents":                                          {body: isoJSON(map[string]any{"title": "new", "kind": "page"})},
	"POST /api/v1/workspaces/{workspaceID}/documents/files":                                    {body: isoFile("note.md", "text/markdown", []byte("# new\n"), map[string]string{"title": "new"})},
	"POST /api/v1/workspaces/{workspaceID}/documents/files/blank":                              {body: isoIdem(nil, map[string]any{"format": "md", "title": "new"})},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch":                            {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/inbox-watch":                              {query: "?account_id={emailAccount}"},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}":      {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/scheduled-sends/{scheduledSendID}/retry":  {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/watch":                                    {query: "?account_id={emailAccount}"},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/sync":                                     {query: "?account_id={emailAccount}"},
	"DELETE /api/v1/workspaces/{workspaceID}/email-hub/accounts/{accountID}":                   {},
	"POST /api/v1/workspaces/{workspaceID}/email-hub/send":                                     {body: isoWith(map[string]string{"account_id": "emailAccount"}, map[string]any{"to": []string{"someone@example.com"}, "subject": "hi", "body_text": "hello"})},
	"POST /api/v1/workspaces/{workspaceID}/files/resolve":                                      {body: isoWith(map[string]string{}, map[string]any{"file_ids": []string{"01J8X4FILE0N1P2Q3R4S5T6U7V"}})},
	"PUT /api/v1/workspaces/{workspaceID}/projects/{projectID}":                                {body: isoJSON(map[string]any{"revision": 1, "title": "edited"})},
	"DELETE /api/v1/meetings/{meetingID}/attendance/{participantID}":                           {mixedFirst: "liveMeeting"},
	"POST /api/v1/meetings/{meetingID}/motions/{motionID}/open":                                {mixedFirst: "liveMeeting"},
	"POST /api/v1/meetings/{meetingID}/participants/{participantID}/publish":                   {mixedFirst: "liveMeeting"},
	"PATCH /api/v1/orgs/{org}/members/{userID}":                                                {body: isoJSON(map[string]any{"role": "admin"})},
	"PATCH /api/v1/workspaces/{workspaceID}/members/{userID}":                                  {body: isoJSON(map[string]any{"role": "admin"})},
	"DELETE /api/v1/workspaces/{workspaceID}/chat/users/{userID}/block":                        {mixedOK: "unblocking deletes the caller's own block row in their own organization; any id answers ok, known or not"},
	"GET /api/v1/workspaces/{workspaceID}/resources/{resourceType}/{resourceID}/history":       {mixedOK: "the history is read by workspace and resource; a foreign id returns the empty page an unknown id returns"},
	"POST /api/v1/meetings/{meetingID}/join-requests":                                          {body: isoJSON(map[string]any{"display_name": "Khách"})},
	"POST /api/v1/meeting-join-requests/{requestId}/cancel":                                    {controlAs: "third"},
	"POST /api/v1/tasks/{taskID}/labels":                                                       {body: isoWith(map[string]string{"label_id": "label"}, nil)},
	"POST /api/v1/workspaces/{workspaceID}/agents":                                             {body: isoWith(map[string]string{"agent_id": "agent"}, nil)},
	"POST /api/v1/orgs/{orgID}/billing/checkout": {body: isoJSON(map[string]any{
		"plan_code": "starter", "success_path": "/billing/ok", "cancel_path": "/billing/cancel",
	})},
	"PATCH /api/v1/orgs/{orgID}/billing/plan":                         {body: isoJSON(map[string]any{"plan_code": "starter", "row_version": 1})},
	"POST /api/v1/meetings/{meetingID}/host-transfer":                 {body: isoWith(map[string]string{"new_host_user_id": "peer"}, nil)},
	"POST /api/v1/orgs/{org}/transfer-ownership":                      {body: isoWith(map[string]string{"to_user_id": "third"}, map[string]any{"password": "password123"})},
	"POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/leave": {controlAs: "third"},
	// Tenant rows named in the body rather than the path.
	"POST /api/v1/invitations/{token}/accept": {class: isoScoped, skipControl: "accepting consumes the invitation"},
	"POST /api/v1/chat/voice/token":           {body: isoWith(map[string]string{"room_id": "room", "call_id": "callID"}, nil)},
}
