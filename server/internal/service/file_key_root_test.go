package service

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// Environments may share one bucket, so every key FileService mints sits
// under the environment root (S3_KEY_PREFIX): <root>v1/orgs/... and
// <root>v1/users/.... The full key is what files.object_key stores and what
// the adapter reads; with no root the layout is the plain v1/ one
// (TestObjectKeysFollowTheLayout).
func TestObjectKeysCarryTheEnvRoot(t *testing.T) {
	backends := []fileBackend{localFileBackend()}
	if minio, ok := minioFileBackend(); ok {
		backends = append(backends, minio)
	}
	for _, backend := range backends {
		t.Run(backend.name, func(t *testing.T) {
			h := newFileHarnessUnder(t, backend, nil, "develop/")
			ctx := context.Background()
			out, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
				Actor: audit.System("meetings.egress"), Purpose: files.MeetingRecording, Scope: t3Scope,
				OperationID: "EG_root_" + backend.name, Deadline: h.clock.Now().Add(time.Hour),
			})
			if err != nil {
				t.Fatalf("register: %v", err)
			}
			task := t3UploadOK(t, h, "root-task")
			avatar, err := t3Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "root-avatar", "me.png", t3PNG)
			if err != nil {
				t.Fatalf("avatar: %v", err)
			}
			if _, err := t3Upload(t, h, files.AuditExport, files.Scope{OrganizationID: t3Org}, "root-export", "export.csv", []byte("a,b\n1,2\n")); err != nil {
				t.Fatalf("export: %v", err)
			}
			want := map[string]string{
				"meeting_recording": "develop/v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/meetings/recordings/2026/09/" + string(out.FileID) + "/original.mp4",
				"task_attachment":   "develop/v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/tasks/attachments/2026/09/" + string(task.File.ID) + "/original",
				"user_avatar":       "develop/v1/users/" + t3User + "/avatars/2026/09/" + string(avatar.File.ID) + "/original",
				"audit_export":      "develop/v1/orgs/" + t3Org + "/audit/exports/2026/09/",
			}
			rows, err := h.pool.Query(ctx, `SELECT f.object_key, s.purpose FROM files f JOIN file_upload_sessions s ON s.file_id = f.id`)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			seen := 0
			for rows.Next() {
				var key, purpose string
				if err := rows.Scan(&key, &purpose); err != nil {
					t.Fatal(err)
				}
				seen++
				if !strings.HasPrefix(key, want[purpose]) {
					t.Errorf("%s key %q, want prefix %q", purpose, key, want[purpose])
				}
			}
			if seen != 4 {
				t.Errorf("saw %d keys, want 4", seen)
			}

			// The adapter stored the bytes at that full key, and the service
			// reads them back through it.
			if _, err := h.store.Stat(ctx, storage.ObjectLocator{Storage: h.svc.backend, Bucket: backend.bucket, Key: want["task_attachment"]}); err != nil {
				t.Fatalf("object at %q: %v", want["task_attachment"], err)
			}
			rd, err := h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: task.File.ID})
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			defer rd.Close()
			b, _ := io.ReadAll(rd.Body)
			if string(b) != string(t3PNG) {
				t.Fatalf("open returned %d bytes, want the uploaded %d", len(b), len(t3PNG))
			}
		})
	}
}

// FileServiceOptions.KeyRoot takes the loader's normalized form only; a value
// that could leave its folder is a wiring error, not something to clean up.
func TestNewFileServiceRefusesAnUnsafeKeyRoot(t *testing.T) {
	local := buildStore(t, storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.BackendLocal)
	for _, root := range []string{"../", "develop", "/develop/", "develop//", "a\\b/", "https://x/"} {
		if _, err := NewFileService(FileServiceOptions{Pool: &pgxpool.Pool{}, Store: local, KeyRoot: root}); err == nil {
			t.Errorf("NewFileService accepted KeyRoot %q", root)
		}
	}
	if _, err := NewFileService(FileServiceOptions{Pool: &pgxpool.Pool{}, Store: local, KeyRoot: "envs/develop/"}); err != nil {
		t.Fatalf("NewFileService(envs/develop/) = %v", err)
	}
}
