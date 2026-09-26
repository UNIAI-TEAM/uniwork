package storage

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Backend is the storage provider code that decides where NEW files are
// written. It names the provider kind, not a deployment location: MinIO on
// localhost is still minio, and local is a directory on the server's own
// filesystem. Reading, resolving, reconciling and deleting always follow the
// locator a row already carries, never this selector.
type Backend string

const (
	BackendLocal Backend = "local"
	BackendS3    Backend = "s3"
	BackendMinIO Backend = "minio"
)

// DefaultBackend is the code a missing STORAGE_BACKEND selects. An empty but
// present STORAGE_BACKEND is an error instead of a silent default (spec 3.1).
const DefaultBackend = BackendMinIO

var knownBackends = [...]Backend{BackendLocal, BackendS3, BackendMinIO}

// Valid reports whether the code is in the enum.
func (b Backend) Valid() bool {
	for _, known := range knownBackends {
		if b == known {
			return true
		}
	}
	return false
}

// Environment variables read by the storage configuration loader. The names
// are constants so a missing variable is reported by name, and never by value.
const (
	envStorageBackend = "STORAGE_BACKEND"

	envLocalUploadDir     = "LOCAL_UPLOAD_DIR"
	envLocalUploadBaseURL = "LOCAL_UPLOAD_BASE_URL"

	envS3Bucket    = "S3_BUCKET"
	envS3Region    = "S3_REGION"
	envS3KeyPrefix = "S3_KEY_PREFIX"

	envAWSAccessKeyID     = "AWS_ACCESS_KEY_ID"
	envAWSSecretAccessKey = "AWS_SECRET_ACCESS_KEY"
	envAWSSessionToken    = "AWS_SESSION_TOKEN"
	envAWSEndpointURL     = "AWS_ENDPOINT_URL"

	envMinIOEndpoint        = "MINIO_ENDPOINT"
	envMinIOBucket          = "MINIO_BUCKET"
	envMinIOAccessKeyID     = "MINIO_ACCESS_KEY_ID"
	envMinIOSecretAccessKey = "MINIO_SECRET_ACCESS_KEY"
	envMinIORegion          = "MINIO_REGION"
	envMinIOPublicEndpoint  = "MINIO_PUBLIC_ENDPOINT"
)

// Sentinel errors are the startup codes the spec fixes for a bad storage
// configuration. Startup must fail with one of them instead of falling back to
// another adapter or to an implicit default.
var (
	// ErrConfigInvalid: the selected or declared provider group is missing or
	// wrong (storage_config_invalid).
	ErrConfigInvalid = errors.New("storage_config_invalid")
	// ErrTypeUnsupported: STORAGE_BACKEND names a provider outside the enum
	// (storage_type_unsupported).
	ErrTypeUnsupported = errors.New("storage_type_unsupported")
	// ErrAdapterNotImplemented: the code is in the enum but no factory is
	// registered for it (storage_adapter_not_implemented).
	ErrAdapterNotImplemented = errors.New("storage_adapter_not_implemented")
)

// Config is the validated storage configuration of one process.
//
// Every group the environment declares is present, whether or not it is the
// selected backend: an explicitly declared S3 or MinIO group must have a
// factory and must validate, so a half-configured second provider fails
// startup instead of surfacing months later during a cutover. Exactly the
// selected group is guaranteed to be non-nil.
type Config struct {
	Backend Backend
	Local   *LocalConfig
	S3      *S3Config
	MinIO   *MinIOConfig
}

// LocalConfig configures the filesystem adapter. Root is always an absolute
// path: a relative root would resolve against whatever working directory the
// process happens to start in, and a bucket name or MinIO endpoint stored here
// is a deployment mistake, not a local root.
type LocalConfig struct {
	// Root is the absolute directory the filesystem adapter owns.
	Root string
	// BaseURL is the absolute origin ObjectURL prefixes to keys, without a
	// trailing slash. Empty keeps the returned URLs relative.
	BaseURL string
	// declaredRoot keeps the raw LOCAL_UPLOAD_DIR the loader read. Validation
	// has to see it: filepath.Abs turns "minio:9000" into a plausible-looking
	// path, and a bucket URL must be rejected as an endpoint, not trimmed into
	// a directory name.
	declaredRoot string
}

