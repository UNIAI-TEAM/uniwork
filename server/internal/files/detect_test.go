package files_test

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
)

func TestDetectContentTypeSamples(t *testing.T) {
	for _, s := range filescontract.Samples() {
		if got := files.DetectContentType(s.Body, s.Filename); got != s.ContentType {
			t.Errorf("%s (%s): got %q, want %q", s.Name, s.Filename, got, s.ContentType)
		}
	}
}

func TestDetectContentTypeMisnamed(t *testing.T) {
	for _, s := range filescontract.MisnamedSamples() {
		if got := files.DetectContentType(s.Body, s.Filename); got != s.ContentType {
			t.Errorf("%s (%s): got %q, want %q", s.Name, s.Filename, got, s.ContentType)
		}
	}
}

// Every allowlist entry of every purpose, disabled ones included, must be the
// stored type of some real body; otherwise the entry is unreachable. Every
// canonical mapping must start from a type some body verifies as.
func TestEveryAllowlistEntryIsReachable(t *testing.T) {
	for _, spec := range files.DefaultSpecs() {
		stored := map[string]bool{}
		detected := map[string]bool{}
		for _, s := range filescontract.Samples() {
			ct := files.DetectContentType(s.Body, s.Filename)
			detected[ct] = true
			stored[spec.Policy.Canonical(ct)] = true
		}
		for _, ct := range spec.Policy.MIMEAllowlist {
			if !stored[ct] {
				t.Errorf("purpose %s allows %q, which no sample is stored as", spec.Purpose, ct)
			}
		}
		for from := range spec.Policy.CanonicalTypes {
			if !detected[from] {
				t.Errorf("purpose %s maps %q, which no sample verifies as", spec.Purpose, from)
			}
		}
	}
}

// A voice note keeps the names the legacy pipeline stores and serves
// (sniffChatVoiceContentType; the UNI-745 regression net pins audio/webm on
// the message and the playback stream).
func TestChatVoiceKeepsLegacyTypes(t *testing.T) {
	spec, err := files.DefaultRegistry().Lookup(files.ChatVoice)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"webm": "audio/webm", "ogg_opus": "audio/ogg", "ogg_theora": "audio/ogg",
		"ogg_other_codec": "audio/ogg", "m4a": "audio/mp4", "mp4": "audio/mp4",
	}
	seen := 0
	for _, s := range filescontract.Samples() {
		ct, ok := want[s.Name]
		if !ok {
			continue
		}
		seen++
		if got := spec.Policy.Canonical(files.DetectContentType(s.Body, s.Filename)); got != ct || !spec.Policy.Allows(got) {
			t.Errorf("%s: stored as %q (allowed %v), want %q", s.Name, got, spec.Policy.Allows(got), ct)
		}
	}
	if seen != len(want) {
		t.Errorf("found %d of %d voice samples", seen, len(want))
	}
}

func TestMeetingRecordingKeepsTheEgressType(t *testing.T) {
	spec, err := files.DefaultRegistry().Lookup(files.MeetingRecording)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range filescontract.Samples() {
		if s.Name != "mp4" {
			continue
		}
		// recording_playback.go serves every meeting recording as video/mp4.
		if got := spec.Policy.Canonical(files.DetectContentType(s.Body, s.Filename)); got != "video/mp4" {
			t.Errorf("egress mp4 stored as %q, want video/mp4", got)
		}
		return
	}
	t.Fatal("no mp4 sample")
}

