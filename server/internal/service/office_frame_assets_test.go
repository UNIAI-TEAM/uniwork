package service

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestOfficeFrameLinkedSignatureNamesOneFile(t *testing.T) {
	now := time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)
	s := newFrameSignerForTest(t, &now)
	claims := OfficeFrameClaims{Version: 1, DocumentID: "doc", WorkspaceID: "ws", OrganizationID: "org", UserID: "u", Module: OfficeFrameModuleHTML}
	signed, err := s.SignLinked(claims, "css")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(signed.URL, "/api/v1/office-frame/documents/doc/linked/css?sig="+officeFrameLinkedPrefix) {
		t.Fatalf("url = %q", signed.URL)
	}
	sig := signed.URL[strings.Index(signed.URL, "?sig=")+len("?sig="):]
	got, err := s.VerifyLinked(sig, "doc", "css")
	if err != nil || got.UserID != "u" || got.ModuleName() != OfficeFrameModuleHTML || got.WorkspaceID != "ws" {
		t.Fatalf("VerifyLinked = %+v, %v", got, err)
	}
	for _, c := range [][2]string{{"doc", "other"}, {"other", "css"}} {
		if _, err := s.VerifyLinked(sig, c[0], c[1]); err == nil {
			t.Errorf("VerifyLinked accepted %v", c)
		}
	}
	// Neither an image signature nor a frame token, and the reverse.
	if _, err := s.VerifyAsset(sig, "doc", "css"); err == nil {
		t.Fatal("VerifyAsset accepted a linked signature")
	}
	if _, err := s.Verify(sig); err == nil {
		t.Fatal("Verify accepted a linked signature")
	}
	asset, _ := s.SignAsset(claims, "css")
	if _, err := s.VerifyLinked(asset.URL[strings.Index(asset.URL, "?sig=")+len("?sig="):], "doc", "css"); err == nil {
		t.Fatal("VerifyLinked accepted an image signature")
	}
	// Only the Markdown and HTML frames load siblings: a signature naming any
	// other module, the explicit docs spelling or none is not one the server issued.
	for _, m := range []string{"", OfficeFrameModuleDocs, OfficeFrameModulePDF, OfficeFrameModuleSlides, OfficeFrameModuleSheets, "word"} {
		forged, err := s.sign(officeFrameLinkedPrefix, officeFrameLinkedClaims{DocumentID: "doc", LinkedID: "css", WorkspaceID: "ws",
			OrganizationID: "org", UserID: "u", ExpiresAt: now.Add(time.Minute).UnixMilli(), Module: m})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.VerifyLinked(forged, "doc", "css"); err == nil {
			t.Errorf("VerifyLinked accepted module %q", m)
		}
	}
	// Markdown signs too, for the hour the HTML one lives.
	claims.Module = OfficeFrameModuleMarkdown
	md, err := s.SignLinked(claims, "css")
	if err != nil {
		t.Fatal(err)
	}
	if !md.ExpiresAt.Equal(now.Add(OfficeFrameAssetURLTTL)) {
		t.Fatalf("markdown sibling URL expires %v, want %v", md.ExpiresAt, now.Add(OfficeFrameAssetURLTTL))
	}
	now = now.Add(OfficeFrameAssetURLTTL)
	if _, err := s.VerifyLinked(sig, "doc", "css"); err == nil {
		t.Fatal("VerifyLinked accepted an expired signature")
	}
}

func TestOfficeFramePathSegments(t *testing.T) {
	for raw, want := range map[string][]string{
		"logo.png":               {"logo.png"},
		"./assets/a.png":         {"assets", "a.png"},
		"img/./b%20c.webp?v=2#x": {"img", "b c.webp"},
		"../up/x.svg":            {"..", "up", "x.svg"},
		" style.css ":            {"style.css"},
	} {
		got, ok := officeFramePathSegments(raw)
		if !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("%q = %v %v, want %v", raw, got, ok, want)
		}
	}
	for _, raw := range []string{
		"", "/abs.png", "//cdn.example/x.png", "https://x/y.png", "data:image/png;base64,AA", "c:/x.png",
		`a\b.png`, "a//b.png", "..", "a/..", "%zz.png", "a%0a.png", "#only", "?q", strings.Repeat("a", 600) + ".png",
		strings.Repeat("d/", 20) + "x.png",
	} {
		if got, ok := officeFramePathSegments(raw); ok {
			t.Errorf("%q accepted as %v", raw, got)
		}
	}
}

func TestOfficeFrameRefsFindRelativeLoads(t *testing.T) {
	md := "# T\n![a](assets/a.png) ![b](<img/b c.webp> \"t\")\n[ref]: ./c.svg\n![r][ref]\n" +
		"[link](other.md) ![remote](https://x/y.png) ![d](data:image/png;base64,AA)\n" +
		`<img src="e.gif" srcset="f.png 1x, g.png 2x"><link rel=stylesheet href=site.css>` +
		"<script src='app.js'></script><style>@import \"more.css\"; .x{background:url( 'bg.jpg' )}</style>\n" +
		"![dup](assets/a.png) <a href=\"page.html\">p</a> <img src=\"/abs.png\">"
	got := officeFrameRefs(md)
	want := []string{"assets/a.png", "./c.svg", "e.gif", "f.png", "g.png", "site.css", "app.js", "more.css", "bg.jpg"}
	// "img/b c.webp" has a space and is written in <...>; the scan keeps the
	// first token only, so it is not a loadable reference here.
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("refs = %v\nwant   %v", got, want)
	}
	many := strings.Repeat("![x](p.png)", 3)
	for i := 0; i < 300; i++ {
		many += "![x](p" + strings.Repeat("q", i%5) + string(rune('a'+i%26)) + ".png)"
	}
	if n := len(officeFrameRefs(many)); n > officeFrameMaxRefs {
		t.Fatalf("refs = %d, want at most %d", n, officeFrameMaxRefs)
	}
}

func TestOfficeFrameLinkedTypes(t *testing.T) {
	for _, c := range []struct {
		name, stored, want string
		ok                 bool
	}{
		{"a.png", "image/png", "image/png", true},
		{"a.JPG", "image/jpeg", "image/jpeg", true},
		{"a.svg", "image/svg+xml", "image/svg+xml", true},
		{"a.css", "text/css", "text/css; charset=utf-8", true},
		{"a.css", "text/plain; charset=utf-8", "text/css; charset=utf-8", true},
		{"a.js", "text/javascript", "text/javascript; charset=utf-8", true},
		{"a.png", "text/html", "", false},
		{"a.svg", "text/plain", "", false},
		{"a.html", "text/html", "", false},
		{"a.md", "text/markdown", "", false},
	} {
		got, ok := officeFrameLinkedTypeOf(c.name, c.stored)
		if got != c.want || ok != c.ok {
			t.Errorf("%s (%s) = %q %v, want %q %v", c.name, c.stored, got, ok, c.want, c.ok)
		}
	}
}
