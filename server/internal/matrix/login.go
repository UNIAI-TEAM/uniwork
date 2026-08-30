package matrix

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

const loginPath = "/_matrix/client/v3/login"

type LoginResult struct {
	UserID       string `json:"user_id"`
	AccessToken  string `json:"access_token"`
	DeviceID     string `json:"device_id"`
	HomeServer   string `json:"home_server"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type loginIdentifier struct {
	Type string `json:"type"`
	User string `json:"user"`
}

type loginReq struct {
	Type       string          `json:"type"`
	Identifier loginIdentifier `json:"identifier"`
	Password   string          `json:"password"`
}

// Login obtains a Matrix access token for an existing local user.
func (c *Client) Login(ctx context.Context, username, password string) (LoginResult, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return LoginResult{}, fmt.Errorf("matrix: username is required")
	}
	if password == "" {
		return LoginResult{}, fmt.Errorf("matrix: password is required")
	}
	in := loginReq{
		Type:       "m.login.password",
		Identifier: loginIdentifier{Type: "m.id.user", User: username},
		Password:   password,
	}
	var out LoginResult
	if err := c.DoJSON(ctx, http.MethodPost, loginPath, in, &out); err != nil {
		return LoginResult{}, err
	}
	return out, nil
}
