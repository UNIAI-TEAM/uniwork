package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/matrix"
)

// MatrixClient talks to Synapse for user provisioning and chat rooms.
// nil disables Matrix side-effects (tests, deployments without Synapse).
type MatrixClient interface {
	RegisterUser(ctx context.Context, username, password string) (matrix.RegisterResult, error)
	Login(ctx context.Context, username, password string) (matrix.LoginResult, error)
	CreateRoom(ctx context.Context, accessToken, name, aliasLocalpart string, invitees []string) (string, error)
	JoinRoom(ctx context.Context, accessToken, roomID string) error
	InviteUser(ctx context.Context, accessToken, roomID, matrixUserID string) error
}

// MatrixCredentials is returned to the client after UniWork auth succeeds.
type MatrixCredentials struct {
	UserID      string
	AccessToken string
	DeviceID    string
	HomeServer  string
	BaseURL     string
}
