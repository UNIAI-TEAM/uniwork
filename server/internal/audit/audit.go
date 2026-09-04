// Package audit is the only place in the server that writes audit_events and
// the domain outbox. Services call Record inside their own transaction, so a
// change to business state, its audit row and the events it publishes commit
// together or not at all (ADR 0009).
//
// Why a package instead of a helper on each service: the rule "every command
// writes audit + outbox in the same transaction" is only worth stating if it
// cannot be worked around. internal/arch_test.go fails the build when any file
// outside this package calls InsertAuditEvent or InsertDomainOutboxEvent, and
// that check is only meaningful while both queries have exactly one caller.
package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Kind is who acted. The three values are fixed by ADR 0007: an agent is an
// actor in its own right, and "system" covers scheduled jobs and workers that
// act with nobody's authority.
type Kind string

const (
	KindHuman  Kind = "human"
	KindAgent  Kind = "agent"
	KindSystem Kind = "system"
)

// Actor identifies who performed a command.
type Actor struct {
	Kind Kind
	ID   string
}

// User is the actor for a signed-in person.
func User(id string) Actor { return Actor{Kind: KindHuman, ID: id} }

// System is the actor for a worker or scheduled job; id is the job name.
func System(job string) Actor { return Actor{Kind: KindSystem, ID: job} }

// Change is the before/after of one field. Nothing else of the row is stored:
// a full snapshot would put PII in a table that can never be edited.
type Change struct {
	From any `json:"from"`
	To   any `json:"to"`
}

// Entry is one audit row. Changes carries only the fields that actually
// differed; Metadata is free-form context that is neither PII nor secret.
type Entry struct {
	OrganizationID string
	WorkspaceID    string // "" => NULL, for organization-level events
	Actor          Actor
	Action         string // "task.updated"
	ResourceType   string // "task"
	ResourceID     string
	Changes        map[string]Change
	Metadata       map[string]any
}

// Event is one row on the outbox. Payload carries ids only — a consumer that
// needs content refetches it, so an event can never leak a field the reader is
// not allowed to see.
type Event struct {
	Topic   string
	Version int
	Payload map[string]string

	// OrganizationID and WorkspaceID default to the Entry's when emitted with
	// Record; set them explicitly when emitting without an audit row.
	OrganizationID string
	WorkspaceID    string
}

// Counter receives one call per audit row written, for the Prometheus
// counter. Nil is fine — the recorder works without metrics.
type Counter interface {
	IncAuditEvent(action string)
}

// Recorder writes audit rows and outbox rows. It holds no connection: the
// caller passes the *db.Queries already bound to its transaction, which is
// what makes "same transaction" structural rather than a convention.
type Recorder struct {
	Counter Counter
}

// NewRecorder returns a recorder. Counter may be attached afterwards.
func NewRecorder() *Recorder { return &Recorder{} }

// Record writes one audit row and one outbox row per emitted event, using the
// caller's queries handle. Request context (correlation id, request id, IP,
// user agent) is read from ctx — see WithRequest.
func (r *Recorder) Record(ctx context.Context, q *db.Queries, e Entry, emit ...Event) error {
	if q == nil {
		return fmt.Errorf("audit: nil queries")
	}
	if e.Action == "" || e.ResourceType == "" {
		return fmt.Errorf("audit: entry needs action and resource_type")
	}
	if e.Actor.Kind == "" {
		return fmt.Errorf("audit: entry needs an actor kind")
	}
	info := RequestFromContext(ctx)
	correlationID := info.CorrelationID
	if correlationID == "" {
		correlationID = util.NewID()
	}
	changes, err := encodeJSON(e.Changes)
	if err != nil {
		return err
	}
	metadata, err := encodeJSON(e.Metadata)
	if err != nil {
		return err
	}
	if err := q.InsertAuditEvent(ctx, db.InsertAuditEventParams{
		ID:             util.NewID(),
		OrganizationID: e.OrganizationID,
		WorkspaceID:    optText(e.WorkspaceID),
		ActorKind:      string(e.Actor.Kind),
		ActorID:        e.Actor.ID,
		Action:         e.Action,
		ResourceType:   e.ResourceType,
		ResourceID:     e.ResourceID,
		Changes:        changes,
		Metadata:       metadata,
		CorrelationID:  correlationID,
		RequestID:      optText(info.RequestID),
		IpAddress:      optText(info.IP),
		UserAgent:      optText(info.UserAgent),
	}); err != nil {
		return err
	}
	if r.Counter != nil {
		r.Counter.IncAuditEvent(e.Action)
	}
	for _, ev := range emit {
		if ev.OrganizationID == "" {
			ev.OrganizationID = e.OrganizationID
		}
		if ev.WorkspaceID == "" {
			ev.WorkspaceID = e.WorkspaceID
		}
		if err := r.insertEvent(ctx, q, correlationID, e.Actor, ev); err != nil {
			return err
		}
	}
	return nil
}

// Emit writes outbox rows without an audit row. It exists for infrastructure
// work that is not a business command — the provider.* topics that ask the
// conference provider to create or tear down a room. Business commands use
// Record; nothing about "no audit" should be convenient.
func (r *Recorder) Emit(ctx context.Context, q *db.Queries, actor Actor, evs ...Event) error {
	if q == nil {
		return fmt.Errorf("audit: nil queries")
	}
	correlationID := RequestFromContext(ctx).CorrelationID
	if correlationID == "" {
		correlationID = util.NewID()
	}
	for _, ev := range evs {
		if err := r.insertEvent(ctx, q, correlationID, actor, ev); err != nil {
			return err
		}
	}
	return nil
}

func (r *Recorder) insertEvent(ctx context.Context, q *db.Queries, correlationID string, actor Actor, ev Event) error {
	if ev.Topic == "" {
		return fmt.Errorf("audit: event needs a topic")
	}
	version := ev.Version
	if version == 0 {
		version = 1
	}
	payload := ev.Payload
	if payload == nil {
		payload = map[string]string{}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.InsertDomainOutboxEvent(ctx, db.InsertDomainOutboxEventParams{
		ID:             util.NewID(),
		WorkspaceID:    optText(ev.WorkspaceID),
		OrganizationID: optText(ev.OrganizationID),
		Topic:          ev.Topic,
		Payload:        string(b),
		EventVersion:   int32(version),
		CorrelationID:  optText(correlationID),
		ActorKind:      optText(string(actor.Kind)),
		ActorID:        optText(actor.ID),
	})
}

func encodeJSON(v any) (string, error) {
	if v == nil {
		return "{}", nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	if len(b) == 0 || string(b) == "null" {
		return "{}", nil
	}
	return string(b), nil
}

func optText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
