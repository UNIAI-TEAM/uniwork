package backfill

import (
	"context"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M5: meeting_recordings.file_url is the egress-written locator; the tenant
// derives meetings -> workspaces -> organizations. A row whose meeting or
// workspace no longer resolves loses its tenant proof and is unresolved.
func (e *Engine) scanMeetingRecordings(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanMeetingRecordings(ctx, db.FileBackfillScanMeetingRecordingsParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		next = r.ID
		it := Item{
			Cohort:         CohortMeetingRecordings,
			SourceTable:    "meeting_recordings",
			SourceID:       r.ID,
			Purpose:        "meeting_recording",
			Claimed:        true,
			RawLocator:     r.FileUrl.String,
			OrganizationID: r.MeetingOrganizationID.String,
			WorkspaceID:    r.MeetingWorkspaceID.String,
			ActorID:        r.StartedBy,
			ActorKind:      "human",
		}
		if r.FileID.Valid && r.FileID.String != "" {
			it.Class = ClassAlreadyApplied
			it.FileID = r.FileID.String
			items = append(items, it)
			continue
		}
		if it.OrganizationID == "" {
			it.Class = ClassUnresolved
			it.Reason = "tenant_missing"
			items = append(items, it)
			continue
		}
		it = e.resolveRecordingURL(it)
		if it.Class == ClassVerified {
			it = checkMeetingRecordingKey(it)
		}
		items = append(items, it)
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

// M6: chat_voice_recordings.file_url; organization_id and workspace_id are on
// the row (they were copied from the room at insert time — trusted).
func (e *Engine) scanCallRecordings(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanCallRecordings(ctx, db.FileBackfillScanCallRecordingsParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		next = r.ID
		it := Item{
			Cohort:         CohortCallRecordings,
			SourceTable:    "chat_voice_recordings",
			SourceID:       r.ID,
			Purpose:        "chat_call_recording",
			Claimed:        true,
			RawLocator:     r.FileUrl.String,
			OrganizationID: r.OrganizationID,
			WorkspaceID:    r.WorkspaceID,
			ActorID:        r.StartedBy,
			ActorKind:      "human",
		}
		if r.FileID.Valid && r.FileID.String != "" {
			it.Class = ClassAlreadyApplied
			it.FileID = r.FileID.String
			items = append(items, it)
			continue
		}
		if it.OrganizationID == "" || it.WorkspaceID == "" {
			it.Class = ClassUnresolved
			it.Reason = "tenant_missing"
			items = append(items, it)
			continue
		}
		it = e.resolveRecordingURL(it)
		if it.Class == ClassVerified {
			it = checkCallRecordingKey(it, r.RoomID)
		}
		items = append(items, it)
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

// resolveRecordingURL is shared by the three URL-bearing recording cohorts:
// resolve through configured authorities, mark foreign what is not ours.
func (e *Engine) resolveRecordingURL(it Item) Item {
	loc, ok := e.resolver.Resolve(it.RawLocator)
	if !ok {
		it.Class = ClassForeign
		it.Reason = "external_url"
		return it
	}
	it.Storage = loc.Backend
	it.Bucket = loc.Bucket
	it.ObjectKey = loc.Key
	if i := strings.LastIndex(loc.Key, "/"); i >= 0 {
		it.Filename = loc.Key[i+1:]
	}
	it.Class = ClassVerified
	return it
}

// checkMeetingRecordingKey is the M5 tenant proof: the egress minted
// meetings/<workspace>/<name>, so the embedded workspace must equal the
// meeting's — anything else is conflicting evidence, held for a human.
func checkMeetingRecordingKey(it Item) Item {
	segs := strings.Split(it.ObjectKey, "/")
	if len(segs) < 3 || segs[0] != "meetings" {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return it
	}
	if segs[1] != it.WorkspaceID {
		it.Class = ClassHeld
		it.Reason = "workspace_mismatch"
	}
	return it
}

// checkCallRecordingKey is the M6 tenant proof: chat-voice/<org>/<room>/<name>
// must agree with the row's organization and room.
func checkCallRecordingKey(it Item, roomID string) Item {
	segs := strings.Split(it.ObjectKey, "/")
	if len(segs) < 4 || segs[0] != "chat-voice" {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return it
	}
	if segs[1] != it.OrganizationID {
		it.Class = ClassHeld
		it.Reason = "organization_mismatch"
		return it
	}
	if segs[2] != roomID {
		it.Class = ClassHeld
		it.Reason = "room_mismatch"
	}
	return it
}
