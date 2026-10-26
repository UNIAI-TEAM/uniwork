package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Access log actions (C-01 §3.6).
const (
	DocumentAccessView     = "view"
	DocumentAccessDownload = "download"
	DocumentAccessExport   = "export"
	DocumentAccessLinkView = "link_view"
)

// documentAccessCoalesce is C-01 §3.6: the same (document, actor, action)
// inside five minutes writes no new row.
const documentAccessCoalesce = 5 * time.Minute

// SetFiles wires FileService, the only way document bytes are read.
func (s *DocumentService) SetFiles(f files.Service) { s.files = f }

// SetEntitlements wires the plan gate public links need. Unwired, links are
// refused (fail closed).
func (s *DocumentService) SetEntitlements(e *EntitlementService) { s.entitlements = e }

// documentAccessEvent is one row of the access log. A zero Actor is an
// anonymous link reader.
type documentAccessEvent struct {
	Document    db.Document
	Version     *int32
	Action      string
	Actor       Actor
	Via         DocumentVia
	ShareLinkID string
}

// recordDocumentAccess writes the access log for a read that has already
// been authorized. It never fails the read: the insert runs on its own after
// the read, and a failure is counted and logged by ids only - no content,
// token or client address ever reaches the row or the log line.
func (s *DocumentService) recordDocumentAccess(ctx context.Context, ev documentAccessEvent) {
	if err := s.writeDocumentAccess(ctx, ev); err != nil {
		s.metrics.IncDocumentAccessLogFailed()
		slog.Warn("document access log write failed",
			"document", ev.Document.ID, "action", ev.Action, "correlation_id", audit.CorrelationID(ctx), "err", err)
	}
}

func (s *DocumentService) writeDocumentAccess(ctx context.Context, ev documentAccessEvent) error {
	kind, actorID := "anonymous", pgtype.Text{}
	if ev.Actor.Kind != "" {
		kind, actorID = string(ev.Actor.Kind), nullText(ev.Actor.ID)
	}
	linkID := nullText(ev.ShareLinkID)
	seen, err := s.q.DocumentAccessLoggedSince(ctx, db.DocumentAccessLoggedSinceParams{
		OrganizationID: ev.Document.OrganizationID,
		WorkspaceID:    ev.Document.WorkspaceID,
		DocumentID:     ev.Document.ID,
		Action:         ev.Action,
		ActorKind:      kind,
		ActorID:        actorID,
		ShareLinkID:    linkID,
		Since:          pgtype.Timestamptz{Time: time.Now().Add(-documentAccessCoalesce), Valid: true},
	})
	if err != nil {
		return err
	}
	if seen {
		return nil
	}
	var version pgtype.Int4
	if ev.Version != nil {
		version = pgtype.Int4{Int32: *ev.Version, Valid: true}
	}
	correlation := audit.CorrelationID(ctx)
	if correlation == "" {
		correlation = util.NewID()
	}
	return s.q.InsertDocumentAccessLog(ctx, db.InsertDocumentAccessLogParams{
		ID:             util.NewID(),
		OrganizationID: ev.Document.OrganizationID,
		WorkspaceID:    ev.Document.WorkspaceID,
		DocumentID:     ev.Document.ID,
		Version:        version,
		Action:         ev.Action,
		ActorKind:      kind,
		ActorID:        actorID,
		Via:            string(ev.Via),
		ShareLinkID:    linkID,
		CorrelationID:  correlation,
	})
}

// RecordDocumentRead is how the document read paths (G1-04 get/export)
// log a view or an export after they authorized the actor.
func (s *DocumentService) RecordDocumentRead(ctx context.Context, actor Actor, doc db.Document, access DocumentAccess, action string, version *int32) {
	s.recordDocumentAccess(ctx, documentAccessEvent{
		Document: doc, Version: version, Action: action, Actor: actor, Via: access.Via,
	})
}

// DocumentAccessLogQuery pages the access log newest first. Before/BeforeID
// are the keyset of the last row of the previous page (both empty starts at
// the newest row); carrying the id keeps rows that share the boundary
// timestamp from being skipped.
type DocumentAccessLogQuery struct {
	Action   string    // "" = every action
	Before   time.Time // zero = from now
	BeforeID string    // id of the row at Before; empty keeps the strict window
	Limit    int
}

