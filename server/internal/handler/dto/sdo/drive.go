package sdo

// DriveConfigSDO reports whether the Google Drive connector is configured on GET /api/v1/config (spec §5.1, §10).
type DriveConfigSDO struct {
	Available bool `json:"available" description:"true khi biến môi trường Google Drive OAuth + khóa mã hóa đã cấu hình và flag drive_connector bật cho người gọi" example:"true"`
}

// DriveOAuthStartSDO is POST /api/v1/workspaces/{workspaceID}/drive-connections/google/start (spec §5.2).
type DriveOAuthStartSDO struct {
	AuthorizationURL string `json:"authorization_url" description:"URL đăng nhập Google OAuth (scope drive.file), mở trong cửa sổ bật lên" example:"https://accounts.google.com/o/oauth2/v2/auth?client_id=..."`
}

// DriveConnectionDTO is one connected Google Drive account for the caller in the organization (spec §5.3, §6.1).
type DriveConnectionDTO struct {
	ID               string  `json:"id" description:"ULID kết nối Google Drive" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	Provider         string  `json:"provider" description:"Nhà cung cấp lưu trữ đám mây: google" example:"google"`
	GoogleEmail      string  `json:"google_email" format:"email" description:"Địa chỉ email tài khoản Google đã xác minh" example:"uni-work1@gmail.com"`
	Status           string  `json:"status" description:"Trạng thái kết nối: active hoặc needs_reconnect" example:"active"`
	NeedsReconnect   bool    `json:"needs_reconnect" description:"true khi refresh token bị thu hồi hoặc hết hiệu lực (auth_failed_at khác null)" example:"false"`
	AuthFailedAt     *string `json:"auth_failed_at,omitempty" format:"date-time" description:"Thời điểm phát hiện mất kết nối (RFC3339); vắng mặt khi đang hoạt động" example:"2026-10-26T09:30:00Z"`
	AuthFailedReason string  `json:"auth_failed_reason,omitempty" description:"Lý do mất kết nối (ví dụ invalid_grant); rỗng khi đang hoạt động" example:"invalid_grant"`
	LinkedFileCount  int64   `json:"linked_file_count" description:"Số tệp Google Drive đang sống trong workspace mà người gọi mở bằng kết nối này" example:"3"`
	ConnectedAt      string  `json:"connected_at" format:"date-time" description:"Thời điểm kết nối (RFC3339)" example:"2026-10-26T08:00:00Z"`
	UpdatedAt        string  `json:"updated_at" format:"date-time" description:"Thời điểm cập nhật gần nhất (RFC3339)" example:"2026-10-26T08:00:00Z"`
}

// DriveConnectionListSDO is GET /api/v1/workspaces/{workspaceID}/drive-connections (spec §5.3).
type DriveConnectionListSDO struct {
	Connections []DriveConnectionDTO `json:"connections" description:"Danh sách kết nối Google Drive của người gọi trong tổ chức của workspace"`
}

// DrivePickerTokenSDO is POST /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token (spec §7.1).
type DrivePickerTokenSDO struct {
	AccessToken  string `json:"access_token" description:"Access token Google ngắn hạn (scope drive.file) của đúng kết nối được chọn, chỉ dùng cho Google Picker trên trình duyệt" example:"ya29.a0AfH6SM..."`
	ExpiresAt    string `json:"expires_at" format:"date-time" description:"Thời điểm hết hạn của access token (RFC3339)" example:"2026-10-26T10:00:00Z"`
	DeveloperKey string `json:"developer_key" description:"Google Picker API developer key giới hạn theo HTTP referrer" example:"AIzaSyA1B2C3..."`
	AppID        string `json:"app_id" description:"Google Cloud project number dùng cho Picker setAppId" example:"123456789012"`
}

// DriveTasksCreatedSummaryDTO summarizes tasks created from a Drive file via UNI proposals (spec §8.8).
type DriveTasksCreatedSummaryDTO struct {
	Count             int64   `json:"count" description:"Tổng số công việc (mà người xem có quyền thấy) đã được tạo từ tài liệu này" example:"4"`
	LastCreatedAt     *string `json:"last_created_at,omitempty" format:"date-time" description:"Thời điểm lần tạo việc gần nhất (RFC3339); vắng mặt khi count = 0" example:"2026-10-26T09:58:00Z"`
	LastCreatedByID   *string `json:"last_created_by_id,omitempty" description:"ULID người xác nhận lần tạo việc gần nhất; vắng mặt khi count = 0" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	LastCreatedByName *string `json:"last_created_by_name,omitempty" description:"Tên hiển thị của người xác nhận lần tạo việc gần nhất; vắng mặt khi count = 0" example:"Minh Nguyễn"`
}