func TestDetectContentTypeEdges(t *testing.T) {
	bigCSV := []byte(strings.Repeat("ạ,b\n", files.DetectHeadBytes/5+1))
	// The head is cut inside the three-byte "ạ" when the cut is not aligned.
	for len(bigCSV)%5 == 0 || bigCSV[files.DetectHeadBytes-1] < 0x80 {
		bigCSV = append([]byte("x"), bigCSV...)
	}

	cases := []struct {
		name     string
		body     []byte
		filename string
		want     string
	}{
		{"empty", nil, "notes.csv", "text/plain"},
		{"ooxml_two_main_folders_is_a_zip", ooxml(t, "word/document.xml", "xl/workbook.xml"), "brief.docx", "application/zip"},
		{"ooxml_without_content_types_is_a_zip", zipOf(t, "_rels/.rels", "word/document.xml"), "brief.docx", "application/zip"},
		{"ooxml_ignores_the_name", zipOf(t, "[Content_Types].xml", "xl/workbook.xml"), "brief.docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"cfb_upper_case_extension", cfb(), "BRIEF.DOC", "application/msword"},
		{"cfb_without_extension", cfb(), "brief", "application/octet-stream"},
		{"csv_upper_case_extension", []byte("a,b\n"), "EXPORT.CSV", "text/csv"},
		{"csv_cut_inside_a_rune", bigCSV, "export.csv", "text/csv"},
		{"csv_invalid_rune_at_the_end", []byte("a,b\n\xe1\xba"), "export.csv", "text/plain"},
		{"html_named_md_is_html", []byte("<!DOCTYPE html><p>x</p>"), "notes.md", "text/html"},
		{"utf16_named_csv", []byte("\xff\xfea\x00,\x00b\x00"), "export.csv", "text/plain"},
		{"ogg_unknown_codec", ogg("\x7fmystery"), "clip.ogg", "application/ogg"},
		{"ogg_vorbis", ogg("\x01vorbis\x00\x00\x00\x00"), "clip.ogg", "audio/ogg"},
		{"ogg_truncated_page", []byte("OggS\x00\x02"), "clip.ogg", "application/ogg"},
		{"mp4_quicktime_brand", ftyp("qt  ", "qt  "), "clip.mov", "application/octet-stream"},
		{"mp4_m4a_only_brands", ftyp("M4A ", "isom"), "voice.m4a", "audio/mp4"},
		{"mp4_m4b_compatible", ftyp("mp42", "M4B ", "mp42"), "book.m4b", "audio/mp4"},
		{"mp4_box_longer_than_head", []byte("\x00\x00\x00\x40ftypM4A\x00\x00\x00\x00"), "voice.m4a", "application/octet-stream"},
	}
	for _, c := range cases {
		if got := files.DetectContentType(c.body, c.filename); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// A zip whose OOXML part sits past DetectHeadBytes is judged on the head
// alone, the same way the real validator sees only the first chunk.
func TestDetectContentTypeReadsOnlyTheHead(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "padding.bin"} {
		f, err := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		size := 16
		if name == "padding.bin" {
			size = files.DetectHeadBytes
		}
		if _, err := f.Write(bytes.Repeat([]byte{0x01}, size)); err != nil {
			t.Fatal(err)
		}
	}
	f, err := w.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("<w:document/>")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if got := files.DetectContentType(buf.Bytes(), "brief.docx"); got != "application/zip" {
		t.Errorf("got %q, want application/zip (the word/ part is past the head)", got)
	}
}

func zipOf(t *testing.T, names ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range names {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte("<x/>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func ooxml(t *testing.T, parts ...string) []byte {
	t.Helper()
	return zipOf(t, append([]string{"[Content_Types].xml", "_rels/.rels"}, parts...)...)
}

func cfb() []byte {
	b := make([]byte, 512)
	copy(b, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	return b
}

func ogg(ident string) []byte {
	b := []byte("OggS\x00\x02")
	b = append(b, make([]byte, 20)...)
	b = append(b, 1, byte(len(ident)))
	return append(b, ident...)
}

func ftyp(major string, compatible ...string) []byte {
	n := 16 + 4*len(compatible)
	b := []byte{0, 0, 0, byte(n)}
	b = append(b, "ftyp"+major+"\x00\x00\x02\x00"...)
	for _, c := range compatible {
		b = append(b, c...)
	}
	return b
}
