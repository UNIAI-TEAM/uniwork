package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The helpers of MeetingService.Summarize (UNI-1853): the single-flight lease,
// the one transaction that stores a summary with its audit row and event, the
// notes budget, and the mapping of every failure to a fixed refusal.

const (
	// transcriptSegmentRunes caps one transcript line or in-room chat message,
	// counted in characters so a cut never splits a UTF-8 sequence.
	transcriptSegmentRunes = 4000

	// Notes come out of the transcript budget: they take what they need up to
	// a quarter of the smallest one, and each note is clipped first so one pasted wall of
	// text cannot push every other note out of the window.
	summaryNotesRunes = summaryTranscriptRunes / 4
	summaryNoteRunes  = 4000

	// The handled action items the prompt lists (spec §7.1) are bounded so
	// a long-running meeting's backlog cannot crowd out its transcript.
	summaryExistingItems     = 100
	summaryExistingItemRunes = 300
	// The pending live items a summary may refine (benchmark #21); more
	// than this stay as they are and are skipped as repeats by title.
	summaryDraftItems            = 50
	summaryDraftDescriptionRunes = 600
	// summaryEvidenceRefs bounds a refined item's merged evidence, like the
	// model's own (ai.maxEvidenceLabels).
	summaryEvidenceRefs = 10

	// summaryRunLease is how long a claimed run keeps other runs of its
	// meeting out at the smallest budget (summaryBudget grows it). It is also
	// how long a meeting stays refused after the node running its summary
	// died. A run's own deadline is its lease minus a minute, so a live run
	// always stores (or fails) and gives its lease back before the lease
	// expires: a second run never starts while the first can still pay.
	summaryRunLease = 3 * time.Minute
	// summaryStoreTimeout bounds storing a summary the model already answered
	// (and was billed for); the store runs detached from the request.
	summaryStoreTimeout = 15 * time.Second
	// summaryReleaseTimeout bounds giving the lease back; past it the lease
	// is left to expire.
	summaryReleaseTimeout = 5 * time.Second
)

// Reasons label uniwork_meeting_summary_errors_total and the failure log.
const (
	summaryReasonNotConfigured = "not_configured"
	summaryReasonQuota         = "quota"
	summaryReasonRateLimited   = "rate_limited"
	summaryReasonTimeout       = "timeout"
	summaryReasonProvider      = "provider"
	summaryReasonRefused       = "refused"
	summaryReasonGateway       = "gateway"
	summaryReasonParse         = "parse"
	summaryReasonEmpty         = "empty"
	summaryReasonStore         = "store"
)

// The refusals Summarize answers with. The message is fixed and never quotes
// the cause; the client translates the code (UNI-1853 M13).
func errSummaryNotConfigured() error {
	return coded(http.StatusServiceUnavailable, "ai_not_configured", "AI chưa được cấu hình trên server.")
}

func errSummaryNoSource() error {
	return coded(http.StatusConflict, "summary_no_source", "Chưa có transcript, ghi chú, chat hay kết quả biểu quyết nào để tóm tắt.")
}

func errSummaryInProgress() error {
	return coded(http.StatusConflict, "summary_in_progress", "Tóm tắt của cuộc họp này đang được tạo. Thử lại sau ít phút.")
}

func errSummaryFailed() error {
	return coded(http.StatusBadGateway, "ai_failed", "AI không tạo được tóm tắt. Thử lại sau.")
}

func errSummaryTimeout() error {
	return coded(http.StatusGatewayTimeout, "ai_timeout", "AI trả lời quá lâu. Thử lại sau.")
}

// errSummaryEmptyOutput is a model answer with no text at all.
var errSummaryEmptyOutput = errors.New("meetings: summary output is empty")

// summaryStepError is a failure after the gateway answered, so after the
// call was billed: the reason labels it, err is the cause for the log.
type summaryStepError struct {
	reason string
	err    error
}

func (e summaryStepError) Error() string { return e.reason + ": " + e.err.Error() }
func (e summaryStepError) Unwrap() error { return e.err }

