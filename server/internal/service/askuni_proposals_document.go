package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// "Tạo tài liệu": an Ask UNI answer saved as a page through the executor (R16).

// mdLinkText escapes a title for the text of a Markdown link.
var mdLinkText = strings.NewReplacer(`\`, `\\`, "[", `\[`, "]", `\]`)

// askAnswerMarkdown is a stored answer as a page: each [S#] becomes its
// source's title linked to the source, and a number the answer did not cite is
// dropped with its space.
func askAnswerMarkdown(answer string, cited []AskCitation) string {
	b := newSourceBook([][]AskCitation{cited})
	return spacedSourceRef.ReplaceAllStringFunc(answer, func(m string) string {
		g := spacedSourceRef.FindStringSubmatch(m)
		if c, ok := b.byID[g[2]]; ok {
			return g[1] + "[" + mdLinkText.Replace(oneLine(c.Title)) + "](" + c.Href + ")"
		}
		return ""
	})
}

// SaveAnswerAsDocument is "Tạo tài liệu" (R16): the answer, its [S#] made
// internal links, becomes a private page at the top of the workspace, titled
// as the conversation. It is one create_document row of the answer at
// askAnswerPosition, applied with decision answer and undone like any other.
// An answer makes one page: a second call returns the row the first made,
// applying it if it still waits. A row that failed or expired unapplied is
// drafted again from the answer and tried again; any other row, an undone one
// included (R14), is returned as it is.
func (s *AskUNIService) SaveAnswerAsDocument(ctx context.Context, userID, conversationID, messageID string) (AskProposal, error) {
	conv, err := s.ownConversation(ctx, userID, conversationID, "")
	if err != nil {
		return AskProposal{}, err
	}
	msg, err := s.q.AiGetMessageInConversation(ctx, db.AiGetMessageInConversationParams{ID: messageID, ConversationID: conv.ID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (msg.Role != "assistant" || msg.SupersededAt.Valid)) {
		return AskProposal{}, ErrNotFound
	}
	if err != nil {
		return AskProposal{}, err
	}
	tc := ai.ToolContext{ActorID: userID, OrganizationID: conv.OrganizationID, WorkspaceID: conv.WorkspaceID}
	if _, err := s.ws.RequireMember(ctx, conv.WorkspaceID, userID); err != nil {
		return AskProposal{}, err
	}
	if err := s.askGate(ctx, tc, false); err != nil {
		return AskProposal{}, err
	}
	row, err := s.answerDocumentRow(ctx, tc, conv, msg)
	if err != nil {
		return AskProposal{}, err
	}
	if row.Status != proposalPending {
		return askProposalOf(row, s.now()), nil
	}
	p, err := s.applyRow(ctx, userID, row, "answer")
	if codeOf(err) == errProposalNotPending.Code {
		// A second click claimed it first: the row is that call's to finish.
		if row, err = s.q.AiGetProposal(ctx, row.ID); err != nil {
			return AskProposal{}, err
		}
		return askProposalOf(row, s.now()), nil
	}
	return p, err
}

// answerDocumentRow finds or makes the answer's document row, holding the
// answer's row lock so two calls find or make one.
func (s *AskUNIService) answerDocumentRow(ctx context.Context, tc ai.ToolContext, conv db.AiConversation, msg db.AiMessage) (db.AgentActionProposal, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.AiLockMessageInConversation(ctx, db.AiLockMessageInConversationParams{ID: msg.ID, ConversationID: conv.ID}); err != nil {
		return db.AgentActionProposal{}, err
	}
	rows, err := q.AiListProposalsForMessages(ctx, db.AiListProposalsForMessagesParams{OrganizationID: conv.OrganizationID, MessageIds: []string{msg.ID}})
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	now := s.now()
	i := slices.IndexFunc(rows, func(r db.AgentActionProposal) bool { return r.Position == askAnswerPosition })
	if i >= 0 && rows[i].Status != proposalFailed && (rows[i].Status != proposalPending || !askExpired(rows[i], now)) {
		return rows[i], tx.Commit(ctx)
	}
	d, err := s.answerDocumentDraft(ctx, tc, conv, msg)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	if i >= 0 {
		preview, err := json.Marshal(d.Preview)
		if err != nil {
			return db.AgentActionProposal{}, err
		}
		row, err := q.AiResetProposalDraft(ctx, db.AiResetProposalDraftParams{
			ID: rows[i].ID, OrganizationID: rows[i].OrganizationID, Payload: string(d.Args), Preview: string(preview),
			RiskLevel: d.Level, TargetID: strText(d.TargetID), TargetRevision: int8Of(d.TargetRevision),
			ExpiresAt: pgtype.Timestamptz{Time: now.Add(askProposalTTL), Valid: true},
		})
		if err != nil {
			return db.AgentActionProposal{}, err
		}
		return row, tx.Commit(ctx)
	}
	// The caller passed the gate, so the mode is set; a ceiling lowered since
	// fails the row's mode check and nothing is stored.
	mode := s.askActions(ctx, tc, "").Mode
	p, err := askProposalParams(tc, conv.ID, msg.ID, util.NewID(), askAnswerPosition, d, mode, convTainted(conv), now)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	row, err := q.AiInsertProposal(ctx, p)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	return row, tx.Commit(ctx)
}

// answerDocumentDraft is the create_document draft of the answer as it is
// stored now: its Markdown with [S#] made links, titled as the conversation.
func (s *AskUNIService) answerDocumentDraft(ctx context.Context, tc ai.ToolContext, conv db.AiConversation, msg db.AiMessage) (askDraftRow, error) {
	var cited []AskCitation
	_ = json.Unmarshal([]byte(msg.Citations), &cited)
	content := askAnswerMarkdown(msg.Content, cited)
	title := strings.TrimSpace(conv.Title)
	if title == "" {
		title = oneLine(content)
	}
	args, err := json.Marshal(map[string]string{"title": capRunes(title, mcpMaxDocumentTitleRunes, ""), "content": content})
	if err != nil {
		return askDraftRow{}, err
	}
	tool, err := s.askWriteToolNamed("create_document")
	if err != nil {
		return askDraftRow{}, err
	}
	return tool.prepare(ctx, tc, args, nil)
}
