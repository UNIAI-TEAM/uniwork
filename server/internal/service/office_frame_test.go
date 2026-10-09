package service

import (
	"strings"
	"testing"
	"time"
)

// The token checks need no database: a zero DocumentService is enough for
// sign/verify, which never reach it.
func newFrameSignerForTest(t *testing.T, now *time.Time) *OfficeFrameService {
	t.Helper()
	s := NewOfficeFrameService(&DocumentService{}, "office-frame-test-secret-0123456789abcdef")
	s.SetClock(func() time.Time { return *now })
	return s
}

func TestOfficeFrameTokenVerifiesOnlyItsOwnUntamperedUnexpiredClaims(t *testing.T) {
	now := time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u", ExpiresAt: now.Add(OfficeFrameTokenTTL).UnixMilli(), Nonce: "n"}
	token, err := s.sign(officeFrameTokenPrefix, claims)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Verify(token)
	if err != nil || got != claims {
		t.Fatalf("Verify = %+v, %v", got, err)
	}

	payload, sig, _ := strings.Cut(strings.TrimPrefix(token, officeFrameTokenPrefix), ".")
	other := NewOfficeFrameService(&DocumentService{}, "another-secret-0123456789abcdef-xyz")
	forged, _ := other.sign(officeFrameTokenPrefix, claims)
	for name, bad := range map[string]string{
		"empty":            "",
		"no prefix":        payload + "." + sig,
		"asset prefix":     officeFrameAssetPrefix + payload + "." + sig,
		"tampered payload": officeFrameTokenPrefix + payload + "x." + sig,
		"tampered mac":     officeFrameTokenPrefix + payload + "." + sig[:len(sig)-2] + "AA",
		"other key":        forged,
	} {
		if _, err := s.Verify(bad); err == nil {
			t.Errorf("%s: Verify accepted %q", name, bad)
		}
	}

	now = now.Add(OfficeFrameTokenTTL)
	if _, err := s.Verify(token); err == nil {
		t.Fatal("Verify accepted an expired token")
	}
}

func TestOfficeFrameAssetSignatureNamesOneAsset(t *testing.T) {
	now := time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u"}
	signed, err := s.SignAsset(claims, "asset")
	if err != nil {
		t.Fatal(err)
	}
	sig := signed.URL[strings.Index(signed.URL, "?sig=")+len("?sig="):]
	got, err := s.VerifyAsset(sig, "doc", "asset")
	if err != nil || got.UserID != "u" || got.WorkspaceID != "ws" || got.OrganizationID != "org" {
		t.Fatalf("VerifyAsset = %+v, %v", got, err)
	}
	for _, c := range [][2]string{{"doc", "other"}, {"other", "asset"}} {
		if _, err := s.VerifyAsset(sig, c[0], c[1]); err == nil {
			t.Errorf("VerifyAsset accepted %v", c)
		}
	}
	// An image signature is not a frame token.
	if _, err := s.Verify(sig); err == nil {
		t.Fatal("Verify accepted an asset signature")
	}
	now = now.Add(OfficeFrameTokenTTL)
	if _, err := s.VerifyAsset(sig, "doc", "asset"); err == nil {
		t.Fatal("VerifyAsset accepted an expired signature")
	}
}

// The module claim: absent is docs (tokens minted before modules existed keep
// working and keep meaning docs), a module is carried as m, and neither an
// unknown module nor an explicit "docs" spelling passes.
func TestOfficeFrameTokenModuleClaim(t *testing.T) {
	now := time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	base := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u", ExpiresAt: now.Add(OfficeFrameTokenTTL).UnixMilli(), Nonce: "n"}

	// A token signed from the pre-module claim shape: no "m" key at all.
	legacy, err := s.sign(officeFrameTokenPrefix, struct {
		Version        int    `json:"v"`
		DocumentID     string `json:"d"`
		WorkspaceID    string `json:"w"`
		OrganizationID string `json:"o"`
		UserID         string `json:"u"`
		ExpiresAt      int64  `json:"e"`
		Nonce          string `json:"n"`
	}{1, "doc", "ws", "org", "u", base.ExpiresAt, "n"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Verify(legacy)
	if err != nil || got.Module != "" || got.ModuleName() != OfficeFrameModuleDocs {
		t.Fatalf("legacy token = %+v (%q), %v", got, got.ModuleName(), err)
	}

	for _, m := range []string{OfficeFrameModulePDF, OfficeFrameModuleMarkdown, OfficeFrameModuleHTML, OfficeFrameModuleSlides, OfficeFrameModuleSheets} {
		c := base
		c.Module = m
		token, _ := s.sign(officeFrameTokenPrefix, c)
		got, err := s.Verify(token)
		if err != nil || got.ModuleName() != m {
			t.Errorf("%s token = %+v, %v", m, got, err)
		}
	}
	for _, m := range []string{"docs", "xls", "Docs", "pdf "} {
		c := base
		c.Module = m
		token, _ := s.sign(officeFrameTokenPrefix, c)
		if _, err := s.Verify(token); err == nil {
			t.Errorf("Verify accepted module %q", m)
		}
	}
}

func TestOfficeFrameModuleIsDerivedFromTheStoredFormat(t *testing.T) {
	const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	for _, c := range []struct {
		mime, name, want string
	}{
		{docxMime, "plan.docx", "docs"},
		{docxMime, "", "docs"},
		{"application/zip", "plan.DOCX", "docs"},
		{"application/pdf", "a.pdf", "pdf"},
		{"application/pdf", "", "pdf"},
		{"text/plain", "notes.md", "markdown"},
		{"text/markdown; charset=utf-8", "notes", "markdown"},
		{"text/html", "page.htm", "html"},
		{"application/zip", "deck.pptx", "slides"},
		{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "", "sheets"},
		{"application/vnd.ms-excel", "old.xls", ""},
		{"application/vnd.oasis.opendocument.text", "a.odt", ""},
		{"text/plain", "a.txt", ""},
		{"image/png", "a.png", ""},
	} {
		got, ok := officeFrameModuleOf(c.mime, c.name)
		if got != c.want || ok != (c.want != "") {
			t.Errorf("officeFrameModuleOf(%q, %q) = %q, %v; want %q", c.mime, c.name, got, ok, c.want)
		}
		if ok {
			if _, flagged := OfficeFrameModuleFlag(got); !flagged {
				t.Errorf("module %q has no flag", got)
			}
		}
	}
}
