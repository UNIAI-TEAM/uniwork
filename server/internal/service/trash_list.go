package service

import (
	"cmp"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

// The shared workspace trash (UNI-2171, spec §8.1.1): one list of what was
// deleted in a workspace - task batches, projects and documents - newest
// first. Each kind is read through its own service under its own permission
// rule, and the pages are merged here.

// TrashKind is the kind of one shared trash row.
type TrashKind string

const (
	TrashKindTask     TrashKind = "task"
	TrashKindProject  TrashKind = "project"
	TrashKindDocument TrashKind = "document"
)

// trashKinds is every kind in merge order: rows deleted at the same instant
// list a task before a project before a document.
var trashKinds = []TrashKind{TrashKindTask, TrashKindProject, TrashKindDocument}

// TrashItem is one row of the shared trash.
type TrashItem struct {
	Kind       TrashKind
	ID, Title  string
	Identifier string // task only: PREFIX-N
	SubKind    string // document only: page, file or folder
	// ParentID is a document's folder, empty at the workspace root: the client
	// tells which listed rows a folder restore may leave behind.
	ParentID string
	// Count is a task's subtasks in its batch, or a project's TaskCount.
	Count int
	// LocationTitle is a task's project (empty without one), or the workspace
	// name for a project and a document; LocationPath is a document's folders,
	// root first.
	LocationTitle         string
	LocationPath          []string
	TrashedBy             string
	TrashedAt, PurgeAfter time.Time
	// CanManage is whether the reader may restore or purge the row under its
	// kind's rule: always for a task, canManageProject for a project, manage
	// or admin scope for a document.
	CanManage bool
}

// ListTrashInput is one page request: Kinds empty lists every kind, otherwise
// only the kinds named are read. The same Kinds and Filter must accompany
// every page of one list.
type ListTrashInput struct {
	Kinds  []TrashKind
	Filter TrashFilter
	Cursor string
}

// trashMaxDeleters bounds Filter.TrashedBy: a workspace's people fit, and the
// query parameter stays short.
const trashMaxDeleters = 100

// TrashService reads the shared trash.
type TrashService struct {
	tasks *TaskService
	docs  *DocumentService
	ws    *WorkspaceService
	flags McpFlags
}

// NewTrashService wires the three sources. docs nil, or the `documents` flag
// off for the reader, leaves the document rows out.
func NewTrashService(tasks *TaskService, docs *DocumentService, ws *WorkspaceService, flags McpFlags) *TrashService {
	return &TrashService{tasks: tasks, docs: docs, ws: ws, flags: flags}
}

// trashCursor is the shared cursor: each source's own cursor, and the sources
// already read to the end.
type trashCursor struct {
	Task     string      `json:"t,omitempty"`
	Project  string      `json:"p,omitempty"`
	Document string      `json:"d,omitempty"`
	Done     []TrashKind `json:"x,omitempty"`
}

func (c *trashCursor) of(k TrashKind) *string {
	switch k {
	case TrashKindTask:
		return &c.Task
	case TrashKindProject:
		return &c.Project
	}
	return &c.Document
}

func decodeTrashCursor(raw string) (trashCursor, error) {
	var c trashCursor
	if raw == "" {
		return c, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(b, &c) != nil {
		return trashCursor{}, Invalid("cursor không hợp lệ")
	}
	for _, k := range c.Done {
		if !slices.Contains(trashKinds, k) {
			return trashCursor{}, Invalid("cursor không hợp lệ")
		}
	}
	return c, nil
}

func (c trashCursor) encode() string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

// trashSourcePage is one source's page in the merge: its rows in its own
// order, its own next cursor, and the cursor that resumes after one of them.
type trashSourcePage struct {
	kind  TrashKind
	items []TrashItem
	next  string
	after func(TrashItem) string
}

// List is one page of the shared trash, 50 rows newest first. It reads a page
// from every source still open, merges them by (deleted at desc, kind) and
// keeps the first 50; the cursor resumes each source right after the last of
// its rows the page kept. A workspace outsider is not found.
func (s *TrashService) List(ctx context.Context, actor Actor, workspaceID string, in ListTrashInput) (TrashPage[TrashItem], error) {
	view, err := s.ws.GetView(ctx, actor.ID, workspaceID)
	if errors.Is(err, ErrForbidden) {
		return TrashPage[TrashItem]{}, ErrNotFound
	}
	if err != nil {
		return TrashPage[TrashItem]{}, err
	}
	for _, k := range in.Kinds {
		if !slices.Contains(trashKinds, k) {
			return TrashPage[TrashItem]{}, coded(http.StatusBadRequest, "invalid_filter", "kind phải là task, project hoặc document")
		}
	}
	if len(in.Filter.TrashedBy) > trashMaxDeleters {
		return TrashPage[TrashItem]{}, coded(http.StatusBadRequest, "invalid_filter", fmt.Sprintf("trashed_by có tối đa %d người", trashMaxDeleters))
	}
	for _, id := range in.Filter.TrashedBy {
		if strings.TrimSpace(id) == "" {
			return TrashPage[TrashItem]{}, coded(http.StatusBadRequest, "invalid_filter", "trashed_by không được rỗng")
		}
	}
	cur, err := decodeTrashCursor(in.Cursor)
	if err != nil {
		return TrashPage[TrashItem]{}, err
	}
	// The task and project sources trim the term; the document search does not.
	in.Filter.Query = strings.TrimSpace(in.Filter.Query)
	docsOn := s.docs != nil && documentsFlagOn(ctx, s.flags, actor.ID, view.OrganizationID)
	var srcs []trashSourcePage
	for _, k := range trashKinds {
		if (len(in.Kinds) > 0 && !slices.Contains(in.Kinds, k)) || (k == TrashKindDocument && !docsOn) || slices.Contains(cur.Done, k) {
			continue
		}
		src, err := s.read(ctx, actor, view, k, in.Filter, *cur.of(k))
		if err != nil {
			return TrashPage[TrashItem]{}, err
		}
		srcs = append(srcs, src)
	}

	// A k-way merge keeps each source's own order, so a source's cursor always
	// marks a prefix of its rows; ties go to the earlier kind in srcs. Invariant:
	// every source page that carries a next cursor holds at least trashPageSize
	// rows, so the merge never takes a row past another source's unread rows; a
	// source that filtered rows after its query would break the order.
	page := TrashPage[TrashItem]{Items: make([]TrashItem, 0, trashPageSize)}
	taken := make([]int, len(srcs))
	for len(page.Items) < trashPageSize {
		best := -1
		for i, src := range srcs {
			if taken[i] < len(src.items) && (best < 0 || src.items[taken[i]].TrashedAt.After(srcs[best].items[taken[best]].TrashedAt)) {
				best = i
			}
		}
		if best < 0 {
			break
		}
		page.Items = append(page.Items, srcs[best].items[taken[best]])
		taken[best]++
	}
	open := false
	for i, src := range srcs {
		switch n := taken[i]; {
		case n == len(src.items) && src.next == "":
			cur.Done = append(cur.Done, src.kind)
			continue
		case n == len(src.items):
			*cur.of(src.kind) = src.next
		case n > 0:
			*cur.of(src.kind) = src.after(src.items[n-1])
		}
		open = true
	}
	if open {
		page.NextCursor = cur.encode()
	}
	return page, nil
}

func feedCursorAfter(it TrashItem) string { return encodeFeedCursor(it.TrashedAt, it.ID) }

// read is one page of one source as shared trash rows.
func (s *TrashService) read(ctx context.Context, actor Actor, view WorkspaceView, k TrashKind, f TrashFilter, cursor string) (trashSourcePage, error) {
	src := trashSourcePage{kind: k}
	switch k {
	case TrashKindTask:
		page, err := s.tasks.ListTrash(ctx, actor.ID, view.ID, f, cursor)
		if err != nil {
			return src, err
		}
		for _, r := range page.Items {
			src.items = append(src.items, TrashItem{
				Kind: k, ID: r.ID, Title: r.Title, Identifier: r.Identifier, Count: r.BatchSize - 1,
				LocationTitle: cmp.Or(r.ProjectTitle, view.Name), TrashedBy: r.TrashedBy, TrashedAt: r.TrashedAt, PurgeAfter: r.PurgeAfter,
				CanManage: true,
			})
		}
		src.next, src.after = page.NextCursor, feedCursorAfter
	case TrashKindProject:
		page, err := s.tasks.ListProjectTrash(ctx, actor.ID, view.ID, f, cursor)
		if err != nil {
			return src, err
		}
		for _, r := range page.Items {
			src.items = append(src.items, TrashItem{
				Kind: k, ID: r.ID, Title: r.Title, Count: r.TaskCount, LocationTitle: view.Name,
				TrashedBy: r.TrashedBy, TrashedAt: r.TrashedAt, PurgeAfter: r.PurgeAfter, CanManage: r.CanManage,
			})
		}
		src.next, src.after = page.NextCursor, feedCursorAfter
	default:
		// The rows the documents trash screen shows the reader; its unsorted
		// order is (archived_at, id) descending, the order the merge needs.
		page, err := s.docs.listDocumentsPage(ctx, actor, view.ID, ListDocumentsInput{
			Archived: true, ArchivedBy: f.TrashedBy, Query: f.Query, Match: DocumentMatchTitle,
			Cursor: cursor, Limit: trashPageSize, withPaths: true,
		})
		if err != nil {
			return src, err
		}
		for _, r := range page.Items {
			path := make([]string, len(r.Path))
			for i, p := range r.Path {
				path[i] = p.Title
			}
			d := r.Document
			src.items = append(src.items, TrashItem{
				Kind: k, ID: d.ID, Title: d.Title, SubKind: d.Kind, ParentID: d.ParentID.String,
				LocationTitle: view.Name, LocationPath: path,
				TrashedBy: d.ArchivedBy.String, TrashedAt: d.ArchivedAt.Time, PurgeAfter: d.PurgeAfter.Time,
				CanManage: r.Access.canAdminister(),
			})
		}
		src.next = page.NextCursor
		src.after = func(it TrashItem) string {
			at := it.TrashedAt
			return encodeDocumentCursor(documentCursor{At: &at, ID: it.ID})
		}
	}
	return src, nil
}
