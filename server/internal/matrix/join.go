package matrix

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type joinRoomResult struct {
	RoomID string `json:"room_id"`
}

// JoinRoom adds the caller to an existing room.
func (c *Client) JoinRoom(ctx context.Context, accessToken, roomID string) error {
	accessToken = strings.TrimSpace(accessToken)
	roomID = strings.TrimSpace(roomID)
	if accessToken == "" {
		return fmt.Errorf("matrix: access token is required")
	}
	if roomID == "" {
		return fmt.Errorf("matrix: room id is required")
	}
	path := "/_matrix/client/v3/join/" + roomID
	var out joinRoomResult
	if err := c.doAuthorizedJSON(ctx, http.MethodPost, path, accessToken, map[string]any{}, &out); err != nil {
		return err
	}
	return nil
}
