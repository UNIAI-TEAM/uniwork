package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	MeetingScheduled  = "SCHEDULED"
	MeetingInProgress = "IN_PROGRESS"
	MeetingEnded      = "ENDED"
	MeetingCanceled   = "CANCELED"

	MeetingTypeScheduled = "SCHEDULED"
	MeetingTypeInstant   = "INSTANT"

	PrincipalUser  = "USER"
	PrincipalGuest = "GUEST"

	RoleAttendee  = "ATTENDEE"
	RoleModerator = "MODERATOR"
	RoleAudience  = "AUDIENCE"

	ParticipantActive  = "ACTIVE"
	ParticipantRemoved = "REMOVED"

	GrantActive  = "ACTIVE"
	GrantRevoked = "REVOKED"

	GrantCreator      = "CREATOR"
	GrantDirectInvite = "DIRECT_INVITE"
	GrantInviteLink   = "INVITE_LINK"
	GrantJoinApproval = "JOIN_APPROVAL"
	GrantAdmin        = "ADMIN"

	InvitePending   = "PENDING"
	InviteAccepted  = "ACCEPTED"
	InviteDeclined  = "DECLINED"
	InviteTentative = "TENTATIVE"

	LinkAutoAdmit       = "AUTO_ADMIT"
	LinkRequestApproval = "REQUEST_APPROVAL"

	JoinPending  = "PENDING"
	JoinApproved = "APPROVED"
	JoinRejected = "REJECTED"
	JoinCanceled = "CANCELED"
	JoinExpired  = "EXPIRED"

	DecisionAdmit              = "ADMIT"
	DecisionWaitingForHost     = "WAITING_FOR_HOST"
	DecisionWaitingApproval    = "WAITING_APPROVAL"
	DecisionWaitingForProvider = "WAITING_FOR_PROVIDER"
	DecisionDeny               = "DENY"
)

type MeetingRuntime struct {
	TokenTTL           time.Duration
	HMACKey            []byte
	LiveKitURL         string
	EmptyTimeout       time.Duration
	ProviderKey        string
	WorkerTick         time.Duration
	OutboxBatch        int32
	WebhookBatch       int32
	WebhookConcurrency int
	STTAgentSecret     string
}

type MeetingService struct {
	pool         *pgxpool.Pool
	q            *db.Queries
	ws           *WorkspaceService
	pub          EventPublisher
	provider     meetings.ConferenceProvider
	rt           MeetingRuntime
	outboxNodeID string
	metrics      MeetingMetrics
	// AI and Tasks are optional collaborators set by main after construction;
	// nil means the feature reports itself as unavailable.
	AI    *ai.Gateway
	Tasks *TaskService
	// Chat receives LiveKit recording webhooks that do not match a meeting egress.
	Chat *ChatService
	// ent is the entitlement gate (F-02); built here so it can never be nil.
	ent *EntitlementService
	// files is the shared FileService, optional: with it wired, note-author
	// avatars stored as file ids resolve to presigned URLs (UNI-744) and new
	// recordings go through it (UNI-746); nil keeps both legacy paths.
	files files.Service
}

// organizationOf resolves the tenant a meeting belongs to, for the gate.
func (s *MeetingService) organizationOf(ctx context.Context, m db.Meeting) (string, error) {
	w, err := s.q.GetWorkspaceByID(ctx, m.WorkspaceID)
	if err != nil {
		return "", err
	}
	return w.OrganizationID, nil
}

// requireFeature: the organization's plan must include the flag (spec §4.3).
func (s *MeetingService) requireFeature(ctx context.Context, m db.Meeting, feature string) error {
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return err
	}
	return s.ent.Can(ctx, orgID, feature)
}

func (s *MeetingService) SetMeetingMetrics(m MeetingMetrics) {
	s.metrics = m
}

