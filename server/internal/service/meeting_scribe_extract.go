package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Live action items (UNI-2025, scribe spec §4.4): while the meeting runs the
// agent asks on its cadence, the server reads the segments after the
// meeting's extract cursor and stores what the model proposes as LIVE items.

const (
	// liveItemsPerHour caps the extractions of a run: 20 for each hour it
	// has been open, a backstop to the agent's own sliding-hour cap.
	liveItemsPerHour = 20
	// One extraction reads at most this many new segments and runes; the
	// rest waits for the next call.
	liveItemsMaxSegments = 200
	liveItemsMaxRunes    = 20000
)

// Why an extraction stored nothing without failing (the SDO's skipped).
const (
	LiveItemsSkipFeature = "unavailable" // flag off, no meeting.ai_summary, AI not configured
	LiveItemsSkipCapped  = "capped"
	LiveItemsSkipQuota   = "ai_quota_exceeded"
	LiveItemsSkipRace    = "concurrent"
)

// LiveItemsResult answers POST /agent/extract.
type LiveItemsResult struct {
	Created int
	Skipped string
}

// AgentExtract reads the transcript after the cursor, asks the gateway
// (meeting_live_items, system actor meeting_scribe) and stores the new items
// with their audit rows, action_item.created events and the moved cursor in
// one transaction. What the organization may not use, or has no AI credit
// left for, is skipped silently and counted.
func (s *MeetingService) AgentExtract(ctx context.Context, c meetings.AgentClaims) (LiveItemsResult, error) {
	m, run, err := s.agentRun(ctx, c)
	if err != nil {
		return LiveItemsResult{}, err
	}
	draining := m.Status == MeetingEnded && m.ActualEndAt.Valid && time.Since(m.ActualEndAt.Time) <= agentDrainWindow
	if m.Status != MeetingInProgress && !draining {
		return LiveItemsResult{}, errInvalidState()
	}
	if !s.scribeFlagOn(ctx, m.OrganizationID) || !s.AI.Enabled() || s.ent.Can(ctx, m.OrganizationID, FeatureMeetingAISummary) != nil {
		s.count("live_items_unavailable")
		return LiveItemsResult{Skipped: LiveItemsSkipFeature}, nil
	}
	if run.Extracts >= liveItemsPerHour*(int32(time.Since(run.CreatedAt.Time)/time.Hour)+1) {
		s.count("live_items_capped")
		return LiveItemsResult{Skipped: LiveItemsSkipCapped}, nil
	}
	cursor, err := s.q.MeetingExtractCursor(ctx, m.ID)
	if err != nil {
		return LiveItemsResult{}, err
	}
	segs, err := s.q.ListSegmentsAfterExtractCursor(ctx, db.ListSegmentsAfterExtractCursorParams{
		MeetingID: m.ID, Cursor: cursor, RowLimit: liveItemsMaxSegments,
	})
	if err != nil || len(segs) == 0 {
		return LiveItemsResult{}, err
	}
	labels := newSummaryLabels()
	lines, runes := make([]ai.TranscriptLine, 0, len(segs)), 0
	for _, sg := range segs {
		runes += utf8.RuneCountInString(sg.SpeakerName) + utf8.RuneCountInString(sg.Text) + 3
		if len(lines) > 0 && runes > liveItemsMaxRunes {
			break
		}
		lines = append(lines, ai.TranscriptLine{Label: labels.label(EvidenceSegment, sg.ID), Speaker: sg.SpeakerName, Text: sg.Text})
	}
	last := segs[len(lines)-1].ID
	existing, err := s.q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return LiveItemsResult{}, err
	}
	titles := make([]string, 0, len(existing))
	for _, r := range existing {
		titles = append(titles, capRunes(r.MeetingActionItem.Title, summaryExistingItemRunes, "…"))
	}
	if len(titles) > summaryExistingItems {
		titles = titles[len(titles)-summaryExistingItems:]
	}
	resp, err := s.AI.Complete(ctx, ai.Request{
		Actor: scribeActor, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Capability: ai.CapMeetingLiveItems, PromptID: ai.PromptMeetingLiveItems,
		Vars: map[string]any{"title": m.Title, "locale": scribeLocale, "transcript": lines, "existing_action_items": titles},
	})
	if errors.Is(err, ai.ErrQuotaExceeded) {
		s.count("live_items_quota")
		return LiveItemsResult{Skipped: LiveItemsSkipQuota}, nil
	}
	if err != nil {
		s.count("live_items_failed")
		return LiveItemsResult{}, err
	}
	// A billed answer that does not parse proposes nothing; the cursor still
	// moves, so the same lines are not paid for again (the summary reads them).
	proposed, err := ai.ParseLiveItemsJSON(resp.Text)
	if err != nil {
		s.count("live_items_failed")
		slog.Warn("meeting scribe: live items output invalid", "meeting_id", m.ID, "usage_event_id", resp.UsageEventID, "err", err)
	}
	created, err := s.storeLiveItems(ctx, m, run, last, proposed, labels)
	if err != nil {
		return LiveItemsResult{}, err
	}
	if created < 0 {
		return LiveItemsResult{Skipped: LiveItemsSkipRace}, nil
	}
	s.count("live_items_extracted")
	return LiveItemsResult{Created: created}, nil
}

// storeLiveItems moves the cursor and inserts the new items under the
// meeting's action-item lock, skipping a title any item of the meeting
// already has. -1 means another extraction of the run won the cursor.
func (s *MeetingService) storeLiveItems(ctx context.Context, m db.Meeting, run db.MeetingScribeRun, last string, proposed []ai.ActionItem, labels *summaryLabels) (int, error) {
	created := 0
	err := s.inTx(ctx, func(q *db.Queries) error {
		if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
			return err
		}
		n, err := q.AdvanceScribeExtractCursor(ctx, db.AdvanceScribeExtractCursorParams{ID: run.ID, Cursor: last, Extracts: run.Extracts})
		if err != nil {
			return err
		}
		if n == 0 {
			created = -1
			return nil
		}
		rows, err := q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
		if err != nil {
			return err
		}
		seen := make(map[string]struct{}, len(rows)+len(proposed))
		for _, r := range rows {
			seen[normalizeTaskTitle(r.MeetingActionItem.Title)] = struct{}{}
		}
		position, err := q.NextMeetingActionItemPosition(ctx, db.NextMeetingActionItemPositionParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
		if err != nil {
			return err
		}
		for _, it := range proposed {
			title := strings.TrimSpace(it.Title)
			key := normalizeTaskTitle(title)
			if _, dup := seen[key]; dup || key == "" {
				continue
			}
			seen[key] = struct{}{}
			refs, _ := labels.resolve(it.Evidence)
			evidence, err := json.Marshal(refs)
			if err != nil {
				return err
			}
			row, err := q.InsertMeetingActionItem(ctx, db.InsertMeetingActionItemParams{
				ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
				Source: ActionItemSourceLive, Position: position, Title: title,
				OwnerText: strings.TrimSpace(it.Owner), DueText: strings.TrimSpace(it.Due), Evidence: string(evidence),
				CreatedBy: scribeActor.ID, CreatedByKind: string(scribeActor.Kind),
			})
			if err != nil {
				return err
			}
			if err := s.recordActionItem(ctx, q, m, scribeActor, audit.ActionMeetingActionItemCreated, "action_item.created", row.ID, nil); err != nil {
				return err
			}
			position++
			created++
		}
		return nil
	})
	return created, err
}
