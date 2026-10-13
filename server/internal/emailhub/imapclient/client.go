package imapclient

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
	"github.com/emersion/go-message"
	"github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
	"github.com/emersion/go-message/textproto"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

// Importing go-message/charset registers it for bodies; IMAP envelopes need it too.
func init() { imap.CharsetReader = charset.Reader }

const (
	initialSyncLimit       = 50
	imapClientTimeout      = 45 * time.Second
	imapInteractiveTimeout = 25 * time.Second
	maxBodyBytes           = 5 << 20 // 5 MiB
)

// InteractiveTimeout is the server-side budget for opening one message body.
func InteractiveTimeout() time.Duration {
	return imapInteractiveTimeout
}

// Credentials for a single mailbox session.
type Credentials struct {
	Host     string
	Port     int
	Email    string
	Username string // LOGIN user; empty means Email
	Password string
	Security string // "tls" or "starttls"; empty means "tls"
	// AccessToken is an OAuth access token; when set, AUTHENTICATE XOAUTH2
	// replaces LOGIN and Password is ignored.
	AccessToken string

	// Tests inject a loopback dialer and trust root through these unexported
	// fields. Production always uses the guarded dialer and system roots.
	dialer  client.Dialer
	rootCAs *x509.CertPool
}

// ThreadMeta is the metadata cached for one mailbox message.
type ThreadMeta struct {
	UID            uint32
	MessageID      string
	InReplyTo      string
	References     string
	Subject        string
	Snippet        string
	BodyText       string
	BodyHTML       string
	FromAddr       string
	FromName       string
	ToAddrs        []string
	SentAt         time.Time
	IsRead         bool
	IsStarred      bool
	HasAttachments bool
	Attachments    []AttachmentMeta
	ImapLabels     []string
}

// ThreadBody is fetched on demand when the user opens a thread.
type ThreadBody struct {
	Text string
	HTML string
}

// VerifyLogin dials IMAP and authenticates without syncing.
func VerifyLogin(c Credentials) error {
	cl, err := dial(c)
	if err != nil {
		return err
	}
	return cl.Logout()
}

// SyncINBOX returns the newest messages in INBOX up to initialSyncLimit.
func SyncINBOX(c Credentials) ([]ThreadMeta, error) {
	cl, err := dial(c)
	if err != nil {
		return nil, err
	}
	defer cl.Logout()

	mbox, err := cl.Select("INBOX", false)
	if err != nil {
		return nil, fmt.Errorf("imap select INBOX: %w", err)
	}
	if mbox.Messages == 0 {
		return nil, nil
	}

	from := uint32(1)
	if mbox.Messages > initialSyncLimit {
		from = mbox.Messages - initialSyncLimit + 1
	}
	seqset := new(imap.SeqSet)
	seqset.AddRange(from, mbox.Messages)

	section := &imap.BodySectionName{Peek: true}
	items := []imap.FetchItem{
		imap.FetchUid, imap.FetchFlags, imap.FetchEnvelope,
		imap.FetchInternalDate, imap.FetchBodyStructure,
		section.FetchItem(), referencesSection.FetchItem(),
	}

	ch := make(chan *imap.Message, initialSyncLimit)
	if err := cl.Fetch(seqset, items, ch); err != nil {
		return nil, fmt.Errorf("imap fetch: %w", err)
	}

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

// FetchBody loads the plain/HTML body for one UID in the given mailbox.
func FetchBody(c Credentials, mailbox string, uid uint32) (ThreadBody, error) {
	cl, err := dial(c)
	if err != nil {
		return ThreadBody{}, err
	}
	defer cl.Logout()
	return fetchBodyOnClient(cl, mailbox, uid)
}

// ErrAuthFailed marks a LOGIN the server refused with AUTHENTICATIONFAILED:
// retrying the same password cannot succeed, so callers stop instead of retrying.
var ErrAuthFailed = errors.New("imap: authentication failed")

// ErrLoginRefused marks a LOGIN refused with a bare NO. Outlook answers a wrong
// password that way, but so may a provider that is throttling or locked the
// account for a while, so callers give up only when it repeats.
var ErrLoginRefused = errors.New("imap: login refused")

// ErrTLSRequired marks a starttls server that does not offer STARTTLS: the
// password is never sent over a plaintext connection.
var ErrTLSRequired = errors.New("imap: server does not offer STARTTLS")

func dial(c Credentials) (*client.Client, error) {
	return dialWithTimeout(c, imapClientTimeout)
}

// dialWithTimeout applies the same bound to TCP dial, TLS/greeting, STARTTLS
// and authentication. Keeping it as an argument lets tests exercise real
// stalled sockets without changing package-global state.
func dialWithTimeout(c Credentials, timeout time.Duration) (*client.Client, error) {
	addr := net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
	dialer := c.dialer
	if dialer == nil {
		dialer = netguard.NewDialer(timeout)
	}
	heldDialer := &deadlineHoldingDialer{Dialer: dialer, timeout: timeout}
	cfg := &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, RootCAs: c.rootCAs}
	starttls := c.Security == "starttls"
	var (
		cl  *client.Client
		err error
	)
	if starttls {
		cl, err = client.DialWithDialer(heldDialer, addr)
	} else {
		// Empty security is legacy implicit TLS, identical to "tls".
		cl, err = client.DialWithDialerTLS(heldDialer, addr, cfg)
	}
	if err != nil {
		err = heldDialer.causeOr(err)
		heldDialer.close()
		if errors.Is(err, netguard.ErrHostNotAllowed) {
			return nil, netguard.ErrHostNotAllowed
		}
		return nil, fmt.Errorf("imap greeting: %w", err)
	}
	// Set the command timeout before releasing the greeting deadline, so no
	// STARTTLS, LOGIN or AUTHENTICATE command can run unbounded.
	cl.Timeout = timeout
	heldDialer.release()
	if starttls {
		err := startTLS(cl, cfg)
		if err != nil {
			err = heldDialer.causeOr(err)
			_ = cl.Terminate()
			return nil, err
		}
	}
	user := c.Username
	if user == "" {
		user = c.Email
	}
	if c.AccessToken != "" {
		err = authenticateXOAUTH2(cl, user, c.AccessToken)
	} else {
		err = login(cl, user, c.Password)
	}
	if err != nil {
		err = heldDialer.causeOr(err)
		_ = cl.Terminate()
		return nil, fmt.Errorf("imap login: %w", err)
	}
	return cl, nil
}

