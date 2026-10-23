package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL keeps a fixed attribute slot per table (MaxHeapAttributeNumber
// 1600). DROP COLUMN only marks slots dropped; repeated migration rollbacks in
// tests exhaust them even when few columns are visible. Reclaim drops public
// on *_test databases when slots are nearly gone so Up can run again.
const testSchemaDroppedSlotThreshold = 400

func reclaimTestSchemaIfNeeded(ctx context.Context, conn *pgxpool.Conn) error {
	var dbName string
	if err := conn.QueryRow(ctx, `SELECT current_database()`).Scan(&dbName); err != nil {
		return err
	}
	if !strings.HasSuffix(dbName, "_test") {
		return nil
	}

	var maxDropped int
	err := conn.QueryRow(ctx, `
		SELECT COALESCE(MAX(dropped), 0) FROM (
		  SELECT count(*) FILTER (WHERE a.attisdropped) AS dropped
		  FROM pg_attribute a
		  JOIN pg_class c ON c.oid = a.attrelid
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0
		  GROUP BY c.relname
		) s`).Scan(&maxDropped)
	if err != nil {
		return err
	}
	if maxDropped < testSchemaDroppedSlotThreshold {
		return nil
	}

	if _, err := conn.Exec(ctx, `DROP SCHEMA public CASCADE`); err != nil {
		return fmt.Errorf("reclaim test schema drop: %w", err)
	}
	if _, err := conn.Exec(ctx, `CREATE SCHEMA public`); err != nil {
		return fmt.Errorf("reclaim test schema create: %w", err)
	}
	if _, err := conn.Exec(ctx, `GRANT ALL ON SCHEMA public TO public`); err != nil {
		return fmt.Errorf("reclaim test schema grant: %w", err)
	}
	return nil
}
