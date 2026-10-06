package service

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"regexp"

	"github.com/unicomhub/uniwork/server/internal/office"
)

// Visuals (B8, UNI-940 X02). set_visual carries one chart, picture or shape
// the editor inserted this session: an id, a two-cell anchor (0-based cells
// plus EMU offsets, ending below and right of where it starts) and exactly
// one body. remove_visual cancels a session visual by id. Bounds mirror the
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
	return err == nil && len(decoded) <= maxOfficeVisualImageBytes
}

// officeSetVisualValid: set_visual - a sheet-ref target, a visual id, a
// two-cell anchor and exactly one of chart, shape or image.
func officeSetVisualValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeVisualObject(edit.Attributes, "id", "anchor", "chart", "shape", "image")
	if !ok || !officeVisualIDOK(attributes["id"]) || !officeVisualAnchorOK(attributes["anchor"]) {
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
	return bodies == 1 && valid
}

// officeRemoveVisualValid: remove_visual - a sheet-ref target plus an id.
func officeRemoveVisualValid(edit office.EditOp) bool {
	if !officeRangeTargetOK(edit.Target) {
		return false
	}
	attributes, ok := officeVisualObject(edit.Attributes, "id")
	return ok && len(attributes) == 1 && officeVisualIDOK(attributes["id"])
}
