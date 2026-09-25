package imapclient

import (
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

const fetchGmailLabels imap.FetchItem = "X-GM-LABELS"

// ClientSupportsGmailLabels reports whether the session advertises X-GM-EXT-1.
func ClientSupportsGmailLabels(cl *client.Client) bool {
	if cl == nil {
		return false
	}
	caps, err := cl.Capability()
	if err != nil {
		return false
	}
	return caps["X-GM-EXT-1"]
}

func parseGmailLabels(msg *imap.Message) []string {
	if msg == nil || msg.Items == nil {
		return nil
	}
	raw, ok := msg.Items[fetchGmailLabels]
	if !ok || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []interface{}:
		return stringListFromIface(v)
	case []string:
		return append([]string(nil), v...)
	case string:
		if s := strings.TrimSpace(v); s != "" {
			return []string{s}
		}
	}
	return nil
}

func stringListFromIface(items []interface{}) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		switch s := it.(type) {
		case string:
			if t := strings.TrimSpace(s); t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}
