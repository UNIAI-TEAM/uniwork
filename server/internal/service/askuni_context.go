package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// What the asker puts in front of Ask UNI besides the question (spec
// 2026-10-16, ruling R9): one focus and up to askMentionsMax mentions. Every
// one is read as the asker, inside the asked workspace, before the turn
// streams, so an object they cannot read is the context-forbidden refusal
// and nothing is sent or stored.

const askMentionsMax = 5

// askMentionKinds are the kinds a mention may name; a focus may also be an
// email thread.
var askMentionKinds = []string{"task", "meeting", "document", "project", "room", "member"}

// askMentions checks the mentions of a request and returns the ones to read:
// a repeated object is read once, and the focus is not read again as a mention.
func askMentions(focus *ai.Focus, in []ai.Focus) ([]ai.Focus, error) {
	if len(in) > askMentionsMax {
		return nil, Invalid("tối đa 5 mention")
	}
	out := make([]ai.Focus, 0, len(in))
	for _, m := range in {
		if !slices.Contains(askMentionKinds, m.Kind) || strings.TrimSpace(m.ID) == "" {
			return nil, Invalid("mention không hợp lệ")
		}
		if (focus != nil && *focus == m) || slices.Contains(out, m) {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

// askRefs is what a turn was asked about, with the titles askContext read.
type askRefs struct {
	Focus       *AskContextRef
	Mentions    []AskContextRef
	Drive       *DriveContent
	DriveSource *ai.Source
}

// askContext reads the focus, then each mention, as numbered-source items in
// that order. A focus of a kind it does not know is skipped, as before. The
// refs carry the title of each object's first item, as read now.
func (s *AskUNIService) askContext(ctx context.Context, tc ai.ToolContext, focus *ai.Focus, mentions []ai.Focus) ([]agentItem, askRefs, error) {
	return s.askContextWithLocale(ctx, tc, focus, mentions, "")
}

func (s *AskUNIService) askContextWithLocale(ctx context.Context, tc ai.ToolContext, focus *ai.Focus, mentions []ai.Focus, locale string) ([]agentItem, askRefs, error) {
	var items []agentItem
	var refs askRefs
	for i, f := range append([]ai.Focus{{}}, mentions...) {
		if i == 0 {
			if focus == nil {
				continue
			}
			f = *focus
			if f.Kind == "drive_file" {
				it, src, dc, err := s.driveFileContext(ctx, tc, f.ID, locale)
				if err != nil {
					if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
						return nil, askRefs{}, ai.ErrContextForbidden
					}
					return nil, askRefs{}, err
				}
				items = append(items, it)
				refs.Focus = &AskContextRef{Kind: f.Kind, ID: f.ID, Title: it.Title}
				refs.Drive = dc
				refs.DriveSource = &src
				continue
			}
		}
		got, err := s.contextItems(ctx, tc, f)
		if err != nil {
			if code, ok := agentError(err); errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) || ok && code != "" {
				return nil, askRefs{}, ai.ErrContextForbidden
			}
			return nil, askRefs{}, err
		}
		items = append(items, got...)
		if len(got) == 0 {
			continue
		}
		ref := AskContextRef{Kind: f.Kind, ID: f.ID, Title: strings.TrimPrefix(got[0].Title, "Chat: ")}
		if i == 0 {
			refs.Focus = &ref
		} else {
			refs.Mentions = append(refs.Mentions, ref)
		}
	}
	return items, refs, nil
}

// contextItems reads one object. Whatever the read finds absent or hidden
// from the asker comes back as an error.
func (s *AskUNIService) contextItems(ctx context.Context, tc ai.ToolContext, f ai.Focus) ([]agentItem, error) {
	var srcs func(context.Context, ai.ToolContext, string) ([]ai.Source, error)
	switch f.Kind {
	case "task":
		src, foreign, err := s.taskSourceWithComments(ctx, tc, f.ID)
		if err != nil {
			return nil, err
		}
		it := sourceItem(src)
		it.Foreign = foreign
		return []agentItem{it}, nil
	case "meeting":
		src, summarised, err := s.meetingSourceWithSummary(ctx, tc, f.ID)
		if err != nil {
			return nil, err
		}
		it := sourceItem(src)
		it.Foreign = summarised
		return []agentItem{it}, nil
	case "email_thread":
		srcs = s.emailThreadContext
	case "document":
		return s.askTool(ctx, tc, s.agentGetDocument, "document_id", f.ID)
	case "project":
		return s.askTool(ctx, tc, s.agentGetProject, "project_id", f.ID)
	case "room":
		return s.roomContext(ctx, tc, f.ID)
	case "member":
		return s.mentionedMember(ctx, tc, f.ID)
	default:
		return nil, nil
	}
	found, err := srcs(ctx, tc, f.ID)
	items := make([]agentItem, 0, len(found))
	for _, src := range found {
		items = append(items, sourceItem(src))
	}
	// The rendered focus carries no href: the id lets the agent read the
	// meeting's transcript (get_meeting_transcript).
	if f.Kind == "meeting" && len(items) > 0 {
		items[0].Text += "\nMeeting ID: " + f.ID
	}
	return items, err
}

// askTool runs a read tool on one id. The MCP reads need the connector.
func (s *AskUNIService) askTool(ctx context.Context, tc ai.ToolContext, run agentRunFunc, arg, id string) ([]agentItem, error) {
	if s.reads == nil {
		return nil, errAskReadsNotWired
	}
	raw, _ := json.Marshal(map[string]string{arg: id})
	items, err := run(ctx, tc, raw)
	if err == nil && len(items) == 0 {
		err = ErrNotFound
	}
	return items, err
}

// roomContext is the room's latest messages; a room the asker is not in
// reads as absent. An empty room is still a source, from the room list.
func (s *AskUNIService) roomContext(ctx context.Context, tc ai.ToolContext, id string) ([]agentItem, error) {
	raw, _ := json.Marshal(map[string]string{"room_id": id, "query": ""})
	items, err := s.agentReadChatRoom(ctx, tc, raw)
	if err != nil || len(items) > 0 {
		return items, err
	}
	rooms, err := s.agentListChatRooms(ctx, tc, nil)
	if err != nil {
		return nil, err
	}
	for _, it := range rooms {
		if strings.HasSuffix(it.Href, "?room="+id) {
			return []agentItem{it}, nil
		}
	}
	return nil, ErrNotFound
}

// mentionedMember is a workspace member's name and role, nothing else: no
// email and no other account data.
func (s *AskUNIService) mentionedMember(ctx context.Context, tc ai.ToolContext, userID string) ([]agentItem, error) {
	rows, err := s.ws.Members(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.UserID == userID {
			it := personItem(base, r.UserID, r.DisplayName, "Role: "+r.Role)
			return []agentItem{it}, nil
		}
	}
	return nil, ErrNotFound
}

// driveUnavailableReader is the default DriveContentReader before B3 wires
// the concrete reader: it reports Drive unavailable without panicking.
type driveUnavailableReader struct{}

func (driveUnavailableReader) ReadForAI(context.Context, string, string, string, DriveContentPurpose) (DriveContent, error) {
	return DriveContent{}, ErrDriveUnavailable
}

// NewDriveUnavailableReader returns a nil-safe reader that always reports ErrDriveUnavailable.
func NewDriveUnavailableReader() DriveContentReader { return driveUnavailableReader{} }

// driveFileContext reads one Google Drive file focus once per request via
// DriveContentReader.ReadForAI. ErrDriveFileNotFound maps to 404 (not revealing
// existence); access, format and availability errors become a localized context
// note so the model answers explaining why the file could not be read (spec §9).
func (s *AskUNIService) driveFileContext(ctx context.Context, tc ai.ToolContext, driveFileID, locale string) (agentItem, ai.Source, *DriveContent, error) {
	id := strings.TrimSpace(driveFileID)
	if id == "" {
		return agentItem{}, ai.Source{}, nil, ErrNotFound
	}
	reader := s.drive
	if reader == nil {
		reader = driveUnavailableReader{}
	}
	dc, err := reader.ReadForAI(ctx, tc.ActorID, tc.WorkspaceID, id, DriveContentPurposeAskUni)
	var href string
	if s.q != nil {
		base, err := s.base(ctx, tc.WorkspaceID)
		if err != nil {
			return agentItem{}, ai.Source{}, nil, err
		}
		href = base + "/documents/drive/" + id
	}
	if err != nil {
		if errors.Is(err, ErrDriveFileNotFound) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
			return agentItem{}, ai.Source{}, nil, ErrNotFound
		}
		note, ok := driveReadErrorNote(err, locale)
		if !ok {
			return agentItem{}, ai.Source{}, nil, err
		}
		title := strings.TrimSpace(dc.Name)
		if title == "" {
			title = "Google Drive"
		}
		src := ai.Source{Kind: "drive_file", Title: title, Href: href, Excerpt: note}
		it := agentItem{Kind: "drive_file", ID: id, Key: "drive_file:" + id, Title: title, Href: "", Text: withText("ID: "+id, "Note: "+note), Body: note, Foreign: true}
		return it, src, nil, nil
	}
	title := strings.TrimSpace(dc.Name)
	if title == "" {
		title = "Google Drive"
	}
	fields := "ID: " + id
	if dc.MimeType != "" {
		fields += "\nMIME: " + dc.MimeType
	}
	body := dc.Text
	if dc.Truncated {
		truncNote := "Note: Only the first 200,000 characters of this Google Drive file were read."
		if strings.EqualFold(strings.TrimSpace(locale), "vi") {
			truncNote = "Ghi chú: UNI chỉ đọc 200.000 ký tự đầu của tệp Google Drive này."
		}
		fields += "\n" + truncNote
	}
	if len(dc.Attachments) > 0 && body == "" {
		pdfNote := "Attached as a PDF in this turn."
		if strings.EqualFold(strings.TrimSpace(locale), "vi") {
			pdfNote = "Tệp PDF được đính kèm trực tiếp trong lượt hỏi này."
		}
		body = pdfNote
	}
	src := ai.Source{Kind: "drive_file", Title: title, Href: href, Excerpt: body, MaxRunes: ai.MaxRecordExcerpt}
	it := agentItem{Kind: "drive_file", ID: id, Key: "drive_file:" + id, Title: title, Href: "", Text: withText(fields, body), Body: body, Foreign: true}
	return it, src, &dc, nil
}

