package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// requireMeetingProject holds a meeting's project to the rule a task's
// project follows (TaskService.normalizeProjectID): a project of the
// meeting's own workspace, or none. Without it any project id - another
// organization's included - is stored and shown to every reader of the
// meeting (ADR 0008 isolation matrix).
func (s *MeetingService) requireMeetingProject(ctx context.Context, orgID, workspaceID, projectID string) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil
	}
	if _, err := s.q.GetProject(ctx, db.GetProjectParams{
		ID: projectID, OrganizationID: orgID, WorkspaceID: workspaceID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	return nil
}
