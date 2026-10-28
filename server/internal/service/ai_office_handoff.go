package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The handoff package Ask UNI leaves for the editor AI (UNI-2264, plan
// 2026-10-28-ask-uni-office-p4-handoff): the approved request, the outline cut
// into parts, and the quoted sources, bound to the asker and the new document.
// The payload is user text: it is never logged.

const (
	officeHandoffTTL           = 24 * time.Hour
	officeHandoffSweepInterval = 10 * time.Minute
	officeHandoffSweepBatch    = 500
)

type OfficeHandoffSource struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
	Quote string `json:"quote"`
}

type OfficeHandoff struct {
	ID, OrganizationID, WorkspaceID, UserID, DocumentID, ProposalID string
	Format, Title, Request, Outline                                 string
	Parts                                                           []string
	Sources                                                         []OfficeHandoffSource
	NextPart                                                        int
	ConversationID                                                  string
	ExpiresAt                                                       time.Time
}

type NewOfficeHandoff struct {
	OrganizationID, WorkspaceID, UserID, DocumentID, ProposalID string
	Format, Title, Request, Outline                             string
	Sources                                                     []OfficeHandoffSource
}

var (
	handoffHeadingRe = regexp.MustCompile(`^#{1,2}\s`)
	handoffListRe    = regexp.MustCompile(`^([-*+]|\d+[.)])\s`)
)

// handoffParts cuts an outline into the parts the editor AI works through one
// turn at a time: top-level items (headings if any, else column-0 list items;
// otherwise the whole text is one item), grouped max(3, ceil(items/8)) to a
// part. Sub-lines stay with their item; text before the first item joins it.
func handoffParts(outline string) []string {
	text := strings.TrimSpace(outline)
	if text == "" {
		return []string{""}
	}
	lines := strings.Split(text, "\n")
	isItem := handoffListRe.MatchString
	for _, l := range lines {
		if handoffHeadingRe.MatchString(l) {
			isItem = handoffHeadingRe.MatchString
			break
		}
	}
	var items []string
	var cur []string
	started := false
	for _, l := range lines {
		if isItem(l) && started && len(cur) > 0 {
			items = append(items, strings.Join(cur, "\n"))
			cur = nil
		}
		if isItem(l) {
			started = true
		}
		cur = append(cur, l)
	}
	items = append(items, strings.Join(cur, "\n"))

	per := max(3, int(math.Ceil(float64(len(items))/8)))
	var parts []string
	for i := 0; i < len(items); i += per {
		parts = append(parts, strings.TrimSpace(strings.Join(items[i:min(i+per, len(items))], "\n")))
	}
	return parts
}

func createOfficeHandoff(ctx context.Context, q *db.Queries, in NewOfficeHandoff, now time.Time) (OfficeHandoff, error) {
	h := OfficeHandoff{
		ID: util.NewID(), OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID,
		UserID: in.UserID, DocumentID: in.DocumentID, ProposalID: in.ProposalID,
		Format: in.Format, Title: in.Title, Request: in.Request, Outline: in.Outline,
		Parts: handoffParts(in.Outline), Sources: in.Sources, ExpiresAt: now.Add(officeHandoffTTL),
	}
	if h.Sources == nil {
		h.Sources = []OfficeHandoffSource{}
	}
	parts, err := json.Marshal(h.Parts)
	if err != nil {
		return OfficeHandoff{}, fmt.Errorf("marshal handoff parts: %w", err)
	}
	sources, err := json.Marshal(h.Sources)
	if err != nil {
		return OfficeHandoff{}, fmt.Errorf("marshal handoff sources: %w", err)
	}
	err = q.AiCreateOfficeHandoff(ctx, db.AiCreateOfficeHandoffParams{
		ID: h.ID, OrganizationID: h.OrganizationID, WorkspaceID: h.WorkspaceID, UserID: h.UserID,
		DocumentID: h.DocumentID, ProposalID: h.ProposalID, Format: h.Format, Title: h.Title,
		Request: h.Request, Outline: h.Outline, Parts: parts, Sources: sources,
		ExpiresAt: pgtype.Timestamptz{Time: h.ExpiresAt, Valid: true},
	})
	if err != nil {
		return OfficeHandoff{}, fmt.Errorf("create office handoff: %w", err)
	}
	return h, nil
}

