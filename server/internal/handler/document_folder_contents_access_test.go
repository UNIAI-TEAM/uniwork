package handler

import (
	"net/http"
	"testing"
)

// TestFolderContentsAccessOverHTTP covers UNI-2244 §3 over the HTTP stack:
//   - PUT /api/v1/documents/{folderID}/contents-access dry_run=true (200 preview)
//   - PUT /api/v1/documents/{folderID}/contents-access sync execution (200 mode="sync")
//   - PUT /api/v1/documents/{folderID}/contents-access background execution (202 mode="background") and 409 folder_access_batch_running
//   - GET /api/v1/documents/{folderID}/contents-access/{batchID} progress (200 for creator, 404 for another user or unknown batch)
//   - 422 not_a_folder on a non-folder document, 422 document_access_rejected on invalid principals, 404 on unreadable folder
func TestFolderContentsAccessOverHTTP(t *testing.T) {
	w := newDocsWorld(t)

	// Create root folder and two child pages.
	res, folderOut := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents", w.token, map[string]any{
		"title": "Hồ sơ Chung", "kind": "folder",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create folder: %d %v", res.StatusCode, folderOut)
	}
	folderID := folderOut["document"].(map[string]any)["id"].(string)

	_, page1 := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Tài liệu A", "kind": "page", "visibility": "workspace", "parent_id": folderID,
	})
	_, page2 := docsCreatePageBody(t, w, w.token, map[string]any{
		"title": "Tài liệu B", "kind": "page", "visibility": "restricted", "parent_id": folderID,
	})
	_ = page2

	memberToken, memberID := docsJoinWorkspace(t, w, "fca-http-member@example.com")
	_, _ = docsJoinWorkspace(t, w, "fca-http-member2@example.com")
	outsiderToken, _ := filesRegister(t, w.srv, "fca-http-outsider@example.com")

	// 1. Non-folder root -> 422 not_a_folder.
	res, out := doJSON(t, w.srv, "PUT", "/api/v1/documents/"+page1+"/contents-access", w.token, map[string]any{
		"mode": "replace", "items": []any{},
	})
	wantErr(t, res, out, http.StatusUnprocessableEntity, "not_a_folder", "")

	// 2. Unreadable root -> 404 not_found.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", outsiderToken, map[string]any{
		"mode": "replace", "items": []any{},
	})
	wantErr(t, res, out, http.StatusNotFound, "not_found", "missing")

	// 3. Invalid principal -> 422 document_access_rejected with fields.rejected[].
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode": "merge",
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "view"},
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit"},
		},
	})
	wantErr(t, res, out, http.StatusUnprocessableEntity, "document_access_rejected", "")

	// 4. dry_run=true -> 200 {total, preview{changed, unchanged, skipped_not_manageable, skipped_locked, losing_users, downgraded_users, warnings[]}}.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode":    "merge",
		"dry_run": true,
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit"},
		},
	})
	if res.StatusCode != http.StatusOK || out["total"] != float64(2) {
		t.Fatalf("dry_run PUT: %d %v", res.StatusCode, out)
	}
	preview, _ := out["preview"].(map[string]any)
	if preview["changed"] != float64(2) || preview["unchanged"] != float64(0) {
		t.Fatalf("dry_run preview = %v", preview)
	}
	if _, ok := preview["warnings"].([]any); !ok {
		t.Fatalf("dry_run preview.warnings = %T (%v), want []any", preview["warnings"], preview["warnings"])
	}

	// 5. Sync execution -> 200 {batch_id, mode:"sync", total:2, changed:2, ...}.
	res, out = doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode": "merge",
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit"},
		},
	})
	if res.StatusCode != http.StatusOK || out["mode"] != "sync" || out["total"] != float64(2) || out["changed"] != float64(2) {
		t.Fatalf("sync PUT: %d %v", res.StatusCode, out)
	}
	syncBatchID, _ := out["batch_id"].(string)
	if syncBatchID == "" {
		t.Fatalf("sync PUT missing batch_id: %v", out)
	}

	// 6. GET /documents/{folderID}/contents-access/{batchID} returns 200 for creator, 404 for another member or unknown batch.
	res, batchOut := doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/contents-access/"+syncBatchID, w.token, nil)
	if res.StatusCode != http.StatusOK || batchOut["batch_id"] != syncBatchID || batchOut["status"] != "completed" ||
		batchOut["total"] != float64(2) || batchOut["processed"] != float64(2) || batchOut["changed"] != float64(2) || batchOut["finished_at"] == nil {
		t.Fatalf("GET sync batch: %d %v", res.StatusCode, batchOut)
	}
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/contents-access/"+syncBatchID, memberToken, nil)
	wantErr(t, res, out, http.StatusNotFound, "not_found", "missing")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/contents-access/01J8X4NONEXISTENT0000000000", w.token, nil)
	wantErr(t, res, out, http.StatusNotFound, "not_found", "missing")

	// 6b. Dry-run replace with user-only items (omitting the home-workspace row) when page1 had a home-workspace share:
	// member2 loses workspace access (losing_users == 1), memberID stays at edit (downgraded_users == 0),
	// and warnings is ["to_private"] (to_private present, downgrade absent).
	res, replacePreviewOut := doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode":    "replace",
		"dry_run": true,
		"items": []any{
			map[string]any{"principal_type": "user", "principal_id": memberID, "level": "edit"},
		},
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("dry_run replace user-only PUT: %d %v", res.StatusCode, replacePreviewOut)
	}
	replacePreview, _ := replacePreviewOut["preview"].(map[string]any)
	if replacePreview["losing_users"] != float64(1) || replacePreview["downgraded_users"] != float64(0) {
		t.Fatalf("dry_run replace user-only counts = %v, want losing_users=1 downgraded_users=0", replacePreview)
	}
	gotWarnings, _ := replacePreview["warnings"].([]any)
	if len(gotWarnings) != 1 || gotWarnings[0] != "to_private" {
		t.Fatalf("dry_run replace user-only warnings = %v, want [\"to_private\"]", gotWarnings)
	}
	// 7. Background execution (threshold overridden to 1) -> 202 {batch_id, mode:"background", total:2}, and 409 while queued.
	w.docs.SetFolderContentsAccessSyncMax(1)
	t.Cleanup(func() { w.docs.SetFolderContentsAccessSyncMax(0) })

	res, bgOut := doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode":  "replace",
		"items": []any{},
	})
	if res.StatusCode != http.StatusAccepted || bgOut["mode"] != "background" || bgOut["total"] != float64(2) {
		t.Fatalf("background PUT: %d %v", res.StatusCode, bgOut)
	}
	bgBatchID, _ := bgOut["batch_id"].(string)
	if bgBatchID == "" {
		t.Fatalf("background PUT missing batch_id: %v", bgOut)
	}

	// Second PUT while queued -> 409 folder_access_batch_running with fields.batch_id.
	res, conflictOut := doJSON(t, w.srv, "PUT", "/api/v1/documents/"+folderID+"/contents-access", w.token, map[string]any{
		"mode":  "replace",
		"items": []any{},
	})
	wantErr(t, res, conflictOut, http.StatusConflict, "folder_access_batch_running", "")
	errObj, _ := conflictOut["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if fields["batch_id"] != bgBatchID {
		t.Fatalf("409 fields.batch_id = %v, want %s", fields, bgBatchID)
	}

	// GET background batch while queued -> status="queued", finished_at omitted.
	res, queuedOut := doJSON(t, w.srv, "GET", "/api/v1/documents/"+folderID+"/contents-access/"+bgBatchID, w.token, nil)
	if res.StatusCode != http.StatusOK || queuedOut["status"] != "queued" || queuedOut["finished_at"] != nil {
		t.Fatalf("GET queued batch: %d %v", res.StatusCode, queuedOut)
	}
}
