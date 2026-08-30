package matrix

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const createRoomPath = "/_matrix/client/v3/createRoom"

type createRoomReq struct {
	Name          string   `json:"name,omitempty"`
	RoomAliasName string   `json:"room_alias_name,omitempty"`
	Preset        string   `json:"preset"`
	Visibility    string   `json:"visibility,omitempty"`
	Invite        []string `json:"invite,omitempty"`
}

type createRoomResult struct {
	RoomID string `json:"room_id"`
}

// CreateRoom creates a workspace chat room using the caller's access token.
func (c *Client) CreateRoom(ctx context.Context, accessToken, name, aliasLocalpart string, invitees []string) (string, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return "", fmt.Errorf("matrix: access token is required")
	}
	in := createRoomReq{
		Name:          name,
		RoomAliasName: aliasLocalpart,
		Preset:        "private_chat",
		Visibility:    "private",
		Invite:        invitees,
	}
	var out createRoomResult
	if err := c.doAuthorizedJSON(ctx, http.MethodPost, createRoomPath, accessToken, in, &out); err != nil {
		return "", err
	}
	if out.RoomID == "" {
		return "", fmt.Errorf("matrix: empty room_id")
	}
	return out.RoomID, nil
}

func (c *Client) doAuthorizedJSON(ctx context.Context, method, path, accessToken string, reqBody, out any) error {
	var body io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &HTTPError{Status: res.StatusCode, Body: raw}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}
