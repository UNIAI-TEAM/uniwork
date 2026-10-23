package imapclient

import (
	"fmt"
	"io"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

func findMIMEPath(bs *imap.BodyStructure, path []int, mimeType, subType string) []int {
	all := findAllMIMEPaths(bs, path, mimeType, subType)
	if len(all) == 0 {
		return nil
	}
	return all[0]
}

func findAllMIMEPaths(bs *imap.BodyStructure, path []int, mimeType, subType string) [][]int {
	if bs == nil {
		return nil
	}
	if len(bs.Parts) == 0 {
		if equalMIME(bs.MIMEType, mimeType) && equalMIME(bs.MIMESubType, subType) {
			out := make([]int, len(path))
			copy(out, path)
			return [][]int{out}
		}
		return nil
	}
	var found [][]int
	for i, child := range bs.Parts {
		childPath := append(append([]int(nil), path...), i+1)
		found = append(found, findAllMIMEPaths(child, childPath, mimeType, subType)...)
	}
	return found
}

func pickLargestMIMEPathBySize(root *imap.BodyStructure, mimeType, subType string) []int {
	var best []int
	var bestSize uint32
	for _, path := range findAllMIMEPaths(root, nil, mimeType, subType) {
		part := bodyStructureAt(root, path)
		if part == nil {
			continue
		}
		if part.Size > bestSize {
			bestSize = part.Size
			best = path
		}
	}
	return best
}

func fetchLargestMIMEPart(cl *client.Client, seqset *imap.SeqSet, root *imap.BodyStructure, mimeType, subType string) string {
	paths := findAllMIMEPaths(root, nil, mimeType, subType)
	if len(paths) == 0 {
		return ""
	}
	best := ""
	for _, path := range paths {
		raw, err := fetchBodySection(cl, seqset, root, path)
		if err != nil || strings.TrimSpace(raw) == "" {
			continue
		}
		if len(raw) > len(best) {
			best = raw
		}
	}
	return best
}

func equalMIME(a, b string) bool {
	return len(a) == len(b) && (a == b || equalFoldASCII(a, b))
}

func equalFoldASCII(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

// extractThreadBody loads HTML/plain for sync. Prefer the body already fetched in
// the same IMAP response before issuing extra section fetches.
func extractThreadBody(cl *client.Client, msg *imap.Message, peekSection *imap.BodySectionName) ThreadBody {
	if msg == nil {
		return ThreadBody{}
	}
	if peekSection != nil {
		if r := msg.GetBody(peekSection); r != nil {
			if body, err := parseBody(io.LimitReader(r, maxBodyBytes)); err == nil {
				out := normalizeThreadBody(body)
				if threadBodyHasContent(out) {
					return out
				}
			}
		}
	}
	var out ThreadBody
	if cl != nil && msg.Uid > 0 && msg.BodyStructure != nil {
		seqset := new(imap.SeqSet)
		seqset.AddNum(msg.Uid)
		out.HTML = fetchLargestMIMEPart(cl, seqset, msg.BodyStructure, "text", "html")
		if out.HTML == "" {
			out.Text = fetchLargestMIMEPart(cl, seqset, msg.BodyStructure, "text", "plain")
		}
	}
	return normalizeThreadBody(out)
}

func fetchBodyOnClient(cl *client.Client, mailbox string, uid uint32) (ThreadBody, error) {
	if mailbox == "" {
		mailbox = "INBOX"
	}
	if _, err := cl.Select(mailbox, false); err != nil {
		return ThreadBody{}, fmt.Errorf("imap select %s: %w", mailbox, err)
	}

	seqset := new(imap.SeqSet)
	seqset.AddNum(uid)
	peekSection := &imap.BodySectionName{Peek: true}
	ch := make(chan *imap.Message, 1)
	if err := cl.UidFetch(seqset, []imap.FetchItem{imap.FetchBodyStructure, peekSection.FetchItem()}, ch); err != nil {
		return ThreadBody{}, fmt.Errorf("imap uid fetch: %w", err)
	}
	msg, ok := <-ch
	if !ok || msg == nil {
		return ThreadBody{}, fmt.Errorf("imap: message not found")
	}

	out := extractThreadBody(cl, msg, peekSection)
	if !threadBodyHasContent(out) {
		fullSection := &imap.BodySectionName{Peek: true}
		ch = make(chan *imap.Message, 1)
		if err := cl.UidFetch(seqset, []imap.FetchItem{fullSection.FetchItem()}, ch); err != nil {
			return ThreadBody{}, fmt.Errorf("imap uid fetch body: %w", err)
		}
		msg, ok = <-ch
		if !ok || msg == nil {
			return ThreadBody{}, fmt.Errorf("imap: message not found")
		}
		if r := msg.GetBody(fullSection); r != nil {
			if parsed, err := parseBody(io.LimitReader(r, maxBodyBytes)); err == nil {
				out = normalizeThreadBody(parsed)
			}
		}
	}
	if !threadBodyHasContent(out) {
		return ThreadBody{}, fmt.Errorf("imap: empty body")
	}
	return out, nil
}

func fetchBodySection(cl *client.Client, seqset *imap.SeqSet, root *imap.BodyStructure, path []int) (string, error) {
	section := &imap.BodySectionName{Peek: true, BodyPartName: imap.BodyPartName{Path: path}}
	ch := make(chan *imap.Message, 1)
	if err := cl.UidFetch(seqset, []imap.FetchItem{section.FetchItem()}, ch); err != nil {
		return "", err
	}
	msg, ok := <-ch
	if !ok || msg == nil {
		return "", fmt.Errorf("imap: message not found")
	}
	r := msg.GetBody(section)
	if r == nil {
		return "", fmt.Errorf("imap: empty section")
	}
	b, err := io.ReadAll(io.LimitReader(r, maxBodyBytes))
	if err != nil {
		return "", err
	}
	encoding := ""
	if part := bodyStructureAt(root, path); part != nil {
		encoding = part.Encoding
	}
	decoded, err := decodeBodyContent(b, encoding)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}
