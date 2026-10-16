package service

// Mention candidates (G8-06, UNI-1401): the people a document comment may
// name with a mention token. The set is the document's readers, read from the
// same ACL rows the level rule reads, so a candidate is always someone who
// could open the document today; the caller needs view, like every other read
// of the thread. Email is not part of "who can read": it reaches only a
// caller who may list the document workspace's members (the gate of
// GET /workspaces/{id}/members), because that list is where the picker
// normally shows it - a direct-share reader from another workspace does not
// pass that gate. The same gate decides the email leg of the search: a caller
// who may not see addresses cannot confirm one by typing it into q.
//
// An owned document (a work product's page, C-01 section 13.4) keeps no ACL
// rows of its own: its level comes from the owning product's resolver, which
// SQL cannot read. The picker still answers - the workspace's effective
// members are offered, then filtered through the same read-time gate every
// document event uses (FilterDocumentReaders), so only the people the owner
// resolver actually grants remain.

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mentions"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// defaultMentionCandidateLimit is the picker's page size when the caller
	// asks for none; minMentionCandidateLimit and maxMentionCandidateLimit
	// bound an explicitly requested one (contract 2.8: out of range clamps
	// into [1, 50]).
	defaultMentionCandidateLimit = 20
	minMentionCandidateLimit     = 1
	maxMentionCandidateLimit     = 50

	// ownedMentionCandidateScanCap bounds the page read for an owned document
	// before the per-person read gate filters it: the answer needs `limit`
	// readers, so a bounded overscan finds them without scanning the whole
	// workspace.
	ownedMentionCandidateScanCap = 150
)

// MentionCandidate is one person the picker may offer. Email is empty unless
// the caller may list the workspace's members. CanView is set only on an
// include=no_access answer: it says whether the person can open the document
// today (G8-18); nil means "every row is a reader", the old shape.
type MentionCandidate struct {
	UserID      string
	DisplayName string
	AvatarURL   string
	Email       string
	CanView     *bool
}

// MentionCandidateQuery is the picker's query string, already trimmed. Limit
// is nil when the caller asked for no page size at all; an explicit value is
// clamped into the contract's [1, 50].
//
// IncludeNoAccess asks for the people who cannot read the document too, each
// marked with CanView (G8-18). It is honoured only for a caller who may list
// the workspace's members; anyone else gets the readers-only answer.
type MentionCandidateQuery struct {
	Query           string
	Limit           *int
	IncludeNoAccess bool
}

// mentionCandidateLimit resolves the page size: nil (no limit asked for) is
// the default page, and an explicit value clamps into [1, 50] - a 0 or a
// negative is one row, not the default (contract 2.8).
func mentionCandidateLimit(limit *int) int {
	if limit == nil {
		return defaultMentionCandidateLimit
	}
	if *limit < minMentionCandidateLimit {
		return minMentionCandidateLimit
	}
	if *limit > maxMentionCandidateLimit {
		return maxMentionCandidateLimit
	}
	return *limit
}

// mentionRow is the candidate slice both queries share: who they are and the
// two avatar columns decorateMemberAvatars resolves. CanView is carried only
// by the include=no_access path.
type mentionRow struct {
	UserID       string
	DisplayName  string
	Email        string
	AvatarURL    pgtype.Text
	AvatarFileID pgtype.Text
	CanView      *bool
}

