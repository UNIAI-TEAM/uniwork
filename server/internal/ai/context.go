package ai

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Context builder budget (spec §3.5, inherited from the old context engine).
const (
	MaxSources       = 20
	MaxContextTokens = 12000
	MaxExcerpt       = 1200
)

// Source is one permitted excerpt. ID is assigned by BuildContext ("S1"…);
// Href is an internal path the client renders with AppLink.
type Source struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Href    string `json:"href"`
	Excerpt string `json:"excerpt"`
}

type Focus struct {
	Kind string
	ID   string
}

// SourceQuery is what a SourceReader receives. UserID is the actor: every
// read goes through a service with it, so nothing an actor may not see can
// come back (spec §2 #4).
type SourceQuery struct {
	UserID         string
	OrganizationID string
	WorkspaceID    string
	Question       string
	Focus          *Focus
}

// SourceReader is implemented on the service tier; the gateway package never
// imports services (it would be an import cycle, and it would also be a
// second read path).
type SourceReader interface {
	Sources(ctx context.Context, in SourceQuery) ([]Source, error)
}

// estimateTokens: ~4 characters per token, which is pessimistic enough for
// Vietnamese and cheap enough to run per request.
func estimateTokens(s string) int { return utf8.RuneCountInString(s)/4 + 1 }

// BuildContext applies the hard budget and numbers the survivors. Sources
// come in relevance order; the cut keeps the head.
func BuildContext(sources []Source) (pack []Source, truncated bool) {
	tokens := 0
	for _, s := range sources {
		if len(pack) >= MaxSources {
			truncated = true
			break
		}
		if utf8.RuneCountInString(s.Excerpt) > MaxExcerpt {
			s.Excerpt = string([]rune(s.Excerpt)[:MaxExcerpt]) + "…"
			truncated = true
		}
		cost := estimateTokens(s.Title) + estimateTokens(s.Excerpt)
		if tokens+cost > MaxContextTokens {
			truncated = true
			break
		}
		tokens += cost
		s.ID = fmt.Sprintf("S%d", len(pack)+1)
		pack = append(pack, s)
	}
	return pack, truncated
}

// RenderSources is the prompt fragment: every excerpt wrapped as untrusted
// data with its number, so a citation can be checked and an instruction
// inside a task description is never obeyed.
func RenderSources(pack []Source) string {
	var b strings.Builder
	for _, s := range pack {
		fmt.Fprintf(&b, "[%s] %s (%s)\n<untrusted source=\"%s\">\n%s\n</untrusted>\n\n", s.ID, s.Title, s.Kind, s.ID, s.Excerpt)
	}
	return b.String()
}
