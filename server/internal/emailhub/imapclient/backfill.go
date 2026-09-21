package imapclient

import (
	"fmt"
	"sort"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

const BackfillBatchSize = 50

// BackfillFolder fetches up to BackfillBatchSize messages with UID strictly less than beforeUID.
func BackfillFolder(c Credentials, mailbox string, beforeUID uint32) (SyncResult, error) {
	sess, err := OpenSessionInteractive(c)
	if err != nil {
		return SyncResult{}, err
	}
	defer sess.Close()
	return sess.BackfillFolder(mailbox, beforeUID)
}

// BackfillFolder loads the next older message window on this session.
func (s *Session) BackfillFolder(mailbox string, beforeUID uint32) (SyncResult, error) {
	if s.cl == nil {
		return SyncResult{}, fmt.Errorf("imap: session closed")
	}
	return backfillFolderWithClient(s.cl, mailbox, beforeUID)
}

func backfillFolderWithClient(cl *client.Client, mailbox string, beforeUID uint32) (SyncResult, error) {
	if beforeUID <= 1 {
		return SyncResult{}, nil
	}
	mbox, err := cl.Select(mailbox, false)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	if mbox.Messages == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity}, nil
	}

	crit := imap.NewSearchCriteria()
	crit.Uid = new(imap.SeqSet)
	crit.Uid.AddRange(1, beforeUID-1)
	uids, err := cl.UidSearch(crit)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap uid search: %w", err)
	}
	if len(uids) == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity}, nil
	}

	uids = capNewestUIDs(uids, BackfillBatchSize)
	items, err := fetchUIDs(cl, uids)
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Items: items, UIDValidity: mbox.UidValidity, HighestUID: maxUID(items)}, nil
}

func capNewestUIDs(uids []uint32, limit int) []uint32 {
	if len(uids) <= limit {
		return uids
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] > uids[j] })
	return uids[:limit]
}