// EffectiveDocumentAccessLogLimit clamps a requested access-log page size to
// the service's default and cap (<= 0 or > 100 -> 50). Exported so the HTTP
// layer can tell whether a full page may have a successor without hard-coding
// a second copy of the rule.
func EffectiveDocumentAccessLogLimit(limit int) int {
	if limit <= 0 || limit > 100 {
		return 50
	}
	return limit
}

// ListDocumentAccessLogs is the manage-only access log (C-01 §5.4), open to
// AdminScope too (DOC-05: administering is not reading). An owned
// document's log stays readable at the level its owner grants (§13.4).
func (s *DocumentService) ListDocumentAccessLogs(ctx context.Context, actor Actor, documentID string, in DocumentAccessLogQuery) ([]db.DocumentAccessLog, error) {
	doc, _, err := s.authorizeDocumentAdminister(ctx, actor, documentID)
	if err != nil {
		return nil, err
	}
	limit := EffectiveDocumentAccessLogLimit(in.Limit)
	params := db.ListDocumentAccessLogsParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		MaxRows:        int32(limit),
	}
	switch in.Action {
	case "":
	case DocumentAccessView, DocumentAccessDownload, DocumentAccessExport, DocumentAccessLinkView:
		params.Action = nullText(in.Action)
	default:
		return nil, Invalid("action không hợp lệ")
	}
	if !in.Before.IsZero() {
		params.Before = pgtype.Timestamptz{Time: in.Before, Valid: true}
		if in.BeforeID != "" {
			params.BeforeID = nullText(in.BeforeID)
		}
	}
	return s.q.ListDocumentAccessLogs(ctx, params)
}

// DocumentByteRange is the HEAD/Range window of a proxied read; zero Length
// means to the end.
type DocumentByteRange struct {
	Offset int64
	Length int64
}

// DocumentFile is a streamed file version. The caller owns Reader.Close.
type DocumentFile struct {
	Reader   files.Reader
	Document db.Document
	Version  db.DocumentVersion
}

// OpenDocumentFile streams a file document's bytes through Go - never a
// presigned URL (FS-C1, DOC-004) - so a revoke or a lost level stops the very
// next read. versionNo 0 is the current version; action (DocumentAccessDownload
// or DocumentAccessView) is recorded in the access log when non-empty.
func (s *DocumentService) OpenDocumentFile(ctx context.Context, actor Actor, documentID string, versionNo int32, rng DocumentByteRange, action string) (DocumentFile, error) {
	var (
		doc    db.Document
		access DocumentAccess
		f      DocumentFile
		err    error
	)
	if versionNo == 0 {
		doc, access, err = s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
		if err != nil {
			return DocumentFile{}, err
		}
		if err := refuseFolder(doc); err != nil {
			return DocumentFile{}, err
		}
		f, err = s.openCurrentFile(ctx, doc, rng)
	} else {
		var v db.DocumentVersion
		doc, v, access, err = s.authorizeDocumentVersion(ctx, actor, documentID, versionNo, DocumentLevelView)
		if err != nil {
			return DocumentFile{}, err
		}
		f, err = s.openVersionFile(ctx, doc, v, rng)
	}
	if err != nil {
		return DocumentFile{}, err
	}
	if action != "" {
		s.recordDocumentAccess(ctx, documentAccessEvent{
			Document: doc, Version: &f.Version.Version, Action: action, Actor: actor, Via: access.Via,
		})
	}
	return f, nil
}

// OpenDocumentAsset streams one page asset after authorizing its document.
func (s *DocumentService) OpenDocumentAsset(ctx context.Context, actor Actor, documentID, assetID string, rng DocumentByteRange) (files.Reader, error) {
	doc, a, _, err := s.authorizeDocumentAsset(ctx, actor, documentID, assetID, DocumentLevelView)
	if err != nil {
		return files.Reader{}, err
	}
	return s.openDocumentBytes(ctx, doc, a.FileID, rng)
}

