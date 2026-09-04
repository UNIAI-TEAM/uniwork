package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func hashInviteSecret(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func newInviteSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type CreatedInviteLink struct {
	Link      db.MeetingInviteLink
	RawSecret string
}

func (s *MeetingService) CreateInviteLink(ctx context.Context, userID, meetingID, name, mode string, expiresAt time.Time, maxUses *int32) (CreatedInviteLink, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return CreatedInviteLink{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return CreatedInviteLink{}, errInvalidState()
	}
	if mode != LinkAutoAdmit && mode != LinkRequestApproval {
		return CreatedInviteLink{}, Invalid("access_mode không hợp lệ")
	}
	if !expiresAt.After(time.Now()) {
		return CreatedInviteLink{}, Invalid("invite link phải còn hạn")
	}
	raw, err := newInviteSecret()
	if err != nil {
		return CreatedInviteLink{}, err
	}
	var max pgtype.Int4
	if maxUses != nil {
		max = pgtype.Int4{Int32: *maxUses, Valid: true}
	}
	link, err := s.q.CreateInviteLink(ctx, db.CreateInviteLinkParams{
		ID: util.NewID(), MeetingID: meetingID, Name: name, SecretHash: hashInviteSecret(raw),
		AccessMode: mode, ExpiresAt: pgtype.Timestamptz{Time: expiresAt.UTC(), Valid: true},
		MaxUses: max, CreatedBy: userID,
	})
	if err != nil {
		return CreatedInviteLink{}, err
	}
	_ = s.writeAudit(ctx, s.q, m.ID, "INVITE_LINK_CREATED", userID, "", link.ID, `{"access_mode":"`+mode+`"}`)
	return CreatedInviteLink{Link: link, RawSecret: raw}, nil
}

func (s *MeetingService) ListInviteLinks(ctx context.Context, userID, meetingID string) ([]db.MeetingInviteLink, error) {
	if _, err := s.requireHostOrAdmin(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListInviteLinks(ctx, meetingID)
}

func (s *MeetingService) RevokeInviteLink(ctx context.Context, userID, meetingID, linkID string) error {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	link, err := q.RevokeInviteLink(ctx, db.RevokeInviteLinkParams{ID: linkID, RevokedBy: strText(userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if link.MeetingID != meetingID {
		return ErrNotFound
	}
	_ = q.RevokeGrantsByInviteLink(ctx, db.RevokeGrantsByInviteLinkParams{SourceID: strText(linkID), RevokedBy: strText(userID)})
	_ = s.writeAudit(ctx, q, m.ID, "INVITE_LINK_REVOKED", userID, "", linkID, "{}")
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "invite_link.revoked", Payload: meetingRelatedPayload(m, map[string]string{
		"invite_link_id": linkID,
	})})
	return nil
}

type PublicInviteView struct {
	LinkID     string
	MeetingID  string
	Title      string
	StartsAt   time.Time
	AccessMode string
	Expired    bool
}

func (s *MeetingService) ResolveInviteLink(ctx context.Context, linkID, secret string) (PublicInviteView, error) {
	link, err := s.q.GetInviteLink(ctx, linkID)
	if err != nil {
		return PublicInviteView{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	want := hashInviteSecret(secret)
	if subtle.ConstantTimeCompare([]byte(want), []byte(link.SecretHash)) != 1 {
		return PublicInviteView{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	m, err := s.q.GetMeeting(ctx, link.MeetingID)
	if err != nil {
		return PublicInviteView{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	expired := link.RevokedAt.Valid || !link.ExpiresAt.Time.After(time.Now())
	return PublicInviteView{
		LinkID: link.ID, MeetingID: m.ID, Title: m.Title, StartsAt: m.StartsAt.Time,
		AccessMode: link.AccessMode, Expired: expired,
	}, nil
}

func (s *MeetingService) verifyInviteLink(ctx context.Context, q *db.Queries, linkID, secret string) (db.MeetingInviteLink, error) {
	link, err := q.GetInviteLink(ctx, linkID)
	if err != nil {
		return db.MeetingInviteLink{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	if subtle.ConstantTimeCompare([]byte(hashInviteSecret(secret)), []byte(link.SecretHash)) != 1 {
		return db.MeetingInviteLink{}, coded(http.StatusNotFound, "invite_link_invalid", "liên kết không hợp lệ")
	}
	if link.RevokedAt.Valid {
		return db.MeetingInviteLink{}, coded(http.StatusForbidden, "invite_link_revoked", "liên kết đã bị thu hồi")
	}
	if !link.ExpiresAt.Time.After(time.Now()) {
		return db.MeetingInviteLink{}, coded(http.StatusForbidden, "invite_link_expired", "liên kết đã hết hạn")
	}
	return link, nil
}
