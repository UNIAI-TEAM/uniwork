package sdo

import "github.com/unicomhub/uniwork/server/internal/workcapability"

// ErrorSDO is the envelope for every 4xx/5xx JSON body.
type ErrorSDO struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code" description:"Mã lỗi máy đọc được" example:"invalid_request"`
	Message string `json:"message" description:"Thông báo lỗi dành cho người dùng" example:"invalid json"`
	// Fields carries machine-readable detail for a few codes (quota_exceeded:
	// meter, limit, current, delta; capability_unavailable: reason_code matching
	// workcapability catalogue keys such as agent_runtime_missing).
	Fields map[string]any `json:"fields,omitempty" description:"Chi tiết máy đọc được (vd. reason_code cho capability_unavailable)"`
	// ErrorClass is the coarse class a client switches on for its recovery
	// path (conflict | gone | quota | permission | missing | incompatible |
	// session). Omitted for codes outside the table in error_class.go.
	ErrorClass string `json:"error_class,omitempty" description:"Lớp lỗi thô để client chọn hướng xử lý (conflict | gone | quota | permission | missing | incompatible | session)" example:"conflict"`
}

// ReadinessCheckSDO is one dependency probe of /readyz.
type ReadinessCheckSDO struct {
	Name   string `json:"name" description:"db | migrations | redis" example:"db"`
	OK     bool   `json:"ok" description:"Check đạt" example:"true"`
	Detail string `json:"detail,omitempty" description:"Lỗi hoặc phiên bản migration" example:"099_ai_tokens_quota"`
}

// ReadinessSDO is the body of /readyz; 503 carries the same shape.
type ReadinessSDO struct {
	Ready  bool                `json:"ready" description:"Mọi check đạt" example:"true"`
	Checks []ReadinessCheckSDO `json:"checks" description:"Từng check"`
}

// StatusSDO is the body of routes that only acknowledge success.
type StatusSDO struct {
	Status string `json:"status" description:"Kết quả của yêu cầu" example:"ok"`
}

// ConfigSDO is GET /api/v1/config: what the web client needs before it has
// a session — public feature flags, the RUM sampling rate, and the Work
// Management capability catalogue.
type ConfigSDO struct {
	Flags                      map[string]bool                 `json:"flags" description:"Flag public theo ngữ cảnh người gọi" example:"{\"rum_sampling\":true}"`
	RumSampleRate              float64                         `json:"rum_sample_rate" description:"Tỷ lệ phiên gửi web-vitals, 0..1" example:"0.2"`
	WorkManagementCapabilities map[string]workcapability.Entry `json:"work_management_capabilities" description:"Catalog capability Work Management (status + reason_code)"`
	OfficeInstallerURLs        OfficeInstallerURLsSDO          `json:"office_installer_urls" description:"Installer URL per deployment channel; empty means unavailable"`
	OfficeInstallers           OfficeInstallerChannelsSDO      `json:"office_installers" description:"Platform installer catalogue per deployment channel"`
	OfficeDeploymentID         string                          `json:"office_deployment_id" description:"Configured deployment binding for Office launch sessions" example:"default"`
	OfficeAPIOrigin            string                          `json:"office_api_origin" description:"Public API origin the desktop app signs in to; empty when not a bare http(s) origin" example:"https://uniworkos.com"`
	Documents                  DocumentsConfigSDO              `json:"documents" description:"Giới hạn tải lên, lưu và mở tài liệu trên trình duyệt"`
}

type DocumentsConfigSDO struct {
	Limits DocumentLimitsSDO `json:"limits" description:"Giới hạn dung lượng tệp tài liệu và ngưỡng cảnh báo mở trên web"`
}

type DocumentLimitsSDO struct {
	UploadMaxBytes int64                    `json:"upload_max_bytes" description:"Dung lượng tối đa cho phép khi tải lên hoặc lưu tệp tài liệu (byte)" example:"209715200"`
	SaveWarnRatio  float64                  `json:"save_warn_ratio" description:"Tỷ lệ cảnh báo sớm so với upload_max_bytes khi lưu trong trình soạn thảo (0..1)" example:"0.9"`
	WebOpen        DocumentWebOpenLimitsSDO `json:"web_open" description:"Ngưỡng cảnh báo mềm theo định dạng khi mở trực tiếp trên trình duyệt"`
}

type DocumentWebOpenLimitsSDO struct {
	DOCX DocumentFormatOpenLimitSDO `json:"docx" description:"Ngưỡng cảnh báo mở tệp DOCX trên trình duyệt"`
	PPTX DocumentFormatOpenLimitSDO `json:"pptx" description:"Ngưỡng cảnh báo mở tệp PPTX trên trình duyệt"`
	PDF  DocumentFormatOpenLimitSDO `json:"pdf" description:"Ngưỡng cảnh báo mở tệp PDF trên trình duyệt"`
	XLSX DocumentFormatOpenLimitSDO `json:"xlsx" description:"Ngưỡng cảnh báo mở tệp XLSX trên trình duyệt"`
}

type DocumentFormatOpenLimitSDO struct {
	WarnBytes int64 `json:"warn_bytes" description:"Dung lượng bắt đầu hiển thị cảnh báo mềm trước khi mở trên web (byte)" example:"31457280"`
}

type OfficeInstallerURLsSDO struct {
	Dev    string `json:"dev" description:"Test/dev channel installer URL"`
	Beta   string `json:"beta" description:"Beta channel installer URL"`
	Stable string `json:"stable" description:"Stable channel installer URL"`
}
