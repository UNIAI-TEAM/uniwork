package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// Database-level proof of the C-01 document constraints (UNI-675, AC-2):
// the kind pair, the payload rules, the owner pair and owned-no-parent
// invariant, the provenance pair and the conversion-reason vocabulary all
// hold at the database so service bugs cannot silently write bad shapes.

func insertRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string, cols map[string]any) {
	t.Helper()
	if err := insertRowE(ctx, pool, table, cols); err != nil {
		t.Fatalf("insert %s: %v", table, err)
	}
}

func insertRowE(ctx context.Context, pool *pgxpool.Pool, table string, cols map[string]any) error {
	names, args := make([]string, 0, len(cols)), make([]any, 0, len(cols))
	marks := make([]string, 0, len(cols))
	for k, v := range cols {
		names = append(names, k)
		args = append(args, v)
		marks = append(marks, fmt.Sprintf("$%d", len(args)))
	}
	_, err := pool.Exec(ctx, fmt.Sprintf(
		"INSERT INTO %s (%s) VALUES (%s)", table,
		strings.Join(names, ","), strings.Join(marks, ",")), args...)
	return err
}

func baseDoc(overrides map[string]any) map[string]any {
	m := map[string]any{
		"id":              "01DOCBASE00000000000000000",
		"organization_id": "01ORGDOC000000000000000000",
		"workspace_id":    "01WSDOC0000000000000000000",
		"kind":            "page",
		"title":           "Tài liệu",
		"visibility":      "workspace",
		"created_by":      "01USRDOC000000000000000000",
		"created_by_kind": "human",
		"updated_by":      "01USRDOC000000000000000000",
		"updated_by_kind": "human",
	}
	for k, v := range overrides {
		m[k] = v
	}
	return m
}

func expectCheckViolation(t *testing.T, err error, constraint string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected check violation %s, insert succeeded", constraint)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || !strings.Contains(pgErr.ConstraintName, constraint) {
		t.Fatalf("expected check violation %s, got %v", constraint, err)
	}
}