// S3Config configures the Amazon S3 adapter. Credentials are explicit: a
// static access/secret pair (with an optional session token for temporary
// credentials), or nothing at all to let the SDK use the IAM/instance
// credential chain. Declaring only half of the pair is an error.
type S3Config struct {
	// Bucket is the bucket name only, never a hostname or URL.
	Bucket string
	// Region must match the bucket's region.
	Region string
	// EndpointURL is an optional S3-compatible endpoint (AWS_ENDPOINT_URL).
	// Empty means the real AWS endpoint for Region.
	EndpointURL string
	// AccessKeyID and SecretAccessKey are the static credential pair. Both
	// empty means "use the IAM/instance credential chain"; never trimmed.
	AccessKeyID     string
	SecretAccessKey string
	// SessionToken is the AWS_SESSION_TOKEN for temporary static credentials.
	SessionToken string
	// KeyPrefix is an optional root folder for every object key, normalized to
	// the stored form ("production/").
	KeyPrefix string
}

// MinIOConfig configures the MinIO adapter. Every field is explicit: MinIO
// never falls back to the AWS credential chain or to sample credentials, so a
// missing value is a startup error rather than a request-time surprise.
type MinIOConfig struct {
	// Endpoint is the MinIO S3 API URL, not the Console URL.
	Endpoint string
	// Bucket is a plain bucket name, never a URL or a prefix.
	Bucket string
	// Region must match the region the MinIO server is configured with.
	Region string
	// AccessKeyID and SecretAccessKey are required and never trimmed.
	AccessKeyID     string
	SecretAccessKey string
	// PublicEndpoint is the optional browser-facing URL used when presigning;
	// empty is valid for an authenticated proxy and required by presign mode
	// (checked by preflight, not by this loader).
	PublicEndpoint string
}

// EnvLookup reads one environment variable and reports whether it was
// declared. os.LookupEnv is the production implementation; tests pass a
// map-backed lookup so the negative matrix never mutates process state and
// still distinguishes "absent" from "present but empty".
type EnvLookup func(key string) (string, bool)

// LoadConfigFromEnv loads and validates the process environment against the
// registry of adapter factories.
func LoadConfigFromEnv(reg *Registry) (Config, error) {
	return LoadConfig(reg, os.LookupEnv)
}

// LoadConfig builds the typed storage configuration from the environment.
//
//   - STORAGE_BACKEND absent selects minio; present but empty is
//     storage_config_invalid; the value is trimmed and lowercased before it is
//     matched against the enum; a value outside the enum is
//     storage_type_unsupported.
//   - A valid code without a registered factory is
//     storage_adapter_not_implemented, reported before any field validation.
//   - A provider group is declared by its own values: LOCAL_UPLOAD_DIR for
//     local, S3_BUCKET for s3, any MINIO_* for minio. Declared groups are
//     validated and need a factory even when they are not selected. AWS_*
//     credentials alone do not declare s3 - they are shared with other
//     services in this repo.
//   - Missing or wrong fields are reported together, as variable names. Error
//     text never contains a credential, a token or a signed URL.
//
// LoadConfig performs no I/O and creates nothing: a rejected configuration
// must not leave a directory, bucket or client behind.
func LoadConfig(reg *Registry, lookup EnvLookup) (Config, error) {
	if lookup == nil {
		lookup = os.LookupEnv
	}

	backend, err := selectBackend(lookup)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Backend: backend,
		Local:   localConfigFromEnv(lookup, backend == BackendLocal),
		S3:      s3ConfigFromEnv(lookup, backend == BackendS3),
		MinIO:   minIOConfigFromEnv(lookup, backend == BackendMinIO),
	}
	if err := requireFactories(reg, cfg); err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// Validate re-checks a Config. LoadConfig already applies these rules; the
