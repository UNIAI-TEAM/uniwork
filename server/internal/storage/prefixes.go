package storage

import "strings"

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

// KeyRoot is the environment's folder inside a bucket that several
// environments may share ("develop/", "production/"). It is read from
// S3_KEY_PREFIX - the root the legacy S3 writer already prepends - for every
// backend, so one setting decides where an environment's objects live.
// FileService mints <root>v1/...; the empty root keeps keys at the bucket
// (or LOCAL_UPLOAD_DIR) top level.

// normalizeKeyRoot trims surrounding whitespace and adds the single trailing
// slash of the stored form. It never cleans a path: anything ValidKeyRoot
// refuses stays refused.
func normalizeKeyRoot(raw string) string {
	root := strings.TrimSpace(raw)
	if root == "" || strings.HasSuffix(root, "/") {
		return root
	}
	return root + "/"
}

// ValidKeyRoot reports whether root is "" or the stored form of a path-safe
// root: one or more segments of letters, digits, '.', '_' or '-', each ending
// in exactly one '/', none of them "." or "..", none ending in '.' (Windows
// strips it, so "develop." would name "develop"), and the first one not "v1"
// (the FileService boundary, compared case-insensitively). Leading slashes,
// backslashes, empty segments, URLs, drive letters, whitespace and escapes are
// refused rather than cleaned into some other folder.
func ValidKeyRoot(root string) bool {
	if root == "" {
		return true
	}
	if !strings.HasSuffix(root, "/") {
		return false
	}
	for i, seg := range strings.Split(strings.TrimSuffix(root, "/"), "/") {
		if seg == "" || strings.HasSuffix(seg, ".") {
			return false
		}
		if i == 0 && strings.EqualFold(seg, strings.TrimSuffix(FileServiceKeyPrefix, "/")) {
			return false
		}
		for _, r := range seg {
			ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-'
			if !ok {
				return false
			}
		}
	}
	return true
}
