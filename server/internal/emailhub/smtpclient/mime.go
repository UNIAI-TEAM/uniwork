package smtpclient

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"strings"
)

const maxLineLen = 76

// OutboundAttachment is one file attached to an outbound message.
type OutboundAttachment struct {
	Filename    string
	ContentType string
	Data        []byte
}

func newBoundary() string {
	buf := make([]byte, 12)
	_, _ = rand.Read(buf)
	return "uniwork-" + hex.EncodeToString(buf)
}

func qp(body string) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	body = strings.ReplaceAll(body, "\n", "\r\n")
	var b strings.Builder
	w := quotedprintable.NewWriter(&b)
	_, _ = w.Write([]byte(body))
	_ = w.Close()
	return b.String()
}

func foldBase64(data []byte) string {
	encoded := base64.StdEncoding.EncodeToString(data)
	var b strings.Builder
	for i := 0; i < len(encoded); i += maxLineLen {
		end := i + maxLineLen
		if end > len(encoded) {
			end = len(encoded)
		}
		if i > 0 {
			b.WriteString("\r\n")
		}
		b.WriteString(encoded[i:end])
	}
	return b.String()
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	if name == "" {
		return "attachment"
	}
	return name
}

func attachmentContentType(filename, contentType string) string {
	ct := strings.TrimSpace(contentType)
	if ct != "" {
		return ct
	}
	if i := strings.LastIndex(filename, "."); i >= 0 && i < len(filename)-1 {
		if ext := mime.TypeByExtension(strings.ToLower(filename[i:])); ext != "" {
			return ext
		}
	}
	return "application/octet-stream"
}

func buildBodyPart(bodyText, bodyHTML string, attachments []OutboundAttachment) (contentType string, body string) {
	text := strings.TrimSpace(bodyText)
	html := strings.TrimSpace(bodyHTML)
	hasAttach := len(attachments) > 0

	var innerType, innerBody string
	switch {
	case html != "" && text != "":
		boundary := newBoundary()
		innerType = "multipart/alternative; boundary=" + boundary
		var b strings.Builder
		writePart(&b, boundary, "text/plain; charset=UTF-8", "quoted-printable", qp(text))
		writePart(&b, boundary, "text/html; charset=UTF-8", "quoted-printable", qp(html))
		b.WriteString("--")
		b.WriteString(boundary)
		b.WriteString("--\r\n")
		innerBody = b.String()
	case html != "":
		innerType = "text/html; charset=UTF-8"
		innerBody = qp(html)
	default:
		innerType = "text/plain; charset=UTF-8"
		innerBody = qp(text)
	}

	if !hasAttach {
		return innerType, innerBody
	}

	mixed := newBoundary()
	var out strings.Builder
	fmt.Fprintf(&out, "--%s\r\n", mixed)
	fmt.Fprintf(&out, "Content-Type: %s\r\n", innerType)
	if strings.HasPrefix(innerType, "multipart/") {
		out.WriteString("MIME-Version: 1.0\r\n")
	} else {
		out.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
	}
	out.WriteString("\r\n")
	out.WriteString(innerBody)
	if !strings.HasSuffix(innerBody, "\r\n") {
		out.WriteString("\r\n")
	}
	for _, att := range attachments {
		filename := sanitizeFilename(att.Filename)
		ct := attachmentContentType(filename, att.ContentType)
		fmt.Fprintf(&out, "--%s\r\n", mixed)
		fmt.Fprintf(&out, "Content-Type: %s; name=\"%s\"\r\n", ct, mime.QEncoding.Encode("utf-8", filename))
		out.WriteString("Content-Transfer-Encoding: base64\r\n")
		fmt.Fprintf(&out, "Content-Disposition: attachment; filename=\"%s\"\r\n\r\n", mime.QEncoding.Encode("utf-8", filename))
		out.WriteString(foldBase64(att.Data))
		out.WriteString("\r\n")
	}
	fmt.Fprintf(&out, "--%s--\r\n", mixed)
	return "multipart/mixed; boundary=" + mixed, out.String()
}

func writePart(b *strings.Builder, boundary, contentType, encoding, payload string) {
	fmt.Fprintf(b, "--%s\r\n", boundary)
	fmt.Fprintf(b, "Content-Type: %s\r\n", contentType)
	fmt.Fprintf(b, "Content-Transfer-Encoding: %s\r\n\r\n", encoding)
	b.WriteString(payload)
	if !strings.HasSuffix(payload, "\r\n") {
		b.WriteString("\r\n")
	}
}
