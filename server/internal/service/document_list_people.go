package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentPerson is a person a document list row names: the last editor, the
// granter of a share. It exists only for a human who is a member of the
// organization the list is read in (UNI-2045 SV-3, SV-6) - a name never leaves
// the server across organizations.
type DocumentPerson struct {
	Name string
	// AvatarURL is absolute and loads without an auth header: a presigned
	// FileService URL (valid for at most files.MaxResolveURLTTL) when the avatar
	// is a stored file, else the account's stored absolute URL; empty when the
	// person has none.
	AvatarURL string
}

// organizationPeople resolves ids to the people of organizationID among them,
// in one query; an id that is not a member (an agent, a stranger, a removed
// account) is absent from the result. withAvatars also resolves the avatar
// URLs, presigning the file-backed ones once per distinct person of the page
// (FileService scopes an avatar to its owner, so a batch is per person, never
// per row).
func (s *DocumentService) organizationPeople(ctx context.Context, organizationID string, ids []string, withAvatars bool) (map[string]DocumentPerson, error) {
	out := map[string]DocumentPerson{}
	seen := map[string]struct{}{}
	uniq := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return out, nil
	}
	rows, err := s.q.ListOrganizationPeopleByIDs(ctx, db.ListOrganizationPeopleByIDsParams{OrganizationID: organizationID, UserIds: uniq})
	if err != nil {
		return nil, err
	}
	var urls map[files.FileID]string
	if withAvatars && s.files != nil {
		byUser := map[string]files.FileID{}
		for _, r := range rows {
			// A stored absolute URL wins, exactly as a comment author's avatar does.
			if !absoluteAvatarURL(textOrEmpty(r.AvatarUrl)) && r.AvatarFileID.Valid && r.AvatarFileID.String != "" {
				byUser[r.ID] = files.FileID(r.AvatarFileID.String)
			}
		}
		urls = resolveAvatarURLs(ctx, s.files, byUser)
	}
	for _, r := range rows {
		name := strings.TrimSpace(r.DisplayName)
		if name == "" {
			continue
		}
		person := DocumentPerson{Name: name}
		if withAvatars {
			if stored := textOrEmpty(r.AvatarUrl); absoluteAvatarURL(stored) {
				person.AvatarURL = stored
			} else if r.AvatarFileID.Valid {
				person.AvatarURL = urls[files.FileID(r.AvatarFileID.String)]
			}
		}
		out[r.ID] = person
	}
	return out, nil
}

// absoluteAvatarURL is true for a URL a browser can load with no help from the
// app: http(s) with a host. A relative path or a bare key is not emitted.
func absoluteAvatarURL(u string) bool {
	return strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")
}
