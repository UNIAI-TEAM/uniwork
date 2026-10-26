package sdo_test

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

var driveSDITypes = map[string]reflect.Type{
	"StartDriveGoogleOAuthSDI":            reflect.TypeFor[sdi.StartDriveGoogleOAuthSDI](),
	"DriveGoogleCallbackSDI":              reflect.TypeFor[sdi.DriveGoogleCallbackSDI](),
	"CreateTaskDriveFileSDI":              reflect.TypeFor[sdi.CreateTaskDriveFileSDI](),
	"LinkDriveFilesSDI":                   reflect.TypeFor[sdi.LinkDriveFilesSDI](),
	"ListDriveFilesSDI":                   reflect.TypeFor[sdi.ListDriveFilesSDI](),
	"GrantDriveFileAccessSDI":             reflect.TypeFor[sdi.GrantDriveFileAccessSDI](),
	"RebindDriveFileSDI":                  reflect.TypeFor[sdi.RebindDriveFileSDI](),
	"CreateDriveTaskProposalSDI":          reflect.TypeFor[sdi.CreateDriveTaskProposalSDI](),
	"CheckDriveTaskProposalDuplicatesSDI": reflect.TypeFor[sdi.CheckDriveTaskProposalDuplicatesSDI](),
	"DriveProposalTaskItemSDI":            reflect.TypeFor[sdi.DriveProposalTaskItemSDI](),
	"CreateTasksFromDriveProposalSDI":     reflect.TypeFor[sdi.CreateTasksFromDriveProposalSDI](),
	"AskUniTranscriptTurnSDI":             reflect.TypeFor[sdi.AskUniTranscriptTurnSDI](),
	"AskUniTransientFieldsSDI":            reflect.TypeFor[sdi.AskUniTransientFieldsSDI](),
}

var driveSDOTypes = map[string]reflect.Type{
	"DriveConfigSDO":                  reflect.TypeFor[sdo.DriveConfigSDO](),
	"DriveOAuthStartSDO":              reflect.TypeFor[sdo.DriveOAuthStartSDO](),
	"DriveConnectionDTO":              reflect.TypeFor[sdo.DriveConnectionDTO](),
	"DriveConnectionListSDO":          reflect.TypeFor[sdo.DriveConnectionListSDO](),
	"DrivePickerTokenSDO":             reflect.TypeFor[sdo.DrivePickerTokenSDO](),
	"DriveTasksCreatedSummaryDTO":     reflect.TypeFor[sdo.DriveTasksCreatedSummaryDTO](),
	"DriveLinkedTaskRefDTO":           reflect.TypeFor[sdo.DriveLinkedTaskRefDTO](),
	"DriveTaskCreationGroupDTO":       reflect.TypeFor[sdo.DriveTaskCreationGroupDTO](),
	"DriveFileDTO":                    reflect.TypeFor[sdo.DriveFileDTO](),
	"DriveFileSDO":                    reflect.TypeFor[sdo.DriveFileSDO](),
	"DriveFileListSDO":                reflect.TypeFor[sdo.DriveFileListSDO](),
	"DriveFileLinkReceiptDTO":         reflect.TypeFor[sdo.DriveFileLinkReceiptDTO](),
	"DriveFileLinkItemDTO":            reflect.TypeFor[sdo.DriveFileLinkItemDTO](),
	"DriveFileLinkResultsSDO":         reflect.TypeFor[sdo.DriveFileLinkResultsSDO](),
	"DriveTaskFileCardDTO":            reflect.TypeFor[sdo.DriveTaskFileCardDTO](),
	"DriveTaskFileListSDO":            reflect.TypeFor[sdo.DriveTaskFileListSDO](),
	"DriveProposalExcerptDTO":         reflect.TypeFor[sdo.DriveProposalExcerptDTO](),
	"DriveDuplicateTaskDTO":           reflect.TypeFor[sdo.DriveDuplicateTaskDTO](),
	"DriveTaskProposalItemDTO":        reflect.TypeFor[sdo.DriveTaskProposalItemDTO](),
	"DriveTaskProposalDTO":            reflect.TypeFor[sdo.DriveTaskProposalDTO](),
	"DriveTaskProposalSDO":            reflect.TypeFor[sdo.DriveTaskProposalSDO](),
	"DriveProposalDuplicateItemDTO":   reflect.TypeFor[sdo.DriveProposalDuplicateItemDTO](),
	"DriveProposalDuplicatesSDO":      reflect.TypeFor[sdo.DriveProposalDuplicatesSDO](),
	"DriveProposalCreatedTaskItemDTO": reflect.TypeFor[sdo.DriveProposalCreatedTaskItemDTO](),
	"DriveProposalTasksCreatedSDO":    reflect.TypeFor[sdo.DriveProposalTasksCreatedSDO](),
}

