package storage

// Object-key prefixes inside the configured bucket (S3/MinIO) or LOCAL_UPLOAD_DIR.
// They are path segments, not a second bucket.
const (
	PrefixAvatars   = "avatars/"
	PrefixChatVoice = "chat/voice/"
	PrefixChatFiles = "chat/files/"
)
