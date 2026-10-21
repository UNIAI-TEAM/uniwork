package notification

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The read side of document_changed notifications (UNI-2056): the inbox row
// names at most three sample documents, and the documents route lists every
// document of the notice. Neither is a stored fact about access: each read
// re-asks the document read gate for this person, so a document they lost
// since the command is dropped, never named from the row.

const (
	// docChangedKind is the kind the consumer writes for a command over
	// documents; only its rows carry notification_documents.
	docChangedKind = "document_changed"
	// docChangedDeleted is the verb whose documents are gone at read time,
	// the only one that stores a title snapshot.
	docChangedDeleted = "deleted"

	maxSampleDocuments = 10
	// documentGateBatch is FilterReadableDocuments' own cap per call.
	documentGateBatch = 100
	// maxDocumentFillRounds bounds how many keyset reads one page makes to
	// fill itself when the reader may not read most of the notice.
	maxDocumentFillRounds = 5
)

// SampleDocument is one document an inbox row names: readable by the caller
// now, or purged under a deleted verb, which names it by its snapshot.
type SampleDocument struct {
	ID    string
	Title string
}

// DocumentRow is one document of a notification as its recipient sees it now.
type DocumentRow struct {
	ID    string
	Title string
	Kind  string
	// Trashed: in the trash, and the reader administers it. Shelved: in the
	// archive. Deleted: purged, the row is gone.
	Trashed bool
	Shelved bool
	Deleted bool
}

// DocumentsPage is one page of a notification's documents. Next is the last
// document id the walk read when more follow; the handler seals it.
type DocumentsPage struct {
	Rows []DocumentRow
	Next string
	More bool
}

// docParams reads the two params the sample resolution needs. The consumer
// writes every param as a string, the sample ids comma-joined; anything
// malformed reads as empty so a bad row never blanks the inbox.
func docParams(raw string) (verb string, sampleIDs []string) {
	var m struct {
		Verb string `json:"verb"`
		IDs  string `json:"sample_document_ids"`
	}
	if json.Unmarshal([]byte(raw), &m) != nil {
		return "", nil
	}
	for _, id := range strings.Split(m.IDs, ",") {
		if id = strings.TrimSpace(id); id != "" && len(sampleIDs) < maxSampleDocuments {
			sampleIDs = append(sampleIDs, id)
		}
	}
	return m.Verb, sampleIDs
}

// withSampleIDs rewrites sample_document_ids in a params JSON object to ids
// (comma-joined, as the consumer writes them), keeping every other key; a malformed value is returned
// unchanged so a bad row never blanks. The ids the reader cannot read are
// removed so the params never name a document the samples do not.
func withSampleIDs(raw string, ids []string) string {
	var m map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &m) != nil {
		return raw
	}
	if _, has := m["sample_document_ids"]; !has {
		return raw
	}
	enc, err := json.Marshal(strings.Join(ids, ","))
	if err != nil {
		return raw
	}
	m["sample_document_ids"] = enc
	b, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return string(b)
}

// documentCard is what the documents table says about one id.
type documentCard struct {
	db.ListDocumentCardsByIDsRow
	state service.DocumentReadState
}

// cards answers the cards of ids in two reads: one for the rows that still
// exist and the read gate for this person, chunked at the gate's cap. A
// missing id has no entry (purged). Without a wired gate every existing
// document is access_lost, so nothing is named (fail closed).
func (s *Service) cards(ctx context.Context, userID string, ids []string) (map[string]documentCard, error) {
	out := make(map[string]documentCard, len(ids))
	uniq := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			uniq = append(uniq, id)
		}
	}
	if len(uniq) == 0 {
		return out, nil
	}
	rows, err := s.q.ListDocumentCardsByIDs(ctx, uniq)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ID] = documentCard{ListDocumentCardsByIDsRow: r, state: service.DocumentAccessLost}
	}
	if s.docs == nil {
		return out, nil
	}
	for start := 0; start < len(uniq); start += documentGateBatch {
		end := min(start+documentGateBatch, len(uniq))
		states, err := s.docs.FilterReadableDocuments(ctx, userID, uniq[start:end])
		if err != nil {
			return nil, err
		}
		for id, st := range states {
			if c, ok := out[id]; ok {
				c.state = st
				out[id] = c
			}
		}
	}
	return out, nil
}