func TestDocumentConstraints(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()

	// A sane row lands first, proving the base shape itself passes.
	insertRow(t, ctx, pool, "documents", baseDoc(nil))
	insertRow(t, ctx, pool, "document_versions", map[string]any{
		"id": "01DVBASE000000000000000000", "organization_id": "01ORGDOC000000000000000000",
		"workspace_id": "01WSDOC0000000000000000000", "document_id": "01DOCBASE00000000000000000",
		"version": 1, "kind": "page", "reason": "manual",
		"content":    `{"type":"doc","content":[]}`,
		"created_by": "01USRDOC000000000000000000", "created_by_kind": "human",
	})

	t.Run("kind check", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK01", "kind": "note"}))
		expectCheckViolation(t, err, "documents_kind_check")
	})

	t.Run("file payload check", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK02", "kind": "file", "content": `{"type":"doc"}`}))
		expectCheckViolation(t, err, "documents_content_kind_check")
	})

	t.Run("page without content allowed", func(t *testing.T) {
		insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{"id": "01DOK03"}))
	})

	t.Run("owner pair requires both halves", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK04", "owner_id": "01WP0000000000000000000000"}))
		expectCheckViolation(t, err, "documents_owner_pair_check")

		err = insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK05", "owner_kind": "work_product"}))
		expectCheckViolation(t, err, "documents_owner_pair_check")
	})

	t.Run("owned document has no parent", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK06", "owner_kind": "work_product",
			"owner_id":  "01WP0000000000000000000000",
			"parent_id": "01DOCPARENT000000000000000"}))
		expectCheckViolation(t, err, "documents_owned_no_parent_check")
	})

	t.Run("owned document with owner pair allowed", func(t *testing.T) {
		insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK07", "owner_kind": "work_product",
			"owner_id":     "01WP0000000000000000000000",
			"acl_owner_id": "01USRDOC000000000000000000"}))
	})

	t.Run("owner kind vocabulary", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK08", "owner_kind": "project",
			"owner_id": "01WP0000000000000000000000"}))
		expectCheckViolation(t, err, "documents_owner_kind_check")
	})

	t.Run("source pair requires both halves", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK09", "source_document_id": "01DOCBASE00000000000000000"}))
		expectCheckViolation(t, err, "documents_source_pair_check")

		err = insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id": "01DOK10", "source_version_id": "01DVBASE000000000000000000"}))
		expectCheckViolation(t, err, "documents_source_pair_check")
	})

	t.Run("full provenance row allowed", func(t *testing.T) {
		insertRow(t, ctx, pool, "documents", baseDoc(map[string]any{
			"id":                 "01DOK11",
			"source_document_id": "01DOCBASE00000000000000000",
			"source_version_id":  "01DVBASE000000000000000000",
			"source_revision":    1, "source_format": "docx",
			"source_engine": "office-import/1.0", "target_format": "page",
			"source_checksum_sha256": strings.Repeat("ab", 32),
			"conversion_reason":      "lossy_same_format"}))
	})

	t.Run("conversion reason vocabulary", func(t *testing.T) {
		err := insertRowE(ctx, pool, "documents", baseDoc(map[string]any{
			"id":                 "01DOK12",
			"source_document_id": "01DOCBASE00000000000000000",
			"source_version_id":  "01DVBASE000000000000000000",
			"conversion_reason":  "because"}))
		expectCheckViolation(t, err, "documents_conversion_reason_check")
	})

	t.Run("version payload pair", func(t *testing.T) {
		// file version without file_id
		err := insertRowE(ctx, pool, "document_versions", map[string]any{
			"id": "01DVK01", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id": "01WSDOC0000000000000000000",
			"document_id":  "01DOCBASE00000000000000000",
			"version":      2, "kind": "file", "reason": "upload",
			"created_by": "01USRDOC000000000000000000", "created_by_kind": "human"})
		expectCheckViolation(t, err, "document_versions_payload_check")

		// page version without content
		err = insertRowE(ctx, pool, "document_versions", map[string]any{
			"id": "01DVK02", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id": "01WSDOC0000000000000000000",
			"document_id":  "01DOCBASE00000000000000000",
			"version":      2, "kind": "page", "reason": "manual",
			"created_by": "01USRDOC000000000000000000", "created_by_kind": "human"})
		expectCheckViolation(t, err, "document_versions_payload_check")

		// file version with file_id passes
		insertRow(t, ctx, pool, "document_versions", map[string]any{
			"id": "01DVK03", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id": "01WSDOC0000000000000000000",
			"document_id":  "01DOCBASE00000000000000000",
			"version":      3, "kind": "file", "reason": "upload",
			"file_id":    "01FIL0000000000000000000000A",
			"created_by": "01USRDOC000000000000000000", "created_by_kind": "human"})
	})

	t.Run("version reason vocabulary", func(t *testing.T) {
		err := insertRowE(ctx, pool, "document_versions", map[string]any{
			"id": "01DVK04", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id": "01WSDOC0000000000000000000",
			"document_id":  "01DOCBASE00000000000000000",
			"version":      4, "kind": "page", "reason": "because",
			"content":    `{"type":"doc"}`,
			"created_by": "01USRDOC000000000000000000", "created_by_kind": "human"})
		expectCheckViolation(t, err, "document_versions_reason_check")
	})

	t.Run("share level vocabulary", func(t *testing.T) {
		err := insertRowE(ctx, pool, "document_shares", map[string]any{
			"id": "01DSK01", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id":   "01WSDOC0000000000000000000",
			"document_id":    "01DOCBASE00000000000000000",
			"principal_type": "user", "principal_id": "01USRDOC000000000000000000",
			"level":      "admin",
			"granted_by": "01USRDOC000000000000000000", "granted_by_kind": "human"})
		expectCheckViolation(t, err, "document_shares_level_check")

		insertRow(t, ctx, pool, "document_shares", map[string]any{
			"id": "01DSK02", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id":   "01WSDOC0000000000000000000",
			"document_id":    "01DOCBASE00000000000000000",
			"principal_type": "workspace", "principal_id": "01WSDOC0000000000000000000",
			"level":      "manage",
			"granted_by": "01USRDOC000000000000000000", "granted_by_kind": "human"})
	})

	t.Run("access log via vocabulary", func(t *testing.T) {
		log := func(id, via string) map[string]any {
			return map[string]any{
				"id": id, "organization_id": "01ORGDOC000000000000000000",
				"workspace_id": "01WSDOC0000000000000000000",
				"document_id":  "01DOCBASE00000000000000000",
				"action":       "view", "actor_kind": "human",
				"actor_id": "01USRDOC000000000000000000",
				"via":      via, "correlation_id": "corr-" + id}
		}
		insertRow(t, ctx, pool, "document_access_logs", log("01DAK01", "member"))
		insertRow(t, ctx, pool, "document_access_logs", log("01DAK02", "owner"))
		insertRow(t, ctx, pool, "document_access_logs", log("01DAK03", "ai_context"))
		err := insertRowE(ctx, pool, "document_access_logs", log("01DAK04", "hacker"))
		expectCheckViolation(t, err, "document_access_logs_via_check")
	})

	t.Run("anonymous link viewer", func(t *testing.T) {
		insertRow(t, ctx, pool, "document_access_logs", map[string]any{
			"id": "01DAK05", "organization_id": "01ORGDOC000000000000000000",
			"workspace_id": "01WSDOC0000000000000000000",
			"document_id":  "01DOCBASE00000000000000000",
			"action":       "link_view", "actor_kind": "anonymous",
			"via": "link", "correlation_id": "corr-05"})
	})
}
