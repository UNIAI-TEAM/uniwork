package imapclient

import (
	"context"
	"fmt"
	"sort"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

const maxIncrementalUIDBatch = 50

// SyncResult carries incremental mailbox metadata and cursor fields.
type SyncResult struct {
	Items       []ThreadMeta
	UIDValidity uint32
	HighestUID  uint32
}

// SyncFolderIncremental fetches messages with UID strictly greater than sinceUID.
func SyncFolderIncremental(c Credentials, mailbox string, sinceUID, storedUIDValidity uint32) (SyncResult, error) {
	sess, err := OpenSession(c)
	if err != nil {
		return SyncResult{}, err
	}
	defer sess.Close()
	return sess.SyncFolder(mailbox, sinceUID, storedUIDValidity, false)
}

// ReconcileFolder reloads the newest cached window for one mailbox.
func ReconcileFolder(c Credentials, mailbox string) (SyncResult, error) {
	sess, err := OpenSession(c)
	if err != nil {
		return SyncResult{}, err
	}
	defer sess.Close()
	return sess.SyncFolder(mailbox, 0, 0, true)
}

// SyncINBOXIncremental keeps the Phase 3 entry point for INBOX-only callers.
func SyncINBOXIncremental(c Credentials, sinceUID, storedUIDValidity uint32) (SyncResult, error) {
	return SyncFolderIncremental(c, "INBOX", sinceUID, storedUIDValidity)
}

// ReconcileINBOX keeps the Phase 3 entry point for INBOX-only callers.
func ReconcileINBOX(c Credentials) (SyncResult, error) {
	return ReconcileFolder(c, "INBOX")
}

// WatchFolder blocks until the server reports a mailbox change or ctx ends.
func WatchFolder(ctx context.Context, c Credentials, mailbox string) (bool, error) {
	sess, err := OpenSession(c)
	if err != nil {
		return false, err
	}
	defer sess.Close()
	return sess.WatchFolder(ctx, mailbox)
}

// WatchINBOX keeps the Phase 3 entry point.
func WatchINBOX(ctx context.Context, c Credentials) (bool, error) {
	return WatchFolder(ctx, c, "INBOX")
}

func syncFolderWithClient(cl *client.Client, mailbox string, sinceUID, storedUIDValidity uint32, reconcile bool) (SyncResult, error) {
	mbox, err := cl.Select(mailbox, false)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	if mbox.Messages == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity}, nil
	}
	if reconcile || sinceUID == 0 || (storedUIDValidity != 0 && mbox.UidValidity != storedUIDValidity) {
		items, err := syncLatest(cl, mbox)
		if err != nil {
			return SyncResult{}, err
		}
		return SyncResult{Items: items, UIDValidity: mbox.UidValidity, HighestUID: maxUID(items)}, nil
	}

	crit := imap.NewSearchCriteria()
	crit.Uid = new(imap.SeqSet)
	crit.Uid.AddRange(sinceUID+1, 0)
	uids, err := cl.UidSearch(crit)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap uid search: %w", err)
	}
	if len(uids) == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity, HighestUID: sinceUID}, nil
	}
	uids = capIncrementalUIDs(uids)
	items, err := fetchUIDs(cl, uids)
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Items: items, UIDValidity: mbox.UidValidity, HighestUID: maxUID(items)}, nil
}

func syncLatest(cl *client.Client, mbox *imap.MailboxStatus) ([]ThreadMeta, error) {
	from := uint32(1)
	if mbox.Messages > initialSyncLimit {
		from = mbox.Messages - initialSyncLimit + 1
	}
	seqset := new(imap.SeqSet)
	seqset.AddRange(from, mbox.Messages)
	return fetchMessages(cl, seqset, false, false)
}

func fetchUIDs(cl *client.Client, uids []uint32) ([]ThreadMeta, error) {
	seqset := new(imap.SeqSet)
	for _, uid := range uids {
		seqset.AddNum(uid)
	}
	return fetchMessages(cl, seqset, true, false)
}

func fetchMessages(cl *client.Client, seqset *imap.SeqSet, byUID bool, withBody bool) ([]ThreadMeta, error) {
	var section *imap.BodySectionName
	items := []imap.FetchItem{
		imap.FetchUid, imap.FetchFlags, imap.FetchEnvelope,
		imap.FetchInternalDate, imap.FetchBodyStructure,
	}
	if withBody {
		section = &imap.BodySectionName{Peek: true}
		items = append(items, section.FetchItem())
	}
	ch := make(chan *imap.Message, initialSyncLimit)
	var err error
	if byUID {
		err = cl.UidFetch(seqset, items, ch)
	} else {
		err = cl.Fetch(seqset, items, ch)
	}
	if err != nil {
		return nil, fmt.Errorf("imap fetch: %w", err)
	}
	// Drain the FETCH response before issuing further IMAP commands on this connection.
	msgs := make([]*imap.Message, 0, initialSyncLimit)
	for msg := range ch {
		msgs = append(msgs, msg)
	}
	out := make([]ThreadMeta, 0, len(msgs))
	for _, msg := range msgs {
		out = append(out, messageMeta(cl, msg, section))
	}
	return out, nil
}

// capIncrementalUIDs limits burst fetches so notification floods cannot monopolize IMAP.
// Lowest UIDs are fetched first so the cursor advances without skipping messages.
func capIncrementalUIDs(uids []uint32) []uint32 {
	if len(uids) <= maxIncrementalUIDBatch {
		return uids
	}
	sorted := append([]uint32(nil), uids...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	return sorted[:maxIncrementalUIDBatch]
}

func maxUID(items []ThreadMeta) uint32 {
	var max uint32
	for _, it := range items {
		if it.UID > max {
			max = it.UID
		}
	}
	return max
}
