package imapclient

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-message/mail"
)

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
	Password string
}

// ThreadMeta is the metadata cached for one mailbox message.
type ThreadMeta struct {
	UID            uint32
	MessageID      string
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
		section.FetchItem(),
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

func dial(c Credentials) (*client.Client, error) {
	addr := fmt.Sprintf("%s:%d", c.Host, c.Port)
	cl, err := client.DialTLS(addr, nil)
	if err != nil {
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	if err := cl.Login(c.Email, c.Password); err != nil {
		_ = cl.Logout()
		return nil, fmt.Errorf("imap login: %w", err)
	}
	cl.Timeout = imapClientTimeout
	return cl, nil
}

func messageMeta(cl *client.Client, msg *imap.Message, section *imap.BodySectionName) ThreadMeta {
	meta := ThreadMeta{UID: msg.Uid}
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
	entity, err := mail.CreateReader(r)
	if err != nil {
		return ThreadBody{}, err
	}
	var out ThreadBody
	for {
		p, err := entity.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return out, err
		}
		part, err := readBodyPart(p)
		if err != nil {
			return out, err
		}
		if part.HTML != "" && len(part.HTML) > len(out.HTML) {
			out.HTML = part.HTML
		}
		if part.Text != "" && !looksLikeCSSOnly(part.Text) {
			out.Text = part.Text
		} else if out.Text == "" {
			out.Text = part.Text
		}
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
	out = repairQuotedPrintableBody(out.Text, out.HTML)
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
		return s[:200]
	}
	return s
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
		return s[:200]
	}
	return s
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

func markReadOnClient(cl *client.Client, mailbox string, uid uint32) error {
	return storeFlagOnClient(cl, mailbox, uid, imap.AddFlags, imap.SeenFlag)
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
	lower := strings.ToLower(s)
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
		lower = strings.ToLower(s)
	}
}