// visibleRow turns one document id into what the reader may see, or false when
// the document exists and they may not read it. A purged document is a
// deleted row; its title is the snapshot only under a deleted verb.
func visibleRow(id, verb string, snapshot pgtype.Text, c documentCard, exists bool) (DocumentRow, bool) {
	if !exists {
		row := DocumentRow{ID: id, Deleted: true}
		if verb == docChangedDeleted && snapshot.Valid {
			row.Title = snapshot.String
		}
		return row, true
	}
	switch c.state {
	case service.DocumentReadable:
	case service.DocumentTrashable:
		// In the trash and the reader administers it: the notice is the way
		// back to it, like document_trashed_by_other.
	default:
		return DocumentRow{}, false
	}
	return DocumentRow{
		ID: id, Title: c.Title, Kind: c.Kind,
		Trashed: c.ArchivedAt.Valid, Shelved: c.ShelvedAt.Valid,
	}, true
}

// Documents lists one page of the documents of a notification the caller owns
// that the caller can read now. Another person's notification and an unknown id
// are the same ErrNotFound. after is the last document id the previous page
// read ("" for the first); limit is clamped like the inbox list.
func (s *Service) Documents(ctx context.Context, userID, notificationID, after string, limit int32) (DocumentsPage, error) {
	n, err := s.q.GetOwnNotificationForDocuments(ctx, db.GetOwnNotificationForDocumentsParams{ID: notificationID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentsPage{}, service.ErrNotFound
	}
	if err != nil {
		return DocumentsPage{}, err
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	verb, _ := docParams(n.Params)

	page := DocumentsPage{Rows: []DocumentRow{}}
	for round := 0; round < maxDocumentFillRounds && len(page.Rows) < int(limit); round++ {
		want := limit - int32(len(page.Rows))
		rows, err := s.q.ListNotificationDocumentsForReader(ctx, db.ListNotificationDocumentsForReaderParams{
			UserID: userID, NotificationID: notificationID, After: optText(after), LimitN: want + 1,
		})
		if err != nil {
			return DocumentsPage{}, err
		}
		page.More = len(rows) > int(want)
		if page.More {
			rows = rows[:want]
		}
		ids := make([]string, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.DocumentID)
		}
		cards, err := s.cards(ctx, userID, ids)
		if err != nil {
			return DocumentsPage{}, err
		}
		for _, r := range rows {
			c, exists := cards[r.DocumentID]
			if row, ok := visibleRow(r.DocumentID, verb, r.TitleSnapshot, c, exists); ok {
				page.Rows = append(page.Rows, row)
			}
		}
		if len(rows) > 0 {
			after = rows[len(rows)-1].DocumentID
		}
		if !page.More {
			break
		}
	}
	if page.More {
		page.Next = after
	}
	return page, nil
}

// attachSampleDocuments resolves the sample ids of the page's document_changed
// rows to titles, only for documents the reader can read now (a purged one
// under a deleted verb keeps its snapshot; any other missing id is dropped).
// The params' sample_document_ids shrink to the same readable ids, so the row
// never names a document the reader lost. One cards read for the page and one
// snapshot read for its deleted rows.
func (s *Service) attachSampleDocuments(ctx context.Context, userID string, items []Item) error {
	type pending struct {
		item *Item
		verb string
		ids  []string
	}
	var rows []pending
	var allIDs, deletedNotifications, deletedIDs []string
	for i := range items {
		if items[i].Kind != docChangedKind {
			continue
		}
		verb, ids := docParams(items[i].Params)
		rows = append(rows, pending{item: &items[i], verb: verb, ids: ids})
		allIDs = append(allIDs, ids...)
		if verb == docChangedDeleted {
			for _, id := range ids {
				deletedNotifications = append(deletedNotifications, items[i].ID)
				deletedIDs = append(deletedIDs, id)
			}
		}
	}
	if len(rows) == 0 {
		return nil
	}
	cards, err := s.cards(ctx, userID, allIDs)
	if err != nil {
		return err
	}
	snapshots := map[[2]string]pgtype.Text{}
	if len(deletedIDs) > 0 {
		found, err := s.q.ListNotificationDocumentSnapshots(ctx, db.ListNotificationDocumentSnapshotsParams{
			NotificationIds: deletedNotifications, DocumentIds: deletedIDs,
		})
		if err != nil {
			return err
		}
		for _, f := range found {
			snapshots[[2]string{f.NotificationID, f.DocumentID}] = f.TitleSnapshot
		}
	}
	for _, p := range rows {
		samples := make([]SampleDocument, 0, len(p.ids))
		kept := make([]string, 0, len(p.ids))
		for _, id := range p.ids {
			c, exists := cards[id]
			row, ok := visibleRow(id, p.verb, snapshots[[2]string{p.item.ID, id}], c, exists)
			if !ok || (row.Deleted && row.Title == "") {
				continue
			}
			samples = append(samples, SampleDocument{ID: id, Title: row.Title})
			kept = append(kept, id)
		}
		p.item.SampleDocuments = samples
		p.item.Params = withSampleIDs(p.item.Params, kept)
	}
	return nil
}