func NewMeetingService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, pub EventPublisher, provider meetings.ConferenceProvider, rt MeetingRuntime) *MeetingService {
	if rt.TokenTTL <= 0 {
		rt.TokenTTL = 30 * time.Minute
	}
	if rt.ProviderKey == "" {
		rt.ProviderKey = "livekit"
	}
	if rt.WorkerTick <= 0 {
		rt.WorkerTick = time.Second
	}
	if rt.OutboxBatch <= 0 {
		rt.OutboxBatch = 50
	}
	if rt.WebhookBatch <= 0 {
		rt.WebhookBatch = 50
	}
	if rt.WebhookConcurrency <= 0 {
		rt.WebhookConcurrency = 8
	}
	nodeID := util.NewID()
	return &MeetingService{pool: pool, q: q, ws: ws, pub: pub, provider: provider, rt: rt, outboxNodeID: nodeID, ent: NewEntitlementService(pool, q)}
}

// GuestHMACKey exposes the guest cookie signing key for lobby WebSocket auth.
func (s *MeetingService) GuestHMACKey() []byte {
	return s.rt.HMACKey
}

func strText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func (s *MeetingService) authorize(ctx context.Context, userID, meetingID string) (db.Meeting, db.WorkspaceMember, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, db.WorkspaceMember{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, db.WorkspaceMember{}, err
	}
	mem, err := s.ws.RequireMember(ctx, m.WorkspaceID, userID)
	if err != nil {
		return db.Meeting{}, db.WorkspaceMember{}, err
	}
	return m, mem, nil
}

func isWSAdmin(role string) bool {
	return role == "owner" || role == "admin"
}

func (s *MeetingService) requireHostOrAdmin(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, mem, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.HostUserID != userID && !isWSAdmin(mem.Role) {
		return db.Meeting{}, errNotHost()
	}
	return m, nil
}

// writeAudit takes the meeting row, not its id: the timeline row carries the
// meeting's organization (ADR 0008).
func (s *MeetingService) writeAudit(ctx context.Context, q *db.Queries, m db.Meeting, eventType, actorID, from, to, payload string) error {
	if payload == "" {
		payload = "{}"
	}
	return q.InsertAuditLog(ctx, db.InsertAuditLogParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, EventType: eventType,
		ActorType: "USER", ActorID: actorID,
		FromState: strText(from), ToState: strText(to), Payload: payload,
	})
}

// enqueue writes one provider.* row on the outbox inside the caller's
// transaction. These are infrastructure instructions to the conference
// provider, not business commands, so they go through Emit and carry no audit
// row — the meeting command that caused them wrote one already.
func (s *MeetingService) enqueue(ctx context.Context, q *db.Queries, workspaceID, topic string, payload map[string]string) error {
	return auditRecorder.Emit(ctx, q, audit.System("meeting"), audit.Event{
		Topic: topic, Payload: payload, WorkspaceID: workspaceID,
	})
}

func (s *MeetingService) addHostParticipant(ctx context.Context, q *db.Queries, m db.Meeting, userID string) (db.MeetingParticipant, error) {
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	p, err := q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalUser,
		UserID: strText(userID), DisplayNameSnapshot: u.DisplayName,
		EmailSnapshot: strText(u.Email), Role: RoleModerator, SourceType: GrantCreator, AddedBy: userID,
	})
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: p.ID,
		SourceType: GrantCreator, GrantedBy: userID,
	})
	return p, err
}

type CreateMeetingInput struct {
	Title            string
	Description      string
	StartsAt         time.Time
	EndsAt           time.Time
	Timezone         string
	AllowJoinRequest *bool
	ProjectID        string
	AttendeeUserIDs  []string
}

func (s *MeetingService) Create(ctx context.Context, userID, workspaceID string, in CreateMeetingInput) (db.Meeting, error) {
	return s.createScheduled(ctx, userID, workspaceID, in)
}

