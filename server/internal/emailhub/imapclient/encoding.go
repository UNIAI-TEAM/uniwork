package imapclient

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime/quotedprintable"
	"strings"

	"github.com/emersion/go-imap"
)

func bodyStructureAt(bs *imap.BodyStructure, path []int) *imap.BodyStructure {
	if bs == nil || len(path) == 0 {
		return bs
	}
	cur := bs
	for _, idx := range path {
		if cur == nil || len(cur.Parts) < idx {
			return nil
		}
		cur = cur.Parts[idx-1]
	}
	return cur
}

func decodeBodyContent(raw []byte, encoding string) ([]byte, error) {
	r := decodeTransferEncoding(bytes.NewReader(raw), encoding)
	if _, identity := r.(*bytes.Reader); identity {
		return raw, nil
	}
	return io.ReadAll(io.LimitReader(r, maxBodyBytes))
}

// decodeTransferEncoding undoes a part's Content-Transfer-Encoding. 7bit, 8bit,
// binary and unknown encodings pass through unchanged.
func decodeTransferEncoding(r io.Reader, encoding string) io.Reader {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "quoted-printable", "qp":
		return quotedprintable.NewReader(r)
	case "base64", "b64":
		return base64.NewDecoder(base64.StdEncoding, r) // skips CRLF line breaks
	}
	return r
}
