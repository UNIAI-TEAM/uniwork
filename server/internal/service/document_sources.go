package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Documents "other sources" (UNI-1305 item C): the files that already live in
// Chat, Tasks, Meetings and Email Hub, listed on the documents home, read
// through and copied into a new file document.
//
// Authorization is the owning domain's, twice. The list queries
// (queries/document_sources.sql) restate each domain's read gate in SQL, so a
// page of 50 is four keyset queries with no per-row check and no row the
// domain would refuse; download and save look the row up through the same
// query and then open the bytes through the domain's own Open, which runs its
// gate again. Any refusal on that path answers not_found: a member learns
// nothing about a private room's or someone else's mailbox's files.
//
// A source file id is "<source>:<row id>" - the chat message, the attachment
// row, the meeting recording or the Email Hub attachment row.

// Source names, as the API spells them.
const (
	DocumentSourceChat    = "chat"
	DocumentSourceTask    = "task"
	DocumentSourceMeeting = "meeting"
	DocumentSourceEmail   = "email"
)

var documentSourceOrder = []string{DocumentSourceChat, DocumentSourceTask, DocumentSourceMeeting, DocumentSourceEmail}

// Paging limits of GET .../documents/sources.
const (
	DocumentSourceDefaultLimit = 50
	DocumentSourceMaxLimit     = 100
)

// documentSourceTypeExts maps a type filter onto file extensions.
var documentSourceTypeExts = map[string][]string{
	"docx": {"docx", "doc"},
	"xlsx": {"xlsx", "xls"},
	"pptx": {"pptx", "ppt"},
	"pdf":  {"pdf"},
	"md":   {"md", "markdown"},
	"html": {"html", "htm"},
}

// documentSourceAllExts is the whole source set: the document kinds only
// (UNI-1967). Images, archives and every other attachment are not sources, so
// the list, the lookup behind Open/ViewSource/Save and the frame mint all
// filter by it.
var documentSourceAllExts = func() []string {
	all := []string{"txt"}
	for _, exts := range documentSourceTypeExts {
		all = append(all, exts...)
	}
	sort.Strings(all)
	return all
}()

// documentSourceAppExts are the formats the Office app opens (view-only for a
// source file).
var documentSourceAppExts = map[string]bool{
	"docx": true, "xlsx": true, "pptx": true, "pdf": true, "md": true, "html": true, "txt": true,
}

// DocumentSourceService composes the four domains. Each domain service may be
// nil (or unconfigured): its source is then left out of the list and its ids
// answer not_found.
type DocumentSourceService struct {
	docs     *DocumentService
	q        *db.Queries
	chat     *ChatService
	tasks    *TaskService
	meetings *MeetingService
	email    *EmailHubService
}

// DocumentSourceDeps wires a DocumentSourceService.
type DocumentSourceDeps struct {
	Documents *DocumentService
	Chat      *ChatService
	Tasks     *TaskService
	Meetings  *MeetingService
	EmailHub  *EmailHubService
}

// NewDocumentSourceService returns nil without the document service.
func NewDocumentSourceService(d DocumentSourceDeps) *DocumentSourceService {
	if d.Documents == nil {
		return nil
	}
	return &DocumentSourceService{
		docs: d.Documents, q: d.Documents.q,
		chat: d.Chat, tasks: d.Tasks, meetings: d.Meetings, email: d.EmailHub,
	}
}

// DocumentSourceFilter is the query of one list page.
type DocumentSourceFilter struct {
	Source string
	Type   string
	Q      string
	Cursor string
	Limit  int
	// Sort is the optional column sort (UNI-2038 S3): updated is the file's
	// sort date, name its file name, size its bytes, editor the sender or
	// uploader. The zero value keeps today's order and cursor.
	Sort DocumentSort
}

// DocumentSourceParent is where a source file lives. Ref is internal: the
// task id of a comment attachment, the mailbox of an email attachment.
type DocumentSourceParent struct {
	Kind      string
	ID        string
	Title     string
	Ref       string
	MessageID string // chat file: the message that carries the attachment
}

