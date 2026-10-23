package backfill

import (
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/storage"
)

// S3_KEY_PREFIX stripping is scoped to the app's own S3 bucket URLs; a MinIO
// (or LiveKit) object whose key happens to start with the same prefix keeps
// its full key.
func TestResolveStripPrefixIsScopedToS3Rules(t *testing.T) {
	r := baseResolver()
	r.stripPrefix = "pfx/"
	r.rules = append(r.rules,
		prefixRule{backend: "s3", bucket: "app", prefix: "https://app.s3.example.com/", strip: true},
		prefixRule{backend: "minio", bucket: "uniwork", prefix: "http://localhost:9000/uniwork/"},
	)

	loc, ok := r.Resolve("https://app.s3.example.com/pfx/meetings/ws-1/m-1.mp4")
	if !ok || loc.Key != "meetings/ws-1/m-1.mp4" {
		t.Fatalf("s3 resolve = %+v ok=%v", loc, ok)
	}
	loc, ok = r.Resolve("http://localhost:9000/uniwork/pfx/meetings/ws-1/m-1.mp4")
	if !ok || loc.Key != "pfx/meetings/ws-1/m-1.mp4" || loc.Bucket != "uniwork" {
		t.Fatalf("minio resolve must keep pfx/ = %+v ok=%v", loc, ok)
	}
}

func TestResolveUnknownAuthorityFails(t *testing.T) {
	if _, ok := baseResolver().Resolve("https://cdn.example.net/x.bin"); ok {
		t.Fatal("unconfigured authority resolved")
	}
	if _, ok := baseResolver().Resolve(""); ok {
		t.Fatal("empty URL resolved")
	}
}

// The resolver reads S3_KEY_PREFIX through storage.ParseKeyRoot, the server's
// own reading: the stored form matches what the writers prepend, and a value
// the server refuses to start with stops the backfill instead of being cleaned
// into another root (the old local reading trimmed "/production" to
// "production/").
func TestResolverFromEnvReadsTheKeyRootLikeTheServer(t *testing.T) {
	for _, k := range []string{"LOCAL_UPLOAD_BASE_URL", "API_PUBLIC_URL", "CLOUDFRONT_DOMAIN", "AWS_ENDPOINT_URL", "MINIO_BUCKET", "LIVEKIT_RECORDING_BUCKET"} {
		t.Setenv(k, "")
	}
	t.Setenv("S3_BUCKET", "app")
	t.Setenv("S3_REGION", "ap-southeast-1")

	t.Setenv("S3_KEY_PREFIX", " production ")
	r, err := ResolverFromEnv()
	if err != nil {
		t.Fatalf("ResolverFromEnv(production) = %v", err)
	}
	if r.stripPrefix != "production/" {
		t.Fatalf("stripPrefix = %q, want production/", r.stripPrefix)
	}
	loc, ok := r.Resolve("https://app.s3.ap-southeast-1.amazonaws.com/production/avatars/a.png")
	if !ok || loc.Key != "avatars/a.png" {
		t.Fatalf("resolve = %+v ok=%v", loc, ok)
	}

	for _, raw := range []string{"/production", "../production", "production.", "v1/"} {
		t.Setenv("S3_KEY_PREFIX", raw)
		if r, err := ResolverFromEnv(); !errors.Is(err, storage.ErrConfigInvalid) || r != nil {
			t.Errorf("ResolverFromEnv(S3_KEY_PREFIX=%q) = %v, %v; want storage_config_invalid", raw, r, err)
		}
	}
}
