package handler

// UNI-2045 SV-6: updated_by_user on every list branch (amendment 1 included).

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// dlEditor pulls updated_by_user of a row: nil when the key is absent.
func dlEditor(row map[string]any) map[string]any {
	m, _ := row["updated_by_user"].(map[string]any)
	return m
}

// SV-6: every list row carries updated_by_user{name, avatar_url} for a human
// last editor who belongs to the caller's organization, on every branch; the
// avatar is an absolute URL (a presigned FileService URL, or the account's own
// absolute URL) and the key is absent for an agent, a stranger or no editor.
func TestDoclistUpdatedByUser(t *testing.T) {
	w := newDocsWorld(t)
	annTok, ann := docsJoinWorkspace(t, w, "dl-editor-ann@example.com")
	_, bob := docsJoinWorkspace(t, w, "dl-editor-bob@example.com")
	_, cat := docsJoinWorkspace(t, w, "dl-editor-cat@example.com")
	_, dan := docsJoinWorkspace(t, w, "dl-editor-dan@example.com")
	_, stranger := filesRegister(t, w.srv, "dl-editor-stranger@example.com")
	dlName(t, ann, "Ann An")
	dlName(t, bob, "Bob Bùi")
	dlName(t, cat, "Cat Cao")
	dlName(t, dan, "Dan Đỗ")
	dlName(t, stranger, "Người Lạ")
	dlExec(t, `UPDATE users SET avatar_url = 'https://cdn.example.com/ann.png' WHERE id = $1`, ann)
	dlExec(t, `UPDATE users SET avatar_url = '/uploads/dan.png' WHERE id = $1`, dan) // relative: not loadable without help
	up, err := w.files.Upload(context.Background(), files.UploadInput{
		Actor: service.Human(bob), Purpose: files.UserAvatar, Scope: files.Scope{UserID: bob},
		IdempotencyKey: "dl-bob-avatar", Filename: "bob.png", Body: bytes.NewReader(tinyPNG),
	})
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	if _, err := db.New(testPool).UpdateUserAvatarFile(context.Background(), db.UpdateUserAvatarFileParams{
		ID: bob, AvatarFileID: pgtype.Text{String: string(up.File.ID), Valid: true},
	}); err != nil {
		t.Fatalf("attach avatar: %v", err)
	}

	base := dlBase(w)
	_, folder := docsCreatePageBody(t, w, w.token, map[string]any{"title": "F", "kind": "folder"})
	type want struct {
		editor, kind string
		name, avatar string // empty name = the key must be absent
	}
	docs := map[string]want{
		"by-ann":      {ann, "human", "Ann An", "https://cdn.example.com/ann.png"},
		"by-bob":      {bob, "human", "Bob Bùi", "fake://presign/" + string(up.File.ID)},
		"by-cat":      {cat, "human", "Cat Cao", ""},
		"by-dan":      {dan, "human", "Dan Đỗ", ""},
		"by-agent":    {cat, "agent", "", ""},
		"by-stranger": {stranger, "human", "", ""},
	}
	ids := map[string]string{}
	now := time.Now().UTC().Add(-time.Hour)
	for title, c := range docs {
		_, id := docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "parent_id": folder, "visibility": "workspace"})
		ids[title] = id
		dlExec(t, `UPDATE documents SET updated_by = $1, updated_by_kind = $2 WHERE id = $3`, c.editor, c.kind, id)
		dlLog(t, w, id, w.userID, "view", now)
		dlFavorite(t, w, w.token, id)
	}
	check := func(what, token, path string) {
		t.Helper()
		rows := dlRows(t, w, token, path)
		for title, c := range docs {
			row := rows[title]
			if row == nil {
				t.Errorf("%s: row %q missing", what, title)
				continue
			}
			got := dlEditor(row)
			if c.name == "" {
				if got != nil {
					t.Errorf("%s: row %q updated_by_user = %v, want absent", what, title, got)
				}
				continue
			}
			if got == nil || got["name"] != c.name {
				t.Errorf("%s: row %q updated_by_user = %v, want name %q", what, title, got, c.name)
				continue
			}
			avatar, has := got["avatar_url"].(string)
			if c.avatar == "" && has {
				t.Errorf("%s: row %q avatar_url = %q, want none", what, title, avatar)
			}
			if c.avatar != "" && avatar != c.avatar {
				t.Errorf("%s: row %q avatar_url = %q, want %q", what, title, avatar, c.avatar)
			}
		}
	}
	check("parent_id branch", w.token, base+"?parent_id="+folder)
	check("flat branch", w.token, base)
	check("recent", w.token, base+"/recent")
	check("favorites", w.token, base+"/favorites")

	// shared with me: a member holds a share on each.
	memberTok, memberID := annTok, ann
	for _, id := range ids {
		dlExec(t, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, id)
		dlShare(t, w, id, "user", memberID, w.userID, "human", now)
	}
	check("shared-with-me", memberTok, base+"/shared-with-me")
	for _, id := range ids {
		dlExec(t, `UPDATE documents SET visibility = 'workspace' WHERE id = $1`, id)
	}
	all := make([]string, 0, len(ids))
	for _, id := range ids {
		all = append(all, id)
	}
	dlShelve(t, w, all, true)
	check("shelf", w.token, base+"?shelved=1")
	dlShelve(t, w, all, false)
	dlArchive(t, w, all)
	check("trash", w.token, base+"?archived=1")
}