// MentionCandidates lists the people who hold at least view on the document:
// effective workspace members and the live shares on it, minus deactivated
// members (on a restricted document only its ACL owner, a live share or a
// live break-glass grant). With IncludeNoAccess - and only for a caller who
// may list the workspace's members - the people who cannot read it follow,
// each marked CanView. The caller is authorized first (view), so an outsider
// never learns the document exists.
func (s *DocumentService) MentionCandidates(ctx context.Context, actor Actor, documentID string, in MentionCandidateQuery) ([]MentionCandidate, error) {
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return nil, err
	}
	// The member-list gate decides whether the emails ride along - and,
	// because a caller who may not see addresses must not be able to confirm
	// one by searching it, the email leg of q as well. A gate refusal keeps
	// the names and drops the emails.
	seeMembers := false
	switch _, err := s.ws.RequireMember(ctx, doc.WorkspaceID, actor.ID); {
	case err == nil:
		seeMembers = true
	case isGateRefusal(err):
	default:
		return nil, err
	}
	// The queries compare uw_fold_search(...) with the folded term, so
	// "nguyen" finds "Nguyễn" (foldForSearch and the SQL function agree;
	// TestDocumentSourceFoldAgreesWithGo holds the tables together).
	q := pgtype.Text{}
	if term := foldForSearch(strings.TrimSpace(in.Query)); term != "" {
		q = pgtype.Text{String: escapeLikePattern(term), Valid: true}
	}
	limit := mentionCandidateLimit(in.Limit)
	// The no-access pool exposes who is in the workspace, so it rides on the
	// same member-list gate as the emails; otherwise the flag is ignored.
	includeNoAccess := in.IncludeNoAccess && seeMembers

	// An owned document's level comes from its owning product, never from
	// membership or shares, so the ACL rows the main query reads do not exist
	// for it; its readers are resolved through the read-time gate instead.
	if doc.OwnerKind.Valid {
		return s.ownedMentionCandidates(ctx, doc, q, seeMembers, includeNoAccess, limit)
	}
	if includeNoAccess {
		return s.mentionCandidatesWithAccess(ctx, doc, q, seeMembers, limit)
	}

	rows, err := s.q.ListDocumentMentionCandidates(ctx, db.ListDocumentMentionCandidatesParams{
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		DocumentID:       doc.ID,
		AclOwnerID:       doc.AclOwnerID,
		WorkspaceVisible: doc.Visibility != documentVisibilityRestricted,
		Q:                q,
		SeeMembers:       seeMembers,
		RowLimit:         int32(limit),
	})
	if err != nil {
		return nil, err
	}
	candidates := make([]mentionRow, 0, len(rows))
	for _, r := range rows {
		candidates = append(candidates, mentionRow{
			UserID: r.UserID, DisplayName: r.DisplayName, Email: r.Email,
			AvatarURL: r.AvatarUrl, AvatarFileID: r.AvatarFileID,
		})
	}
	s.decorateMentionAvatars(ctx, candidates)
	return mentionCandidateList(candidates, seeMembers), nil
}

// ownedMentionCandidates answers the picker for a document whose access is
// delegated to an owning product (C-01 section 13.4). The workspace's
// effective members are the candidate pool - a deactivated member is out, as
// everywhere - and each one is then asked through the same read-time gate
// every document event uses, so only the people the owner resolver grants
// remain. The page is read bounded (limit*3, cap 150) and stops at the
// requested limit after filtering, so one request is one bounded read
// whatever the workspace's size.
func (s *DocumentService) ownedMentionCandidates(ctx context.Context, doc db.Document, q pgtype.Text, seeMembers, includeNoAccess bool, limit int) ([]MentionCandidate, error) {
	scan := ownedMentionCandidateScanLimit(limit)
	if includeNoAccess {
		// The no-access page keeps both sides, so the read gate cannot
		// shrink the pool to the answer; read the whole bounded window.
		scan = ownedMentionCandidateScanCap
	}
	rows, err := s.q.ListOwnedDocumentMentionCandidates(ctx, db.ListOwnedDocumentMentionCandidatesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Q:              q,
		SeeMembers:     seeMembers,
		RowLimit:       int32(scan),
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []MentionCandidate{}, nil
	}
	pool := make([]mentionRow, 0, len(rows))
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		pool = append(pool, mentionRow{
			UserID: r.UserID, DisplayName: r.DisplayName, Email: r.Email,
			AvatarURL: r.AvatarUrl, AvatarFileID: r.AvatarFileID,
		})
		ids = append(ids, r.UserID)
	}
	readers, err := s.FilterDocumentReaders(ctx, doc.ID, ids)
	if err != nil {
		return nil, err
	}
	keep := make(map[string]struct{}, len(readers))
	for _, id := range readers {
		keep[id] = struct{}{}
	}
	if includeNoAccess {
		return s.markedOwnedMentionCandidates(ctx, pool, keep, seeMembers, limit), nil
	}
	kept := make([]mentionRow, 0, limit)
	for _, r := range pool {
		if _, ok := keep[r.UserID]; !ok {
			continue
		}
		kept = append(kept, r)
		if len(kept) == limit {
			break
		}
	}
	s.decorateMentionAvatars(ctx, kept)
	return mentionCandidateList(kept, seeMembers), nil
}

