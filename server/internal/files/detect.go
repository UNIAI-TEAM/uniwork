package files

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"
)

// DetectHeadBytes is how much of a body DetectContentType reads. The fake
// passes whole bodies and the real validator passes the first chunk of the
// stream; both are cut to this size so the two cannot verify the same bytes
// differently. It covers the zip local headers of an OOXML package (the
// content-types part and the first parts of the main folder come first) and
// the first Ogg page.
const DetectHeadBytes = 64 << 10

// Media types DetectContentType returns beyond the standard sniffer.
const (
	mimeOctetStream = "application/octet-stream"
	mimeZip         = "application/zip"
	mimeTextPlain   = "text/plain"
	mimeOgg         = "application/ogg"
	mimeVideoMP4    = "video/mp4"
	mimeAudioMP4    = "audio/mp4"
	mimeAudioOgg    = "audio/ogg"
	mimeVideoOgg    = "video/ogg"
	mimeDOCX        = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	mimeXLSX        = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	mimePPTX        = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

// cfbSignature opens every OLE compound file (DOC, XLS, PPT, MSG, encrypted
// OOXML...). The signature proves the container, not which Office format.
var cfbSignature = []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}

// cfbByExtension names the Office format of a compound file. Only these three
// are accepted by any purpose; any other extension leaves the file unknown.
var cfbByExtension = map[string]string{
	".doc": "application/msword",
	".xls": "application/vnd.ms-excel",
	".ppt": "application/vnd.ms-powerpoint",
}

// textByExtension names the text format of bytes already proved to be UTF-8
// text. A client's extension picks the subtype; it never makes text of bytes
// that are not text.
var textByExtension = map[string]string{
	".csv":    "text/csv",
	".ndjson": "application/x-ndjson",
	".md":     "text/markdown",
}

// DetectContentType is the one verified-type rule of FileService (FS-C1 v1
// errata): the type a File carries is what its bytes prove, and the filename
// is only a hint inside a family the bytes already proved.
//
//   - It starts from http.DetectContentType, normalized.
//   - A zip whose local headers hold [Content_Types].xml and parts of exactly
//     one of word/, xl/ or ppt/, and no vbaProject.bin part, is the matching
//     OOXML type; any other zip stays application/zip, whatever its name.
//   - An OLE compound file is DOC, XLS or PPT by its extension; with any other
//     extension it is application/octet-stream.
//   - Non-empty valid UTF-8 text named .csv, .ndjson or .md is text/csv,
//     application/x-ndjson or text/markdown; any other text keeps the
//     sniffer's type.
//   - An Ogg stream whose first page opens an Opus, Vorbis, FLAC or Speex
//     stream is audio/ogg, a Theora one video/ogg, anything else
//     application/ogg. A well-formed ftyp box is the MP4 family whatever its
//     brands: audio/mp4 with an M4A or M4B brand, video/mp4 otherwise, except
//     a still-image HEIF/AVIF major brand, which stays unknown; a malformed
//     ftyp box is unknown too. WebM stays video/webm: telling an
//     audio-only WebM from a video one needs the track headers, which a head
//     scan cannot read reliably.
//
// Unknown bytes are application/octet-stream, which no purpose allows today.
func DetectContentType(head []byte, filename string) string {
	truncated := len(head) > DetectHeadBytes
	if truncated {
		head = head[:DetectHeadBytes]
	}
	sniffed := NormalizeContentType(http.DetectContentType(head))
	ext := strings.ToLower(path.Ext(filename))

	switch {
	case sniffed == mimeZip:
		if ooxml := ooxmlType(head); ooxml != "" {
			return ooxml
		}
		return mimeZip
	case bytes.HasPrefix(head, cfbSignature):
		if ct, ok := cfbByExtension[ext]; ok {
			return ct
		}
		return mimeOctetStream
	case sniffed == mimeTextPlain:
		if ct, ok := textByExtension[ext]; ok && len(head) > 0 && validUTF8Head(head, truncated) {
			return ct
		}
		return mimeTextPlain
	case sniffed == mimeOgg:
		return oggType(head)
	case (sniffed == mimeVideoMP4 || sniffed == mimeOctetStream) && len(head) >= 8 && string(head[4:8]) == "ftyp":
		if ct := mp4Type(head); ct != "" {
			return ct
		}
		// A box mp4Type refuses is not MP4, even where the standard
		// sniffer's looser check accepts it.
		return mimeOctetStream
	}
	return sniffed
}

