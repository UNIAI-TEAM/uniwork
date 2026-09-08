// Package testutil provides shared test helpers. DB returns a pool on the
// test database with migrations applied and all business tables truncated,
// so each test starts from a clean slate.
//
// `go test ./...` runs packages in parallel against the same test database,
// so DB serializes tests with a session advisory lock held for the duration
// of the test — otherwise one package's TRUNCATE wipes another's rows
// mid-test.
package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/migrations"
)

const testLockKey = 727273

func DB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skip("no test database:", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skip("no test database:", err)
	}
	t.Cleanup(pool.Close)

	lockConn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal("acquire lock conn:", err)
	}
	if err := migrations.WaitAdvisoryLock(ctx, lockConn, testLockKey); err != nil {
		t.Fatal("advisory lock:", err)
	}
	t.Cleanup(func() {
		_, _ = lockConn.Exec(ctx, "SELECT pg_advisory_unlock($1)", testLockKey)
		lockConn.Release()
	})

	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatal("migrate:", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE users, organizations, organization_members,
		workspaces, workspace_members, invitations, refresh_tokens,
		project_resources, projects, idempotency_keys, feature_flag_overrides,
		task_source_contexts, attachments, task_reactions, comment_reactions,
		task_view_preferences, task_views, task_pins, task_subscribers,
		task_dependencies, task_label_links, task_properties, task_labels, task_statuses,
		tasks, task_comments,
		meetings, meeting_attendees, meeting_notes,
		meeting_participants, meeting_invitations, meeting_access_grants,
		meeting_invite_links, meeting_join_requests, meeting_conference_sessions,
		meeting_attendance_sessions, meeting_audit_logs, outbox_events,
		meeting_guests, meeting_provider_events, webhook_inbox,
		ai_usage_events, ai_conversations, ai_messages,
		meeting_transcript_segments, meeting_summaries, meeting_recordings,
		meeting_chat_messages,
		chat_messages, chat_room_members, chat_blocks, chat_rooms,
		emails, password_reset_tokens, email_verification_codes,
		audit_events, audit_retention_policies, audit_exports,
		agents, workspace_agent_members,
		notifications, notification_preferences, push_subscriptions, notification_deliveries,
		subscriptions, usage_events, usage_counters, invoices CASCADE`)
	if err != nil {
		t.Fatal("truncate:", err)
	}
	return pool
}
