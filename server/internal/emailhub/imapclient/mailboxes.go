package imapclient

import (
	"fmt"

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
	for _, info := range infos {
		for _, attr := range info.Attributes {
			switch attr {
			case imap.SentAttr:
				out["SENT"] = info.Name
			case imap.TrashAttr:
				out["TRASH"] = info.Name
			case imap.DraftsAttr:
				out["DRAFTS"] = info.Name
			case imap.AllAttr, imap.ArchiveAttr:
				out["ARCHIVE"] = info.Name
			case imap.JunkAttr:
				out["SPAM"] = info.Name
			}
		}
	}
	return out, nil
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