// summaryFailure turns a failed run into the refusal the client sees, counts
// it, and logs the cause with the ids that tie it to its usage row. A billed
// call that left no summary (truncated, parse, empty, store) is logged at
// Warn with the usage_event_id, so an orphaned usage row can be traced
// (UNI-1853 L2); a gateway refusal names its own row (summaryUsageID).
func (s *MeetingService) summaryFailure(meetingID, usageEventID string, err error) error {
	reason, out := classifySummaryFailure(err)
	s.summaryErrorCount(reason)
	slog.Warn("meetings: summary failed", "meeting_id", meetingID, "usage_event_id", summaryUsageID(usageEventID, err),
		"reason", reason, "err", err)
	return summaryRunFailure{reason: reason, err: out}
}

// summaryRunFailure is the refusal of a failed run with the reason it was
// counted under: the auto summary retries the reasons that pass
// (summaryReasonTransient) instead of giving up. It unwraps to the refusal,
// so callers and the handler see the CodedError as before.
type summaryRunFailure struct {
	reason string
	err    error
}

func (e summaryRunFailure) Error() string { return e.err.Error() }
func (e summaryRunFailure) Unwrap() error { return e.err }

// summaryReasonTransient are the failures a later run can expect not to
// meet: a rate limit, a timeout, a provider or network error. A billed answer
// that did not parse, a refusal, a quota or a missing model are not.
var summaryReasonTransient = map[string]bool{
	summaryReasonRateLimited: true, summaryReasonTimeout: true, summaryReasonProvider: true, summaryReasonGateway: true,
}

// summaryUsageID is the usage row a failed run left: the one the gateway
// answered with, or the one its refusal names (timeout, vendor error,
// truncated output), "" when the call never reached the vendor.
func summaryUsageID(usageEventID string, err error) string {
	if usageEventID != "" {
		return usageEventID
	}
	var aiErr *ai.Error
	if errors.As(err, &aiErr) {
		return aiErr.UsageEventID
	}
	return ""
}

// classifySummaryFailure maps a cause to its metric reason and its refusal.
// Quota and rate limit keep the gateway's code, status and fields (the
// rate limit's retry_after among them, UNI-1853 L16); everything the model
// side did wrong is ai_failed; a store failure stays an internal error, so
// the handler answers 500 without echoing it. An answer the gateway refused
// as invalid (cut at max_tokens) was billed like any other bad output, so it
// counts as parse, not as a provider outage.
func classifySummaryFailure(err error) (string, error) {
	var step summaryStepError
	if errors.As(err, &step) {
		if step.reason == summaryReasonStore {
			return step.reason, fmt.Errorf("meetings: store summary: %w", step.err)
		}
		return step.reason, errSummaryFailed()
	}
	var aiErr *ai.Error
	if errors.As(err, &aiErr) {
		switch aiErr.Code {
		case ai.ErrDisabled.Code:
			return summaryReasonNotConfigured, errSummaryNotConfigured()
		case ai.ErrProviderTimeout.Code:
			return summaryReasonTimeout, errSummaryTimeout()
		case ai.ErrOutputInvalid.Code:
			return summaryReasonParse, errSummaryFailed()
		case ai.ErrQuotaExceeded.Code:
			return summaryReasonQuota, CodedError{Code: aiErr.Code, Status: aiErr.Status, Msg: ai.ErrQuotaExceeded.Msg, Fields: aiErr.Fields}
		case ai.ErrRateLimited.Code:
			return summaryReasonRateLimited, CodedError{Code: aiErr.Code, Status: aiErr.Status, Msg: ai.ErrRateLimited.Msg, Fields: aiErr.Fields}
		case ai.ErrProviderError.Code, ai.ErrProviderUnreachable.Code:
			return summaryReasonProvider, errSummaryFailed()
		}
		// ai_refused (billed), a forbidden tool or context, a refused key, an
		// unsupported medium: the same request meets the same no, so the auto
		// summary does not pay to ask again.
		return summaryReasonRefused, errSummaryFailed()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return summaryReasonTimeout, errSummaryTimeout()
	}
	return summaryReasonGateway, errSummaryFailed()
}

func (s *MeetingService) summaryErrorCount(reason string) {
	s.count("summary_error")
	if s.metrics != nil {
		s.metrics.IncSummaryError(reason)
	}
}

