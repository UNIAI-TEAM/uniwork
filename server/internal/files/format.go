package files

import (
	"sort"
	"strings"
)

// The documents library's file-format lanes (UNI-1868, LISTFILTER-01). The
// library filters a list by one of these six formats, and each list row
// reports the format its current version carries; both read this one table,
// so the filter and the value it answers with can never disagree.
//
// A file's format is the MIME an upload verified (document_versions.mime_type)
// mapped here; the title's trailing extension answers only when the MIME names
// none of the six. That fallback is deliberate: a document saved from a mail
// client can carry a generic type (internal/service/document_source_save.go
// names the same case), and the library has always shown those by extension.
//
// The extension is the segment after the title's last dot, so a title that
// only opens with a dot (".docx") names nothing - the same reading the web
// client uses (packages/views/documents/document-type-icon.ts fileExtension).
const (
	DocumentFormatDocx = "docx"
	DocumentFormatXlsx = "xlsx"
	DocumentFormatPptx = "pptx"
	DocumentFormatPDF  = "pdf"
	DocumentFormatMD   = "md"
	DocumentFormatHTML = "html"
)

// documentFormatMime maps one library format to the single MIME a verified
// upload of it carries. An Office lane that stores ".doc"/".xls"/".ppt" is not
// in it: the library's chips have never named those formats.
var documentFormatMime = map[string]string{
	DocumentFormatDocx: mimeDOCX,
	DocumentFormatXlsx: mimeXLSX,
	DocumentFormatPptx: mimePPTX,
	DocumentFormatPDF:  "application/pdf",
	DocumentFormatMD:   "text/markdown",
	DocumentFormatHTML: "text/html",
}

// DocumentFormats lists the six formats a list filter may name, sorted.
func DocumentFormats() []string {
	out := make([]string, 0, len(documentFormatMime))
	for format := range documentFormatMime {
		out = append(out, format)
	}
	sort.Strings(out)
	return out
}

// DocumentFormatMime answers the MIME a verified upload of format carries, and
// false for any other value - the strict parse of a list's ?format=.
func DocumentFormatMime(format string) (string, bool) {
	mime, ok := documentFormatMime[format]
	return mime, ok
}

// DocumentFormatMimes is every MIME documentFormatMime names. The list SQL
// asks with it whether a stored MIME is one the table can name, and falls back
// to the title's extension when it is not.
func DocumentFormatMimes() []string {
	out := make([]string, 0, len(documentFormatMime))
	for _, mime := range documentFormatMime {
		out = append(out, mime)
	}
	sort.Strings(out)
	return out
}

// DocumentFormat answers the library format of one file: the MIME its current
// version was verified as, else the format its title ends in, else "" (a file
// the library shows as a generic file). mimeType is document_versions.mime_type
// as stored - the comparison is exact, the way the list SQL compares it.
func DocumentFormat(mimeType, title string) string {
	if mimeType != "" {
		for format, mime := range documentFormatMime {
			if mime == mimeType {
				return format
			}
		}
	}
	ext := documentTitleExtension(title)
	if _, ok := documentFormatMime[ext]; ok {
		return ext
	}
	return ""
}

// documentTitleExtension is the lowercase segment after the title's last dot,
// or "" when the title has no dot or the dot opens it.
func documentTitleExtension(title string) string {
	i := strings.LastIndexByte(title, '.')
	if i <= 0 {
		return ""
	}
	return strings.ToLower(title[i+1:])
}
