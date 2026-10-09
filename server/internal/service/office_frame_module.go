package service

import (
	"strings"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
)

// The genoffice web modules (UNI-1013 docs, UNI-1014 pdf/markdown/html,
// UNI-1015 slides, UNI-1016 sheets). A token names one; the frame routes are
// the same for all of them.
const (
	OfficeFrameModuleDocs     = "docs"
	OfficeFrameModulePDF      = "pdf"
	OfficeFrameModuleMarkdown = "markdown"
	OfficeFrameModuleHTML     = "html"
	OfficeFrameModuleSlides   = "slides"
	OfficeFrameModuleSheets   = "sheets"
)

// officeFrameModules maps each module to the stored format it opens and the
// organization-scoped flag that turns it on. A format not listed here (xls,
// odt, anything else) has no web frame.
var officeFrameModules = []struct {
	module string
	format office.Format
	flag   string
}{
	{OfficeFrameModuleDocs, office.FormatDOCX, "office_docs_web"},
	{OfficeFrameModulePDF, office.FormatPDF, "office_pdf_web"},
	{OfficeFrameModuleMarkdown, office.FormatMD, "office_markdown_web"},
	{OfficeFrameModuleHTML, office.FormatHTML, "office_html_web"},
	{OfficeFrameModuleSlides, office.FormatPPTX, "office_slides_web"},
	{OfficeFrameModuleSheets, office.FormatXLSX, "office_sheets_web"},
}

// OfficeFrameModuleFlag is the flag key that gates module; false for a name
// that is not a module.
func OfficeFrameModuleFlag(module string) (string, bool) {
	for _, m := range officeFrameModules {
		if m.module == module {
			return m.flag, true
		}
	}
	return "", false
}

// officeFrameModuleOf derives the module from a stored file's mime type and
// name. A DOCX keeps the Docs frame's original rule (its mime type or a .docx
// name); every other format is judged as the Office editor judges it - the
// extension first, then the verified content type.
func officeFrameModuleOf(mime, filename string) (string, bool) {
	base, _, _ := strings.Cut(strings.ToLower(mime), ";")
	if officeFormatMime(office.FormatDOCX, base) || strings.HasSuffix(strings.ToLower(filename), ".docx") {
		return OfficeFrameModuleDocs, true
	}
	format, ok := officeFormatForFile(files.File{Filename: filename, ContentType: mime})
	if !ok {
		return "", false
	}
	for _, m := range officeFrameModules {
		if m.format == format {
			return m.module, true
		}
	}
	return "", false
}
