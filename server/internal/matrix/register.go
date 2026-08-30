package matrix

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

const registerPath = "/_matrix/client/v3/register"

type RegisterResult struct {
	UserID      string `json:"user_id"`
	AccessToken string `json:"access_token"`
	DeviceID    string `json:"device_id"`
	HomeServer  string `json:"home_server"`
}

type registerReq struct {
	Username     string        `json:"username"`
	Password     string        `json:"password"`
	InhibitLogin bool          `json:"inhibit_login"`
	Auth         *registerAuth `json:"auth,omitempty"`
}

type registerAuth struct {
	Type    string `json:"type"`
	Session string `json:"session,omitempty"`
}

type uiaChallenge struct {
	Session string `json:"session"`
}

// Register creates a Matrix account via m.login.dummy (local Synapse with
// enable_registration_without_verification).
func (c *Client) Register(ctx context.Context, username, password string) (RegisterResult, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return RegisterResult{}, fmt.Errorf("matrix: username is required")
	}
	if password == "" {
		return RegisterResult{}, fmt.Errorf("matrix: password is required")
	}
	in := registerReq{Username: username, Password: password}
	slog.Info("matrix register: calling homeserver",
		"homeserver", c.BaseURL, "username", username, "path", registerPath)
	got, err := c.postRegister(ctx, in)
	if err == nil {
		slog.Info("matrix register: success",
			"homeserver", c.BaseURL, "username", username,
			"user_id", got.UserID, "device_id", got.DeviceID, "home_server", got.HomeServer)
		return got, nil
	}
	he, ok := err.(*HTTPError)
	if !ok || he.Status != http.StatusUnauthorized {
		logMatrixRegisterFailure(c.BaseURL, username, err)
		return RegisterResult{}, err
	}
	var ch uiaChallenge
	_ = json.Unmarshal(he.Body, &ch)
	slog.Info("matrix register: UIA challenge, completing dummy auth",
		"homeserver", c.BaseURL, "username", username, "status", he.Status)
	in.Auth = &registerAuth{Type: "m.login.dummy", Session: ch.Session}
	got, err = c.postRegister(ctx, in)
	if err != nil {
		logMatrixRegisterFailure(c.BaseURL, username, err)
		return RegisterResult{}, err
	}
	slog.Info("matrix register: success",
		"homeserver", c.BaseURL, "username", username,
		"user_id", got.UserID, "device_id", got.DeviceID, "home_server", got.HomeServer)
	return got, nil
}

func logMatrixRegisterFailure(baseURL, username string, err error) {
	attrs := []any{"homeserver", baseURL, "username", username, "err", err.Error()}
	if he, ok := err.(*HTTPError); ok {
		body := bytes.TrimSpace(he.Body)
		if len(body) > 512 {
			body = body[:512]
		}
		attrs = append(attrs, "status", he.Status, "body", string(body))
	}
	slog.Warn("matrix register: failed", attrs...)
}

func (c *Client) postRegister(ctx context.Context, in registerReq) (RegisterResult, error) {
	var out RegisterResult
	if err := c.DoJSON(ctx, http.MethodPost, registerPath, in, &out); err != nil {
		return RegisterResult{}, err
	}
	return out, nil
}
