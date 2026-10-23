package service

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's meeting write tools (spec P3, R4): prepare reads and rates, apply
// runs the MCP connector's own write method as the asker, and each leaves the
// inverse that puts things back.

// askMeetingGuard reads a refusal of the guard (the meeting is gone, changed, in
// another state, or the asker may no longer run it) as undo_unavailable.
func askMeetingGuard(err error) error {
	if codedIs(err, "invalid_meeting_state") || codedIs(err, "not_meeting_host") || codedIs(err, "cannot_remove_current_host") {
		return errAskUndoUnavailable
	}
	return askUndoGuard(err)
}

func init() {
	askInverses["cancel_meeting"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var in mcpCancelMeetingIn
		if err := decodeInto(args, &in); err != nil {
			return err
		}
		v, err := mcpVersion(in.Revision)
		if err != nil {
			return err
		}
		return askMeetingGuard(s.meetings.CancelAt(ctx, p.UserID, in.MeetingID, "", v))
	}
	askInverses["restore_meeting"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var in mcpRestoreMeetingIn
		if err := decodeInto(args, &in); err != nil {
			return err
		}
		v, err := mcpVersion(in.Revision)
		if err != nil {
			return err
		}
		_, err = s.meetings.Restore(ctx, p.UserID, in.MeetingID, &v) // refuses a meeting whose end has passed
		return askMeetingGuard(err)
	}
	askInverses["update_meeting"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		if s.reads == nil {
			return errAskReadsNotWired
		}
		var in mcpUpdateMeetingIn
		if err := decodeInto(args, &in); err != nil {
			return err
		}
		_, err := s.reads.UpdateMeeting(ctx, p, in)
		return askMeetingGuard(err)
	}
	// shortcut: RemoveParticipant takes no version, so an edit made to the meeting
	// since apply is not detected. Removal is idempotent (someone already gone is
	// skipped) and touches only the people this invite added. Upgrade when it takes one.
	askInverses["remove_meeting_participants"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			MeetingID string   `json:"meeting_id"`
			UserIDs   []string `json:"user_ids"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		rows, err := s.meetings.ListParticipants(ctx, p.UserID, "", a.MeetingID)
		if err != nil {
			return askMeetingGuard(err)
		}
		for _, r := range rows {
			if r.Status == ParticipantActive && r.UserID.Valid && slices.Contains(a.UserIDs, r.UserID.String) {
				if err := s.meetings.RemoveParticipant(ctx, p.UserID, a.MeetingID, r.ID); err != nil {
					return askMeetingGuard(err)
				}
			}
		}
		return nil
	}
}

func (s *AskUNIService) askMeetingTools() []askWriteTool {
	tool := func(name, desc, undo string, destructive bool, schema json.RawMessage) ai.Tool {
		return ai.Tool{Name: name, Description: desc, Kind: ai.ToolWrite, Risk: ai.RiskMedium, Destructive: destructive, Undo: undo, Schema: askToolSchema(schema, 10)}
	}
	return []askWriteTool{
		{
			Tool:    tool("schedule_meeting", "Proposes a new meeting hosted by the asker, with up to 10 attendees. Everyone in the workspace sees it; no one is notified, the attendees included.", "the asker cancels the meeting", false, mcpSchemaScheduleMeeting),
			prepare: s.prepareScheduleMeeting, apply: s.applyScheduleMeeting, inverse: "cancel_meeting",
		},
		{
			Tool:    tool("update_meeting", "Proposes changes to one meeting: omitted fields stay, null clears the project. Everyone in the workspace sees the change; no one is notified.", "the asker puts the old values back", true, mcpSchemaUpdateMeeting),
			prepare: s.prepareUpdateMeeting, apply: s.applyUpdateMeeting, inverse: "update_meeting",
		},
		{
			Tool:    tool("invite_to_meeting", "Proposes inviting up to 10 workspace members to a meeting. Each person invited gets an in-app notification, unless they turned that kind off.", "the asker removes the people this invited", false, mcpSchemaInviteToMeeting),
			prepare: s.prepareInviteToMeeting, apply: s.applyInviteToMeeting, inverse: "remove_meeting_participants",
		},
		{
			Tool:    tool("cancel_meeting", "Proposes cancelling a scheduled meeting. Everyone in the workspace sees it cancelled; no one is notified.", "the asker restores the meeting while its end is ahead", true, mcpSchemaCancelMeeting),
			prepare: s.prepareCancelMeeting, apply: s.applyCancelMeeting, inverse: "restore_meeting",
		},
		{
			Tool:    tool("restore_meeting", "Proposes bringing a cancelled meeting back to scheduled, only while its end is ahead. Everyone in the workspace sees it; no one is notified.", "the asker cancels the meeting again", false, mcpSchemaRestoreMeeting),
			prepare: s.prepareRestoreMeeting, apply: s.applyRestoreMeeting, inverse: "cancel_meeting",
		},
	}
}

// askMeetingTarget reads the meeting a row acts on. A meeting made earlier this
// turn ({{row:N.id}}) has nothing to read: the card shows the title of its row,
// and apply reads the real one.
func (s *AskUNIService) askMeetingTarget(ctx context.Context, tc ai.ToolContext, id, projectID string, earlier []askDraftRow) (before db.Meeting, target AskContextRef, refs []int, isRef bool, err error) {
	if s.reads == nil {
		return before, target, nil, false, errAskReadsNotWired
	}
	refs, byField, err := askRowRefs(earlier, askIDFields["update_meeting"].Refs, map[string]string{"meeting_id": id, "project_id": projectID})
	if err != nil {
		return before, target, nil, false, err
	}
	target = AskContextRef{Kind: "meeting"}
	if _, isRef = byField["meeting_id"]; isRef {
		n, _ := askRowRef(id)
		target.Title = earlier[n-1].Preview.Target.Title
		return before, target, refs, true, nil
	}
	if before, err = s.reads.meeting(ctx, principalOf(tc), tc.WorkspaceID, id); err != nil {
		return before, target, nil, false, err
	}
	target.ID, target.Title = before.ID, before.Title
	return before, target, refs, false, nil
}

// askMeetingClash refuses a row on a meeting an earlier row of this turn
// cancels: it would fail at apply. A row that carries a revision after another
// row on the same meeting is the loop's to refuse (askTargetClash); this also
// covers the rows that carry none (an invite) and a meeting made this turn,
// which a {{row:N.id}} names.
func askMeetingClash(meetingID string, earlier []askDraftRow) error {
	for i, r := range earlier {
		var a struct {
			MeetingID string `json:"meeting_id"`
		}
		if r.Tool == "cancel_meeting" && json.Unmarshal(r.Args, &a) == nil && a.MeetingID == meetingID {
			return McpInvalidArgs{Msg: fmt.Sprintf("row %d of this turn already cancels this meeting; make one change per meeting per turn", i+1)}
		}
	}
	return nil
}

func askMeetingPeople(field string, ids []string) ([]string, error) {
	if len(ids) > 10 {
		return nil, McpInvalidArgs{Msg: field + " holds at most 10 people per proposal"}
	}
	return mcpIDList(field, ids)
}

func (s *AskUNIService) prepareScheduleMeeting(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpScheduleMeetingIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	people, err := askMeetingPeople("attendee_ids", in.AttendeeIDs)
	if err != nil {
		return askDraftRow{}, err
	}
	if title := strings.TrimSpace(in.Title); title == "" || utf8.RuneCountInString(title) > mcpMaxMeetingTitleRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxMeetingTitleRunes)}
	}
	if utf8.RuneCountInString(in.Description) > mcpMaxItemRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: fmt.Sprintf("description holds at most %d characters here", mcpMaxItemRunes)}
	}
	start, err := mcpParseTime("starts_at", in.StartsAt)
	if err != nil {
		return askDraftRow{}, err
	}
	end, err := mcpParseTime("ends_at", in.EndsAt)
	if err != nil {
		return askDraftRow{}, err
	}
	if !end.After(start) {
		return askDraftRow{}, McpInvalidArgs{Msg: "ends_at must be after starts_at"}
	}
	if _, err := mcpID("project_id", in.ProjectID); err != nil {
		return askDraftRow{}, err
	}
	tz, err := s.reads.timezoneOf(ctx, tc.ActorID, in.Timezone)
	if err != nil {
		return askDraftRow{}, err
	}
	refs, _, err := askRowRefs(earlier, askIDFields["schedule_meeting"].Refs, map[string]string{"project_id": in.ProjectID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	for _, id := range people {
		if len(n.members) > 0 && n.members[id] == "" {
			return askDraftRow{}, McpInvalidArgs{Msg: "attendee_ids holds someone " + mcpNotMember}
		}
	}
	fields := []AskProposalField{
		{Field: "title", Type: "text", To: strings.TrimSpace(in.Title)},
		{Field: "starts_at", Type: "datetime", To: start.UTC().Format(time.RFC3339)},
		{Field: "ends_at", Type: "datetime", To: end.UTC().Format(time.RFC3339)},
		{Field: "timezone", Type: "text", To: tz},
	}
	if in.Description != "" {
		fields = append(fields, AskProposalField{Field: "description", Type: "markdown", To: in.Description})
	}
	if len(people) > 0 {
		names := make([]string, 0, len(people))
		for _, id := range people {
			names = append(names, orID(n.members[id], id))
		}
		fields = append(fields, AskProposalField{Field: "attendee_ids", Type: "person", To: names})
	}
	if in.ProjectID != "" {
		fields = append(fields, AskProposalField{Field: "project_id", Type: "project", To: n.project(in.ProjectID)})
	}
	return askDraftRow{
		Tool: "schedule_meeting", Args: stored, TargetKind: "meeting", Level: askLevel2,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "meeting", Title: strings.TrimSpace(in.Title)}, Fields: fields, Refs: refs,
			Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}}, // scheduling records no invitation event
		},
	}, nil
}

func (s *AskUNIService) prepareUpdateMeeting(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpUpdateMeetingIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	one := int64(1)
	in.Revision = &one // the server reads the real one below
	upd, err := in.parse()
	if err != nil {
		return askDraftRow{}, err
	}
	before, target, refs, isRef, err := s.askMeetingTarget(ctx, tc, in.MeetingID, optValue(in.ProjectID), earlier)
	if err != nil {
		return askDraftRow{}, err
	}
	if err := askMeetingClash(in.MeetingID, earlier); err != nil {
		return askDraftRow{}, err
	}
	if !isRef {
		if err := mcpMeetingEditUndoable(in, before); err != nil {
			return askDraftRow{}, err
		}
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	utc := func(t time.Time) any {
		if t.IsZero() {
			return nil
		}
		return t.UTC().Format(time.RFC3339)
	}
	var fields []AskProposalField
	add := func(field, typ string, from, to any) {
		fields = append(fields, AskProposalField{Field: field, Type: typ, From: from, To: to})
	}
	if upd.Title != nil {
		add("title", "text", before.Title, *upd.Title)
	}
	if upd.Description != nil {
		add("description", "markdown", before.Description, *upd.Description)
	}
	if upd.StartsAt != nil {
		add("starts_at", "datetime", utc(before.StartsAt.Time), utc(*upd.StartsAt))
	}
	if upd.EndsAt != nil {
		add("ends_at", "datetime", utc(before.EndsAt.Time), utc(*upd.EndsAt))
	}
	if upd.Timezone != nil {
		add("timezone", "text", before.Timezone, *upd.Timezone)
	}
	if upd.ProjectID != nil {
		add("project_id", "project", n.project(before.ProjectID.String), n.project(*upd.ProjectID))
	}
	fields = slices.DeleteFunc(fields, func(f AskProposalField) bool { return fieldsEqual(f.From, f.To) })
	if len(fields) == 0 {
		return askDraftRow{}, McpInvalidArgs{Msg: "nothing to change: every field already has the value asked for"}
	}
	row := askDraftRow{
		Tool: "update_meeting", Args: stored, TargetKind: "meeting", Level: askLevel2,
		Preview: AskProposalPreview{Target: target, Fields: fields, Refs: refs, Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}}}, // meeting.updated notifies no one
	}
	if !isRef {
		rev := int64(before.Version)
		row.TargetID, row.TargetRevision = before.ID, &rev
	}
	return row, nil
}

func (s *AskUNIService) prepareInviteToMeeting(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpInviteIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if len(in.UserIDs) == 0 {
		return askDraftRow{}, McpInvalidArgs{Msg: "user_ids must hold 1-10 user_id values from list_members"}
	}
	ids, err := askMeetingPeople("user_ids", in.UserIDs)
	if err != nil {
		return askDraftRow{}, err
	}
	before, target, refs, isRef, err := s.askMeetingTarget(ctx, tc, in.MeetingID, "", earlier)
	if err != nil {
		return askDraftRow{}, err
	}
	if err := askMeetingClash(in.MeetingID, earlier); err != nil {
		return askDraftRow{}, err
	}
	if !isRef && before.Status != MeetingScheduled && before.Status != MeetingInProgress {
		return askDraftRow{}, McpToolError{Code: "invalid_meeting_state", Msg: "only a scheduled or running meeting takes invitations"}
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	var named []string
	var told []string // only a workspace member is invited, and so notified
	for _, id := range ids {
		named = append(named, orID(n.members[id], id))
		if len(n.members) == 0 || n.members[id] != "" {
			told = append(told, id)
		}
	}
	row := askDraftRow{
		Tool: "invite_to_meeting", Args: stored, TargetKind: "meeting", Level: askLevel2,
		Preview: AskProposalPreview{
			Target: target, Fields: []AskProposalField{{Field: "user_ids", Type: "person", To: named}}, Refs: refs,
			Audience: AskAudience{Visibility: "meeting", Notifies: n.notified(told...)},
		},
	}
	if !isRef {
		row.TargetID = before.ID
	}
	return row, nil
}

// prepareMeetingState is cancel_meeting and restore_meeting: one meeting, one
// state change, nobody notified.
func (s *AskUNIService) prepareMeetingState(ctx context.Context, tc ai.ToolContext, tool string, args json.RawMessage, meetingID string, earlier []askDraftRow, reason string) (askDraftRow, error) {
	before, target, refs, isRef, err := s.askMeetingTarget(ctx, tc, meetingID, "", earlier)
	if err != nil {
		return askDraftRow{}, err
	}
	if err := askMeetingClash(meetingID, earlier); err != nil {
		return askDraftRow{}, err
	}
	if !isRef {
		switch {
		case tool == "cancel_meeting" && before.Status != MeetingScheduled:
			return askDraftRow{}, McpToolError{Code: "invalid_meeting_state", Msg: "only a scheduled meeting can be cancelled"}
		case tool == "restore_meeting" && (before.Status != MeetingCanceled || !before.EndsAt.Time.After(time.Now())):
			return askDraftRow{}, McpToolError{Code: "invalid_meeting_state", Msg: "only a cancelled meeting whose end is still ahead can be restored"}
		}
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	to := MeetingCanceled
	if tool == "restore_meeting" {
		to = MeetingScheduled
	}
	fields := []AskProposalField{{Field: "status", Type: "enum", From: nilIfEmpty(before.Status), To: to}}
	row := askDraftRow{
		Tool: tool, Args: stored, TargetKind: "meeting", Level: askLevel2,
		Preview: AskProposalPreview{Target: target, Fields: fields, Body: reason, Refs: refs, Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}}},
	}
	if !isRef {
		rev := int64(before.Version)
		row.TargetID, row.TargetRevision = before.ID, &rev
	}
	return row, nil
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *AskUNIService) prepareCancelMeeting(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpCancelMeetingIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if utf8.RuneCountInString(in.Reason) > mcpMaxCancelReasonRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: fmt.Sprintf("reason holds at most %d characters", mcpMaxCancelReasonRunes)}
	}
	return s.prepareMeetingState(ctx, tc, "cancel_meeting", args, in.MeetingID, earlier, in.Reason)
}

func (s *AskUNIService) prepareRestoreMeeting(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpRestoreMeetingIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	return s.prepareMeetingState(ctx, tc, "restore_meeting", args, in.MeetingID, earlier, "")
}

func (s *AskUNIService) applyScheduleMeeting(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpScheduleMeetingIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.ScheduleMeeting(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	m, ok := res.Item.(McpMeeting)
	if !ok || m.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = m.ID, m.URL
	return out, askInverseOrNote(&out, "cancel_meeting", map[string]any{"workspace_id": in.WorkspaceID, "meeting_id": m.ID, "revision": res.Revision}), nil
}

func (s *AskUNIService) applyUpdateMeeting(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpUpdateMeetingIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	before, err := s.reads.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// A row that waited for {{row:N.id}} has no revision of its own: the meeting
	// was made this turn, so the one just read is the one to write against.
	rev := int64(before.Version)
	in.Revision = &rev
	if row.TargetRevision != nil {
		in.Revision = row.TargetRevision
	}
	res, err := s.reads.UpdateMeeting(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: before.ID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	if len(res.Changes) == 0 {
		return out, nil, nil // nothing changed: nothing to undo
	}
	if m, ok := res.Item.(McpMeeting); ok {
		out.Href = m.URL
	}
	// The old values come from the meeting as read, uncut: Changes cuts long text.
	back := map[string]any{"workspace_id": in.WorkspaceID, "meeting_id": before.ID, "revision": res.Revision}
	for _, c := range res.Changes {
		switch c.Field {
		case "title":
			back["title"] = before.Title
		case "description":
			back["description"] = before.Description // "" clears it
		case "starts_at":
			back["starts_at"] = before.StartsAt.Time.UTC().Format(time.RFC3339Nano) // nanoseconds: the stored instant, exactly
		case "ends_at":
			back["ends_at"] = before.EndsAt.Time.UTC().Format(time.RFC3339Nano)
		case "timezone":
			back["timezone"] = before.Timezone
		case "project_id":
			back["project_id"] = mcpNullable(before.ProjectID.String)
		}
	}
	return out, askInverseOrNote(&out, "update_meeting", back), nil
}

func (s *AskUNIService) applyInviteToMeeting(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpInviteIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.InviteToMeeting(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: in.MeetingID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	ir, ok := res.Item.(McpInviteResult)
	if !ok {
		askLoseUndo(&out)
		return out, nil, nil
	}
	if ir.Meeting != nil {
		out.Href = ir.Meeting.URL
	}
	// Only a person this call added is removed again; one already on the meeting stays.
	var invited []string
	for _, o := range ir.Invites {
		if o.Result == "invited" {
			invited = append(invited, o.UserID)
		}
	}
	if len(invited) < len(ir.Invites) {
		if out.Note != "" {
			out.Note += "; "
		}
		out.Note += fmt.Sprintf("invited %d of %d; the others were already attending or could not be invited", len(invited), len(ir.Invites))
	}
	if len(invited) == 0 {
		return out, nil, nil
	}
	return out, askInverseOrNote(&out, "remove_meeting_participants", map[string]any{"workspace_id": in.WorkspaceID, "meeting_id": in.MeetingID, "user_ids": invited}), nil
}

// applyMeetingState is cancel_meeting and restore_meeting: it reads the meeting,
// writes against its revision, and names the inverse unless the write left none.
func (s *AskUNIService) applyMeetingState(ctx context.Context, p McpPrincipal, row askDraftRow, cancel bool) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpCancelMeetingIn // restore's arguments are the same without a reason
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	before, err := s.reads.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// A row that waited for {{row:N.id}} has no revision of its own: the meeting
	// was made this turn, so the one just read is the one to write against.
	rev := int64(before.Version)
	if row.TargetRevision != nil {
		rev = *row.TargetRevision
	}
	in.Revision = &rev
	var res McpWriteResult
	if cancel {
		res, err = s.reads.CancelMeeting(ctx, p, in)
	} else {
		res, err = s.reads.RestoreMeeting(ctx, p, mcpRestoreMeetingIn{WorkspaceID: in.WorkspaceID, MeetingID: in.MeetingID, Revision: in.Revision})
	}
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: before.ID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	m, ok := res.Item.(McpMeeting)
	if !ok || res.Revision == 0 { // committed, but the read-back failed: the version to guard the inverse with is unknown
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.Href = m.URL
	back := map[string]any{"workspace_id": in.WorkspaceID, "meeting_id": before.ID, "revision": res.Revision}
	if !cancel {
		return out, askInverseOrNote(&out, "cancel_meeting", back), nil
	}
	if !before.EndsAt.Time.After(time.Now()) {
		return out, nil, nil // its end has passed: the service refuses a restore, and Note says so
	}
	return out, askInverseOrNote(&out, "restore_meeting", back), nil
}

func (s *AskUNIService) applyCancelMeeting(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	return s.applyMeetingState(ctx, p, row, true)
}

func (s *AskUNIService) applyRestoreMeeting(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	return s.applyMeetingState(ctx, p, row, false)
}