// ooxmlType walks the zip local file headers in head and names the OOXML
// package they describe. A package needs the content-types part and parts of
// one main folder; a zip holding two main folders is ambiguous and stays a
// zip, and so does a macro-enabled package (a vbaProject.bin part), which no
// purpose allows under the plain OOXML types. It reads names only, never
// decompresses.
//
// An entry whose local header carries its compressed size is skipped by that
// size, so the bytes of a stored entry (a zip inside the zip) are never read
// as headers of the outer archive. A streamed entry (data descriptor, size 0
// in the local header) is skipped by searching for the next header
// signature; its data is compressed in every writer seen, so it does not
// hold raw headers.
func ooxmlType(head []byte) string {
	const (
		localHeaderLen = 30
		flagStreamed   = 0x08
		zip64Size      = 0xffffffff
	)
	sig := []byte("PK\x03\x04")
	var contentTypes, word, xl, ppt, macros bool
	for pos := 0; pos+localHeaderLen <= len(head) && bytes.Equal(head[pos:pos+4], sig); {
		flags := binary.LittleEndian.Uint16(head[pos+6:])
		compressed := binary.LittleEndian.Uint32(head[pos+18:])
		nameLen := int(binary.LittleEndian.Uint16(head[pos+26:]))
		extraLen := int(binary.LittleEndian.Uint16(head[pos+28:]))
		nameEnd := pos + localHeaderLen + nameLen
		if nameEnd > len(head) {
			break
		}
		name := string(head[pos+localHeaderLen : nameEnd])
		switch {
		case name == "[Content_Types].xml":
			contentTypes = true
		case strings.HasPrefix(name, "word/"):
			word = true
		case strings.HasPrefix(name, "xl/"):
			xl = true
		case strings.HasPrefix(name, "ppt/"):
			ppt = true
		}
		if strings.HasSuffix(name, "/vbaProject.bin") {
			macros = true
		}
		dataStart := nameEnd + extraLen
		switch {
		case compressed == zip64Size:
			// The real size is in the zip64 extra field; an entry that large
			// ends past any head anyway.
			pos = len(head)
		case flags&flagStreamed != 0 && compressed == 0:
			next := -1
			if dataStart <= len(head) {
				next = bytes.Index(head[dataStart:], sig)
			}
			if next < 0 {
				pos = len(head)
			} else {
				pos = dataStart + next
			}
		default:
			pos = dataStart + int(compressed)
		}
	}
	if !contentTypes || macros {
		return ""
	}
	switch {
	case word && !xl && !ppt:
		return mimeDOCX
	case xl && !word && !ppt:
		return mimeXLSX
	case ppt && !word && !xl:
		return mimePPTX
	}
	return ""
}

// oggType reads the first Ogg page. Its payload is the identification header
// of the first logical stream, which names the codec exactly.
func oggType(head []byte) string {
	const pageHeaderLen = 27
	if len(head) < pageHeaderLen {
		return mimeOgg
	}
	payload := pageHeaderLen + int(head[26])
	if payload > len(head) {
		return mimeOgg
	}
	body := head[payload:]
	for _, audio := range [][]byte{[]byte("OpusHead"), []byte("\x01vorbis"), []byte("\x7fFLAC"), []byte("Speex   ")} {
		if bytes.HasPrefix(body, audio) {
			return mimeAudioOgg
		}
	}
	if bytes.HasPrefix(body, []byte("\x80theora")) {
		return mimeVideoOgg
	}
	return mimeOgg
}

// mp4Type reads the ftyp box. A well-formed box - sane size, the ftyp tag at
// offset 4, printable brands - proves the ISO base media family whatever its
// brands, because recorders vary them (Safari and iOS write brands the
// standard sniffer does not know). An M4A/M4B brand marks an audio file; a
// still-image HEIF/AVIF major brand is not media and stays unknown; anything
// else is video/mp4. It returns "" when head has no well-formed ftyp box,
// leaving the sniffer's answer alone.
func mp4Type(head []byte) string {
	// Real ftyp boxes hold a handful of brands (well under 100 bytes); 1024
	// bytes is 250 brands, far past any writer, so a larger size is not an
	// ftyp box.
	const maxFtypLen = 1024
	if len(head) < 16 || string(head[4:8]) != "ftyp" {
		return ""
	}
	boxLen := int(binary.BigEndian.Uint32(head))
	if boxLen < 16 || boxLen > maxFtypLen || boxLen > len(head) || boxLen%4 != 0 {
		return ""
	}
	// Major brand at 8, minor version at 12, compatible brands from 16.
	brands := []string{string(head[8:12])}
	for i := 16; i+4 <= boxLen; i += 4 {
		brands = append(brands, string(head[i:i+4]))
	}
	for _, brand := range brands {
		if !printableBrand(brand) {
			return ""
		}
	}
	switch brands[0] {
	case "mif1", "msf1", "heic", "heix", "heim", "heis", "hevc", "hevx", "avif", "avis":
		return ""
	}
	for _, brand := range brands {
		switch brand {
		case "M4A ", "M4B ":
			return mimeAudioMP4
		}
	}
	return mimeVideoMP4
}

func printableBrand(brand string) bool {
	for i := 0; i < len(brand); i++ {
		if brand[i] < 0x20 || brand[i] > 0x7e {
			return false
		}
	}
	return true
}

// validUTF8Head reports whether head is UTF-8. When the body was cut at
// DetectHeadBytes, the cut may split the last rune, which is not evidence
// against the text.
func validUTF8Head(head []byte, truncated bool) bool {
	if utf8.Valid(head) {
		return true
	}
	if !truncated {
		return false
	}
	for cut := 1; cut < utf8.UTFMax && cut < len(head); cut++ {
		if utf8.Valid(head[:len(head)-cut]) && !utf8.FullRune(head[len(head)-cut:]) {
			return true
		}
	}
	return false
}