// DocumentSourceOwner is who put the file there; nil for email.
type DocumentSourceOwner struct {
	ID   string
	Kind string
	Name string
}

// DocumentSourceItem is one listed file.
type DocumentSourceItem struct {
	ID           string
	Source       string
	Parent       DocumentSourceParent
	Name         string
	MimeType     string
	Extension    string
	SizeBytes    int64
	UpdatedAt    time.Time
	Owner        *DocumentSourceOwner
	CanOpenInApp bool
	// CanSave is whether Save can turn the file into a document: the same
	// verdict the document upload would give (documentSourceSaveable).
	CanSave bool
	rowID   string
	// Sort keys the list query computed (UNI-2038 S3): the name under the
	// Vietnamese collation and the sender's display name; editorNull is a row
	// with no human name (an agent, email, a removed account).
	nameKey    string
	editorKey  string
	editorNull bool
	// keyRank orders nameKey or editorKey across the merged pages under the
	// database's collation (rankSourceKeys); only a name or editor sort sets it.
	keyRank int
}

// DocumentSourcePage is one list page; NextCursor is empty on the last one.
type DocumentSourcePage struct {
	Items      []DocumentSourceItem
	NextCursor string
}

type documentSourceQuery struct {
	orgID, workspaceID, viewerID string
	cursorAt                     pgtype.Timestamptz
	cursorID                     pgtype.Text
	q                            pgtype.Text
	typeMode                     string
	typeExts                     []string
	limit                        int32
	rowID                        pgtype.Text
	sort                         documentSortArgs
}

// List answers GET .../documents/sources.
func (s *DocumentSourceService) List(ctx context.Context, actor Actor, workspaceID string, f DocumentSourceFilter) (DocumentSourcePage, error) {
	ws, err := s.gate(ctx, actor, workspaceID)
	if err != nil {
		return DocumentSourcePage{}, err
	}
	sources, err := documentSourcesFor(f.Source)
	if err != nil {
		return DocumentSourcePage{}, err
	}
	limit := f.Limit
	switch {
	case limit <= 0:
		limit = DocumentSourceDefaultLimit
	case limit > DocumentSourceMaxLimit:
		limit = DocumentSourceMaxLimit
	}
	dq := documentSourceQuery{orgID: ws.OrganizationID, workspaceID: workspaceID, viewerID: actor.ID, limit: int32(limit + 1)}
	if dq.typeMode, dq.typeExts, err = documentSourceTypeFilter(f.Type); err != nil {
		return DocumentSourcePage{}, err
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		if len([]rune(q)) > 200 {
			return DocumentSourcePage{}, Invalid("q tối đa 200 ký tự")
		}
		// The queries compare uw_fold_search(name) with the folded term, so
		// "hop dong" finds "Hợp đồng" (foldForSearch and the SQL function are
		// held together by TestDocumentSourceFoldAgreesWithGo).
		if folded := foldForSearch(q); folded != "" {
			dq.q = pgtype.Text{String: escapeLikePattern(folded), Valid: true}
		}
	}
	if f.Cursor != "" {
		if sc, ok := decodeSortedDocumentSourceCursor(f.Cursor); ok {
			if err := sc.CheckAgainst(f.Sort); err != nil {
				return DocumentSourcePage{}, err
			}
			dq.sort = sortArgs(f.Sort, sc.DocumentSortCursor, &sc.At, sc.ID)
		} else {
			if f.Sort.Active() {
				return DocumentSourcePage{}, Invalid("cursor không dùng được với sort/order này")
			}
			at, id, ok := decodeDocumentSourceCursor(f.Cursor)
			if !ok {
				return DocumentSourcePage{}, Invalid("cursor không hợp lệ")
			}
			dq.cursorAt = pgtype.Timestamptz{Time: at, Valid: true}
			dq.cursorID = pgtype.Text{String: id, Valid: true}
		}
	}
	if f.Sort.Active() && !dq.sort.key.Valid {
		dq.sort = sortArgs(f.Sort, DocumentSortCursor{}, nil, "")
	}
	var all []DocumentSourceItem
	for _, src := range sources {
		items, err := s.query(ctx, src, dq)
		if err != nil {
			return DocumentSourcePage{}, err
		}
		all = append(all, items...)
	}
	before := documentSourceBefore
	if f.Sort.Active() {
		if err := s.rankSourceKeys(ctx, f.Sort, all); err != nil {
			return DocumentSourcePage{}, err
		}
		before = documentSourceSortedBefore(f.Sort)
	}
	sort.SliceStable(all, func(i, j int) bool { return before(all[i], all[j]) })
	page := DocumentSourcePage{Items: all}
	if len(all) > limit {
		page.Items = all[:limit]
		last := page.Items[limit-1]
		if f.Sort.Active() {
			page.NextCursor = encodeSortedDocumentSourceCursor(f.Sort, last)
		} else {
			page.NextCursor = encodeDocumentSourceCursor(last.UpdatedAt, last.ID)
		}
	}
	if page.Items == nil {
		page.Items = []DocumentSourceItem{}
	}
	return page, nil
}