// found path also helps a hand-built Config fail loudly in tests instead of
// reaching an adapter with empty fields.
func (c Config) Validate() error {
	if !c.Backend.Valid() {
		return fmt.Errorf("%w: %q is not a known storage backend", ErrTypeUnsupported, string(c.Backend))
	}

	var problems []string
	switch c.Backend {
	case BackendLocal:
		if c.Local == nil {
			problems = append(problems, "the selected local backend has no LOCAL_UPLOAD_DIR configuration")
		}
	case BackendS3:
		if c.S3 == nil {
			problems = append(problems, "the selected s3 backend has no S3_BUCKET configuration")
		}
	case BackendMinIO:
		if c.MinIO == nil {
			problems = append(problems, "the selected minio backend has no MINIO_* configuration")
		}
	}
	if c.Local != nil {
		problems = append(problems, c.Local.problems()...)
	}
	if c.S3 != nil {
		problems = append(problems, c.S3.problems()...)
	}
	if c.MinIO != nil {
		problems = append(problems, c.MinIO.problems()...)
	}
	if len(problems) > 0 {
		return fmt.Errorf("%w: %s", ErrConfigInvalid, strings.Join(problems, "; "))
	}
	return nil
}

func (c LocalConfig) problems() []string {
	var problems []string
	declared := c.declaredRoot
	if strings.TrimSpace(declared) == "" {
		declared = c.Root
	}
	switch {
	case strings.TrimSpace(declared) == "":
		problems = append(problems, envLocalUploadDir+" is required when local storage is used")
	case looksLikeURL(declared):
		problems = append(problems, envLocalUploadDir+" must be a filesystem path, not a URL")
	case looksLikeEndpointAddress(declared):
		problems = append(problems, envLocalUploadDir+" must be a filesystem path, not a MinIO/S3 endpoint address")
	case !filepath.IsAbs(c.Root):
		problems = append(problems, envLocalUploadDir+" must resolve to an absolute path")
	}
	if base := strings.TrimSpace(c.BaseURL); base != "" {
		if problem := checkHTTPURL(envLocalUploadBaseURL, base, true); problem != "" {
			problems = append(problems, problem)
		}
	}
	return problems
}

func (c S3Config) problems() []string {
	var problems []string
	problems = append(problems, checkBucketName(envS3Bucket, c.Bucket)...)
	problems = append(problems, checkRegion(envS3Region, c.Region)...)
	if endpoint := strings.TrimSpace(c.EndpointURL); endpoint != "" {
		if problem := checkHTTPURL(envAWSEndpointURL, endpoint, true); problem != "" {
			problems = append(problems, problem)
		}
	}
	accessSet := strings.TrimSpace(c.AccessKeyID) != ""
	secretSet := strings.TrimSpace(c.SecretAccessKey) != ""
	switch {
	case accessSet && !secretSet:
		problems = append(problems, envAWSSecretAccessKey+" is required when "+envAWSAccessKeyID+" is set")
	case secretSet && !accessSet:
		problems = append(problems, envAWSAccessKeyID+" is required when "+envAWSSecretAccessKey+" is set")
	case strings.TrimSpace(c.SessionToken) != "" && !accessSet:
		problems = append(problems, envAWSSessionToken+" requires both "+envAWSAccessKeyID+" and "+envAWSSecretAccessKey)
	}
	return problems
}

func (c MinIOConfig) problems() []string {
	var problems []string
	endpoint := strings.TrimSpace(c.Endpoint)
	if endpoint == "" {
		problems = append(problems, envMinIOEndpoint+" is required when minio storage is used")
	} else if problem := checkHTTPURL(envMinIOEndpoint, endpoint, false); problem != "" {
		problems = append(problems, problem)
	}
	problems = append(problems, checkBucketName(envMinIOBucket, c.Bucket)...)
	problems = append(problems, checkRegion(envMinIORegion, c.Region)...)
	if strings.TrimSpace(c.AccessKeyID) == "" {
		problems = append(problems, envMinIOAccessKeyID+" is required when minio storage is used")
	}
	if strings.TrimSpace(c.SecretAccessKey) == "" {
		problems = append(problems, envMinIOSecretAccessKey+" is required when minio storage is used")
	}
	if public := strings.TrimSpace(c.PublicEndpoint); public != "" {
		if problem := checkHTTPURL(envMinIOPublicEndpoint, public, false); problem != "" {
			problems = append(problems, problem)
		}
	}
	return problems
}

