package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

const (
	driveMaxProposalPromptRunes     = 500
	driveMaxProposalDuplicateChecks = 20
	driveProposalTTL                = 7 * 24 * time.Hour
)

// Drive task proposal error sentinels (spec §8.2b, §8.3, seam §3).
var (
	ErrDriveProposalNotReady             = errors.New("proposal_not_ready")
	ErrDriveProposalExpired              = errors.New("proposal_expired")
	ErrDriveProposalItemAlreadyConverted = errors.New("proposal_item_already_converted")
)

// DriveProposalMetrics records Prometheus counters for Drive task proposals (spec §10).
type DriveProposalMetrics interface {
	ObserveTaskProposal(result string)
}

// ProposeDriveTasksInput carries the optional prompt and context IDs for
// POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals (spec §8.2).
type ProposeDriveTasksInput struct {
	Prompt        string
	ProjectID     *string
	ParentTaskID  *string
	ContextTaskID *string
	Locale        string
}

// CheckDriveProposalDuplicatesInput carries the target project/parent and item titles
// for POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/duplicates (spec §8.4).
type CheckDriveProposalDuplicatesInput struct {
	ProjectID    *string
	ParentTaskID *string
	Titles       []string
}

// DriveProposalDuplicateItem pairs an item index with its open duplicate match, if any (spec §8.4).
type DriveProposalDuplicateItem struct {
	Index             int
	PossibleDuplicate *DriveDuplicateTask
}

// DriveTaskProposalView is the service-layer representation of a Drive task
// proposal batch returned on POST .../task-proposals and GET .../drive-task-proposals/{proposalID} (spec §8.2, §8.3).
type DriveTaskProposalView struct {
	ID                 string
	WorkspaceID        string
	DriveFileID        string
	DriveFileName      string
	DriveFileMimeType  string
	DriveFileIconKind  string
	SharingState       string
	ConnectionID       string
	ReaderAccountEmail string
	RequestedBy        string
	Prompt             string
	ProjectID          *string
	ParentTaskID       *string
	ContextTaskID      *string
	Truncated          bool
	Status             string
	Items              []DriveTaskProposalItem
	TasksCreated       DriveTasksCreatedSummary
	PriorCreations     []DriveTaskCreationGroup
	CreatedAt          time.Time
	ExpiresAt          time.Time
}

// DriveTaskProposalService manages Google Drive task proposal batches (UNI-2181, spec §6.5, §8.1–§8.4).
type DriveTaskProposalService struct {
	pool        *pgxpool.Pool
	q           *db.Queries
	ws          *WorkspaceService
	files       *DriveFileService
	tasks       *TaskService
	connections *DriveConnectionService
	content     DriveContentReader
	ai          *ai.Gateway
	flags       *featureflag.Service
	metrics     DriveProposalMetrics
	log         *slog.Logger
	creations   DriveTaskCreationsLoader
	now         func() time.Time

	// testBeforeProposalCommit runs in tests right before Step 6's transaction
	// opens so concurrent disconnect/unlink/rebind races are deterministic.
	testBeforeProposalCommit func(ctx context.Context)
}

// NewDriveTaskProposalService constructs a DriveTaskProposalService.
func NewDriveTaskProposalService(
	pool *pgxpool.Pool,
	q *db.Queries,
	ws *WorkspaceService,
	files *DriveFileService,
	connections *DriveConnectionService,
	content DriveContentReader,
	gateway *ai.Gateway,
) *DriveTaskProposalService {
	return &DriveTaskProposalService{
		pool:        pool,
		q:           q,
		ws:          ws,
		files:       files,
		connections: connections,
		content:     content,
		ai:          gateway,
		log:         slog.Default(),
		now:         time.Now,
	}
}

// SetFlags attaches the feature flag service used to evaluate drive_connector.
func (s *DriveTaskProposalService) SetFlags(flags *featureflag.Service) {
	if s != nil {
		s.flags = flags
	}
}

// SetLogger sets the structured logger used by DriveTaskProposalService.
func (s *DriveTaskProposalService) SetLogger(log *slog.Logger) {
	if s != nil && log != nil {
		s.log = log
	}
}

// SetMetrics attaches the Prometheus counter collector for Drive task proposals.
func (s *DriveTaskProposalService) SetMetrics(m DriveProposalMetrics) {
	if s != nil {
		s.metrics = m
	}
}

// SetTaskCreationsLoader attaches the B6 loader for tasks_created and prior_creations (§8.8, seam A2).
func (s *DriveTaskProposalService) SetTaskCreationsLoader(loader DriveTaskCreationsLoader) {
	if s != nil {
		s.creations = loader
	}
}

// SetTasks attaches the TaskService used by CreateTasksFromProposal (B6, spec §8.5).
func (s *DriveTaskProposalService) SetTasks(tasks *TaskService) {
	if s != nil {
		s.tasks = tasks
	}
}

// SetDriveContentReader overrides the DriveContentReader (used in tests).
func (s *DriveTaskProposalService) SetDriveContentReader(r DriveContentReader) {
	if s != nil {
		s.content = r
	}
}

