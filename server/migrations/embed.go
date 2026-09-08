// Package migrations embeds SQL migrations and applies them in order,
// tracked in schema_migrations, serialized by a Postgres advisory lock
// so concurrent instances don't race (same model as usf). Files run outside
// a transaction so concurrent index builds are possible; see Up.
package migrations

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var fsys embed.FS

const lockKey = 727272

// chatMigrationRenames records schema_migrations.version strings that were
// renumbered from 034–045 to 046–057 so chat DDL no longer shares a numeric
// prefix with meeting migrations. Existing databases applied the old names;
// rename the rows once so Up does not re-run DDL that is already present.
var chatMigrationRenames = map[string]string{
	"034_chat_core":                          "046_chat_core",
	"035_chat_rooms_workspace_uidx":          "047_chat_rooms_workspace_uidx",
	"036_chat_room_members_active_uidx":      "048_chat_room_members_active_uidx",
	"037_chat_messages_room_idx":             "049_chat_messages_room_idx",
	"038_chat_room_members_user_idx":         "050_chat_room_members_user_idx",
	"039_chat_rooms_member_set_uidx":         "051_chat_rooms_member_set_uidx",
	"040_chat_rooms_organization_id":         "052_chat_rooms_organization_id",
	"041_drop_chat_rooms_ws_member_set_uidx": "053_drop_chat_rooms_ws_member_set_uidx",
	"042_chat_rooms_org_member_set_uidx":     "054_chat_rooms_org_member_set_uidx",
	"043_chat_blocks":                        "055_chat_blocks",
	"044_chat_blocks_org_pair_uidx":          "056_chat_blocks_org_pair_uidx",
	"045_matrix_ids":                         "057_matrix_ids",
}

// chatMigrationRenumbers records the second renumber. The chat DDL written on
// the long-dev-chat branch took 058–066 while audit, outbox and agents took the
// same prefixes on develop; merging the two put nine numbers in use twice, so
// the chat half moves to 143–151. These versions are deliberately absent from
// the backfill above: a database that never applied the branch names has not
// run the DDL, and marking it applied would skip it.
var chatMigrationRenumbers = map[string]string{
	"058_chat_room_send_restricted":             "143_chat_room_send_restricted",
	"059_chat_room_member_permissions":          "144_chat_room_member_permissions",
	"060_chat_messages_poll_kind":               "145_chat_messages_poll_kind",
	"061_chat_messages_reminder_kind":           "146_chat_messages_reminder_kind",
	"062_chat_messages_note_kind":               "147_chat_messages_note_kind",
	"063_chat_user_nicknames":                   "148_chat_user_nicknames",
	"064_chat_user_nicknames_owner_target_uidx": "149_chat_user_nicknames_owner_target_uidx",
	"065_chat_messages_client_msg_id":           "150_chat_messages_client_msg_id",
	"066_chat_messages_client_msg_id_uidx":      "151_chat_messages_client_msg_id_uidx",
}

func renameMigrationVersions(ctx context.Context, conn *pgxpool.Conn, renames map[string]string) error {
	for oldV, newV := range renames {
		if _, err := conn.Exec(ctx, `
			DELETE FROM schema_migrations
			WHERE version = $1
			  AND EXISTS (SELECT 1 FROM schema_migrations WHERE version = $2)`,
			oldV, newV); err != nil {
			return fmt.Errorf("drop stale migration version %s: %w", oldV, err)
		}
		if _, err := conn.Exec(ctx, `
			UPDATE schema_migrations SET version = $2
			WHERE version = $1`,
			oldV, newV); err != nil {
			return fmt.Errorf("rename migration version %s -> %s: %w", oldV, newV, err)
		}
	}
	return nil
}

func reconcileRenamedMigrations(ctx context.Context, conn *pgxpool.Conn) error {
	if err := renameMigrationVersions(ctx, conn, chatMigrationRenames); err != nil {
		return err
	}
	return renameMigrationVersions(ctx, conn, chatMigrationRenumbers)
}

