package service

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
)

// Inner rule bodies of set_conditional_formats / set_data_validations (review
// m2). Mirrors the allowlists and fail-closed branches of
// packages/office-engine/src/xlsx/ops-cf-dv.ts (cfRuleUnsaveable,
// highlightUnsaveable, dvRuleUnsaveable), so the gate refuses what the engine
// parser refuses.
//
// Known gaps, deliberately not mirrored: the engine coerces errorStyle with
// JS Number(), which also admits booleans, "" and one-element arrays; this
// gate accepts only the numbers 0..2 and their decimal strings. Colours,
// styles and cfvo details stay the gateway serializer's call, as in the
// engine parser.
var (
	officeCellIsOperators = map[string]bool{
		"between": true, "notBetween": true, "equal": true, "notEqual": true,
		"greaterThan": true, "greaterThanOrEqual": true, "lessThan": true, "lessThanOrEqual": true,
	}
	officeCfTextOperators = map[string]bool{
		"containsText": true, "notContainsText": true, "beginsWith": true, "endsWith": true,
		"equal": true, "notEqual": true, "containsBlanks": true, "notContainsBlanks": true,
		"containsErrors": true, "notContainsErrors": true,
	}
	officeCfAverageOperators = map[string]bool{
		"greaterThan": true, "greaterThanOrEqual": true, "lessThan": true, "lessThanOrEqual": true,
	}
)

// officeCfRuleBodyOK validates a conditional-format rule body of an allowed type.
func officeCfRuleBodyOK(ruleType string, body map[string]json.RawMessage) bool {
	switch ruleType {
	case "highlightCell":
		return officeHighlightBodyOK(body)
	case "colorScale", "iconSet":
		var config []json.RawMessage
		return json.Unmarshal(body["config"], &config) == nil && len(config) >= 2
	case "dataBar":
		return officeJSONObject(body["config"])
	}
	return false
}

func officeHighlightBodyOK(body map[string]json.RawMessage) bool {
	var subType string
	if json.Unmarshal(body["subType"], &subType) != nil {
		return false
	}
	operator, hasOperator := officeJSONString(body["operator"])
	switch subType {
	case "number":
		if !hasOperator || !officeCellIsOperators[operator] {
			return false
		}
		values := []json.RawMessage{body["value"]}
		if bytes.HasPrefix(bytes.TrimSpace(body["value"]), []byte("[")) {
			if json.Unmarshal(body["value"], &values) != nil {
				return false
			}
		}
		for _, value := range values {
			if _, ok := officeFiniteNumber(value); !ok {
				return false
			}
		}
		return true
	case "text":
		return hasOperator && officeCfTextOperators[operator]
	case "duplicateValues", "uniqueValues":
		return true
	case "rank":
		_, ok := officeFiniteNumber(body["value"])
		return ok
	case "average":
		return hasOperator && officeCfAverageOperators[operator]
	case "formula":
		formula, ok := officeJSONString(body["value"])
		return ok && formula != ""
	}
	return false
}

// officeDvRuleBodyOK validates a data-validation rule body: the operator and
// errorStyle allowlists; the gateway owns formula shapes.
func officeDvRuleBodyOK(_ string, body map[string]json.RawMessage) bool {
	if raw, present := body["operator"]; present {
		// officeJSONString reads JSON null as ""; the engine refuses null
		// (only absent, "" or an allowed string pass), so the gate does too.
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return false
		}
		operator, ok := officeJSONString(raw)
		if !ok || (operator != "" && !officeCellIsOperators[operator]) {
			return false
		}
	}
	raw, present := body["errorStyle"]
	if !present || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true
	}
	var style float64
	if json.Unmarshal(raw, &style) != nil {
		var text string
		if json.Unmarshal(raw, &text) != nil {
			return false
		}
		text = strings.TrimSpace(text)
		if text != "0" && text != "1" && text != "2" {
			return false
		}
		return true
	}
	return style == 0 || style == 1 || style == 2
}

func officeJSONString(raw json.RawMessage) (string, bool) {
	var text string
	return text, json.Unmarshal(raw, &text) == nil
}

func officeJSONObject(raw json.RawMessage) bool {
	var object map[string]json.RawMessage
	return json.Unmarshal(raw, &object) == nil && object != nil
}

func officeFiniteNumber(raw json.RawMessage) (float64, bool) {
	var number float64
	if json.Unmarshal(raw, &number) != nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}
