package service

import (
	"bytes"
	"errors"
	"fmt"
	"math"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/attachtext"
)

// What a turn's files may cost the model (UNI-2119). Text is estimated by
// attachtext.EstimateTokens; a PDF page and an image are flat prices.
const (
	askFileTokenShare = 30_000
	askPDFPageTokens  = 2_000
	askImageTokens    = 4_800
)

// askFileBytes is an attachment together with its bytes, loaded for one turn.
type askFileBytes struct {
	AskAttachment
	Body []byte
}

// askFileNote records a file that was read only in part, in the unit the user
// knows it by (page, slide, row, paragraph, line). Read 0 means the opening was
// cut to size without one whole unit fitting.
type askFileNote struct {
	Name, Unit  string
	Read, Total int
}

// askFileText is the text of one Word, Excel, PowerPoint, ODT or text file.
type askFileText struct{ Name, Text string }

// askFilePlan is what one turn gives the model from its files: images and PDFs
// as parts, everything else as text, and a note for each file read in part.
type askFilePlan struct {
	Parts []provider.Part
	Texts []askFileText
	Notes []askFileNote
}

// planAskFiles fits files into budget tokens, in attach order. Each file may
// use its fair share of what is left (left / files remaining), so a small file
// leaves its unused share to the ones after it. A file the model cannot open
// is ai.ErrAttachmentUnreadable, naming the file.
func planAskFiles(files []askFileBytes, budget int) (askFilePlan, error) {
	var plan askFilePlan
	for i, f := range files {
		cost, err := plan.add(f, max(budget, 0)/(len(files)-i))
		if err != nil {
			return askFilePlan{}, askFileUnreadable(f.Name, err)
		}
		budget -= cost
	}
	return plan, nil
}

// add reads f within share tokens and returns what it cost.
func (p *askFilePlan) add(f askFileBytes, share int) (int, error) {
	switch f.Kind {
	case "image":
		// An image cannot be read in part: it goes whole and is charged in full,
		// even when less than askImageTokens is left.
		p.Parts = append(p.Parts, provider.Part{MIME: f.MIME, Data: f.Body})
		return askImageTokens, nil
	case "pdf":
		return p.addPDF(f, share)
	}
	return p.addText(f, share)
}

func (p *askFilePlan) addPDF(f askFileBytes, share int) (int, error) {
	pages, err := attachtext.PDFPages(bytes.NewReader(f.Body))
	if err != nil {
		return 0, err
	}
	keep, body := max(1, share/askPDFPageTokens), f.Body
	if keep < pages {
		if body, err = attachtext.TrimPDF(bytes.NewReader(body), keep); err != nil {
			return 0, err
		}
		p.Notes = append(p.Notes, askFileNote{Name: f.Name, Unit: "page", Read: keep, Total: pages})
	} else {
		keep = pages
	}
	p.Parts = append(p.Parts, provider.Part{MIME: f.MIME, Data: body})
	return keep * askPDFPageTokens, nil
}

func (p *askFilePlan) addText(f askFileBytes, share int) (int, error) {
	doc, err := attachtext.Extract(f.MIME, bytes.NewReader(f.Body), int64(len(f.Body)))
	if err != nil {
		return 0, err
	}
	text, read, total := attachtext.Fit(doc, share)
	if read == 0 && total > 0 {
		// The first unit alone is over the share: send its opening rather than nothing.
		text = cutRunes(firstUnit(doc), share*3) // 3 runes to a token, as EstimateTokens
	}
	if read < total {
		p.Notes = append(p.Notes, askFileNote{Name: f.Name, Unit: doc.Unit, Read: read, Total: total})
	}
	p.Texts = append(p.Texts, askFileText{Name: f.Name, Text: text})
	return attachtext.EstimateTokens(text), nil
}

// firstUnit is the first part of d with the headings above it, whatever its size.
func firstUnit(d attachtext.Doc) string {
	for i, part := range d.Parts {
		if part.Text != "" {
			text, _, _ := attachtext.Fit(attachtext.Doc{Parts: d.Parts[:i+1]}, math.MaxInt)
			return text
		}
	}
	return ""
}

// cutRunes is the first n runes of s.
func cutRunes(s string, n int) string {
	for i := range s {
		if n == 0 {
			return s[:i]
		}
		n--
	}
	return s
}

// askFileUnreadable turns a file the reader could not open into the refusal the
// asker sees, naming the file. Any other error is a caller bug and passes through.
func askFileUnreadable(name string, err error) error {
	if !errors.Is(err, attachtext.ErrUnreadable) {
		return err
	}
	e := ai.ErrAttachmentUnreadable
	return &ai.Error{Code: e.Code, Status: e.Status, Msg: fmt.Sprintf("%s: %q", e.Msg, name), Err: err}
}
