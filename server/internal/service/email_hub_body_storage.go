package service

import (
	"context"
	"io"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub/bodystore"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *EmailHubService) bodyOnObjectStorage() bool {
	return bodystore.UseObjectStorage(s.store != nil)
}

func (s *EmailHubService) persistThreadBody(
	ctx context.Context, accountID, organizationID, threadID, text, html string,
) error {
	text = imapclient.SanitizeUTF8(text)
	html = imapclient.SanitizeUTF8(html)
	if s.bodyOnObjectStorage() {
		key := bodystore.ObjectKey(accountID, threadID)
		data, err := bodystore.Encode(text, html)
		if err != nil {
			return err
		}
		if _, err := s.store.Upload(ctx, key, data, "application/gzip", "body.json.gz"); err != nil {
			return err
		}
		_, err = s.q.UpdateEmailHubThreadBodyObject(ctx, db.UpdateEmailHubThreadBodyObjectParams{
			ID: threadID, BodyObjectKey: key,
		})
		return err
	}
	_, err := s.q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID:       threadID,
		BodyText: pgtype.Text{String: text, Valid: text != ""},
		BodyHtml: pgtype.Text{String: html, Valid: html != ""},
	})
	return err
}

func (s *EmailHubService) hydrateThreadBodyFromObject(ctx context.Context, view *EmailHubThreadView, row db.EmailHubThread) error {
	key := strings.TrimSpace(row.BodyObjectKey)
	if key == "" || s.store == nil {
		return nil
	}
	if view.BodyText != "" || view.BodyHTML != "" {
		return nil
	}
	rc, err := s.store.GetReader(ctx, key)
	if err != nil {
		return err
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return err
	}
	text, html, err := bodystore.Decode(data)
	if err != nil {
		return err
	}
	view.BodyText = text
	view.BodyHTML = html
	repaired := imapclient.RepairThreadBodyContent(view.BodyText, view.BodyHTML)
	view.BodyText = repaired.Text
	view.BodyHTML = repaired.HTML
	return nil
}

func (s *EmailHubService) deleteEmailHubBodyObjects(ctx context.Context, keys []string) {
	if s.store == nil {
		return
	}
	seen := make(map[string]struct{}, len(keys))
	for _, k := range keys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		s.store.Delete(ctx, k)
	}
}

func (s *EmailHubService) bodyObjectKeysForThreads(ctx context.Context, acc db.EmailHubAccount, threadIDs []string) ([]string, error) {
	if len(threadIDs) == 0 {
		return nil, nil
	}
	return s.q.ListEmailHubBodyObjectKeysForThreads(ctx, db.ListEmailHubBodyObjectKeysForThreadsParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, Column3: threadIDs,
	})
}

// SetObjectStorage wires S3/local storage for Email Hub bodies (optional).
func (s *EmailHubService) SetObjectStorage(store storage.Storage) {
	s.store = store
}
