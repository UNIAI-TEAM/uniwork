package config

import (
	"strings"
	"testing"
)

func TestParseMobileVersion(t *testing.T) {
	for raw, want := range map[string]string{
		"":          "",
		"   ":       "",
		"0.3.0":     "0.3.0",
		" 1.12.40 ": "1.12.40",
	} {
		got, err := parseMobileVersion(raw)
		if err != nil || got != want {
			t.Errorf("parseMobileVersion(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"0.3", "v0.3.0", "0.3.0-beta", "01.2.3", "1.2.3.4", "a.b.c", "1..2"} {
		if got, err := parseMobileVersion(raw); err == nil {
			t.Errorf("parseMobileVersion(%q) = %q, want an error", raw, got)
		}
	}
}

// A malformed minimum would switch the gate off without a word: the load fails instead.
func TestLoadRefusesAMalformedMobileMinVersion(t *testing.T) {
	setRequired(t)
	t.Setenv("UNICHAT_MOBILE_MIN_SUPPORTED_VERSION", "0.3")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "UNICHAT_MOBILE_MIN_SUPPORTED_VERSION") {
		t.Fatalf("Load() error = %v, want one naming UNICHAT_MOBILE_MIN_SUPPORTED_VERSION", err)
	}
	t.Setenv("UNICHAT_MOBILE_MIN_SUPPORTED_VERSION", "0.3.0")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.UniChatMobileMinVersion != "0.3.0" {
		t.Fatalf("UniChatMobileMinVersion = %q, want 0.3.0", cfg.UniChatMobileMinVersion)
	}
}

// The soft nudge has the same shape as the gate: a typo would quietly stop telling people a new version is out.
func TestLoadRefusesAMalformedMobileRecommendedVersion(t *testing.T) {
	setRequired(t)
	t.Setenv("UNICHAT_MOBILE_RECOMMENDED_VERSION", "latest")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "UNICHAT_MOBILE_RECOMMENDED_VERSION") {
		t.Fatalf("Load() error = %v, want one naming UNICHAT_MOBILE_RECOMMENDED_VERSION", err)
	}
	t.Setenv("UNICHAT_MOBILE_RECOMMENDED_VERSION", " 0.3.1 ")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.UniChatMobileRecommendedVersion != "0.3.1" {
		t.Fatalf("UniChatMobileRecommendedVersion = %q, want 0.3.1", cfg.UniChatMobileRecommendedVersion)
	}
}
