package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type S3Storage struct {
	client       *s3.Client
	bucket       string
	region       string // used to construct virtual-hosted-style public URLs when no CDN/endpoint is set
	cdnDomain    string // if set, returned URLs use this instead of bucket name
	endpointURL  string // custom S3-compatible endpoint (e.g. MinIO)
	usePathStyle bool   // controls path-style S3 addressing
	// keyPrefix is an optional root folder inside the bucket (e.g. "production/").
	// Logical app keys (avatars/…) are stored under this prefix.
	keyPrefix string
}

// NewS3StorageFromEnv creates an S3Storage from environment variables.
// Returns nil if S3_BUCKET is not set.
//
// Environment variables:
//   - S3_BUCKET (required)
//   - S3_REGION (default: us-west-2)
//   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (optional; falls back to default credential chain)
//   - AWS_ENDPOINT_URL (optional S3-compatible endpoint)
//   - S3_USE_PATH_STYLE (optional; defaults to true when AWS_ENDPOINT_URL is set)
//   - S3_KEY_PREFIX (optional root folder, e.g. "production/" or "dev/")
func NewS3StorageFromEnv() *S3Storage {
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		slog.Info("S3_BUCKET not set, cloud upload disabled")
		return nil
	}
	if looksLikeS3Hostname(bucket) {
		slog.Warn(
			"S3_BUCKET looks like a hostname rather than a bucket name — uploads and public URLs will likely both fail. Use only the bucket name (e.g. \"my-bucket\"), not \"<bucket>.s3.<region>.amazonaws.com\".",
			"value", bucket,
		)
	}

	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "us-west-2"
	}

	opts := []func(*config.LoadOptions) error{
		config.WithRegion(region),
	}

	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	if accessKey != "" && secretKey != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		))
	}

	cfg, err := config.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		slog.Error("failed to load AWS config", "error", err)
		return nil
	}

	cdnDomain := os.Getenv("CLOUDFRONT_DOMAIN")

	endpointURL := os.Getenv("AWS_ENDPOINT_URL")
	usePathStyle := s3UsePathStyleFromEnv(endpointURL)
	s3Opts := []func(*s3.Options){}
	if endpointURL != "" || usePathStyle {
		s3Opts = append(s3Opts, func(o *s3.Options) {
			if endpointURL != "" {
				o.BaseEndpoint = aws.String(endpointURL)
			}
			o.UsePathStyle = usePathStyle
		})
	}

	keyPrefix := strings.TrimSpace(os.Getenv("S3_KEY_PREFIX"))
	keyPrefix = strings.TrimPrefix(keyPrefix, "/")
	if keyPrefix != "" && !strings.HasSuffix(keyPrefix, "/") {
		keyPrefix += "/"
	}

	slog.Info("S3 storage initialized", "bucket", bucket, "region", region, "cdn_domain", cdnDomain, "endpoint_url", endpointURL, "use_path_style", usePathStyle, "key_prefix", keyPrefix)
	return &S3Storage{
		client:       s3.NewFromConfig(cfg, s3Opts...),
		bucket:       bucket,
		region:       region,
		cdnDomain:    cdnDomain,
		endpointURL:  endpointURL,
		usePathStyle: usePathStyle,
		keyPrefix:    keyPrefix,
	}
}

// objectKey prepends the configured root folder to a logical app key.
func (s *S3Storage) objectKey(key string) string {
	key = strings.TrimPrefix(key, "/")
	if s.keyPrefix == "" {
		return key
	}
	if strings.HasPrefix(key, s.keyPrefix) {
		return key
	}
	return s.keyPrefix + key
}

func (s *S3Storage) CdnDomain() string {
	return s.cdnDomain
}

// looksLikeS3Hostname returns true when the configured S3_BUCKET value looks
// like an S3 endpoint hostname rather than a bucket name. Real bucket names
// can never legitimately contain "amazonaws.com", so this is an unambiguous
// misconfiguration signal — the most common form being users pasting
// "<bucket>.s3.<region>.amazonaws.com" into S3_BUCKET.
func looksLikeS3Hostname(bucket string) bool {
	return strings.Contains(bucket, "amazonaws.com")
}

