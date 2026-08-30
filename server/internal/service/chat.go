package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type ChatService struct {
	q      *db.Queries
	matrix MatrixClient
	ws     *WorkspaceService
}

func NewChatService(q *db.Queries, matrix MatrixClient, ws *WorkspaceService) *ChatService {
	return &ChatService{q: q, matrix: matrix, ws: ws}
}

type WorkspaceChat struct {
	RoomID      string
	WorkspaceID string
}

// WorkspaceChatStatus is returned by GET when the caller may read room state
// without treating "not provisioned yet" as an HTTP error.
type WorkspaceChatStatus struct {
	WorkspaceID string
	RoomID      string // empty until the first message creates the room
	Enabled     bool   // false when MATRIX_HOMESERVER_URL is unset on the server
}

// GetWorkspaceRoom returns Matrix room state for a workspace member.
func (s *ChatService) GetWorkspaceRoom(ctx context.Context, userID, workspaceID string) (WorkspaceChatStatus, error) {
	if s.matrix == nil {
		return WorkspaceChatStatus{WorkspaceID: workspaceID, Enabled: false}, nil
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceChatStatus{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return WorkspaceChatStatus{}, ErrNotFound
	}
	status := WorkspaceChatStatus{WorkspaceID: workspaceID, Enabled: true}
	if w.MatrixRoomId.Valid && w.MatrixRoomId.String != "" {
		status.RoomID = w.MatrixRoomId.String
	}
	return status, nil
}

// EnsureWorkspaceRoom creates the room when needed, joins the caller, and invites
// every workspace member who already has a Matrix account.
func (s *ChatService) EnsureWorkspaceRoom(ctx context.Context, userID, workspaceID, matrixAccessToken string) (WorkspaceChat, error) {
	if s.matrix == nil {
		return WorkspaceChat{}, ErrNotFound
	}
	if strings.TrimSpace(matrixAccessToken) == "" {
		return WorkspaceChat{}, Invalid("matrix access token is required")
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceChat{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return WorkspaceChat{}, ErrNotFound
	}
	invitees, err := s.workspaceMatrixInvitees(ctx, workspaceID)
	if err != nil {
		return WorkspaceChat{}, err
	}

	roomID := ""
	if w.MatrixRoomId.Valid && w.MatrixRoomId.String != "" {
		roomID = w.MatrixRoomId.String
	} else {
		alias := strings.ToLower(workspaceID)
		roomID, err = s.matrix.CreateRoom(ctx, matrixAccessToken, w.Name, alias, invitees)
		if err != nil {
			return WorkspaceChat{}, fmt.Errorf("matrix create room: %w", err)
		}
		updated, err := s.q.SetWorkspaceMatrixRoomID(ctx, db.SetWorkspaceMatrixRoomIDParams{
			ID: workspaceID, MatrixRoomID: pgtype.Text{String: roomID, Valid: true},
		})
		if err != nil {
			return WorkspaceChat{}, err
		}
		if updated.MatrixRoomId.Valid {
			roomID = updated.MatrixRoomId.String
		}
		slog.Info("chat: workspace room provisioned", "workspace", workspaceID, "room", roomID, "invited", len(invitees))
	}

	if err := s.syncWorkspaceRoom(ctx, matrixAccessToken, roomID, invitees); err != nil {
		return WorkspaceChat{}, err
	}
	return WorkspaceChat{RoomID: roomID, WorkspaceID: workspaceID}, nil
}

func (s *ChatService) workspaceMatrixInvitees(ctx context.Context, workspaceID string) ([]string, error) {
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(members))
	for _, m := range members {
		u, err := s.q.GetUserByID(ctx, m.UserID)
		if err != nil || !u.MatrixUserId.Valid || u.MatrixUserId.String == "" {
			continue
		}
		id := strings.TrimSpace(u.MatrixUserId.String)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

// ChatUserProfile is a UniWork user resolved for cross-workspace DM.
type ChatUserProfile struct {
	UserID       string
	Email        string
	DisplayName  string
	MatrixUserID string
	MatrixReady  bool
}

// LookupUserByEmail finds a UniWork user by exact email for starting a DM.
// Any authenticated user may look up any other user (not limited to workspace).
func (s *ChatService) LookupUserByEmail(ctx context.Context, callerID, email string) (ChatUserProfile, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return ChatUserProfile{}, Invalid("email không hợp lệ")
	}
	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatUserProfile{}, ErrNotFound
	}
	if err != nil {
		return ChatUserProfile{}, err
	}
	return userToChatProfile(u, callerID)
}

// LookupUserByID resolves a UniWork user by id (for incoming Matrix DMs).
func (s *ChatService) LookupUserByID(ctx context.Context, callerID, targetUserID string) (ChatUserProfile, error) {
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" {
		return ChatUserProfile{}, Invalid("user id is required")
	}
	u, err := s.q.GetUserByID(ctx, targetUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatUserProfile{}, ErrNotFound
	}
	if err != nil {
		return ChatUserProfile{}, err
	}
	return userToChatProfile(u, callerID)
}

func userToChatProfile(u db.User, callerID string) (ChatUserProfile, error) {
	if u.ID == callerID {
		return ChatUserProfile{}, Invalid("không thể nhắn tin với chính mình")
	}
	out := ChatUserProfile{UserID: u.ID, Email: u.Email, DisplayName: u.DisplayName}
	if u.MatrixUserId.Valid && strings.TrimSpace(u.MatrixUserId.String) != "" {
		out.MatrixUserID = strings.TrimSpace(u.MatrixUserId.String)
		out.MatrixReady = true
	}
	return out, nil
}

func (s *ChatService) syncWorkspaceRoom(ctx context.Context, accessToken, roomID string, invitees []string) error {
	if err := s.matrix.JoinRoom(ctx, accessToken, roomID); err != nil {
		slog.Warn("chat: matrix join room failed", "room", roomID, "err", err)
	}
	for _, matrixUserID := range invitees {
		if err := s.matrix.InviteUser(ctx, accessToken, roomID, matrixUserID); err != nil {
			slog.Warn("chat: matrix invite failed", "room", roomID, "user", matrixUserID, "err", err)
		}
	}
	return nil
}
