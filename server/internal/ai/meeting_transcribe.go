package ai

import (
	"context"
	"errors"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Uploaded meeting recordings (parent spec 2026-10-20-meeting-follow-through
// §7.4): a job of hours, submitted once and polled by the meeting worker.
// Every job keeps one ai_usage_events row, pending from the submit and
// settled by the poll that ends it, so the usage report shows the vendor
// calls. The audio minutes are charged by the caller to the
// meeting.transcription meter (D15), never to AI credits: the row carries no
// tokens and the AI quota is not consulted.

// MeetingTranscribeAvailable: this server has a vendor for uploads.
func (g *Gateway) MeetingTranscribeAvailable() bool {
	return g != nil && g.cloud.MeetingTranscriber != nil
}

// MeetingTranscriberName and MeetingTranscriberModel name the vendor a job
// goes to, for the caller's own record.
func (g *Gateway) MeetingTranscriberName() string {
	if !g.MeetingTranscribeAvailable() {
		return ""
	}
	return g.cloud.MeetingTranscriber.Name()
}

func (g *Gateway) MeetingTranscriberModel() string {
	if !g.MeetingTranscribeAvailable() {
		return ""
	}
	return g.cloud.MeetingTranscriber.Model()
}

// MeetingTranscribeSubmit sends one job and returns the vendor's job id and
// the usage row that tracks it. A refused submit settles the row as failed.
func (g *Gateway) MeetingTranscribeSubmit(ctx context.Context, call CloudCall, req provider.FileTranscribeRequest) (jobID, usageEventID string, err error) {
	if !g.MeetingTranscribeAvailable() {
		return "", "", ErrCloudUnavailable
	}
	t := g.cloud.MeetingTranscriber
	kind := string(call.Actor.Kind)
	if kind == "" {
		kind = string(audit.KindSystem)
	}
	row, err := g.q.AiInsertUsageEvent(ctx, db.AiInsertUsageEventParams{
		ID: util.NewID(), OrganizationID: call.OrganizationID, ActorID: call.Actor.ID, ActorKind: kind,
		Capability: string(CapMeetingTranscribe), PromptID: string(CapMeetingTranscribe) + "@1",
		Provider: t.Name(), Model: t.Model(), Status: "pending", CorrelationID: audit.CorrelationID(ctx),
	})
	if err != nil {
		return "", "", err
	}
	jobID, err = t.Submit(ctx, req)
	if err != nil {
		g.settleMeetingTranscribe(ctx, row.ID, err)
		return "", row.ID, ErrProviderError.wrap(err)
	}
	return jobID, row.ID, nil
}

// MeetingTranscribePoll asks for the job's state. A finished job or one the
// vendor failed settles the usage row; a transport error leaves it pending,
// since the job may still be running.
func (g *Gateway) MeetingTranscribePoll(ctx context.Context, usageEventID, jobID string) (provider.FileTranscribeResult, error) {
	if !g.MeetingTranscribeAvailable() {
		return provider.FileTranscribeResult{}, ErrCloudUnavailable
	}
	res, err := g.cloud.MeetingTranscriber.Poll(ctx, jobID)
	var jobErr *provider.FileJobError
	switch {
	case errors.As(err, &jobErr):
		g.settleMeetingTranscribe(ctx, usageEventID, err)
		return res, err
	case err != nil:
		return res, err
	case res.Done:
		g.settleMeetingTranscribe(ctx, usageEventID, nil)
	}
	return res, nil
}

// MeetingTranscribeAbandon settles the row of a job the caller gave up on
// (its deadline passed while the vendor still said "running").
func (g *Gateway) MeetingTranscribeAbandon(ctx context.Context, usageEventID string) {
	g.settleMeetingTranscribe(ctx, usageEventID, errors.New("abandoned"))
}

func (g *Gateway) settleMeetingTranscribe(ctx context.Context, usageEventID string, cause error) {
	if g == nil || g.q == nil || usageEventID == "" {
		return
	}
	status, reason := "succeeded", ""
	if cause != nil {
		status, reason = "failed", ErrProviderError.Code
	}
	sctx, cancel := settleContext(ctx)
	defer cancel()
	if _, err := g.q.AiFinishUsageEvent(sctx, db.AiFinishUsageEventParams{
		ID: usageEventID, Status: status, ReasonCode: optText(reason), ToolCalls: "[]",
	}); err != nil {
		g.log.Warn("ai: meeting transcribe usage finish", "usage_event_id", usageEventID, "err", err)
	}
	g.observe(CapMeetingTranscribe, status, 0)
}
