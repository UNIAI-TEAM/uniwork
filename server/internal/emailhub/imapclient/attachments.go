package imapclient

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/emersion/go-imap"
)

// AttachmentMeta describes one downloadable IMAP body part.
type AttachmentMeta struct {
	PartID   string
	Filename string
	MimeType string
	Size     uint32
}

// FetchAttachment reads one attachment part of a UID on this session and
// returns its original bytes (Content-Transfer-Encoding decoded). It reads the
// whole part so the caller can close the session, and free its global slot,
// before streaming to a client that may be slow.
func (s *Session) FetchAttachment(mailbox string, uid uint32, partID string) (AttachmentMeta, []byte, error) {
	if s.cl == nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap: session closed")
	}
	part, err := parsePartID(partID)
	if err != nil {
		return AttachmentMeta{}, nil, err
	}
	if mailbox == "" {
		mailbox = "INBOX"
	}
	if _, err := s.cl.Select(mailbox, false); err != nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap select %s: %w", mailbox, err)
	}
	seqset := new(imap.SeqSet)
	seqset.AddNum(uid)
	section := &imap.BodySectionName{BodyPartName: imap.BodyPartName{Path: part}}
	items := []imap.FetchItem{section.FetchItem(), imap.FetchBodyStructure}
	ch := make(chan *imap.Message, 1)
	if err := s.cl.UidFetch(seqset, items, ch); err != nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap uid fetch: %w", err)
	}
	msg, ok := <-ch
	if !ok || msg == nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap: message not found")
	}
	meta := AttachmentMeta{PartID: partID, Filename: "attachment"}
	encoding := ""
	if bs := bodyPartAt(msg.BodyStructure, part); bs != nil {
		if fn := attachmentFilename(bs); fn != "" {
			meta.Filename = fn
		}
		meta.MimeType = mimeType(bs)
		meta.Size = bs.Size
		encoding = bs.Encoding
	}
	r := msg.GetBody(section)
	if r == nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap: empty attachment body")
	}
	// BODY[part] keeps the transfer encoding (RFC 3501); the user wants the file.
	data, err := io.ReadAll(decodeTransferEncoding(r, encoding))
	if err != nil {
		return AttachmentMeta{}, nil, fmt.Errorf("imap attachment decode: %w", err)
	}
	return meta, data, nil
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
	// Params are decoded encoded-words: NUL or bad bytes would fail the insert.
	for _, fn := range []string{bs.DispositionParams["filename"], bs.DispositionParams["name"], bs.Params["name"]} {
		if fn != "" {
			return sanitizeUTF8(fn)
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