func s3UsePathStyleFromEnv(endpointURL string) bool {
	defaultValue := endpointURL != ""
	raw, ok := os.LookupEnv("S3_USE_PATH_STYLE")
	if !ok || strings.TrimSpace(raw) == "" {
		return defaultValue
	}
	parsed, err := parseBoolEnv(raw)
	if err != nil {
		slog.Warn("invalid S3_USE_PATH_STYLE value, using default", "value", raw, "default", defaultValue)
		return defaultValue
	}
	return parsed
}

func parseBoolEnv(raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "t", "true", "y", "yes", "on":
		return true, nil
	case "0", "f", "false", "n", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid bool %q", raw)
	}
}

// awsEndpointDomains are the parent domains AWS serves S3 from. VPC, dualstack
// and FIPS hostnames all live under them, as does the China partition.
var awsEndpointDomains = []string{"amazonaws.com", "amazonaws.com.cn"}

// usesAWSEndpoint reports whether uploads go to real AWS S3 — either the
// default endpoint or an explicitly configured AWS one. The match is on the
// host label boundary, so "notamazonaws.com" and "s3.amazonaws.com.evil.net"
// are correctly treated as third-party endpoints.
func (s *S3Storage) usesAWSEndpoint() bool {
	if s.endpointURL == "" {
		return true
	}
	host := endpointHostname(s.endpointURL)
	for _, domain := range awsEndpointDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// endpointHostname extracts the comparable hostname from a configured
// endpoint: lowercased, without the port, and without a trailing root dot.
// A value written without a scheme is retried as an https URL, since
// url.Parse otherwise reads the whole thing as a path.
func endpointHostname(endpointURL string) string {
	parsed, err := url.Parse(endpointURL)
	if err != nil {
		return ""
	}
	if parsed.Hostname() == "" {
		parsed, err = url.Parse("https://" + endpointURL)
		if err != nil {
			return ""
		}
	}
	return strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
}

// uploadChecksumOptions returns the per-request options for the buffered
// upload path. The SDK defaults RequestChecksumCalculation to WhenSupported,
// which sends the body as aws-chunked with a CRC32 trailer; Aliyun OSS and
// Tencent COS do not implement that encoding and reject the request outright.
//
// Downgrading to WhenRequired drops the trailer, but it also drops the
// client-side checksum entirely, so it is applied only to non-AWS endpoints.
// Real AWS S3 accepts the trailer today, and buckets carrying a default Object
// Lock retention actually require a checksum, so those requests are left
// exactly as the SDK built them — including any AWS_REQUEST_CHECKSUM_CALCULATION
// the operator configured.
func (s *S3Storage) uploadChecksumOptions() []func(*s3.Options) {
	if s.usesAWSEndpoint() {
		return nil
	}
	return []func(*s3.Options){func(opts *s3.Options) {
		opts.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	}}
}

// storageClass returns the appropriate S3 storage class.
// Custom endpoints (e.g. MinIO) only support STANDARD; real AWS defaults to INTELLIGENT_TIERING.
func (s *S3Storage) storageClass() types.StorageClass {
	if s.endpointURL != "" {
		return types.StorageClassStandard
	}
	return types.StorageClassIntelligentTiering
}

// NormalizeObjectURL fixes malformed URLs returned by LiveKit Egress when the
// configured S3 endpoint already includes a scheme (e.g. "https://http://host:9000/...").
func NormalizeObjectURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	switch {
	case strings.HasPrefix(rawURL, "https://http://"):
		return "http://" + strings.TrimPrefix(rawURL, "https://http://")
	case strings.HasPrefix(rawURL, "http://http://"):
		return "http://" + strings.TrimPrefix(rawURL, "http://http://")
	case strings.HasPrefix(rawURL, "https://https://"):
		return "https://" + strings.TrimPrefix(rawURL, "https://https://")
	default:
		return rawURL
	}
}

