package imapclient

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime/quotedprintable"
	"regexp"
	"strings"

	"github.com/emersion/go-imap"
)

var quotedPrintableHint = regexp.MustCompile(`=[0-9A-Fa-f]{2}`)

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
	enc := strings.ToLower(strings.TrimSpace(encoding))
	if enc == "" && !looksLikeQuotedPrintableBytes(raw) {
		return raw, nil
	}
	if enc == "" && looksLikeQuotedPrintableBytes(raw) {
		enc = "quoted-printable"
	}
	var r io.Reader = bytes.NewReader(raw)
	switch enc {
	case "quoted-printable", "qp":
		r = quotedprintable.NewReader(r)
	case "base64", "b64":
		r = base64.NewDecoder(base64.StdEncoding, r)
	case "7bit", "8bit", "binary", "identity", "":
		return raw, nil
	default:
		return raw, nil
	}
	out, err := io.ReadAll(io.LimitReader(r, maxBodyBytes))
	if err != nil {
		return nil, err
	}
	return out, nil
}

func looksLikeQuotedPrintableBytes(raw []byte) bool {
	if len(raw) == 0 {
		return false
	}
	s := string(raw)
	if strings.Contains(s, "=\r\n") || strings.Contains(s, "=\n") {
		return true
	}
	return quotedPrintableHint.FindIndex(raw) != nil
}

// RepairThreadBodyContent decodes quoted-printable bodies already cached in DB.
func RepairThreadBodyContent(text, html string) ThreadBody {
	return repairQuotedPrintableBody(text, html)
}

func repairQuotedPrintableBody(text, html string) ThreadBody {
	out := ThreadBody{Text: text, HTML: html}
	if out.Text != "" && looksLikeQuotedPrintableBytes([]byte(out.Text)) {
		if decoded, err := decodeBodyContent([]byte(out.Text), "quoted-printable"); err == nil {
			out.Text = string(decoded)
		}
	}
	if out.HTML != "" && looksLikeQuotedPrintableBytes([]byte(out.HTML)) {
		if decoded, err := decodeBodyContent([]byte(out.HTML), "quoted-printable"); err == nil {
			out.HTML = string(decoded)
		}
	}
	return out
}
