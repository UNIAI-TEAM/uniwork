package sdo

import "github.com/unicomhub/uniwork/server/internal/config"

// OfficeDesktopDownloadSDO is the non-secret deployment profile returned by
// GET /api/v1/office/desktop/download.
type OfficeDesktopDownloadSDO struct {
	InstallerURL       string                   `json:"installer_url" description:"URL bộ cài đã cấu hình" example:"https://downloads.example/uniwork-office-beta.exe"`
	Installers         []config.OfficeInstaller `json:"installers" description:"Các artifact đã cấu hình cho đúng kênh"`
	SupportedPlatforms []string                 `json:"supported_platforms" description:"Khóa nền tảng app hỗ trợ, gồm bản chưa có URL ở kênh này"`
	ServerOrigin       string                   `json:"server_origin" description:"Địa chỉ gốc API cho ứng dụng desktop" example:"https://app.example.com"`
	Channel            string                   `json:"channel" description:"Kênh triển khai" example:"stable"`
	ClientID           string                   `json:"client_id" description:"Mã OAuth client công khai của desktop" example:"uniwork-office"`
	DeploymentID       string                   `json:"deployment_id" description:"Mã triển khai công khai" example:"default"`
}

type OfficeInstallerChannelsSDO struct {
	Dev    []config.OfficeInstaller `json:"dev" description:"Bản cài ở kênh test/dev"`
	Beta   []config.OfficeInstaller `json:"beta" description:"Bản cài ở kênh beta"`
	Stable []config.OfficeInstaller `json:"stable" description:"Bản cài ở kênh stable"`
}

// SDO types for the Office surface (plan G2-07 / UNI-690). Revision stays a
// decimal string on the wire (plan §3.3). The job payload never carries an
// engine address, a storage key or a grant: only ids, the pinned engine
// identity and the job's state.

// OfficeCapabilityOperationDTO is one capability row. `supported` is the
// product rule (bound and proven); `engine_bound` says only that this engine
// build binds the operation, so a client can show "the action exists but is
// not proven here" without inventing a rule of its own.
type OfficeCapabilityOperationDTO struct {
	Operation     string `json:"operation" description:"open, edit, serialize, convert, export hoặc create_blank" example:"serialize"`
	Runtime       string `json:"runtime" description:"browser, worker, native_desktop, internal_service hoặc none" example:"internal_service"`
	EvidenceLevel string `json:"evidence_level" description:"proven, source_read hoặc pending" example:"pending"`
	EngineBound   bool   `json:"engine_bound" description:"Build engine đang chạy có bind thao tác này không" example:"true"`
	Supported     bool   `json:"supported" description:"Quy tắc sản phẩm: bind + đã chứng minh; false thì UI ẩn hành động" example:"false"`
	Reason        string `json:"reason,omitempty" description:"Vì sao bind/pending; không phải câu chữ UI" example:"bound in the engine service; product evidence belongs to the format lane"`
	TargetFormat  string `json:"target_format,omitempty" description:"Chỉ hàng convert: định dạng OOXML đích (xlsx cho xls, docx cho odt)" example:"xlsx"`
}

