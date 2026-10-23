package service

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"io"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

func TestChatImageDimensionsReadsThePhotosShownSize(t *testing.T) {
	t.Parallel()
	var animated bytes.Buffer
	if err := gif.Encode(&animated, image.NewPaletted(image.Rect(0, 0, 40, 30), color.Palette{color.Black, color.White}), nil); err != nil {
		t.Fatalf("gif: %v", err)
	}
	jpg := encodeJPEG(t, testPhoto(800, 600))
	cases := []struct {
		name, contentType string
		body              []byte
		w, h              int
		ok                bool
	}{
		{"jpeg", "image/jpeg", jpg, 800, 600, true},
		{"a portrait phone photo stored on its side", "image/jpeg", withEXIFOrientation(jpg, 6), 600, 800, true},
		{"mirrored, not turned", "image/jpeg", withEXIFOrientation(jpg, 2), 800, 600, true},
		{"png", "image/png", encodePNG(t, testPhoto(320, 1200)), 320, 1200, true},
		{"gif", "image/gif", animated.Bytes(), 40, 30, true},
		{"a type the standard library cannot read", "image/webp", jpg, 0, 0, false},
		{"not an image", "application/pdf", []byte("%PDF-1.7"), 0, 0, false},
		{"a corrupt header", "image/png", []byte("\x89PNG\r\n\x1a\nnope"), 0, 0, false},
		{"a header that says zero", "image/png", pngClaiming(t, 0, 10), 0, 0, false},
		{"empty", "image/jpeg", nil, 0, 0, false},
	}
	for _, tc := range cases {
		body := bytes.NewReader(tc.body)
		// The upload read the body to its end first: the size is read from the start.
		_, _ = body.Seek(0, io.SeekEnd)
		w, h, ok := chatImageDimensions(body, tc.contentType)
		if w != tc.w || h != tc.h || ok != tc.ok {
			t.Errorf("%s: got %dx%d ok=%v, want %dx%d ok=%v", tc.name, w, h, ok, tc.w, tc.h, tc.ok)
		}
	}
}

func TestChatImageDimensionsWithAHeaderPastItsBudget(t *testing.T) {
	t.Parallel()
	// A JPEG whose first frame starts after the bytes it reads: the size stays unknown.
	jpg := encodeJPEG(t, testPhoto(64, 64))
	pad := []byte{0xff, 0xe2, 0xff, 0xff}
	pad = append(pad, make([]byte, 0xffff-2)...)
	big := append([]byte{}, jpg[:2]...)
	for len(big) < chatDimensionHeadBytes+1 {
		big = append(big, pad...)
	}
	big = append(big, jpg[2:]...)
	if _, _, ok := chatImageDimensions(bytes.NewReader(big), "image/jpeg"); ok {
		t.Fatal("read a size past the header budget")
	}
}

type failingSeeker struct {
	io.Reader
	seekErr error
}

func (f failingSeeker) Seek(int64, int) (int64, error) { return 0, f.seekErr }

func TestChatImageDimensionsWhenTheBodyFails(t *testing.T) {
	t.Parallel()
	if _, _, ok := chatImageDimensions(failingSeeker{Reader: bytes.NewReader(nil), seekErr: errors.New("closed")}, "image/png"); ok {
		t.Fatal("a body that cannot rewind gave a size")
	}
	broken := failingSeeker{Reader: io.MultiReader(bytes.NewReader([]byte{1}), errReader{}), seekErr: nil}
	if _, _, ok := chatImageDimensions(broken, "image/png"); ok {
		t.Fatal("a body that fails mid-read gave a size")
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, errors.New("disk") }

func TestChatMediaMetadataCarriesAPhotosSize(t *testing.T) {
	t.Parallel()
	file := files.File{ID: "f1", Filename: "anh.jpg", ContentType: "image/jpeg", SizeBytes: 10}
	meta := chatMediaMetadata(chatMediaCommand{kind: "file", width: 1280, height: 960}, file)
	if meta["width"] != 1280 || meta["height"] != 960 {
		t.Fatalf("photo metadata: %#v", meta)
	}
	for _, cmd := range []chatMediaCommand{{kind: "file"}, {kind: "file", width: 10}, {kind: "voice", durationMS: 900}} {
		if _, ok := metaSize(chatMediaMetadata(cmd, file)); ok {
			t.Fatalf("%+v: a size without both sides: %#v", cmd, chatMediaMetadata(cmd, file))
		}
	}
}

func metaSize(meta map[string]any) (any, bool) {
	if w, ok := meta["width"]; ok {
		return w, true
	}
	_, ok := meta["height"]
	return nil, ok
}

func TestFileMessageFromMetadataReadsASize(t *testing.T) {
	t.Parallel()
	got := fileMessageFromMetadata("file", []byte(`{"filename":"anh.jpg","file_id":"f1","content_type":"image/jpeg","size_bytes":10,"width":1280,"height":960}`))
	if got == nil || got.Width != 1280 || got.Height != 960 {
		t.Fatalf("sized photo: %#v", got)
	}
	for _, raw := range []string{
		`{"filename":"anh.jpg","file_id":"f1","content_type":"image/jpeg","size_bytes":10}`,
		`{"filename":"anh.jpg","file_id":"f1","content_type":"image/jpeg","size_bytes":10,"width":1280}`,
		`{"filename":"anh.jpg","file_id":"f1","content_type":"image/jpeg","size_bytes":10,"width":-1,"height":5}`,
	} {
		got := fileMessageFromMetadata("file", []byte(raw))
		if got == nil || got.Width != 0 || got.Height != 0 {
			t.Fatalf("%s: %#v", raw, got)
		}
	}
}