// DocumentSourceFile is an opened source file. The caller closes Body. Size
// is the exact byte length of Body, or -1 when it is not known up front.
type DocumentSourceFile struct {
	Item DocumentSourceItem
	Body io.ReadCloser
	Size int64
}

// Open answers the download: the row through the list gate, then the bytes
// through the owning domain's own Open.
func (s *DocumentSourceService) Open(ctx context.Context, actor Actor, workspaceID, sourceFileID string) (DocumentSourceFile, error) {
	ws, err := s.gate(ctx, actor, workspaceID)
	if err != nil {
		return DocumentSourceFile{}, err
	}
	item, err := s.lookup(ctx, actor, ws, sourceFileID)
	if err != nil {
		return DocumentSourceFile{}, err
	}
	return s.openItem(ctx, actor, workspaceID, item)
}

// ViewSource is the metadata half of Open, for the Office frame's mint and
// open answer (UNI-1869): the same gate and lookup, without reading a byte.
// Email's Open fetches over IMAP, so the mint must not pay for bytes it will
// not use; the token grants nothing, and every frame read runs Open again.
// A refusal is not_found, exactly as on the download path, so a member never
// learns whether a file they cannot read exists.
func (s *DocumentSourceService) ViewSource(ctx context.Context, actor Actor, workspaceID, sourceFileID string) (db.Workspace, DocumentSourceItem, error) {
	ws, err := s.gate(ctx, actor, workspaceID)
	if err != nil {
		return db.Workspace{}, DocumentSourceItem{}, hideSourceRefusal(err)
	}
	item, err := s.lookup(ctx, actor, ws, sourceFileID)
	if err != nil {
		return db.Workspace{}, DocumentSourceItem{}, hideSourceRefusal(err)
	}
	return ws, item, nil
}

// openItem opens the bytes of a row the list gate already admitted.
func (s *DocumentSourceService) openItem(ctx context.Context, actor Actor, workspaceID string, item DocumentSourceItem) (DocumentSourceFile, error) {
	body, size, err := s.openBytes(ctx, actor, workspaceID, item)
	if err != nil {
		return DocumentSourceFile{}, hideSourceRefusal(err)
	}
	return DocumentSourceFile{Item: item, Body: body, Size: size}, nil
}

// SaveSourceFileInput is POST .../documents/sources/{id}/save.
type SaveSourceFileInput struct {
	ParentID       string
	Title          string
	IdempotencyKey string
}