func (s *DriveTaskProposalService) nowUTC() time.Time {
	if s != nil && s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func (s *DriveTaskProposalService) observeResult(result string) {
	if s != nil && s.metrics != nil && result != "" {
		s.metrics.ObserveTaskProposal(result)
	}
}

func (s *DriveTaskProposalService) flagEnabledForMember(ctx context.Context, userID, orgID string) bool {
	if s == nil {
		return false
	}
	if s.files != nil {
		return s.files.flagEnabledForMember(ctx, userID, orgID)
	}
	evalCtx := featureflag.WithEvalContext(ctx, featureflag.EvalContext{
		UserID:         userID,
		OrganizationID: orgID,
	})
	if s.flags != nil {
		return s.flags.IsEnabled(evalCtx, "drive_connector", false)
	}
	if s.connections != nil && s.connections.flags != nil {
		return s.connections.flags.IsEnabled(evalCtx, "drive_connector", false)
	}
	return false
}

func (s *DriveTaskProposalService) workspaceAndMember(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, db.WorkspaceMember, error) {
	if actor.Kind != audit.KindHuman {
		return db.Workspace{}, db.WorkspaceMember{}, ErrForbidden
	}
	if s == nil || s.ws == nil || s.q == nil {
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

func (s *DriveTaskProposalService) workspaceAndMemberForProposal(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, db.WorkspaceMember, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return db.Workspace{}, db.WorkspaceMember{}, ErrNotFound
		}
		return db.Workspace{}, db.WorkspaceMember{}, err
	}
	return ws, member, nil
}

// AuthorizeHistory enforces the §7.6a / §8.2a requester-only gate on
// GET /api/v1/workspaces/{workspaceID}/resources/drive_task_proposal/{proposalID}/history.
func (s *DriveTaskProposalService) AuthorizeHistory(ctx context.Context, userID, workspaceID, proposalID string) error {
	if s == nil || s.q == nil {
		return ErrNotFound
	}
	_, err := s.requireOwnProposalQ(ctx, s.q, userID, workspaceID, proposalID)
	return err
}

// requireOwnProposalQ loads a proposal in workspaceID after verifying actorID is a
// workspace member, and enforces p.RequestedBy == actorID (seam §3 + A3, spec §8.2a).
// Any proposal miss or peer access returns ErrNotFound so foreign/peer IDs never
// act as an existence oracle. Does not open a transaction or savepoint.
func (s *DriveTaskProposalService) requireOwnProposalQ(
	ctx context.Context,
	q *db.Queries,
	actorID, workspaceID, proposalID string,
) (db.DriveTaskProposal, error) {
	if s == nil || s.ws == nil || q == nil {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actorID); err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return db.DriveTaskProposal{}, ErrNotFound
		}
		return db.DriveTaskProposal{}, err
	}
	ws, err := q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	if err != nil {
		return db.DriveTaskProposal{}, err
	}
	proposalID = strings.TrimSpace(proposalID)
	if proposalID == "" {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	p, err := q.GetDriveTaskProposalForWorkspace(ctx, db.GetDriveTaskProposalForWorkspaceParams{
		ID:             proposalID,
		WorkspaceID:    ws.ID,
		OrganizationID: ws.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	if err != nil {
		return db.DriveTaskProposal{}, err
	}
	if p.RequestedBy != actorID {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	return p, nil
}

// lockSourceForProposalQ locks the proposal's Drive connection, Drive file,
// requester's drive_file_access, and proposal row FOR UPDATE in the §8.2b lock
// order using only the caller's q (seam §3 + A3). Returns ErrDriveSourceChanged
// (409 drive_source_changed) if the file was unlinked, the requester's access is
// no longer granted on p.ConnectionID, or the connection was disconnected / auth_failed.
func (s *DriveTaskProposalService) lockSourceForProposalQ(
	ctx context.Context,
	q *db.Queries,
	p db.DriveTaskProposal,
) (db.DriveTaskProposal, error) {
	if q == nil {
		return db.DriveTaskProposal{}, errDriveSourceChanged()
	}
	conn, err := q.GetDriveConnectionForShare(ctx, db.GetDriveConnectionForShareParams{
		ID:             p.ConnectionID,
		OrganizationID: p.OrganizationID,
		UserID:         p.RequestedBy,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.DriveTaskProposal{}, errDriveSourceChanged()
		}
		return db.DriveTaskProposal{}, err
	}
	if conn.AuthFailedAt.Valid {
		return db.DriveTaskProposal{}, errDriveSourceChanged()
	}
	if _, err := q.GetActiveDriveFileByIDForShare(ctx, db.GetActiveDriveFileByIDForShareParams{
		ID:             p.DriveFileID,
		OrganizationID: p.OrganizationID,
		WorkspaceID:    p.WorkspaceID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.DriveTaskProposal{}, errDriveSourceChanged()
		}
		return db.DriveTaskProposal{}, err
	}
	access, err := q.GetDriveFileAccessByUserForUpdate(ctx, db.GetDriveFileAccessByUserForUpdateParams{
		OrganizationID: p.OrganizationID,
		WorkspaceID:    p.WorkspaceID,
		DriveFileID:    p.DriveFileID,
		UserID:         p.RequestedBy,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.DriveTaskProposal{}, errDriveSourceChanged()
		}
		return db.DriveTaskProposal{}, err
	}
	if access.State != "granted" || access.ConnectionID != p.ConnectionID {
		return db.DriveTaskProposal{}, errDriveSourceChanged()
	}
	locked, err := q.LockDriveTaskProposalForUpdate(ctx, db.LockDriveTaskProposalForUpdateParams{
		ID:             p.ID,
		WorkspaceID:    p.WorkspaceID,
		OrganizationID: p.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveTaskProposal{}, ErrNotFound
	}
	if err != nil {
		return db.DriveTaskProposal{}, err
	}
	return locked, nil
}

// Propose extracts up to 20 proposed tasks from a linked Google Drive file using
// the caller's own Drive connection and stores a 7-day ready proposal batch (spec §8.2).
func (s *DriveTaskProposalService) Propose(
	ctx context.Context,
	actor Actor,
	workspaceID, driveFileID string,
	in ProposeDriveTasksInput,
) (DriveTaskProposalView, error) {
	ws, member, err := s.workspaceAndMember(ctx, actor, workspaceID)
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveTaskProposalView{}, errDriveFeatureDisabled()
	}
	driveFileID = strings.TrimSpace(driveFileID)
	if driveFileID == "" {
		return DriveTaskProposalView{}, ErrNotFound
	}
	if _, err := s.q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DriveTaskProposalView{}, ErrNotFound
		}
		return DriveTaskProposalView{}, err
	}

	prompt := strings.TrimSpace(in.Prompt)
	if utf8.RuneCountInString(prompt) > driveMaxProposalPromptRunes {
		s.observeResult("invalid_request")
		return DriveTaskProposalView{}, Invalid("prompt is at most 500 characters")
	}

	projectID, projectTitle, err := s.validateOptionalProject(ctx, ws.OrganizationID, ws.ID, in.ProjectID)
	if err != nil {
		s.observeResult("invalid_request")
		return DriveTaskProposalView{}, err
	}
	parentTaskID, err := s.validateOptionalTask(ctx, ws.OrganizationID, ws.ID, in.ParentTaskID)
	if err != nil {
		s.observeResult("invalid_request")
		return DriveTaskProposalView{}, err
	}
	contextTaskID, err := s.validateOptionalTask(ctx, ws.OrganizationID, ws.ID, in.ContextTaskID)
	if err != nil {
		s.observeResult("invalid_request")
		return DriveTaskProposalView{}, err
	}

	// Step 1-2 (spec §8.2, R1-4): require a granted drive_file_access row on an
	// active requester-owned connection and snapshot (connection_id, credential_version)
	// BEFORE calling ReadForAI. Missing / not granted / inactive returns 409
	// drive_access_required before any content read; operational lookup errors propagate.
	acc, err := s.q.GetDriveFileAccessByUser(ctx, db.GetDriveFileAccessByUserParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    driveFileID,
		UserID:         actor.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.observeResult("access_required")
			return DriveTaskProposalView{}, DriveErrToCodedError(ErrDriveAccessRequired)
		}
		return DriveTaskProposalView{}, err
	}
	if acc.State != "granted" || strings.TrimSpace(acc.ConnectionID) == "" {
		s.observeResult("access_required")
		return DriveTaskProposalView{}, DriveErrToCodedError(ErrDriveAccessRequired)
	}
	conn, err := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             acc.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         actor.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.observeResult("access_required")
			return DriveTaskProposalView{}, DriveErrToCodedError(ErrDriveAccessRequired)
		}
		return DriveTaskProposalView{}, err
	}
	if conn.UserID != actor.ID || conn.OrganizationID != ws.OrganizationID || conn.DisconnectedAt.Valid || conn.AuthFailedAt.Valid {
		s.observeResult("access_required")
		return DriveTaskProposalView{}, DriveErrToCodedError(ErrDriveAccessRequired)
	}
	initialConnectionID := conn.ID
	initialCredentialVersion := conn.CredentialVersion

	if s.content == nil {
		s.observeResult("drive_error")
		return DriveTaskProposalView{}, DriveErrToCodedError(ErrDriveUnavailable)
	}
	content, err := s.content.ReadForAI(ctx, actor.ID, ws.ID, driveFileID, DriveContentPurposeTaskProposal)
	if err != nil {
		mapped := mapDriveProposalReadError(err)
		s.observeReadError(err, mapped)
		return DriveTaskProposalView{}, mapped
	}
	if s.ai == nil || !s.ai.Enabled() {
		s.observeResult("ai_error")
		return DriveTaskProposalView{}, ai.ErrDisabled
	}

	memberRows, err := s.q.ListDriveProposalWorkspaceMembers(ctx, db.ListDriveProposalWorkspaceMembersParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	memberSet := make(map[string]bool, len(memberRows))
	promptMembers := make([]ai.DriveProposalMember, 0, len(memberRows))
	for _, m := range memberRows {
		memberSet[m.UserID] = true
		promptMembers = append(promptMembers, ai.DriveProposalMember{
			ID:          m.UserID,
			DisplayName: m.DisplayName,
			Email:       m.Email,
		})
	}

	labelRows, err := s.q.ListDriveProposalWorkspaceLabels(ctx, db.ListDriveProposalWorkspaceLabelsParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	labelSet := make(map[string]bool, len(labelRows))
	promptLabels := make([]ai.DriveProposalLabel, 0, len(labelRows))
	for _, l := range labelRows {
		labelSet[l.ID] = true
		promptLabels = append(promptLabels, ai.DriveProposalLabel{
			ID:   l.ID,
			Name: l.Name,
		})
	}

	locale := "vi"
	if strings.EqualFold(strings.TrimSpace(in.Locale), "en") {
		locale = "en"
	}
	ict := time.FixedZone("ICT", 7*3600)
	vars := map[string]any{
		"locale":   locale,
		"today":    s.nowUTC().In(ict).Format("2006-01-02"),
		"title":    content.Name,
		"members":  promptMembers,
		"labels":   promptLabels,
		"document": content.Text,
	}
	if projectTitle != "" {
		vars["project"] = projectTitle
	}
	if prompt != "" {
		vars["prompt"] = prompt
	}

	resp, err := s.ai.Complete(ctx, ai.Request{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Capability:     ai.CapDriveTaskProposals,
		PromptID:       ai.PromptDriveTaskProposals,
		Vars:           vars,
		Attachments:    content.Attachments,
		Truncated:      content.Truncated,
		Sources: []ai.Source{{
			Kind:  "drive_file",
			ID:    driveFileID,
			Title: content.Name,
		}},
	})
	if err != nil {
		s.observeAIError(err)
		return DriveTaskProposalView{}, err
	}

	rawItems, err := parseDriveProposalRawItems(resp.Text)
	if err != nil {
		s.observeResult("ai_error")
		return DriveTaskProposalView{}, ai.ErrOutputInvalid
	}

	items := normalizeDriveProposalItems(rawItems, memberSet, labelSet)

	if s.testBeforeProposalCommit != nil {
		s.testBeforeProposalCommit(ctx)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	// Step 6 (§8.2b): lock connection -> file -> caller's drive_file_access FOR UPDATE
	// and abort with 409 drive_source_changed if any changed while the AI call was in flight.
	if initialConnectionID == "" {
		s.observeResult("source_changed")
		return DriveTaskProposalView{}, errDriveSourceChanged()
	}
	lockedConn, err := qtx.GetDriveConnectionForShare(ctx, db.GetDriveConnectionForShareParams{
		ID:             initialConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         actor.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.observeResult("source_changed")
			return DriveTaskProposalView{}, errDriveSourceChanged()
		}
		return DriveTaskProposalView{}, err
	}
	if lockedConn.AuthFailedAt.Valid || lockedConn.CredentialVersion != initialCredentialVersion {
		s.observeResult("source_changed")
		return DriveTaskProposalView{}, errDriveSourceChanged()
	}
	lockedFile, err := qtx.GetActiveDriveFileByIDForShare(ctx, db.GetActiveDriveFileByIDForShareParams{
		ID:             driveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.observeResult("source_changed")
			return DriveTaskProposalView{}, errDriveSourceChanged()
		}
		return DriveTaskProposalView{}, err
	}
	lockedAccess, err := qtx.GetDriveFileAccessByUserForUpdate(ctx, db.GetDriveFileAccessByUserForUpdateParams{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		DriveFileID:    lockedFile.ID,
		UserID:         actor.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.observeResult("source_changed")
			return DriveTaskProposalView{}, errDriveSourceChanged()
		}
		return DriveTaskProposalView{}, err
	}
	if lockedAccess.State != "granted" || lockedAccess.ConnectionID != initialConnectionID {
		s.observeResult("source_changed")
		return DriveTaskProposalView{}, errDriveSourceChanged()
	}

	if err := enrichDriveProposalItemsQ(ctx, qtx, ws.OrganizationID, ws.ID, lockedFile.ID, projectID, parentTaskID, items); err != nil {
		return DriveTaskProposalView{}, err
	}

	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return DriveTaskProposalView{}, err
	}

	now := s.nowUTC()
	expiresAt := now.Add(driveProposalTTL)
	row, err := qtx.CreateDriveTaskProposal(ctx, db.CreateDriveTaskProposalParams{
		ID:              util.NewID(),
		OrganizationID:  ws.OrganizationID,
		WorkspaceID:     ws.ID,
		DriveFileID:     lockedFile.ID,
		ConnectionID:    lockedConn.ID,
		RequestedBy:     actor.ID,
		RequestedByKind: string(actor.Kind),
		Prompt:          prompt,
		ProjectID:       optionalText(projectID),
		ParentTaskID:    optionalText(parentTaskID),
		ContextTaskID:   optionalText(contextTaskID),
		Items:           itemsJSON,
		Truncated:       content.Truncated,
		UsageEventID:    resp.UsageEventID,
		Status:          DriveProposalStatusReady,
		ExpiresAt:       pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return DriveTaskProposalView{}, err
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveTaskProposalCreated,
		ResourceType:   "drive_task_proposal",
		ResourceID:     row.ID,
		Metadata: map[string]any{
			"drive_file_id":   lockedFile.ID,
			"drive_file_name": lockedFile.Name,
			"connection_id":   lockedConn.ID,
			"google_email":    lockedConn.GoogleEmail,
			"google_sub":      lockedConn.GoogleSub,
			"item_count":      len(items),
			"truncated":       content.Truncated,
			"usage_event_id":  resp.UsageEventID,
		},
	}); err != nil {
		return DriveTaskProposalView{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DriveTaskProposalView{}, err
	}

	s.observeResult("created")
	summary, groups := s.loadCreations(ctx, actor.ID, member, ws, lockedFile.ExternalFileID)
	return buildDriveTaskProposalView(row, lockedFile, lockedConn.GoogleEmail, items, summary, groups), nil
}

// Get returns a Drive task proposal batch owned by actor in its current state
// (ready, converted, or discarded, including expired-but-ready; items is [] once
// converted or discarded; spec §8.3).
func (s *DriveTaskProposalService) Get(
	ctx context.Context,
	actor Actor,
	workspaceID, proposalID string,
) (DriveTaskProposalView, error) {
	ws, member, err := s.workspaceAndMemberForProposal(ctx, actor, workspaceID)
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return DriveTaskProposalView{}, errDriveFeatureDisabled()
	}
	row, err := s.requireOwnProposalQ(ctx, s.q, actor.ID, ws.ID, proposalID)
	if err != nil {
		return DriveTaskProposalView{}, err
	}
	var items []DriveTaskProposalItem
	if row.Status == DriveProposalStatusReady && len(row.Items) > 0 {
		if err := json.Unmarshal(row.Items, &items); err != nil {
			return DriveTaskProposalView{}, err
		}
	}
	if items == nil {
		items = []DriveTaskProposalItem{}
	}

	if len(items) > 0 {
		if err := refreshAssigneeDriveAccessQ(ctx, s.q, ws.OrganizationID, ws.ID, row.DriveFileID, items); err != nil {
			return DriveTaskProposalView{}, err
		}
	}

	var fileRow db.DriveFile
	if f, ferr := s.q.GetActiveDriveFileByID(ctx, db.GetActiveDriveFileByIDParams{
		ID:             row.DriveFileID,
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
	}); ferr == nil {
		fileRow = f
	}

	var readerEmail string
	if conn, cerr := s.q.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             row.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         row.RequestedBy,
	}); cerr == nil {
		readerEmail = conn.GoogleEmail
	}

	summary, groups := s.loadCreations(ctx, actor.ID, member, ws, fileRow.ExternalFileID)
	return buildDriveTaskProposalView(row, fileRow, readerEmail, items, summary, groups), nil
}

