package service

import (
	"archive/zip"
	"bytes"
	"time"
)

// blankPart is one entry of a blank OOXML seed package.
type blankPart struct{ name, body string }

// blankZip packs parts into a deterministic zip: entries are written in the
// order given with one fixed timestamp, so the same parts always produce the
// same bytes (the blank job's fingerprint and the replay check rely on it).
// It returns nil when the archive cannot be written.
func blankZip(parts []blankPart) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	stamp := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, p := range parts {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: p.name, Method: zip.Deflate, Modified: stamp})
		if err != nil {
			return nil
		}
		if _, err := w.Write([]byte(p.body)); err != nil {
			return nil
		}
	}
	if err := zw.Close(); err != nil {
		return nil
	}
	return buf.Bytes()
}