func driveReadErrorNote(err error, locale string) (string, bool) {
	vi := strings.EqualFold(strings.TrimSpace(locale), "vi")
	switch {
	case errors.Is(err, ErrDriveAccessRequired):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_access_required): người hỏi chưa cấp quyền cho UniWork đọc tệp bằng tài khoản Google Drive của mình hoặc kết nối đã hết hạn.", true
		}
		return "Could not read this Google Drive file (drive_access_required): the asker has not granted UniWork access to read this file with their Google Drive account, or their connection needs reconnection.", true
	case errors.Is(err, ErrDriveGrantRequired):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_grant_required): người hỏi cần chọn lại tệp qua Google Picker để cấp quyền cho ứng dụng.", true
		}
		return "Could not read this Google Drive file (drive_grant_required): the asker must select the file in Google Picker to authorize the app.", true
	case errors.Is(err, ErrDriveFileNotAccessible):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_file_not_accessible): tài khoản Google Drive của người hỏi không còn quyền truy cập tệp này trên Google Drive.", true
		}
		return "Could not read this Google Drive file (drive_file_not_accessible): the asker's Google Drive account no longer has permission to access this file on Google Drive.", true
	case errors.Is(err, ErrDriveFormatUnsupported):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_format_unsupported): UNI chưa hỗ trợ đọc định dạng tệp này.", true
		}
		return "Could not read this Google Drive file (drive_format_unsupported): UNI does not support reading this file format yet.", true
	case errors.Is(err, ErrDriveExtractUnavailable):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_extract_unavailable): bộ trích xuất nội dung tài liệu hiện không khả dụng, vui lòng thử lại sau.", true
		}
		return "Could not read this Google Drive file (drive_extract_unavailable): the document text extractor is temporarily unavailable; please try again later.", true
	case errors.Is(err, ErrDriveUnavailable):
		if vi {
			return "Không đọc được tệp Google Drive này (drive_unavailable): kết nối Google Drive hiện không khả dụng, vui lòng thử lại sau.", true
		}
		return "Could not read this Google Drive file (drive_unavailable): Google Drive is temporarily unavailable; please try again later.", true
	default:
		return "", false
	}
}