// DriveLinkedTaskRefDTO is a compact reference to a task visible to the viewer (used in 4.1, 4.2, and §8.8).
type DriveLinkedTaskRefDTO struct {
	TaskID     string `json:"task_id" description:"ULID công việc" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Identifier string `json:"identifier" description:"Mã định danh công việc hiển thị (ví dụ UNI-1042)" example:"UNI-1042"`
	Title      string `json:"title" description:"Tiêu đề công việc" example:"Chuẩn bị kế hoạch ra mắt Q4"`
	Status     string `json:"status" description:"Khóa trạng thái hiện tại của công việc" example:"todo"`
}

// DriveTaskCreationGroupDTO is one proposal conversion batch in task_creations / prior_creations (spec §8.8).
type DriveTaskCreationGroupDTO struct {
	ProposalID    string                  `json:"proposal_id" description:"ULID lô đề xuất đã tạo ra nhóm việc này" example:"01J8X4PROP0N1P2Q3R4S5T6U7V"`
	CreatedAt     string                  `json:"created_at" format:"date-time" description:"Thời điểm tạo lô việc (RFC3339)" example:"2026-10-26T09:58:00Z"`
	CreatedByID   string                  `json:"created_by_id" description:"ULID người duyệt và tạo việc" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	CreatedByName string                  `json:"created_by_name" description:"Tên hiển thị của người duyệt và tạo việc" example:"Minh Nguyễn"`
	Tasks         []DriveLinkedTaskRefDTO `json:"tasks" description:"Danh sách công việc thuộc lần tạo này mà người xem được phép thấy"`
}

