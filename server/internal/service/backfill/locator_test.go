package backfill

import "testing"

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
