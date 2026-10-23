package imapclient

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
)

// Session is a logged-in IMAP client reused across mailbox operations.
type Session struct {
	cl         *client.Client
	globalSlot bool
}

// OpenSession dials IMAP and authenticates once for multiple folder ops.
func OpenSession(c Credentials) (*Session, error) {
	return OpenSessionTimeout(c, imapClientTimeout)
}

// OpenSessionTimeout dials IMAP with a custom per-command timeout.
func OpenSessionTimeout(c Credentials, timeout time.Duration) (*Session, error) {
	return openSessionTimeout(c, timeout, 5*time.Second)
}

// OpenSessionInteractive dials IMAP for user-facing body fetches with a short capacity wait.
func OpenSessionInteractive(c Credentials) (*Session, error) {
	return openSessionTimeout(c, InteractiveTimeout(), 3*time.Second)
}

// OpenSessionIdle dials IMAP for long-lived IDLE watch without consuming a global work slot.
// Commands keep the normal timeout; WatchFolder lifts it only while IDLE is open.
func OpenSessionIdle(c Credentials) (*Session, error) {
	cl, err := dial(c)
	if err != nil {
		return nil, err
	}
	return &Session{cl: cl, globalSlot: false}, nil
}

func openSessionTimeout(c Credentials, timeout, capacityWait time.Duration) (*Session, error) {
	ctx, cancel := context.WithTimeout(context.Background(), capacityWait)
	defer cancel()
	if err := acquireGlobalIMAP(ctx); err != nil {
		return nil, err
	}
	cl, err := dial(c)
	if err != nil {
		releaseGlobalIMAP()
		return nil, err
	}
	cl.Timeout = timeout
	return &Session{cl: cl, globalSlot: true}, nil
}

// Close logs out and releases the connection.
func (s *Session) Close() error {
	if s.cl == nil {
		return nil
	}
	err := s.cl.Logout()
	s.cl = nil
	if s.globalSlot {
		releaseGlobalIMAP()
	}
	return err
}

// MailboxMap discovers special-use folders on this session.
func (s *Session) MailboxMap(defaults MailboxMap) (MailboxMap, error) {
	return ListMailboxMap(s.cl, defaults)
}

// SyncFolder incrementally syncs or reconciles one mailbox on this session.
func (s *Session) SyncFolder(mailbox string, sinceUID, storedUIDValidity uint32, reconcile bool) (SyncResult, error) {
	if s.cl == nil {
		return SyncResult{}, fmt.Errorf("imap: session closed")
	}
	return syncFolderWithClient(s.cl, mailbox, sinceUID, storedUIDValidity, reconcile, ClientSupportsGmailLabels(s.cl))
}

// FetchBody loads the plain/HTML body for one UID using this session.
func (s *Session) FetchBody(mailbox string, uid uint32) (ThreadBody, error) {
	if s.cl == nil {
		return ThreadBody{}, fmt.Errorf("imap: session closed")
	}
	return fetchBodyOnClient(s.cl, mailbox, uid)
}

// MarkRead sets \\Seen on one message using this session.
func (s *Session) MarkRead(mailbox string, uid uint32) error {
	if s.cl == nil {
		return fmt.Errorf("imap: session closed")
	}
	return markReadOnClient(s.cl, mailbox, uid)
}

// MarkUnread clears \\Seen on one message using this session.
func (s *Session) MarkUnread(mailbox string, uid uint32) error {
	if s.cl == nil {
		return fmt.Errorf("imap: session closed")
	}
	return markUnreadOnClient(s.cl, mailbox, uid)
}

// MarkStarred sets or clears \\Flagged on one message using this session.
func (s *Session) MarkStarred(mailbox string, uid uint32, starred bool) error {
	if s.cl == nil {
		return fmt.Errorf("imap: session closed")
	}
	return markStarredOnClient(s.cl, mailbox, uid, starred)
}

// Append stores raw in mailbox (RFC 3501 §6.3.11) and returns the UID the
// server reports through APPENDUID (RFC 4315), or 0 when it reports none.
func (s *Session) Append(mailbox string, flags []string, date time.Time, raw []byte) (uint32, error) {
	if s.cl == nil {
		return 0, fmt.Errorf("imap: session closed")
	}
	// client.Append drops the response code, so the command runs directly.
	status, err := s.cl.Execute(&commands.Append{
		Mailbox: mailbox, Flags: flags, Date: date, Message: bytes.NewBuffer(raw),
	}, nil)
	if err != nil {
		return 0, err
	}
	if err := status.Err(); err != nil {
		return 0, fmt.Errorf("imap append: %w", err)
	}
	if status.Code != "APPENDUID" || len(status.Arguments) < 2 {
		return 0, nil
	}
	uid, _ := imap.ParseNumber(status.Arguments[1]) // a malformed code means no UID, not a failed APPEND
	return uid, nil
}

// WatchFolder blocks until the server reports a mailbox change or ctx ends.
// It always finishes IDLE (DONE sent, tagged OK read) before returning, so the
// session is ready for its next command (RFC 2177) and go-imap's reader never
// blocks on a full Updates channel.
func (s *Session) WatchFolder(ctx context.Context, mailbox string) (bool, error) {
	if s.cl == nil {
		return false, fmt.Errorf("imap: session closed")
	}
	if _, err := s.cl.Select(mailbox, false); err != nil {
		return false, fmt.Errorf("imap select %s: %w", mailbox, err)
	}

	updates := make(chan client.Update, 8)
	s.cl.Updates = updates
	timeout := s.cl.Timeout
	s.cl.Timeout = 0 // IDLE is silent until mail arrives; ctx bounds the round
	stop := make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- s.cl.Idle(stop, nil) }()

	var changed bool
	var ctxErr error
	ctxDone := ctx.Done()
	var giveUp <-chan time.Time
	stopIdle := func() {
		close(stop)
		ctxDone = nil
		giveUp = time.After(imapClientTimeout)
	}
	for {
		select {
		case <-ctxDone:
			ctxErr = ctx.Err()
			stopIdle()
		case update := <-updates:
			// Keep draining after DONE so the reader can deliver IDLE's OK.
			if update != nil && !changed && ctxErr == nil {
				changed = true
				stopIdle()
			}
		case <-giveUp:
			_ = s.cl.Terminate() // the server never answered DONE
		case err := <-done:
			s.cl.Updates = nil
			s.cl.Timeout = timeout
			if ctxErr != nil {
				return false, ctxErr
			}
			return changed, err
		}
	}
}
