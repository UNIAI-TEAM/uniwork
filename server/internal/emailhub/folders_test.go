package emailhub

import "testing"

func TestMailboxName(t *testing.T) {
	t.Parallel()
	if got := MailboxName("gmail", FolderSent); got != "[Gmail]/Sent Mail" {
		t.Fatalf("gmail sent: %q", got)
	}
	if got := MailboxName("outlook", FolderTrash); got != "Deleted Items" {
		t.Fatalf("outlook trash: %q", got)
	}
	if got := MailboxName("yahoo", FolderDrafts); got != "Draft" {
		t.Fatalf("yahoo drafts: %q", got)
	}
	if got := MailboxName("unknown", FolderArchive); got != FolderArchive {
		t.Fatalf("unknown provider keeps logical name: %q", got)
	}
}

func TestDefaultMailboxMap(t *testing.T) {
	t.Parallel()
	m := DefaultMailboxMap("gmail")
	if m[FolderInbox] != FolderInbox || m[FolderSent] != "[Gmail]/Sent Mail" {
		t.Fatalf("unexpected gmail map: %v", m)
	}
	if len(SyncableFolders()) != 4 || SyncableFolders()[0] != FolderInbox {
		t.Fatalf("unexpected syncable folders: %v", SyncableFolders())
	}
	if !IsMoveableTarget(FolderArchive) || !IsMoveableTarget(FolderTrash) || IsMoveableTarget(FolderInbox) {
		t.Fatal("unexpected moveable targets")
	}
	if got := MoveableTargets(); len(got) != 2 || got[0] != FolderArchive {
		t.Fatalf("unexpected move targets: %v", got)
	}
}
