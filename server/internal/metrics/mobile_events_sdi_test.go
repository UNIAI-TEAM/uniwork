package metrics

import (
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

// The OpenAPI built from the apiOp catalog describes POST /api/v1/mobile/events
// with MobileEventSDI; it must name exactly the events this package counts and
// every result of each, or Swagger describes a closed set the server does not
// keep (review finding: ota_launch and app_crash were counted but missing).
func TestMobileEventSDIMatchesTheCountedEvents(t *testing.T) {
	field, ok := reflect.TypeOf(sdi.MobileEventSDI{}).FieldByName("Name")
	if !ok {
		t.Fatal("MobileEventSDI has no Name field")
	}
	documented := strings.Split(field.Tag.Get("enum"), ",")
	counted := make([]string, 0, len(mobileEventResults))
	for event := range mobileEventResults {
		counted = append(counted, event)
	}
	sort.Strings(documented)
	sort.Strings(counted)
	if !slices.Equal(documented, counted) {
		t.Fatalf("MobileEventSDI.Name enum %v, counted events %v", documented, counted)
	}

	result, _ := reflect.TypeOf(sdi.MobileEventSDI{}).FieldByName("Result")
	description := result.Tag.Get("description")
	for event, results := range mobileEventResults {
		if !strings.Contains(description, event) {
			t.Errorf("MobileEventSDI.Result description does not name %s", event)
		}
		for r := range results {
			if !strings.Contains(description, r) {
				t.Errorf("MobileEventSDI.Result description does not name %s's result %s", event, r)
			}
		}
	}
}