// DriveFileDTO is a Google Drive file reference in the workspace (list row on 4.1 and detail on 4.2; spec §6.2, §7.6, §7.7, §8.8).
type DriveFileDTO struct {
	ID                     string                      `json:"id" description:"ULID tham chiếu tệp Drive trong UniWork" example:"01J8X4DRVFILE0N1P2Q3R4S5T6"`
	OrganizationID         string                      `json:"organization_id" description:"ULID tổ chức" example:"01J8X4ORGN1P2Q3R4S5T6U7V8"`
	WorkspaceID            string                      `json:"workspace_id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ExternalFileID         string                      `json:"external_file_id" description:"ID tệp trên Google Drive" example:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"`
	DriveID                *string                     `json:"drive_id,omitempty" description:"ID Bộ nhớ dùng chung (Shared Drive) nếu tệp nằm trong Bộ nhớ dùng chung; null nếu ở Drive cá nhân" example:"0AJ8X4SHAREDDRV001"`
	Name                   string                      `json:"name" description:"Tên tệp chụp từ Google Drive" example:"Kế hoạch ra mắt Q4"`
	MimeType               string                      `json:"mime_type" description:"MIME type của tệp trên Google Drive" example:"application/vnd.google-apps.document"`
	IconKind               string                      `json:"icon_kind" description:"Loại biểu tượng hiển thị: google_doc, google_sheet, google_slide, pdf, docx, xlsx, pptx, text, markdown hoặc generic" example:"google_doc"`
	WebViewLink            string                      `json:"web_view_link" description:"URL gốc mở tệp trên Google Drive (chưa gắn authuser)" example:"https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"`
	OpenURL                string                      `json:"open_url" description:"URL mở tệp trên Google Drive đã gắn authuser theo tài khoản đọc của người xem (hoặc không có authuser khi viewer_access = unknown)" example:"https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com"`
	OwnerDisplay           string                      `json:"owner_display" description:"Tên chủ sở hữu trên Drive, hoặc 'Bộ nhớ dùng chung' khi có drive_id" example:"Lan"`
	DriveModifiedAt        *string                     `json:"drive_modified_at,omitempty" format:"date-time" description:"Thời điểm sửa tệp lần cuối trên Google Drive (RFC3339)" example:"2026-10-26T07:30:00Z"`
	DriveModifiedByDisplay string                      `json:"drive_modified_by_display,omitempty" description:"Tên người sửa lần cuối trên Google Drive" example:"Lan"`
	SharingState           string                      `json:"sharing_state" description:"Trạng thái chia sẻ chụp từ Drive: private, shared hoặc unknown" example:"private"`
	SharedUserCount        *int                        `json:"shared_user_count,omitempty" description:"Số người được chia sẻ trên Drive khi Drive trả về danh sách permissions; null khi không đọc được" example:"4"`
	ConnectionID           string                      `json:"connection_id" description:"ULID kết nối Google Drive đang gắn với tệp (thuộc bound_by_id)" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	BoundAccountEmail      string                      `json:"bound_account_email" format:"email" description:"Địa chỉ email Google của kết nối gắn (connection_id)" example:"uni-work1@gmail.com"`
	BoundConnectionLost    bool                        `json:"bound_connection_lost" description:"true khi kết nối gắn đang mất kết nối (auth_failed_at hoặc disconnected_at)" example:"false"`
	AccessLostAt           *string                     `json:"access_lost_at,omitempty" format:"date-time" description:"Thời điểm phát hiện kết nối gắn mất quyền truy cập tệp trên Drive (RFC3339)" example:"2026-10-26T09:00:00Z"`
	BoundByID              string                      `json:"bound_by_id" description:"ULID người đang giữ kết nối gắn (bằng created_by lúc mới liên kết; đổi sang người rebind sau /rebind)" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	BoundByName            string                      `json:"bound_by_name" description:"Tên hiển thị của người giữ kết nối gắn (bound_by_id)" example:"Minh Nguyễn"`
	CreatedBy              string                      `json:"created_by" description:"ULID người liên kết tệp lần đầu (không đổi sau rebind)" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	CreatedByKind          string                      `json:"created_by_kind" description:"Loại tác nhân liên kết: human" example:"human"`
	CreatedByName          string                      `json:"created_by_name" description:"Tên hiển thị của người liên kết tệp lần đầu" example:"Minh Nguyễn"`
	CreatedAt              string                      `json:"created_at" format:"date-time" description:"Thời điểm liên kết tệp vào workspace (RFC3339)" example:"2026-10-26T08:15:00Z"`
	UpdatedAt              string                      `json:"updated_at" format:"date-time" description:"Thời điểm cập nhật gần nhất (RFC3339)" example:"2026-10-26T08:15:00Z"`
	MetadataRefreshedAt    *string                     `json:"metadata_refreshed_at,omitempty" format:"date-time" description:"Thời điểm làm mới metadata từ Google Drive gần nhất (RFC3339)" example:"2026-10-26T08:15:00Z"`
	ViewerAccess           string                      `json:"viewer_access" description:"Quyền đọc của người đang xem: granted, lost, unknown hoặc connection_lost" example:"granted"`
	ViewerConnectionID     *string                     `json:"viewer_connection_id,omitempty" description:"ULID kết nối Google Drive trong dòng truy cập của chính người xem; null khi viewer_access = unknown" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	ViewerAccountEmail     string                      `json:"viewer_account_email,omitempty" format:"email" description:"Email Google trong dòng truy cập của chính người xem ('Mở bằng tài khoản'); rỗng khi viewer_access = unknown" example:"uni-work1@gmail.com"`
	CanUnlink              bool                        `json:"can_unlink" description:"true khi người xem được phép bỏ liên kết cả tệp khỏi workspace (created_by, bound_by hoặc admin)" example:"true"`
	CanRebind              bool                        `json:"can_rebind" description:"true khi người xem được phép liên kết lại tệp bằng tài khoản khác" example:"true"`
	CanPropose             bool                        `json:"can_propose" description:"true khi người xem được phép bấm Tạo việc từ tài liệu (viewer_access = granted + AI bật + không phải khách)" example:"true"`
	CanAsk                 bool                        `json:"can_ask" description:"true khi người xem được phép bấm Hỏi UNI về tệp này" example:"true"`
	UsedInCount            int64                       `json:"used_in_count" description:"Số công việc đang gắn tệp này mà người xem có quyền thấy" example:"5"`
	UsedInTasks            []DriveLinkedTaskRefDTO     `json:"used_in_tasks" description:"Danh sách công việc đang gắn tệp này mà người xem có quyền thấy"`
	TasksCreated           DriveTasksCreatedSummaryDTO `json:"tasks_created" description:"Tóm tắt số công việc đã tạo từ tài liệu này qua đề xuất của UNI (§8.8)"`
	TaskCreations          []DriveTaskCreationGroupDTO `json:"task_creations,omitempty" description:"Danh sách tối đa 10 lần tạo việc gần nhất từ tài liệu này (chỉ trả trên chi tiết 4.2, §8.8)"`
}

