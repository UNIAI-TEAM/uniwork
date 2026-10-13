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
// the caller may list the workspace's members.
type MentionCandidate struct {
	UserID      string
	DisplayName string
	AvatarURL   string
	Email       string
}

// MentionCandidateQuery is the picker's query string, already trimmed. Limit
// is nil when the caller asked for no page size at all; an explicit value is
// clamped into the contract's [1, 50].
type MentionCandidateQuery struct {
	Query string
	Limit *int
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
// two avatar columns decorateMemberAvatars resolves.
type mentionRow struct {
	UserID       string
	DisplayName  string
	Email        string
	AvatarURL    pgtype.Text
	AvatarFileID pgtype.Text
}

// MentionCandidates lists the people who hold at least view on the document:
// effective workspace members and the live shares on it, minus deactivated
// members. The caller is authorized first (view), so an outsider never learns
// the document exists.
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

	// An owned document's level comes from its owning product, never from
	// membership or shares, so the ACL rows the main query reads do not exist
	// for it; its readers are resolved through the read-time gate instead.
	if doc.OwnerKind.Valid {
		return s.ownedMentionCandidates(ctx, doc, q, seeMembers, limit)
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
func (s *DocumentService) ownedMentionCandidates(ctx context.Context, doc db.Document, q pgtype.Text, seeMembers bool, limit int) ([]MentionCandidate, error) {
	rows, err := s.q.ListOwnedDocumentMentionCandidates(ctx, db.ListOwnedDocumentMentionCandidatesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Q:              q,
		SeeMembers:     seeMembers,
		RowLimit:       int32(ownedMentionCandidateScanLimit(limit)),
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
		}
		if seeMembers {
			c.Email = r.Email
		}
		out = append(out, c)
	}
	return out
}
