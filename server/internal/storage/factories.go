package storage

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// NewDefaultRegistry returns the production registry: one real factory per
// selector code. It is the composition root's counterpart to LoadConfig -
// every enum code has a factory, so a configured backend can never hit
// storage_adapter_not_implemented.
func NewDefaultRegistry() *Registry {
	reg := NewRegistry()
	for _, f := range []Factory{localFactory{}, s3Factory{}, minioFactory{}} {
		if err := reg.Register(f); err != nil {
			// Distinct valid codes: a registration failure here is a
			// programming error, and failing loudly beats a partial registry.
			panic("storage: NewDefaultRegistry: " + err.Error())
		}
	}
	return reg
}

// BuildStores constructs one adapter per declared provider group, running
// each factory's bounded preflight. It is the composition root's entry point:
// a Config can declare several groups (the selector picks where NEW writes
// go; reads and deletes always dispatch on the locator a row already
// carries), so every declared group gets a working adapter or startup fails
// (spec §3.1: a configured-but-broken destination must not wait months for a
// cutover to surface).
func BuildStores(ctx context.Context, cfg Config, reg *Registry) (map[Backend]ObjectStore, error) {
	stores := make(map[Backend]ObjectStore, len(knownBackends))
	declared := []struct {
		backend Backend
		present bool
	}{
		{BackendLocal, cfg.Local != nil},
		{BackendS3, cfg.S3 != nil},
		{BackendMinIO, cfg.MinIO != nil},
	}
	for _, group := range declared {
		if !group.present {
			continue
		}
		factory, err := reg.Get(group.backend)
		if err != nil {
			return nil, err
		}
		store, err := factory.New(ctx, cfg)
		if err != nil {
			return nil, fmt.Errorf("storage: %s adapter: %w", string(group.backend), err)
		}
		if store == nil || isTypedNil(store) {
			return nil, fmt.Errorf("storage: %s adapter: %w: factory returned a nil store", string(group.backend), ErrFactoryNil)
		}
		stores[group.backend] = store
	}
	return stores, nil
}

// localFactory builds the filesystem adapter.
type localFactory struct{}

func (localFactory) Backend() Backend { return BackendLocal }

func (localFactory) New(ctx context.Context, cfg Config) (ObjectStore, error) {
	if cfg.Local == nil {
		return nil, fmt.Errorf("%w: no local configuration", ErrConfigInvalid)
	}
	store := &localObjectStore{root: cfg.Local.Root}
	if err := store.preflight(ctx); err != nil {
		return nil, err
	}
	slog.Info("local storage adapter ready", "dir", cfg.Local.Root)
	return store, nil
}

// s3Factory builds the Amazon S3 adapter. A static access/secret pair (with an
// optional session token) is used when configured; an empty pair hands
// credential resolution to the SDK default chain, which is also what gives
// IAM/STS deployments automatic refresh (spec §3.3.5).
type s3Factory struct{}

func (s3Factory) Backend() Backend { return BackendS3 }

func (s3Factory) New(ctx context.Context, cfg Config) (ObjectStore, error) {
	if cfg.S3 == nil {
		return nil, fmt.Errorf("%w: no s3 configuration", ErrConfigInvalid)
	}
	c := cfg.S3
	opts := []func(*config.LoadOptions) error{config.WithRegion(c.Region)}
	if c.AccessKeyID != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, c.SessionToken),
		))
	}
	awsCfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("s3 config: %w", err)
	}
	s3Opts := []func(*s3.Options){}
	if c.EndpointURL != "" {
		s3Opts = append(s3Opts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(c.EndpointURL)
			// A custom endpoint is an S3-compatible service; path-style is
			// the interoperable default (same rule the env constructor used).
			o.UsePathStyle = true
		})
	}
	store := &s3ObjectStore{
		client:  s3.NewFromConfig(awsCfg, s3Opts...),
		bucket:  c.Bucket,
		backend: BackendS3,
	}
	store.presignClient = store.client
	if err := store.preflight(ctx); err != nil {
		return nil, err
	}
	slog.Info("s3 storage adapter ready", "bucket", c.Bucket, "region", c.Region, "versioned", store.versioned)
	return store, nil
}

// minioFactory builds the MinIO adapter. Every value is explicit - MinIO never
// reads the AWS credential chain - and path-style addressing is required
// because virtual-host style needs wildcard DNS a MinIO deployment does not
// have (spec §3.2).
type minioFactory struct{}

func (minioFactory) Backend() Backend { return BackendMinIO }

func (minioFactory) New(ctx context.Context, cfg Config) (ObjectStore, error) {
	if cfg.MinIO == nil {
		return nil, fmt.Errorf("%w: no minio configuration", ErrConfigInvalid)
	}
	c := cfg.MinIO
	creds := credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, "")
	newClient := func(endpoint string) *s3.Client {
		return s3.New(s3.Options{
			Region:       c.Region,
			BaseEndpoint: aws.String(endpoint),
			UsePathStyle: true,
			Credentials:  aws.NewCredentialsCache(creds),
		})
	}
	store := &s3ObjectStore{
		client:        newClient(c.Endpoint),
		presignClient: newClient(c.Endpoint),
		bucket:        c.Bucket,
		backend:       BackendMinIO,
	}
	if c.PublicEndpoint != "" {
		// The presign client must sign the host the browser reaches - the
		// signature covers host and path, so the API-facing client cannot
		// mint browser URLs.
		store.presignClient = newClient(c.PublicEndpoint)
	}
	if err := store.preflight(ctx); err != nil {
		return nil, err
	}
	slog.Info("minio storage adapter ready", "endpoint", c.Endpoint, "bucket", c.Bucket, "versioned", store.versioned)
	return store, nil
}

// preflight is the bounded startup check for the filesystem backend (spec
// §3.3.3): it proves the root can be created and accepts a write. It never
// loosens permissions or points at another directory to get past an error.
func (s *localObjectStore) preflight(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// MkdirAll both confirms the volume answers and creates a missing root;
	// an existing directory is a no-op.
	if err := os.MkdirAll(s.root, 0755); err != nil {
		return fmt.Errorf("local preflight: %w", err)
	}
	// A root that is not writable is a startup error, not a request-time
	// surprise: write a fixed-name probe file and remove it. Fixed beats
	// random here - a crash mid-probe can never leave an orphan.
	probe := filepath.Join(s.root, ".storage-preflight-probe")
	if err := os.WriteFile(probe, nil, 0644); err != nil {
		return fmt.Errorf("local preflight: root is not writable: %w", err)
	}
	_ = os.Remove(probe)
	return nil
}
