package service

import (
	"regexp"
	"slices"
	"strings"
)

// copilot_answer@12 to @19 and @24 to @35 may end an answer with "<memory_used>M1, M3</memory_used>"
// naming the memory entries it used (R12). The server strips the block, stores
// the entry ids on the answer and sends them as a memory_used event.

const memoryUsedTag = "<memory_used>"

var (
	memoryUsedBlock = regexp.MustCompile(`(?s)<memory_used>(.*?)</memory_used>`)
	memoryRef       = regexp.MustCompile(`^M[1-9]\d*$`)
)

// splitMemoryUsed is the answer without any <memory_used> block, wherever it
// stands (a block cut off before its closing tag is dropped with what follows),
// and the distinct M# the blocks name, in first-seen order. Malformed refs are
// skipped.
func splitMemoryUsed(answer string) (body string, refs []string) {
	for _, m := range memoryUsedBlock.FindAllStringSubmatch(answer, -1) {
		for _, f := range strings.FieldsFunc(m[1], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
			if memoryRef.MatchString(f) && !slices.Contains(refs, f) {
				refs = append(refs, f)
			}
		}
	}
	body = memoryUsedBlock.ReplaceAllString(answer, "")
	if i := strings.Index(body, memoryUsedTag); i >= 0 {
		body = body[:i]
	}
	return strings.TrimSpace(body), refs
}

// usedIDs maps refs to entry ids, dropping any this turn never offered.
func (m *askMemoryTurn) usedIDs(refs []string) []string {
	var ids []string
	for _, r := range refs {
		if id, ok := m.refs[r]; ok {
			ids = append(ids, id)
		}
	}
	return ids
}