func (s *DocumentService) openCurrentFile(ctx context.Context, doc db.Document, rng DocumentByteRange) (DocumentFile, error) {
	if doc.Kind != DocumentKindFile || !doc.FileVersionID.Valid {
		return DocumentFile{}, ErrNotFound
	}
	v, err := s.q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: doc.FileVersionID.String, OrganizationID: doc.OrganizationID,
		WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentFile{}, ErrNotFound
	}
	if err != nil {
		return DocumentFile{}, err
	}
	return s.openVersionFile(ctx, doc, v, rng)
}

func (s *DocumentService) openVersionFile(ctx context.Context, doc db.Document, v db.DocumentVersion, rng DocumentByteRange) (DocumentFile, error) {
	if v.Kind != DocumentKindFile || !v.FileID.Valid {
		return DocumentFile{}, ErrNotFound
	}
	r, err := s.openDocumentBytes(ctx, doc, v.FileID.String, rng)
	if err != nil {
		return DocumentFile{}, err
	}
	return DocumentFile{Reader: r, Document: doc, Version: v}, nil
}

// openDocumentBytes is the one call into files.Service.Open, scoped to the
// document's own tenant pair (purposes document_file / document_asset are
// org+workspace scoped). Refusals go out in the Documents vocabulary
// (C-01 §14.5), never as a file_* code.
func (s *DocumentService) openDocumentBytes(ctx context.Context, doc db.Document, fileID string, rng DocumentByteRange) (files.Reader, error) {
	if s.files == nil {
		return files.Reader{}, documentFileError(files.StorageUnavailable(errors.New("document file service not configured")))
	}
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID},
		FileID: files.FileID(fileID),
		Offset: rng.Offset,
		Length: rng.Length,
	})
	if err != nil {
		return files.Reader{}, documentFileError(err)
	}
	return r, nil
}

// DocumentReaderResolver is what notification and realtime consumers call
// at delivery time (plan G1-02): the recipient list of a document event is
// filtered by the document's own access resolver when the frame goes out,
// never by source-workspace membership and never by a decision cached when
// the event was written. A recipient with a valid share outside the
// workspace is kept; one whose access was revoked since is dropped.
type DocumentReaderResolver interface {
	CanReadDocument(ctx context.Context, userID, documentID string) (bool, error)
	FilterDocumentReaders(ctx context.Context, documentID string, userIDs []string) ([]string, error)
}

var _ DocumentReaderResolver = (*DocumentService)(nil)

// CanReadDocument answers the delivery-time question for one person.
func (s *DocumentService) CanReadDocument(ctx context.Context, userID, documentID string) (bool, error) {
	return s.canReadDocumentQ(ctx, s.q, userID, documentID)
}

// canReadDocumentQ is CanReadDocument read through q; a caller holding a
// transaction passes its q so the gate never borrows a second pool
// connection.
func (s *DocumentService) canReadDocumentQ(ctx context.Context, q *db.Queries, userID, documentID string) (bool, error) {
	_, _, err := s.authorizeDocumentQ(ctx, q, Human(userID), documentID, DocumentLevelView)
	switch {
	case err == nil:
		return true, nil
	case isGateRefusal(err):
		return false, nil
	default:
		return false, err
	}
}

// FilterDocumentReaders keeps the people who read the document now.
func (s *DocumentService) FilterDocumentReaders(ctx context.Context, documentID string, userIDs []string) ([]string, error) {
	return s.FilterDocumentReadersQ(ctx, s.q, documentID, userIDs)
}

// FilterDocumentReadersQ is FilterDocumentReaders read through q: the
// mention write runs inside the create/edit transaction, which already holds
// the document row lock and one pool connection, so it resolves the readers
// on that connection instead of borrowing a second one (the deadlock
// TestDocumentMutationGateOnSmallPool exists to prevent). Same decision,
// same errors.
func (s *DocumentService) FilterDocumentReadersQ(ctx context.Context, q *db.Queries, documentID string, userIDs []string) ([]string, error) {
	out := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		ok, err := s.canReadDocumentQ(ctx, q, id, documentID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, id)
		}
	}
	return out, nil
}

