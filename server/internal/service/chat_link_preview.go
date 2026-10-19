package service

// Link previews (UNI-1908 F3, ADR 0035). Sending a text message that names an
// http(s) URL queues chat.link_preview.requested in the send transaction. The
// slow-lane consumer reads the card of the first URL through
// internal/linkpreview (the address guard) or reuses the organization's cached
// card, keeps its picture in FileService, maps the message to it and tells the
// room with chat.message.preview_ready, ids only, so open timelines refetch.
// A viewer's device never contacts the linked site: the picture is signed out
// of UniWork storage like any chat media.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/linkpreview"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// topicChatLinkPreviewRequested asks the slow lane for a message's card.
const topicChatLinkPreviewRequested = "chat.link_preview.requested"

const (
	chatLinkPreviewOK      = "ok"
	chatLinkPreviewFailed  = "failed"
	chatLinkPreviewBlocked = "blocked"
	// chatLinkPreviewRetry is how long a failed fetch stands before a later
	// message naming the same URL tries again. A card or a refusal is kept.
	chatLinkPreviewRetry = time.Hour
	// maxRoomLinkPreviewIDs caps one batch, as for the message links.
	maxRoomLinkPreviewIDs = 200
)

// chatLinkPreviewActor stores cards; no person asked for them.
var chatLinkPreviewActor = audit.Actor{Kind: audit.KindSystem, ID: "chat-link-previews"}

var (
	// The client's URL pattern (chat-message-body.tsx), so the card follows the
	// first link the message shows.
	chatPreviewURLPattern = regexp.MustCompile(`\bhttps?://[^\s<>"']+[^\s<>"'.,;:!?)\]]`)
	// A sticker or GIF body is a picture, not a link to read.
	chatMediaBodyPattern = regexp.MustCompile(`^!\[[^\]]*\]\(https?://[^)\s]+\)$`)
)

// firstPreviewURL is the first http(s) URL of a text body, "" when it has none.
func firstPreviewURL(body string) string {
	if chatMediaBodyPattern.MatchString(strings.TrimSpace(body)) {
		return ""
	}
	return chatPreviewURLPattern.FindString(body)
}

// previewURLKey is the URL a card is fetched and cached by: scheme and host in
// lower case, no fragment (it never leaves the browser anyway), and its hash.
func previewURLKey(raw string) (string, string) {
	if u, err := url.Parse(raw); err == nil {
		u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
		u.Fragment, u.RawFragment = "", ""
		raw = u.String()
	}
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:])
}

// requestChatLinkPreview queues the card of a just-created text message, in the
// caller's transaction. A body without a link asks for nothing.
func requestChatLinkPreview(ctx context.Context, q *db.Queries, senderID string, room db.ChatRoom, messageID, body string) error {
	if firstPreviewURL(body) == "" {
		return nil
	}
	return auditRecorder.Emit(ctx, q, Human(senderID), audit.Event{
		Topic:          topicChatLinkPreviewRequested,
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
		Payload:        map[string]string{"room_id": room.ID, "message_id": messageID, "organization_id": room.OrganizationID},
	})
}

// LinkPreviewFetcher is *linkpreview.Fetcher; tests stand in for it.
type LinkPreviewFetcher interface {
	Fetch(ctx context.Context, rawURL string) (linkpreview.Preview, error)
}

// ChatLinkPreviewConsumer builds cards on the slow lane: a fetch waits on a
// third party for up to five seconds.
type ChatLinkPreviewConsumer struct {
	chat  *ChatService
	fetch LinkPreviewFetcher
}

func NewChatLinkPreviewConsumer(chat *ChatService, fetch LinkPreviewFetcher) *ChatLinkPreviewConsumer {
	return &ChatLinkPreviewConsumer{chat: chat, fetch: fetch}
}

func (*ChatLinkPreviewConsumer) Name() string     { return "chat_link_preview" }
func (*ChatLinkPreviewConsumer) Topics() []string { return []string{topicChatLinkPreviewRequested} }

// DeliveryTimeout leaves room for the fetch, the upload and the writes.
func (*ChatLinkPreviewConsumer) DeliveryTimeout() time.Duration { return 30 * time.Second }

func (c *ChatLinkPreviewConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("chat_link_preview: payload of %s: %w", ev.ID, err)
	}
	return c.chat.buildMessageLinkPreview(ctx, c.fetch,
		strings.TrimSpace(payload["organization_id"]), strings.TrimSpace(payload["room_id"]), strings.TrimSpace(payload["message_id"]))
}

