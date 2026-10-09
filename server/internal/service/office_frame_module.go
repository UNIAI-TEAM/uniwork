package service

import (
	"errors"
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

// OfficeFrameSheetsMaxBytes is the largest stored xlsx the Sheets frame opens
// (GO-D3 = C, CONTRACT C11: the engine runs in WASM in the browser, cap 10 MiB).
// Measured with the SH2 incremental index (fork docs/web-modules/sheets-sidecar.md):
// 2.2M dense cells = ~10.3 MB file, ~2.3 s to first paint, ~0.8 GB renderer peak.
// A larger workbook opens in the G3 xlsx host. The web host checks the same
// number (packages/core/office/office-modules.ts) before it asks.
const OfficeFrameSheetsMaxBytes = 10 * 1024 * 1024

// ErrOfficeFrameTooLarge is a mint for a document over its module's size cap;
// the handler answers 413 too_large and the host opens the G3 editor.
var ErrOfficeFrameTooLarge = errors.New("office_frame_too_large")

// officeFrameModules maps each module to the stored format it opens, the
// organization-scoped flag that turns it on and the largest stored file it
// opens (0 = no cap of its own). A format not listed here (xls, odt, anything
// else) has no web frame.
var officeFrameModules = []struct {
	module   string
	format   office.Format
	flag     string
	maxBytes int64
}{
	{OfficeFrameModuleDocs, office.FormatDOCX, "office_docs_web", 0},
	{OfficeFrameModulePDF, office.FormatPDF, "office_pdf_web", 0},
	{OfficeFrameModuleMarkdown, office.FormatMD, "office_markdown_web", 0},
	{OfficeFrameModuleHTML, office.FormatHTML, "office_html_web", 0},
	{OfficeFrameModuleSlides, office.FormatPPTX, "office_slides_web", 0},
	{OfficeFrameModuleSheets, office.FormatXLSX, "office_sheets_web", OfficeFrameSheetsMaxBytes},
}

// officeFrameModuleMaxBytes is the module's size cap, 0 for none.
func officeFrameModuleMaxBytes(module string) int64 {
	for _, m := range officeFrameModules {
		if m.module == module {
			return m.maxBytes
		}
	}
	return 0
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
