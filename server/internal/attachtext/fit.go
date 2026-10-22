package attachtext

import "strings"

// Fit renders the first parts of d that fit in maxTokens, whole parts only, and
// reports how many parts it kept (read) out of all of them (total). Parts
// without Text are not counted: a heading is written only when a part under it
// fits, so a heading cut off from its rows is dropped. A Part with neither
// Label nor Text is ignored.
//
// Format, one line break between parts: a heading is "## Label", a labelled
// part is "Label" then its text on the next line, any other part is its text.
func Fit(d Doc, maxTokens int) (text string, read, total int) {
	var out strings.Builder
	var pending []string // headings waiting for the part under them
	used, full := 0, false
	for _, p := range d.Parts {
		if p.Text == "" {
			if p.Label != "" && !full {
				pending = append(pending, "## "+p.Label)
			}
			continue
		}
		total++
		if full {
			continue
		}
		chunk := strings.Join(append(pending, render(p)), "\n")
		cost := EstimateTokens(chunk)
		if used+cost > maxTokens {
			full = true
			continue
		}
		if out.Len() > 0 {
			out.WriteByte('\n')
		}
		out.WriteString(chunk)
		used += cost
		read++
		pending = pending[:0]
	}
	return out.String(), read, total
}

func render(p Part) string {
	if p.Label == "" {
		return p.Text
	}
	return p.Label + "\n" + p.Text
}
