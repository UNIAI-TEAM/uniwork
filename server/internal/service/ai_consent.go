package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// aiConsentVersionMax bounds the version label a client sends: it names the
// notice text ("2026-10-anthropic"), never free text.
const aiConsentVersionMax = 64

// SetAIConsent records the person's answer to the AI processing notice
// (Apple 5.1.2(i)). A version records agreement to that text; "" withdraws.
// The answer is the person's own, so the audit row sits on the credential
// sentinel as user.deleted does, never on one organization. Agreeing again to
// the version already on file changes nothing and writes no row.
func (s *AuthService) SetAIConsent(ctx context.Context, userID, version string) (db.User, error) {
	version = strings.TrimSpace(version)
	if len(version) > aiConsentVersionMax || strings.ContainsAny(version, " \t\r\n") {
		return db.User{}, Invalid("version không hợp lệ")
	}
	u, err := s.Me(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if u.AiConsentVersion.String == version && u.AiConsentVersion.Valid == (version != "") {
		return u, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	next, err := q.SetUserAIConsent(ctx, db.SetUserAIConsentParams{
		ID: userID, Version: pgtype.Text{String: version, Valid: version != ""},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	if err != nil {
		return db.User{}, err
	}
	action := audit.ActionUserAIConsentGranted
	if version == "" {
		action = audit.ActionUserAIConsentWithdrawn
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: action, ResourceType: "user", ResourceID: userID,
		Changes: audit.Diff(
			map[string]any{"ai_consent_version": u.AiConsentVersion.String},
			map[string]any{"ai_consent_version": version},
		),
	}); err != nil {
		return db.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.User{}, err
	}
	return s.decorateAvatar(ctx, next), nil
}
