package storage

// Object-key prefixes inside the configured bucket (S3/MinIO) or LOCAL_UPLOAD_DIR.
// They are path segments, not a second bucket.
const (
	PrefixAvatars   = "avatars/"
	PrefixChatVoice = "chat/voice/"
	PrefixChatFiles = "chat/files/"
)

// FileServiceKeyPrefix opens every object key FileService mints
// (service.mintObjectKey). Those objects are tenant data read only through
// FileAccessService's authorized route; the legacy /uploads/* route refuses
// them (LocalStorage.ServeFile).
const FileServiceKeyPrefix = "v1/"