// KeyFromURL extracts the S3 object key from a CDN or bucket URL.
// e.g. "https://cdn.uniwork.app/abc123.png" → "abc123.png"
//
//	"https://my-bucket.s3.us-east-1.amazonaws.com/uploads/x/y.png" → "uploads/x/y.png"
func (s *S3Storage) KeyFromURL(rawURL string) string {
	rawURL = NormalizeObjectURL(rawURL)
	if s.endpointURL != "" {
		for _, endpoint := range customEndpointAliases(s.endpointURL) {
			for _, prefix := range []string{
				customEndpointObjectPrefix(endpoint, s.bucket, true),
				customEndpointObjectPrefix(endpoint, s.bucket, false),
			} {
				if strings.HasPrefix(rawURL, prefix) {
					return s.stripKeyPrefix(strings.TrimPrefix(rawURL, prefix))
				}
			}
		}
		if key := keyFromCustomEndpointPath(rawURL, s.bucket); key != "" {
			return s.stripKeyPrefix(key)
		}
	}

	// Strip known "https://host/" prefixes. Order matters: the more specific
	// region-qualified hosts come first so they win over the legacy bucket-only
	// prefix that we used to write before the suffix bug was fixed.
	prefixes := make([]string, 0, 5)
	if s.cdnDomain != "" {
		prefixes = append(prefixes, "https://"+s.cdnDomain+"/")
	}
	if s.region != "" {
		// virtual-hosted-style: https://<bucket>.s3.<region>.amazonaws.com/<key>
		prefixes = append(prefixes,
			"https://"+s.bucket+".s3."+s.region+".amazonaws.com/",
			// path-style: https://s3.<region>.amazonaws.com/<bucket>/<key>
			"https://s3."+s.region+".amazonaws.com/"+s.bucket+"/",
		)
	}
	// Legacy / fallback: the buggy "https://<bucket>/<key>" form that older
	// records may still hold, plus a generic bucket-host prefix.
	prefixes = append(prefixes, "https://"+s.bucket+"/")

	for _, prefix := range prefixes {
		if strings.HasPrefix(rawURL, prefix) {
			return s.stripKeyPrefix(strings.TrimPrefix(rawURL, prefix))
		}
	}
	// Fallback: take everything after the last "/".
	if i := strings.LastIndex(rawURL, "/"); i >= 0 {
		return s.stripKeyPrefix(rawURL[i+1:])
	}
	return s.stripKeyPrefix(rawURL)
}

func (s *S3Storage) stripKeyPrefix(key string) string {
	if s.keyPrefix != "" && strings.HasPrefix(key, s.keyPrefix) {
		return strings.TrimPrefix(key, s.keyPrefix)
	}
	return key
}

// GetReader streams the object body back to the caller. The returned
// ReadCloser must be closed; closing it terminates the underlying HTTP
// connection to S3. A missing key surfaces as an *types.NoSuchKey error
// wrapped in the SDK's smithy wrapper — callers can use errors.As to
// distinguish "not found" from a transport failure.
func (s *S3Storage) GetReader(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.GetReaderRange(ctx, key, 0, -1)
}

// ObjectSize returns the stored object length in bytes.
func (s *S3Storage) ObjectSize(ctx context.Context, key string) (int64, error) {
	if key == "" {
		return 0, fmt.Errorf("s3 ObjectSize: empty key")
	}
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	if err != nil {
		return 0, fmt.Errorf("s3 HeadObject: %w", err)
	}
	if out.ContentLength == nil {
		return 0, fmt.Errorf("s3 HeadObject: missing ContentLength")
	}
	return *out.ContentLength, nil
}