// claimSummaryRun claims the meeting's summary run lease (UNI-1853 M9): one
// row in meeting_summary_runs that expires after summaryRunLease, given back
// by release. A live lease, taken on this node or another, is 409
// summary_in_progress.
//
// Why a lease row and not a lock: MeetingService has no Redis client, and a
// process-local guard would let two API nodes pay the model twice, so the
// lease lives in the one database every node shares. A session advisory lock
// would pin a pooled connection through the whole model call while the run
// needs more connections for its reads and its store, so summaries in flight
// could starve the pool (and it breaks behind a transaction-pooling proxy).
// The claim and the release are one short statement each and hold nothing in
// between; a node that dies mid-run leaves a lease that expires on its own.
func (s *MeetingService) claimSummaryRun(ctx context.Context, m db.Meeting, lease time.Duration) (func(), error) {
	runID := util.NewID()
	_, err := s.q.ClaimMeetingSummaryRun(ctx, db.ClaimMeetingSummaryRunParams{
		OrganizationID: m.OrganizationID, MeetingID: m.ID, RunID: runID, LeaseSeconds: lease.Seconds(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errSummaryInProgress()
	}
	if err != nil {
		return nil, err
	}
	return func() {
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), summaryReleaseTimeout)
		defer cancel()
		if err := s.q.ReleaseMeetingSummaryRun(rctx, db.ReleaseMeetingSummaryRunParams{
			OrganizationID: m.OrganizationID, MeetingID: m.ID, RunID: runID,
		}); err != nil {
			slog.Warn("meetings: summary run lease not released, it expires on its own", "meeting_id", m.ID, "err", err)
		}
	}, nil
}

// storeSummary writes the summary, its action items, its meeting timeline
// row, its audit row and its summary.created event in one transaction (ADR
// 0009, ADR 0012): a summary that is stored is always audited and always
// announced, and an audit failure stores nothing.
//
// The action items follow spec §7.1 (D6): the AI items nobody has handled
// yet are replaced by the new summary's; converted, dismissed, manual and
// live items stay; a new item whose title matches one that stays (or an
// earlier one of the same answer) is skipped, so a dismissed item does not
// come back.
func (s *MeetingService) storeSummary(ctx context.Context, m db.Meeting, actor Actor, res ai.MeetingSummary, resp ai.Response, labels *summaryLabels, partial bool) (db.MeetingSummary, error) {
	dropped := 0
	points := func(in []ai.Decision) []SummaryDecision {
		out := make([]SummaryDecision, len(in))
		for i, d := range in {
			refs, n := labels.resolve(d.Evidence)
			out[i], dropped = SummaryDecision{Text: d.Text, Evidence: refs}, dropped+n
		}
		return out
	}
	topics := make([]SummaryTopic, len(res.Topics))
	for i, t := range res.Topics {
		topics[i] = SummaryTopic{Title: t.Title, Points: points(t.Points)}
		if refs, _ := labels.resolve([]string{t.StartLabel}); len(refs) == 1 && refs[0].Kind == EvidenceSegment {
			topics[i].Start = &refs[0]
		}
	}
	decisions, err := json.Marshal(points(res.Decisions))
	if err != nil {
		return db.MeetingSummary{}, err
	}
	topicsJSON, err := json.Marshal(topics)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	questions, err := json.Marshal(points(res.OpenQuestions))
	if err != nil {
		return db.MeetingSummary{}, err
	}
	rawItems, err := json.Marshal(res.ActionItems)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// A command on the meeting's action items under way (a conversion above
	// all) finishes first: it never links a task to an item replaced here.
	if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
		return db.MeetingSummary{}, err
	}
	row, err := q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, Summary: res.Summary,
		Decisions: string(decisions), ActionItems: string(rawItems), Model: resp.Model, CreatedBy: actor.ID,
		UsageEventID: strText(resp.UsageEventID), Partial: partial, CreatedByKind: string(actor.Kind),
		Topics: string(topicsJSON), OpenQuestions: string(questions),
	})
	if err != nil {
		return db.MeetingSummary{}, err
	}
	items, err := replaceSummaryActionItems(ctx, q, m, row, res.ActionItems, labels)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	// The meeting's own activity timeline still reads meeting_audit_logs; it
	// names a system run the way it names an auto-end.
	timelineActor := actor.ID
	if actor.Kind == audit.KindSystem {
		timelineActor = systemActorID
	}
	if err := s.writeAudit(ctx, q, m, "SUMMARY_CREATED", timelineActor, "", row.ID, "{}"); err != nil {
		return db.MeetingSummary{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Actor:        actor,
		Action:       audit.ActionMeetingSummaryCreated,
		ResourceType: "meeting", ResourceID: m.ID,
		Metadata: map[string]any{
			"summary_id": row.ID, "usage_event_id": resp.UsageEventID, "model": resp.Model,
			"decisions": len(res.Decisions), "action_items": len(res.ActionItems),
			"topics": len(res.Topics), "open_questions": len(res.OpenQuestions),
			"replaced_pending": items.replaced, "kept": items.kept, "skipped_duplicates": items.skipped,
			"refined_drafts":   items.refined,
			"evidence_dropped": dropped + items.evidenceDropped,
		},
	}, audit.Event{Topic: "summary.created", Payload: map[string]string{
		"meeting_id": m.ID, "summary_id": row.ID, "workspace_id": m.WorkspaceID,
	}}); err != nil {
		return db.MeetingSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingSummary{}, err
	}
	return row, nil
}