// DriveFileSDO wraps a single DriveFileDTO (GET detail 4.2, POST/PUT access, POST rebind).
type DriveFileSDO struct {
	File DriveFileDTO `json:"file" description:"Thông tin chi tiết tệp Google Drive"`
}

// DriveFileListSDO is GET /api/v1/workspaces/{workspaceID}/drive-files (4.1 list; spec §7.6).
type DriveFileListSDO struct {
	Files      []DriveFileDTO `json:"files" description:"Danh sách tệp Google Drive trong danh sách của người gọi"`
	TotalCount int64          `json:"total_count" description:"Tổng số tệp Google Drive của người gọi trong workspace" example:"5"`
	NextCursor *string        `json:"next_cursor" description:"Con trỏ trang kế tiếp; null khi ở trang cuối" example:"eyJpZCI6IjAxSjifQ"`
}

// DriveFileLinkItemDTO is the per-file result of POST /api/v1/workspaces/{workspaceID}/drive-files (spec §7.2).
type DriveFileLinkItemDTO struct {
	ExternalFileID string        `json:"external_file_id" description:"ID tệp trên Google Drive" example:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"`
	Outcome        string        `json:"outcome" description:"Kết quả liên kết: linked, already_linked hoặc error" example:"linked"`
	File           *DriveFileDTO `json:"file,omitempty" description:"Thông tin tệp đã liên kết khi outcome là linked hoặc already_linked"`
	AccountEmail   string        `json:"account_email,omitempty" format:"email" description:"Email tài khoản Google đang mở tệp của chính người gọi khi outcome = already_linked" example:"uni-work1@gmail.com"`
	ErrorCode      string        `json:"error_code,omitempty" description:"Mã lỗi theo §5.7 khi outcome = error (ví dụ drive_grant_required, drive_file_not_accessible)" example:"drive_grant_required"`
	ErrorMessage   string        `json:"error_message,omitempty" description:"Thông báo lỗi khi outcome = error" example:"Tài khoản chưa cấp quyền đọc tệp này cho UniWork."`
}

