package tablequery

import (
	"errors"
	"testing"
)

func TestGroupKeyRoundTrip(t *testing.T) {
	prop := &PropertyRef{ID: "01PROP", Type: "select"}
	cases := []struct {
		g    Group
		p    GroupPredicate
		want string
	}{
		{Group{Kind: "status"}, GroupPredicate{Kind: "status", Value: "todo"}, "status:todo"},
		{Group{Kind: "priority"}, GroupPredicate{Kind: "priority", Value: "high"}, "priority:high"},
		{Group{Kind: "assignee"}, GroupPredicate{Kind: "assignee", None: true}, "assignee:none"},
		{Group{Kind: "assignee"}, GroupPredicate{Kind: "assignee", ActorKind: "agent", Value: "01AG"}, "assignee:agent:01AG"},
		{Group{Kind: "project"}, GroupPredicate{Kind: "project", None: true}, "project:none"},
		{Group{Kind: "project"}, GroupPredicate{Kind: "project", Value: "01PJ"}, "project:01PJ"},
		{Group{Kind: "property", Property: prop}, GroupPredicate{Kind: "property", None: true}, "property:01PROP:none"},
		{Group{Kind: "property", Property: prop}, GroupPredicate{Kind: "property", Value: "opt:1"}, "property:01PROP:v:b3B0OjE"},
	}
	for _, c := range cases {
		if got := EncodeGroupKey(c.g, c.p); got != c.want {
			t.Fatalf("encode %+v = %q, want %q", c.p, got, c.want)
		}
		back, err := DecodeGroupKey(c.g, c.want)
		if err != nil || back != c.p {
			t.Fatalf("decode %q = %+v, %v; want %+v", c.want, back, err, c.p)
		}
	}
}

func TestGroupKeyRejectsMismatch(t *testing.T) {
	for _, key := range []string{"", "priority:high", "status:", "assignee:robot:1", "property:OTHER:none", "property:01PROP:v:!!"} {
		if _, err := DecodeGroupKey(Group{Kind: "status"}, key); key != "priority:high" && err == nil {
			t.Fatalf("status group accepted %q", key)
		}
	}
	if _, err := DecodeGroupKey(Group{Kind: "status"}, "priority:high"); !errors.Is(err, ErrInvalidGroupKey) {
		t.Fatal("kind mismatch must be ErrInvalidGroupKey")
	}
}

// TestGroupKeyStatusValueFollowsCatalogRule pins the status/priority value
// regex to the same rule as the status catalog key
// (server/internal/service/task_catalog.go: statusKeyRE): a leading
// underscore is not a valid key, even though it is a valid [a-z0-9_] char.
func TestGroupKeyStatusValueFollowsCatalogRule(t *testing.T) {
	if _, err := DecodeGroupKey(Group{Kind: "status"}, "status:_todo"); !errors.Is(err, ErrInvalidGroupKey) {
		t.Fatalf("status:_todo should be rejected (leading underscore), got err=%v", err)
	}
	got, err := DecodeGroupKey(Group{Kind: "status"}, "status:in_progress")
	if err != nil {
		t.Fatalf("status:in_progress should be accepted, got err=%v", err)
	}
	want := GroupPredicate{Kind: "status", Value: "in_progress"}
	if got != want {
		t.Fatalf("decode status:in_progress = %+v, want %+v", got, want)
	}
}
