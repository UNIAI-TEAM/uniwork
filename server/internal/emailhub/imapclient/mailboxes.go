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
	ch := make(chan *imap.MailboxInfo, 64)
	if err := cl.List("", "*", ch); err != nil {
		return out, fmt.Errorf("imap list: %w", err)
	}
	for info := range ch {
		if info == nil {
			continue
		}
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
			}
		}
	}
	return out, nil
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
