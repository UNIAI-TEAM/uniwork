package imapclient

import (
	"fmt"
	"sort"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

const maxSearchResults = 50

// SearchOptions configures an IMAP SEARCH before metadata fetch.
type SearchOptions struct {
	StarredOnly bool
}

// SearchFolder runs IMAP SEARCH TEXT on one mailbox and fetches matching metadata.
func SearchFolder(c Credentials, mailbox, query string, opts SearchOptions) (SyncResult, error) {
	sess, err := OpenSessionInteractive(c)
	if err != nil {
		return SyncResult{}, err
	}
	defer sess.Close()
	return sess.SearchFolder(mailbox, query, opts)
}

// SearchFolder runs IMAP SEARCH on the selected mailbox using this session.
func (s *Session) SearchFolder(mailbox, query string, opts SearchOptions) (SyncResult, error) {
	if s.cl == nil {
		return SyncResult{}, fmt.Errorf("imap: session closed")
	}
	return searchFolderWithClient(s.cl, mailbox, query, opts)
}

func searchFolderWithClient(cl *client.Client, mailbox, query string, opts SearchOptions) (SyncResult, error) {
	mbox, err := cl.Select(mailbox, false)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	if mbox.Messages == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity}, nil
	}

	crit := buildSearchCriteria(query, opts)
	uids, err := cl.UidSearch(crit)
	if err != nil {
		return SyncResult{}, fmt.Errorf("imap uid search: %w", err)
	}
	if len(uids) == 0 {
		return SyncResult{UIDValidity: mbox.UidValidity}, nil
	}

	uids = capSearchUIDs(uids)
	items, err := fetchUIDs(cl, uids, ClientSupportsGmailLabels(cl))
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Items: items, UIDValidity: mbox.UidValidity, HighestUID: maxUID(items)}, nil
}

func buildSearchCriteria(query string, opts SearchOptions) *imap.SearchCriteria {
	crit := imap.NewSearchCriteria()
	if q := strings.TrimSpace(query); q != "" {
		crit.Text = []string{q}
	}
	if opts.StarredOnly {
		crit.WithFlags = []string{imap.FlaggedFlag}
	}
	return crit
}

// capSearchUIDs keeps the newest matches when IMAP returns more than the fetch budget.
func capSearchUIDs(uids []uint32) []uint32 {
	if len(uids) <= maxSearchResults {
		return uids
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] > uids[j] })
	return uids[:maxSearchResults]
}
