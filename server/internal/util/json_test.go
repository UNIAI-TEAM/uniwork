package util

import (
	"reflect"
	"testing"
)

func TestJSONObjectOrEmpty(t *testing.T) {
	t.Parallel()
	if got := JSONObjectOrEmpty(nil); !reflect.DeepEqual(got, map[string]any{}) {
		t.Fatalf("nil: %v", got)
	}
	if got := JSONObjectOrEmpty([]byte("null")); !reflect.DeepEqual(got, map[string]any{}) {
		t.Fatalf("null json: %v", got)
	}
	if got := JSONObjectOrEmpty([]byte("not-json")); !reflect.DeepEqual(got, map[string]any{}) {
		t.Fatalf("invalid json: %v", got)
	}
	raw := []byte(`{"a":1,"b":"two"}`)
	got := JSONObjectOrEmpty(raw)
	if got["a"] != float64(1) || got["b"] != "two" {
		t.Fatalf("object: %v", got)
	}
}
