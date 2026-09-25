package imapclient

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

const maxAttachmentBytes = 25 << 20

// AttachmentMeta describes one downloadable IMAP body part.
type AttachmentMeta struct {
	PartID   string
	Filename string
	MimeType string
	Size     uint32
}

// FetchAttachment streams one attachment part for a UID in a mailbox.
func FetchAttachment(c Credentials, mailbox string, uid uint32, partID string) (AttachmentMeta, io.ReadCloser, error) {
	part, err := parsePartID(partID)
	if err != nil {
		return AttachmentMeta{}, nil, err
	}
	cl, err := dial(c)
	if err != nil {
		return AttachmentMeta{}, nil, err
	}
	if mailbox == "" {
		mailbox = "INBOX"
	}
	if _, err := cl.Select(mailbox, false); err != nil {
		_ = cl.Logout()
		return AttachmentMeta{}, nil, fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	seqset := new(imap.SeqSet)
	seqset.AddNum(uid)
	section := &imap.BodySectionName{BodyPartName: imap.BodyPartName{Path: part}}
	items := []imap.FetchItem{section.FetchItem(), imap.FetchBodyStructure}
	ch := make(chan *imap.Message, 1)
	if err := cl.UidFetch(seqset, items, ch); err != nil {
		_ = cl.Logout()
		return AttachmentMeta{}, nil, fmt.Errorf("imap uid fetch: %w", err)
	}
	msg, ok := <-ch
	if !ok || msg == nil {
		_ = cl.Logout()
		return AttachmentMeta{}, nil, fmt.Errorf("imap: message not found")
	}
	meta := AttachmentMeta{PartID: partID}
	if msg.BodyStructure != nil {
		if bs := bodyPartAt(msg.BodyStructure, part); bs != nil {
			meta.Filename = attachmentFilename(bs)
			meta.MimeType = mimeType(bs)
			meta.Size = bs.Size
		}
	}
	if meta.Size > maxAttachmentBytes {
		_ = cl.Logout()
		return AttachmentMeta{}, nil, fmt.Errorf("attachment exceeds %d bytes", maxAttachmentBytes)
	}
	r := msg.GetBody(section)
	if r == nil {
		_ = cl.Logout()
		return AttachmentMeta{}, nil, fmt.Errorf("imap: empty attachment body")
	}
	if meta.Filename == "" {
		meta.Filename = "attachment"
	}
	return meta, &fetchReadCloser{client: cl, reader: r}, nil
}

type fetchReadCloser struct {
	client *client.Client
	reader io.Reader
	closed bool
}

func (f *fetchReadCloser) Read(p []byte) (int, error) {
	return f.reader.Read(p)
}

func (f *fetchReadCloser) Close() error {
	if f.closed {
		return nil
	}
	f.closed = true
	return f.client.Logout()
}

func collectAttachments(bs *imap.BodyStructure, path []int, out *[]AttachmentMeta) {
	if bs == nil {
		return
	}
	if len(bs.Parts) == 0 {
		if isAttachmentPart(bs) {
			*out = append(*out, AttachmentMeta{
				PartID:   joinPartID(path),
				Filename: attachmentFilename(bs),
				MimeType: mimeType(bs),
				Size:     bs.Size,
			})
		}
		return
	}
	for i, child := range bs.Parts {
		childPath := append(append([]int(nil), path...), i+1)
		collectAttachments(child, childPath, out)
	}
}

func isAttachmentPart(bs *imap.BodyStructure) bool {
	disp := strings.ToLower(bs.Disposition)
	if disp == "attachment" {
		return true
	}
	if attachmentFilename(bs) != "" && disp != "inline" {
		return bs.MIMEType != "text" && bs.MIMEType != "multipart"
	}
	return false
}

func attachmentFilename(bs *imap.BodyStructure) string {
	if bs == nil {
		return ""
	}
	if bs.DispositionParams != nil {
		if fn := bs.DispositionParams["filename"]; fn != "" {
			return fn
		}
		if fn := bs.DispositionParams["name"]; fn != "" {
			return fn
		}
	}
	if bs.Params != nil {
		if fn := bs.Params["name"]; fn != "" {
			return fn
		}
	}
	return ""
}

func mimeType(bs *imap.BodyStructure) string {
	if bs == nil || bs.MIMEType == "" {
		return "application/octet-stream"
	}
	sub := bs.MIMESubType
	if sub == "" {
		return bs.MIMEType
	}
	return bs.MIMEType + "/" + sub
}

func joinPartID(path []int) string {
	if len(path) == 0 {
		return "1"
	}
	parts := make([]string, len(path))
	for i, n := range path {
		parts[i] = strconv.Itoa(n)
	}
	return strings.Join(parts, ".")
}

func parsePartID(partID string) ([]int, error) {
	partID = strings.TrimSpace(partID)
	if partID == "" {
		return nil, fmt.Errorf("empty part id")
	}
	segments := strings.Split(partID, ".")
	out := make([]int, 0, len(segments))
	for _, seg := range segments {
		n, err := strconv.Atoi(seg)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("invalid part id %q", partID)
		}
		out = append(out, n)
	}
	return out, nil
}

func bodyPartAt(bs *imap.BodyStructure, path []int) *imap.BodyStructure {
	cur := bs
	for _, idx := range path {
		if cur == nil || idx <= 0 || idx > len(cur.Parts) {
			return nil
		}
		cur = cur.Parts[idx-1]
	}
	return cur
}