// Save copies the source bytes into a new file document: the bytes are read
// through Open (the domain's gate) and uploaded as a new FileService file, so
// the document never references the source's file and outlives it. The
// create is CreateFileDocument's - parent check, quota, audit and the
// document.created outbox row in one transaction, Idempotency-Key replay -
// with the source id recorded on the audit row.
//
// Two refusals come before any byte is read: a file the document upload would
// refuse (can_save false) answers 422 source_not_saveable, and a parent the
// caller cannot put a document under answers as the upload's pre-flight does,
// so a wrong request costs no IMAP/object read and leaves no staged file.
func (s *DocumentSourceService) Save(ctx context.Context, actor Actor, workspaceID, sourceFileID string, in SaveSourceFileInput) (DocumentFileResult, error) {
	ws, err := s.gate(ctx, actor, workspaceID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	item, err := s.lookup(ctx, actor, ws, sourceFileID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if !item.CanSave {
		return DocumentFileResult{}, errSourceNotSaveable()
	}
	parentID := strings.TrimSpace(in.ParentID)
	if parentID != "" {
		if err := s.docs.authorizeParentIn(ctx, actor, parentID, workspaceID); err != nil {
			return DocumentFileResult{}, err
		}
	}
	f, err := s.openItem(ctx, actor, workspaceID, item)
	if err != nil {
		return DocumentFileResult{}, err
	}
	defer f.Body.Close()
	return s.docs.CreateFileDocument(ctx, actor, workspaceID, CreateFileDocumentInput{
		ParentID:       parentID,
		Title:          strings.TrimSpace(in.Title),
		Filename:       f.Item.Name,
		Body:           f.Body,
		IdempotencyKey: in.IdempotencyKey,
		sourceFileID:   f.Item.ID,
	})
}

// gate is the workspace gate every route runs first. Agents do not read
// other domains' files through this surface.
func (s *DocumentSourceService) gate(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return db.Workspace{}, ErrForbidden
	}
	if _, err := s.docs.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		return db.Workspace{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return ws, err
}

func (s *DocumentSourceService) lookup(ctx context.Context, actor Actor, ws db.Workspace, sourceFileID string) (DocumentSourceItem, error) {
	src, rowID, ok := strings.Cut(strings.TrimSpace(sourceFileID), ":")
	if !ok || rowID == "" || len(rowID) > 64 {
		return DocumentSourceItem{}, ErrNotFound
	}
	dq := documentSourceQuery{
		orgID: ws.OrganizationID, workspaceID: ws.ID, viewerID: actor.ID, limit: 1, typeMode: "ext", typeExts: documentSourceAllExts,
		rowID: pgtype.Text{String: rowID, Valid: true},
	}
	items, err := s.query(ctx, src, dq)
	if err != nil {
		return DocumentSourceItem{}, err
	}
	if len(items) == 0 {
		return DocumentSourceItem{}, ErrNotFound
	}
	return items[0], nil
}

// enabled reports whether a source's domain is wired and can serve bytes.
func (s *DocumentSourceService) enabled(src string) bool {
	switch src {
	case DocumentSourceChat:
		return s.chat != nil && s.chat.FilesService() != nil
	case DocumentSourceTask:
		return s.tasks != nil
	case DocumentSourceMeeting:
		return s.meetings != nil && s.meetings.FileServiceEnabled()
	case DocumentSourceEmail:
		return s.email != nil && s.email.Enabled()
	}
	return false
}

func (s *DocumentSourceService) query(ctx context.Context, src string, dq documentSourceQuery) ([]DocumentSourceItem, error) {
	if !s.enabled(src) {
		return nil, nil
	}
	var rows []db.ListDocumentSourceChatFilesRow
	switch src {
	case DocumentSourceChat:
		got, err := s.q.ListDocumentSourceChatFiles(ctx, db.ListDocumentSourceChatFilesParams{
			CursorAt: dq.cursorAt, CursorID: dq.cursorID, Q: dq.q, TypeMode: dq.typeMode, TypeExts: dq.typeExts,
			RowLimit: dq.limit, ViewerID: dq.viewerID, OrganizationID: dq.orgID, WorkspaceID: dq.workspaceID, RowID: dq.rowID,
			SortKey: dq.sort.key, SortDesc: dq.sort.desc, SortCursorID: dq.sort.id, SortCursorAt: dq.sort.at,
			SortCursorNum: dq.sort.num, SortCursorText: dq.sort.text, SortCursorNull: dq.sort.null,
		})
		if err != nil {
			return nil, err
		}
		rows = got
	case DocumentSourceTask:
		got, err := s.q.ListDocumentSourceTaskFiles(ctx, db.ListDocumentSourceTaskFilesParams{
			CursorAt: dq.cursorAt, CursorID: dq.cursorID, Q: dq.q, TypeMode: dq.typeMode, TypeExts: dq.typeExts,
			RowLimit: dq.limit, OrganizationID: dq.orgID, WorkspaceID: dq.workspaceID, RowID: dq.rowID,
			SortKey: dq.sort.key, SortDesc: dq.sort.desc, SortCursorID: dq.sort.id, SortCursorAt: dq.sort.at,
			SortCursorNum: dq.sort.num, SortCursorText: dq.sort.text, SortCursorNull: dq.sort.null,
		})
		if err != nil {
			return nil, err
		}
		for _, r := range got {
			rows = append(rows, db.ListDocumentSourceChatFilesRow(r))
		}
	case DocumentSourceMeeting:
		got, err := s.q.ListDocumentSourceMeetingFiles(ctx, db.ListDocumentSourceMeetingFilesParams{
			CursorAt: dq.cursorAt, CursorID: dq.cursorID, Q: dq.q, TypeMode: dq.typeMode, TypeExts: dq.typeExts,
			RowLimit: dq.limit, OrganizationID: dq.orgID, WorkspaceID: dq.workspaceID, RowID: dq.rowID,
			SortKey: dq.sort.key, SortDesc: dq.sort.desc, SortCursorID: dq.sort.id, SortCursorAt: dq.sort.at,
			SortCursorNum: dq.sort.num, SortCursorText: dq.sort.text, SortCursorNull: dq.sort.null,
		})
		if err != nil {
			return nil, err
		}
		for _, r := range got {
			rows = append(rows, db.ListDocumentSourceChatFilesRow(r))
		}
	case DocumentSourceEmail:
		got, err := s.q.ListDocumentSourceEmailFiles(ctx, db.ListDocumentSourceEmailFilesParams{
			CursorAt: dq.cursorAt, CursorID: dq.cursorID, Q: dq.q, TypeMode: dq.typeMode, TypeExts: dq.typeExts,
			RowLimit: dq.limit, ViewerID: dq.viewerID, OrganizationID: dq.orgID, RowID: dq.rowID,
			SortKey: dq.sort.key, SortDesc: dq.sort.desc, SortCursorID: dq.sort.id, SortCursorAt: dq.sort.at,
			SortCursorNum: dq.sort.num, SortCursorText: dq.sort.text, SortCursorNull: dq.sort.null,
		})
		if err != nil {
			return nil, err
		}
		for _, r := range got {
			rows = append(rows, db.ListDocumentSourceChatFilesRow(r))
		}
	default:
		return nil, nil
	}
	policy := s.docs.documentFilePolicy()
	txtOpen := s.docs.txtOpenEnabled(ctx, dq.viewerID, dq.workspaceID, dq.orgID)
	out := make([]DocumentSourceItem, 0, len(rows))
	for _, r := range rows {
		it := documentSourceItem(src, r, policy)
		if it.Extension == "txt" && !txtOpen {
			it.CanOpenInApp = false
		}
		out = append(out, it)
	}
	return out, nil
}

func documentSourceItem(src string, r db.ListDocumentSourceChatFilesRow, docPolicy files.Policy) DocumentSourceItem {
	ext := documentSourceExtension(r.Name)
	item := DocumentSourceItem{
		ID: r.SourceID, Source: src, Name: r.Name, MimeType: r.MimeType, Extension: ext,
		SizeBytes: r.SizeBytes, UpdatedAt: r.SortAt.Time.UTC(), CanOpenInApp: documentSourceAppExts[ext],
		CanSave: documentSourceSaveable(docPolicy, ext, r.MimeType, r.SizeBytes),
		Parent:  DocumentSourceParent{Kind: documentSourceParentKind(r.ParentKind), ID: r.ParentID, Title: r.ParentTitle, Ref: r.ParentRef},
		rowID:   r.RowID,
		nameKey: r.NameKey, editorKey: r.EditorKey, editorNull: r.EditorNull,
	}
	// A task comment's file links to its task: the comment is read there.
	if item.Parent.Kind == "task_comment" && r.ParentRef != "" {
		item.Parent.ID = r.ParentRef
	}
	if src == DocumentSourceChat && r.RowID != "" {
		item.Parent.MessageID = r.RowID
	}
	if r.OwnerID != "" {
		item.Owner = &DocumentSourceOwner{ID: r.OwnerID, Kind: documentSourceOwnerKind(r.OwnerKind), Name: r.OwnerName}
	}
	return item
}

// documentSourceParentKind maps chat room kinds onto the two parent kinds the
// API names; the other sources already speak the API's words.
func documentSourceParentKind(kind string) string {
	switch kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		return "chat_channel"
	case chatRoomKindDM, chatRoomKindGroup:
		return "chat_dm"
	default:
		return kind
	}
}

// documentSourceOwnerKind maps the domains' actor columns (sender_kind,
// uploader_type "member") onto human|agent|system.
func documentSourceOwnerKind(kind string) string {
	switch kind {
	case "agent", "system":
		return kind
	default:
		return "human"
	}
}

// openBytes opens a row's bytes through its domain's own Open and reports the
// exact length when the source measured it: the stored size of a FileService
// file (chat, meeting, task), the decoded length of an email part (the size
// IMAP lists is the encoded one, so it is not used). -1 means unknown.
func (s *DocumentSourceService) openBytes(ctx context.Context, actor Actor, workspaceID string, item DocumentSourceItem) (io.ReadCloser, int64, error) {
	known := int64(-1)
	if item.SizeBytes > 0 {
		known = item.SizeBytes
	}
	switch item.Source {
	case DocumentSourceChat:
		_, rd, err := s.chat.OpenChatFileMessage(ctx, actor.ID, workspaceID, item.Parent.ID, item.rowID, false)
		if err != nil {
			return nil, -1, err
		}
		if rd.Body == nil {
			return nil, -1, ErrNotFound
		}
		return rd.Body, known, nil
	case DocumentSourceTask:
		att, rc, err := s.tasks.OpenAttachmentContent(ctx, actor, item.rowID)
		if err != nil {
			return nil, -1, err
		}
		if att.WorkspaceID != workspaceID {
			_ = rc.Close()
			return nil, -1, ErrNotFound
		}
		return rc, known, nil
	case DocumentSourceMeeting:
		rc, err := s.meetings.OpenMeetingRecording(ctx, actor.ID, "", item.Parent.ID, item.rowID, 0, 0)
		if err != nil {
			return nil, -1, err
		}
		return rc, known, nil
	case DocumentSourceEmail:
		_, data, err := s.email.OpenAttachment(ctx, actor, workspaceID, item.Parent.Ref, item.Parent.ID, item.rowID)
		if err != nil {
			return nil, -1, err
		}
		return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
	}
	return nil, -1, ErrNotFound
}

// hideSourceRefusal turns a domain's refusal into not_found, so the open path
// never tells a member that a file they cannot read exists.
func hideSourceRefusal(err error) error {
	if errors.Is(err, ErrForbidden) {
		return ErrNotFound
	}
	var ce CodedError
	if errors.As(err, &ce) && (ce.Status == http.StatusForbidden || ce.Status == http.StatusNotFound) {
		return ErrNotFound
	}
	return err
}

func documentSourcesFor(source string) ([]string, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return documentSourceOrder, nil
	}
	for _, s := range documentSourceOrder {
		if s == source {
			return []string{s}, nil
		}
	}
	return nil, Invalid("source phải là chat, task, meeting hoặc email")
}

