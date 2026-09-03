package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	verificationCodeTTL = 10 * time.Minute
	verificationResend  = 60 * time.Second
)

// VerificationService issues and checks the email verification code a user
// receives after registering. Codes are stored hashed; the active-code query
// enforces single use, expiry and the attempt cap.
type VerificationService struct {
	q      *db.Queries
	render mail.Renderer
	out    mail.Enqueuer
	// devCode, when set, is accepted in place of the real code as long as an
	// active code exists — CI and local runs verify without reading mail.
	devCode string
	now     func() time.Time
}

func NewVerificationService(q *db.Queries, r mail.Renderer, out mail.Enqueuer, devCode string) *VerificationService {
	return &VerificationService{q: q, render: r, out: out, devCode: devCode, now: time.Now}
}

// Send issues a fresh code and mails it. ErrConflict when the email is
// already verified; ErrRateLimited within 60s of the previous code.
func (s *VerificationService) Send(ctx context.Context, userID string) error {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if u.EmailVerifiedAt.Valid {
		return ErrConflict
	}
	latest, err := s.q.GetLatestEmailVerificationCode(ctx, userID)
	if err == nil && s.now().Sub(latest.CreatedAt.Time) < verificationResend {
		return ErrRateLimited
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	code, err := generateCode()
	if err != nil {
		return err
	}
	_, err = s.q.CreateEmailVerificationCode(ctx, db.CreateEmailVerificationCodeParams{
		ID: util.NewID(), UserID: userID, CodeHash: hashToken(code),
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(verificationCodeTTL), Valid: true},
	})
	if err != nil {
		return err
	}
	msg, err := s.render.VerificationCode(u.Email, u.Locale, u.ID, mail.VerificationData{Code: code, Expires: verificationCodeTTL})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		return fmt.Errorf("queue verification mail: %w", err)
	}
	s.out.Kick()
	if err := s.q.DeleteExpiredEmailVerificationCodes(ctx); err != nil {
		slog.Warn("delete expired verification codes", "err", err)
	}
	return nil
}

// Confirm checks code against the user's active code and marks the email
// verified. Wrong, expired and exhausted codes all return ErrInvalidCode.
func (s *VerificationService) Confirm(ctx context.Context, userID, code string) (db.User, error) {
	code = strings.TrimSpace(code)
	active, err := s.q.GetActiveEmailVerificationCode(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrInvalidCode
	}
	if err != nil {
		return db.User{}, err
	}
	if !s.matches(code, active.CodeHash) {
		if err := s.q.IncrementEmailVerificationCodeAttempts(ctx, active.ID); err != nil {
			return db.User{}, err
		}
		return db.User{}, ErrInvalidCode
	}
	if err := s.q.MarkEmailVerificationCodeUsed(ctx, active.ID); err != nil {
		return db.User{}, err
	}
	u, err := s.q.MarkEmailVerified(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	if err != nil {
		return db.User{}, err
	}
	if err := s.q.DeleteEmailVerificationCodesForUser(ctx, userID); err != nil {
		slog.Warn("delete verification codes", "user", userID, "err", err)
	}
	return u, nil
}

func (s *VerificationService) matches(code, hash string) bool {
	if s.devCode != "" && subtle.ConstantTimeCompare([]byte(code), []byte(s.devCode)) == 1 {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(hashToken(code)), []byte(hash)) == 1
}

func generateCode() (string, error) {
	var buf [4]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", binary.BigEndian.Uint32(buf[:])%1000000), nil
}
