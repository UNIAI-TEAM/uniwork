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

// tokenPattern matches the complete mention markup - label and ULID target -
// the editor writes: `[@Label](mention://member/<id>)`. The label may carry
// Markdown backslash escapes; the id is exactly a ULID. A bare URL, or a
// token typed inside `code`, is not a mention (contract-collab section 3).
var tokenPattern = regexp.MustCompile(`\[@((?:[^\[\]\\]|\\.)*)\]\(mention://member/([0-9A-Za-z]{26})\)`)

// TokenIDs returns the distinct user ids a body mentions through complete
// tokens, sorted and normalized to upper case. Document comments use this
// parser so only the markup a person sees as a chip becomes a durable
// mention; matches inside an inline `code` span are ignored because every
// renderer shows those verbatim. MemberIDs stays the loose chat parser.
func TokenIDs(body string) []string {
	if body == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, segment := range outsideInlineCode(body) {
		for _, match := range tokenPattern.FindAllStringSubmatch(segment, -1) {
			if len(match) < 3 {
				continue
			}
			id := strings.ToUpper(strings.TrimSpace(match[2]))
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}

// outsideInlineCode splits a body into the runs outside `code` spans,
// following CommonMark: a run of N backticks opens a code span and only a run
// of exactly N backticks closes it, so a shorter or longer run inside is
// literal text. Pairing runs by any length instead would let a single
// backtick inside a double-backtick span close it early and turn a token the
// renderer shows verbatim into a durable mention.
func outsideInlineCode(body string) []string {
	var out []string
	last, i := 0, 0
	for i < len(body) {
		if body[i] != '`' {
			i++
			continue
		}
		j := i
		for j < len(body) && body[j] == '`' {
			j++
		}
		open := j - i
		closed, k := -1, j
		for k < len(body) {
			if body[k] != '`' {
				k++
				continue
			}
			m := k
			for m < len(body) && body[m] == '`' {
				m++
			}
			if m-k == open {
				closed = m
				break
			}
			k = m
		}
		if closed < 0 {
			// No equal-length closer: the run is literal text, keep scanning.
			i = j
			continue
		}
		out = append(out, body[last:i])
		last, i = closed, closed
	}
	if last < len(body) {
		out = append(out, body[last:])
	}
	return out
}

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
