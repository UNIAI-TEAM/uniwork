package tablequery

import (
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// ErrInvalidGroupKey is returned (wrapped) by DecodeGroupKey when the key
// does not match the grouping it is decoded against.
var ErrInvalidGroupKey = errors.New("tablequery: invalid group key")

// statusOrPriorityKeyRe matches the value segment of a status or priority
// group key: lowercase snake-case keys, 1..32 chars.
var statusOrPriorityKeyRe = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)

// GroupPredicate is one decoded group_key: which bucket of a Group a row
// belongs to.
type GroupPredicate struct {
	Kind      GroupKind
	None      bool   // the "none"/unassigned bucket
	Value     string // status key | priority | project id | option id | "true"/"false"
	ActorKind string // assignee only: human|agent
}

// EncodeGroupKey renders p as the opaque group_key string for grouping g,
// per ADR 0020 / spec §3.1.
func EncodeGroupKey(g Group, p GroupPredicate) string {
	switch g.Kind {
	case GroupKindStatus:
		return "status:" + p.Value
	case GroupKindPriority:
		return "priority:" + p.Value
	case GroupKindAssignee:
		if p.None {
			return "assignee:none"
		}
		return "assignee:" + p.ActorKind + ":" + p.Value
	case GroupKindProject:
		if p.None {
			return "project:none"
		}
		return "project:" + p.Value
	case GroupKindProperty:
		var pid string
		if g.Property != nil {
			pid = g.Property.ID
		}
		if p.None {
			return "property:" + pid + ":none"
		}
		return "property:" + pid + ":v:" + base64.RawURLEncoding.EncodeToString([]byte(p.Value))
	default:
		return ""
	}
}

// DecodeGroupKey parses an opaque group_key string back into a
// GroupPredicate, validating it against grouping g. Any mismatch (wrong
// kind prefix, malformed value, wrong property id, bad base64) is
// ErrInvalidGroupKey.
func DecodeGroupKey(g Group, key string) (GroupPredicate, error) {
	prefix, rest, _ := strings.Cut(key, ":")
	if GroupKind(prefix) != g.Kind {
		return GroupPredicate{}, fmt.Errorf("%w: kind mismatch: got %q want %q", ErrInvalidGroupKey, prefix, g.Kind)
	}

	switch g.Kind {
	case GroupKindStatus:
		if !statusOrPriorityKeyRe.MatchString(rest) {
			return GroupPredicate{}, fmt.Errorf("%w: invalid status key %q", ErrInvalidGroupKey, rest)
		}
		return GroupPredicate{Kind: GroupKindStatus, Value: rest}, nil

	case GroupKindPriority:
		if !statusOrPriorityKeyRe.MatchString(rest) {
			return GroupPredicate{}, fmt.Errorf("%w: invalid priority key %q", ErrInvalidGroupKey, rest)
		}
		return GroupPredicate{Kind: GroupKindPriority, Value: rest}, nil

	case GroupKindAssignee:
		if rest == "none" {
			return GroupPredicate{Kind: GroupKindAssignee, None: true}, nil
		}
		actorKind, id, ok := strings.Cut(rest, ":")
		if !ok || (actorKind != "human" && actorKind != "agent") || id == "" {
			return GroupPredicate{}, fmt.Errorf("%w: invalid assignee key %q", ErrInvalidGroupKey, key)
		}
		return GroupPredicate{Kind: GroupKindAssignee, ActorKind: actorKind, Value: id}, nil

	case GroupKindProject:
		if rest == "none" {
			return GroupPredicate{Kind: GroupKindProject, None: true}, nil
		}
		if rest == "" {
			return GroupPredicate{}, fmt.Errorf("%w: empty project id", ErrInvalidGroupKey)
		}
		return GroupPredicate{Kind: GroupKindProject, Value: rest}, nil

	case GroupKindProperty:
		if g.Property == nil {
			return GroupPredicate{}, fmt.Errorf("%w: group has no property", ErrInvalidGroupKey)
		}
		pid, tail, ok := strings.Cut(rest, ":")
		if !ok || pid != g.Property.ID {
			return GroupPredicate{}, fmt.Errorf("%w: property id mismatch in %q", ErrInvalidGroupKey, key)
		}
		if tail == "none" {
			return GroupPredicate{Kind: GroupKindProperty, None: true}, nil
		}
		tag, encoded, ok := strings.Cut(tail, ":")
		if !ok || tag != "v" {
			return GroupPredicate{}, fmt.Errorf("%w: malformed property key %q", ErrInvalidGroupKey, key)
		}
		decoded, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			return GroupPredicate{}, fmt.Errorf("%w: bad property value encoding: %v", ErrInvalidGroupKey, err)
		}
		return GroupPredicate{Kind: GroupKindProperty, Value: string(decoded)}, nil

	default:
		return GroupPredicate{}, fmt.Errorf("%w: unsupported group kind %q", ErrInvalidGroupKey, g.Kind)
	}
}