// Discard marks a ready Drive task proposal batch as discarded, clears its items,
// and records drive_task_proposal.discarded (reason = user) in the same transaction.
// Calling Discard on an already converted or discarded proposal is idempotent (204, no audit write; spec §8.3).
func (s *DriveTaskProposalService) Discard(
	ctx context.Context,
	actor Actor,
	workspaceID, proposalID string,
) error {
	ws, _, err := s.workspaceAndMemberForProposal(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return errDriveFeatureDisabled()
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	p, err := s.requireOwnProposalQ(ctx, qtx, actor.ID, ws.ID, proposalID)
	if err != nil {
		return err
	}
	locked, err := qtx.LockDriveTaskProposalForUpdate(ctx, db.LockDriveTaskProposalForUpdateParams{
		ID:             p.ID,
		WorkspaceID:    ws.ID,
		OrganizationID: ws.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if locked.Status != DriveProposalStatusReady {
		return nil
	}

	if _, err := qtx.SetDriveTaskProposalStatus(ctx, db.SetDriveTaskProposalStatusParams{
		ID:             locked.ID,
		WorkspaceID:    ws.ID,
		OrganizationID: ws.OrganizationID,
		Status:         DriveProposalStatusDiscarded,
	}); err != nil {
		return err
	}

	var googleEmail, googleSub string
	if conn, cerr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
		ID:             locked.ConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         locked.RequestedBy,
	}); cerr == nil {
		googleEmail = conn.GoogleEmail
		googleSub = conn.GoogleSub
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveTaskProposalDiscarded,
		ResourceType:   "drive_task_proposal",
		ResourceID:     locked.ID,
		Metadata: map[string]any{
			"drive_file_id": locked.DriveFileID,
			"connection_id": locked.ConnectionID,
			"google_email":  googleEmail,
			"google_sub":    googleSub,
			"reason":        "user",
		},
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// Duplicates re-checks open task duplicate matches when the user edits proposal
// titles or changes the target project / parent task in the review modal (spec §8.4).
func (s *DriveTaskProposalService) Duplicates(
	ctx context.Context,
	actor Actor,
	workspaceID, proposalID string,
	in CheckDriveProposalDuplicatesInput,
) ([]DriveProposalDuplicateItem, error) {
	ws, _, err := s.workspaceAndMemberForProposal(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return nil, errDriveFeatureDisabled()
	}
	if _, err := s.requireOwnProposalQ(ctx, s.q, actor.ID, ws.ID, proposalID); err != nil {
		return nil, err
	}

	if len(in.Titles) == 0 || len(in.Titles) > driveMaxProposalDuplicateChecks {
		return nil, Invalid("titles must contain between 1 and 20 entries")
	}

	projectID, _, err := s.validateOptionalProject(ctx, ws.OrganizationID, ws.ID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	parentTaskID, err := s.validateOptionalTask(ctx, ws.OrganizationID, ws.ID, in.ParentTaskID)
	if err != nil {
		return nil, err
	}

	matches, err := matchDriveProposalDuplicatesQ(ctx, s.q, ws.OrganizationID, ws.ID, projectID, parentTaskID, in.Titles)
	if err != nil {
		return nil, err
	}

	out := make([]DriveProposalDuplicateItem, len(in.Titles))
	for i := range in.Titles {
		out[i] = DriveProposalDuplicateItem{
			Index:             i,
			PossibleDuplicate: matches[i],
		}
	}
	return out, nil
}

func (s *DriveTaskProposalService) validateOptionalProject(
	ctx context.Context,
	orgID, workspaceID string,
	raw *string,
) (string, string, error) {
	if raw == nil {
		return "", "", nil
	}
	id := strings.TrimSpace(*raw)
	if id == "" {
		return "", "", nil
	}
	p, err := s.q.GetProject(ctx, db.GetProjectParams{
		ID:             id,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return p.ID, p.Title, nil
}

func (s *DriveTaskProposalService) validateOptionalTask(
	ctx context.Context,
	orgID, workspaceID string,
	raw *string,
) (string, error) {
	if raw == nil {
		return "", nil
	}
	id := strings.TrimSpace(*raw)
	if id == "" {
		return "", nil
	}
	t, err := s.q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
		ID:             id,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return t.ID, nil
}

func mapDriveProposalReadError(err error) error {
	if err == nil {
		return nil
	}
	var ce CodedError
	if errors.As(err, &ce) {
		switch ce.Code {
		case "drive_file_too_large", "password_required", "corrupted", "not_office_file":
			msg := ce.Msg
			if msg == "" {
				msg = "UNI chưa đọc được định dạng này."
			}
			return CodedError{
				Status: http.StatusUnprocessableEntity,
				Code:   "drive_format_unsupported",
				Msg:    msg,
				Fields: ce.Fields,
				Err:    ErrDriveFormatUnsupported,
			}
		}
	}
	if errors.Is(err, ErrDriveFileTooLarge) || errors.Is(err, ErrDriveFileUnreadable) || errors.Is(err, ErrDriveFormatUnsupported) {
		return DriveErrToCodedError(ErrDriveFormatUnsupported)
	}
	return DriveErrToCodedError(err)
}

func (s *DriveTaskProposalService) loadCreations(
	ctx context.Context,
	viewerID string,
	member db.WorkspaceMember,
	ws db.Workspace,
	externalFileID string,
) (DriveTasksCreatedSummary, []DriveTaskCreationGroup) {
	summary := DriveTasksCreatedSummary{Count: 0}
	groups := []DriveTaskCreationGroup{}
	if s == nil || s.creations == nil || externalFileID == "" {
		return summary, groups
	}
	if byExt, err := s.creations.LoadTasksCreatedSummaries(ctx, viewerID, member, ws, []string{externalFileID}); err == nil {
		if v, ok := byExt[externalFileID]; ok {
			summary = v
		}
	}
	if g, err := s.creations.LoadTaskCreationGroups(ctx, viewerID, member, ws, externalFileID, 5); err == nil && g != nil {
		groups = g
	}
	return summary, groups
}

func (s *DriveTaskProposalService) observeReadError(rawErr, mappedErr error) {
	switch {
	case errors.Is(rawErr, ErrDriveFileNotFound):
		// Not counted or counted as invalid_request; only real proposal outcomes are observed.
	case errors.Is(rawErr, ErrDriveAccessRequired):
		s.observeResult("access_required")
	case errors.Is(rawErr, ErrDriveGrantRequired):
		s.observeResult("grant_required")
	case errors.Is(rawErr, ErrDriveBlockedByWorkspaceAdmin):
		s.observeResult("blocked_by_admin")
	case errors.Is(rawErr, ErrDriveFileNotAccessible):
		s.observeResult("file_not_accessible")
	case errors.Is(rawErr, ErrDriveReauthRequired):
		s.observeResult("auth_failed")
	case errors.Is(rawErr, ErrDriveFormatUnsupported), errors.Is(mappedErr, ErrDriveFormatUnsupported):
		s.observeResult("format_unsupported")
	case errors.Is(rawErr, ErrDriveExtractUnavailable):
		s.observeResult("extract_unavailable")
	default:
		var ce CodedError
		if errors.As(mappedErr, &ce) && ce.Code != "" {
			s.observeResult(ce.Code)
			return
		}
		s.observeResult("drive_error")
	}
}

func (s *DriveTaskProposalService) observeAIError(err error) {
	var aiErr *ai.Error
	if errors.As(err, &aiErr) {
		switch aiErr.Code {
		case ai.ErrQuotaExceeded.Code:
			s.observeResult("ai_quota_exceeded")
			return
		case ai.ErrRateLimited.Code:
			s.observeResult("ai_rate_limited")
			return
		}
	}
	s.observeResult("ai_error")
}

func enrichDriveProposalItemsQ(
	ctx context.Context,
	q *db.Queries,
	orgID, workspaceID, driveFileID, projectID, parentTaskID string,
	items []DriveTaskProposalItem,
) error {
	if len(items) == 0 {
		return nil
	}
	if err := refreshAssigneeDriveAccessQ(ctx, q, orgID, workspaceID, driveFileID, items); err != nil {
		return err
	}
	titles := make([]string, len(items))
	for i := range items {
		titles[i] = items[i].Title
	}
	matches, err := matchDriveProposalDuplicatesQ(ctx, q, orgID, workspaceID, projectID, parentTaskID, titles)
	if err != nil {
		return err
	}
	for i := range items {
		items[i].PossibleDuplicate = matches[i]
	}
	return nil
}

func refreshAssigneeDriveAccessQ(
	ctx context.Context,
	q *db.Queries,
	orgID, workspaceID, driveFileID string,
	items []DriveTaskProposalItem,
) error {
	if len(items) == 0 {
		return nil
	}
	userIDs, err := q.ListGrantedDriveFileAccessUserIDs(ctx, db.ListGrantedDriveFileAccessUserIDsParams{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		DriveFileID:    driveFileID,
	})
	if err != nil {
		return err
	}
	granted := make(map[string]bool, len(userIDs))
	for _, id := range userIDs {
		granted[id] = true
	}
	for i := range items {
		if items[i].AssigneeMemberID == nil || strings.TrimSpace(*items[i].AssigneeMemberID) == "" {
			items[i].AssigneeDriveAccess = ""
			continue
		}
		if granted[*items[i].AssigneeMemberID] {
			items[i].AssigneeDriveAccess = DriveAssigneeAccessGranted
		} else {
			items[i].AssigneeDriveAccess = DriveAssigneeAccessUnknown
		}
	}
	return nil
}

// matchDriveProposalDuplicatesQ finds open duplicate tasks in (orgID, workspaceID, projectID, parentTaskID)
// for each title, keyed by the 0-based position in titles (seam §3 A5, spec §8.2 step 5, §8.4).
func matchDriveProposalDuplicatesQ(
	ctx context.Context,
	q *db.Queries,
	orgID, workspaceID, projectID, parentTaskID string,
	titles []string,
) ([]*DriveDuplicateTask, error) {
	out := make([]*DriveDuplicateTask, len(titles))
	if len(titles) == 0 {
		return out, nil
	}
	projParam := optionalText(projectID)
	parentParam := optionalText(parentTaskID)

	cache := make(map[string]*DriveDuplicateTask, len(titles))
	checked := make(map[string]bool, len(titles))
	var taskPrefix string

	for i, rawTitle := range titles {
		norm := normalizeTaskTitle(rawTitle)
		if norm == "" {
			continue
		}
		if !checked[norm] {
			dup, err := q.FindActiveDuplicateTask(ctx, db.FindActiveDuplicateTaskParams{
				OrganizationID:  orgID,
				WorkspaceID:     workspaceID,
				ProjectID:       projParam,
				ParentTaskID:    parentParam,
				NormalizedTitle: norm,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				checked[norm] = true
			} else if err != nil {
				return nil, err
			} else {
				if taskPrefix == "" {
					if ws, werr := q.GetWorkspaceByID(ctx, workspaceID); werr == nil && ws.OrganizationID == orgID {
						taskPrefix = strings.TrimSpace(ws.TaskPrefix)
						if taskPrefix == "" {
							taskPrefix = strings.ToUpper(ws.Slug)
						}
					}
					if taskPrefix == "" {
						taskPrefix = "TASK"
					}
				}
				d := &DriveDuplicateTask{
					TaskID:     dup.ID,
					Identifier: fmt.Sprintf("%s-%d", taskPrefix, dup.Number),
					Title:      dup.Title,
				}
				cache[norm] = d
				checked[norm] = true
			}
		}
		if d := cache[norm]; d != nil {
			cp := *d
			out[i] = &cp
		}
	}
	return out, nil
}

// discardReadyProposalsForConnectionInTx discards all ready Drive task proposals
// tied to connectionID and records drive_task_proposal.discarded (reason = source_disconnected)
// in the same transaction (seam §4 + A4, spec §8.2b, §8.6).
func discardReadyProposalsForConnectionInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor audit.Actor,
	connectionID, googleEmail, googleSub string,
) error {
	rows, err := qtx.DiscardReadyDriveTaskProposalsForConnection(ctx, connectionID)
	if err != nil {
		return err
	}
	for _, r := range rows {
		email := googleEmail
		sub := googleSub
		connID := r.ConnectionID
		if connID == "" {
			connID = connectionID
		}
		if email == "" || sub == "" {
			if conn, cerr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
				ID:             connID,
				OrganizationID: r.OrganizationID,
				UserID:         r.RequestedBy,
			}); cerr == nil {
				if email == "" {
					email = conn.GoogleEmail
				}
				if sub == "" {
					sub = conn.GoogleSub
				}
			}
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: r.OrganizationID,
			WorkspaceID:    r.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDriveTaskProposalDiscarded,
			ResourceType:   "drive_task_proposal",
			ResourceID:     r.ID,
			Metadata: map[string]any{
				"drive_file_id": r.DriveFileID,
				"connection_id": connID,
				"google_email":  email,
				"google_sub":    sub,
				"reason":        "source_disconnected",
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// discardReadyProposalsForFileInTx discards all ready Drive task proposals tied
// to driveFileID and records drive_task_proposal.discarded (reason = source_unlinked)
// in the same transaction, resolving google_email and google_sub from each
// proposal's saved connection_id (seam §4 + A4, spec §8.2b, §8.6, R1-7).
func discardReadyProposalsForFileInTx(
	ctx context.Context,
	qtx *db.Queries,
	actor audit.Actor,
	driveFileID, defaultEmail, defaultSub string,
) error {
	rows, err := qtx.DiscardReadyDriveTaskProposalsForFile(ctx, driveFileID)
	if err != nil {
		return err
	}
	for _, r := range rows {
		email := defaultEmail
		sub := defaultSub
		if conn, cerr := qtx.GetDriveConnectionAnyState(ctx, db.GetDriveConnectionAnyStateParams{
			ID:             r.ConnectionID,
			OrganizationID: r.OrganizationID,
			UserID:         r.RequestedBy,
		}); cerr == nil {
			email = conn.GoogleEmail
			sub = conn.GoogleSub
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: r.OrganizationID,
			WorkspaceID:    r.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDriveTaskProposalDiscarded,
			ResourceType:   "drive_task_proposal",
			ResourceID:     r.ID,
			Metadata: map[string]any{
				"drive_file_id": r.DriveFileID,
				"connection_id": r.ConnectionID,
				"google_email":  email,
				"google_sub":    sub,
				"reason":        "source_unlinked",
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

func buildDriveTaskProposalView(
	row db.DriveTaskProposal,
	fileRow db.DriveFile,
	readerEmail string,
	items []DriveTaskProposalItem,
	summary DriveTasksCreatedSummary,
	groups []DriveTaskCreationGroup,
) DriveTaskProposalView {
	if items == nil {
		items = []DriveTaskProposalItem{}
	}
	if groups == nil {
		groups = []DriveTaskCreationGroup{}
	}
	iconKind := fileRow.IconKind
	if iconKind == "" {
		iconKind = DriveIconKindForMimeType(fileRow.MimeType)
	}
	sharingState := fileRow.SharingState
	if sharingState == "" {
		sharingState = DriveSharingStateUnknown
	}
	return DriveTaskProposalView{
		ID:                 row.ID,
		WorkspaceID:        row.WorkspaceID,
		DriveFileID:        row.DriveFileID,
		DriveFileName:      fileRow.Name,
		DriveFileMimeType:  fileRow.MimeType,
		DriveFileIconKind:  iconKind,
		SharingState:       sharingState,
		ConnectionID:       row.ConnectionID,
		ReaderAccountEmail: readerEmail,
		RequestedBy:        row.RequestedBy,
		Prompt:             row.Prompt,
		ProjectID:          textPtr(row.ProjectID),
		ParentTaskID:       textPtr(row.ParentTaskID),
		ContextTaskID:      textPtr(row.ContextTaskID),
		Truncated:          row.Truncated,
		Status:             row.Status,
		Items:              items,
		TasksCreated:       summary,
		PriorCreations:     groups,
		CreatedAt:          row.CreatedAt.Time.UTC(),
		ExpiresAt:          row.ExpiresAt.Time.UTC(),
	}
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid || t.String == "" {
		return nil
	}
	v := t.String
	return &v
}

func errDriveSourceChanged() error {
	return CodedError{
		Code:   "drive_source_changed",
		Status: http.StatusConflict,
		Msg:    "Kết nối hoặc tệp Google Drive đã thay đổi trong khi xử lý. Vui lòng thử lại.",
		Err:    ErrDriveSourceChanged,
	}
}