// markedOwnedMentionCandidates is the include=no_access answer for an owned
// document: the pool (already by name) split by the read gate, readers first,
// then the rest, cut at limit, each row carrying its can_view.
func (s *DocumentService) markedOwnedMentionCandidates(ctx context.Context, pool []mentionRow, readers map[string]struct{}, seeMembers bool, limit int) []MentionCandidate {
	page := make([]mentionRow, 0, limit)
	for _, wantView := range []bool{true, false} {
		for _, r := range pool {
			if _, ok := readers[r.UserID]; ok != wantView {
				continue
			}
			canView := wantView
			r.CanView = &canView
			page = append(page, r)
			if len(page) == limit {
				s.decorateMentionAvatars(ctx, page)
				return mentionCandidateList(page, seeMembers)
			}
		}
	}
	s.decorateMentionAvatars(ctx, page)
	return mentionCandidateList(page, seeMembers)
}

// mentionCandidatesWithAccess is the include=no_access answer for an ordinary
// document: the workspace's effective members and the direct-share users,
// each with the same can_view predicate the default picker reads, readers
// first and then by name (the query orders and cuts the page).
func (s *DocumentService) mentionCandidatesWithAccess(ctx context.Context, doc db.Document, q pgtype.Text, seeMembers bool, limit int) ([]MentionCandidate, error) {
	rows, err := s.q.ListDocumentMentionCandidatesWithAccess(ctx, db.ListDocumentMentionCandidatesWithAccessParams{
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		DocumentID:       doc.ID,
		AclOwnerID:       doc.AclOwnerID,
		WorkspaceVisible: doc.Visibility != documentVisibilityRestricted,
		Q:                q,
		SeeMembers:       seeMembers,
		RowLimit:         int32(limit),
	})
	if err != nil {
		return nil, err
	}
	candidates := make([]mentionRow, 0, len(rows))
	for _, r := range rows {
		canView := r.CanView
		candidates = append(candidates, mentionRow{
			UserID: r.UserID, DisplayName: r.DisplayName, Email: r.Email,
			AvatarURL: r.AvatarUrl, AvatarFileID: r.AvatarFileID, CanView: &canView,
		})
	}
	s.decorateMentionAvatars(ctx, candidates)
	return mentionCandidateList(candidates, seeMembers), nil
}

// ownedMentionCandidateScanLimit bounds the overscan: three times the answer
// size is enough room for the read gate to drop non-readers, and the cap
// keeps one request from reading a whole organization.
func ownedMentionCandidateScanLimit(limit int) int {
	n := limit * 3
	if n > ownedMentionCandidateScanCap {
		return ownedMentionCandidateScanCap
	}
	return n
}

// decorateMentionAvatars resolves the file-backed avatars of the candidates
// the way every other member list does (WorkspaceService.Members), so a
// person whose photo lives in FileService shows the same URL here.
func (s *DocumentService) decorateMentionAvatars(ctx context.Context, rows []mentionRow) {
	decorateMemberAvatars(ctx, s.files, rows, func(r mentionRow) avatarRow {
		return avatarRow{UserID: r.UserID, AvatarURL: r.AvatarURL, FileID: r.AvatarFileID}
	}, func(r *mentionRow, url string) {
		r.AvatarURL = pgtype.Text{String: url, Valid: true}
	})
}

// mentionCandidateList maps the rows to the service answer, carrying the
// email only for a caller who may list the workspace's members.
func mentionCandidateList(rows []mentionRow, seeMembers bool) []MentionCandidate {
	out := make([]MentionCandidate, 0, len(rows))
	for _, r := range rows {
		c := MentionCandidate{
			UserID:      r.UserID,
			DisplayName: r.DisplayName,
			AvatarURL:   textOrEmpty(r.AvatarURL),
			CanView:     r.CanView,
		}
		if seeMembers {
			c.Email = r.Email
		}
		out = append(out, c)
	}
	return out
}