func documentSourceTypeFilter(t string) (string, []string, error) {
	t = strings.TrimSpace(t)
	if t == "" {
		return "ext", documentSourceAllExts, nil
	}
	if exts, ok := documentSourceTypeExts[t]; ok {
		return "ext", exts, nil
	}
	return "", nil, Invalid("type phải là docx, xlsx, pptx, pdf, md hoặc html")
}

func documentSourceExtension(name string) string {
	i := strings.LastIndexByte(name, '.')
	if i < 0 || i == len(name)-1 {
		return ""
	}
	ext := strings.ToLower(name[i+1:])
	for _, r := range ext {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return ""
		}
	}
	return ext
}

// documentSourceBefore is the list order: newest first, then source id
// descending byte-wise - the order the queries sort by (COLLATE "C").
func documentSourceBefore(a, b DocumentSourceItem) bool {
	if !a.UpdatedAt.Equal(b.UpdatedAt) {
		return a.UpdatedAt.After(b.UpdatedAt)
	}
	return a.ID > b.ID
}

// documentSourceSortedBefore is the order of a column sort across the four
// merged sources: the key, then the source id, both in the requested
// direction; a row with no human editor stays last either way. The keys are
// byte-compared exactly as the queries order them.
func documentSourceSortedBefore(sort DocumentSort) func(a, b DocumentSourceItem) bool {
	return func(a, b DocumentSourceItem) bool {
		var c int
		switch sort.Key {
		case DocumentSortSize:
			c = cmpInt64(a.SizeBytes, b.SizeBytes)
		case DocumentSortName:
			c = cmpInt64(int64(a.keyRank), int64(b.keyRank))
		case DocumentSortEditor:
			if a.editorNull != b.editorNull {
				return !a.editorNull
			}
			c = cmpInt64(int64(a.keyRank), int64(b.keyRank))
		default:
			c = a.UpdatedAt.Compare(b.UpdatedAt)
		}
		if c == 0 {
			c = strings.Compare(a.ID, b.ID)
		}
		if sort.Desc {
			return c > 0
		}
		return c < 0
	}
}