// summaryNoteLines renders the meeting's notes for the prompt as
// "Author: text", each clipped to summaryNoteRunes, and keeps what fits
// summaryNotesRunes with the same head-and-tail window as the transcript.
// Each line's Label holds its note id until Summarize labels it. It returns
// the lines and the runes they use, which the transcript's budget gives up.
func summaryNoteLines(notes []db.ListMeetingNotesRow) ([]ai.NoteLine, int) {
	lines := make([]ai.NoteLine, 0, len(notes))
	for _, n := range notes {
		body := capRunes(strings.TrimSpace(n.Body), summaryNoteRunes, "…")
		if body == "" {
			continue
		}
		if author := strings.TrimSpace(n.DisplayName); author != "" {
			body = author + ": " + body
		}
		lines = append(lines, ai.NoteLine{Label: n.ID, Text: body})
	}
	lines, _ = windowSummaryLines(lines, summaryNotesRunes,
		func(l ai.NoteLine) int { return utf8.RuneCountInString(l.Text) + 1 },
		func(n int) ai.NoteLine { return ai.NoteLine{Text: summaryOmitted(n)} })
	used := 0
	for _, l := range lines {
		used += utf8.RuneCountInString(l.Text) + 1
	}
	return lines, used
}

// summaryItemsOutcome is what storing a summary did to the meeting's items.
type summaryItemsOutcome struct{ replaced, kept, skipped, refined, evidenceDropped int }

// replaceSummaryActionItems applies spec §7.1 inside storeSummary's
// transaction, under the meeting's summary lock.
func replaceSummaryActionItems(ctx context.Context, q *db.Queries, m db.Meeting, sum db.MeetingSummary, proposed []ai.ActionItem, labels *summaryLabels) (summaryItemsOutcome, error) {
	var out summaryItemsOutcome
	replaced, err := q.DeletePendingAIMeetingActionItems(ctx, db.DeletePendingAIMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return out, err
	}
	out.replaced = int(replaced)
	kept, err := q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return out, err
	}
	out.kept = len(kept)
	titles := make(map[string]struct{}, len(kept)+len(proposed))
	drafts := map[string]db.MeetingActionItem{}
	for _, k := range kept {
		titles[normalizeTaskTitle(k.MeetingActionItem.Title)] = struct{}{}
		if k.MeetingActionItem.Source == ActionItemSourceLive && actionItemStatus(k.MeetingActionItem, k.TaskLive) == ActionItemPending {
			drafts[k.MeetingActionItem.ID] = k.MeetingActionItem
		}
	}
	creator := audit.System("meeting_summary")
	position := int32(0)
	for _, it := range proposed {
		// A refined draft (benchmark #21) is updated in place, once; a label
		// that names no pending live item any more falls through and its
		// title still matches the item, so it is skipped as a repeat.
		if id, ok := labels.draftID(it.Draft); ok {
			if d, ok := drafts[id]; ok {
				refined, err := refineLiveItem(ctx, q, m, d, it, labels)
				if err != nil {
					return out, err
				}
				if refined {
					delete(drafts, id)
					out.refined++
					continue
				}
			}
		}
		title := strings.TrimSpace(it.Title)
		key := normalizeTaskTitle(title)
		if key == "" {
			continue
		}
		if _, dup := titles[key]; dup {
			out.skipped++
			continue
		}
		titles[key] = struct{}{}
		refs, dropped := labels.resolve(it.Evidence)
		out.evidenceDropped += dropped
		evidence, err := json.Marshal(refs)
		if err != nil {
			return out, err
		}
		if _, err := q.InsertMeetingActionItem(ctx, db.InsertMeetingActionItemParams{
			ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
			Source: ActionItemSourceAI, SummaryID: strText(sum.ID), Position: position, Title: title,
			OwnerText: strings.TrimSpace(it.Owner), DueText: strings.TrimSpace(it.Due), Evidence: string(evidence),
			Description: strings.TrimSpace(it.Description), SuggestedPriority: it.Priority,
			CreatedBy: creator.ID, CreatedByKind: string(creator.Kind),
		}); err != nil {
			return out, err
		}
		position++
	}
	return out, nil
}