// GetReaderRange streams an object, optionally bounded. Pass end < 0 for open-ended range.
func (s *S3Storage) GetReaderRange(ctx context.Context, key string, start, end int64) (io.ReadCloser, error) {
	if key == "" {
		return nil, fmt.Errorf("s3 GetReaderRange: empty key")
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	}
	if start > 0 || end >= 0 {
		var rangeStr string
		if end >= 0 {
			rangeStr = fmt.Sprintf("bytes=%d-%d", start, end)
		} else {
			rangeStr = fmt.Sprintf("bytes=%d-", start)
		}
		input.Range = aws.String(rangeStr)
	}
	out, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("s3 GetObject: %w", err)
	}
	return out.Body, nil
}

func (s *S3Storage) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	return s.PresignGetWithContentDisposition(ctx, key, ttl, "")
}

func (s *S3Storage) PresignGetWithContentDisposition(ctx context.Context, key string, ttl time.Duration, contentDisposition string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("s3 PresignGet: empty key")
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	}
	if contentDisposition != "" {
		input.ResponseContentDisposition = aws.String(contentDisposition)
	}
	out, err := s3.NewPresignClient(s.client).PresignGetObject(ctx, input, func(opts *s3.PresignOptions) {
		opts.Expires = ttl
	})
	if err != nil {
		return "", fmt.Errorf("s3 PresignGetObject: %w", err)
	}
	return out.URL, nil
}

// Delete removes an object from S3. Errors are logged but not fatal.
func (s *S3Storage) Delete(ctx context.Context, key string) {
	if err := s.DeleteObject(ctx, key); err != nil {
		slog.Error("s3 DeleteObject failed", "key", key, "error", err)
	}
}

// DeleteObject is Delete with the error surfaced — the media reconciler needs
// it to keep the ledger row and schedule a retry instead of assuming success.
func (s *S3Storage) DeleteObject(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	return err
}

// ObjectURL returns the URL a successful Upload/UploadStream of key would
// return. It is a pure function of configuration, so the media intent ledger
// can persist the URL BEFORE the upload for the durable reference check.
func (s *S3Storage) ObjectURL(key string) string {
	return s.uploadedURL(s.objectKey(key))
}

// DeleteKeys removes multiple objects from S3. Best-effort, errors are logged.
func (s *S3Storage) DeleteKeys(ctx context.Context, keys []string) {
	for _, key := range keys {
		s.Delete(ctx, key)
	}
}

func (s *S3Storage) Upload(ctx context.Context, key string, data []byte, contentType string, filename string) (string, error) {
	fullKey := s.objectKey(key)
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:             aws.String(s.bucket),
		Key:                aws.String(fullKey),
		Body:               bytes.NewReader(data),
		ContentType:        aws.String(contentType),
		ContentDisposition: aws.String(ContentDisposition(contentType, filename)),
		CacheControl:       aws.String("max-age=432000,public"),
		StorageClass:       s.storageClass(),
	}, s.uploadChecksumOptions()...)
	if err != nil {
		return "", fmt.Errorf("s3 PutObject: %w", err)
	}
	return s.uploadedURL(fullKey), nil
}

