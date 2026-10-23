package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFileSkipsExisting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	const probeKey = "UNIWORK_ENVFILE_TEST_KEY"
	if err := os.WriteFile(path, []byte(probeKey+"=from-file\nPORT=9090\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(probeKey, "")
	t.Setenv("PORT", "8080")
	if !loadEnvFile(path) {
		t.Fatal("expected loadEnvFile to succeed")
	}
	if got := os.Getenv(probeKey); got != "from-file" {
		t.Fatalf("expected key from file, got %q", got)
	}
	if got := os.Getenv("PORT"); got != "8080" {
		t.Fatalf("expected existing PORT unchanged, got %q", got)
	}
}

func TestLoadEnvFileQuotedValuesAndComments(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	content := "# comment\n\n" +
		"UNIWORK_ENVFILE_QUOTED=\"hello world\"\n" +
		"UNIWORK_ENVFILE_SINGLE='single'\n" +
		"bad-line\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("UNIWORK_ENVFILE_QUOTED", "")
	t.Setenv("UNIWORK_ENVFILE_SINGLE", "")
	if !loadEnvFile(path) {
		t.Fatal("expected loadEnvFile to succeed")
	}
	if got := os.Getenv("UNIWORK_ENVFILE_QUOTED"); got != "hello world" {
		t.Fatalf("double-quoted value: %q", got)
	}
	if got := os.Getenv("UNIWORK_ENVFILE_SINGLE"); got != "single" {
		t.Fatalf("single-quoted value: %q", got)
	}
}

func TestLoadEnvFileMissing(t *testing.T) {
	if loadEnvFile(filepath.Join(t.TempDir(), "missing.env")) {
		t.Fatal("expected missing file to return false")
	}
}

func TestTryLoadDevEnvSkipsProduction(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("EMAIL_HUB_CREDENTIAL_KEY=blocked\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	origWD, _ := os.Getwd()
	t.Cleanup(func() { _ = os.Chdir(origWD) })
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_ENV", "production")
	os.Unsetenv("EMAIL_HUB_CREDENTIAL_KEY")
	tryLoadDevEnv()
	if got := os.Getenv("EMAIL_HUB_CREDENTIAL_KEY"); got != "" {
		t.Fatalf("production must not load .env, got %q", got)
	}
}
