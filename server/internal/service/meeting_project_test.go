package service

import (
	"context"
	"strings"
	"testing"
	"time"
)

// A meeting takes a project on create, keeps it through edits, and loses it
// to NULL, never an empty string, when the host clears the field (C-11 §9.1 V2).
func TestMeetingProjectSetAndCleared(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	tasks := NewTaskService(s.pool, s.q, s.ws, nil)
	p, err := tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Ra mắt Q4"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Giao ban", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour),
		Timezone: "UTC", ProjectID: "  " + p.ID + " ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if m.ProjectID.String != p.ID {
		t.Fatalf("project on create = %q", m.ProjectID.String)
	}
	empty := ""
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{ProjectID: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if up.ProjectID.Valid {
		t.Fatalf("cleared project = %+v, want NULL", up.ProjectID)
	}
	var changes string
	if err := s.pool.QueryRow(ctx, `SELECT changes FROM audit_events
		WHERE resource_id = $1 AND action = 'meeting.updated' ORDER BY occurred_at DESC, id DESC LIMIT 1`, m.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(changes, `"project_id"`) {
		t.Fatalf("audit changes = %s", changes)
	}
}