// refineLiveItem applies a summary's refinement of a pending live item: a
// field the summary left empty keeps the draft's value, the title never
// changes, and the evidence gains the lines the summary cited. false when
// the item was handled in the meantime.
func refineLiveItem(ctx context.Context, q *db.Queries, m db.Meeting, d db.MeetingActionItem, it ai.ActionItem, labels *summaryLabels) (bool, error) {
	pick := func(next, prev string) string {
		if next = strings.TrimSpace(next); next != "" {
			return next
		}
		return prev
	}
	refs, _ := labels.resolve(it.Evidence)
	merged := decodeEvidence(d.Evidence)
	for _, r := range refs {
		if !slices.Contains(merged, r) && len(merged) < summaryEvidenceRefs {
			merged = append(merged, r)
		}
	}
	evidence, err := json.Marshal(merged)
	if err != nil {
		return false, err
	}
	n, err := q.RefineLiveMeetingActionItem(ctx, db.RefineLiveMeetingActionItemParams{
		OrganizationID: m.OrganizationID, MeetingID: m.ID, ID: d.ID,
		OwnerText: pick(it.Owner, d.OwnerText), DueText: pick(it.Due, d.DueText),
		SuggestedPriority: pick(it.Priority, d.SuggestedPriority), Description: pick(it.Description, d.Description),
		Evidence: string(evidence),
	})
	return n == 1, err
}

// summaryPromptItems are what a new summary is told about the meeting's
// items: the titles of the ones it keeps as handled (converted, dismissed,
// manual, live ones a person converted or set aside), never to propose again,
// and the pending live items as drafts it may refine in place (benchmark
// #21). The pending AI items are left out; the new summary replaces them.
func (s *MeetingService) summaryPromptItems(ctx context.Context, m db.Meeting) ([]string, []db.MeetingActionItem, error) {
	rows, err := s.q.ListMeetingActionItems(ctx, db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		return nil, nil, err
	}
	titles := make([]string, 0, len(rows))
	var drafts []db.MeetingActionItem
	for _, r := range rows {
		it := r.MeetingActionItem
		pending := actionItemStatus(it, r.TaskLive) == ActionItemPending
		switch {
		case pending && it.Source == ActionItemSourceAI:
			continue
		case pending && it.Source == ActionItemSourceLive && len(drafts) < summaryDraftItems:
			drafts = append(drafts, it)
			continue
		}
		titles = append(titles, capRunes(it.Title, summaryExistingItemRunes, "…"))
	}
	// shortcut: past summaryExistingItems only the last ones in list order
	// reach the model, so the first handled AI items (lowest positions; the
	// list puts AI items before manual and live ones) are left out. The title
	// filter of storeSummary still drops a repeat of any of them; move to a
	// rune budget if meetings ever hold that many handled items.
	if len(titles) > summaryExistingItems {
		titles = titles[len(titles)-summaryExistingItems:]
	}
	return titles, drafts, nil
}

// summaryDraftLines labels the drafts for the prompt.
func summaryDraftLines(drafts []db.MeetingActionItem, labels *summaryLabels) []ai.DraftItem {
	out := make([]ai.DraftItem, 0, len(drafts))
	for _, d := range drafts {
		out = append(out, ai.DraftItem{
			Label: labels.draft(d.ID), Title: capRunes(d.Title, summaryExistingItemRunes, "…"),
			Owner: d.OwnerText, Due: d.DueText, Priority: d.SuggestedPriority,
			Description: capRunes(d.Description, summaryDraftDescriptionRunes, "…"),
		})
	}
	return out
}