// DocumentReadState is what an inbox row's document still is for its
// recipient (G8-07 §4.6). readable keeps the row and its snippet; access_lost
// drops the snippet but keeps the link; gone hides the link too.
type DocumentReadState string

const (
	DocumentReadable   DocumentReadState = "readable"
	DocumentAccessLost DocumentReadState = "access_lost"
	DocumentGone       DocumentReadState = "gone"
	// DocumentTrashable is an archived row the recipient still administers:
	// in the trash and restorable (TRASH-NOTIFY-01). A trashed document is
	// visible to manage (the archive-root decision), so a notice that links
	// to it keeps its title only while that holds; the caller decides which
	// kinds treat the state as live - every other kind reads it as gone.
	DocumentTrashable DocumentReadState = "trashable"
)

// maxFilterReadableDocuments bounds one batch: an inbox page holds at most
// maxLimit (100) rows, so a caller never asks about more documents than that.
const maxFilterReadableDocuments = 100

// FilterReadableDocuments answers one person against many documents (G8-07
// §4.6): the Inbox needs "this recipient on a page of documents", the mirror
// of FilterDocumentReaders' "many people on one document". It dedupes the
// ids, reads existence and trash for all of them in one ListExistingDocumentIDs
// query, runs the organization gate once per distinct organization, and
// resolves the level once per surviving document. Cost is therefore bounded
// by the number of distinct documents on the page (roughly 100 × a few
// queries), and only for rows whose resource_type is document.
//
// A document that is missing or hard-deleted is gone. The organization gate
// runs before the branch: a non-member is gone on an archived row (including
// a former member whose manage share survived their leave, BE-TN-8) and
// access_lost on a live one. An archived row the recipient still administers
// through the gate is trashable; one they may no longer read is access_lost;
// anything else is readable. Ids past the batch cap are refused rather than
// silently half-answered. Callers that never link into the trash treat
// trashable as gone.
func (s *DocumentService) FilterReadableDocuments(ctx context.Context, userID string, documentIDs []string) (map[string]DocumentReadState, error) {
	return s.filterReadableDocuments(ctx, userID, documentIDs, false)
}

// FilterReadableDocumentsIgnoringTrash is FilterReadableDocuments for a notice
// about a trash command (UNI-2056, the verb trashed): its readers are the
// people who could read the document just before the command, so an archived
// row is judged without the "a trashed row is found by managers only" step.
// The organization gate, current shares, stars and visibility still apply, so
// a person who lost access since is access_lost; a person who administers the
// row is still trashable, and one who only reads it is readable. A missing row
// is gone, as before.
func (s *DocumentService) FilterReadableDocumentsIgnoringTrash(ctx context.Context, userID string, documentIDs []string) (map[string]DocumentReadState, error) {
	return s.filterReadableDocuments(ctx, userID, documentIDs, true)
}

