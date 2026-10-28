package sdo_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

var folderContentsAccessSDITypes = map[string]reflect.Type{
	"FolderContentsAccessItemSDI":   reflect.TypeFor[sdi.FolderContentsAccessItemSDI](),
	"UpdateFolderContentsAccessSDI": reflect.TypeFor[sdi.UpdateFolderContentsAccessSDI](),
}

var folderContentsAccessSDOTypes = map[string]reflect.Type{
	"FolderContentsAccessPreviewSDO":    reflect.TypeFor[sdo.FolderContentsAccessPreviewSDO](),
	"FolderContentsAccessDryRunSDO":     reflect.TypeFor[sdo.FolderContentsAccessDryRunSDO](),
	"FolderContentsAccessSyncSDO":       reflect.TypeFor[sdo.FolderContentsAccessSyncSDO](),
	"FolderContentsAccessBackgroundSDO": reflect.TypeFor[sdo.FolderContentsAccessBackgroundSDO](),
	"FolderContentsAccessResultSDO":     reflect.TypeFor[sdo.FolderContentsAccessResultSDO](),
	"FolderContentsAccessBatchSDO":      reflect.TypeFor[sdo.FolderContentsAccessBatchSDO](),
}

func TestFolderContentsAccessDTOFieldsHaveDescriptionsAndValidExamples(t *testing.T) {
	assertExportedStructsCovered(t, "../sdi/document_folder_contents_access.go", folderContentsAccessSDITypes)
	assertExportedStructsCovered(t, "document_folder_contents_access.go", folderContentsAccessSDOTypes)

	for name, typ := range folderContentsAccessSDITypes {
		assertStructFieldTags(t, "sdi."+name, typ)
	}
	for name, typ := range folderContentsAccessSDOTypes {
		if name == "FolderContentsAccessResultSDO" {
			continue
		}
		assertStructFieldTags(t, "sdo."+name, typ)
	}
}

func TestFolderContentsAccessWireShapes(t *testing.T) {
	mustDecodeStrict := func(raw string, target any) {
		t.Helper()
		dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
		dec.DisallowUnknownFields()
		if err := dec.Decode(target); err != nil {
			t.Fatalf("strict decode %T failed: %v\nraw: %s", target, err, raw)
		}
	}

	// 1. Request bodies: merge, replace with empty items, dry-run.
	var mergeReq sdi.UpdateFolderContentsAccessSDI
	mustDecodeStrict(`{"mode":"merge","items":[{"principal_type":"user","principal_id":"01J8X4K2M0N1P2Q3R4S5T6U7V8","level":"edit"}],"dry_run":false}`, &mergeReq)
	if mergeReq.Mode != "merge" || len(mergeReq.Items) != 1 || mergeReq.Items[0].Level != "edit" {
		t.Fatalf("mergeReq = %+v", mergeReq)
	}

	var replaceEmptyReq sdi.UpdateFolderContentsAccessSDI
	mustDecodeStrict(`{"mode":"replace","items":[]}`, &replaceEmptyReq)
	if replaceEmptyReq.Mode != "replace" || len(replaceEmptyReq.Items) != 0 || replaceEmptyReq.DryRun {
		t.Fatalf("replaceEmptyReq = %+v", replaceEmptyReq)
	}

	// 2. Dry-run 200 SDO.
	var dryRun sdo.FolderContentsAccessDryRunSDO
	mustDecodeStrict(`{
		"total": 55,
		"preview": {
			"changed": 37,
			"unchanged": 12,
			"skipped_not_manageable": 5,
			"skipped_locked": 1,
			"losing_users": 12,
			"downgraded_users": 3,
			"warnings": ["wide_scope", "to_private"]
		}
	}`, &dryRun)
	if dryRun.Total != 55 || dryRun.Preview.Changed != 37 || len(dryRun.Preview.Warnings) != 2 {
		t.Fatalf("dryRun = %+v", dryRun)
	}

	// 3. Sync 200 SDO.
	var syncRes sdo.FolderContentsAccessSyncSDO
	mustDecodeStrict(`{
		"batch_id": "01J8X4FAB0N1P2Q3R4S5T6U7V8",
		"mode": "sync",
		"total": 55,
		"changed": 37,
		"unchanged": 12,
		"skipped_not_manageable": 5,
		"skipped_locked": 1
	}`, &syncRes)
	if syncRes.Mode != sdo.FolderContentsAccessExecSync || syncRes.Changed != 37 {
		t.Fatalf("syncRes = %+v", syncRes)
	}

	// 4. Background 202 SDO.
	var bgRes sdo.FolderContentsAccessBackgroundSDO
	mustDecodeStrict(`{
		"batch_id": "01J8X4FAB0N1P2Q3R4S5T6U7V8",
		"mode": "background",
		"total": 1250
	}`, &bgRes)
	if bgRes.Mode != sdo.FolderContentsAccessExecBackground || bgRes.Total != 1250 {
		t.Fatalf("bgRes = %+v", bgRes)
	}

	// 5. Batch progress GET SDO (running without finished_at, completed with finished_at).
	var batchRunning sdo.FolderContentsAccessBatchSDO
	mustDecodeStrict(`{
		"batch_id": "01J8X4FAB0N1P2Q3R4S5T6U7V8",
		"status": "running",
		"total": 1250,
		"processed": 600,
		"changed": 410,
		"unchanged": 150,
		"skipped_not_manageable": 35,
		"skipped_locked": 5
	}`, &batchRunning)
	if batchRunning.Status != sdo.FolderContentsAccessBatchStatusRunning || batchRunning.FinishedAt != nil {
		t.Fatalf("batchRunning = %+v", batchRunning)
	}

	var batchCompleted sdo.FolderContentsAccessBatchSDO
	mustDecodeStrict(`{
		"batch_id": "01J8X4FAB0N1P2Q3R4S5T6U7V8",
		"status": "completed",
		"total": 1250,
		"processed": 1250,
		"changed": 820,
		"unchanged": 350,
		"skipped_not_manageable": 70,
		"skipped_locked": 10,
		"finished_at": "2026-10-27T10:15:30Z"
	}`, &batchCompleted)
	if batchCompleted.Status != sdo.FolderContentsAccessBatchStatusCompleted || batchCompleted.FinishedAt == nil {
		t.Fatalf("batchCompleted = %+v", batchCompleted)
	}
}