// DriveFileLinkResultsSDO is POST /api/v1/workspaces/{workspaceID}/drive-files (spec §7.2).
type DriveFileLinkResultsSDO struct {
	Results []DriveFileLinkItemDTO `json:"results" description:"Kết quả xử lý từng tệp theo thứ tự gửi lên"`
}

// DriveTaskFileCardDTO is one Google Drive card in the task's Attachments section: GET /api/v1/tasks/{taskID}/drive-files (spec §7.3, §8.8).
type DriveTaskFileCardDTO struct {
	ID                     string                      `json:"id" description:"ULID tham chiếu tệp Drive (drive_file_id)" example:"01J8X4DRVFILE0N1P2Q3R4S5T6"`
	TaskID                 string                      `json:"task_id" description:"ULID công việc đang gắn tệp" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	WorkspaceID            string                      `json:"workspace_id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ExternalFileID         string                      `json:"external_file_id" description:"ID tệp trên Google Drive (dùng cho Picker setFileIds khi người xem bấm Cho UniWork đọc tệp)" example:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"`
	DriveID                *string                     `json:"drive_id,omitempty" description:"ID Bộ nhớ dùng chung nếu có" example:"0AJ8X4SHAREDDRV001"`
	Name                   string                      `json:"name" description:"Tên tệp chụp từ Google Drive" example:"Kế hoạch ra mắt Q4"`
	MimeType               string                      `json:"mime_type" description:"MIME type của tệp trên Google Drive" example:"application/vnd.google-apps.document"`
	IconKind               string                      `json:"icon_kind" description:"Loại biểu tượng hiển thị: google_doc, google_sheet, google_slide, pdf, docx, xlsx, pptx, text, markdown hoặc generic" example:"google_doc"`
	SharingState           string                      `json:"sharing_state" description:"Trạng thái chia sẻ chụp từ Drive: private, shared hoặc unknown" example:"private"`
	OwnerDisplay           string                      `json:"owner_display" description:"Tên chủ sở hữu trên Drive hoặc 'Bộ nhớ dùng chung'" example:"Lan"`
	DriveModifiedAt        *string                     `json:"drive_modified_at,omitempty" format:"date-time" description:"Thời điểm sửa tệp lần cuối trên Google Drive (RFC3339)" example:"2026-10-26T07:30:00Z"`
	DriveModifiedByDisplay string                      `json:"drive_modified_by_display,omitempty" description:"Tên người sửa lần cuối trên Google Drive" example:"Lan"`
	ConnectionID           string                      `json:"connection_id" description:"ULID kết nối Google Drive gắn với tệp" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	BoundAccountEmail      string                      `json:"bound_account_email" format:"email" description:"Email Google của tài khoản gắn (theo bound_by)" example:"uni-work1@gmail.com"`
	BoundConnectionLost    bool                        `json:"bound_connection_lost" description:"true khi kết nối gắn đang mất kết nối" example:"false"`
	AccessLostAt           *string                     `json:"access_lost_at,omitempty" format:"date-time" description:"Thời điểm kết nối gắn mất quyền truy cập tệp trên Drive" example:"2026-10-26T09:00:00Z"`
	BoundByID              string                      `json:"bound_by_id" description:"ULID người đang giữ kết nối gắn" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	BoundByName            string                      `json:"bound_by_name" description:"Tên hiển thị của người giữ kết nối gắn" example:"Minh Nguyễn"`
	CreatedBy              string                      `json:"created_by" description:"ULID người liên kết tệp vào UniWork" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	CreatedByName          string                      `json:"created_by_name" description:"Tên hiển thị của người liên kết tệp" example:"Minh Nguyễn"`
	LinkedAt               string                      `json:"linked_at" format:"date-time" description:"Thời điểm gắn tệp vào công việc này (RFC3339)" example:"2026-10-26T08:20:00Z"`
	ViewerAccess           string                      `json:"viewer_access" description:"Trạng thái quyền đọc của người xem: granted, lost, unknown hoặc connection_lost" example:"granted"`
	ViewerConnectionID     *string                     `json:"viewer_connection_id,omitempty" description:"ULID kết nối Google Drive của người xem cho tệp này" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	ViewerAccountEmail     string                      `json:"viewer_account_email,omitempty" format:"email" description:"Email tài khoản Google của người xem dùng để mở/đọc tệp; rỗng khi unknown" example:"uni-work1@gmail.com"`
	OpenURL                string                      `json:"open_url" description:"URL mở tệp trên Google Drive (kèm authuser của người xem khi có)" example:"https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com"`
	CanRemoveFromTask      bool                        `json:"can_remove_from_task" description:"true khi người xem có quyền sửa công việc (được gỡ tệp khỏi việc)" example:"true"`
	CanPropose             bool                        `json:"can_propose" description:"true khi người xem được phép bấm Tạo việc từ tài liệu" example:"true"`
	CanAsk                 bool                        `json:"can_ask" description:"true khi người xem được phép bấm Hỏi UNI" example:"true"`
	TasksCreated           DriveTasksCreatedSummaryDTO `json:"tasks_created" description:"Tóm tắt số công việc đã tạo từ tài liệu này (§8.8)"`
}

// DriveTaskFileListSDO is GET /api/v1/tasks/{taskID}/drive-files (spec §7.3).
type DriveTaskFileListSDO struct {
	Files []DriveTaskFileCardDTO `json:"files" description:"Danh sách thẻ tệp Google Drive gắn với công việc"`
}

// DriveProposalExcerptDTO is the source section and quote UNI extracted for one proposed task (spec §8.2).
type DriveProposalExcerptDTO struct {
	Section string `json:"section" description:"Tên mục hoặc phần trong tài liệu nguồn" example:"Mục 2"`
	Quote   string `json:"quote" description:"Đoạn trích nguyên văn tối đa 300 ký tự từ tài liệu" example:"Nhóm sản phẩm chốt phạm vi beta trước ngày 05/11."`
}

// DriveDuplicateTaskDTO identifies an open task that may duplicate a proposed task title (spec §8.2, §8.4).
type DriveDuplicateTaskDTO struct {
	TaskID     string `json:"task_id" description:"ULID công việc đang mở có tiêu đề trùng" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Identifier string `json:"identifier" description:"Mã định danh công việc (ví dụ UNI-1037)" example:"UNI-1037"`
	Title      string `json:"title" description:"Tiêu đề công việc đang mở" example:"Soạn FAQ sản phẩm"`
}

