package filesfake_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	testOrg = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"
	testWs  = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7F"
)

var testPNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)

// harnessFactory builds a fresh fake per contract case. Every fake starts at
// the same instant with its own clock, so the suite's 24 hour window and 12
// hour URL limit are deterministic.
func harnessFactory(disabled ...files.UploadPurpose) filescontract.Factory {
	return filescontract.FactoryFunc(func(t *testing.T) filescontract.Harness {
		fake := filesfake.New(filesfake.Options{
			Clock:    func() time.Time { return time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC) },
			Disabled: disabled,
		})
		h := filescontract.Harness{
			Service:  fake,
			Registry: fake.Registry(),
			Now:      fake.Now,
			Advance:  fake.Advance,
			WriteProviderOutput: func(t *testing.T, out files.ProviderOutput, body []byte, contentType string) {
				t.Helper()
				if err := fake.WriteProviderOutput(out, body, contentType); err != nil {
					t.Fatalf("write provider output: %v", err)
				}
			},
			SimulateGC:     func(t *testing.T, ids ...files.FileID) { fake.SimulateGC(ids...) },
			SetStorageDown: func(t *testing.T, down bool) { fake.SetStorageDown(down) },
			// The fake has no database: InTx is fn(nil), and a failure restores
			// the snapshot, which is what a rolled-back module transaction
			// leaves behind.
			InTx: func(t *testing.T, fn func(q *db.Queries) error) error {
				t.Helper()
				snapshot := fake.Snapshot()
				err := fn(nil)
				if err != nil {
					fake.Restore(snapshot)
				}
				return err
			},
		}
		if len(disabled) > 0 {
			h.DisabledPurpose = disabled[0]
		}
		return h
	})
}

// TestFakePassesTheContractSuite is AC-1: the default fake - every purpose
// enabled - passes the whole shared suite.
func TestFakePassesTheContractSuite(t *testing.T) {
	filescontract.Run(t, harnessFactory())
}

// TestFakePassesTheContractSuiteWithADisabledPurpose runs the same suite with
// one purpose closed, which is the only way the disabled-purpose case can run:
// the default fake enables every purpose on purpose, because a module tests
// against it before the real registry opens one.
func TestFakePassesTheContractSuiteWithADisabledPurpose(t *testing.T) {
	filescontract.Run(t, harnessFactory(files.DocumentAsset))
}

func TestDisabledPurposeLeavesTheOtherPurposesOpen(t *testing.T) {
	fake := filesfake.New(filesfake.Options{Disabled: []files.UploadPurpose{files.DocumentAsset}})
	registry := fake.Registry()

	if registry.Enabled(files.DocumentAsset) {
		t.Error("DocumentAsset is still enabled")
	}
	for _, purpose := range files.Purposes() {
		if purpose == files.DocumentAsset {
			continue
		}
		if !registry.Enabled(purpose) {
			t.Errorf("purpose %q was closed too; the fake enables every purpose it was not told to disable", purpose)
		}
	}
}

func TestSimulateGCMovesOnlyTheNamedFiles(t *testing.T) {
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	scope := files.Scope{OrganizationID: testOrg, WorkspaceID: testWs}

	ids := make([]files.FileID, 0, 2)
	for i := 0; i < 2; i++ {
		up, err := fake.Upload(ctx, files.UploadInput{
			Actor: audit.User("01J8ZQ0K7V9W1Y2X3Z4A5B6C7H"), Purpose: files.TaskAttachment, Scope: scope,
			IdempotencyKey: "gc-" + string(rune('a'+i)), Filename: "note.png", Body: bytes.NewReader(testPNG),
		})
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
		ids = append(ids, up.File.ID)
	}

	if moved := fake.SimulateGC(ids[0]); moved != 1 {
		t.Fatalf("moved %d files, want 1", moved)
	}

	got, err := fake.ResolveMany(ctx, files.ResolveInput{
		Scope: scope, Mode: files.ReadProxy, Disposition: files.DispositionInline, FileIDs: ids,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("resolved %d entries, want one per id", len(got))
	}
	var fe *files.Error
	if !errors.As(got[0].Err, &fe) || fe.Code != files.CodeDeleting {
		t.Fatalf("the collected file answered %v, want %s", got[0].Err, files.CodeDeleting)
	}
	if got[1].Err != nil {
		t.Errorf("the file the collector was not given was refused: %v", got[1].Err)
	}
}

// TestClaimWindowIsMeasuredOnTheInjectedClock pins the knob a module test
// relies on: advancing the fake's clock is enough to cross the window, with no
// sleeping and no wall clock.
func TestClaimWindowIsMeasuredOnTheInjectedClock(t *testing.T) {
	ctx := context.Background()
	fake := filesfake.New(filesfake.Options{})
	scope := files.Scope{OrganizationID: testOrg, WorkspaceID: testWs}
	up, err := fake.Upload(ctx, files.UploadInput{
		Actor: audit.User("01J8ZQ0K7V9W1Y2X3Z4A5B6C7H"), Purpose: files.TaskAttachment, Scope: scope,
		IdempotencyKey: "clock", Filename: "note.png", Body: bytes.NewReader(testPNG),
	})
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if want := fake.Now().Add(files.ClaimTTL); !up.ClaimExpiresAt.Equal(want) {
		t.Fatalf("claim expires at %s, want %s", up.ClaimExpiresAt, want)
	}

	fake.Advance(files.ClaimTTL + time.Second)
	_, err = fake.ClaimInTx(ctx, nil, files.ClaimInput{
		Actor: audit.User("01J8ZQ0K7V9W1Y2X3Z4A5B6C7H"), Purpose: files.TaskAttachment, Scope: scope,
		FileIDs: []files.FileID{up.File.ID},
	})
	var fe *files.Error
	if !errors.As(err, &fe) || fe.Code != files.CodeClaimExpired {
		t.Fatalf("claim after the window answered %v, want %s", err, files.CodeClaimExpired)
	}
}
