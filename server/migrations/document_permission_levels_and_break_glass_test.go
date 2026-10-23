package migrations

import (
	"context"
	"testing"
)

func TestDocumentPermissionLevelsAndBreakGlassMigration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM document_shares WHERE id = 'g818-mig-share'`)
		_, _ = pool.Exec(ctx, `DELETE FROM document_access_logs WHERE id = 'g818-mig-log'`)
		_, _ = pool.Exec(ctx, `DELETE FROM document_break_glass_grants WHERE id LIKE 'g818-mig-%'`)
	})

	if _, err := pool.Exec(ctx, `INSERT INTO document_shares (id, organization_id, workspace_id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind)
		VALUES ('g818-mig-share', 'g818-org', 'g818-ws', 'g818-doc', 'user', 'g818-u1', 'comment', 'g818-u2', 'human')`); err != nil {
		t.Fatalf("document_shares with level='comment': %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE document_shares SET level = 'invalid' WHERE id = 'g818-mig-share'`); err == nil {
		t.Fatal("document_shares accepted level='invalid'")
	}

	if _, err := pool.Exec(ctx, `INSERT INTO document_access_logs (id, organization_id, workspace_id, document_id, actor_id, actor_kind, action, via, correlation_id)
		VALUES ('g818-mig-log', 'g818-org', 'g818-ws', 'g818-doc', 'g818-u1', 'human', 'view', 'break_glass', 'g818-corr')`); err != nil {
		t.Fatalf("document_access_logs with via='break_glass': %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE document_access_logs SET via = 'invalid' WHERE id = 'g818-mig-log'`); err == nil {
		t.Fatal("document_access_logs accepted via='invalid'")
	}

	if _, err := pool.Exec(ctx, `INSERT INTO document_break_glass_grants (
		id, organization_id, workspace_id, document_id, actor_id, actor_kind, level, reason, expires_at
	) VALUES (
		'g818-mig-bg', 'g818-org', 'g818-ws', 'g818-doc', 'g818-admin', 'human', 'view', 'Emergency audit check', now() + interval '24 hours'
	)`); err != nil {
		t.Fatalf("insert document_break_glass_grants: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE document_break_glass_grants SET level = 'edit' WHERE id = 'g818-mig-bg'`); err == nil {
		t.Fatal("document_break_glass_grants accepted level='edit'")
	}

	var hasIdx bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE schemaname = 'public' AND tablename = 'document_break_glass_grants'
		  AND indexname = 'idx_document_break_glass_grants_doc'
	)`).Scan(&hasIdx); err != nil {
		t.Fatal(err)
	}
	if !hasIdx {
		t.Fatal("missing idx_document_break_glass_grants_doc on document_break_glass_grants")
	}
}