func (s *MeetingService) createScheduled(ctx context.Context, userID, workspaceID string, in CreateMeetingInput) (db.Meeting, error) {
	mem, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.Meeting{}, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	if !in.EndsAt.After(in.StartsAt) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	tz := strings.TrimSpace(in.Timezone)
	if tz == "" {
		tz = "UTC"
	}
	allow := true
	if in.AllowJoinRequest != nil {
		allow = *in.AllowJoinRequest
	}
	projectID := strings.TrimSpace(in.ProjectID)
	if err := s.requireMeetingProject(ctx, mem.OrganizationID, workspaceID, projectID); err != nil {
		return db.Meeting{}, err
	}
	id := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	m, err := q.CreateMeeting(ctx, db.CreateMeetingParams{
		ID: id, WorkspaceID: workspaceID, OrganizationID: mem.OrganizationID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		StartsAt: pgtype.Timestamptz{Time: in.StartsAt, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: in.EndsAt, Valid: true},
		RoomName: meetings.RoomNameForMeeting(id), CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		Status: MeetingScheduled, MeetingType: MeetingTypeScheduled,
		HostUserID: userID, Timezone: tz, AllowJoinRequest: allow,
		ProjectID: strText(projectID),
	})
	if err != nil {
		return db.Meeting{}, err
	}
	if _, err := s.addHostParticipant(ctx, q, m, userID); err != nil {
		return db.Meeting{}, err
	}
	for _, attendee := range in.AttendeeUserIDs {
		if attendee == "" || attendee == userID {
			continue
		}
		if _, err := s.inviteUserTx(ctx, q, m, userID, attendee); err != nil {
			return db.Meeting{}, err
		}
	}
	if err := s.writeAudit(ctx, q, m, "MEETING_CREATED", userID, "", MeetingScheduled, `{"meeting_type":"SCHEDULED"}`); err != nil {
		return db.Meeting{}, err
	}
	s.record(ctx, q, m, audit.User(userID), "meeting.created", nil,
		audit.Diff(nil, map[string]any{"meeting_type": MeetingTypeScheduled, "title": m.Title}))
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	return m, nil
}

func (s *MeetingService) List(ctx context.Context, userID, workspaceID string) ([]db.Meeting, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingsByWorkspace(ctx, workspaceID)
}

func (s *MeetingService) Get(ctx context.Context, userID, meetingID string) (db.Meeting, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	return m, err
}

func optBool(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

func optTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// Delete maps to cancel for SCHEDULED meetings so existing clients keep working.
func (s *MeetingService) Delete(ctx context.Context, userID, meetingID string) error {
	return s.Cancel(ctx, userID, meetingID, "deleted")
}

func (s *MeetingService) AddNote(ctx context.Context, userID, meetingID, body string) (db.MeetingNote, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingNote{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.MeetingNote{}, Invalid("nội dung không được để trống")
	}
	return s.q.CreateMeetingNote(ctx, db.CreateMeetingNoteParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, AuthorID: userID, Body: body,
	})
}

// SetFiles attaches the shared FileService for both avatar URL emission and
// the recording pipeline; nil keeps the legacy paths byte-identical.
func (s *MeetingService) SetFiles(f files.Service) { s.files = f }

