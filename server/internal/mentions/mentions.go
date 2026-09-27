// Package mentions is the one grammar for the mention markup every editor
// serializes: [@Label](mention://member/<user-id>). Chat messages and
// document comments carry the same link, and the shared comment core
// (internal/service/comments.go, plan G1-07) leaves the parsing here so the
// notification rules - which may not import internal/service - read the same
// markup the services do. Who a recipient is stays the caller's job: room
// members in chat, live document readers for document comments.
package mentions

import (
	"regexp"
	"sort"
	"strings"
)

// memberPattern matches the member link. Ids are ULIDs, so the segment is
// case-insensitive on input and normalized to upper case on the way out.
var memberPattern = regexp.MustCompile(`mention://member/([A-Za-z0-9]+)`)

// MemberIDs returns the distinct user ids a body mentions, sorted. The ids
// are raw markup output - membership and read permission are resolved by the
// caller at the moment they matter, never implied by the mention itself.
func MemberIDs(body string) []string {
	if body == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, match := range memberPattern.FindAllStringSubmatch(body, -1) {
		if len(match) < 2 {
			continue
		}
		id := strings.ToUpper(strings.TrimSpace(match[1]))
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
