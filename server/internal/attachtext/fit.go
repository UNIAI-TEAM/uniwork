package attachtext

import "strings"

// Fit renders the parts of d that fit in maxTokens, whole parts only, and
// reports how many parts it kept (read) out of all of them (total). Parts
// without Text are not counted: a heading is written only when a part under it
// fits, so a heading cut off from its rows is dropped. A Part with neither
// Label nor Text is ignored. total also counts d.Omitted, parts that were never
// kept, so it is how many there are in the file.
//
// A heading starts a section (a sheet of a workbook). Each section gets an
// equal share of what is left and keeps its first parts within it; a section
// that needs less leaves the rest to the ones after it. Without headings the
// whole budget goes to the first parts of the file.
//
// Format, one line break between parts: a heading is "## Label", a labelled
// part is "Label" then its text on the next line, any other part is its text.
func Fit(d Doc, maxTokens int) (text string, read, total int) {
	var sections [][]Part
	for i, p := range d.Parts {
		if i == 0 || (p.Text == "" && p.Label != "") {
			sections = append(sections, nil)
		}
		sections[len(sections)-1] = append(sections[len(sections)-1], p)
	}
	var out strings.Builder
	left := max(maxTokens, 0)
	for i, sec := range sections {
		used, kept, n := fitSection(&out, sec, left/(len(sections)-i))
		left -= used
		read, total = read+kept, total+n
	}
	return out.String(), read, total + d.Omitted
}

// fitSection writes the first parts of sec that fit in share tokens to out and
// returns the tokens used, the parts written and the parts in sec.
func fitSection(out *strings.Builder, sec []Part, share int) (used, read, total int) {
	var pending []string // headings waiting for the part under them
	full := false
	for _, p := range sec {
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
		if used+cost > share {
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
	return used, read, total
}

func render(p Part) string {
	if p.Label == "" {
		return p.Text
	}
	return p.Label + "\n" + p.Text
}
