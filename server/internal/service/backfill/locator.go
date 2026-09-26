package backfill

import (
	"net/url"
	"os"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/storage"
)

// resolvedLocator is a URL mapped to a backend + bucket + key candidate. A
// Resolver never guesses — a URL that matches no configured authority is
// foreign, and it NEVER falls back to "last path segment" the way
// S3Storage.KeyFromURL does for its own callers.
type resolvedLocator struct {
	Backend string // local | s3 | minio
	Bucket  string
	Key     string
}

type prefixRule struct {
	backend string
	bucket  string
	prefix  string // full URL prefix ending in "/" that precedes the key
}

// Resolver maps stored URLs to locators using only the deployment's
// configured storage authorities: the local /uploads route (relative and
// under LOCAL_UPLOAD_BASE_URL / API_PUBLIC_URL), the S3 bucket's public URL
// forms (CDN domain, virtual-hosted, path-style, custom endpoint, the old
// https://<bucket>/ bug form) and the MinIO endpoint + public endpoint forms.
type Resolver struct {
	rules       []prefixRule
	stripPrefix string // S3_KEY_PREFIX: URLs carry it, rows store the logical key
}

// baseResolver carries only the deployment-independent rule: the API serves
// local uploads under the relative /uploads/ route, whatever env says.
func baseResolver() *Resolver {
	return &Resolver{rules: []prefixRule{{backend: string(storage.BackendLocal), prefix: "/uploads/"}}}
}

// ResolverFromEnv builds the resolver from the same environment the storage
// loaders read. A group is only declared when its variables exist, mirroring
// storage.LoadConfig's declaration rules.
func ResolverFromEnv() *Resolver {
	r := baseResolver()

	// Local: the API serves /uploads/<key>; the base is either the explicit
	// upload base or the API origin.
	for _, base := range []string{os.Getenv("LOCAL_UPLOAD_BASE_URL"), os.Getenv("API_PUBLIC_URL")} {
		if b := strings.TrimRight(strings.TrimSpace(base), "/"); b != "" {
			r.rules = append(r.rules, prefixRule{backend: string(storage.BackendLocal), prefix: b + "/uploads/"})
		}
	}

	if bucket := strings.TrimSpace(os.Getenv("S3_BUCKET")); bucket != "" {
		region := strings.TrimSpace(os.Getenv("S3_REGION"))
		prefix := strings.TrimSpace(os.Getenv("S3_KEY_PREFIX"))
		prefix = strings.TrimPrefix(prefix, "/")
		if prefix != "" && !strings.HasSuffix(prefix, "/") {
			prefix += "/"
		}
		r.stripPrefix = prefix
		if cdn := strings.TrimSpace(os.Getenv("CLOUDFRONT_DOMAIN")); cdn != "" {
			r.rules = append(r.rules, prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: "https://" + cdn + "/"})
		}
		if region != "" {
			r.rules = append(r.rules,
				prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: "https://" + bucket + ".s3." + region + ".amazonaws.com/"},
				prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: "https://s3." + region + ".amazonaws.com/" + bucket + "/"},
			)
		}
		// The legacy writer's bug form plus endpoint-based deployments
		// (MinIO/R2 reached through the s3 adapter, LiveKit egress URLs).
		r.rules = append(r.rules, prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: "https://" + bucket + "/"})
		for _, ep := range endpointAliases(os.Getenv("AWS_ENDPOINT_URL")) {
			r.rules = append(r.rules,
				prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: ep + "/" + bucket + "/"},
			)
			if vh := virtualHosted(ep, bucket); vh != "" {
				r.rules = append(r.rules, prefixRule{backend: string(storage.BackendS3), bucket: bucket, prefix: vh})
			}
		}
	}

	if bucket := strings.TrimSpace(os.Getenv("MINIO_BUCKET")); bucket != "" {
		for _, ep := range append(endpointAliases(os.Getenv("MINIO_ENDPOINT")), endpointAliases(os.Getenv("MINIO_PUBLIC_ENDPOINT"))...) {
			r.rules = append(r.rules,
				prefixRule{backend: string(storage.BackendMinIO), bucket: bucket, prefix: ep + "/" + bucket + "/"},
			)
			if vh := virtualHosted(ep, bucket); vh != "" {
				r.rules = append(r.rules, prefixRule{backend: string(storage.BackendMinIO), bucket: bucket, prefix: vh})
			}
		}
	}
	return r
}

// stripKey removes the configured S3 key prefix the same way
// S3Storage.stripKeyPrefix does, so an extracted key equals the logical
// object_key the writers stored.
func (r *Resolver) stripKey(key string) string {
	if r.stripPrefix != "" && strings.HasPrefix(key, r.stripPrefix) {
		return strings.TrimPrefix(key, r.stripPrefix)
	}
	return key
}

// endpointAliases returns the endpoint plus the docker/localhost mirror
// (customEndpointAliases in storage): a URL minted inside docker still
// resolves when the command runs on the host, and vice versa.
func endpointAliases(endpoint string) []string {
	ep := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if ep == "" {
		return nil
	}
	u, err := url.Parse(ep)
	if err != nil || u.Host == "" {
		return nil
	}
	out := []string{ep}
	flip := map[string]string{
		"localhost":            "host.docker.internal",
		"127.0.0.1":            "host.docker.internal",
		"host.docker.internal": "localhost",
	}
	if alt, ok := flip[u.Hostname()]; ok {
		out = append(out, u.Scheme+"://"+alt+portSuffix(u))
	}
	return out
}

func portSuffix(u *url.URL) string {
	if u.Port() != "" {
		return ":" + u.Port()
	}
	return ""
}

// virtualHosted is the bucket-as-subdomain form custom endpoints also accept
// (scheme://<bucket>.<endpoint-host>/<key>).
func virtualHosted(endpoint, bucket string) string {
	u, err := url.Parse(strings.TrimRight(endpoint, "/"))
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + bucket + "." + u.Host + "/"
}

// Resolve maps a stored URL hint to a candidate locator. ok=false means the
// URL matched no configured authority — the caller decides foreign vs
// unresolved from context (an absolute URL is foreign; garbage is
// unresolved).
func (r *Resolver) Resolve(raw string) (resolvedLocator, bool) {
	raw = storage.NormalizeObjectURL(strings.TrimSpace(raw))
	if raw == "" {
		return resolvedLocator{}, false
	}
	for _, rule := range r.rules {
		if rule.prefix == "" || !strings.HasPrefix(raw, rule.prefix) {
			continue
		}
		key := strings.TrimPrefix(raw, rule.prefix)
		// Query/fragment-bearing URLs still resolve on the path part;
		// presigned legacy URLs carried signatures we never persist.
		if i := strings.IndexAny(key, "?#"); i >= 0 {
			key = key[:i]
		}
		if key = r.stripKey(key); key == "" {
			return resolvedLocator{}, false
		}
		return resolvedLocator{Backend: rule.backend, Bucket: rule.bucket, Key: key}, true
	}
	return resolvedLocator{}, false
}