// syncDocumentCommentMentions reconciles one comment's durable mention rows
// with the ids its body names, inside the caller's create/edit transaction,
// so a mention can never commit without its comment (contract-collab section
// 8.1). A newly named id lands active when the person may read the document
// right now and no_access when they may not (G8-D3 provisional: stored, never
// delivered, never an error). An id no longer in the body becomes removed and
// keeps its old notification; an id that returns after being removed turns
// active again with its notified_at kept, so one row notifies at most once.
func (s *DocumentService) syncDocumentCommentMentions(ctx context.Context, q *db.Queries, ref CommentRef, actor Actor, commentID, body string) error {
	ids := mentions.TokenIDs(body)
	rows, err := q.ListDocumentCommentMentions(ctx, db.ListDocumentCommentMentionsParams{
		CommentID: commentID, DocumentID: ref.ResourceID,
		OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
	if err != nil {
		return err
	}
	existing := make(map[string]db.DocumentCommentMention, len(rows))
	for _, r := range rows {
		existing[r.UserID] = r
	}
	wanted := make(map[string]bool, len(ids))
	var added, reactivated, dropped []string
	for _, id := range ids {
		wanted[id] = true
		switch r, ok := existing[id]; {
		case !ok:
			added = append(added, id)
		case r.State == "removed":
			reactivated = append(reactivated, id)
		}
	}
	for _, r := range rows {
		if !wanted[r.UserID] && r.State != "removed" {
			dropped = append(dropped, r.UserID)
		}
	}
	readable := make(map[string]bool, len(added)+len(reactivated))
	if len(added)+len(reactivated) > 0 {
		// The read gate decides active vs no_access, for a returning id as
		// for a new one (G8-18: a non-reader never comes back active). It
		// excludes deactivated members, revoked shares and admins with no
		// break-glass grant, exactly as the delivery-time gate does.
		// It runs on the caller's q, never the pool: this sync is inside the
		// create/edit transaction, which already holds the document row lock
		// and a connection, so a second borrow could deadlock a saturated
		// pool (TestDocumentMutationGateOnSmallPool).
		readers, err := s.FilterDocumentReadersQ(ctx, q, ref.ResourceID, append(append([]string(nil), added...), reactivated...))
		if err != nil {
			return err
		}
		for _, id := range readers {
			readable[id] = true
		}
		for _, id := range added {
			state := "no_access"
			if readable[id] {
				state = "active"
			}
			if err := q.InsertDocumentCommentMention(ctx, db.InsertDocumentCommentMentionParams{
				ID: util.NewID(), OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
				DocumentID: ref.ResourceID, CommentID: commentID, UserID: id,
				State: state, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
			}); err != nil {
				return err
			}
		}
	}
	for _, id := range reactivated {
		state := "no_access"
		if readable[id] {
			state = "active"
		}
		if err := q.ReactivateDocumentCommentMention(ctx, db.ReactivateDocumentCommentMentionParams{
			State: state, CommentID: commentID, UserID: id, DocumentID: ref.ResourceID,
			OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		}); err != nil {
			return err
		}
	}
	if len(dropped) > 0 {
		if err := q.RemoveDocumentCommentMentions(ctx, db.RemoveDocumentCommentMentionsParams{
			CommentID: commentID, DocumentID: ref.ResourceID,
			OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
			UserIds: dropped,
		}); err != nil {
			return err
		}
	}
	return nil
}

// MentionWithoutAccess is one person a comment named who cannot read the
// document (G8-18): the mention was stored as no_access, never notified and
// never turned into a grant. DisplayName is empty for an id outside the
// organization. CanShare tells the author whether offering them view access
// from the comment is possible.
type MentionWithoutAccess struct {
	UserID      string
	DisplayName string
	CanShare    bool
}

// CommentMentionsWithoutAccess lists the no_access mentions the create/edit
// transaction of one comment stored, for the answer of POST/PATCH comments.
// It reads the durable rows, so a replayed create answers what is stored now.
//
// can_share (G8-18, matching "Administer" of DOC-05) is true only when ALL
// hold: the caller can administer the document (manage, or AdminScope), the
// document is not owned by a Work Product (shares are refused there), the
// mentioned person is an active organization member, and either the caller
// holds manage or the mentioned person is not the caller (an admin who only
// has AdminScope never shares the document with themselves through the plain
// route; break-glass is the way in).
func (s *DocumentService) CommentMentionsWithoutAccess(ctx context.Context, actor Actor, documentID, commentID string) ([]MentionWithoutAccess, error) {
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelComment)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListNoAccessDocumentCommentMentions(ctx, db.ListNoAccessDocumentCommentMentionsParams{
		CommentID: commentID, DocumentID: doc.ID,
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	callerMayShare := access.canAdminister() && !doc.OwnerKind.Valid
	out := make([]MentionWithoutAccess, 0, len(rows))
	for _, r := range rows {
		out = append(out, MentionWithoutAccess{
			UserID:      r.UserID,
			DisplayName: r.DisplayName,
			CanShare: callerMayShare && r.ActiveMember &&
				(access.Level.AtLeast(DocumentLevelManage) || r.UserID != actor.ID),
		})
	}
	return out, nil
}
