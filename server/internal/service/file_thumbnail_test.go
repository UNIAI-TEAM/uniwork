package service

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

func testPhoto(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// Left half red, right half blue: the orientation case reads it.
			c := color.RGBA{R: 220, A: 255}
			if x >= w/2 {
				c = color.RGBA{B: 220, A: 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func wantThumb(t *testing.T, src []byte, contentType, wantType string, wantW, wantH int) image.Image {
	t.Helper()
	out, outType, ok := makeThumbnail(src, contentType)
	if !ok {
		t.Fatalf("no thumbnail for %s", contentType)
	}
	if outType != wantType {
		t.Fatalf("thumbnail type = %s, want %s", outType, wantType)
	}
	if len(out) >= len(src) {
		t.Fatalf("thumbnail is %d bytes, not smaller than the %d byte original", len(out), len(src))
	}
	img, format, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("thumbnail does not decode: %v", err)
	}
	if "image/"+format != wantType {
		t.Fatalf("thumbnail encodes %s, labelled %s", format, outType)
	}
	if b := img.Bounds(); b.Dx() != wantW || b.Dy() != wantH {
		t.Fatalf("thumbnail is %dx%d, want %dx%d", b.Dx(), b.Dy(), wantW, wantH)
	}
	return img
}

func TestMakeThumbnailBoundsTheLongestSide(t *testing.T) {
	t.Parallel()
	wantThumb(t, encodeJPEG(t, testPhoto(1600, 800)), "image/jpeg", "image/jpeg", 640, 320)
	wantThumb(t, encodePNG(t, testPhoto(1000, 2000)), "image/png", "image/png", 320, 640)
}

func TestMakeThumbnailSkipsWhatItCannotImprove(t *testing.T) {
	t.Parallel()
	var gifBuf bytes.Buffer
	if err := gif.Encode(&gifBuf, testPhoto(1200, 900), nil); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		body []byte
		ct   string
	}{
		"already small":       {encodePNG(t, testPhoto(640, 300)), "image/png"},
		"gif keeps animation": {gifBuf.Bytes(), "image/gif"},
		"webp has no decoder": {[]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp"},
		"pdf is not an image": {[]byte("%PDF-1.7\n"), "application/pdf"},
		"corrupt jpeg":        {[]byte("\xff\xd8\xff\xe0garbage"), "image/jpeg"},
		"type does not match": {encodePNG(t, testPhoto(1200, 900)), "image/jpeg"},
		"decompression bomb":  {pngClaiming(t, 20000, 20000), "image/png"},
	} {
		if _, _, ok := makeThumbnail(c.body, c.ct); ok {
			t.Errorf("%s: made a thumbnail, want the original served", name)
		}
	}
}

// A phone photo stores its pixels sideways and an EXIF orientation; the
// browser rotates the original, so the thumbnail must be rotated too.
func TestMakeThumbnailAppliesEXIFOrientation(t *testing.T) {
	t.Parallel()
	src := withEXIFOrientation(encodeJPEG(t, testPhoto(1600, 800)), 6)
	img := wantThumb(t, src, "image/jpeg", "image/jpeg", 320, 640)
	// Orientation 6 turns the picture 90 degrees clockwise: the red left
	// half ends up on top.
	r, _, b, _ := img.At(160, 100).RGBA()
	if r < b {
		t.Fatalf("top of the rotated thumbnail is not red: r=%d b=%d", r, b)
	}
	r, _, b, _ = img.At(160, 540).RGBA()
	if b < r {
		t.Fatalf("bottom of the rotated thumbnail is not blue: r=%d b=%d", r, b)
	}
}

// The pod has 512 MiB, so the decode budget counts bytes, not pixels: a
// 16-bit PNG holds 8 B/px and a progressive JPEG keeps every coefficient.
func TestThumbnailDecodeBudget(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		cfg  image.Config
		ct   string
		want bool
	}{
		"12 MP phone photo":     {image.Config{ColorModel: color.YCbCrModel, Width: 4032, Height: 3024}, "image/jpeg", true},
		"24 MP jpeg":            {image.Config{ColorModel: color.YCbCrModel, Width: 6000, Height: 4000}, "image/jpeg", false},
		"16 MP rgba png":        {image.Config{ColorModel: color.NRGBAModel, Width: 4096, Height: 4096}, "image/png", true},
		"20 MP rgba png":        {image.Config{ColorModel: color.NRGBAModel, Width: 5000, Height: 4000}, "image/png", false},
		"40 MP paletted png":    {image.Config{ColorModel: color.Palette{color.Black}, Width: 8000, Height: 5000}, "image/png", true},
		"16-bit rgba png":       {image.Config{ColorModel: color.NRGBA64Model, Width: 1000, Height: 1000}, "image/png", false},
		"16-bit rgb png":        {image.Config{ColorModel: color.RGBA64Model, Width: 1000, Height: 1000}, "image/png", false},
		"16-bit grey png":       {image.Config{ColorModel: color.Gray16Model, Width: 1000, Height: 1000}, "image/png", false},
		"8-bit grey png, 60 MP": {image.Config{ColorModel: color.GrayModel, Width: 10000, Height: 6000}, "image/png", true},
		"8-bit grey png, 80 MP": {image.Config{ColorModel: color.GrayModel, Width: 10000, Height: 8000}, "image/png", false},
	} {
		if got := decodeFits(c.cfg, c.ct); got != c.want {
			t.Errorf("%s: decodeFits = %v, want %v", name, got, c.want)
		}
	}
}

func TestFileThumbnailableTypes(t *testing.T) {
	t.Parallel()
	for ct, want := range map[string]bool{
		"image/jpeg": true, "image/png": true, "image/gif": false, "image/webp": false, "application/pdf": false,
	} {
		if got := fileThumbnailable(ct); got != want {
			t.Errorf("fileThumbnailable(%s) = %v, want %v", ct, got, want)
		}
	}
}

// pngClaiming is a valid 1x1 PNG whose header claims w x h.
func pngClaiming(t *testing.T, w, h uint32) []byte {
	t.Helper()
	raw := encodePNG(t, image.NewRGBA(image.Rect(0, 0, 1, 1)))
	// Signature (8), then IHDR: length (4), type (4), data (13), CRC (4).
	binary.BigEndian.PutUint32(raw[16:20], w)
	binary.BigEndian.PutUint32(raw[20:24], h)
	binary.BigEndian.PutUint32(raw[29:33], crc32.ChecksumIEEE(raw[12:29]))
	return raw
}

// withEXIFOrientation inserts an APP1 segment carrying only the orientation
// tag right after the JPEG's SOI marker.
func withEXIFOrientation(src []byte, orientation uint16) []byte {
	var tiff bytes.Buffer
	tiff.WriteString("MM\x00\x2a")
	_ = binary.Write(&tiff, binary.BigEndian, uint32(8))      // IFD0 offset
	_ = binary.Write(&tiff, binary.BigEndian, uint16(1))      // one entry
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0x0112)) // Orientation
	_ = binary.Write(&tiff, binary.BigEndian, uint16(3))      // SHORT
	_ = binary.Write(&tiff, binary.BigEndian, uint32(1))      // count
	_ = binary.Write(&tiff, binary.BigEndian, orientation)    // value
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0))      // padding
	_ = binary.Write(&tiff, binary.BigEndian, uint32(0))      // no next IFD
	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	seg := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	out := append([]byte{}, src[:2]...)
	out = append(out, seg...)
	out = append(out, payload...)
	return append(out, src[2:]...)
}
