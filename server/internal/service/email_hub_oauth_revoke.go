package service

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubRevokeTimeout bounds the best-effort revoke that runs after a command
// committed (spec §5.5).
const emailHubRevokeTimeout = 5 * time.Second

// revokeEmailHubToken tells Google that a refresh token a committed statement
// just removed from accountID's row is no longer wanted (spec §5.5). Only
// oauth_google has a revoke endpoint: Microsoft offers none for it, and a
// password row has no token. The command already committed, so this never
// fails it: an error, a non-200 or the timeout is logged by code, never with
// the token or the response. Google revokes the whole grant, every token
// Email Hub's client holds for that Google account, so a grant another live
// row still holds is skipped.
func (s *EmailHubService) revokeEmailHubToken(ctx context.Context, accountID, authKind, refreshEnc string) {
	if refreshEnc == "" || authKind != "oauth_google" {
		return
	}
	p, ok := s.oauthByKind(authKind)
	if !ok || p.revokeURL == "" {
		s.log.Warn("email hub revoke skipped", "account_id", accountID, "code", "not_configured")
		return
	}
	token, err := s.openPassword(refreshEnc)
	if err != nil {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "unsealable")
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), emailHubRevokeTimeout)
	defer cancel()
	// The row that removed the token no longer counts: its refresh column is empty.
	acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
	if err != nil {
		s.log.Warn("email hub revoke skipped", "account_id", accountID, "code", "lookup_failed")
		return
	}
	holders, err := s.q.CountEmailHubOAuthGrantHolders(ctx, db.CountEmailHubOAuthGrantHoldersParams{
		AuthKind: authKind, Email: acc.EmailAddress,
	})
	if err != nil || holders > 0 {
		code := "grant_shared"
		if err != nil {
			code = "lookup_failed"
		}
		s.log.Info("email hub revoke skipped", "account_id", accountID, "code", code)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.revokeURL,
		strings.NewReader(url.Values{"token": {token}}.Encode()))
	if err != nil {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "request")
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.oauthHTTP.Do(req)
	if err != nil {
		code := "unreachable"
		if errors.Is(err, context.DeadlineExceeded) {
			code = "timeout"
		}
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", code)
		return
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		s.log.Warn("email hub revoke failed", "account_id", accountID, "code", "status_"+strconv.Itoa(resp.StatusCode))
	}
}

// revokeReplacedEmailHubToken revokes the refresh token a committed reconnect
// replaced. prev is the row before the save, and the zero row on a fresh
// insert. A reconnect matches by address, so the same auth kind means the same
// Google account and the same grant as the token just stored. Only a change
// of auth kind leaves a grant nobody uses.
func (s *EmailHubService) revokeReplacedEmailHubToken(ctx context.Context, prev, row db.EmailHubAccount) {
	if prev.AuthKind != row.AuthKind {
		s.revokeEmailHubToken(ctx, prev.ID, prev.AuthKind, prev.OauthRefreshTokenEnc)
	}
}
