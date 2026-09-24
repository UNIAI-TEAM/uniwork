package emailhub

import "strings"

const (
	FolderInbox   = "INBOX"
	FolderSent    = "SENT"
	FolderDrafts  = "DRAFTS"
	FolderTrash   = "TRASH"
	FolderArchive = "ARCHIVE"
	FolderSpam    = "SPAM"
	FolderStarred = "STARRED"
)

// SyncableFolders lists logical folders pulled from IMAP.
func SyncableFolders() []string {
	return []string{FolderInbox, FolderSent, FolderDrafts, FolderTrash}
}

// DefaultMailboxMap returns static logical→IMAP names before LIST discovery.
func DefaultMailboxMap(provider string) map[string]string {
	out := map[string]string{FolderInbox: FolderInbox}
	for _, folder := range SyncableFolders() {
		if folder != FolderInbox {
			out[folder] = MailboxName(provider, folder)
		}
	}
	out[FolderArchive] = MailboxName(provider, FolderArchive)
	out[FolderSpam] = MailboxName(provider, FolderSpam)
	return out
}

// MoveableTargets are logical folders messages can be moved to via IMAP.
func MoveableTargets() []string {
	return []string{FolderInbox, FolderArchive, FolderTrash, FolderSpam}
}

// MailboxName maps a logical folder to the provider-specific IMAP mailbox.
func MailboxName(provider, folder string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "gmail":
		return gmailMailbox(folder)
	case "outlook":
		return outlookMailbox(folder)
	case "yahoo":
		return yahooMailbox(folder)
	default:
		return folder
	}
}

func gmailMailbox(folder string) string {
	switch folder {
	case FolderSent:
		return "[Gmail]/Sent Mail"
	case FolderDrafts:
		return "[Gmail]/Drafts"
	case FolderTrash:
		return "[Gmail]/Trash"
	case FolderArchive:
		return "[Gmail]/All Mail"
	case FolderSpam:
		return "[Gmail]/Spam"
	default:
		return FolderInbox
	}
}

func outlookMailbox(folder string) string {
	switch folder {
	case FolderSent:
		return "Sent Items"
	case FolderDrafts:
		return "Drafts"
	case FolderTrash:
		return "Deleted Items"
	case FolderArchive:
		return "Archive"
	case FolderSpam:
		return "Junk Email"
	default:
		return FolderInbox
	}
}

func yahooMailbox(folder string) string {
	switch folder {
	case FolderSent:
		return "Sent"
	case FolderDrafts:
		return "Draft"
	case FolderTrash:
		return "Trash"
	case FolderArchive:
		return "Archive"
	case FolderSpam:
		return "Bulk Mail"
	default:
		return FolderInbox
	}
}

// IsMoveableTarget reports whether folder is a valid move_to value.
func IsMoveableTarget(folder string) bool {
	switch folder {
	case FolderInbox, FolderArchive, FolderTrash, FolderSpam:
		return true
	default:
		return false
	}
}
