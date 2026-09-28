package service

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// Upgrade replay (G2-07b / UNI-690). docs/office/g1g2/upgrade-replay.json
// lists the committed-version shapes the pinned engine build must read back.
// Before any engine pin change the candidate build runs
// TestDocumentOfficeUpgradeReplay (OFFICE_ENGINE_TEST_URL pointed at it); only
// then does the candidate join office.ReadableEngineVersions and the manifest
// pin move. TestOfficeUpgradeReplayManifest runs everywhere and fails when
// the manifest, the Go pin and the readable set disagree.

type upgradeReplayManifest struct {
	EngineVersion   string `json:"engine_version"`
	ContractVersion string `json:"contract_version"`
	ProtocolVersion int    `json:"protocol_version"`
	Fixtures        []struct {
		ID           string   `json:"id"`
		Format       string   `json:"format"`
		Replay       []string `json:"replay"`
		TargetFormat string   `json:"target_format"`
	} `json:"fixtures"`
}

type g0FixtureManifest struct {
	Fixtures []struct {
		ID   string `json:"id"`
		Path string `json:"path"`
	} `json:"fixtures"`
}

func loadUpgradeReplay(t *testing.T) (upgradeReplayManifest, map[string]string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "office", "g1g2", "upgrade-replay.json"))
	if err != nil {
		t.Fatalf("upgrade replay manifest: %v", err)
	}
	var m upgradeReplayManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("upgrade replay manifest: %v", err)
	}
	raw, err = os.ReadFile(filepath.Join(officeFixtureRoot, "..", "manifest.json"))
	if err != nil {
		t.Fatalf("G0 fixture manifest: %v", err)
	}
	var g0 g0FixtureManifest
	if err := json.Unmarshal(raw, &g0); err != nil {
		t.Fatalf("G0 fixture manifest: %v", err)
	}
	paths := map[string]string{}
	for _, f := range g0.Fixtures {
		paths[f.ID] = f.Path
	}
	return m, paths
}

func TestOfficeUpgradeReplayManifest(t *testing.T) {
	m, paths := loadUpgradeReplay(t)
	if m.EngineVersion != office.TrustedEngineVersion || m.ContractVersion != office.ContractVersion || m.ProtocolVersion != office.ProtocolVersion {
		t.Fatalf("replay manifest pin %s/%s/%d != Go pin %s/%s/%d: replay the candidate build before moving the pin",
			m.EngineVersion, m.ContractVersion, m.ProtocolVersion, office.TrustedEngineVersion, office.ContractVersion, office.ProtocolVersion)
	}
	if !slices.Contains(office.ReadableEngineVersions, m.EngineVersion) {
		t.Fatal("the replayed pin is not readable by this build")
	}
	formats := map[string]bool{}
	for _, f := range m.Fixtures {
		if paths[f.ID] == "" {
			t.Fatalf("replay fixture %s is not in the G0 manifest", f.ID)
		}
		if len(f.Replay) == 0 || f.Replay[0] != "download" {
			t.Fatalf("replay fixture %s must prove the recovery path (download) first", f.ID)
		}
		formats[f.Format] = true
	}
	for _, want := range []string{"docx", "xlsx", "pptx", "pdf", "md", "html", "xls", "odt"} {
		if !formats[want] {
			t.Fatalf("no replay fixture for %s", want)
		}
	}
}

func TestDocumentOfficeUpgradeReplay(t *testing.T) {
	backend, ok := officeMinioBackend()
	if !ok {
		t.Skip("MINIO_* is not set: the engine container PUTs to the presigned URL, so the replay needs MinIO")
	}
	e := newOfficeRealEnv(t, backend)
	ctx := context.Background()
	member := human(e.tn.member)
	m, paths := loadUpgradeReplay(t)

	for _, fx := range m.Fixtures {
		t.Run(fx.ID, func(t *testing.T) {
			body := mustReadFixture(t, paths[fx.ID])
			created := e.doc(t, "replay"+filepath.Ext(paths[fx.ID]), body)
			for _, op := range fx.Replay {
				switch op {
				case "download":
					if got := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, body) {
						t.Fatalf("%s download changed the bytes", fx.ID)
					}
				case "open":
					row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
						Operation: "open", IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
					})
					mustf(t, err, "%s open", fx.ID)
					if done := e.settle(t, row.ID); done.State != string(office.JobCompleted) {
						t.Fatalf("%s open = %+v", fx.ID, done)
					}
				case "serialize":
					e.runSerialize(t, created, office.Format(fx.Format), body)
					// The committed version is the engine's own output: read it
					// back and serialize it once more on the same build.
					again := e.env.doc(t, created.Document.ID)
					row, err := e.jobs.StartOfficeJobForDocument(ctx, member, again.ID, OfficeJobRequest{
						Operation: "serialize", IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
					})
					mustf(t, err, "%s re-serialize", fx.ID)
					if done := e.settle(t, row.ID); done.State != string(office.JobCompleted) || done.OutputChecksum.String != sha(body) {
						t.Fatalf("%s re-serialize of the committed version = %+v", fx.ID, done)
					}
				case "convert":
					row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
						Operation: "convert", TargetFormat: fx.TargetFormat, IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
					})
					mustf(t, err, "%s convert", fx.ID)
					if done := e.settle(t, row.ID); done.State != string(office.JobCompleted) || len(done.Result) == 0 {
						t.Fatalf("%s convert = %+v", fx.ID, done)
					}
				default:
					t.Fatalf("unknown replay op %q", op)
				}
			}
		})
	}
}
