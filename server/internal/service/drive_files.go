package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

const (
	// driveMaxLinkBatch is the maximum number of Drive files per Link or CreateTask call (spec §7.2).
	driveMaxLinkBatch = 20
	// driveMetadataRefreshInterval is the minimum interval between opportunistic
	// metadata refreshes for a single file on list/detail/card reads (spec §6.2).
	driveMetadataRefreshInterval = 10 * time.Minute
	// driveDefaultListLimit and driveMaxListLimit bound GET .../drive-files pages.
	driveDefaultListLimit int32 = 50
	driveMaxListLimit     int32 = 100
)

// Drive file link outcomes (spec §7.2, sdo/drive_codes.go).
const (
	DriveFileLinkOutcomeLinked        = "linked"
	DriveFileLinkOutcomeAlreadyLinked = "already_linked"
	DriveFileLinkOutcomeError         = "error"
)

// Drive viewer access states (spec §6.3, §7.3, §7.4, sdo/drive_codes.go).
const (
	DriveViewerAccessGranted        = "granted"
	DriveViewerAccessLost           = "lost"
	DriveViewerAccessUnknown        = "unknown"
	DriveViewerAccessConnectionLost = "connection_lost"
)

// Drive sharing states (spec §6.2, sdo/drive_codes.go).
const (
	DriveSharingStatePrivate = "private"
	DriveSharingStateShared  = "shared"
	DriveSharingStateUnknown = "unknown"
)

// CreateTaskDriveFileInput is one Google Drive file reference attached inside
// CreateTaskInput.DriveFiles (spec §7.2, contract B4).
type CreateTaskDriveFileInput struct {
	ConnectionID   string
	ExternalFileID string
}

// LinkDriveFilesInput is the input to DriveFileService.Link (POST /workspaces/{ws}/drive-files).
type LinkDriveFilesInput struct {
	ConnectionID    string
	ExternalFileIDs []string
	TaskID          *string
}

// ListDriveFilesFilter narrows DriveFileService.ListMine (GET /workspaces/{ws}/drive-files).
type ListDriveFilesFilter struct {
	ConnectionID string
	Cursor       string
	Limit        int32
}

// DriveLinkedTaskRef is a compact reference to a task visible to the viewer (spec §7.6, §7.7, §8.8).
type DriveLinkedTaskRef struct {
	TaskID     string
	Identifier string
	Title      string
	Status     string
}

// DriveTasksCreatedSummary summarizes tasks created from a Drive file via UNI proposals (spec §8.8).
type DriveTasksCreatedSummary struct {
	Count             int64
	LastCreatedAt     *time.Time
	LastCreatedByName *string
}

// DriveTaskCreationGroup is one proposal conversion batch in task_creations / prior_creations (spec §8.8).
type DriveTaskCreationGroup struct {
	ProposalID    string
	CreatedAt     time.Time
	CreatedByID   string
	CreatedByName string
	Tasks         []DriveLinkedTaskRef
}

// DriveFileView is the service-layer representation of sdo.DriveFileDTO (spec §6.2, §7.6, §7.7, §8.8).
type DriveFileView struct {
	ID                     string
	OrganizationID         string
	WorkspaceID            string
	ExternalFileID         string
	DriveID                *string
	Name                   string
	MimeType               string
	IconKind               string
	WebViewLink            string
	OpenURL                string
	OwnerDisplay           string
	DriveModifiedAt        *time.Time
	DriveModifiedByDisplay string
	SharingState           string
	SharedUserCount        *int
	ConnectionID           string
	BoundAccountEmail      string
	BoundConnectionLost    bool
	AccessLostAt           *time.Time
	BoundByID              string
	BoundByName            string
	CreatedBy              string
	CreatedByKind          string
	CreatedByName          string
	CreatedAt              time.Time
	UpdatedAt              time.Time
	MetadataRefreshedAt    *time.Time
	ViewerAccess           string
	ViewerConnectionID     *string
	ViewerAccountEmail     string
	CanUnlink              bool
	CanRebind              bool
	CanPropose             bool
	CanAsk                 bool
	UsedInCount            int64
	UsedInTasks            []DriveLinkedTaskRef
	TasksCreated           DriveTasksCreatedSummary
	TaskCreations          []DriveTaskCreationGroup
}

// DriveFileListResult is the service-layer representation of sdo.DriveFileListSDO (spec §7.6).
type DriveFileListResult struct {
	Files      []DriveFileView
	TotalCount int64
	NextCursor *string
}