// DriveTaskProposalItemDTO is one task proposed by UNI in DriveTaskProposalDTO (spec §8.2, §8.4).
type DriveTaskProposalItemDTO struct {
	Index               int                     `json:"index" description:"Thứ tự mục đề xuất (0..19)" example:"0"`
	Title               string                  `json:"title" description:"Tiêu đề công việc do UNI đề xuất" example:"Chốt phạm vi tính năng beta"`
	AssigneeMemberID    *string                 `json:"assignee_member_id,omitempty" description:"ULID thành viên workspace được UNI gợi ý giao; null khi UNI không chắc" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	AssigneeBasis       string                  `json:"assignee_basis,omitempty" description:"Căn cứ UNI chọn người phụ trách (hiển thị sau tiền tố 'UNI · '); rỗng khi để trống" example:"Tài liệu: \"Lan chốt phạm vi\""`
	AssigneeDriveAccess string                  `json:"assignee_drive_access,omitempty" description:"Trạng thái quyền đọc tệp Drive của người được giao: granted hoặc unknown; rỗng khi chưa giao" example:"granted"`
	Priority            string                  `json:"priority,omitempty" description:"Độ ưu tiên gợi ý: low, medium, high hoặc urgent; rỗng khi không chắc" example:"high"`
	PriorityBasis       string                  `json:"priority_basis,omitempty" description:"Căn cứ UNI chọn độ ưu tiên" example:"Chặn các việc sau"`
	StartDate           *string                 `json:"start_date,omitempty" description:"Ngày bắt đầu gợi ý (YYYY-MM-DD); null khi không chắc" example:"2026-10-27"`
	StartBasis          string                  `json:"start_basis,omitempty" description:"Căn cứ UNI chọn ngày bắt đầu" example:"Sau khi chốt phạm vi"`
	DueDate             *string                 `json:"due_date,omitempty" description:"Hạn chót gợi ý (YYYY-MM-DD); null khi không chắc" example:"2026-11-05"`
	DueBasis            string                  `json:"due_basis,omitempty" description:"Căn cứ UNI chọn hạn chót" example:"Mục 3: \"trước 05/11\""`
	LabelIDs            []string                `json:"label_ids" description:"Danh sách ULID nhãn có sẵn trong workspace được gợi ý" example:"[\"01J8X4LBL00N1P2Q3R4S5T6U7V\"]"`
	LabelBasis          string                  `json:"label_basis,omitempty" description:"Căn cứ UNI chọn nhãn" example:"Mục sản phẩm"`
	Goal                string                  `json:"goal" description:"Mục tiêu của công việc" example:"Chốt danh sách tính năng vào bản beta nội bộ ngày 10/11."`
	Checklist           []string                `json:"checklist" description:"Danh sách các bước cần làm (tối đa 10 mục)" example:"[\"Liệt kê tính năng ứng viên\",\"Họp chốt với nhóm sản phẩm\"]"`
	Excerpt             DriveProposalExcerptDTO `json:"excerpt" description:"Đoạn trích và vị trí trong tài liệu làm căn cứ"`
	BlockedByIndexes    []int                   `json:"blocked_by_indexes" description:"Danh sách index các việc khác trong cùng lô chặn việc này" example:"[]"`
	PossibleDuplicate   *DriveDuplicateTaskDTO  `json:"possible_duplicate,omitempty" description:"Công việc đang mở có tiêu đề trùng trong cùng dự án và việc cha; null khi không trùng"`
}

// DriveTaskProposalDTO is the proposal batch returned on POST .../task-proposals and GET .../drive-task-proposals/{proposalID} (spec §8.2, §8.8).
type DriveTaskProposalDTO struct {
	ID                 string                      `json:"id" description:"ULID lô đề xuất" example:"01J8X4PROP0N1P2Q3R4S5T6U7V"`
	WorkspaceID        string                      `json:"workspace_id" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	DriveFileID        string                      `json:"drive_file_id" description:"ULID tệp Google Drive nguồn" example:"01J8X4DRVFILE0N1P2Q3R4S5T6"`
	DriveFileName      string                      `json:"drive_file_name" description:"Tên tệp Google Drive nguồn" example:"Kế hoạch ra mắt Q4"`
	DriveFileMimeType  string                      `json:"drive_file_mime_type" description:"MIME type của tệp nguồn" example:"application/vnd.google-apps.document"`
	DriveFileIconKind  string                      `json:"drive_file_icon_kind" description:"Loại biểu tượng của tệp nguồn" example:"google_doc"`
	SharingState       string                      `json:"sharing_state" description:"Trạng thái chia sẻ của tệp nguồn: private, shared hoặc unknown" example:"private"`
	ConnectionID       string                      `json:"connection_id" description:"ULID kết nối Google Drive của người yêu cầu đã dùng để đọc tệp" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	ReaderAccountEmail string                      `json:"reader_account_email" format:"email" description:"Email tài khoản Google của người yêu cầu đã dùng để đọc tệp" example:"uni-work1@gmail.com"`
	RequestedBy        string                      `json:"requested_by" description:"ULID người yêu cầu (chỉ người này được xem hoặc tạo việc từ lô)" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	Prompt             string                      `json:"prompt,omitempty" description:"Prompt người dùng đã gửi kèm yêu cầu" example:"Tách việc cho nhóm sản phẩm"`
	ProjectID          *string                     `json:"project_id,omitempty" description:"ULID dự án gợi ý cho cả lô" example:"01J8X4PROJ0N1P2Q3R4S5T6U7V"`
	ParentTaskID       *string                     `json:"parent_task_id,omitempty" description:"ULID công việc cha gợi ý cho cả lô" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	ContextTaskID      *string                     `json:"context_task_id,omitempty" description:"ULID công việc đang mở lúc yêu cầu" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Truncated          bool                        `json:"truncated" description:"true khi tài liệu dài hơn 200.000 ký tự và UNI chỉ đọc phần đầu" example:"false"`
	Status             string                      `json:"status" description:"Trạng thái lô đề xuất: ready, converted hoặc discarded" example:"ready"`
	Items              []DriveTaskProposalItemDTO  `json:"items" description:"Danh sách công việc UNI đề xuất (rỗng sau khi lô đã chuyển thành việc hoặc bị hủy)"`
	TasksCreated       DriveTasksCreatedSummaryDTO `json:"tasks_created" description:"Tóm tắt các việc đã được tạo từ tài liệu này trước đây (§8.8)"`
	PriorCreations     []DriveTaskCreationGroupDTO `json:"prior_creations" description:"Danh sách các lần tạo việc trước đây từ tài liệu này để hộp duyệt cảnh báo (§8.8)"`
	CreatedAt          string                      `json:"created_at" format:"date-time" description:"Thời điểm tạo lô đề xuất (RFC3339)" example:"2026-10-26T09:55:00Z"`
	ExpiresAt          string                      `json:"expires_at" format:"date-time" description:"Thời điểm hết hạn lô đề xuất (created_at + 7 ngày, RFC3339)" example:"2026-11-02T09:55:00Z"`
}

