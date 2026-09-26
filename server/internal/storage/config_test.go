package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// stubFactory is a Factory that never builds anything: the loader and registry
// tests care about wiring, not about adapters.
type stubFactory struct {
	backend Backend
}

func (f stubFactory) Backend() Backend { return f.backend }

func (f stubFactory) New(context.Context, Config) (Storage, error) {
	return nil, errors.New("stubFactory.New is not implemented")
}

// envLookup turns a map into an EnvLookup, so map membership is exactly env
// presence: a key mapped to "" is declared but empty, a missing key is absent.
func envLookup(env map[string]string) EnvLookup {
	return func(key string) (string, bool) {
		value, ok := env[key]
		return value, ok
	}
}

// registryFor builds a registry holding a stub factory for every given code.
func registryFor(t *testing.T, codes ...Backend) *Registry {
	t.Helper()
	registry := NewRegistry()
	for _, code := range codes {
		if err := registry.Register(stubFactory{backend: code}); err != nil {
			t.Fatalf("register stub factory for %q: %v", code, err)
		}
	}
	return registry
}

// allBackends is the registry a full deployment would have: every enum code
// has a factory.
func allBackends(t *testing.T) *Registry {
	t.Helper()
	return registryFor(t, BackendLocal, BackendS3, BackendMinIO)
}

func validMinIOEnv() map[string]string {
	return map[string]string{
		"STORAGE_BACKEND":         "minio",
		"MINIO_ENDPOINT":          "http://minio:9000",
		"MINIO_BUCKET":            "uniwork",
		"MINIO_ACCESS_KEY_ID":     "minio-access-key",
		"MINIO_SECRET_ACCESS_KEY": "minio-secret-key",
		"MINIO_REGION":            "us-east-1",
	}
}

func validS3Env() map[string]string {
	return map[string]string{
		"STORAGE_BACKEND":       "s3",
		"S3_BUCKET":             "uniwork-media",
		"S3_REGION":             "us-east-1",
		"AWS_ACCESS_KEY_ID":     "aws-access-key",
		"AWS_SECRET_ACCESS_KEY": "aws-secret-key",
	}
}

func TestLoadConfigDefaultsToMinIO(t *testing.T) {
	env := validMinIOEnv()
	delete(env, "STORAGE_BACKEND")

	cfg, err := LoadConfig(registryFor(t, BackendMinIO), envLookup(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Backend != BackendMinIO {
		t.Fatalf("Backend = %q, want %q", cfg.Backend, BackendMinIO)
	}
	if cfg.Local != nil || cfg.S3 != nil {
		t.Fatalf("undeclared groups must stay nil, got local=%v s3=%v", cfg.Local, cfg.S3)
	}
	if cfg.MinIO == nil {
		t.Fatal("MinIO config is nil")
	}
	if cfg.MinIO.Endpoint != "http://minio:9000" || cfg.MinIO.Bucket != "uniwork" ||
		cfg.MinIO.Region != "us-east-1" || cfg.MinIO.AccessKeyID != "minio-access-key" ||
		cfg.MinIO.SecretAccessKey != "minio-secret-key" {
		t.Fatalf("MinIO config mismatch: %+v", *cfg.MinIO)
	}
}

func TestLoadConfigSelectorRules(t *testing.T) {
	cases := []struct {
		name     string
		env      map[string]string
		registry *Registry
		want     Backend
		wantErr  error
	}{
		{
			name:     "trimmed and lowercased code is accepted",
			env:      map[string]string{"STORAGE_BACKEND": "  MiNiO  ", "MINIO_ENDPOINT": "http://minio:9000", "MINIO_BUCKET": "uniwork", "MINIO_ACCESS_KEY_ID": "a", "MINIO_SECRET_ACCESS_KEY": "b", "MINIO_REGION": "us-east-1"},
			registry: registryFor(t, BackendMinIO),
			want:     BackendMinIO,
		},
		{
			name:     "declared but empty is invalid",
			env:      map[string]string{"STORAGE_BACKEND": ""},
			registry: registryFor(t, BackendLocal, BackendS3, BackendMinIO),
			wantErr:  ErrConfigInvalid,
		},
		{
			name:     "whitespace only is invalid",
			env:      map[string]string{"STORAGE_BACKEND": "   "},
			registry: registryFor(t, BackendLocal, BackendS3, BackendMinIO),
			wantErr:  ErrConfigInvalid,
		},
		{
			name:     "code outside the enum is unsupported",
			env:      map[string]string{"STORAGE_BACKEND": "gcs"},
			registry: registryFor(t, BackendLocal, BackendS3, BackendMinIO),
			wantErr:  ErrTypeUnsupported,
		},
		{
			name:     "code in the enum without a factory is not implemented",
			env:      validMinIOEnv(),
			registry: registryFor(t, BackendLocal, BackendS3),
			wantErr:  ErrAdapterNotImplemented,
		},
		{
			name:     "empty registry is not implemented before field errors",
			env:      map[string]string{},
			registry: NewRegistry(),
			wantErr:  ErrAdapterNotImplemented,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadConfig(tc.registry, envLookup(tc.env))
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("error = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.Backend != tc.want {
				t.Fatalf("Backend = %q, want %q", cfg.Backend, tc.want)
			}
		})
	}
}

func TestLoadConfigMinIORequiresEveryField(t *testing.T) {
	required := []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	}

	for _, key := range required {
		for _, blank := range []string{"missing", "blank"} {
			t.Run(key+"/"+blank, func(t *testing.T) {
				env := validMinIOEnv()
				if blank == "missing" {
					delete(env, key)
				} else {
					env[key] = "   "
				}

				_, err := LoadConfig(allBackends(t), envLookup(env))
				if !errors.Is(err, ErrConfigInvalid) {
					t.Fatalf("error = %v, want storage_config_invalid", err)
				}
				if !strings.Contains(err.Error(), key) {
					t.Fatalf("error %q must name %s", err, key)
				}
			})
		}
	}
}