// selectBackend resolves STORAGE_BACKEND. Absent means DefaultBackend; an
// empty value is an error, because silently defaulting would hide a template
// that never got filled in.
func selectBackend(lookup EnvLookup) (Backend, error) {
	raw, ok := lookup(envStorageBackend)
	if !ok {
		return DefaultBackend, nil
	}
	code := Backend(strings.ToLower(strings.TrimSpace(raw)))
	if code == "" {
		return "", fmt.Errorf("%w: %s is declared but empty; unset it to accept the %q default", ErrConfigInvalid, envStorageBackend, string(DefaultBackend))
	}
	if !code.Valid() {
		return "", fmt.Errorf("%w: %s=%q is not one of local, s3, minio", ErrTypeUnsupported, envStorageBackend, string(code))
	}
	return code, nil
}

// requireFactories fails when the selected code or any declared group has no
// registered factory. It runs before field validation so a code that is known
// but not implemented reports storage_adapter_not_implemented - the reason
// startup cannot serve, not the shape of its environment.
func requireFactories(reg *Registry, cfg Config) error {
	declared := []struct {
		code  Backend
		inUse bool
	}{
		{cfg.Backend, true},
		{BackendLocal, cfg.Local != nil},
		{BackendS3, cfg.S3 != nil},
		{BackendMinIO, cfg.MinIO != nil},
	}
	for _, entry := range declared {
		if !entry.inUse || reg.Has(entry.code) {
			continue
		}
		return fmt.Errorf("%w: no adapter factory is registered for %q", ErrAdapterNotImplemented, string(entry.code))
	}
	return nil
}

// localConfigFromEnv returns the local group when it is selected or declared.
// LOCAL_UPLOAD_BASE_URL alone does not declare it: the base URL decorates a
// root, and scripts/local-env.sh exports one for every checkout, including
// deployments that only ever write MinIO or S3.
func localConfigFromEnv(lookup EnvLookup, selected bool) *LocalConfig {
	root, rootSet := envValue(lookup, envLocalUploadDir)
	if !selected && !rootSet {
		return nil
	}
	declared := strings.TrimSpace(root)
	cfg := &LocalConfig{
		BaseURL:      strings.TrimSpace(rawValue(lookup, envLocalUploadBaseURL)),
		declaredRoot: declared,
	}
	// An undeclared root stays empty: resolving "" would silently mean the
	// process working directory, which is exactly the implicit default the
	// explicit-root rule forbids.
	if declared != "" {
		if absolute, err := filepath.Abs(filepath.Clean(declared)); err == nil {
			cfg.Root = absolute
		} else {
			cfg.Root = declared
		}
	}
	return cfg
}

// s3ConfigFromEnv returns the S3 group when it is selected or declared.
// S3_BUCKET is the declaration: AWS_* credentials are shared with other
// services in this repo and must not switch the FileService destination on
// their own. Credential values are stored byte for byte, never trimmed.
func s3ConfigFromEnv(lookup EnvLookup, selected bool) *S3Config {
	_, bucketSet := envValue(lookup, envS3Bucket)
	if !selected && !bucketSet {
		return nil
	}
	return &S3Config{
		Bucket:          strings.TrimSpace(rawValue(lookup, envS3Bucket)),
		Region:          strings.TrimSpace(rawValue(lookup, envS3Region)),
		EndpointURL:     strings.TrimSpace(rawValue(lookup, envAWSEndpointURL)),
		AccessKeyID:     rawValue(lookup, envAWSAccessKeyID),
		SecretAccessKey: rawValue(lookup, envAWSSecretAccessKey),
		SessionToken:    rawValue(lookup, envAWSSessionToken),
		KeyPrefix:       normalizeKeyPrefix(rawValue(lookup, envS3KeyPrefix)),
	}
}

