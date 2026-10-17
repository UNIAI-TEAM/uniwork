package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	DocumentShareCandidateDefaultLimit = 20
	DocumentShareCandidateMaxLimit     = 50
)

// DocumentShareCandidateFilter is the query of GET /api/v1/documents/{documentID}/share-candidates.
type DocumentShareCandidateFilter struct {
	Q      string
	Cursor string
	Limit  int
}

// DocumentShareCandidate is one shareable principal in the document's organization.
type DocumentShareCandidate struct {
	PrincipalType   string
	PrincipalID     string
	Name            string
	Secondary       string
	AvatarURL       string
	IconEmoji       string
	DirectLevel     string
	IsHomeWorkspace bool
}

// DocumentShareCandidatePage is one page of share candidates.
type DocumentShareCandidatePage struct {
	Items      []DocumentShareCandidate
	NextCursor string
}

// ListShareCandidates lists people, workspaces, and the organization itself
// that may be granted access on one document (SH-S2, UNI-1781).
func (s *DocumentService) ListShareCandidates(
	ctx context.Context,
	actor Actor,
	documentID string,
	f DocumentShareCandidateFilter,
) (DocumentShareCandidatePage, error) {
	doc, _, err := s.authorizeDocumentAdminister(ctx, actor, documentID)
	if err != nil {
		return DocumentShareCandidatePage{}, err
	}

	limit := f.Limit
	switch {
	case limit <= 0:
		limit = DocumentShareCandidateDefaultLimit
	case limit > DocumentShareCandidateMaxLimit:
		limit = DocumentShareCandidateMaxLimit
	}

	var qParam pgtype.Text
	if rawQ := strings.TrimSpace(f.Q); rawQ != "" {
		if len([]rune(rawQ)) > 200 {
			return DocumentShareCandidatePage{}, Invalid("q tối đa 200 ký tự")
		}
		if folded := foldForSearch(rawQ); folded != "" {
			qParam = pgtype.Text{String: escapeLikePattern(folded), Valid: true}
		}
	}

	var cursorRank pgtype.Int4
	var cursorName, cursorID pgtype.Text
	if c := strings.TrimSpace(f.Cursor); c != "" {
		rank, sn, pid, ok := decodeShareCandidateCursor(c)
		if !ok {
			return DocumentShareCandidatePage{}, Invalid("cursor không hợp lệ")
		}
		cursorRank = pgtype.Int4{Int32: int32(rank), Valid: true}
		cursorName = pgtype.Text{String: sn, Valid: true}
		cursorID = pgtype.Text{String: pid, Valid: true}
	}

	rows, err := s.q.ListDocumentSharePrincipalCandidates(ctx, db.ListDocumentSharePrincipalCandidatesParams{
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		OrganizationID: doc.OrganizationID,
		Q:              qParam,
		CursorRank:     cursorRank,
		CursorName:     cursorName,
		CursorID:       cursorID,
		RowLimit:       int32(limit + 1),
	})
	if err != nil {
		return DocumentShareCandidatePage{}, err
	}

	var nextCursor string
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[limit-1]
		nextCursor = encodeShareCandidateCursor(int(last.TypeRank), last.SortName, last.PrincipalID)
	}

	legacyHome, err := homeWorkspaceShares(ctx, s.q, doc)
	if err != nil {
		return DocumentShareCandidatePage{}, err
	}
	homeLvl, hasHomeLvl := currentHomeWorkspaceLevel(doc, legacyHome)

	decorateMemberAvatars(ctx, s.files, rows, func(r db.ListDocumentSharePrincipalCandidatesRow) avatarRow {
		if r.PrincipalType != DocumentPrincipalUser {
			return avatarRow{}
		}
		return avatarRow{UserID: r.PrincipalID, AvatarURL: r.AvatarUrl, FileID: r.AvatarFileID}
	}, func(r *db.ListDocumentSharePrincipalCandidatesRow, url string) {
		r.AvatarUrl = pgtype.Text{String: url, Valid: true}
	})

	items := make([]DocumentShareCandidate, 0, len(rows))
	for _, r := range rows {
		directLvl := r.DirectLevel
		if r.IsHomeWorkspace {
			if hasHomeLvl {
				directLvl = string(homeLvl)
			} else {
				directLvl = ""
			}
		}
		items = append(items, DocumentShareCandidate{
			PrincipalType:   r.PrincipalType,
			PrincipalID:     r.PrincipalID,
			Name:            r.Name,
			Secondary:       r.Subtitle,
			AvatarURL:       r.AvatarUrl.String,
			IconEmoji:       r.IconEmoji.String,
			DirectLevel:     directLvl,
			IsHomeWorkspace: r.IsHomeWorkspace,
		})
	}
	return DocumentShareCandidatePage{
		Items:      items,
		NextCursor: nextCursor,
	}, nil
}

// encodeShareCandidateCursor carries the keyset of the last row read: the type
// rank, the folded name and the id, the same three keys the page orders by
// (contract §1.2, R1-11).
func encodeShareCandidateCursor(typeRank int, sortName, principalID string) string {
	raw := fmt.Sprintf("%d\x00%s\x00%s", typeRank, sortName, principalID)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeShareCandidateCursor(cursor string) (typeRank int, sortName, principalID string, ok bool) {
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		b, err = base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return 0, "", "", false
		}
	}
	parts := strings.Split(string(b), "\x00")
	if len(parts) != 3 || parts[2] == "" {
		return 0, "", "", false
	}
	rank, err := strconv.Atoi(parts[0])
	if err != nil || rank < 0 || rank > 2 {
		return 0, "", "", false
	}
	return rank, parts[1], parts[2], true
}