func TestLoadConfigMinIOReportsEveryProblemAtOnce(t *testing.T) {
	env := map[string]string{"STORAGE_BACKEND": "minio"}

	_, err := LoadConfig(allBackends(t), envLookup(env))
	if !errors.Is(err, ErrConfigInvalid) {
		t.Fatalf("error = %v, want storage_config_invalid", err)
	}
	for _, key := range []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("error %q must name every missing variable, missing %s", err, key)
		}
	}
}

func TestLoadConfigMinIORejectsMalformedValues(t *testing.T) {
	cases := []struct {
		key   string
		value string
	}{
		{"MINIO_ENDPOINT", "minio:9000"},
		{"MINIO_ENDPOINT", "ftp://minio:9000"},
		{"MINIO_ENDPOINT", "http://user:pass@minio:9000"},
		{"MINIO_ENDPOINT", "http://minio:9000/uniwork"},
		{"MINIO_ENDPOINT", "http://minio:9000?region=us-east-1"},
		{"MINIO_ENDPOINT", "http://minio:9000#console"},
		{"MINIO_BUCKET", "http://minio:9000/uniwork"},
		{"MINIO_BUCKET", "uniwork/chat"},
		{"MINIO_BUCKET", "uniwork.s3.us-east-1.amazonaws.com"},
		{"MINIO_REGION", "us east 1"},
		{"MINIO_REGION", "us-east-1/"},
		{"MINIO_PUBLIC_ENDPOINT", "localhost:9000"},
	}

	for _, tc := range cases {
		t.Run(tc.key+"="+tc.value, func(t *testing.T) {
			env := validMinIOEnv()
			env[tc.key] = tc.value

			_, err := LoadConfig(allBackends(t), envLookup(env))
			if !errors.Is(err, ErrConfigInvalid) {
				t.Fatalf("error = %v, want storage_config_invalid", err)
			}
			if !strings.Contains(err.Error(), tc.key) {
				t.Fatalf("error %q must name %s", err, tc.key)
			}
		})
	}
}

func TestLoadConfigMinIONeverFallsBackToAWSCredentials(t *testing.T) {
	env := validMinIOEnv()
	delete(env, "MINIO_ACCESS_KEY_ID")
	delete(env, "MINIO_SECRET_ACCESS_KEY")
	env["AWS_ACCESS_KEY_ID"] = "aws-access-key"
	env["AWS_SECRET_ACCESS_KEY"] = "aws-secret-key"

	_, err := LoadConfig(allBackends(t), envLookup(env))
	if !errors.Is(err, ErrConfigInvalid) {
		t.Fatalf("error = %v, want storage_config_invalid", err)
	}
	for _, key := range []string{"MINIO_ACCESS_KEY_ID", "MINIO_SECRET_ACCESS_KEY"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("error %q must name %s: AWS credentials are not a MinIO fallback", err, key)
		}
	}
	if strings.Contains(err.Error(), "aws-access-key") {
		t.Fatalf("error %q must not echo credential values", err)
	}
}

