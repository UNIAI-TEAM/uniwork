package handler

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentSummaryDTO_ShareScope verifies that toDocumentSummaryDTO and
// toSharedDocumentSummaryDTO emit share_scope with all five fields on the wire
// when ShareScope is populated and omit share_scope when ShareScope is nil.
func TestDocumentSummaryDTO_ShareScope(t *testing.T) {
	doc := db.Document{
		ID:             "01J8X4DOC0N1P2Q3R4S5T6U7V8",
		OrganizationID: "01J8X4ORG0N1P2Q3R4S5T6U7V8",
		WorkspaceID:    "01J8X4WSP0N1P2Q3R4S5T6U7V8",
		Kind:           "page",
		Title:          "Tài liệu kiểm thử",
		Visibility:     "workspace",
		Revision:       1,
		CurrentVersion: 1,
		CreatedBy:      "01J8X4USR0N1P2Q3R4S5T6U7V8",
		CreatedByKind:  "human",
		UpdatedBy:      "01J8X4USR0N1P2Q3R4S5T6U7V8",
		UpdatedByKind:  "human",
	}
	scope := &service.DocumentShareScope{
		HomeWorkspace: true,
		Users:         2,
		Workspaces:    1,
		Organization:  true,
		PublicLink:    true,
	}

	assertScopeWire := func(t *testing.T, dto sdo.DocumentSummaryDTO, wantPresent bool) {
		t.Helper()
		raw, err := json.Marshal(dto)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var wire map[string]any
		if err := json.Unmarshal(raw, &wire); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		rawScope, ok := wire["share_scope"]
		if !wantPresent {
			if dto.ShareScope != nil || ok {
				t.Fatalf("expected share_scope omitted, got dto=%+v wire=%v", dto.ShareScope, rawScope)
			}
			return
		}
		if dto.ShareScope == nil || !ok {
			t.Fatalf("expected share_scope present, got dto=%+v wire=%s", dto.ShareScope, raw)
		}
		if *dto.ShareScope != (sdo.DocumentShareScopeSDO{
			HomeWorkspace: true,
			Users:         2,
			Workspaces:    1,
			Organization:  true,
			PublicLink:    true,
		}) {
			t.Fatalf("dto.ShareScope = %+v", *dto.ShareScope)
		}
		m, ok := rawScope.(map[string]any)
		if !ok {
			t.Fatalf("wire share_scope = %#v", rawScope)
		}
		if m["home_workspace"] != true || m["users"] != float64(2) || m["workspaces"] != float64(1) || m["organization"] != true || m["public_link"] != true {
			t.Fatalf("wire share_scope fields = %v", m)
		}
	}

	t.Run("toDocumentSummaryDTO with ShareScope present and nil", func(t *testing.T) {
		withScope := toDocumentSummaryDTO(service.DocumentListItem{
			Document:   doc,
			ShareScope: scope,
		})
		assertScopeWire(t, withScope, true)

		withoutScope := toDocumentSummaryDTO(service.DocumentListItem{
			Document:   doc,
			ShareScope: nil,
		})
		assertScopeWire(t, withoutScope, false)
	})

	t.Run("toSharedDocumentSummaryDTO with ShareScope present and nil", func(t *testing.T) {
		withScope := toSharedDocumentSummaryDTO(service.SharedDocument{
			Document:   doc,
			Access:     service.DocumentAccess{Level: service.DocumentLevelView, Via: service.DocumentViaShare},
			ShareScope: scope,
		})
		assertScopeWire(t, withScope, true)

		withoutScope := toSharedDocumentSummaryDTO(service.SharedDocument{
			Document:   doc,
			Access:     service.DocumentAccess{Level: service.DocumentLevelView, Via: service.DocumentViaShare},
			ShareScope: nil,
		})
		assertScopeWire(t, withoutScope, false)
	})
}
