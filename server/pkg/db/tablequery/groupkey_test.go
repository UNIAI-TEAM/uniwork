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