func TestLoadConfigErrorsNeverEchoSecrets(t *testing.T) {
	const secret = "super-secret-value"
	const accessKey = "shared-access-key"

	cases := []struct {
		name string
		env  map[string]string
	}{
		{
			name: "minio",
			env: map[string]string{
				"STORAGE_BACKEND":         "minio",
				"MINIO_ENDPOINT":          "minio:9000",
				"MINIO_BUCKET":            "uniwork",
				"MINIO_ACCESS_KEY_ID":     accessKey,
				"MINIO_SECRET_ACCESS_KEY": secret,
				"MINIO_REGION":            "us-east-1",
			},
		},
		{
			name: "s3",
			env: map[string]string{
				"STORAGE_BACKEND":       "s3",
				"S3_BUCKET":             "uniwork-media",
				"S3_REGION":             "",
				"AWS_ACCESS_KEY_ID":     accessKey,
				"AWS_SECRET_ACCESS_KEY": secret,
				"AWS_ENDPOINT_URL":      "s3.example.com",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadConfig(allBackends(t), envLookup(tc.env))
			if err == nil {
				t.Fatal("expected an error")
			}
			if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), accessKey) {
				t.Fatalf("error %q must not echo credentials", err)
			}
		})
	}
}

func TestLoadConfigS3Group(t *testing.T) {
	t.Run("explicit pair", func(t *testing.T) {
		env := validS3Env()
		env["S3_KEY_PREFIX"] = "/production"
		env["AWS_ENDPOINT_URL"] = "https://s3.example.com"

		cfg, err := LoadConfig(allBackends(t), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.S3 == nil || cfg.S3.Bucket != "uniwork-media" || cfg.S3.Region != "us-east-1" {
			t.Fatalf("S3 config mismatch: %+v", cfg.S3)
		}
		if cfg.S3.KeyPrefix != "production/" {
			t.Fatalf("KeyPrefix = %q, want production/", cfg.S3.KeyPrefix)
		}
		if cfg.S3.AccessKeyID != "aws-access-key" || cfg.S3.SecretAccessKey != "aws-secret-key" {
			t.Fatal("static pair must be carried through")
		}
		if cfg.MinIO != nil || cfg.Local != nil {
			t.Fatalf("undeclared groups must stay nil, got minio=%v local=%v", cfg.MinIO, cfg.Local)
		}
	})

	t.Run("no credentials keeps the SDK chain", func(t *testing.T) {
		env := validS3Env()
		delete(env, "AWS_ACCESS_KEY_ID")
		delete(env, "AWS_SECRET_ACCESS_KEY")

		cfg, err := LoadConfig(allBackends(t), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.S3.AccessKeyID != "" || cfg.S3.SecretAccessKey != "" || cfg.S3.SessionToken != "" {
			t.Fatalf("S3 config must stay empty for the credential chain: %+v", *cfg.S3)
		}
	})

	t.Run("half a pair is invalid", func(t *testing.T) {
		env := validS3Env()
		delete(env, "AWS_SECRET_ACCESS_KEY")

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "AWS_SECRET_ACCESS_KEY") {
			t.Fatalf("error %q must name the missing half", err)
		}
	})

	t.Run("session token needs the static pair", func(t *testing.T) {
		env := validS3Env()
		delete(env, "AWS_ACCESS_KEY_ID")
		delete(env, "AWS_SECRET_ACCESS_KEY")
		env["AWS_SESSION_TOKEN"] = "session-token"

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "AWS_SESSION_TOKEN") {
			t.Fatalf("error %q must name AWS_SESSION_TOKEN", err)
		}
	})

	t.Run("missing bucket or region is invalid", func(t *testing.T) {
		for _, key := range []string{"S3_BUCKET", "S3_REGION"} {
			env := validS3Env()
			delete(env, key)

			_, err := LoadConfig(allBackends(t), envLookup(env))
			if !errors.Is(err, ErrConfigInvalid) {
				t.Fatalf("error = %v, want storage_config_invalid", err)
			}
			if !strings.Contains(err.Error(), key) {
				t.Fatalf("error %q must name %s", err, key)
			}
		}
	})

	t.Run("endpoint must be absolute", func(t *testing.T) {
		env := validS3Env()
		env["AWS_ENDPOINT_URL"] = "s3.example.com"

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "AWS_ENDPOINT_URL") {
			t.Fatalf("error %q must name AWS_ENDPOINT_URL", err)
		}
	})
}

