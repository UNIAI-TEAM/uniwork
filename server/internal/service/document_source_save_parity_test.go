package service

import (
	"archive/zip"
	"bytes"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// UNI-1305 item C, review round 2 (N2): can_save is the verdict of the document
// upload computed from the metadata the source module stored, not from the
// bytes, so it cannot call the upload's rule directly. This test fails when the
// two drift: for each sample it runs what the upload runs (DetectContentType on
// the bytes, then the document_file policy) and what the source module stored
// (its own purpose's Canonical type), and requires can_save to agree.
//
// A mail part is the one source that stores the client's declared type, often
// generic, so can_save falls back to the extension there. The extension table
// is small on purpose: it may refuse a file the upload would take (css, svg,
// js), never promise one the upload refuses.

func parityOOXML(t *testing.T, part string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", part} {
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

func parityZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("readme.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestDocumentSourceSaveableAgreesWithTheUpload(t *testing.T) {
	pad := bytes.Repeat([]byte{0}, 64)
	cat := func(parts ...[]byte) []byte { return bytes.Join(parts, nil) }
	mp4 := cat([]byte{0, 0, 0, 24}, []byte("ftypisom"), []byte{0, 0, 2, 0}, []byte("isommp41"))
	samples := []struct {
		name string
		file string
		body []byte
	}{
		{"pdf", "a.pdf", cat([]byte("%PDF-1.4\n"), pad)},
		{"png", "a.png", cat([]byte("\x89PNG\r\n\x1a\n"), pad)},
		{"jpeg", "a.jpg", cat([]byte{0xff, 0xd8, 0xff, 0xe0}, pad)},
		{"gif", "a.gif", cat([]byte("GIF89a"), pad)},
		{"bmp", "a.bmp", cat([]byte("BM"), pad)},
		{"text", "a.txt", []byte("xin chào")},
		{"markdown", "a.md", []byte("# Tiêu đề\n")},
		{"csv", "a.csv", []byte("a,b\n1,2\n")},
		{"ndjson", "a.ndjson", []byte("{\"a\":1}\n")},
		{"css", "a.css", []byte("body{color:red}")},
		{"javascript", "a.js", []byte("var a = 1;")},
		{"svg", "a.svg", []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")},
		{"html", "a.html", []byte("<!DOCTYPE html><html><body>x</body></html>")},
		{"docx", "a.docx", parityOOXML(t, "word/document.xml")},
		{"xlsx", "a.xlsx", parityOOXML(t, "xl/workbook.xml")},
		{"pptx", "a.pptx", parityOOXML(t, "ppt/presentation.xml")},
		{"zip", "a.zip", parityZip(t)},
		{"legacy doc", "a.doc", cat([]byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), pad)},
		{"legacy doc with a wrong name", "a.bin", cat([]byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), pad)},
		{"mp4 recording", "a.mp4", mp4},
		{"webm recording", "a.webm", cat([]byte{0x1a, 0x45, 0xdf, 0xa3}, pad)},
	}
	docPolicy := documentFilePolicy()
	sources := map[string]files.Policy{}
	for _, spec := range files.DefaultSpecs() {
		switch spec.Purpose {
		case files.ChatAttachment, files.TaskAttachment, files.TaskCommentAttachment, files.MeetingRecording:
			sources[string(spec.Purpose)] = spec.Policy
		}
	}
	if len(sources) != 4 {
		t.Fatalf("source purposes found = %d, want 4", len(sources))
	}
	ext := func(file string) string {
		for i := len(file) - 1; i >= 0; i-- {
			if file[i] == '.' {
				return file[i+1:]
			}
		}
		return ""
	}
	uploadAccepts := func(s struct {
		name string
		file string
		body []byte
	}, size int64) bool {
		detected := files.DetectContentType(s.body, s.file)
		return size > 0 && size <= docPolicy.MaxBytes && docPolicy.Allows(detected)
	}

	for _, s := range samples {
		size := int64(len(s.body))
		want := uploadAccepts(s, size)
		for purpose, policy := range sources {
			detected := files.DetectContentType(s.body, s.file)
			// The source module stores the canonical type of what the bytes
			// prove (an .ndjson file is text/plain in Chat and Tasks).
			stored := policy.Canonical(detected)
			if !policy.Allows(stored) {
				continue // the source module would have refused this upload: no row to list
			}
			if got := documentSourceSaveable(ext(s.file), stored, size); got != want {
				t.Errorf("%s stored by %s as %q: can_save = %v, the document upload says %v", s.name, purpose, stored, got, want)
			}
		}
		// A mail part with a generic declared type: never more than the upload.
		if got := documentSourceSaveable(ext(s.file), "application/octet-stream", size); got && !want {
			t.Errorf("%s as a mail part: can_save = true, the document upload refuses it", s.name)
		}
	}

	// The cap is the upload's own: one byte over refuses on both sides.
	pdf := samples[0]
	if over := docPolicy.MaxBytes + 1; documentSourceSaveable("pdf", "application/pdf", over) || uploadAccepts(pdf, over) {
		t.Errorf("a file over the %d byte cap must be refused by both", docPolicy.MaxBytes)
	}
	if documentSourceSaveable("pdf", "application/pdf", 0) || uploadAccepts(pdf, 0) {
		t.Error("an empty file must be refused by both")
	}
}
