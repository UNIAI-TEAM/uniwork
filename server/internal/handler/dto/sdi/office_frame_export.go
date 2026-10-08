package sdi

// ExportOfficeFramePDFSDI documents POST
// /api/v1/office-frame/documents/{documentID}/export/pdf (UNI-1013). The body
// is optional: none exports the current version; a multipart "file" part is
// the frame's unsaved edit of that version, rendered as it is; a "version"
// field renders that stored version. file and version are exclusive.
type ExportOfficeFramePDFSDI struct {
	File    []byte `formData:"file" description:"Tùy chọn: byte DOCX hiện tại của frame khi có thay đổi chưa lưu (≤ 50 MiB); bỏ trống = phiên bản hiện tại"`
	Version string `formData:"version" description:"Tùy chọn: số phiên bản đã lưu cần xuất (số nguyên dương); không gửi cùng file" example:"3"`
}
