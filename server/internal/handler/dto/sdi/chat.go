package sdi

// EnsureWorkspaceChatRoomSDI is POST /workspaces/{workspaceID}/chat/room.
type EnsureWorkspaceChatRoomSDI struct {
	MatrixAccessToken string `json:"matrix_access_token" description:"Matrix access token from login/register session" example:"syt_abc123"`
}

// MintChatVoiceTokenSDI is POST /chat/voice/token.
type MintChatVoiceTokenSDI struct {
	MatrixRoomID string `json:"matrix_room_id" description:"Matrix room id for the DM conversation" example:"!PDBezmTDyDMTsEIAGl:localhost"`
}
