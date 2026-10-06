package storage

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// S3_KEY_PREFIX is the one environment root of every backend: FileService
// mints under it whether the selected provider is minio, s3 or local, and it
// is stored in the "x/" form.
func TestLoadConfigKeyRootForEveryBackend(t *testing.T) {
	local := func() map[string]string {
		return map[string]string{"STORAGE_BACKEND": "local", "LOCAL_UPLOAD_DIR": t.TempDir()}
	}
	cases := []struct {
		name string
		env  map[string]string
		raw  *string
		want string
	}{
		{name: "minio", env: validMinIOEnv(), raw: ptr("develop"), want: "develop/"},
		{name: "minio nested", env: validMinIOEnv(), raw: ptr("envs/develop/"), want: "envs/develop/"},
		{name: "s3", env: validS3Env(), raw: ptr("production/"), want: "production/"},
		{name: "local", env: local(), raw: ptr(" develop "), want: "develop/"},
		{name: "absent", env: validMinIOEnv(), want: ""},
		{name: "empty", env: validMinIOEnv(), raw: ptr(""), want: ""},
		{name: "blank", env: validMinIOEnv(), raw: ptr("   "), want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.raw != nil {
				tc.env["S3_KEY_PREFIX"] = *tc.raw
			}
			cfg, err := LoadConfig(allBackends(t), envLookup(tc.env))
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.KeyRoot != tc.want {
				t.Fatalf("KeyRoot = %q, want %q", cfg.KeyRoot, tc.want)
			}
		})
	}
}

// A root that could leave its folder, name another one, or spell the same
// folder two ways is a startup error, never cleaned into something else.
func TestLoadConfigRefusesUnsafeKeyRoot(t *testing.T) {
	for _, raw := range []string{
		"..", "../", "../prod", "develop/..", "develop/../production", ".", "./develop",
		"/develop", "//develop", "develop//x", "\\develop", "develop\\x", "C:/develop", "C:\\develop",
		"https://minio:9000/uniwork/develop", "s3://uniwork/develop", "develop?x", "develop#x",
		"dev elop", "develop\t/", "dev%2Fprod", "develop/\x00",
	} {
		t.Run(raw, func(t *testing.T) {
			env := validMinIOEnv()
			env["S3_KEY_PREFIX"] = raw
			_, err := LoadConfig(allBackends(t), envLookup(env))
			if !errors.Is(err, ErrConfigInvalid) {
				t.Fatalf("LoadConfig(S3_KEY_PREFIX=%q) = %v, want storage_config_invalid", raw, err)
			}
			if !strings.Contains(err.Error(), "S3_KEY_PREFIX") {
				t.Fatalf("error %q must name S3_KEY_PREFIX", err)
			}
		})
	}
}

func TestConfigValidateRefusesUnsafeKeyRoot(t *testing.T) {
	for _, root := range []string{"../", "develop", "/develop/", "a//b/"} {
		cfg := Config{Backend: BackendLocal, Local: &LocalConfig{Root: t.TempDir()}, KeyRoot: root}
		if err := cfg.Validate(); !errors.Is(err, ErrConfigInvalid) {
			t.Errorf("Validate(KeyRoot=%q) = %v, want storage_config_invalid", root, err)
		}
	}
	cfg := Config{Backend: BackendLocal, Local: &LocalConfig{Root: t.TempDir()}, KeyRoot: "develop/"}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate(develop/) = %v", err)
	}
}

// With an env root set, FileService objects live under <root>v1/ in the same
// LOCAL_UPLOAD_DIR; the unauthorized /uploads/* route refuses them however the
// path is spelled, and still refuses root-level v1/ objects written before
// the root existed.
func TestServeFileRefusesFileServiceObjectsUnderTheKeyRoot(t *testing.T) {
	dir := t.TempDir()
	legacy, ok := NewLegacyStorage(Config{Backend: BackendLocal, Local: &LocalConfig{Root: dir}, KeyRoot: "develop/"}).(*LocalStorage)
	if !ok {
		t.Fatal("NewLegacyStorage(local) is not a *LocalStorage")
	}
	write := func(key string) {
		t.Helper()
		p := filepath.Join(dir, key)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tail := "orgs/01ORG/workspaces/01WS/tasks/attachments/2026/10/01FILE/original"
	write("develop/v1/" + tail)
	write("v1/" + tail)
	write("chat/files/legacy.pdf")

	for _, key := range []string{
		"develop/v1/" + tail,
		"./develop/v1/" + tail,
		"chat/../develop/v1/" + tail,
		"develop/x/../v1/" + tail,
		"Develop/V1/" + tail,
		"DEVELOP/v1/" + tail,
		"develop/v1",
		"v1/" + tail,
		"V1/" + tail,
		"./v1/" + tail,
	} {
		rec := httptest.NewRecorder()
		legacy.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+key, nil), key)
		if rec.Code != http.StatusNotFound || rec.Body.String() == "secret" {
			t.Errorf("ServeFile(%q) = %d %q, want 404", key, rec.Code, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	legacy.ServeFile(rec, httptest.NewRequest(http.MethodGet, "/uploads/chat/files/legacy.pdf", nil), "chat/files/legacy.pdf")
	if rec.Code != http.StatusOK {
		t.Errorf("legacy object = %d, want 200", rec.Code)
	}
}

func ptr(s string) *string { return &s }
