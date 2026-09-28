package bodystore

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

const objectKeyVersion = "body.v1.json.gz"

type payload struct {
	Text string `json:"text,omitempty"`
	HTML string `json:"html,omitempty"`
}

// ObjectKey is the logical storage key (S3Storage adds S3_KEY_PREFIX).
func ObjectKey(accountID, threadID string) string {
	return fmt.Sprintf("email-hub/accounts/%s/threads/%s/%s", accountID, threadID, objectKeyVersion)
}

// Mode returns inline or s3. Empty EMAIL_HUB_BODY_STORAGE defaults to s3 when STORAGE_BACKEND=s3.
func Mode() string {
	raw := ""
	if v, ok := os.LookupEnv("EMAIL_HUB_BODY_STORAGE"); ok {
		raw = strings.ToLower(strings.TrimSpace(v))
	}
	switch raw {
	case "", "auto":
		if strings.EqualFold(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")), "s3") {
			return "s3"
		}
		return "inline"
	case "inline", "s3":
		return raw
	default:
		return "inline"
	}
}

// UseObjectStorage reports whether bodies should be written to object storage when a Storage backend exists.
func UseObjectStorage(hasStorage bool) bool {
	return hasStorage && Mode() == "s3"
}

// Encode gzip-JSON body fields for upload.
func Encode(text, html string) ([]byte, error) {
	p := payload{Text: text, HTML: html}
	raw, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Decode reads gzip-JSON written by Encode.
func Decode(data []byte) (text, html string, err error) {
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", "", err
	}
	defer zr.Close()
	raw, err := io.ReadAll(zr)
	if err != nil {
		return "", "", err
	}
	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", "", err
	}
	return p.Text, p.HTML, nil
}
