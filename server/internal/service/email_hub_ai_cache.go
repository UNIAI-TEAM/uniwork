package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func emailThreadSummaryFingerprint(subject, snippet, plainBody string, syncedAt time.Time) string {
	h := sha256.New()
	_, _ = h.Write([]byte(strings.TrimSpace(subject)))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(strings.TrimSpace(snippet)))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(strings.TrimSpace(plainBody)))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(syncedAt.UTC().Format(time.RFC3339Nano)))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *EmailHubService) invalidateEmailHubThreadAiSummaries(ctx context.Context, threadID string) {
	if threadID == "" {
		return
	}
	_ = s.q.DeleteEmailHubThreadAiSummariesForThread(ctx, threadID)
}

func (s *EmailHubService) loadEmailHubThreadAiSummary(
	ctx context.Context,
	orgID, threadID, locale, fingerprint string,
) (EmailHubThreadSummaryView, bool, error) {
	row, err := s.q.GetEmailHubThreadAiSummary(ctx, db.GetEmailHubThreadAiSummaryParams{
		ThreadID: threadID, Locale: locale, OrganizationID: orgID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadSummaryView{}, false, nil
		}
		return EmailHubThreadSummaryView{}, false, err
	}
	if row.SourceFingerprint != fingerprint {
		return EmailHubThreadSummaryView{}, false, nil
	}
	var keyPoints []string
	if len(row.KeyPoints) > 0 {
		_ = json.Unmarshal(row.KeyPoints, &keyPoints)
	}
	var actionItems []ai.ActionItem
	if len(row.ActionItems) > 0 {
		_ = json.Unmarshal(row.ActionItems, &actionItems)
	}
	return EmailHubThreadSummaryView{
		Summary: row.Summary, KeyPoints: keyPoints, ActionItems: actionItems,
		NeedsReply: row.NeedsReply, ReplyHint: row.ReplyHint, Model: row.Model,
		Cached: true, SummarizedAt: row.UpdatedAt.Time,
	}, true, nil
}

func (s *EmailHubService) saveEmailHubThreadAiSummary(
	ctx context.Context,
	actor Actor,
	orgID, accountID, threadID, locale, fingerprint string,
	view EmailHubThreadSummaryView,
) error {
	keyPoints, err := json.Marshal(view.KeyPoints)
	if err != nil {
		keyPoints = []byte("[]")
	}
	actionItems, err := json.Marshal(view.ActionItems)
	if err != nil {
		actionItems = []byte("[]")
	}
	kind := string(actor.Kind)
	if kind == "" {
		kind = "human"
	}
	_, err = s.q.UpsertEmailHubThreadAiSummary(ctx, db.UpsertEmailHubThreadAiSummaryParams{
		ID: util.NewID(), OrganizationID: orgID, ThreadID: threadID, AccountID: accountID,
		Locale: locale, SourceFingerprint: fingerprint, Summary: view.Summary,
		KeyPoints: keyPoints, ActionItems: actionItems, NeedsReply: view.NeedsReply,
		ReplyHint: view.ReplyHint, Model: view.Model,
		CreatedBy: actor.ID, CreatedByKind: kind,
	})
	return err
}

func plainBodyFingerprintSource(view EmailHubThreadView, syncedAt time.Time) string {
	body := imapclient.PlainBodyForAI(view.BodyHTML, view.BodyText, view.Snippet)
	return emailThreadSummaryFingerprint(view.Subject, view.Snippet, body, syncedAt)
}