// DriveFileLinkReceiptView is the privacy-safe receipt returned inside DriveFileLinkItemResult
// (spec §7.2, contract R1-1 / R1-13). It carries only file identity, display metadata, and the
// caller's own viewer access/account — never another member's bound_account_email, bound_by_*,
// or created_by_*.
type DriveFileLinkReceiptView struct {
	ID                 string
	WorkspaceID        string
	ExternalFileID     string
	DriveID            *string
	Name               string
	MimeType           string
	IconKind           string
	SharingState       string
	WebViewLink        string
	OpenURL            string
	ViewerAccess       string
	ViewerConnectionID *string
	ViewerAccountEmail string
}

// DriveFileLinkItemResult is the per-file result of DriveFileService.Link (spec §7.2).
type DriveFileLinkItemResult struct {
	ExternalFileID string
	Outcome        string
	File           *DriveFileLinkReceiptView
	AccountEmail   string
	ErrorCode      string
	ErrorMessage   string
}

// DriveTaskFileCardView is one Google Drive card in a task's Attachments section
// (GET /api/v1/tasks/{taskID}/drive-files; spec §7.3, §8.8).
type DriveTaskFileCardView struct {
	ID                     string
	TaskID                 string
	WorkspaceID            string
	ExternalFileID         string
	DriveID                *string
	Name                   string
	MimeType               string
	IconKind               string
	SharingState           string
	OwnerDisplay           string
	DriveModifiedAt        *time.Time
	DriveModifiedByDisplay string
	ConnectionID           string
	BoundAccountEmail      string
	BoundConnectionLost    bool
	AccessLostAt           *time.Time
	BoundByID              string
	BoundByName            string
	CreatedBy              string
	CreatedByName          string
	LinkedAt               time.Time
	ViewerAccess           string
	ViewerConnectionID     *string
	ViewerAccountEmail     string
	OpenURL                string
	CanRemoveFromTask      bool
	CanPropose             bool
	CanAsk                 bool
	TasksCreated           DriveTasksCreatedSummary
}

// DrivePickerTokenView is the service-layer representation of sdo.DrivePickerTokenSDO (spec §7.1).
type DrivePickerTokenView struct {
	AccessToken  string
	ExpiresAt    time.Time
	DeveloperKey string
	AppID        string
}

// DriveTaskAccessPolicy allows tests or future task-level visibility rules to
// customize which tasks in a workspace a viewer can see or edit (spec §7.6a).
type DriveTaskAccessPolicy struct {
	CanViewTask func(ctx context.Context, userID string, member db.WorkspaceMember, taskID string) bool
	CanEditTask func(ctx context.Context, userID string, member db.WorkspaceMember, taskID string) bool
}

// DriveTaskCreationsLoader is the seam populated in B6 (UNI-2182, spec §8.8) to
// load tasks_created summaries and task_creations groups from drive_task_proposal_links.
type DriveTaskCreationsLoader interface {
	LoadTasksCreatedSummaries(ctx context.Context, viewerID string, member db.WorkspaceMember, ws db.Workspace, externalFileIDs []string) (map[string]DriveTasksCreatedSummary, error)
	LoadTaskCreationGroups(ctx context.Context, viewerID string, member db.WorkspaceMember, ws db.Workspace, externalFileID string, limit int) ([]DriveTaskCreationGroup, error)
}

// DriveFileService manages Google Drive file references, per-user access rows,
// task links, rebind, metadata refresh, and the real driveFileAccessLookup for
// DriveContentService.ReadForAI (spec §6.2–§6.4, §7.1–§7.8, §7.6a, ADR 0047).
type DriveFileService struct {
	pool              *pgxpool.Pool
	q                 *db.Queries
	ws                *WorkspaceService
	connections       *DriveConnectionService
	api               *DriveAPIClient
	flags             *featureflag.Service
	log               *slog.Logger
	now               func() time.Time
	aiEnabled         func() bool
	taskPolicy        DriveTaskAccessPolicy
	creations         DriveTaskCreationsLoader
	testAfterLinkLock func(workspaceID, externalFileID string)
}

// NewDriveFileService constructs a DriveFileService.
func NewDriveFileService(
	pool *pgxpool.Pool,
	q *db.Queries,
	ws *WorkspaceService,
	connections *DriveConnectionService,
	api *DriveAPIClient,
) *DriveFileService {
	var poolRef *pgxpool.Pool
	if pool != nil {
		poolRef = pool
	} else if ws != nil {
		poolRef = ws.pool
	}
	if api == nil {
		api = NewDriveAPIClient()
	}
	var flags *featureflag.Service
	if connections != nil {
		flags = connections.flags
	}
	return &DriveFileService{
		pool:        poolRef,
		q:           q,
		ws:          ws,
		connections: connections,
		api:         api,
		flags:       flags,
		log:         slog.Default(),
		now:         time.Now,
	}
}

