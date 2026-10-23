package storage

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
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
		// Windows strips trailing dots from a segment, so "develop." names "develop".
		"develop.", "develop./x", "x/develop.", "...", "develop/...",
		// v1/ is the FileService boundary, never the first folder of a root.
		"v1", "v1/", "V1/x/", "v1/develop",
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
		// Windows drops trailing dots and spaces from a segment, so these open
		// the same objects there.
		"develop./v1/" + tail,
		"develop/v1./" + tail,
		"develop /v1/" + tail,
		"develop/v1 /" + tail,
		"v1./" + tail,
		"v1 /" + tail,
		"develop.../v1/" + tail,
	} {
		rec := httptest.NewRecorder()
		legacy.ServeFile(rec, httptest.NewRequest(http.MethodGet, (&url.URL{Path: "/uploads/" + key}).String(), nil), key)
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

// The guard decides on the path text alone, so it is pinned directly: on Linux
// "develop./v1/x" is another (missing) folder and ServeFile answers 404 either
// way, which would hide a guard that only works where the volume agrees.
func TestIsFileServiceKeyIgnoresTrailingDotsAndSpaces(t *testing.T) {
	s := &LocalStorage{keyRoot: "develop/"}
	for _, rel := range []string{
		"develop/v1/x", "Develop/V1/x", "v1/x", "develop/v1",
		"develop./v1/x", "develop/v1./x", "develop /v1/x", "develop/v1 /x",
		"v1./x", "v1 /x", "develop.../v1/x", "develop/. ./v1/x",
	} {
		if !s.isFileServiceKey(rel) {
			t.Errorf("isFileServiceKey(%q) = false, want true", rel)
		}
	}
	for _, rel := range []string{"chat/files/a.pdf", "avatars/a.png", "develop/chat/v1/x", "v10/x", "develop/v10/x"} {
		if s.isFileServiceKey(rel) {
			t.Errorf("isFileServiceKey(%q) = true, want false", rel)
		}
	}
}

func ptr(s string) *string { return &s }

// ParseKeyRoot is the reading every env-built helper shares with LoadConfig:
// the same stored form, and a refusal for every value LoadConfig refuses.
func TestParseKeyRootMatchesLoadConfig(t *testing.T) {
	for raw, want := range map[string]string{"": "", "  ": "", "develop": "develop/", " envs/develop/ ": "envs/develop/"} {
		got, err := ParseKeyRoot(raw)
		if err != nil || got != want {
			t.Errorf("ParseKeyRoot(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"/develop", "../", "develop.", "v1/", "https://x/develop", `develop\x`} {
		root, err := ParseKeyRoot(raw)
		if !errors.Is(err, ErrConfigInvalid) || root != "" || !strings.Contains(err.Error(), "S3_KEY_PREFIX") {
			t.Errorf("ParseKeyRoot(%q) = %q, %v; want storage_config_invalid naming S3_KEY_PREFIX", raw, root, err)
		}
	}
}

// NewLocalStorageFromEnv refuses an unsafe root as LoadConfig does instead of
// dropping it to "" (which would mint and guard keys outside the configured
// root).
func TestNewLocalStorageFromEnvRefusesAnUnsafeKeyRoot(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	t.Setenv("S3_KEY_PREFIX", "/develop")
	if store := NewLocalStorageFromEnv(); store != nil {
		t.Fatalf("NewLocalStorageFromEnv(S3_KEY_PREFIX=/develop) = %+v, want nil", store)
	}
	t.Setenv("S3_KEY_PREFIX", "develop")
	store := NewLocalStorageFromEnv()
	if store == nil || store.keyRoot != "develop/" {
		t.Fatalf("NewLocalStorageFromEnv(S3_KEY_PREFIX=develop) = %+v, want keyRoot develop/", store)
	}
}
