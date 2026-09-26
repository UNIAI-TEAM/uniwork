package backfill

import (
	"context"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M8/M9: the account avatar is the identity-scope exception — its files row
// carries NULL organization_id and the session carries user_id (ADR 0023).
// avatar_url is the locator; avatar_file_id the new column. External URLs
// (Google pictures, foreign CDNs) are foreign, never imported. The key the
// legacy uploader minted is avatars/<user_id>/<ulid>.<ext>; a URL resolving
// to a key under another user's segment is held, not trusted.
func (e *Engine) scanAvatars(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanAvatars(ctx, db.FileBackfillScanAvatarsParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		items = append(items, e.classifyAvatar(r))
		next = r.ID
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

func (e *Engine) classifyAvatar(r db.FileBackfillScanAvatarsRow) Item {
	it := Item{
		Cohort:      CohortAvatars,
		SourceTable: "users",
		SourceID:    r.ID,
		Purpose:     "user_avatar",
		Claimed:     true,
	}
	// The avatar file is shared across organizations by design (NULL tenant);
	// its scope is the user alone, so two users naming one locator conflict
	// in the shared-locator pass and hold rather than merge.
	it.UserID = r.ID
	it.ActorID, it.ActorKind = r.ID, "human"

	if r.AvatarFileID.Valid && r.AvatarFileID.String != "" {
		it.Class = ClassAlreadyApplied
		it.FileID = r.AvatarFileID.String
		return it
	}

	raw := strings.TrimSpace(r.AvatarUrl.String)
	it.RawLocator = raw

	// A bare key (no scheme, no leading slash) cannot come from a writer that
	// only ever stored Upload() URLs — treat as unparseable, not foreign.
	if !strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		it.Class = ClassUnresolved
		it.Reason = "unparseable_avatar_url"
		return it
	}
	loc, ok := e.resolver.Resolve(raw)
	if !ok {
		// Absolute URLs that match no configured authority are demonstrably
		// external (Google CDN, Gravatar, ...). Relative non-/uploads paths
		// are not ours either but rarer — still foreign, still skipped.
		it.Class = ClassForeign
		it.Reason = "external_url"
		return it
	}
	it.Storage = loc.Backend
	it.Bucket = loc.Bucket
	it.ObjectKey = loc.Key

	segs := strings.Split(loc.Key, "/")
	if len(segs) < 3 || segs[0] != "avatars" {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return it
	}
	if segs[1] != r.ID {
		it.Class = ClassHeld
		it.Reason = "avatar_user_mismatch"
		return it
	}
	if i := strings.LastIndex(loc.Key, "/"); i >= 0 {
		it.Filename = loc.Key[i+1:]
	}
	it.Class = ClassVerified
	return it
}
