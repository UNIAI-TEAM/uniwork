package sdi

type OfficeDesktopDownloadSDI struct {
	OrganizationID string `query:"organization_id" minLength:"1" description:"Tổ chức của thành viên tải bộ cài" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Channel        string `query:"channel" enum:"stable,beta,dev" default:"stable" description:"Kênh bộ cài của triển khai" example:"stable"`
	Bundle         bool   `query:"bundle" description:"Tải ZIP chứa bộ cài và hồ sơ triển khai" example:"false"`
	Platform       string `query:"platform" enum:"win32-x64,win32-x64-zip,darwin-arm64,darwin-x64,linux-x64-deb,linux-x64-appimage" description:"Nền tảng bộ cài khi tải bundle" example:"linux-x64-deb"`
}
