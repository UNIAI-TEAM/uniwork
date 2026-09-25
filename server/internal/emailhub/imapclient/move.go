package imapclient

import (
	"fmt"

	"github.com/emersion/go-imap"
)

// MoveMessage copies a message to another mailbox and expunges it from the source.
func MoveMessage(c Credentials, fromMailbox string, uid uint32, toMailbox string) error {
	cl, err := dial(c)
	if err != nil {
		return err
	}
	defer cl.Logout()

	if _, err := cl.Select(fromMailbox, false); err != nil {
		return fmt.Errorf("imap select %s: %w", fromMailbox, err)
	}
	seqset := new(imap.SeqSet)
	seqset.AddNum(uid)
	if err := cl.UidCopy(seqset, toMailbox); err != nil {
		return fmt.Errorf("imap uid copy: %w", err)
	}
	item := imap.FormatFlagsOp(imap.AddFlags, true)
	flags := []interface{}{imap.DeletedFlag}
	if err := cl.UidStore(seqset, item, flags, nil); err != nil {
		return fmt.Errorf("imap uid store: %w", err)
	}
	return cl.Expunge(nil)
}
