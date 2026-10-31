package imapclient

import (
	"errors"
	"fmt"
	"slices"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
)

// MoveMessage moves one message to another mailbox. It never sends a bare
// EXPUNGE, which would also purge messages other clients flagged \Deleted.
func MoveMessage(c Credentials, fromMailbox string, uid uint32, toMailbox string) error {
	cl, err := dial(c)
	if err != nil {
		return err
	}
	defer cl.Logout()
	return moveUIDsOnClient(cl, fromMailbox, []uint32{uid}, toMailbox)
}

// MoveUIDs moves every UID in fromMailbox to toMailbox on this session.
func (s *Session) MoveUIDs(fromMailbox string, uids []uint32, toMailbox string) error {
	if s.cl == nil {
		return fmt.Errorf("imap: session closed")
	}
	return moveUIDsOnClient(s.cl, fromMailbox, uids, toMailbox)
}

func moveUIDsOnClient(cl *client.Client, fromMailbox string, uids []uint32, toMailbox string) error {
	if len(uids) == 0 {
		return nil
	}
	// dial / OpenSession already read post-login capabilities.
	has := func(capability string) bool { ok, _ := cl.Support(capability); return ok }
	gmailAllMail := false
	if has("X-GM-EXT-1") {
		var err error
		if gmailAllMail, err = hasAllAttr(cl, fromMailbox); err != nil {
			return err
		}
	}
	if _, err := cl.Select(fromMailbox, false); err != nil {
		return fmt.Errorf("imap select %s: %w", fromMailbox, err)
	}
	seqset := new(imap.SeqSet)
	for _, uid := range uids {
		seqset.AddNum(uid)
	}
	switch {
	case gmailAllMail:
		// Gmail reads "removed from All Mail" as "move to Trash"; a copy only adds the label.
		return cl.UidCopy(seqset, toMailbox)
	case has("MOVE"):
		return cl.UidMove(seqset, toMailbox)
	case !has("UIDPLUS"):
		return errors.New("imap: server supports neither MOVE nor UIDPLUS")
	}
	if err := cl.UidCopy(seqset, toMailbox); err != nil {
		return fmt.Errorf("imap uid copy: %w", err)
	}
	item := imap.FormatFlagsOp(imap.AddFlags, true)
	if err := cl.UidStore(seqset, item, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return fmt.Errorf("imap uid store: %w", err)
	}
	// UID EXPUNGE (RFC 4315) removes only these messages.
	status, err := cl.Execute(&commands.Uid{Cmd: &imap.Command{Name: "EXPUNGE", Arguments: []interface{}{seqset}}}, nil)
	if err != nil {
		return fmt.Errorf("imap uid expunge: %w", err)
	}
	return status.Err()
}

func hasAllAttr(cl *client.Client, mailbox string) (bool, error) {
	infos, err := listMailboxes(cl, mailbox)
	if err != nil {
		return false, fmt.Errorf("imap list %s: %w", mailbox, err)
	}
	found := false
	for _, info := range infos {
		found = found || slices.Contains(info.Attributes, imap.AllAttr)
	}
	return found, nil
}
