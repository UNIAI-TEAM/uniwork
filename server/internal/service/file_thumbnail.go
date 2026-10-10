package service

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
)

const (
	// thumbMaxSide bounds the longest side of a thumbnail, in pixels.
	thumbMaxSide = 640
	// thumbMaxPixels refuses to decode anything larger (a decompression bomb
	// fits in a few bytes); such an image keeps serving its original.
	thumbMaxPixels = 50_000_000
)

// fileThumbnailable reports whether makeThumbnail can work on a type with the
// standard library alone. GIF is left out on purpose so an animation stays
// animated; WebP has no decoder without a new dependency.
func fileThumbnailable(contentType string) bool {
	return contentType == "image/jpeg" || contentType == "image/png"
}

// makeThumbnail returns a copy of src whose longest side is thumbMaxSide,
// encoded like the source (JPEG stays JPEG, PNG keeps its alpha). ok is false
// whenever the original should be served instead: an unsupported or corrupt
// image, one already small enough, one too large to decode safely, or a
// result that would not be smaller than the original.
func makeThumbnail(src []byte, contentType string) (out []byte, outType string, ok bool) {
	if !fileThumbnailable(contentType) {
		return nil, "", false
	}
	decodeConfig, decode := png.DecodeConfig, png.Decode
	if contentType == "image/jpeg" {
		decodeConfig, decode = jpeg.DecodeConfig, jpeg.Decode
	}
	cfg, err := decodeConfig(bytes.NewReader(src))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 ||
		int64(cfg.Width)*int64(cfg.Height) > thumbMaxPixels ||
		max(cfg.Width, cfg.Height) <= thumbMaxSide {
		return nil, "", false
	}
	img, err := decode(bytes.NewReader(src))
	if err != nil {
		return nil, "", false
	}
	thumb := downscale(img, thumbMaxSide)
	if contentType == "image/jpeg" {
		thumb = orient(thumb, jpegOrientation(src))
	}
	var buf bytes.Buffer
	if contentType == "image/jpeg" {
		err = jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 82})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, thumb)
	}
	if err != nil || buf.Len() >= len(src) {
		return nil, "", false
	}
	return buf.Bytes(), contentType, true
}

// downscale averages every source pixel into the box it falls in (an area
// filter), so a photo shrinks without the aliasing of nearest-neighbour.
func downscale(img image.Image, maxSide int) *image.RGBA {
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dw, dh := maxSide, sh*maxSide/sw
	if sh > sw {
		dw, dh = sw*maxSide/sh, maxSide
	}
	dw, dh = max(dw, 1), max(dh, 1)
	at := pixelReader(img)
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for dy := 0; dy < dh; dy++ {
		y0, y1 := dy*sh/dh, max((dy+1)*sh/dh, dy*sh/dh+1)
		for dx := 0; dx < dw; dx++ {
			x0, x1 := dx*sw/dw, max((dx+1)*sw/dw, dx*sw/dw+1)
			var r, g, bl, a, n uint32
			for y := y0; y < y1; y++ {
				for x := x0; x < x1; x++ {
					pr, pg, pb, pa := at(b.Min.X+x, b.Min.Y+y)
					r, g, bl, a, n = r+pr, g+pg, bl+pb, a+pa, n+1
				}
			}
			i := dst.PixOffset(dx, dy)
			dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = uint8(r/n), uint8(g/n), uint8(bl/n), uint8(a/n)
		}
	}
	return dst
}

// pixelReader reads premultiplied 8-bit RGBA, straight from the decoded
// planes for the types the JPEG and PNG decoders return most, so a 12 MP
// photo is not boxed into an interface value per pixel.
func pixelReader(img image.Image) func(x, y int) (r, g, b, a uint32) {
	switch m := img.(type) {
	case *image.YCbCr:
		return func(x, y int) (uint32, uint32, uint32, uint32) {
			yi, ci := m.YOffset(x, y), m.COffset(x, y)
			r, g, b := color.YCbCrToRGB(m.Y[yi], m.Cb[ci], m.Cr[ci])
			return uint32(r), uint32(g), uint32(b), 255
		}
	case *image.NRGBA:
		return func(x, y int) (uint32, uint32, uint32, uint32) {
			p := m.Pix[m.PixOffset(x, y):]
			a := uint32(p[3])
			return uint32(p[0]) * a / 255, uint32(p[1]) * a / 255, uint32(p[2]) * a / 255, a
		}
	case *image.RGBA:
		return func(x, y int) (uint32, uint32, uint32, uint32) {
			p := m.Pix[m.PixOffset(x, y):]
			return uint32(p[0]), uint32(p[1]), uint32(p[2]), uint32(p[3])
		}
	default:
		return func(x, y int) (uint32, uint32, uint32, uint32) {
			r, g, b, a := img.At(x, y).RGBA()
			return r >> 8, g >> 8, b >> 8, a >> 8
		}
	}
}

// orient applies an EXIF orientation (1-8) so the thumbnail, which carries no
// EXIF, shows the way the browser shows the original.
func orient(src *image.RGBA, o int) *image.RGBA {
	if o < 2 || o > 8 {
		return src
	}
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch o {
			case 2:
				dx, dy = w-1-x, y
			case 3:
				dx, dy = w-1-x, h-1-y
			case 4:
				dx, dy = x, h-1-y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = h-1-y, x
			case 7:
				dx, dy = h-1-y, w-1-x
			case 8:
				dx, dy = y, w-1-x
			}
			copy(dst.Pix[dst.PixOffset(dx, dy):dst.PixOffset(dx, dy)+4], src.Pix[src.PixOffset(x, y):src.PixOffset(x, y)+4])
		}
	}
	return dst
}

// jpegOrientation reads the EXIF orientation tag from a JPEG's APP1 segment;
// 1 (as stored) when there is none or it cannot be read.
func jpegOrientation(src []byte) int {
	for i := 2; i+4 <= len(src) && src[i] == 0xff; {
		marker, size := src[i+1], int(binary.BigEndian.Uint16(src[i+2:]))
		if marker == 0xda || size < 2 || i+2+size > len(src) {
			break // start of scan: no EXIF before the pixels
		}
		seg := src[i+4 : i+2+size]
		if marker == 0xe1 && len(seg) > 14 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	ifd := int(bo.Uint32(t[4:8]))
	if ifd < 8 || ifd+2 > len(t) {
		return 1
	}
	n := int(bo.Uint16(t[ifd:]))
	for e := ifd + 2; e+12 <= len(t) && n > 0; e, n = e+12, n-1 {
		if bo.Uint16(t[e:]) == 0x0112 && bo.Uint16(t[e+2:]) == 3 {
			return int(bo.Uint16(t[e+8:]))
		}
	}
	return 1
}