// startTLS upgrades a plaintext session, or refuses: there is no opportunistic
// fallback. cfg carries ServerName because client.New never learned the host.
func startTLS(cl *client.Client, cfg *tls.Config) error {
	ok, err := cl.Support("STARTTLS")
	if err != nil {
		return fmt.Errorf("imap capability: %w", err)
	}
	if !ok {
		return ErrTLSRequired
	}
	if err := cl.StartTLS(cfg); err != nil {
		return fmt.Errorf("imap starttls: %w", err)
	}
	return nil
}

// deadlineHoldingDialer keeps one deadline across TCP/TLS, the greeting and
// the capability probes client.New may send before Client.Timeout can be set.
// Its underlying production dialer is netguard.NewDialer; package tests inject
// a plain net.Dialer so loopback fixtures still exercise real sockets.
type deadlineHoldingDialer struct {
	client.Dialer
	timeout time.Duration
	conn    *deadlineHeldConn
}

func (d *deadlineHoldingDialer) causeOr(fallback error) error {
	if d.conn != nil && isTransportClosure(fallback) {
		return d.conn.causeOr(fallback)
	}
	return fallback
}

// isTransportClosure is deliberately narrow: a server's tagged NO/BAD and
// local semantic sentinels must win even if the peer resets immediately after
// sending them. Only transport errors that go-imap may collapse to its private
// connection-closed value are eligible for the remembered sanitized cause.
func isTransportClosure(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrAuthFailed) || errors.Is(err, ErrLoginRefused) || errors.Is(err, ErrTLSRequired) {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return hasGoIMAPConnectionClosed(err)
}

func hasGoIMAPConnectionClosed(err error) bool {
	if err == nil {
		return false
	}
	switch err.Error() {
	case "imap: connection closed", "imap: connection closed during command execution":
		return true
	}
	if many, ok := err.(interface{ Unwrap() []error }); ok {
		for _, nested := range many.Unwrap() {
			if hasGoIMAPConnectionClosed(nested) {
				return true
			}
		}
		return false
	}
	return hasGoIMAPConnectionClosed(errors.Unwrap(err))
}