// SetLogger sets the structured logger (logs by ID only, never email or file names).
func (s *DriveFileService) SetLogger(log *slog.Logger) {
	if s != nil && log != nil {
		s.log = log
	}
}

// SetFlags wires the feature flag service used to evaluate drive_connector.
func (s *DriveFileService) SetFlags(flags *featureflag.Service) {
	if s != nil {
		s.flags = flags
	}
}

// SetAPIClient overrides the DriveAPIClient (used by tests).
func (s *DriveFileService) SetAPIClient(api *DriveAPIClient) {
	if s != nil && api != nil {
		s.api = api
	}
}

// SetAIEnabled wires the function reporting whether AI capabilities (Ask UNI /
// task proposals) are enabled for computing can_propose and can_ask.
func (s *DriveFileService) SetAIEnabled(fn func() bool) {
	if s != nil {
		s.aiEnabled = fn
	}
}

// SetTaskAccessPolicy overrides the task visibility and editability policy (used by tests).
func (s *DriveFileService) SetTaskAccessPolicy(p DriveTaskAccessPolicy) {
	if s != nil {
		s.taskPolicy = p
	}
}

// SetTaskCreationsLoader wires the B6 loader for tasks_created and task_creations (spec §8.8).
func (s *DriveFileService) SetTaskCreationsLoader(l DriveTaskCreationsLoader) {
	if s != nil {
		s.creations = l
	}
}

