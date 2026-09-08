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
	// ent is the entitlement gate (F-02); built here so it can never be nil.
	ent *EntitlementService
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

func (s *MeetingService) writeAudit(ctx context.Context, q *db.Queries, meetingID, eventType, actorID, from, to, payload string) error {
	if payload == "" {
		payload = "{}"
	}
	return q.InsertAuditLog(ctx, db.InsertAuditLogParams{
		ID: util.NewID(), MeetingID: meetingID, EventType: eventType,
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
		ID: util.NewID(), MeetingID: m.ID, PrincipalType: PrincipalUser,
		UserID: strText(userID), DisplayNameSnapshot: u.DisplayName,
		EmailSnapshot: strText(u.Email), Role: RoleModerator, SourceType: GrantCreator, AddedBy: userID,
	})
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	_, err = q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: p.ID,
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
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
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
	id := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	m, err := q.CreateMeeting(ctx, db.CreateMeetingParams{
		ID: id, WorkspaceID: workspaceID,
		Title: strings.TrimSpace(in.Title), Description: in.Description,
		StartsAt: pgtype.Timestamptz{Time: in.StartsAt, Valid: true},
		EndsAt:   pgtype.Timestamptz{Time: in.EndsAt, Valid: true},
		RoomName: meetings.RoomNameForMeeting(id), CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		Status: MeetingScheduled, MeetingType: MeetingTypeScheduled,
		HostUserID: userID, Timezone: tz, AllowJoinRequest: allow,
		ProjectID: strText(in.ProjectID),
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
	if err := s.writeAudit(ctx, q, m.ID, "MEETING_CREATED", userID, "", MeetingScheduled, `{"meeting_type":"SCHEDULED"}`); err != nil {
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

type UpdateMeetingInput struct {
	Title            *string
	Description      *string
	StartsAt         *time.Time
	EndsAt           *time.Time
	Timezone         *string
	AllowJoinRequest *bool
	ProjectID        *string
}

func (s *MeetingService) Update(ctx context.Context, userID, meetingID string, in UpdateMeetingInput) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status == MeetingEnded || m.Status == MeetingCanceled {
		return db.Meeting{}, errInvalidState()
	}
	if m.Status == MeetingInProgress && (in.StartsAt != nil || in.EndsAt != nil) {
		return db.Meeting{}, Invalid("không sửa thời gian dự kiến khi cuộc họp đang diễn ra")
	}
	if in.Title != nil && strings.TrimSpace(*in.Title) == "" {
		return db.Meeting{}, Invalid("tiêu đề không được để trống")
	}
	params := db.UpdateMeetingParams{
		ID: meetingID, Version: m.Version, Title: optText(in.Title), Description: optText(in.Description),
		StartsAt: optTimestamptz(in.StartsAt), EndsAt: optTimestamptz(in.EndsAt),
		Timezone: optText(in.Timezone), AllowJoinRequest: optBool(in.AllowJoinRequest),
		ProjectID: optText(in.ProjectID), UpdatedBy: strText(userID),
	}
	up, err := s.q.UpdateMeeting(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, ErrConflict
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if !up.EndsAt.Time.After(up.StartsAt.Time) {
		return db.Meeting{}, Invalid("thời gian kết thúc phải sau thời gian bắt đầu")
	}
	_ = s.writeAudit(ctx, s.q, meetingID, "MEETING_UPDATED", userID, m.Status, up.Status, "{}")
	s.record(ctx, s.q, up, audit.User(userID), "meeting.updated", nil, audit.Diff(
		map[string]any{"title": m.Title, "starts_at": tsOrNil(m.StartsAt), "ends_at": tsOrNil(m.EndsAt)},
		map[string]any{"title": up.Title, "starts_at": tsOrNil(up.StartsAt), "ends_at": tsOrNil(up.EndsAt)},
	))
	return up, nil
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
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return db.MeetingNote{}, err
	}
	if strings.TrimSpace(body) == "" {
		return db.MeetingNote{}, Invalid("nội dung không được để trống")
	}
	return s.q.CreateMeetingNote(ctx, db.CreateMeetingNoteParams{
		ID: util.NewID(), MeetingID: meetingID, AuthorID: userID, Body: body,
	})
}

func (s *MeetingService) Notes(ctx context.Context, userID, meetingID string) ([]db.ListMeetingNotesRow, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingNotes(ctx, meetingID)
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
	action, ok := meetingActionFor[topic]
	if !ok {
		return
	}
	orgID := ""
	if w, err := s.q.GetWorkspaceByID(ctx, m.WorkspaceID); err == nil {
		orgID = w.OrganizationID
	}
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
		ResourceType: "meeting", ResourceID: m.ID,
		Changes: changes,
	}, audit.Event{Topic: topic, Payload: payload, OrganizationID: orgID, WorkspaceID: m.WorkspaceID}); err != nil {
		slog.Warn("audit: meeting command not recorded", "action", action, "meeting", m.ID, "err", err)
	}
}

// tsOrNil normalizes a nullable timestamp for an audit change entry.
func tsOrNil(t pgtype.Timestamptz) any {
	if !t.Valid {
		return nil
	}
	return t.Time.UTC().Format(time.RFC3339)
}
