package service

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"
	"regexp"

	"github.com/unicomhub/uniwork/server/internal/office"
)

// Visuals (B8, UNI-940 X02). set_visual carries one chart, picture or shape
// the editor inserted this session: an id, a two-cell anchor (0-based cells
// plus EMU offsets, ending below and right of where it starts) and exactly
// one body. A move or resize is the anchor-only set_visual (id + anchor, no
// body), so a picture's bytes ride only its insert; officeVisualEditsOrdered
// refuses an anchor-only set_visual whose insert is not earlier in the same
// job (a media-less insert). remove_visual cancels a session visual by id.
// A visual already in the file is addressed by `file` (its anchor index in the
// sheet's drawing part, 0..10000) instead of an id: set_visual {file, anchor}
// moves it, remove_visual {file} deletes it; neither takes an id or a body
// and neither needs an earlier insert. Bounds mirror the
// engine parser (packages/office-engine/src/xlsx/ops-visuals.ts) and the
// vendored ChartAdd/ShapeAdd/ImageAdd shapes the gateway writes.
const (
	maxOfficeVisualSeries     = 24
	maxOfficeVisualPoints     = 1_000
	maxOfficeVisualText       = 255
	maxOfficeVisualCategory   = 1_024
	maxOfficeVisualRef        = 512
	maxOfficeVisualOffsetEMU  = 100_000_000
	maxOfficeVisualImageBytes = 512 * 1024
	maxOfficeVisualFileIndex  = 10_000
)

var (
	officeVisualIDPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	officeVisualColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	officeVisualChartTypes   = map[string]bool{"column": true, "bar": true, "line": true, "pie": true, "area": true, "doughnut": true}
	officeVisualShapeTypes   = map[string]bool{"rect": true, "roundRect": true, "ellipse": true, "triangle": true, "rightArrow": true, "leftArrow": true, "line": true}
	officeVisualImageTypes   = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true}
)

// officeVisualObject decodes a JSON object whose keys all come from allowed.
func officeVisualObject(raw json.RawMessage, allowed ...string) (map[string]json.RawMessage, bool) {
	fields, ok := officeStructuralAttributes(raw)
	if !ok {
		return nil, false
	}
	for name := range fields {
		known := false
		for _, candidate := range allowed {
			if name == candidate {
				known = true
				break
			}
		}
		if !known {
			return nil, false
		}
	}
	return fields, true
}

// officeVisualString decodes a string of at most max bytes.
func officeVisualString(raw json.RawMessage, max int) (string, bool) {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil || len(value) > max {
		return "", false
	}
	return value, true
}

func officeVisualIDOK(raw json.RawMessage) bool {
	id, ok := officeVisualString(raw, 64)
	return ok && officeVisualIDPattern.MatchString(id)
}

// officeVisualAnchorOK: the eight DrawingAnchor integers, in the grid, with
// bounded offsets and a non-empty extent on both axes.
func officeVisualAnchorOK(raw json.RawMessage) bool {
	names := []string{"fromRow", "fromColumn", "fromRowOffset", "fromColumnOffset", "toRow", "toColumn", "toRowOffset", "toColumnOffset"}
	fields, ok := officeVisualObject(raw, names...)
	if !ok || len(fields) != len(names) {
		return false
	}
	limits := map[string]int{
		"fromRow": maxOfficeEditRows - 1, "toRow": maxOfficeEditRows - 1,
		"fromColumn": maxOfficeEditColumns - 1, "toColumn": maxOfficeEditColumns - 1,
		"fromRowOffset": maxOfficeVisualOffsetEMU, "toRowOffset": maxOfficeVisualOffsetEMU,
		"fromColumnOffset": maxOfficeVisualOffsetEMU, "toColumnOffset": maxOfficeVisualOffsetEMU,
	}
	v := make(map[string]int, len(names))
	for _, name := range names {
		value, ok := officeStructuralInt(fields, name, 0, limits[name])
		if !ok {
			return false
		}
		v[name] = value
	}
	after := func(endCell, endOffset, startCell, startOffset int) bool {
		return endCell > startCell || (endCell == startCell && endOffset > startOffset)
	}
	return after(v["toRow"], v["toRowOffset"], v["fromRow"], v["fromRowOffset"]) &&
		after(v["toColumn"], v["toColumnOffset"], v["fromColumn"], v["fromColumnOffset"])
}

func officeVisualSeriesOK(raw json.RawMessage) bool {
	fields, ok := officeVisualObject(raw, "name", "categories", "values", "valuesRef", "categoriesRef")
	if !ok {
		return false
	}
	if _, ok := officeVisualString(fields["name"], maxOfficeVisualText); !ok {
		return false
	}
	var values []float64
	if json.Unmarshal(fields["values"], &values) != nil || len(values) == 0 || len(values) > maxOfficeVisualPoints {
		return false
	}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	var categories []string
	if json.Unmarshal(fields["categories"], &categories) != nil || categories == nil || len(categories) > maxOfficeVisualPoints {
		return false
	}
	for _, category := range categories {
		if len(category) > maxOfficeVisualCategory {
			return false
		}
	}
	for _, name := range []string{"valuesRef", "categoriesRef"} {
		if ref, present := fields[name]; present {
			if _, ok := officeVisualString(ref, maxOfficeVisualRef); !ok {
				return false
			}
		}
	}
	return true
}