func (s *MeetingService) Notes(ctx context.Context, userID, meetingID string) ([]db.ListMeetingNotesRow, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListMeetingNotes(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	decorateMemberAvatars(ctx, s.files, rows, func(r db.ListMeetingNotesRow) avatarRow {
		return avatarRow{UserID: r.AuthorID, AvatarURL: r.AvatarUrl, FileID: r.AvatarFileID}
	}, func(r *db.ListMeetingNotesRow, url string) {
		r.AvatarUrl = pgtype.Text{String: url, Valid: true}
	})
	return rows, nil
}

// meetingActionFor maps a realtime topic to the audit action for the same
// command. Meeting keeps its historical event names (the client switches on
// them), and audit actions are `meeting.<verb>` per the audit spec, so the two
// vocabularies meet here rather than in twenty call sites.
var meetingActionFor = map[string]string{
	"meeting.created":       "meeting.created",
	"meeting.updated":       "meeting.updated",
	"meeting.started":       "meeting.started",
	"meeting.ended":         "meeting.ended",
	"meeting.canceled":      "meeting.canceled",
	"meeting.deleted":       "meeting.deleted",
	"host.transferred":      "meeting.host_transferred",
	"participant.invited":   "meeting.participant_invited",
	"participant.removed":   "meeting.participant_removed",
	"participant.updated":   "meeting.participant_updated",
	"attendance.marked":     "meeting.attendance_marked",
	"attendance.finalized":  "meeting.attendance_finalized",
	"attendance.reopened":   "meeting.attendance_reopened",
	"motion.created":        "meeting.motion_created",
	"motion.updated":        "meeting.motion_updated",
	"motion.deleted":        "meeting.motion_deleted",
	"motion.opened":         "meeting.motion_opened",
	"motion.closed":         "meeting.motion_closed",
	"motion.ballot_cast":    "meeting.ballot_cast",
	"invitation.responded":  "meeting.invitation_responded",
	"join_request.created":  "meeting.join_requested",
	"join_request.approved": "meeting.join_request_approved",
	"join_request.rejected": "meeting.join_request_rejected",
	"join_request.canceled": "meeting.join_request_canceled",
	"invite_link.revoked":   "meeting.invite_link_revoked",
}

// record writes the meeting command's audit row and puts its realtime event on
// the outbox, using the caller's queries handle. Passing the transaction's
// handle is what makes the two atomic with the change; the callers that still
// pass s.q are the ones whose command was already committed by the time they
// reach here, and they are the remaining work of migrating Meeting off its
// own audit table.
func (s *MeetingService) record(ctx context.Context, q *db.Queries, m db.Meeting, actor audit.Actor, topic string, payload map[string]string, changes map[string]audit.Change) {
	s.recordResource(ctx, q, m, actor, topic, payload, changes, "meeting", m.ID)
}

// recordResource is record for a command whose audit row belongs to a
// resource inside the meeting — a ballot is filed under its motion (spec
// §6.1). Everything, the organization lookup included, goes through q: inside
// a transaction that keeps the command on the one connection it already
// holds, so N concurrent commands need N pool connections, not 2N.
func (s *MeetingService) recordResource(ctx context.Context, q *db.Queries, m db.Meeting, actor audit.Actor, topic string, payload map[string]string, changes map[string]audit.Change, resourceType, resourceID string) {
	action, ok := meetingActionFor[topic]
	if !ok {
		return
	}
	// The meeting carries its tenant (ADR 0008), so no workspace read runs
	// inside the caller's transaction - for a ballot, under the motion lock.
	orgID := m.OrganizationID
	if payload == nil {
		payload = meetingEventPayload(m)
	}
	if payload["workspace_id"] == "" {
		payload["workspace_id"] = m.WorkspaceID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: m.WorkspaceID,
		Actor:        actor,
		Action:       action,
		ResourceType: resourceType, ResourceID: resourceID,
		Changes: changes,
	}, audit.Event{Topic: topic, Payload: payload, OrganizationID: orgID, WorkspaceID: m.WorkspaceID}); err != nil {
		slog.Warn("audit: meeting command not recorded", "action", action, "meeting", m.ID, "resource", resourceType, "err", err)
	}
}

// tsOrNil normalizes a nullable timestamp for an audit change entry.
func tsOrNil(t pgtype.Timestamptz) any {
	if !t.Valid {
		return nil
	}
	return t.Time.UTC().Format(time.RFC3339)
}

// quorumOrNil normalizes the nullable quorum for an audit change entry.
func quorumOrNil(q pgtype.Int2) any {
	if !q.Valid {
		return nil
	}
	return q.Int16
}
