package imapclient

import (
	"fmt"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

// MailboxMap maps logical folder keys (INBOX, SENT, …) to provider mailbox names.
type MailboxMap map[string]string

// ListMailboxMap discovers special-use folders from IMAP LIST, falling back to defaults.
func ListMailboxMap(cl *client.Client, defaults MailboxMap) (MailboxMap, error) {
	if cl == nil {
		return nil, fmt.Errorf("imap: nil client")
	}
	out := make(MailboxMap, len(defaults)+4)
	for k, v := range defaults {
		out[k] = v
	}
	infos, err := listMailboxes(cl, "*")
	if err != nil {
		return out, fmt.Errorf("imap list: %w", err)
	}
	assignMailboxes(out, infos)
	return out, nil
}

// wellKnownFolders are the last-segment names (lower case) of the folders
// servers without SPECIAL-USE (Courier, older cPanel/Dovecot) give each logical key.
var wellKnownFolders = map[string][]string{
	"SENT":    {"sent", "sent items", "sent messages", "sent mail"},
	"TRASH":   {"trash", "deleted items", "deleted messages"},
	"SPAM":    {"junk", "spam", "junk e-mail", "junk email"},
	"DRAFTS":  {"drafts"},
	"ARCHIVE": {"archive"},
}

// assignMailboxes sets each logical key from RFC 6154 SPECIAL-USE attributes,
// then, for a key no attribute set, from the first mailbox in LIST order whose
// last hierarchy segment is a well-known name. An attribute always wins.
func assignMailboxes(out MailboxMap, infos []*imap.MailboxInfo) {
	done := make(map[string]bool, len(wellKnownFolders))
	for _, info := range infos {
		for _, attr := range info.Attributes {
			key := ""
			switch attr {
			case imap.SentAttr:
				key = "SENT"
			case imap.TrashAttr:
				key = "TRASH"
			case imap.DraftsAttr:
				key = "DRAFTS"
			case imap.AllAttr, imap.ArchiveAttr:
				key = "ARCHIVE"
			case imap.JunkAttr:
				key = "SPAM"
			}
			if key != "" {
				out[key] = info.Name
				done[key] = true
			}
		}
	}
	for _, info := range infos {
		leaf := info.Name
		if info.Delimiter != "" {
			if i := strings.LastIndex(leaf, info.Delimiter); i >= 0 {
				leaf = leaf[i+len(info.Delimiter):]
			}
		}
		leaf = strings.ToLower(leaf)
		for key, names := range wellKnownFolders {
			if done[key] {
				continue
			}
			for _, n := range names {
				if leaf == n {
					out[key] = info.Name
					done[key] = true
					break
				}
			}
		}
	}
}

// listMailboxes runs LIST while draining its channel. go-imap sends each row
// from its reader goroutine and blocks on a full channel, so collecting only
// after List returns hangs once a mailbox has more folders than the buffer.
func listMailboxes(cl *client.Client, name string) ([]*imap.MailboxInfo, error) {
	ch := make(chan *imap.MailboxInfo, 16)
	done := make(chan error, 1)
	go func() { done <- cl.List("", name, ch) }() // List closes ch when it returns
	var infos []*imap.MailboxInfo
	for info := range ch {
		if info != nil {
			infos = append(infos, info)
		}
	}
	return infos, <-done
}

func (m MailboxMap) Resolve(logicalFolder string) string {
	if m == nil {
		return logicalFolder
	}
	if name, ok := m[logicalFolder]; ok && name != "" {
		return name
	}
	return logicalFolder
}