func officeVisualChartOK(raw json.RawMessage) bool {
	fields, ok := officeVisualObject(raw, "chartType", "title", "series")
	if !ok {
		return false
	}
	chartType, ok := officeVisualString(fields["chartType"], 16)
	if !ok || !officeVisualChartTypes[chartType] {
		return false
	}
	if title, present := fields["title"]; present {
		if _, ok := officeVisualString(title, maxOfficeVisualText); !ok {
			return false
		}
	}
	var series []json.RawMessage
	if json.Unmarshal(fields["series"], &series) != nil || len(series) == 0 || len(series) > maxOfficeVisualSeries {
		return false
	}
	for _, entry := range series {
		if !officeVisualSeriesOK(entry) {
			return false
		}
	}
	return true
}

func officeVisualShapeOK(raw json.RawMessage) bool {
	fields, ok := officeVisualObject(raw, "shapeType", "fillColor", "text")
	if !ok {
		return false
	}
	shapeType, ok := officeVisualString(fields["shapeType"], 32)
	if !ok || !officeVisualShapeTypes[shapeType] {
		return false
	}
	if color, present := fields["fillColor"]; present {
		value, ok := officeVisualString(color, 7)
		if !ok || !officeVisualColorPattern.MatchString(value) {
			return false
		}
	}
	if text, present := fields["text"]; present {
		if _, ok := officeVisualString(text, maxOfficeVisualText); !ok {
			return false
		}
	}
	return true
}

func officeVisualImageOK(raw json.RawMessage) bool {
	fields, ok := officeVisualObject(raw, "mediaType", "base64")
	if !ok || len(fields) != 2 {
		return false
	}
	mediaType, ok := officeVisualString(fields["mediaType"], 16)
	if !ok || !officeVisualImageTypes[mediaType] {
		return false
	}
	encoded, ok := officeVisualString(fields["base64"], base64.StdEncoding.EncodedLen(maxOfficeVisualImageBytes))
	if !ok || encoded == "" {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) > maxOfficeVisualImageBytes {
		return false
	}
	// The declared type must match the bytes: it names the xl/media part the
	// gateway writes, and a mislabelled picture opens broken in Excel.
	for _, signature := range officeVisualImageSignatures[mediaType] {
		if bytes.HasPrefix(decoded, []byte(signature)) {
			return true
		}
	}
	return false
}

// officeVisualImageSignatures: the magic bytes each allowed picture type starts with.
var officeVisualImageSignatures = map[string][]string{
	"image/png":  {"\x89PNG\r\n\x1a\n"},
	"image/jpeg": {"\xff\xd8\xff"},
	"image/gif":  {"GIF87a", "GIF89a"},
}

// officeSetVisualValid: set_visual - a sheet-ref target, a visual id, a
// two-cell anchor and at most one of chart, shape or image (none is a move).
func officeSetVisualValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeVisualObject(edit.Attributes, "id", "file", "anchor", "chart", "shape", "image")
	if !ok {
		return false
	}
	if _, fileForm := attributes["file"]; fileForm {
		_, fileOK := officeStructuralInt(attributes, "file", 0, maxOfficeVisualFileIndex)
		return fileOK && len(attributes) == 2 && officeVisualAnchorOK(attributes["anchor"])
	}
	if !officeVisualIDOK(attributes["id"]) || !officeVisualAnchorOK(attributes["anchor"]) {
		return false
	}
	bodies := 0
	valid := true
	if raw, present := attributes["chart"]; present {
		bodies++
		valid = valid && officeVisualChartOK(raw)
	}
	if raw, present := attributes["shape"]; present {
		bodies++
		valid = valid && officeVisualShapeOK(raw)
	}
	if raw, present := attributes["image"]; present {
		bodies++
		valid = valid && officeVisualImageOK(raw)
	}
	return bodies <= 1 && valid
}

// officeVisualEditsOrdered is the job-level half of the set_visual gate: an
// anchor-only set_visual (a move) must follow a set_visual with a body for the
// same id earlier in the job, with no remove_visual of that id between them.
// The engine folds the move into that pending visual and refuses a move with
// none; the editor locks a visual once a save wrote it, so a later job never
// moves a visual it did not insert. Ids are matched without the sheet: the
// editor's ids are unique per session and a sheet rename changes the target.
// Every edit has already passed its per-op validator.
func officeVisualEditsOrdered(edits []office.EditOp) bool {
	live := map[string]bool{}
	for _, edit := range edits {
		if edit.Op != "set_visual" && edit.Op != "remove_visual" {
			continue
		}
		attributes, ok := officeStructuralAttributes(edit.Attributes)
		if !ok {
			return false
		}
		if _, fileForm := attributes["file"]; fileForm {
			continue // a file visual is not a session visual: no id bookkeeping
		}
		id, ok := officeVisualString(attributes["id"], 64)
		if !ok {
			return false
		}
		if edit.Op == "remove_visual" {
			delete(live, id)
			continue
		}
		_, chart := attributes["chart"]
		_, shape := attributes["shape"]
		_, image := attributes["image"]
		if chart || shape || image {
			live[id] = true
		} else if !live[id] {
			return false
		}
	}
	return true
}

// officeRemoveVisualValid: remove_visual - a sheet-ref target plus an id.
func officeRemoveVisualValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeVisualObject(edit.Attributes, "id", "file")
	if !ok || len(attributes) != 1 {
		return false
	}
	if _, fileForm := attributes["file"]; fileForm {
		_, fileOK := officeStructuralInt(attributes, "file", 0, maxOfficeVisualFileIndex)
		return fileOK
	}
	return officeVisualIDOK(attributes["id"])
}