// buildMessageLinkPreview maps a message to its URL's card, fetching the card
// first unless the organization already has it. A message that is gone, or no
// longer names a link, is a permanent no-op; only database and storage
// failures return an error, so the outbox retries nothing else.
func (s *ChatService) buildMessageLinkPreview(ctx context.Context, fetch LinkPreviewFetcher, orgID, roomID, messageID string) error {
	if fetch == nil || orgID == "" || roomID == "" || messageID == "" {
		return nil
	}
	msg, err := s.q.GetChatMessageForLinkPreview(ctx, db.GetChatMessageForLinkPreviewParams{
		ID: messageID, RoomID: roomID, OrganizationID: orgID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	raw := firstPreviewURL(msg.Body)
	if msg.DeletedAt.Valid || raw == "" {
		return nil
	}
	key, hash := previewURLKey(raw)
	preview, err := s.q.GetChatLinkPreviewByURL(ctx, db.GetChatLinkPreviewByURLParams{OrganizationID: orgID, UrlHash: hash})
	missing := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !missing {
		return err
	}
	if missing || (preview.Status == chatLinkPreviewFailed && time.Since(preview.FetchedAt.Time) >= chatLinkPreviewRetry) {
		if preview, err = s.storeLinkPreview(ctx, fetch, orgID, key, hash); err != nil {
			return err
		}
	}
	n, err := s.q.InsertChatMessageLinkPreview(ctx, db.InsertChatMessageLinkPreviewParams{
		MessageID: messageID, OrganizationID: orgID, RoomID: roomID, PreviewID: preview.ID,
	})
	if err != nil {
		return err
	}
	if n > 0 && preview.Status == chatLinkPreviewOK {
		s.publishLinkPreviewReady(ctx, roomID, messageID)
	}
	return nil
}

// storeLinkPreview fetches a URL's card and keeps it, picture claimed in the
// same transaction as the row. A row a concurrent delivery stored first wins;
// this one's picture goes back to the collector.
func (s *ChatService) storeLinkPreview(ctx context.Context, fetch LinkPreviewFetcher, orgID, rawURL, hash string) (db.ChatLinkPreview, error) {
	p, err := fetch.Fetch(ctx, rawURL)
	status := chatLinkPreviewOK
	switch {
	case errors.Is(err, linkpreview.ErrBlocked):
		status = chatLinkPreviewBlocked
	case err != nil:
		status = chatLinkPreviewFailed
	}
	scope := files.Scope{OrganizationID: orgID}
	var imageID files.FileID
	if status == chatLinkPreviewOK && p.Image != nil && s.files != nil {
		up, err := s.files.Upload(ctx, files.UploadInput{
			Actor:          chatLinkPreviewActor,
			Purpose:        files.ChatLinkPreview,
			Scope:          scope,
			IdempotencyKey: "chat-link-preview-" + util.NewID(),
			Filename:       "preview" + linkpreview.ImageTypes[p.Image.ContentType],
			Body:           bytes.NewReader(p.Image.Bytes),
		})
		if err != nil {
			// The card keeps its text; the picture is not worth a retry.
			slog.Warn("chat link preview image upload", "organization_id", orgID, "err", err)
		} else {
			imageID = up.File.ID
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatLinkPreview{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if imageID != "" {
		if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: chatLinkPreviewActor, Purpose: files.ChatLinkPreview, Scope: scope, FileIDs: []files.FileID{imageID},
		}); err != nil {
			return db.ChatLinkPreview{}, filesError(err)
		}
	}
	row, err := q.UpsertChatLinkPreview(ctx, db.UpsertChatLinkPreviewParams{
		ID: util.NewID(), OrganizationID: orgID, UrlHash: hash, Url: rawURL, Status: status,
		Title: p.Title, Description: p.Description, SiteName: p.SiteName,
		ImageFileID: pgtype.Text{String: string(imageID), Valid: imageID != ""},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if err := releaseFilesInTx(ctx, s.files, q, nonEmptyFileIDs(imageID)); err != nil {
			return db.ChatLinkPreview{}, err
		}
		row, err = q.GetChatLinkPreviewByURL(ctx, db.GetChatLinkPreviewByURLParams{OrganizationID: orgID, UrlHash: hash})
	}
	if err != nil {
		return db.ChatLinkPreview{}, err
	}
	return row, tx.Commit(ctx)
}

func nonEmptyFileIDs(id files.FileID) []files.FileID {
	if id == "" {
		return nil
	}
	return []files.FileID{id}
}

// publishLinkPreviewReady tells the sockets holding the room open, as an edit
// is told: the default channel's go to its workspace, any other room's to
// chat:{room}. Losing one costs nothing but a card shown on the next load.
func (s *ChatService) publishLinkPreviewReady(ctx context.Context, roomID, messageID string) {
	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if err != nil {
		return
	}
	ev := Event{Type: "chat.message.preview_ready", Payload: map[string]string{"room_id": roomID, "message_id": messageID}}
	if isWorkspaceDefaultRoom(room) {
		s.pub.Publish(ctx, roomAnchorWorkspaceID(room), ev)
		return
	}
	s.publishChatRoomEvent(ctx, roomID, ev)
}

// ChatLinkPreviewRow is one message's card, its picture signed.
type ChatLinkPreviewRow struct {
	MessageID         string
	URL               string
	Title             string
	Description       string
	SiteName          string
	ImageURL          string
	ImageURLExpiresAt time.Time
}

// ListRoomLinkPreviews returns the cards of many messages in one room, so a
// timeline asks once. Ids outside the room have no rows; the room gate is the
// only visibility check needed.
func (s *ChatService) ListRoomLinkPreviews(
	ctx context.Context, userID, workspaceID, roomID string, messageIDs []string,
) ([]ChatLinkPreviewRow, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(messageIDs))
	ids := make([]string, 0, len(messageIDs))
	for _, id := range messageIDs {
		if id = strings.TrimSpace(id); id == "" {
			continue
		}
		if _, dup := seen[id]; !dup {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) > maxRoomLinkPreviewIDs {
		return nil, Invalid(fmt.Sprintf("tối đa %d tin nhắn mỗi lần", maxRoomLinkPreviewIDs))
	}
	out := []ChatLinkPreviewRow{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.ListChatRoomLinkPreviews(ctx, db.ListChatRoomLinkPreviewsParams{
		OrganizationID: room.OrganizationID, RoomID: room.ID, MessageIds: ids,
	})
	if err != nil {
		return nil, err
	}
	signed := s.signLinkPreviewImages(ctx, room, rows)
	for _, r := range rows {
		row := ChatLinkPreviewRow{
			MessageID: r.MessageID, URL: r.Url, Title: r.Title, Description: r.Description, SiteName: r.SiteName,
		}
		if img, ok := signed[files.FileID(r.ImageFileID.String)]; ok && r.ImageFileID.Valid {
			row.ImageURL, row.ImageURLExpiresAt = img.URL, img.URLExpiresAt
		}
		out = append(out, row)
	}
	return out, nil
}

// signLinkPreviewImages presigns the cards' pictures in one batch. A picture
// that cannot be signed is left out and its card shows without one.
func (s *ChatService) signLinkPreviewImages(ctx context.Context, room db.ChatRoom, rows []db.ListChatRoomLinkPreviewsRow) map[files.FileID]files.Resolved {
	out := map[files.FileID]files.Resolved{}
	var ids []files.FileID
	for _, r := range rows {
		if r.ImageFileID.Valid && r.ImageFileID.String != "" {
			ids = append(ids, files.FileID(r.ImageFileID.String))
		}
	}
	if s.files == nil || len(ids) == 0 {
		return out
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       files.Scope{OrganizationID: room.OrganizationID},
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     ids,
	})
	if err != nil {
		slog.Warn("chat link preview resolve", "room_id", room.ID, "err", err)
		return out
	}
	for _, r := range resolved {
		if r.Err != nil {
			slog.Warn("chat link preview resolve", "room_id", room.ID, "err", r.Err)
			continue
		}
		out[r.File.ID] = r
	}
	return out
}

// ChatLinkPreviewImageProvider tells FileService which chat_link_preview
// files a cached card still shows. Cards are never deleted, so a stored
// picture stays held; one a lost race left unclaimed is the collector's.
type ChatLinkPreviewImageProvider struct{}

func (ChatLinkPreviewImageProvider) Name() string { return "chat_link_previews.image" }

func (ChatLinkPreviewImageProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.ChatLinkPreview}
}

func (ChatLinkPreviewImageProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListChatLinkPreviewImageFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		if id.Valid && id.String != "" {
			out[files.FileID(id.String)] = files.HoldActive
		}
	}
	return out, nil
}
