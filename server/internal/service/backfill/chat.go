package backfill

import (
	"context"
	"encoding/json"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M3/M4: chat file and voice messages carry the locator as
// metadata.object_key, minted as chat/files/<org>/<room>/<name> or
// chat/voice/<org>/<room>/<name>. The verified tenant is the room's
// organization — a roomless or unanchored message is unresolved.
//
// M7: kind voice_call_log carries metadata.recording_url — a second
// reference to a call-recordings object. It dedupes onto the same files row
// as the chat_voice_recordings row through the shared locator.
func (e *Engine) scanChat(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanChatMessages(ctx, db.FileBackfillScanChatMessagesParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		items = append(items, e.classifyChatMessage(r))
		next = r.ID
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

// scanChatCallLogRefs is the call-recordings half of the chat unit — it walks
// the same messages scan and keeps only the voice_call_log items.
func (e *Engine) scanChatCallLogRefs(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	items, next, err := e.scanChat(ctx, after, limit)
	if err != nil {
		return nil, "", err
	}
	out := items[:0]
	for _, it := range items {
		if it.Cohort == CohortCallRecordings {
			out = append(out, it)
		}
	}
	return out, next, nil
}

func chatMessageMeta(raw []byte) map[string]any {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func metaString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func (e *Engine) classifyChatMessage(r db.FileBackfillScanChatMessagesRow) Item {
	cohort := CohortChatFiles
	purpose := "chat_attachment"
	keyPrefix := "chat/files/"
	if r.Kind == "voice" {
		cohort = CohortChatVoice
		purpose = "chat_voice"
		keyPrefix = "chat/voice/"
	} else if r.Kind == "voice_call_log" {
		cohort = CohortCallRecordings
		purpose = "chat_call_recording"
	}

	// The room is the only tenant anchor (spec M3/M4): a message on a room
	// with no organization, or on a missing room, cannot prove its key.
	org := ""
	if r.RoomOrganizationID.Valid {
		org = r.RoomOrganizationID.String
	}
	ws := ""
	if r.RoomWorkspaceID.Valid {
		ws = r.RoomWorkspaceID.String
	} else {
		ws = r.WorkspaceID
	}

	it := Item{
		Cohort:         cohort,
		SourceTable:    "chat_messages",
		SourceID:       r.ID,
		OrganizationID: org,
		WorkspaceID:    ws,
		Purpose:        purpose,
		Claimed:        true,
		ActorID:        r.SenderID,
		ActorKind:      r.SenderKind,
	}

	meta := chatMessageMeta(r.Metadata)

	// A file_id-bearing row with no locator in metadata is an FS-native
	// write (metadata.file_id, never object_key/recording_url) — the applied
	// state, with nothing to reconcile. Unparseable metadata cannot prove
	// that absence, so it classifies normally below.
	if meta != nil && r.FileID.Valid && r.FileID.String != "" {
		locator := metaString(meta, "object_key")
		if r.Kind == "voice_call_log" {
			locator = metaString(meta, "recording_url")
		}
		if locator == "" {
			it.Class, it.FileID = ClassAlreadyApplied, r.FileID.String
			return it
		}
	}
	if org == "" {
		it.Class = ClassUnresolved
		it.Reason = "room_tenant_missing"
		return finishItem(it, r.FileID)
	}

	if meta == nil {
		it.Class = ClassUnresolved
		it.Reason = "unparseable_metadata"
		return finishItem(it, r.FileID)
	}

	if r.Kind == "voice_call_log" {
		return finishItem(e.classifyCallLogRef(it, meta, r.RoomID), r.FileID)
	}

	key := metaString(meta, "object_key")
	if key == "" {
		it.Class = ClassUnresolved
		it.Reason = "no_locator"
		return finishItem(it, r.FileID)
	}
	it.ObjectKey = key
	it.RawLocator = key
	if fn := metaString(meta, "filename"); fn != "" {
		it.Filename = fn
	}
	if ct := metaString(meta, "content_type"); ct != "" {
		it.ContentType = ct
	}
	if sz, ok := meta["size_bytes"].(float64); ok {
		it.SizeBytes = int64(sz)
	}

	// Key cross-check: chat/files|<org>|<room>|<name> must agree with the
	// room evidence; a disagreement is conflicting data, held for a human.
	segs := strings.Split(key, "/")
	if len(segs) < 4 || segs[0]+"/"+segs[1]+"/" != keyPrefix {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return finishItem(it, r.FileID)
	}
	if segs[2] != org {
		it.Class = ClassHeld
		it.Reason = "organization_mismatch"
		return finishItem(it, r.FileID)
	}
	if segs[3] != r.RoomID {
		it.Class = ClassHeld
		it.Reason = "room_mismatch"
		return finishItem(it, r.FileID)
	}
	it.Class = ClassVerified
	return finishItem(it, r.FileID)
}

// classifyCallLogRef resolves the voice_call_log's recording_url through the
// configured authorities. It is one more reference to the object a
// chat_voice_recordings row names; the shared-locator pass merges them.
func (e *Engine) classifyCallLogRef(it Item, meta map[string]any, roomID string) Item {
	raw := metaString(meta, "recording_url")
	if raw == "" {
		it.Class = ClassUnresolved
		it.Reason = "no_locator"
		return it
	}
	it.RawLocator = raw
	loc, ok := e.resolver.Resolve(raw)
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
	// Same tenant proof as the recordings row: chat-voice/<org>/<room>/.
	return checkCallRecordingKey(it, roomID)
}

// reconcileCallLogRefs applies the M7 rule after scanning: a voice_call_log
// reference verifies only when a chat_voice_recordings row names the same
// locator. A resolved URL with no recording row is unresolved, not applied —
// the row is the tenant evidence, the URL alone is not.
func reconcileCallLogRefs(items []Item) []Item {
	have := map[string]bool{}
	for _, it := range items {
		if it.SourceTable == "chat_voice_recordings" && it.Class == ClassVerified {
			have[it.locatorID()] = true
		}
	}
	for i := range items {
		it := &items[i]
		if it.SourceTable == "chat_messages" && it.Class == ClassVerified && !have[it.locatorID()] {
			it.Class = ClassUnresolved
			it.Reason = "recording_row_missing"
		}
	}
	return items
}
