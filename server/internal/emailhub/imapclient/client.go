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

// dialTCP opens the TCP connection. Package tests swap in a plain dialer
// because netguard refuses loopback.
var dialTCP = netguard.Dial

// tlsRootCAs is nil in production (system roots); package tests trust the
// fake server's self-signed certificate.
var tlsRootCAs *x509.CertPool

// greetingTimeout bounds what cl.Timeout cannot: the greeting, the implicit
// TLS handshake and the CAPABILITY client.New sends with no timeout set.
// A var only so a package test can shorten it.
var greetingTimeout = imapClientTimeout

func dial(c Credentials) (*client.Client, error) {
	conn, err := dialTCP(context.Background(), "tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.Port)))
	if err != nil {
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	cfg := &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, RootCAs: tlsRootCAs}
	starttls := c.Security == "starttls"
	if !starttls {
		conn = tls.Client(conn, cfg) // "tls", and "" for rows written before the column existed
	}
	if err := conn.SetDeadline(time.Now().Add(greetingTimeout)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	held := &deadlineHeldConn{Conn: conn}
	held.hold.Store(true)
	cl, err := client.New(held)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("imap greeting: %w", err)
	}
	held.hold.Store(false)
	_ = conn.SetDeadline(time.Time{})
	cl.Timeout = imapClientTimeout
	if starttls {
		// cl.StartTLS handshakes without cl.Timeout and go-imap rewrites conn
		// deadlines per command, so a deadline would not stick: close on a timer.
		stall := time.AfterFunc(greetingTimeout, func() { _ = conn.Close() })
		err := startTLS(cl, cfg)
		stall.Stop()
		if err != nil {
			_ = conn.Close() // Logout would wait on a stalled handshake
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
		_ = cl.Logout()
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

// deadlineHeldConn ignores go-imap's deadline calls while hold is set:
// client.New may send CAPABILITY with Timeout 0, which would clear the
// greeting deadline and let a server that greets and then stalls hang dial.
type deadlineHeldConn struct {
	net.Conn
	hold atomic.Bool
}

func (c *deadlineHeldConn) SetDeadline(t time.Time) error {
	if c.hold.Load() {
		return nil
	}
	return c.Conn.SetDeadline(t)
}

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