func TestLoadConfigGroupsAreIndependent(t *testing.T) {
	t.Run("declared s3 group is validated next to minio", func(t *testing.T) {
		env := validMinIOEnv()
		env["S3_BUCKET"] = "uniwork-media"
		env["S3_REGION"] = "us-east-1"

		cfg, err := LoadConfig(allBackends(t), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.MinIO == nil || cfg.S3 == nil {
			t.Fatalf("both declared groups must be present: minio=%v s3=%v", cfg.MinIO, cfg.S3)
		}
		if cfg.Backend != BackendMinIO {
			t.Fatalf("Backend = %q, want minio", cfg.Backend)
		}
	})

	t.Run("declared s3 group without a factory is not implemented", func(t *testing.T) {
		env := validMinIOEnv()
		env["S3_BUCKET"] = "uniwork-media"

		_, err := LoadConfig(registryFor(t, BackendMinIO), envLookup(env))
		if !errors.Is(err, ErrAdapterNotImplemented) {
			t.Fatalf("error = %v, want storage_adapter_not_implemented", err)
		}
	})

	t.Run("declared s3 group with a bad field is invalid", func(t *testing.T) {
		env := validMinIOEnv()
		env["S3_BUCKET"] = "uniwork-media"

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "S3_REGION") {
			t.Fatalf("error %q must name S3_REGION", err)
		}
	})

	t.Run("aws credentials alone do not declare s3", func(t *testing.T) {
		env := validMinIOEnv()
		env["AWS_ACCESS_KEY_ID"] = "aws-access-key"
		env["AWS_SECRET_ACCESS_KEY"] = "aws-secret-key"

		cfg, err := LoadConfig(registryFor(t, BackendMinIO), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.S3 != nil {
			t.Fatalf("S3 group must stay undeclared, got %+v", *cfg.S3)
		}
	})

	t.Run("minio identifiers do not creep into s3 settings", func(t *testing.T) {
		env := validS3Env()
		env["MINIO_ENDPOINT"] = "http://minio:9000"

		_, err := LoadConfig(registryFor(t, BackendS3), envLookup(env))
		if !errors.Is(err, ErrAdapterNotImplemented) {
			t.Fatalf("error = %v, want storage_adapter_not_implemented for the declared minio group", err)
		}
	})
}

func TestLoadConfigLocalGroup(t *testing.T) {
	t.Run("root is explicit and absolute", func(t *testing.T) {
		env := map[string]string{
			"STORAGE_BACKEND":       "local",
			"LOCAL_UPLOAD_DIR":      "./data/uploads",
			"LOCAL_UPLOAD_BASE_URL": "http://localhost:8080/",
		}

		cfg, err := LoadConfig(allBackends(t), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.Local == nil {
			t.Fatal("local config is nil")
		}
		if !filepath.IsAbs(cfg.Local.Root) {
			t.Fatalf("Root = %q, want an absolute path", cfg.Local.Root)
		}
		if filepath.Base(cfg.Local.Root) != "uploads" {
			t.Fatalf("Root = %q, want it to end in data/uploads", cfg.Local.Root)
		}
		if cfg.Local.BaseURL != "http://localhost:8080/" {
			t.Fatalf("BaseURL = %q", cfg.Local.BaseURL)
		}
	})

	t.Run("missing root is invalid", func(t *testing.T) {
		_, err := LoadConfig(allBackends(t), envLookup(map[string]string{"STORAGE_BACKEND": "local"}))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "LOCAL_UPLOAD_DIR") {
			t.Fatalf("error %q must name LOCAL_UPLOAD_DIR: there is no implicit default", err)
		}
	})

	t.Run("root must not look like an endpoint or bucket", func(t *testing.T) {
		for _, root := range []string{
			"http://localhost:9000/uniwork",
			"s3://uniwork-media/avatars",
			"minio:9000",
			"localhost:9000",
		} {
			t.Run(root, func(t *testing.T) {
				env := map[string]string{"STORAGE_BACKEND": "local", "LOCAL_UPLOAD_DIR": root}

				_, err := LoadConfig(allBackends(t), envLookup(env))
				if !errors.Is(err, ErrConfigInvalid) {
					t.Fatalf("error = %v, want storage_config_invalid", err)
				}
				if !strings.Contains(err.Error(), "LOCAL_UPLOAD_DIR") {
					t.Fatalf("error %q must name LOCAL_UPLOAD_DIR", err)
				}
			})
		}
	})

	t.Run("invalid base url is rejected", func(t *testing.T) {
		env := map[string]string{
			"STORAGE_BACKEND":       "local",
			"LOCAL_UPLOAD_DIR":      "./data/uploads",
			"LOCAL_UPLOAD_BASE_URL": "localhost:8080",
		}

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "LOCAL_UPLOAD_BASE_URL") {
			t.Fatalf("error %q must name LOCAL_UPLOAD_BASE_URL", err)
		}
	})

	t.Run("declared local root is validated next to minio", func(t *testing.T) {
		env := validMinIOEnv()
		env["LOCAL_UPLOAD_DIR"] = "minio:9000"

		_, err := LoadConfig(allBackends(t), envLookup(env))
		if !errors.Is(err, ErrConfigInvalid) {
			t.Fatalf("error = %v, want storage_config_invalid", err)
		}
		if !strings.Contains(err.Error(), "LOCAL_UPLOAD_DIR") {
			t.Fatalf("error %q must name LOCAL_UPLOAD_DIR", err)
		}
	})

	t.Run("base url alone does not declare local", func(t *testing.T) {
		env := validMinIOEnv()
		env["LOCAL_UPLOAD_BASE_URL"] = "http://localhost:8080"

		cfg, err := LoadConfig(registryFor(t, BackendMinIO), envLookup(env))
		if err != nil {
			t.Fatalf("LoadConfig: %v", err)
		}
		if cfg.Local != nil {
			t.Fatalf("local group must stay undeclared, got %+v", *cfg.Local)
		}
	})
}

