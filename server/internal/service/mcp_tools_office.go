package service

import (
	"mime"
	"path"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
)

// mcpOfficeReadBytes is the largest Office file get_document opens, the same
// ceiling Ask UNI applies to the attachments of one question.
const mcpOfficeReadBytes = askMaxAttachmentsBytes

// officeByExt maps a file extension to the MIME string attachtext.Extract takes.
var officeByExt = map[string]string{
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".odt":  "application/vnd.oasis.opendocument.text",
	".csv":  "text/csv",
}

// mcpOfficeMIME names the extractor for an Office file. The extension wins
// because uploads often arrive as application/zip or octet-stream.
func mcpOfficeMIME(mimeType, filename string) (string, bool) {
	if m, ok := officeByExt[strings.ToLower(path.Ext(filename))]; ok {
		return m, true
	}
	base, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		base = strings.ToLower(strings.TrimSpace(strings.SplitN(mimeType, ";", 2)[0]))
	}
	for _, m := range officeByExt {
		if m == base {
			return m, true
		}
	}
	return "", false
}

func mcpOfficeReadable(size int64) bool { return size > 0 && size <= mcpOfficeReadBytes }

// mcpOfficeText fits the extracted parts into one tool result and reports
// whether anything was left out.
func mcpOfficeText(d attachtext.Doc) (string, bool) {
	// EstimateTokens counts a token per 3 characters.
	text, read, total := attachtext.Fit(d, mcpMaxItemRunes/3)
	cut := read < total
	if read == 0 && total > 0 {
		// One part longer than the whole budget: show its start rather than a bare marker.
		return capRunes(firstUnit(d), mcpMaxItemRunes, mcpItemCut), true
	}
	if read == 0 && d.Omitted > 0 {
		// Text exists but none of it was kept: a marker alone says nothing.
		return "", true
	}
	if capped := capRunes(text, mcpMaxItemRunes, mcpItemCut); capped != text {
		return capped, true
	}
	if cut {
		text += "\n" + mcpItemCut
		// The marker itself may push it over the cap.
		text = capRunes(text, mcpMaxItemRunes, mcpItemCut)
	}
	return text, cut
}
