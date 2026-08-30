package matrix

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type inviteReq struct {
	UserID string `json:"user_id"`
}

// InviteUser invites a Matrix user into a room. Duplicate invites are ignored.
func (c *Client) InviteUser(ctx context.Context, accessToken, roomID, matrixUserID string) error {
	accessToken = strings.TrimSpace(accessToken)
	roomID = strings.TrimSpace(roomID)
	matrixUserID = strings.TrimSpace(matrixUserID)
	if accessToken == "" {
		return fmt.Errorf("matrix: access token is required")
	}
	if roomID == "" || matrixUserID == "" {
		return fmt.Errorf("matrix: room id and user id are required")
	}
	path := "/_matrix/client/v3/rooms/" + roomID + "/invite"
	err := c.doAuthorizedJSON(ctx, http.MethodPost, path, accessToken, inviteReq{UserID: matrixUserID}, nil)
	if err == nil {
		return nil
	}
	if he, ok := err.(*HTTPError); ok && (he.Status == http.StatusForbidden || he.Status == http.StatusConflict) {
		return nil
	}
	return err
}