func TestLoadConfigDoesNotTouchTheFilesystem(t *testing.T) {
	root := filepath.Join(t.TempDir(), "uploads-not-created")
	env := map[string]string{"STORAGE_BACKEND": "local", "LOCAL_UPLOAD_DIR": root}

	cfg, err := LoadConfig(allBackends(t), envLookup(env))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Local.Root != root {
		t.Fatalf("Root = %q, want %q", cfg.Local.Root, root)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("loading a config must not create the local root, stat err = %v", err)
	}
}

func TestConfigValidateHandBuilt(t *testing.T) {
	if err := (Config{Backend: BackendMinIO}).Validate(); !errors.Is(err, ErrConfigInvalid) {
		t.Fatalf("error = %v, want storage_config_invalid for a missing selected group", err)
	}
	if err := (Config{Backend: Backend("gcs")}).Validate(); !errors.Is(err, ErrTypeUnsupported) {
		t.Fatalf("error = %v, want storage_type_unsupported", err)
	}
	if err := (Config{Backend: BackendLocal, Local: &LocalConfig{Root: t.TempDir()}}).Validate(); err != nil {
		t.Fatalf("valid local config rejected: %v", err)
	}
	if err := (Config{Backend: BackendS3, S3: &S3Config{Bucket: "uniwork-media", Region: "us-east-1"}}).Validate(); err != nil {
		t.Fatalf("valid s3 config rejected: %v", err)
	}
	if err := (Config{
		Backend: BackendS3,
		S3:      &S3Config{Bucket: "uniwork-media", Region: "us-east-1"},
		MinIO:   &MinIOConfig{Endpoint: "http://minio:9000", Bucket: "uniwork"},
	}).Validate(); !errors.Is(err, ErrConfigInvalid) {
		t.Fatalf("error = %v, want storage_config_invalid for a declared but incomplete minio group", err)
	}
}
