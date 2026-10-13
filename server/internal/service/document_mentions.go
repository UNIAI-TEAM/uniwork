package service

// Mention candidates (G8-06, UNI-1401): the people a document comment may
// name with a mention token. The set is the document's readers, read from the
// same ACL rows the level rule reads, so a candidate is always someone who
// could open the document today; the caller needs view, like every other read
// of the thread. Email is not part of "who can read": it reaches only a
// caller who may list the document workspace's members (the gate of
// GET /workspaces/{id}/members), because that list is where the picker
// normally shows it - a direct-share reader from another workspace does not
// pass that gate.

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// defaultMentionCandidateLimit is the picker's page size when the caller
	// asks for none; maxMentionCandidateLimit caps one answer.
	defaultMentionCandidateLimit = 20
	maxMentionCandidateLimit     = 50
)

// MentionCandidate is one person the picker may offer. Email is empty unless
// the caller may list the workspace's members.
type MentionCandidate struct {
	UserID      string
	DisplayName string
	AvatarURL   string
	Email       string
}

// MentionCandidateQuery is the picker's query string, already trimmed.
type MentionCandidateQuery struct {
	Query string
	Limit int
}

// mentionCandidateLimit clamps a requested page size: <= 0 is the default,
// more than the cap is the cap.
func mentionCandidateLimit(limit int) int {
	if limit <= 0 {
		return defaultMentionCandidateLimit
	}
	if limit > maxMentionCandidateLimit {
		return maxMentionCandidateLimit
	}
	return limit
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
	// An owned document's level comes from its owning product, never from
	// membership or shares, so its readers cannot be read here; naming the
	// workspace instead would offer people who cannot open it.
	if doc.OwnerKind.Valid {
		return []MentionCandidate{}, nil
	}
	// The member-list gate decides whether the emails ride along; a gate
	// refusal keeps the names and drops the emails.
	seeMembers := false
	switch _, err := s.ws.RequireMember(ctx, doc.WorkspaceID, actor.ID); {
	case err == nil:
		seeMembers = true
	case isGateRefusal(err):
	default:
		return nil, err
	}
	// The query compares uw_fold_search(...) with the folded term, so
	// "nguyen" finds "Nguyễn" (foldForSearch and the SQL function agree;
	// TestDocumentSourceFoldAgreesWithGo holds the tables together).
	q := pgtype.Text{}
	if term := foldForSearch(strings.TrimSpace(in.Query)); term != "" {
		q = pgtype.Text{String: escapeLikePattern(term), Valid: true}
	}
	rows, err := s.q.ListDocumentMentionCandidates(ctx, db.ListDocumentMentionCandidatesParams{
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		DocumentID:       doc.ID,
		AclOwnerID:       doc.AclOwnerID,
		WorkspaceVisible: doc.Visibility != documentVisibilityRestricted,
		Q:                q,
		RowLimit:         int32(mentionCandidateLimit(in.Limit)),
	})
	if err != nil {
		return nil, err
	}
	out := make([]MentionCandidate, 0, len(rows))
	for _, r := range rows {
		c := MentionCandidate{
			UserID:      r.UserID,
			DisplayName: r.DisplayName,
			AvatarURL:   textOrEmpty(r.AvatarUrl),
		}
		if seeMembers {
			c.Email = r.Email
		}
		out = append(out, c)
	}
	return out, nil
}