func (s *DocumentService) filterReadableDocuments(ctx context.Context, userID string, documentIDs []string, ignoreTrash bool) (map[string]DocumentReadState, error) {
	out := make(map[string]DocumentReadState, len(documentIDs))
	if userID == "" {
		return out, nil
	}
	ids := make([]string, 0, len(documentIDs))
	seen := make(map[string]bool, len(documentIDs))
	for _, id := range documentIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return out, nil
	}
	if len(ids) > maxFilterReadableDocuments {
		return nil, Invalid("tối đa 100 tài liệu mỗi lần")
	}
	rows, err := s.q.ListExistingDocumentIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	live := make(map[string]db.ListExistingDocumentIDsRow, len(rows))
	for _, r := range rows {
		live[r.ID] = r
	}
	// The organization gate is the same for every document of one tenant, so
	// a page that spans one organization pays for it once.
	orgOK := make(map[string]bool, 2)
	for _, id := range ids {
		row, ok := live[id]
		if !ok {
			out[id] = DocumentGone
			continue
		}
		// The organization gate runs first on both branches. The trash level
		// treats a workspace-gate refusal as "shares may still apply"
		// (resolveLevelInTenant), and a share row outlives a leave, so a
		// former member with a retained manage share would otherwise keep a
		// title the trash list itself refuses them (BE-TN-8).
		member, err := s.orgReadable(ctx, row.OrganizationID, userID, orgOK)
		if err != nil {
			return nil, err
		}
		if row.ArchivedAt.Valid {
			// The trash gate answer (decideArchiveRootAccess): a person who
			// administers the row still sees it in the trash, everyone else
			// is told the resource is gone - including a non-member, who
			// must not learn the row merely changed state.
			if !member {
				out[id] = DocumentGone
				continue
			}
			if ignoreTrash {
				state, err := s.documentTrashedReadState(ctx, userID, id)
				if err != nil {
					return nil, err
				}
				out[id] = state
				continue
			}
			trashable, err := s.documentTrashLevel(ctx, userID, id)
			if err != nil {
				return nil, err
			}
			if trashable {
				out[id] = DocumentTrashable
			} else {
				out[id] = DocumentGone
			}
			continue
		}
		if !member {
			out[id] = DocumentAccessLost
			continue
		}
		level, err := s.documentReadLevel(ctx, userID, id)
		if err != nil {
			return nil, err
		}
		if level {
			out[id] = DocumentReadable
		} else {
			out[id] = DocumentAccessLost
		}
	}
	return out, nil
}

// FlagOrganization names the organization an authenticated document route acts
// in, so the `documents` flag is evaluated at that tenant and an organization
// override closes the route like it closes public links and MCP tools
// (UNI-1800). The path names it by orgID, workspaceID or documentID (first
// non-empty wins). "" when it names none, the id is unknown, the caller is not
// a member there, or a lookup fails: the flag then evaluates per user and the
// service behind the gate refuses as it always did, so a non-member never
// learns another tenant's flag state.
func (s *DocumentService) FlagOrganization(ctx context.Context, userID, orgID, workspaceID, documentID string) string {
	switch {
	case orgID != "":
	case workspaceID != "":
		w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
		if err != nil {
			return ""
		}
		orgID = w.OrganizationID
	case documentID != "":
		d, err := s.q.GetDocumentByID(ctx, documentID)
		if err != nil {
			return ""
		}
		orgID = d.OrganizationID
	default:
		return ""
	}
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return ""
	}
	return orgID
}

// orgReadable runs OrganizationService.RequireMember once per organization
// and memoizes the answer; a closed tenant is "not readable", not an error,
// because the inbox row still renders (with its snippet dropped).
func (s *DocumentService) orgReadable(ctx context.Context, orgID, userID string, memo map[string]bool) (bool, error) {
	if v, ok := memo[orgID]; ok {
		return v, nil
	}
	_, err := s.orgs.RequireMember(ctx, orgID, userID)
	switch {
	case err == nil:
		memo[orgID] = true
		return true, nil
	case isGateRefusal(err):
		memo[orgID] = false
		return false, nil
	default:
		return false, err
	}
}

// documentReadLevel reads the document and resolves the recipient's level
// through the same gate every document read uses; a document that vanished
// between the existence read and here is gone, a refusal is not readable. The
// caller has already run the organization gate for this document's tenant
// (FilterReadableDocuments memoizes it per organization), so only the level
// is resolved here and one page pays for the tenant check once (R1-3).
func (s *DocumentService) documentReadLevel(ctx context.Context, userID, documentID string) (bool, error) {
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	access, err := s.resolveLevelInTenant(ctx, s.q, Human(userID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return false, nil
		}
		return false, err
	}
	return decideDocumentAccess(doc, access, DocumentLevelView) == nil, nil
}

// documentTrashLevel is documentReadLevel's sibling for a document already
// in the trash: the answer is whether the recipient may administer the row
// (decideArchiveRootAccess's manage -> visible), not whether they may read
// it - nobody reads a trashed document. The caller must have run the
// organization gate already (FilterReadableDocuments memoizes it per
// organization and runs it on the archived branch too, BE-TN-8), because
// resolveLevelInTenant reads a workspace-gate refusal as "shares may still
// apply" and a share row outlives a leave. A gate refusal reaching here is
// still not trashable, and a row that vanished between the existence read and
// here is not either.
func (s *DocumentService) documentTrashLevel(ctx context.Context, userID, documentID string) (bool, error) {
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	access, err := s.resolveLevelInTenant(ctx, s.q, Human(userID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return false, nil
		}
		return false, err
	}
	return access.canAdminister(), nil
}