// DriveTaskProposalSDO wraps DriveTaskProposalDTO (POST .../task-proposals, GET .../drive-task-proposals/{proposalID}).
type DriveTaskProposalSDO struct {
	Proposal DriveTaskProposalDTO `json:"proposal" description:"Lô đề xuất công việc từ tài liệu Google Drive"`
}

// DriveProposalDuplicateItemDTO is one item's duplicate check result on POST .../duplicates (spec §8.4).
type DriveProposalDuplicateItemDTO struct {
	Index             int                    `json:"index" description:"Vị trí mục trong danh sách gửi lên" example:"0"`
	PossibleDuplicate *DriveDuplicateTaskDTO `json:"possible_duplicate,omitempty" description:"Công việc đang mở trùng tiêu đề; null khi không trùng"`
}

// DriveProposalDuplicatesSDO is POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/duplicates (spec §8.4).
type DriveProposalDuplicatesSDO struct {
	Duplicates []DriveProposalDuplicateItemDTO `json:"duplicates" description:"Kết quả kiểm trùng cho từng mục khi đổi dự án hoặc việc cha"`
}

// DriveProposalCreatedTaskItemDTO pairs a converted proposal item index with its created task ID (spec §8.5).
type DriveProposalCreatedTaskItemDTO struct {
	Index  int    `json:"index" description:"Vị trí mục đề xuất đã chuyển thành công việc" example:"0"`
	TaskID string `json:"task_id" description:"ULID công việc mới được tạo" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
}

// DriveProposalTasksCreatedSDO is POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks (spec §8.5).
type DriveProposalTasksCreatedSDO struct {
	TaskIDs []string                          `json:"task_ids" description:"Danh sách ULID các công việc vừa tạo, theo thứ tự gửi lên" example:"[\"01J8X4TASKN1P2Q3R4S5T6U7V8\"]"`
	Items   []DriveProposalCreatedTaskItemDTO `json:"items" description:"Ánh xạ từng mục đề xuất sang ULID công việc vừa tạo"`
}
