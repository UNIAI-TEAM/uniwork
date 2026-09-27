package document

import (
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
	".doc":  {"application/msword"},
	".docx": {"application/zip", "application/x-zip-compressed"},
	".xls":  {"application/vnd.ms-excel", "application/x-cdf", "application/x-ole-storage"},
	".xlsx": {"application/zip", "application/x-zip-compressed"},
	".ppt":  {"application/vnd.ms-powerpoint", "application/x-cdf", "application/x-ole-storage"},
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

// DetectContentType sniffs the first bytes of an upload.
func DetectContentType(head []byte) string {
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
