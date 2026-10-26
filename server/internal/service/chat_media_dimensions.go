package service

import (
	"bytes"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
)

// chatDimensionHeadBytes is how much of a photo is read for its size: the
// header and the segments before the first frame (EXIF, ICC) fit well within
// it for camera photos. A larger header leaves the size unknown, which a
// client treats as before (a square box).
const chatDimensionHeadBytes = 256 << 10

// chatImageDimensions reads a sent photo's width and height as it shows
// (EXIF orientation applied) from its header alone, never decoding pixels, so
// a phone can lay out the bubble before the image arrives (audit H2). ok is
// false for a type the standard library cannot read (WebP, HEIC), a corrupt
// header, or one past chatDimensionHeadBytes. The body is read from its start
// and left wherever the read stops.
func chatImageDimensions(body io.ReadSeeker, contentType string) (width, height int, ok bool) {
	var decode func(io.Reader) (image.Config, error)
	switch contentType {
	case "image/jpeg":
		decode = jpeg.DecodeConfig
	case "image/png":
		decode = png.DecodeConfig
	case "image/gif":
		decode = gif.DecodeConfig
	default:
		return 0, 0, false
	}
	if _, err := body.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}
	head := make([]byte, chatDimensionHeadBytes)
	n, err := io.ReadFull(body, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return 0, 0, false
	}
	head = head[:n]
	cfg, err := decode(bytes.NewReader(head))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0, false
	}
	width, height = cfg.Width, cfg.Height
	// Orientations 5-8 turn the picture a quarter: it shows taller than it is stored.
	if contentType == "image/jpeg" && jpegOrientation(head) >= 5 {
		width, height = height, width
	}
	return width, height, true
}