// documentTrashedReadState is documentTrashLevel for a notice that names the
// batch to the people who could read it before the command: a person who
// administers the trashed row is trashable, one who reads it through the
// shares, stars and visibility it still has is readable, and one with no read
// level now is access_lost. The caller has run the organization gate.
func (s *DocumentService) documentTrashedReadState(ctx context.Context, userID, documentID string) (DocumentReadState, error) {
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentGone, nil
	}
	if err != nil {
		return "", err
	}
	access, err := s.resolveLevelInTenant(ctx, s.q, Human(userID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return DocumentAccessLost, nil
		}
		return "", err
	}
	switch {
	case access.Level == DocumentLevelNone:
		// A workspace admin of a restricted document administers it by role
		// (AdminScope) but reads it only through a share: with the share gone
		// the live gate answers access_lost, and so does this one.
		return DocumentAccessLost, nil
	case access.canAdminister():
		return DocumentTrashable, nil
	default:
		return DocumentReadable, nil
	}
}

// FilterDocumentReadersIgnoringTrash keeps the people who could read the
// document before it went to the trash (UNI-2056): the same level rule as
// FilterDocumentReaders without the "a trashed row is found by managers
// only" step. Archiving moves only archived_at, so the shares, stars and
// visibility still answer as they did just before the command.
func (s *DocumentService) FilterDocumentReadersIgnoringTrash(ctx context.Context, documentID string, userIDs []string) ([]string, error) {
	out := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		_, _, err := s.authorizeDocumentGate(ctx, s.q, Human(id), documentID, func(_ db.Document, access DocumentAccess) error {
			if access.Level == DocumentLevelNone {
				return ErrNotFound
			}
			return nil
		})
		switch {
		case err == nil:
			out = append(out, id)
		case isGateRefusal(err):
		default:
			return nil, err
		}
	}
	return out, nil
}

// documentChangeNoticeCap bounds the people a purge records for its
// document_changed notice. A document with more candidates than this sends
// no deleted notice at all: the list would bloat an append-only audit row and
// cost one read gate per person inside the purge's tree lock (BE-R1-4).
const documentChangeNoticeCap = 200

// documentChangeReadersQ is the audience of a document_changed notice
// (UNI-2056 §2) read through q: the ACL owner, live user shares and stars
// besides the actor, kept while they read the document now. The purge calls
// it inside its own transaction, before the shares and stars are deleted, so
// it stays cheap there: a private document (restricted, no live share, no
// live link) has nobody to tell and returns before any gate, and more than
// documentChangeNoticeCap candidates return none.
func (s *DocumentService) documentChangeReadersQ(ctx context.Context, q *db.Queries, doc db.Document, actorID string) ([]string, error) {
	if doc.Visibility != "workspace" {
		facts, err := q.GetDocumentChangeFacts(ctx, doc.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if !facts.HasLiveShare && !facts.HasLiveLink {
			return nil, nil
		}
	}
	audience, err := q.ListDocumentChangeAudience(ctx, db.ListDocumentChangeAudienceParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{actorID: true}
	candidates := make([]string, 0, len(audience)+1)
	for _, id := range append([]string{doc.AclOwnerID.String}, audience...) {
		if id != "" && !seen[id] {
			seen[id] = true
			candidates = append(candidates, id)
		}
	}
	if len(candidates) > documentChangeNoticeCap {
		slog.Debug("document purge: too many people to tell, deleted notice skipped",
			"document", doc.ID, "organization", doc.OrganizationID, "workspace", doc.WorkspaceID,
			"candidates", len(candidates), "cap", documentChangeNoticeCap)
		return nil, nil
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	return s.FilterDocumentReadersQ(ctx, q, doc.ID, candidates)
}