// rankSourceKeys fills keyRank for a name or editor sort: the pages come from
// four queries, each already in the database's collation order, and Go has no
// way to compare two names the way that collation does, so the database ranks
// the page's keys (at most four pages of rows) in one round trip.
func (s *DocumentSourceService) rankSourceKeys(ctx context.Context, sort DocumentSort, items []DocumentSourceItem) error {
	if (sort.Key != DocumentSortName && sort.Key != DocumentSortEditor) || len(items) == 0 {
		return nil
	}
	keys := make([]string, len(items))
	for i, it := range items {
		keys[i] = it.nameKey
		if sort.Key == DocumentSortEditor {
			keys[i] = it.editorKey
		}
	}
	rows, err := s.q.RankDocumentSortKeys(ctx, keys)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.Ord >= 1 && int(r.Ord) <= len(items) {
			items[r.Ord-1].keyRank = int(r.Rank)
		}
	}
	return nil
}

func cmpInt64(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// documentSourceSortCursor is the cursor of a sorted sources page: the sort
// half every list shares, the last row's date and its source id.
type documentSourceSortCursor struct {
	At time.Time `json:"t"`
	ID string    `json:"id"`
	DocumentSortCursor
}

func encodeSortedDocumentSourceCursor(sort DocumentSort, last DocumentSourceItem) string {
	raw, _ := json.Marshal(documentSourceSortCursor{
		At: last.UpdatedAt.UTC(), ID: last.ID,
		DocumentSortCursor: NewDocumentSortCursor(sort, last.SizeBytes, last.nameKey, last.editorKey, last.editorNull),
	})
	return base64.RawURLEncoding.EncodeToString(raw)
}

// decodeSortedDocumentSourceCursor reads a cursor of a sorted page; an
// unsorted cursor (the "time|id" text) answers false.
func decodeSortedDocumentSourceCursor(raw string) (documentSourceSortCursor, bool) {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(b) == 0 || b[0] != '{' {
		return documentSourceSortCursor{}, false
	}
	var c documentSourceSortCursor
	if err := json.Unmarshal(b, &c); err != nil || c.ID == "" || strings.ContainsRune(c.ID, 0) || c.At.IsZero() || !c.Sorted() || !c.ValidShape(true) {
		return documentSourceSortCursor{}, false
	}
	return c, true
}

func encodeDocumentSourceCursor(at time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func decodeDocumentSourceCursor(raw string) (time.Time, string, bool) {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, "", false
	}
	ts, id, ok := strings.Cut(string(b), "|")
	if !ok || id == "" {
		return time.Time{}, "", false
	}
	at, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, "", false
	}
	return at, id, true
}

// escapeLikePattern makes a search term literal inside ILIKE '%' || q || '%'.
func escapeLikePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(q)
}
