package service

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// Column sort of the documents library lists (UNI-2038 S3). The list routes
// take an optional sort=updated|name|size|editor and order=asc|desc; without
// sort every list keeps its own order and its own cursor, so old clients are
// unaffected. A sorted list is totally ordered by (key, id) in one direction,
// ids compared byte-wise, and its cursor carries the sort it was minted for.
const (
	DocumentSortUpdated = "updated"
	DocumentSortName    = "name"
	DocumentSortSize    = "size"
	DocumentSortEditor  = "editor"
)

// DocumentSort is the parsed sort/order pair; the zero value means "no sort".
type DocumentSort struct {
	Key  string
	Desc bool
}

// Active reports whether the request asked for a column sort.
func (s DocumentSort) Active() bool { return s.Key != "" }

// Order is the direction as the API spells it ("" without a sort).
func (s DocumentSort) Order() string {
	switch {
	case !s.Active():
		return ""
	case s.Desc:
		return "desc"
	default:
		return "asc"
	}
}

// ParseDocumentSort resolves ?sort= and ?order=. Without order, updated and
// size run newest/largest first and name and editor run A to Z; order
// without sort and any unknown value are 400.
func ParseDocumentSort(key, order string) (DocumentSort, error) {
	var out DocumentSort
	switch key {
	case "":
		if order != "" {
			return out, Invalid("order chỉ dùng cùng sort")
		}
		return out, nil
	case DocumentSortUpdated, DocumentSortSize:
		out = DocumentSort{Key: key, Desc: true}
	case DocumentSortName, DocumentSortEditor:
		out = DocumentSort{Key: key}
	default:
		return DocumentSort{}, Invalid("sort phải là updated, name, size hoặc editor")
	}
	switch order {
	case "":
	case "asc":
		out.Desc = false
	case "desc":
		out.Desc = true
	default:
		return DocumentSort{}, Invalid("order phải là asc hoặc desc")
	}
	return out, nil
}

// DocumentSortCursor is the part of an opaque cursor that only a sorted page
// carries: the sort and order it was minted for and the key value of the last
// row (Num for size, Text for name and editor, Null for an editor-less row;
// the updated key rides in the cursor's own time field). All lists share it,
// so a cursor can never be replayed under another sort.
type DocumentSortCursor struct {
	Sort  string  `json:"s,omitempty"`
	Order string  `json:"o,omitempty"`
	Num   *int64  `json:"n,omitempty"`
	Text  *string `json:"x,omitempty"`
	Null  bool    `json:"z,omitempty"`
}

// Sorted reports whether the cursor was minted by a sorted page.
func (c DocumentSortCursor) Sorted() bool { return c.Sort != "" }

// CheckAgainst is nil when the cursor was minted for exactly this request's
// sort and order: an unsorted cursor under no sort, a sorted one under the
// same pair. Anything else is 400 - never a silent first page.
func (c DocumentSortCursor) CheckAgainst(sort DocumentSort) error {
	if c.Sort != sort.Key || (sort.Active() && c.Order != sort.Order()) {
		return Invalid("cursor không dùng được với sort/order này")
	}
	return nil
}

// ValidShape reports whether a sorted cursor carries the key value its sort
// needs; hasAt is whether the cursor's time field is set.
func (c DocumentSortCursor) ValidShape(hasAt bool) bool {
	if c.Order != "asc" && c.Order != "desc" {
		return false
	}
	switch c.Sort {
	case DocumentSortUpdated:
		return hasAt
	case DocumentSortSize:
		return c.Num != nil
	case DocumentSortName, DocumentSortEditor:
		return c.Text != nil
	}
	return false
}

// NewDocumentSortCursor builds the sort half of the cursor of the page's last
// row. The caller passes the key values the list query returned for that row,
// so the cursor pins the exact value the page was ordered by.
func NewDocumentSortCursor(sort DocumentSort, size int64, name, editor string, editorNull bool) DocumentSortCursor {
	c := DocumentSortCursor{Sort: sort.Key, Order: sort.Order()}
	switch sort.Key {
	case DocumentSortSize:
		c.Num = &size
	case DocumentSortName:
		c.Text = &name
	case DocumentSortEditor:
		c.Text = &editor
		c.Null = editorNull
	}
	return c
}

// documentSortArgs is a cursor in the shape the sorted list queries bind: the
// sort key and direction, and the last row's key (all NULL on a first page).
type documentSortArgs struct {
	key  pgtype.Text
	desc bool
	id   pgtype.Text
	at   pgtype.Timestamptz
	num  pgtype.Int8
	text pgtype.Text
	null pgtype.Bool
}

// sortArgs binds a request's sort and the position its cursor carries. No
// sort leaves every field NULL, which is the query's own order.
func sortArgs(sort DocumentSort, c DocumentSortCursor, at *time.Time, id string) documentSortArgs {
	out := documentSortArgs{}
	if !sort.Active() {
		return out
	}
	out.key = pgtype.Text{String: sort.Key, Valid: true}
	out.desc = sort.Desc
	if id == "" {
		return out
	}
	out.id = pgtype.Text{String: id, Valid: true}
	if at != nil {
		out.at = pgtype.Timestamptz{Time: *at, Valid: true}
	}
	if c.Num != nil {
		out.num = pgtype.Int8{Int64: *c.Num, Valid: true}
	}
	if c.Text != nil {
		out.text = pgtype.Text{String: *c.Text, Valid: true}
	}
	out.null = pgtype.Bool{Bool: c.Null, Valid: true}
	return out
}
