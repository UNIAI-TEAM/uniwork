package storage

import (
	"context"
	"io"
	"time"
)

// Storage is the pre-FileService media API (plan §4 T2: "giữ các
// method/consumer legacy còn cần"). It stays while the consumers below hold
// it; the locator contract in objects.go is what FileService (T3+) drives,
// and this interface shrinks as each consumer migrates. The concrete adapters
// implement both surfaces - there is no second storage package and no
// dual-write pipeline.
//
// Manifest of callers and removal conditions (plan §4 T2 last bullet):
//
//	Upload(key, data, ct, filename)      - handler/avatar.go (T6), handler/
//	                                     chat_file_message.go (T7), handler/
//	                                     chat_voice_message.go (T7), service/
//	                                     audit_export.go (T10), service/
//	                                     task_attachments.go (T6). Removal:
//	                                     last caller moves to files.Service.
//	UploadStream / UploadFromReader      - kept for stream uploads of the same
//	                                     consumers; removal with Upload.
//	Delete / DeleteKeys                  - handler/chat_file_message.go and
//	                                     chat_voice_message.go (T7). Removal:
//	                                     chat objects become files rows and
//	                                     deletion moves to FileService GC.
//	DeleteObject                         - service/task_attachments.go (T6).
//	                                     Removal: attachments delete through
//	                                     FileService.
//	GetReader                            - attachment/chat content routes and
//	                                     service/task_attachments.go (T6/T7).
//	                                     Removal: proxy reads go through
//	                                     files.Service.Open.
//	ObjectURL / KeyFromURL / CdnDomain   - handler/audit.go (T10) and the
//	                                     recording handlers (T8). Removal:
//	                                     URLs stop being persisted (files row
//	                                     + resolve) and KeyFromURL is only
//	                                     needed while DBs hold raw URLs.
//	Presigner / DownloadPresigner        - handler/chat_voice.go and
//	                                     handler/recording_playback.go (T7/T8).
//	                                     Removal: resolve flows through
//	                                     FileService presign/proxy policy.
//	ObjectSize / GetReaderRange          - handler/recording_playback.go on the
//	                                     concrete *S3Storage (T8). Removal:
//	                                     recording playback moves to the
//	                                     contract's ranged Open.
//	ServeFile / GetFilePath              - handler/router/meta.go serves
//	                                     /uploads/* for local-only objects.
//	                                     Removal: the last local-served
//	                                     consumer migrates or the route stays
//	                                     a documented legacy surface.
type Storage interface {
	Upload(ctx context.Context, key string, data []byte, contentType string, filename string) (string, error)
	Delete(ctx context.Context, key string)
	// DeleteObject is Delete with the error surfaced — the channel-media
	// reconciler schedules retries on failure instead of assuming success.
	DeleteObject(ctx context.Context, key string) error
	DeleteKeys(ctx context.Context, keys []string)
	KeyFromURL(rawURL string) string
	// ObjectURL is the URL a successful Upload of key would return — a pure
	// function of configuration, so the media intent ledger can persist it
	// BEFORE the upload.
	ObjectURL(key string) string
	CdnDomain() string
	// GetReader streams an object back to the caller. Used by the attachment
	// preview proxy (GET /api/attachments/{id}/content) to bypass CloudFront
	// CORS and the inline/attachment Content-Disposition decision. Caller
	// must Close the returned reader.
	GetReader(ctx context.Context, key string) (io.ReadCloser, error)
}

type Presigner interface {
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
}

type DownloadPresigner interface {
	PresignGetWithContentDisposition(ctx context.Context, key string, ttl time.Duration, contentDisposition string) (string, error)
}
