package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The writer route (Ask UNI × Office plan 5): the Office editors' one-shot
// writers under UniWork AI. A writer call is one more model call of the run
// the frame is already in — the client sends {kind, lang, input}, never a
// prompt — so it passes the chat route's gates in the chat route's order,
// never opens a run, and leaves the run's last call for the tool round that
// hands the writer's result back. Its text is document content, not a
// conversation turn: nothing is appended to the transcript and no handoff
// package is read.

// UniworkWriteInput is one writer call: the frame's scope, the conversation
// and run it works inside (both required) and the raw body.
type UniworkWriteInput struct {
	Scope          UniworkScope
	ConversationID string
	RunID          string
	Body           []byte
}

// UniworkWriteResult is an answered writer call and the ids every answer of
// the run carries.
type UniworkWriteResult struct {
	Response       ai.Response
	ConversationID string
	RunID          string
}

// Write answers one writer call, streaming the text through onDelta. A
// refusal after the run was taken names the conversation and the run.
func (s *AIUniworkService) Write(ctx context.Context, in UniworkWriteInput, onDelta func(string)) (UniworkWriteResult, error) {
	scope := in.Scope
	doc, err := s.documentScope(ctx, scope)
	if err != nil {
		return UniworkWriteResult{}, err
	}
	if !doc.edit {
		return UniworkWriteResult{}, ErrForbidden
	}
	orgID := scope.OrgID
	if orgID == "" {
		orgID = doc.orgID
	}
	if _, err := s.orgs.RequireMember(ctx, orgID, scope.UserID); err != nil {
		return UniworkWriteResult{}, err
	}
	if !s.gw.Enabled() {
		return UniworkWriteResult{}, ai.ErrDisabled
	}
	if err := s.ents.Can(ctx, orgID, FeatureOfficeAICloud); err != nil {
		return UniworkWriteResult{}, err
	}
	req, err := ai.DecodeWriterRequest(in.Body)
	if err != nil {
		return UniworkWriteResult{}, writerBodyRefusal(err)
	}
	// The module is the frame token's; a kind of another editor is a client
	// fault, refused before any gate that counts.
	if req.Kind.Module() != doc.module {
		return UniworkWriteResult{}, writerInvalid("loại viết không thuộc trình soạn đang mở", nil)
	}
	if err := s.checkUniworkCapability(ctx, orgID, scope.UserID, doc.module); err != nil {
		return UniworkWriteResult{}, err
	}
	if err := s.ents.CheckQuota(ctx, orgID, FeatureAITokens, 1); err != nil {
		return UniworkWriteResult{}, uniworkQuotaErr(err)
	}
	// A writer call opening its own run would be the cap's escape hatch (one
	// new run per call), so it must name the run it belongs to.
	if in.RunID == "" || in.ConversationID == "" {
		return UniworkWriteResult{}, writerInvalid(
			"lượt viết phải nêu "+ai.UniworkRunHeader+" và "+ai.UniworkConversationHeader, nil)
	}
	key := ai.ConversationKey{
		OrganizationID: orgID, UserID: scope.UserID, DocumentID: scope.DocumentID,
		Module: doc.module, DeviceID: scope.DeviceID,
	}
	conv, err := s.resumeConversation(ctx, key, in.ConversationID)
	if err != nil {
		return UniworkWriteResult{}, err
	}
	release, err := s.writerLimiter.Acquire(ctx, orgID)
	if err != nil {
		return UniworkWriteResult{ConversationID: conv.ID}, err
	}
	defer release()
	run, err := s.takeRun(ctx, ai.TakeRunTurn{
		OrganizationID: orgID, ConversationID: conv.ID, RunID: in.RunID,
		Writer: true, CreatedBy: scope.UserID, Now: s.now(),
	})
	if err != nil {
		return UniworkWriteResult{ConversationID: conv.ID, RunID: run.ID}, err
	}
	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: Human(scope.UserID), OrganizationID: orgID, WorkspaceID: doc.workspaceID,
		Capability: ai.CapOfficeUniworkWriter, PromptID: ai.WriterPromptID(req.Kind), Module: string(req.Kind),
		Vars:    map[string]any{"input": req.Input, "lang": req.Lang},
		OnDelta: onDelta,
		// One charge per (run, model call), as on the chat route.
		MeterKey: uniworkMeterKey(run),
	})
	// The run carries what the call cost, on a context that outlives the
	// request: an answered call's tokens, or the partial the Gateway charged
	// for a call stopped after text went out (timeout, client gone). A vendor
	// failure is unbilled and adds nothing, so a free call leaves no run
	// sample either.
	credits := int64(resp.InputTokens + resp.OutputTokens)
	var stopped *ai.Error
	if errors.As(err, &stopped) {
		credits = stopped.ChargedTokens
	}
	if credits > 0 {
		s.addRunCredits(ctx, run, credits)
	}
	if err != nil {
		return UniworkWriteResult{ConversationID: conv.ID, RunID: run.ID}, err
	}
	return UniworkWriteResult{Response: resp, ConversationID: conv.ID, RunID: run.ID}, nil
}

// writerInvalid is the writer route's 400 invalid_request; it keeps
// ai.ErrWriterInvalid (and the cause, never shown) for errors.Is.
func writerInvalid(msg string, cause error) error {
	if cause == nil {
		cause = ai.ErrWriterInvalid
	}
	return CodedError{Code: "invalid_request", Status: http.StatusBadRequest, Msg: msg, Err: cause}
}

// writerBodyRefusal maps a body DecodeWriterRequest refused: a field over its
// cap is 413 payload_too_large, anything else 400 invalid_request.
func writerBodyRefusal(err error) error {
	if errors.Is(err, ai.ErrWriterTooLarge) {
		return CodedError{Code: "payload_too_large", Status: http.StatusRequestEntityTooLarge,
			Msg: "dữ liệu gửi cho AI viết vượt trần cho phép", Err: err}
	}
	return writerInvalid("yêu cầu viết không hợp lệ", err)
}