func (s *S3Storage) UploadStream(ctx context.Context, key string, data io.Reader, sizeBytes int64, contentType string, filename string) (string, error) {
	if sizeBytes <= 0 {
		return "", fmt.Errorf("s3 PutObject: content length is required for streaming upload")
	}
	fullKey := s.objectKey(key)
	input := &s3.PutObjectInput{
		Bucket:             aws.String(s.bucket),
		Key:                aws.String(fullKey),
		Body:               data,
		ContentLength:      aws.Int64(sizeBytes),
		ContentType:        aws.String(contentType),
		ContentDisposition: aws.String(ContentDisposition(contentType, filename)),
		CacheControl:       aws.String("max-age=432000,public"),
		StorageClass:       s.storageClass(),
	}
	_, err := s.client.PutObject(ctx, input, func(opts *s3.Options) {
		// A non-seekable stream cannot be rewound for SigV4 payload hashing.
		// S3 supports UNSIGNED-PAYLOAD for authenticated requests. Avoid the
		// optional trailing-checksum path as well: it requires another rewind
		// or aws-chunked framing that S3-compatible backends handle unevenly.
		opts.APIOptions = append(opts.APIOptions, v4.SwapComputePayloadSHA256ForUnsignedPayloadMiddleware)
		opts.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	if err != nil {
		return "", fmt.Errorf("s3 PutObject: %w", err)
	}
	return s.uploadedURL(fullKey), nil
}

// uploadedURL returns the URL stored for client consumption after an upload.
// Priority: CDN domain > custom endpoint > AWS S3 region-qualified host. The CDN
// domain wins even when a custom endpoint is set so S3-compatible backends
// (MinIO, R2, B2, Wasabi, etc.) can be paired with a separate public-read
// domain — writes still go through the SDK with the custom endpoint; only the
// reader-facing URL changes.
//
// For the default AWS S3 case, virtual-hosted-style is preferred:
// https://<bucket>.s3.<region>.amazonaws.com/<key>. When the bucket name
// contains dots, the AWS-issued wildcard TLS certificate (`*.s3.amazonaws.com`)
// fails to validate the host, so we fall back to path-style:
// https://s3.<region>.amazonaws.com/<bucket>/<key>.
func (s *S3Storage) uploadedURL(key string) string {
	if s.cdnDomain != "" {
		return fmt.Sprintf("https://%s/%s", s.cdnDomain, key)
	}
	if s.endpointURL != "" {
		return customEndpointObjectURL(s.endpointURL, s.bucket, key, s.usePathStyle)
	}
	if s.usePathStyle || strings.Contains(s.bucket, ".") {
		return fmt.Sprintf("https://s3.%s.amazonaws.com/%s/%s", s.region, s.bucket, key)
	}
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.bucket, s.region, key)
}

func customEndpointObjectURL(endpointURL, bucket, key string, usePathStyle bool) string {
	return customEndpointObjectPrefix(endpointURL, bucket, usePathStyle) + key
}

// customEndpointAliases returns equivalent local MinIO hosts so URLs written
// by LiveKit Egress (host.docker.internal) still resolve when the app reads
// via localhost (or the reverse).
func customEndpointAliases(endpointURL string) []string {
	trimmed := strings.TrimRight(endpointURL, "/")
	u, err := url.Parse(trimmed)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return []string{trimmed}
	}
	host := u.Hostname()
	port := u.Port()
	portSuffix := ""
	if port != "" {
		portSuffix = ":" + port
	}
	altHosts := []string{host}
	switch host {
	case "localhost":
		altHosts = append(altHosts, "host.docker.internal", "127.0.0.1")
	case "host.docker.internal":
		altHosts = append(altHosts, "localhost", "127.0.0.1")
	case "127.0.0.1":
		altHosts = append(altHosts, "localhost", "host.docker.internal")
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(altHosts))
	for _, h := range altHosts {
		variant := u.Scheme + "://" + h + portSuffix
		if _, ok := seen[variant]; ok {
			continue
		}
		seen[variant] = struct{}{}
		out = append(out, variant)
	}
	return out
}

// keyFromCustomEndpointPath extracts the object key from any path-style URL
// whose path begins with /<bucket>/, regardless of hostname.
func keyFromCustomEndpointPath(rawURL, bucket string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	path := strings.TrimPrefix(u.Path, "/")
	prefix := bucket + "/"
	if strings.HasPrefix(path, prefix) {
		return strings.TrimPrefix(path, prefix)
	}
	return ""
}

func customEndpointObjectPrefix(endpointURL, bucket string, usePathStyle bool) string {
	trimmed := strings.TrimRight(endpointURL, "/")
	if usePathStyle {
		return trimmed + "/" + bucket + "/"
	}

	u, err := url.Parse(trimmed)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return trimmed + "/"
	}
	u.Host = bucket + "." + u.Host
	u.Path = strings.TrimRight(u.Path, "/") + "/"
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}