// loadOfficeHandoff answers ErrNotFound for every way a caller may not use the
// package: unknown, another asker, document or organization, expired, bound to
// another conversation, or all parts done.
func loadOfficeHandoff(ctx context.Context, q *db.Queries, id, orgID, userID, documentID, conversationID string, now time.Time) (OfficeHandoff, error) {
	row, err := q.AiGetOfficeHandoff(ctx, db.AiGetOfficeHandoffParams{ID: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return OfficeHandoff{}, ErrNotFound
	}
	if err != nil {
		return OfficeHandoff{}, fmt.Errorf("get office handoff: %w", err)
	}
	h := OfficeHandoff{
		ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		UserID: row.UserID, DocumentID: row.DocumentID, ProposalID: row.ProposalID,
		Format: row.Format, Title: row.Title, Request: row.Request, Outline: row.Outline,
		NextPart: int(row.NextPart), ConversationID: row.ConversationID.String, ExpiresAt: row.ExpiresAt.Time,
	}
	if h.UserID != userID || h.DocumentID != documentID || !now.Before(h.ExpiresAt) ||
		(h.ConversationID != "" && h.ConversationID != conversationID) {
		return OfficeHandoff{}, ErrNotFound
	}
	if err := json.Unmarshal(row.Parts, &h.Parts); err != nil {
		return OfficeHandoff{}, fmt.Errorf("decode handoff parts: %w", err)
	}
	if err := json.Unmarshal(row.Sources, &h.Sources); err != nil {
		return OfficeHandoff{}, fmt.Errorf("decode handoff sources: %w", err)
	}
	if h.NextPart >= len(h.Parts) {
		return OfficeHandoff{}, ErrNotFound
	}
	return h, nil
}

// advanceOfficeHandoff binds the conversation and moves past the part h was
// read at. It reports false when another turn moved the row first.
func advanceOfficeHandoff(ctx context.Context, q *db.Queries, h OfficeHandoff, conversationID string, now time.Time) (bool, error) {
	n, err := q.AiAdvanceOfficeHandoff(ctx, db.AiAdvanceOfficeHandoffParams{
		ConversationID: conversationID, ID: h.ID, OrganizationID: h.OrganizationID,
		NextPart: int32(h.NextPart), Now: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return false, fmt.Errorf("advance office handoff: %w", err)
	}
	return n > 0, nil
}

// OfficeHandoffSweeper deletes expired packages. cmd/server/main.go runs it
// under runCtx and awaits it in the shutdown sequence.
type OfficeHandoffSweeper struct {
	q   *db.Queries
	log *slog.Logger
}

func NewOfficeHandoffSweeper(q *db.Queries, log *slog.Logger) *OfficeHandoffSweeper {
	if log == nil {
		log = slog.Default()
	}
	return &OfficeHandoffSweeper{q: q, log: log}
}

// Run sweeps once at start and then every 10 minutes until ctx ends.
func (w *OfficeHandoffSweeper) Run(ctx context.Context) {
	for {
		n, err := w.Sweep(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.log.Warn("office handoff sweep", "err", err)
		} else if n > 0 {
			w.log.Info("office handoff sweep", "purged", n)
		}
		if !retentionPause(ctx, officeHandoffSweepInterval) {
			return
		}
	}
}

// Sweep deletes expired rows in batches of 500 until a batch comes back short.
func (w *OfficeHandoffSweeper) Sweep(ctx context.Context) (int, error) {
	total := 0
	for {
		ids, err := w.q.AiExpiredOfficeHandoffIDs(ctx, db.AiExpiredOfficeHandoffIDsParams{
			Now: pgtype.Timestamptz{Time: time.Now(), Valid: true}, Batch: officeHandoffSweepBatch,
		})
		if err != nil {
			return total, fmt.Errorf("list expired office handoffs: %w", err)
		}
		if len(ids) == 0 {
			return total, nil
		}
		if err := w.q.AiDeleteOfficeHandoffsByIDs(ctx, ids); err != nil {
			return total, fmt.Errorf("delete expired office handoffs: %w", err)
		}
		total += len(ids)
		if len(ids) < officeHandoffSweepBatch {
			return total, nil
		}
	}
}
