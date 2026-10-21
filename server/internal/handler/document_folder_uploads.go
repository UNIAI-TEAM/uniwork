package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// maxFolderUploadJSONBody caps a PLAN body: up to 500 files, each large one
// with a probe (64 KiB head and up to 1 MiB central directory, base64).
const maxFolderUploadJSONBody = 8 << 20

// createFolderUpload is POST /workspaces/{workspaceID}/documents/folder-uploads
// (UNI-2052 PLAN): 201 with the batch, its folders and a target per file.
func (h *handlers) createFolderUpload(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateFolderUploadSDI
	if !decode(w, r, &in, maxFolderUploadJSONBody) {
		return
	}
	input := service.CreateFolderUploadInput{
		ParentID: in.ParentID, RootName: in.RootName, ShareWithWorkspace: in.ShareWithWorkspace,
		Folders: in.Folders, Files: make([]service.FolderUploadFileInput, 0, len(in.Files)),
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	}
	for _, f := range in.Files {
		file := service.FolderUploadFileInput{FileKey: f.FileKey, Path: f.Path, Filename: f.Filename, SizeBytes: f.SizeBytes}
		if f.Probe != nil {
			file.Probe = &service.UploadSessionProbeInput{
				HeadB64: f.Probe.HeadB64, CentralDirB64: f.Probe.CentralDirB64,
				CDOffset: f.Probe.CDOffset, CDSize: f.Probe.CDSize,
			}
		}
		input.Files = append(input.Files, file)
	}
	batch, err := h.Documents.CreateFolderUpload(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, folderUploadBatchSDO(batch))
}

// folderUploadErrorMessages is the sentence a failed file carries next to its
// code; an unknown code answers a generic one.
var folderUploadErrorMessages = map[string]string{
	"upload_missing":         "chưa thấy tệp trên kho lưu trữ",
	"size_mismatch":          "kích thước tệp khác với kế hoạch",
	"unsupported_media":      "nội dung tệp không khớp định dạng được hỗ trợ",
	"storage_quota_exceeded": "tổ chức đã hết dung lượng lưu trữ",
	"not_found":              "tệp không thuộc lượt tải này",
	"parts_invalid":          "các phần đã tải lên không khớp",
}

func folderUploadBatchSDO(b service.FolderUploadBatch) sdo.FolderUploadBatchSDO {
	out := sdo.FolderUploadBatchSDO{
		ID: b.ID, Mode: b.Mode, Status: b.Status,
		ShareWithWorkspace: b.ShareWithWorkspace, TotalBytes: b.TotalBytes,
		Folders: make([]sdo.FolderUploadFolderSDO, 0, len(b.Folders)),
		Files:   make([]sdo.FolderUploadFileSDO, 0, len(b.Files)),
		Counts: sdo.FolderUploadCountsSDO{
			Total: b.Counts.Total, Done: b.Counts.Done, Failed: b.Counts.Failed, Pending: b.Counts.Pending,
		},
		ExpiresAt: b.ExpiresAt.UTC().Format(time.RFC3339),
		CreatedAt: b.CreatedAt.UTC().Format(time.RFC3339),
	}
	if b.ParentID != "" {
		out.ParentID = &b.ParentID
	}
	if b.Mode != "files" {
		out.RootFolderID, out.RootTitle = &b.RootFolderID, &b.RootTitle
	}
	for _, f := range b.Folders {
		out.Folders = append(out.Folders, sdo.FolderUploadFolderSDO{Path: f.Path, ID: f.ID})
	}
	for _, f := range b.Files {
		file := sdo.FolderUploadFileSDO{FileKey: f.FileKey, Path: f.Path, Filename: f.Filename, SizeBytes: f.SizeBytes, Status: f.Status}
		if f.DocumentID != "" {
			id := f.DocumentID
			file.DocumentID = &id
		}
		if f.ErrorCode != "" {
			msg, ok := folderUploadErrorMessages[f.ErrorCode]
			if !ok {
				msg = "không tải lên được tệp"
			}
			file.Error = &sdo.FolderUploadErrorSDO{Code: f.ErrorCode, Message: msg}
		}
		if f.Target != nil {
			file.Target = folderUploadTargetSDO(*f.Target)
		}
		out.Files = append(out.Files, file)
	}
	return out
}

func folderUploadTargetSDO(t service.FolderUploadTarget) *sdo.FolderUploadTargetSDO {
	out := &sdo.FolderUploadTargetSDO{
		Kind: t.Kind, Method: t.Method, URL: t.URL, Headers: t.Headers, Auth: t.Auth,
		SessionID: t.SessionID, PartSize: t.PartSize, ExpiresAt: t.ExpiresAt.UTC().Format(time.RFC3339),
	}
	if out.Headers == nil {
		out.Headers = map[string]string{}
	}
	for _, p := range t.Parts {
		headers := map[string]string{}
		for name, values := range p.Headers {
			if len(values) > 0 {
				headers[name] = values[0]
			}
		}
		out.Parts = append(out.Parts, sdo.UploadSessionPartURLSDO{
			PartNumber: p.PartNumber, Method: p.Method, URL: p.URL, Headers: headers,
			ExpiresAt: p.ExpiresAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}