func renamedChatVersions() []string {
	seen := make(map[string]struct{}, len(chatMigrationRenames))
	out := make([]string, 0, len(chatMigrationRenames))
	for _, newV := range chatMigrationRenames {
		if _, ok := seen[newV]; ok {
			continue
		}
		seen[newV] = struct{}{}
		out = append(out, newV)
	}
	sort.Strings(out)
	return out
}

// backfillRenamedChatMigrations marks the renumbered chat migrations as applied
// when chat_rooms already exists but schema_migrations still uses the old names
// or is missing rows — common on dev/test DBs created before the renumber.
func backfillRenamedChatMigrations(ctx context.Context, conn *pgxpool.Conn) error {
	var chatRooms bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'chat_rooms'
	)`).Scan(&chatRooms); err != nil {
		return err
	}
	if !chatRooms {
		return nil
	}
	for _, v := range renamedChatVersions() {
		if _, err := conn.Exec(ctx, `
			INSERT INTO schema_migrations (version)
			SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`,
			v); err != nil {
			return fmt.Errorf("backfill migration version %s: %w", v, err)
		}
	}
	return nil
}

func versions() ([]string, error) {
	entries, err := fsys.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var vs []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			vs = append(vs, strings.TrimSuffix(e.Name(), ".up.sql"))
		}
	}
	sort.Strings(vs)
	return vs, nil
}

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if err := WaitAdvisoryLock(ctx, conn, lockKey); err != nil {
		return err
	}
	defer conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	if err := reconcileRenamedMigrations(ctx, conn); err != nil {
		return err
	}
	if err := backfillRenamedChatMigrations(ctx, conn); err != nil {
		return err
	}
	vs, err := versions()
	if err != nil {
		return err
	}
	for _, v := range vs {
		var exists bool
		if err := conn.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", v).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := fsys.ReadFile(v + ".up.sql")
		if err != nil {
			return err
		}
		// Applied OUTSIDE a transaction on purpose. CREATE INDEX CONCURRENTLY —
		// the only kind of index build allowed from migration 005 on — is
		// rejected by PostgreSQL inside a transaction block, and the advisory
		// lock above already serializes runners. The cost is that a failing
		// multi-statement file can leave earlier statements applied; the file
		// is then fixed forward, which is the convention anyway.
		if _, err := conn.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("migration %s: %w", v, err)
		}
		if _, err := conn.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", v); err != nil {
			return err
		}
	}
	return nil
}

// Down rolls back the single most recent applied migration.
func Down(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var v string
	err = conn.QueryRow(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&v)
	if err != nil {
		return fmt.Errorf("nothing to roll back: %w", err)
	}
	sql, err := fsys.ReadFile(v + ".down.sql")
	if err != nil {
		return err
	}
	// Same reasoning as Up: DROP INDEX CONCURRENTLY cannot run in a transaction.
	if _, err := conn.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("rollback %s: %w", v, err)
	}
	_, err = conn.Exec(ctx, "DELETE FROM schema_migrations WHERE version=$1", v)
	return err
}

// WaitAdvisoryLock takes a session advisory lock by polling pg_try_advisory_lock
// instead of blocking in pg_advisory_lock. A blocked pg_advisory_lock is an
// open transaction, and CREATE INDEX CONCURRENTLY waits for every open
// transaction to finish — so a second node (or test package) waiting for
// this lock while the first builds an index would deadlock both.
func WaitAdvisoryLock(ctx context.Context, conn *pgxpool.Conn, key int) error {
	for {
		var got bool
		if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&got); err != nil {
			return err
		}
		if got {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// Latest is the newest embedded migration version; /readyz compares it with
// schema_migrations so a node running old code against a newer database, or
// new code against an unmigrated one, reports itself not ready.
func Latest() string {
	vs, err := versions()
	if err != nil || len(vs) == 0 {
		return ""
	}
	return vs[len(vs)-1]
}

// Applied returns the newest version recorded in schema_migrations.
func Applied(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var v string
	err := pool.QueryRow(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&v)
	return v, err
}