func (s *DriveFileService) nowUTC() time.Time {
	if s != nil && s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func (s *DriveFileService) isAIEnabled() bool {
	if s != nil && s.aiEnabled != nil {
		return s.aiEnabled()
	}
	return true
}

func (s *DriveFileService) flagEnabledForMember(ctx context.Context, userID, orgID string) bool {
	if s == nil {
		return false
	}
	ec := featureflag.EvalContext{UserID: userID, OrganizationID: orgID}
	evalCtx := featureflag.WithEvalContext(ctx, ec)
	def := driveConnectorFlagDefault()
	if s.flags != nil {
		if !s.flags.IsEnabled(evalCtx, "drive_connector", def) {
			return false
		}
		if s.connections != nil && s.connections.flags != nil && s.connections.flags != s.flags {
			return s.connections.flags.IsEnabled(evalCtx, "drive_connector", def)
		}
		return true
	}
	if s.connections != nil && s.connections.flags != nil {
		return s.connections.flags.IsEnabled(evalCtx, "drive_connector", def)
	}
	return false
}

func (s *DriveFileService) workspaceAndMember(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, db.WorkspaceMember, error) {
	if actor.Kind != audit.KindHuman {
		return db.Workspace{}, db.WorkspaceMember{}, ErrForbidden
	}
	member, err := s.ws.RequireMember(ctx, workspaceID, actor.ID)
	if err != nil {
		return db.Workspace{}, db.WorkspaceMember{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, db.WorkspaceMember{}, ErrNotFound
	}
	if err != nil {
		return db.Workspace{}, db.WorkspaceMember{}, err
	}
	return ws, member, nil
}

func (s *DriveFileService) isNotGuest(member db.WorkspaceMember) bool {
	role := strings.ToLower(strings.TrimSpace(member.Role))
	return role == "owner" || role == "admin" || role == "member"
}

func (s *DriveFileService) canViewTask(ctx context.Context, userID string, member db.WorkspaceMember, taskID string) bool {
	if s != nil && s.taskPolicy.CanViewTask != nil {
		return s.taskPolicy.CanViewTask(ctx, userID, member, taskID)
	}
	return member.Role != ""
}

func (s *DriveFileService) canEditTask(ctx context.Context, userID string, member db.WorkspaceMember, taskID string) bool {
	if s != nil && s.taskPolicy.CanEditTask != nil {
		return s.taskPolicy.CanEditTask(ctx, userID, member, taskID)
	}
	return s.isNotGuest(member)
}

func canManageDriveFile(userID string, member db.WorkspaceMember, f db.DriveFile) bool {
	if userID == "" {
		return false
	}
	if userID == f.CreatedBy || userID == f.BoundBy {
		return true
	}
	return member.Role == "owner" || member.Role == "admin"
}

// requireCallerConnection loads connectionID owned by userID in orgID and
// verifies it is active (not disconnected, and auth_failed_at is not set).
func (s *DriveFileService) requireCallerConnection(ctx context.Context, q *db.Queries, orgID, userID, connectionID string) (db.DriveConnection, error) {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return db.DriveConnection{}, ErrNotFound
	}
	conn, err := q.GetDriveConnection(ctx, db.GetDriveConnectionParams{
		ID:             connectionID,
		OrganizationID: orgID,
		UserID:         userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveConnection{}, ErrNotFound
	}
	if err != nil {
		return db.DriveConnection{}, err
	}
	if conn.AuthFailedAt.Valid {
		return db.DriveConnection{}, DriveErrToCodedError(ErrDriveReauthRequired)
	}
	return conn, nil
}

func (s *DriveFileService) attachTaskLinkOnLinkInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor Actor,
	ws db.Workspace,
	fileRow db.DriveFile,
	taskID string,
	viewerEmail string,
) error {
	_, lerr := qtx.CreateDriveFileTaskLink(ctx, db.CreateDriveFileTaskLinkParams{
		ID:             util.NewID(),
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    fileRow.ID,
		TaskID:         taskID,
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
	})
	if lerr != nil && !errors.Is(lerr, pgx.ErrNoRows) {
		return lerr
	}
	if lerr == nil {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    ws.ID,
			Actor:          actor,
			Action:         audit.ActionTaskDriveFileLinked,
			ResourceType:   "task",
			ResourceID:     taskID,
			Metadata: map[string]any{
				"drive_file_id":   fileRow.ID,
				"drive_file_name": fileRow.Name,
				"google_email":    viewerEmail,
			},
		}, audit.Event{
			Topic:   "drive_file.task_linked",
			Version: 1,
			Payload: map[string]string{
				"drive_file_id": fileRow.ID,
				"task_id":       taskID,
				"workspace_id":  ws.ID,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// RemoveFromTask removes the link between taskID and driveFileID without
// unlinking the file from the workspace
// (DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID};
// spec §6.4, §7.3, §11, W4 gaps §2).
func (s *DriveFileService) RemoveFromTask(ctx context.Context, actor Actor, taskID, driveFileID string) error {
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	taskID = strings.TrimSpace(taskID)
	driveFileID = strings.TrimSpace(driveFileID)
	if taskID == "" || driveFileID == "" {
		return ErrNotFound
	}
	task, err := s.q.GetTask(ctx, taskID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	member, err := s.ws.RequireMember(ctx, task.WorkspaceID, actor.ID)
	if err != nil {
		return err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, task.OrganizationID) {
		return errDriveFeatureDisabled()
	}
	if !s.canViewTask(ctx, actor.ID, member, task.ID) {
		return ErrNotFound
	}
	if !s.canEditTask(ctx, actor.ID, member, task.ID) {
		return ErrForbidden
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	fileRow, err := qtx.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             driveFileID,
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if _, err := qtx.DeleteDriveFileTaskLink(ctx, db.DeleteDriveFileTaskLinkParams{
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		TaskID:         task.ID,
		DriveFileID:    fileRow.ID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	var googleEmail string
	if callerAcc, aerr := qtx.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		DriveFileID:    fileRow.ID,
		UserID:         actor.ID,
	}); aerr == nil {
		if c, cerr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
			ID:             callerAcc.ConnectionID,
			OrganizationID: task.OrganizationID,
			UserID:         actor.ID,
		}); cerr == nil {
			googleEmail = c.GoogleEmail
		}
	}
	if googleEmail == "" {
		if bc, berr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
			ID:             fileRow.ConnectionID,
			OrganizationID: task.OrganizationID,
			UserID:         fileRow.BoundBy,
		}); berr == nil {
			googleEmail = bc.GoogleEmail
		}
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: task.OrganizationID,
		WorkspaceID:    task.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionTaskDriveFileUnlinked,
		ResourceType:   "task",
		ResourceID:     task.ID,
		Metadata: map[string]any{
			"drive_file_id":   fileRow.ID,
			"drive_file_name": fileRow.Name,
			"google_email":    googleEmail,
		},
	}, audit.Event{
		Topic:   "drive_file.task_linked",
		Version: 1,
		Payload: map[string]string{
			"drive_file_id": fileRow.ID,
			"task_id":       task.ID,
			"workspace_id":  task.WorkspaceID,
		},
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
