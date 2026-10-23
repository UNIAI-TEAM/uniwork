package service

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// Whether a source file can become a document (UNI-1305 item C, review M2).
//
// A document file is whatever the document_file purpose accepts: its MIME
// allowlist and its size cap. A recording (mp4/webm), a zip, a CSV or a file
// over the cap would be refused by the upload after the source stream was
// already opened, so the list says so per row (can_save) and Save answers 422
// before it reads a byte. The allowlist is the registry's, read here, never
// widened: a document is not a place for recordings.

const errCodeSourceNotSaveable = "source_not_saveable"

// documentFilePolicyFor reads the DocumentFile policy of f's registry when f
// exposes one, or of files.DefaultRegistry() otherwise: the live policy the
// same FileService enforces at upload, never a process-cached default
// (UNI-1859, R1-2).
func documentFilePolicyFor(f files.Service) files.Policy {
	if r, ok := f.(interface{ Registry() files.Registry }); ok && r != nil {
		if spec, err := r.Registry().Lookup(files.DocumentFile); err == nil && spec.Policy.MaxBytes > 0 {
			return spec.Policy
		}
	}
	spec, err := files.DefaultRegistry().Lookup(files.DocumentFile)
	if err != nil {
		return files.Policy{MaxBytes: files.DefaultDocumentMaxBytes}
	}
	return spec.Policy
}

// documentSourceExtTypes names the type of a part a mail client left generic
// (application/octet-stream or none), by its extension - what FileService
// would verify from the bytes at upload.
var documentSourceExtTypes = map[string]string{
	"pdf":  "application/pdf",
	"doc":  "application/msword",
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"xls":  "application/vnd.ms-excel",
	"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"ppt":  "application/vnd.ms-powerpoint",
	"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"odt":  "application/vnd.oasis.opendocument.text",
	"jpg":  "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
	"txt": "text/plain", "html": "text/html", "htm": "text/html", "md": "text/markdown",
}

// documentSourceSaveable is the verdict of the document upload for a listed
// file: a known size within the document_file cap, a type on its allowlist.
// FileService stores a CSV or NDJSON file as text/plain in Chat and Tasks but
// names it text/csv / application/x-ndjson again when a document upload
// re-detects it, so those two extensions never pass.
//
// The upload judges the bytes (files.DetectContentType) and this judges what
// the source module stored, so it is a copy of that rule, not the rule itself:
// TestDocumentSourceSaveableAgreesWithTheUpload fails when a change to
// detect.go, the document_file policy or a source purpose's canonical types
// makes the two disagree. Edit this function together with it.
func documentSourceSaveable(p files.Policy, ext, mimeType string, sizeBytes int64) bool {
	if p.MaxBytes <= 0 || sizeBytes <= 0 || sizeBytes > p.MaxBytes {
		return false
	}
	ct := files.NormalizeContentType(mimeType)
	if ct == "" || ct == "application/octet-stream" {
		ct = documentSourceExtTypes[ext]
	}
	if !p.Allows(ct) {
		return false
	}
	if ct == "text/plain" && (ext == "csv" || ext == "ndjson") {
		return false
	}
	return true
}

func errSourceNotSaveable() error {
	return CodedError{
		Code: errCodeSourceNotSaveable, Status: http.StatusUnprocessableEntity,
		Msg: "tệp này không thể lưu thành tài liệu: định dạng không được hỗ trợ hoặc dung lượng quá lớn",
	}
}