func (d *deadlineHoldingDialer) Dial(network, addr string) (net.Conn, error) {
	conn, err := d.Dialer.Dial(network, addr)
	if err != nil {
		return nil, err
	}
	if err := conn.SetDeadline(time.Now().Add(d.timeout)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	held := &deadlineHeldConn{Conn: conn}
	held.hold.Store(true)
	d.conn = held
	return held, nil
}

func (d *deadlineHoldingDialer) release() {
	if d.conn == nil {
		return
	}
	d.conn.hold.Store(false)
	_ = d.conn.Conn.SetDeadline(time.Time{})
}

func (d *deadlineHoldingDialer) close() {
	if d.conn != nil {
		_ = d.conn.Conn.Close()
	}
}

// deadlineHeldConn ignores go-imap's deadline calls while hold is set.
type deadlineHeldConn struct {
	net.Conn
	hold      atomic.Bool
	failureMu sync.Mutex
	failure   error
}

func (c *deadlineHeldConn) SetDeadline(t time.Time) error {
	if c.hold.Load() {
		return nil
	}
	return c.Conn.SetDeadline(t)
}

func (c *deadlineHeldConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if cause := sanitizedConnectionCause(err); cause != nil {
		c.remember(cause)
		// go-imap logs every reader error except EOF. The caller gets causeOr's
		// sanitized timeout/network error instead of this internal EOF.
		return n, io.EOF
	}
	return n, err
}

func (c *deadlineHeldConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	if cause := sanitizedConnectionCause(err); cause != nil {
		c.remember(cause)
		return n, cause
	}
	return n, err
}

func (c *deadlineHeldConn) remember(err error) {
	c.failureMu.Lock()
	if c.failure == nil {
		c.failure = err
	}
	c.failureMu.Unlock()
}

func (c *deadlineHeldConn) causeOr(fallback error) error {
	c.failureMu.Lock()
	defer c.failureMu.Unlock()
	if c.failure != nil {
		return c.failure
	}
	return fallback
}

func sanitizedConnectionCause(err error) error {
	if err == nil || errors.Is(err, io.EOF) {
		return nil
	}
	var netErr net.Error
	if !errors.As(err, &netErr) {
		return nil
	}
	if netErr.Timeout() {
		return context.DeadlineExceeded
	}
	return imapNetworkError{}
}

// imapNetworkError keeps the net.Error taxonomy without retaining a raw
// endpoint-bearing *net.OpError.
type imapNetworkError struct{}

func (imapNetworkError) Error() string   { return "imap: network error" }
func (imapNetworkError) Timeout() bool   { return false }
func (imapNetworkError) Temporary() bool { return false }

// login runs LOGIN by hand because client.Login keeps only the response text,
// and the response code is what tells a refused password (AUTHENTICATIONFAILED;
// no code at all is ambiguous) from a busy server ([ALERT] too many
// connections, [UNAVAILABLE]) that is worth retrying later.
func login(cl *client.Client, user, password string) error {
	status, err := cl.Execute(&commands.Login{Username: user, Password: password}, nil)
	return finishLogin(cl, status, err)
}

// finishLogin classifies a LOGIN or AUTHENTICATE status and, on OK, moves the
// client to the authenticated state.
func finishLogin(cl *client.Client, status *imap.StatusResp, err error) error {
	if err != nil {
		return err
	}
	if status.Type == imap.StatusRespNo {
		switch status.Code {
		case "AUTHENTICATIONFAILED":
			return fmt.Errorf("%w: %s", ErrAuthFailed, status.Info)
		case "":
			return fmt.Errorf("%w: %s", ErrLoginRefused, status.Info)
		}
	}
	if err := status.Err(); err != nil {
		return err
	}
	cl.SetState(imap.AuthenticatedState, nil)
	// Capabilities change at login; refresh them as client.Login would.
	_, err = cl.Capability()
	return err
}

// referencesSection fetches the References header, which the envelope lacks;
// its first id is the conversation root.
var referencesSection = &imap.BodySectionName{
	BodyPartName: imap.BodyPartName{Specifier: imap.HeaderSpecifier, Fields: []string{"REFERENCES"}},
	Peek:         true,
}

func messageReferences(msg *imap.Message) string {
	r := msg.GetBody(referencesSection)
	if r == nil {
		return ""
	}
	h, err := textproto.ReadHeader(bufio.NewReader(r))
	if err != nil {
		return ""
	}
	return sanitizeUTF8(h.Get("References"))
}

func messageMeta(cl *client.Client, msg *imap.Message, section *imap.BodySectionName) ThreadMeta {
	meta := ThreadMeta{UID: msg.Uid, References: messageReferences(msg)}
	for _, f := range msg.Flags {
		switch f {
		case imap.SeenFlag:
			meta.IsRead = true
		case imap.FlaggedFlag:
			meta.IsStarred = true
		}
	}
	if msg.Envelope != nil {
		meta.Subject = sanitizeUTF8(msg.Envelope.Subject)
		meta.MessageID = sanitizeUTF8(msg.Envelope.MessageId)
		meta.InReplyTo = sanitizeUTF8(msg.Envelope.InReplyTo)
		if !msg.Envelope.Date.IsZero() {
			meta.SentAt = msg.Envelope.Date
		} else if !msg.InternalDate.IsZero() {
			meta.SentAt = msg.InternalDate
		}
		if len(msg.Envelope.From) > 0 {
			meta.FromAddr = sanitizeUTF8(msg.Envelope.From[0].Address())
			meta.FromName = sanitizeUTF8(msg.Envelope.From[0].PersonalName)
		}
		for _, to := range msg.Envelope.To {
			if addr := sanitizeUTF8(to.Address()); addr != "" {
				meta.ToAddrs = append(meta.ToAddrs, addr)
			}
		}
	}
	if msg.BodyStructure != nil {
		meta.HasAttachments = bodyHasAttachments(msg.BodyStructure)
		collectAttachments(msg.BodyStructure, nil, &meta.Attachments)
		if meta.HasAttachments && len(meta.Attachments) == 0 {
			meta.HasAttachments = false
		}
	}
	if section != nil {
		body := extractThreadBody(cl, msg, section)
		meta.Snippet = snippet(body.Text, body.HTML)
		meta.BodyText = body.Text
		meta.BodyHTML = body.HTML
	} else if meta.Subject != "" {
		meta.Snippet = snippetFromSubject(meta.Subject)
	}
	if meta.SentAt.IsZero() {
		meta.SentAt = time.Now().UTC()
	}
	meta.Snippet = sanitizeUTF8(meta.Snippet)
	meta.ToAddrs = sanitizeAddrs(meta.ToAddrs)
	meta.ImapLabels = parseGmailLabels(msg)
	return meta
}

func bodyHasAttachments(bs *imap.BodyStructure) bool {
	if bs == nil {
		return false
	}
	if len(bs.Parts) == 0 {
		disp := strings.ToLower(bs.Disposition)
		return disp == "attachment" || (bs.MIMEType != "text" && bs.MIMEType != "multipart")
	}
	for _, child := range bs.Parts {
		if bodyHasAttachments(child) {
			return true
		}
	}
	return false
}

func parseBody(r io.Reader) (ThreadBody, error) {
	out, err := collectBodyParts(r)
	if err != nil {
		return ThreadBody{}, err
	}
	return normalizeThreadBody(out), nil
}

func collectBodyParts(r io.Reader) (ThreadBody, error) {
	// An unknown charset is a soft error: the part stays readable as raw bytes.
	entity, err := mail.CreateReader(r)
	if err != nil && !message.IsUnknownCharset(err) {
		return ThreadBody{}, err
	}
	var out ThreadBody
	var attachmentFallback ThreadBody
	for {
		p, err := entity.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil && !message.IsUnknownCharset(err) {
			return out, err
		}
		part, err := readBodyPart(p)
		if err != nil {
			return out, err
		}
		target := &out
		if _, ok := p.Header.(*mail.AttachmentHeader); ok {
			target = &attachmentFallback
		}
		if part.HTML != "" && len(part.HTML) > len(target.HTML) {
			target.HTML = part.HTML
		}
		if part.Text != "" && !looksLikeCSSOnly(part.Text) {
			target.Text = part.Text
		} else if target.Text == "" {
			target.Text = part.Text
		}
	}
	if !threadBodyHasContent(out) {
		out = attachmentFallback
	}
	return out, nil
}

func readBodyPart(p *mail.Part) (ThreadBody, error) {
	switch h := p.Header.(type) {
	case *mail.InlineHeader:
		ct, _, _ := h.ContentType()
		return readBodyContent(ct, p.Body)
	case *mail.AttachmentHeader:
		ct, _, _ := h.ContentType()
		if strings.HasPrefix(ct, "text/html") || strings.HasPrefix(ct, "text/plain") {
			return readBodyContent(ct, p.Body)
		}
	}
	return ThreadBody{}, nil
}

func readBodyContent(ct string, body io.Reader) (ThreadBody, error) {
	if strings.HasPrefix(ct, "multipart/") {
		return collectBodyParts(body)
	}
	b, err := io.ReadAll(io.LimitReader(body, maxBodyBytes))
	if err != nil {
		return ThreadBody{}, err
	}
	raw := string(b)
	switch {
	case strings.HasPrefix(ct, "text/html"):
		return ThreadBody{HTML: raw}, nil
	case strings.HasPrefix(ct, "text/plain"):
		return ThreadBody{Text: raw}, nil
	default:
		return ThreadBody{}, nil
	}
}

func threadBodyHasContent(out ThreadBody) bool {
	return strings.TrimSpace(out.HTML) != "" || strings.TrimSpace(out.Text) != ""
}

func normalizeThreadBody(out ThreadBody) ThreadBody {
	out.Text = sanitizeUTF8(out.Text)
	out.HTML = sanitizeUTF8(out.HTML)
	if out.HTML == "" && strings.Contains(strings.ToLower(out.Text), "<html") {
		out.HTML = out.Text
	}
	if out.Text == "" && out.HTML != "" {
		out.Text = stripHTML(out.HTML)
	} else if looksLikeCSSOnly(out.Text) && out.HTML != "" {
		out.Text = stripHTML(out.HTML)
	}
	return out
}

// SnippetFromBody builds list preview text from parsed body parts.
func SnippetFromBody(text, html string) string {
	return snippet(text, html)
}

func snippetFromSubject(subject string) string {
	s := strings.Join(strings.Fields(strings.TrimSpace(subject)), " ")
	if len(s) > 200 {
		s = s[:200]
	}
	return sanitizeUTF8(s) // drops a rune split by the byte cut, and NUL
}

func snippet(text, html string) string {
	s := ""
	if html != "" {
		s = stripHTML(html)
	}
	if s == "" || looksLikeCSSOnly(s) {
		t := strings.TrimSpace(text)
		if t != "" && !looksLikeCSSOnly(t) {
			s = t
		}
	}
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 200 {
		s = s[:200]
	}
	return sanitizeUTF8(s) // drops a rune split by the byte cut, and NUL
}

// MarkRead sets \\Seen on one message in the given mailbox.
func MarkRead(c Credentials, mailbox string, uid uint32) error {
	cl, err := dial(c)
	if err != nil {
		return err
	}
	defer cl.Logout()
	return markReadOnClient(cl, mailbox, uid)
}

// MarkUnread clears \\Seen on one message in the given mailbox.
func MarkUnread(c Credentials, mailbox string, uid uint32) error {
	cl, err := dial(c)
	if err != nil {
		return err
	}
	defer cl.Logout()
	return markUnreadOnClient(cl, mailbox, uid)
}

func markReadOnClient(cl *client.Client, mailbox string, uid uint32) error {
	return storeFlagOnClient(cl, mailbox, uid, imap.AddFlags, imap.SeenFlag)
}

func markUnreadOnClient(cl *client.Client, mailbox string, uid uint32) error {
	return storeFlagOnClient(cl, mailbox, uid, imap.RemoveFlags, imap.SeenFlag)
}

func markStarredOnClient(cl *client.Client, mailbox string, uid uint32, starred bool) error {
	var op imap.FlagsOp = imap.AddFlags
	if !starred {
		op = imap.RemoveFlags
	}
	return storeFlagOnClient(cl, mailbox, uid, op, imap.FlaggedFlag)
}

func storeFlagOnClient(cl *client.Client, mailbox string, uid uint32, op imap.FlagsOp, flag string) error {
	if mailbox == "" {
		mailbox = "INBOX"
	}
	if _, err := cl.Select(mailbox, false); err != nil {
		return fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	seqset := new(imap.SeqSet)
	seqset.AddNum(uid)
	item := imap.FormatFlagsOp(op, true)
	return cl.UidStore(seqset, item, []interface{}{flag}, nil)
}

func stripHTML(s string) string {
	s = stripHTMLBlock(s, "style")
	s = stripHTMLBlock(s, "script")
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

func stripHTMLBlock(s, tag string) string {
	// Lower ASCII only: strings.ToLower can change byte length ('Ⱥ' 2 -> 3 bytes),
	// and indexes found in lower are used to slice s.
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	lower := string(b)
	open := "<" + tag
	close := "</" + tag + ">"
	for {
		start := strings.Index(lower, open)
		if start < 0 {
			return s
		}
		endRel := strings.Index(lower[start:], close)
		if endRel < 0 {
			return s[:start]
		}
		end := start + endRel + len(close)
		s = s[:start] + s[end:]
		lower = lower[:start] + lower[end:]
	}
}
