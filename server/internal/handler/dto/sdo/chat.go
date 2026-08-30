package sdo

// WorkspaceChatRoomSDO is the workspace Matrix room mapping.
type WorkspaceChatRoomSDO struct {
	RoomID      string `json:"room_id,omitempty" description:"Matrix room id when provisioned; omitted until the first message" example:"!abc:localhost"`
	WorkspaceID string `json:"workspace_id" description:"UniWork workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Enabled     bool   `json:"enabled" description:"false when Matrix is not configured on the server" example:"true"`
}

// ChatUserLookupSDO is a UniWork user resolved by email for cross-workspace DM.
type ChatUserLookupSDO struct {
	UserID       string `json:"user_id" description:"UniWork user id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email        string `json:"email" description:"Account email" example:"colleague@example.com"`
	DisplayName  string `json:"display_name" description:"Display name" example:"Nguyen Van A"`
	MatrixUserID string `json:"matrix_user_id,omitempty" description:"Matrix user id when provisioned" example:"@01j8x4k2:localhost"`
	MatrixReady  bool   `json:"matrix_ready" description:"true when the user has a Matrix account and can receive DMs" example:"true"`
}

// MatrixSessionSDO carries Matrix credentials after UniWork auth.
type MatrixSessionSDO struct {
	UserID      string `json:"user_id" description:"Matrix user id (@localpart:server)" example:"@01j8x4k2:localhost"`
	AccessToken string `json:"access_token" description:"Matrix access token for matrix-js-sdk" example:"syt_abc123"`
	DeviceID    string `json:"device_id,omitempty" description:"Matrix device id" example:"ABCDEF"`
	HomeServer  string `json:"home_server,omitempty" description:"Matrix homeserver name" example:"localhost"`
	BaseURL     string `json:"base_url" description:"Matrix client base URL" example:"http://127.0.0.1:8008"`
}
