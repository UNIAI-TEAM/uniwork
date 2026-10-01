package service

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
)

func desktopDownloadConfig() config.Config {
	return config.Config{APIPublicURL: "https://api.example.test", OfficeInstallerStableURL: "https://downloads.example.test/office.exe", DesktopAuthClientID: "uniwork-office", DesktopAuthDeploymentIDs: []string{"default"}}
}

func TestOfficeDesktopDownloadMembershipAudit(t *testing.T) {
	f := newAuditServiceFixture(t)
	svc := NewOfficeDesktopDownloadService(f.svc.orgs, desktopDownloadConfig())
	for _, channel := range []string{"stable", "beta", "invalid"} {
		if _, err := svc.Get(f.ctx, f.ownerB.ID, f.orgA, channel); !errors.Is(err, ErrForbidden) {
			t.Fatalf("non-member channel %s: %v", channel, err)
		}
	}
	var before int
	if err := f.svc.pool.QueryRow(f.ctx, "SELECT count(*) FROM audit_events WHERE action=$1", audit.ActionOfficeDesktopDownloaded).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before != 0 {
		t.Fatalf("denied download wrote %d audits", before)
	}
	out, err := svc.Get(f.ctx, f.memberA.ID, f.orgA, "stable")
	if err != nil {
		t.Fatal(err)
	}
	if out.InstallerURL != desktopDownloadConfig().OfficeInstallerStableURL || out.ServerOrigin != "https://api.example.test" || out.ClientID != "uniwork-office" || out.DeploymentID != "default" || out.Channel != "stable" {
		t.Fatalf("profile: %+v", out)
	}
	var actor, organization, metadata string
	if err := f.svc.pool.QueryRow(f.ctx, "SELECT actor_id,organization_id,metadata FROM audit_events WHERE action=$1", audit.ActionOfficeDesktopDownloaded).Scan(&actor, &organization, &metadata); err != nil {
		t.Fatal(err)
	}
	if actor != f.memberA.ID || organization != f.orgA {
		t.Fatalf("audit scope: %s %s", actor, organization)
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(metadata), &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 2 || fields["channel"] != "stable" || fields["deployment_id"] != "default" {
		t.Fatalf("unexpected audit metadata: %v", fields)
	}
}

func TestOfficeDesktopDownloadUnsafeOrUnavailableConfig(t *testing.T) {
	f := newAuditServiceFixture(t)
	for _, test := range []struct {
		name    string
		change  func(*config.Config)
		channel string
	}{
		{"absent installer", func(c *config.Config) { c.OfficeInstallerStableURL = "" }, "stable"},
		{"unsafe scheme", func(c *config.Config) { c.OfficeInstallerStableURL = "javascript:alert(1)" }, "stable"},
		{"credentials", func(c *config.Config) { c.APIPublicURL = "https://user:secret@api.example.test" }, "stable"},
		{"non-origin", func(c *config.Config) { c.APIPublicURL = "https://api.example.test/path" }, "stable"},
		{"ambiguous deployment", func(c *config.Config) { c.DesktopAuthDeploymentIDs = []string{"one", "two"} }, "stable"},
		{"wrong client", func(c *config.Config) { c.DesktopAuthClientID = "uniwork-office-dev" }, "stable"},
		{"wrong channel", func(_ *config.Config) {}, "invalid"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := desktopDownloadConfig()
			test.change(&cfg)
			if _, err := NewOfficeDesktopDownloadService(f.svc.orgs, cfg).Get(f.ctx, f.ownerA.ID, f.orgA, test.channel); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	cfg := desktopDownloadConfig()
	cfg.DesktopAuthClientID = "uniwork-office-dev"
	cfg.OfficeInstallerDevURL = "http://127.0.0.1:12345/office.exe"
	cfg.APIPublicURL = "http://localhost:8080"
	if _, err := NewOfficeDesktopDownloadService(f.svc.orgs, cfg).Get(f.ctx, f.ownerA.ID, f.orgA, "dev"); err != nil {
		t.Fatalf("loopback dev profile: %v", err)
	}
}
