package document

import (
	"bytes"
	"net/http"
	"path"
	"strings"
)

// DocumentFileMIMETypes is the file-document allowlist (C-01 §5.5): PDFs,
// images, Office and OpenDocument types, text/markdown/CSV, ZIP archives and
// HTML. Executables, scripts and disk images are intentionally absent - a
// file named by a MIME outside this list is refused with
// unsupported_media_type.
var DocumentFileMIMETypes = []string{
	"application/pdf",
	"image/jpeg", "image/png", "image/gif", "image/webp",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.oasis.opendocument.text",
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.oasis.opendocument.presentation",
	"text/plain", "text/markdown", "text/csv", "text/html",
	"application/zip",
	"application/x-zip-compressed",
}

// DocumentAssetMIMETypes is the page-asset allowlist (C-01 §3.7): the image
// types a pasted page may embed.
var DocumentAssetMIMETypes = []string{
	"image/jpeg", "image/png", "image/gif", "image/webp",
}

// extMIMETypes maps filename extensions to the MIMEs they may legitimately
// sniff as. http.DetectContentType reads magic bytes, so an OOXML file sniffs
// as ZIP and an HTML file sniffs as text/html - both spellings are listed.
var extMIMETypes = map[string][]string{
	".pdf": {"application/pdf"},
	".jpg": {"image/jpeg", "image/pjpeg"}, ".jpeg": {"image/jpeg", "image/pjpeg"},
	".png": {"image/png"}, ".gif": {"image/gif"}, ".webp": {"image/webp"},
	".doc":  {"application/msword", "application/x-ole-storage"},
	".docx": {"application/zip", "application/x-zip-compressed"},
	".xls":  {"application/vnd.ms-excel", "application/x-ole-storage"},
	".xlsx": {"application/zip", "application/x-zip-compressed"},
	".ppt":  {"application/vnd.ms-powerpoint", "application/x-ole-storage"},
	".pptx": {"application/zip", "application/x-zip-compressed"},
	".odt":  {"application/vnd.oasis.opendocument.text", "application/zip", "application/x-zip-compressed"},
	".ods":  {"application/vnd.oasis.opendocument.spreadsheet", "application/zip", "application/x-zip-compressed"},
	".odp":  {"application/vnd.oasis.opendocument.presentation", "application/zip", "application/x-zip-compressed"},
	".txt":  {"text/plain; charset=utf-8", "text/plain"},
	".md":   {"text/plain; charset=utf-8", "text/plain", "text/markdown"},
	".csv":  {"text/plain; charset=utf-8", "text/plain", "text/csv", "application/vnd.ms-excel"},
	".html": {"text/html; charset=utf-8", "text/html"}, ".htm": {"text/html; charset=utf-8", "text/html"},
	".zip": {"application/zip", "application/x-zip-compressed"},
}

// AllowedDocumentFileMIME reports whether a detected content type is on the
// file-document allowlist.
func AllowedDocumentFileMIME(detected string) bool {
	return mimeIn(detected, DocumentFileMIMETypes)
}

// AllowedDocumentAssetMIME reports whether a detected content type is on the
// page-asset allowlist.
func AllowedDocumentAssetMIME(detected string) bool {
	return mimeIn(detected, DocumentAssetMIMETypes)
}

// ole2Magic is the Compound File Binary signature every legacy Office file
// (.doc/.xls/.ppt) starts with. http.DetectContentType does not know it and
// returns application/octet-stream, which would refuse every legacy Office
// upload at the extension pair check — so it is sniffed here first.
var ole2Magic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// DetectContentType sniffs the first bytes of an upload. OLE2 containers
// report application/x-ole-storage, which each legacy extension maps onto its
// Office MIME in extMIMETypes.
func DetectContentType(head []byte) string {
	if len(head) >= len(ole2Magic) && bytes.Equal(head[:len(ole2Magic)], ole2Magic) {
		return "application/x-ole-storage"
	}
	return http.DetectContentType(head)
}

// FilenameMatchesMIME implements the C-01 §5.5 pair check: the extension and
// the detected content type must agree or the upload is refused with
// unsupported_media_type. A file with no known extension may still pass on a
// bare detected allowlist hit.
func FilenameMatchesMIME(filename, detected string) bool {
	ext := strings.ToLower(path.Ext(filename))
	if ext == "" {
		return AllowedDocumentFileMIME(detected)
	}
	want, ok := extMIMETypes[ext]
	if !ok {
		return false // unknown extension - refuse
	}
	detected = strings.ToLower(detected)
	for _, m := range want {
		if detected == m {
			return true
		}
	}
	return false
}

func mimeIn(detected string, list []string) bool {
	base, _, _ := strings.Cut(detected, ";")
	base = strings.TrimSpace(strings.ToLower(base))
	for _, m := range list {
		if base == m {
			return true
		}
	}
	return false
}