// minIOConfigFromEnv returns the MinIO group when it is selected or when any
// MINIO_* variable is declared. It reads MINIO_* only: MinIO never falls back
// to AWS_* or to the SDK credential chain.
func minIOConfigFromEnv(lookup EnvLookup, selected bool) *MinIOConfig {
	endpoint, endpointSet := envValue(lookup, envMinIOEndpoint)
	bucket, bucketSet := envValue(lookup, envMinIOBucket)
	access, accessSet := envValue(lookup, envMinIOAccessKeyID)
	secret, secretSet := envValue(lookup, envMinIOSecretAccessKey)
	region, regionSet := envValue(lookup, envMinIORegion)
	public, publicSet := envValue(lookup, envMinIOPublicEndpoint)
	if !selected && !(endpointSet || bucketSet || accessSet || secretSet || regionSet || publicSet) {
		return nil
	}
	return &MinIOConfig{
		Endpoint:        strings.TrimSpace(endpoint),
		Bucket:          strings.TrimSpace(bucket),
		Region:          strings.TrimSpace(region),
		AccessKeyID:     access,
		SecretAccessKey: secret,
		PublicEndpoint:  strings.TrimSpace(public),
	}
}

// envValue returns the raw value of key and whether it is a non-blank
// declaration. Blank (empty or whitespace-only) counts as undeclared, but the
// empty string stays distinguishable from an absent variable through the
// lookup, which the selector uses.
func envValue(lookup EnvLookup, key string) (string, bool) {
	raw, ok := lookup(key)
	if !ok {
		return "", false
	}
	return raw, strings.TrimSpace(raw) != ""
}

// rawValue returns the declared value or "" when the variable is absent.
func rawValue(lookup EnvLookup, key string) string {
	raw, _ := lookup(key)
	return raw
}

// normalizeKeyPrefix mirrors the shape storage/s3.go already stores: no
// leading slash, exactly one trailing slash when a prefix is set.
func normalizeKeyPrefix(raw string) string {
	prefix := strings.TrimPrefix(strings.TrimSpace(raw), "/")
	if prefix == "" {
		return ""
	}
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	return prefix
}

// checkBucketName rejects values that are not a plain bucket name: URLs,
// object prefixes and the S3 hostname that is the usual copy/paste mistake.
func checkBucketName(name, value string) []string {
	bucket := strings.TrimSpace(value)
	if bucket == "" {
		return []string{name + " is required"}
	}
	switch {
	case strings.Contains(bucket, "/"):
		return []string{name + " must be a bucket name, not a URL or object prefix"}
	case strings.Contains(bucket, "://"):
		return []string{name + " must be a bucket name, not a URL"}
	case looksLikeS3Hostname(bucket):
		return []string{name + " looks like an S3 hostname; use the bucket name only"}
	}
	return nil
}

// checkRegion requires a non-empty region without whitespace.
func checkRegion(name, value string) []string {
	region := strings.TrimSpace(value)
	if region == "" {
		return []string{name + " is required"}
	}
	if strings.ContainsAny(region, " \t/") {
		return []string{name + " must be a region name such as us-east-1"}
	}
	return nil
}

// checkHTTPURL validates an endpoint or base URL and returns a problem string
// naming the variable, never echoing the value (a URL can carry credentials in
// its userinfo). Paths are rejected unless the caller allows them.
func checkHTTPURL(name, value string, allowPath bool) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return name + " must be an absolute http(s) URL"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return name + " must use the http or https scheme"
	}
	if parsed.User != nil {
		return name + " must not carry userinfo"
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return name + " must not carry a query or fragment"
	}
	if !allowPath && strings.Trim(parsed.Path, "/") != "" {
		return name + " must not carry a path; use the bucket name instead"
	}
	return ""
}

// looksLikeURL reports whether value carries an explicit scheme and authority,
// which a filesystem root never does.
func looksLikeURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme != "" && (parsed.Host != "" || strings.Contains(value, "://"))
}

// looksLikeEndpointAddress reports whether value is a host:port pair, the
// shape an operator reaches for when they paste a MinIO endpoint where a
// filesystem root belongs. Windows drive paths are exempt.
func looksLikeEndpointAddress(value string) bool {
	if filepath.VolumeName(value) != "" {
		return false
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil || host == "" || port == "" {
		return false
	}
	for _, r := range port {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
