package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/office"
)

func TestValidateOfficeVisualEdits(t *testing.T) {
	const anchor = `"anchor":{"fromRow":1,"fromColumn":1,"fromRowOffset":0,"fromColumnOffset":0,"toRow":6,"toColumn":5,"toRowOffset":0,"toColumnOffset":0}`
	const chart = `"chart":{"chartType":"column","title":"Sales","series":[{"name":"Q1","categories":["North","South"],"values":[10,20.5],"valuesRef":"'Data'!$B$2:$B$3"}]}`
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))
	overImage := base64.StdEncoding.EncodeToString(make([]byte, maxOfficeVisualImageBytes+1))
	set := func(attributes string) []office.EditOp {
		return []office.EditOp{{Op: "set_visual", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{` + attributes + `}`)}}
	}
	remove := func(attributes string) []office.EditOp {
		return []office.EditOp{{Op: "remove_visual", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(attributes)}}
	}
	cases := []struct {
		name  string
		edits []office.EditOp
		ok    bool
	}{
		{"chart", set(`"id":"c1",` + anchor + `,` + chart), true},
		{"shape with fill and text", set(`"id":"s-1",` + anchor + `,"shape":{"shapeType":"rightArrow","fillColor":"#ED7D31","text":"Go"}`), true},
		{"picture", set(`"id":"p_1",` + anchor + `,"image":{"mediaType":"image/png","base64":"` + png + `"}`), true},
		{"remove by id", remove(`{"id":"c1"}`), true},
		{"anchor-only move with no insert before it", set(`"id":"c1",` + anchor), false},
		{"anchor-only move after its insert", append(set(`"id":"c1",`+anchor+`,`+chart), set(`"id":"c1",`+anchor)...), true},
		{"anchor-only move after a remove", append(append(set(`"id":"c1",`+anchor+`,`+chart), remove(`{"id":"c1"}`)...), set(`"id":"c1",`+anchor)...), false},
		{"anchor-only move of another id", append(set(`"id":"c1",`+anchor+`,`+chart), set(`"id":"c2",`+anchor)...), false},
		{"anchor-only move with a bad anchor", append(set(`"id":"c1",`+anchor+`,`+chart), set(`"id":"c1","anchor":{"fromRow":1}`)...), false},
		{"two bodies", set(`"id":"c1",` + anchor + `,` + chart + `,"shape":{"shapeType":"rect"}`), false},
		{"bad id", set(`"id":"c 1",` + anchor + `,` + chart), false},
		{"missing anchor", set(`"id":"c1",` + chart), false},
		{"empty anchor extent", set(`"id":"c1","anchor":{"fromRow":2,"fromColumn":1,"fromRowOffset":0,"fromColumnOffset":0,"toRow":2,"toColumn":5,"toRowOffset":0,"toColumnOffset":0},` + chart), false},
		{"anchor outside the grid", set(`"id":"c1","anchor":{"fromRow":0,"fromColumn":0,"fromRowOffset":0,"fromColumnOffset":0,"toRow":1048576,"toColumn":5,"toRowOffset":0,"toColumnOffset":0},` + chart), false},
		{"anchor extra key", set(`"id":"c1","anchor":{"fromRow":1,"fromColumn":1,"fromRowOffset":0,"fromColumnOffset":0,"toRow":6,"toColumn":5,"toRowOffset":0,"toColumnOffset":0,"rot":1},` + chart), false},
		{"unknown chart type", set(`"id":"c1",` + anchor + `,"chart":{"chartType":"radar","series":[{"name":"a","categories":[],"values":[1]}]}`), false},
		{"empty series", set(`"id":"c1",` + anchor + `,"chart":{"chartType":"pie","series":[]}`), false},
		{"empty values", set(`"id":"c1",` + anchor + `,"chart":{"chartType":"pie","series":[{"name":"a","categories":[],"values":[]}]}`), false},
		{"long title", set(`"id":"c1",` + anchor + `,"chart":{"chartType":"line","title":"` + strings.Repeat("t", 256) + `","series":[{"name":"a","categories":[],"values":[1]}]}`), false},
		{"unknown shape", set(`"id":"s1",` + anchor + `,"shape":{"shapeType":"star99"}`), false},
		{"bad fill colour", set(`"id":"s1",` + anchor + `,"shape":{"shapeType":"rect","fillColor":"red"}`), false},
		{"unsupported picture type", set(`"id":"p1",` + anchor + `,"image":{"mediaType":"image/bmp","base64":"` + png + `"}`), false},
		{"picture not base64", set(`"id":"p1",` + anchor + `,"image":{"mediaType":"image/png","base64":"not base64!"}`), false},
		{"picture over the size cap", set(`"id":"p1",` + anchor + `,"image":{"mediaType":"image/png","base64":"` + overImage + `"}`), false},
		{"unknown attribute", set(`"id":"c1",` + anchor + `,` + chart + `,"rotation":45`), false},
		{"missing target sheet", []office.EditOp{{Op: "set_visual", Target: json.RawMessage(`{"cell":"A1"}`), Attributes: json.RawMessage(`{"id":"c1",` + anchor + `,` + chart + `}`)}}, false},
		{"remove without id", remove(`{}`), false},
		{"remove extra field", remove(`{"id":"c1","force":true}`), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateOfficeJobEdits(office.OperationEdit, tc.edits)
			if tc.ok && err != nil {
				t.Fatalf("expected the edit to validate, got %v", err)
			}
			if !tc.ok && err == nil {
				t.Fatal("expected the edit to be refused")
			}
		})
	}
}

// A save carrying a picture at the cap plus ordinary cell edits stays inside
// the edits size bound (and so inside the 8 MiB document JSON body).
func TestOfficeVisualPictureAtTheCapFitsOneSave(t *testing.T) {
	image := base64.StdEncoding.EncodeToString(make([]byte, maxOfficeVisualImageBytes))
	edits := []office.EditOp{{
		Op:         "set_visual",
		Target:     json.RawMessage(`{"sheet":"S"}`),
		Attributes: json.RawMessage(`{"id":"p1","anchor":{"fromRow":0,"fromColumn":0,"fromRowOffset":0,"fromColumnOffset":0,"toRow":4,"toColumn":4,"toRowOffset":0,"toColumnOffset":0},"image":{"mediaType":"image/png","base64":"` + image + `"}}`),
	}}
	for i := 0; i < 500; i++ {
		edits = append(edits, office.EditOp{Op: "set_cell", Target: json.RawMessage(`{"sheet":"S","cell":"A1"}`), Text: "value"})
	}
	if err := validateOfficeJobEdits(office.OperationEdit, edits); err != nil {
		t.Fatalf("a picture at the cap plus cell edits must validate: %v", err)
	}
}

// B1: a move or resize is the anchor-only set_visual, so 100 nudges of a
// picture at the cap cost about one picture, far below the edits bound.
func TestOfficeVisualNudgedPictureFitsOneSave(t *testing.T) {
	image := base64.StdEncoding.EncodeToString(make([]byte, maxOfficeVisualImageBytes))
	at := func(row int) string {
		return fmt.Sprintf(`"anchor":{"fromRow":%d,"fromColumn":0,"fromRowOffset":0,"fromColumnOffset":0,"toRow":%d,"toColumn":4,"toRowOffset":0,"toColumnOffset":0}`, row, row+4)
	}
	edits := []office.EditOp{{
		Op:         "set_visual",
		Target:     json.RawMessage(`{"sheet":"S"}`),
		Attributes: json.RawMessage(`{"id":"p1",` + at(0) + `,"image":{"mediaType":"image/png","base64":"` + image + `"}}`),
	}}
	for i := 1; i <= 100; i++ {
		edits = append(edits, office.EditOp{Op: "set_visual", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"id":"p1",` + at(i) + `}`)})
	}
	raw, err := json.Marshal(edits)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > len(image)+100*400 {
		t.Fatalf("100 nudges cost %d bytes, want about one picture (%d)", len(raw), len(image))
	}
	if err := validateOfficeJobEdits(office.OperationEdit, edits); err != nil {
		t.Fatalf("a picture at the cap nudged 100 times must validate: %v", err)
	}
}