// TestDriveLinkReceiptOmitsOtherMemberIdentities (R1-1 / R1-13) ensures that the
// link command receipt (DriveFileLinkReceiptDTO and DriveFileLinkItemDTO) never
// exposes another member's bound account, binder identity, or original linker
// identity on POST /api/v1/workspaces/{workspaceID}/drive-files (spec §7.2).
func TestDriveLinkReceiptOmitsOtherMemberIdentities(t *testing.T) {
	driveID := "0AJ8X4SHAREDDRV001"
	viewerConnID := "01J8X4DRVCONN0B1P2Q3R4S5T6"

	receipt := sdo.DriveFileLinkReceiptDTO{
		ID:                 "01J8X4DRVFILE0N1P2Q3R4S5T6",
		WorkspaceID:        "01J8X4WS0N1P2Q3R4S5T6U7V8",
		ExternalFileID:     "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
		DriveID:            &driveID,
		Name:               "Kế hoạch ra mắt Q4",
		MimeType:           "application/vnd.google-apps.document",
		IconKind:           "google_doc",
		SharingState:       sdo.DriveSharingStatePrivate,
		WebViewLink:        "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
		OpenURL:            "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=member-b%40gmail.com",
		ViewerAccess:       sdo.DriveViewerAccessGranted,
		ViewerConnectionID: &viewerConnID,
		ViewerAccountEmail: "member-b@gmail.com",
	}

	item := sdo.DriveFileLinkItemDTO{
		ExternalFileID: receipt.ExternalFileID,
		Outcome:        sdo.DriveFileLinkOutcomeLinked,
		File:           &receipt,
		AccountEmail:   "member-b@gmail.com",
	}

	raw, err := json.Marshal(sdo.DriveFileLinkResultsSDO{Results: []sdo.DriveFileLinkItemDTO{item}})
	if err != nil {
		t.Fatalf("marshal DriveFileLinkResultsSDO: %v", err)
	}

	var decoded struct {
		Results []map[string]any `json:"results"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal DriveFileLinkResultsSDO: %v", err)
	}
	if len(decoded.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(decoded.Results))
	}

	fileMap, ok := decoded.Results[0]["file"].(map[string]any)
	if !ok {
		t.Fatalf("expected results[0].file object, got %T", decoded.Results[0]["file"])
	}

	forbiddenKeys := []string{
		"connection_id",
		"bound_account_email",
		"bound_connection_lost",
		"access_lost_at",
		"bound_by",
		"bound_by_id",
		"bound_by_name",
		"created_by",
		"created_by_id",
		"created_by_kind",
		"created_by_name",
		"owner_display",
		"drive_modified_by_display",
		"used_in_count",
		"used_in_tasks",
		"tasks_created",
		"task_creations",
	}
	for _, k := range forbiddenKeys {
		if _, exists := fileMap[k]; exists {
			t.Errorf("DriveFileLinkReceiptDTO JSON must not contain key %q", k)
		}
		if _, exists := decoded.Results[0][k]; exists {
			t.Errorf("DriveFileLinkItemDTO JSON must not contain key %q", k)
		}
	}

	receiptType := reflect.TypeFor[sdo.DriveFileLinkReceiptDTO]()
	forbiddenSet := make(map[string]bool, len(forbiddenKeys))
	for _, k := range forbiddenKeys {
		forbiddenSet[k] = true
	}
	for i := range receiptType.NumField() {
		jsonKey := strings.Split(receiptType.Field(i).Tag.Get("json"), ",")[0]
		if forbiddenSet[jsonKey] {
			t.Errorf("DriveFileLinkReceiptDTO struct field %s has forbidden json tag %q", receiptType.Field(i).Name, jsonKey)
		}
	}

	requiredReceiptKeys := []string{
		"id",
		"workspace_id",
		"external_file_id",
		"name",
		"mime_type",
		"icon_kind",
		"sharing_state",
		"web_view_link",
		"open_url",
		"viewer_access",
		"viewer_connection_id",
		"viewer_account_email",
	}
	for _, k := range requiredReceiptKeys {
		if _, exists := fileMap[k]; !exists {
			t.Errorf("DriveFileLinkReceiptDTO JSON missing expected key %q", k)
		}
	}
}

// TestDriveTasksCreatedSummaryShape (R1-2) verifies that DriveTasksCreatedSummaryDTO
// has exact JSON keys {count, last_created_at, last_created_by_name} per spec §8.8,
// while DriveTaskCreationGroupDTO retains created_by_id.
func TestDriveTasksCreatedSummaryShape(t *testing.T) {
	at := "2026-10-26T09:58:00Z"
	by := "Minh Nguyễn"
	summary := sdo.DriveTasksCreatedSummaryDTO{
		Count:             4,
		LastCreatedAt:     &at,
		LastCreatedByName: &by,
	}
	raw, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal DriveTasksCreatedSummaryDTO: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal DriveTasksCreatedSummaryDTO: %v", err)
	}
	if _, exists := m["last_created_by_id"]; exists {
		t.Errorf("DriveTasksCreatedSummaryDTO must not contain last_created_by_id")
	}
	wantKeys := map[string]bool{
		"count":                true,
		"last_created_at":      true,
		"last_created_by_name": true,
	}
	if len(m) != len(wantKeys) {
		t.Fatalf("DriveTasksCreatedSummaryDTO keys = %v, want %v", m, wantKeys)
	}
	for k := range m {
		if !wantKeys[k] {
			t.Errorf("unexpected key %q in DriveTasksCreatedSummaryDTO", k)
		}
	}

	groupType := reflect.TypeFor[sdo.DriveTaskCreationGroupDTO]()
	hasCreatedByID := false
	for i := range groupType.NumField() {
		if strings.Split(groupType.Field(i).Tag.Get("json"), ",")[0] == "created_by_id" {
			hasCreatedByID = true
			break
		}
	}
	if !hasCreatedByID {
		t.Errorf("DriveTaskCreationGroupDTO must retain created_by_id")
	}
}

// TestDriveDTOFieldsHaveDescriptionsAndValidExamples (R1-3) parses sdi/drive.go
// and sdo/drive.go to ensure every exported struct is covered and reflects over
// every field to assert non-empty description and example tags, plus valid JSON
// example values on slice, struct, and map fields.
func TestDriveDTOFieldsHaveDescriptionsAndValidExamples(t *testing.T) {
	assertExportedStructsCovered(t, "../sdi/drive.go", driveSDITypes)
	assertExportedStructsCovered(t, "drive.go", driveSDOTypes)

	for name, typ := range driveSDITypes {
		assertStructFieldTags(t, "sdi."+name, typ)
	}
	for name, typ := range driveSDOTypes {
		assertStructFieldTags(t, "sdo."+name, typ)
	}
}

func assertExportedStructsCovered(t *testing.T, filename string, registry map[string]reflect.Type) {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filename, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok || !ts.Name.IsExported() {
				continue
			}
			if _, isStruct := ts.Type.(*ast.StructType); !isStruct {
				continue
			}
			if _, registered := registry[ts.Name.Name]; !registered {
				t.Errorf("%s: exported struct %s is missing from test registry", filename, ts.Name.Name)
			}
		}
	}
}

func assertStructFieldTags(t *testing.T, typeName string, typ reflect.Type) {
	t.Helper()
	for i := range typ.NumField() {
		f := typ.Field(i)
		fieldPath := typeName + "." + f.Name
		desc := strings.TrimSpace(f.Tag.Get("description"))
		if desc == "" {
			t.Errorf("%s: missing description tag", fieldPath)
		}
		ex := strings.TrimSpace(f.Tag.Get("example"))
		if ex == "" {
			t.Errorf("%s: missing example tag", fieldPath)
			continue
		}

		ft := f.Type
		for ft.Kind() == reflect.Pointer {
			ft = ft.Elem()
		}
		switch ft.Kind() {
		case reflect.Slice, reflect.Array:
			var arr []any
			if err := json.Unmarshal([]byte(ex), &arr); err != nil {
				t.Errorf("%s: slice example %q is not a valid JSON array: %v", fieldPath, ex, err)
			}
		case reflect.Struct, reflect.Map:
			var obj map[string]any
			if err := json.Unmarshal([]byte(ex), &obj); err != nil {
				t.Errorf("%s: struct/map example %q is not a valid JSON object: %v", fieldPath, ex, err)
			}
		}
	}
}