// OfficeCapabilitySDO is GET /documents/{documentID}/office/capabilities.
type OfficeCapabilitySDO struct {
	DocumentID    string                         `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Format        string                         `json:"format" description:"docx, xlsx, pptx, pdf, md, html; xls/odt chỉ có convert" example:"md"`
	EngineVersion string                         `json:"engine_version" description:"Build engine đã thoả thuận với server" example:"genoffice@09485f88+uniwork-office.0"`
	Operations    []OfficeCapabilityOperationDTO `json:"operations"`
}

// OfficeJobErrorDTO is a settled job's typed failure (engine-contract §4.7):
// code and reason only, plus the contract's kind and retry flag.
type OfficeJobErrorDTO struct {
	Code      string `json:"code" description:"Mã lỗi engine (ENGINE_ERROR_CODES)" example:"engine_timeout"`
	Reason    string `json:"reason,omitempty" example:"deadline_exceeded"`
	Kind      string `json:"kind,omitempty" example:"deadline_exceeded"`
	Retryable bool   `json:"retryable" example:"true"`
}

// OfficeJobSDO is POST /documents/{id}/office/jobs, GET .../office/jobs/{jobID}
// and POST .../office/jobs/{jobID}/cancel. A completed job is not a version:
// the output must still go through POST /documents/{id}/versions/commit.
type OfficeJobSDO struct {
	JobID              string              `json:"job_id" example:"01J8X4JOB0N1P2Q3R4S5T6U7V8"`
	DocumentID         string              `json:"document_id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Operation          string              `json:"operation" example:"serialize"`
	Format             string              `json:"format" example:"md"`
	State              string              `json:"state" description:"accepted, running, completed, failed, timed_out, cancelled hoặc crashed" example:"completed"`
	BaseRevision       string              `json:"base_revision" example:"41"`
	BaseVersionID      string              `json:"base_version_id" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	OutputFileID       *string             `json:"output_file_id,omitempty" description:"file_id staged cho versions/commit; không phải URL" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	OutputChecksum     *string             `json:"output_checksum_sha256,omitempty" example:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"`
	OutputLength       *int64              `json:"output_length,omitempty" example:"3415"`
	Error              *OfficeJobErrorDTO  `json:"error,omitempty"`
	TargetFormat       *string             `json:"target_format,omitempty" description:"Chỉ job convert: định dạng OOXML đích" example:"xlsx"`
	Result             *OfficeJobResultDTO `json:"result,omitempty" description:"Chỉ job convert đã completed: độ trung thực + danh sách thay đổi hiển thị trước khi chấp nhận"`
	EngineName         string              `json:"engine_name" example:"genoffice"`
	EngineVersion      string              `json:"engine_version" example:"genoffice@09485f88+uniwork-office.0"`
	ContractVersion    string              `json:"contract_version" example:"uniwork-office-engine-contract/1"`
	ProtocolVersion    string              `json:"protocol_version" example:"1"`
	CommittedVersionID *string             `json:"committed_version_id,omitempty" description:"Phiên bản đã claim output này; có nghĩa job đã commit" example:"01J8X4VER0N1P2Q3R4S5T6U7V8"`
	DeadlineAt         string              `json:"deadline_at" example:"2026-09-28T09:00:00Z"`
	CreatedAt          string              `json:"created_at" example:"2026-09-28T08:59:00Z"`
	UpdatedAt          string              `json:"updated_at" example:"2026-09-28T08:59:07Z"`
}

// OfficeJobResultDTO is a completed convert job's result (Q7): the fidelity
// level, every category the copy does not carry, and what it does carry. The
// client shows it before POST /documents/{id}/copies with job_id accepts it.
type OfficeJobResultDTO struct {
	SourceFormat string                 `json:"source_format" example:"xls"`
	TargetFormat string                 `json:"target_format" example:"xlsx"`
	Fidelity     OfficeJobFidelityDTO   `json:"fidelity"`
	Content      OfficeJobChangeListDTO `json:"content"`
}

// OfficeJobFidelityDTO names what a conversion loses.
type OfficeJobFidelityDTO struct {
	Level string   `json:"level" description:"limited: bản sao mất một số hạng mục, liệt kê trong lost" example:"limited"`
	Lost  []string `json:"lost" description:"Các hạng mục bản sao không mang theo" example:"[\"cell_formatting\"]"`
}

// OfficeJobChangeListDTO is what the converted copy contains.
type OfficeJobChangeListDTO struct {
	Sheets     []string          `json:"sheets,omitempty" description:"xls -> xlsx: tên các sheet" example:"[\"Sheet1\"]"`
	Cells      map[string]string `json:"cells,omitempty" description:"xls -> xlsx: ô có giá trị, \"Sheet!A1\" -> văn bản hiển thị"`
	Paragraphs []string          `json:"paragraphs,omitempty" description:"odt -> docx: văn bản các đoạn" example:"[\"Tiêu đề\"]"`
}
