package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// newLocalStore builds the object adapter on a temp root through the real
// factory so tests exercise preflight too.
func newLocalStore(t *testing.T) (*localObjectStore, string) {
	t.Helper()
	root := t.TempDir()
	store, err := (localFactory{}).New(context.Background(), Config{
		Backend: BackendLocal,
		Local:   &LocalConfig{Root: root},
	})
	if err != nil {
		t.Fatalf("local factory: %v", err)
	}
	los, ok := store.(*localObjectStore)
	if !ok {
		t.Fatalf("local factory returned %T, want *localObjectStore", store)
	}
	return los, root
}

func localLoc(key string) ObjectLocator {
	return ObjectLocator{Storage: BackendLocal, Key: key}
}

func TestValidObjectKeyMatrix(t *testing.T) {
	valid := []string{
		"a.bin",
		"files/01JABC/object.bin",
		"chat/files/photo.png",
		"deeply/nested/path/file",
		"trailing.dots...",
		"UPPER.txt",
	}
	invalid := []string{
		"",
		".",
		"..",
		"/abs.bin",
		`\abs.bin`,
		"../escape.bin",
		"..\\escape.bin",
		"a/../b.bin",
		"a/./b.bin",
		"a//b.bin",
		"a\\..\\b.bin",
		"trailing/",
		"C:/drive.bin",
		"c:relative.bin",
		"file.txt:ads",
		"key.meta.json",
		"dir/object.meta.json",
		".object.tmp",
		"dir/.object.tmp",
	}
	for _, k := range valid {
		if !validObjectKey(k) {
			t.Errorf("validObjectKey(%q) = false, want true", k)
		}
	}
	for _, k := range invalid {
		if validObjectKey(k) {
			t.Errorf("validObjectKey(%q) = true, want false", k)
		}
	}
}

func TestLocalObjectStoreRejectsForeignLocators(t *testing.T) {
	store, _ := newLocalStore(t)
	ctx := context.Background()

	for _, loc := range []ObjectLocator{
		{Storage: BackendS3, Key: "a.bin"},
		{Storage: BackendMinIO, Bucket: "b", Key: "a.bin"},
		{Storage: BackendLocal, Bucket: "bucketless-is-wrong", Key: "a.bin"},
		{Storage: BackendLocal, Key: "a.bin", Version: "v1"},
	} {
		if _, err := store.Stat(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Stat %+v = %v, want ErrLocatorInvalid", loc, err)
		}
		if _, err := store.Open(ctx, loc, ReadOptions{}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Open %+v = %v, want ErrLocatorInvalid", loc, err)
		}
		if err := store.Delete(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Delete %+v = %v, want ErrLocatorInvalid", loc, err)
		}
		if _, err := store.Put(ctx, loc, strings.NewReader("x"), WriteInfo{SizeBytes: 1}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Put %+v = %v, want ErrLocatorInvalid", loc, err)
		}
	}
}

// TestLocalObjectStoreRejectsSymlinkEscape plants a symlink inside the root
// pointing outside it, then proves Put/Open/Stat/Delete all refuse to follow
// it - both as the key itself and as a parent directory of a nested key.
func TestLocalObjectStoreRejectsSymlinkEscape(t *testing.T) {
	store, root := newLocalStore(t)
	ctx := context.Background()

	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.bin")
	if err := os.WriteFile(secret, []byte("outside the root"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linked")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable on this host: %v", err)
	}

	for _, key := range []string{"linked", "linked/secret.bin"} {
		loc := localLoc(key)
		if _, err := store.Open(ctx, loc, ReadOptions{}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Open through symlink %q = %v, want ErrLocatorInvalid", key, err)
		}
		if _, err := store.Stat(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Stat through symlink %q = %v, want ErrLocatorInvalid", key, err)
		}
		if _, err := store.Put(ctx, loc, strings.NewReader("escape"), WriteInfo{SizeBytes: 6}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Put through symlink %q = %v, want ErrLocatorInvalid", key, err)
		}
		if err := store.Delete(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Delete through symlink %q = %v, want ErrLocatorInvalid", key, err)
		}
	}
	// The outside file must be untouched: the refuse checks above are only
	// meaningful while the target exists.
	if _, err := os.Stat(secret); err != nil {
		t.Fatal("symlink target vanished - the delete path was not exercised")
	}
}

// TestLocalObjectStoreRejectsJunctionEscape is the Windows twin of the
// symlink test: a junction needs no admin rights, and Go's EvalSymlinks
// leaves one opaque as the last component, so containment must refuse it
// explicitly. Keys through the junction - existing leaf or not - must all
// answer ErrLocatorInvalid and nothing may land outside the root.
func TestLocalObjectStoreRejectsJunctionEscape(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("directory junctions are a Windows construct")
	}
	store, root := newLocalStore(t)
	ctx := context.Background()

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.bin"), []byte("outside the root"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linked")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, outside).CombinedOutput(); err != nil {
		t.Skipf("junction creation unavailable: %v (%s)", err, out)
	}

	// A fresh leaf through the junction is the dangerous Put path: the
	// junction resolves transparently for the OS but not for EvalSymlinks.
	for _, key := range []string{"linked", "linked/secret.bin", "linked/new.bin"} {
		loc := localLoc(key)
		if _, err := store.Open(ctx, loc, ReadOptions{}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Open through junction %q = %v, want ErrLocatorInvalid", key, err)
		}
		if _, err := store.Stat(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Stat through junction %q = %v, want ErrLocatorInvalid", key, err)
		}
		if _, err := store.Put(ctx, loc, strings.NewReader("escape"), WriteInfo{SizeBytes: 6}); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Put through junction %q = %v, want ErrLocatorInvalid", key, err)
		}
		if err := store.Delete(ctx, loc); !errors.Is(err, ErrLocatorInvalid) {
			t.Errorf("Delete through junction %q = %v, want ErrLocatorInvalid", key, err)
		}
	}
	if _, err := os.Stat(filepath.Join(outside, "new.bin")); !os.IsNotExist(err) {
		t.Fatal("Put streamed through the junction into a file outside the root")
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.bin")); err != nil {
		t.Fatal("junction target vanished - the refuse checks were not exercised")
	}
}

// TestLocalObjectStoreSymlinkInsideRootIsAllowed: a symlink whose target is
// still inside the root resolves fine and the object is served - confinement
// is about the root boundary, not about banning links wholesale.
func TestLocalObjectStoreSymlinkInsideRootIsAllowed(t *testing.T) {
	store, root := newLocalStore(t)
	ctx := context.Background()

	real := filepath.Join(root, "real")
	if err := os.MkdirAll(real, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(real, "o.bin"), []byte("inside"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, filepath.Join(root, "alias")); err != nil {
		t.Skipf("symlinks unavailable on this host: %v", err)
	}
	obj, err := store.Open(ctx, localLoc("alias/o.bin"), ReadOptions{})
	if err != nil {
		t.Fatalf("Open through in-root symlink: %v", err)
	}
	got, _ := io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if string(got) != "inside" {
		t.Fatalf("body = %q, want %q", got, "inside")
	}
}

// TestLocalObjectStoreFailedPutKeepsPreviousObject: a stream that dies
// mid-write must not destroy the object a previous Put committed - the temp
// file is the only casualty.
func TestLocalObjectStoreFailedPutKeepsPreviousObject(t *testing.T) {
	store, root := newLocalStore(t)
	ctx := context.Background()
	loc := localLoc("k/o.bin")

	if _, err := store.Put(ctx, loc, strings.NewReader("v1 bytes"), WriteInfo{SizeBytes: 8}); err != nil {
		t.Fatalf("first Put: %v", err)
	}
	// failingReader (local_atomic_test.go) delivers its head then dies.
	_, err := store.Put(ctx, loc, &failingReader{head: "v2 partial"}, WriteInfo{SizeBytes: -1})
	if err == nil {
		t.Fatal("Put on a dying stream succeeded")
	}
	obj, err := store.Open(ctx, loc, ReadOptions{})
	if err != nil {
		t.Fatalf("Open after failed Put: %v", err)
	}
	got, _ := io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if string(got) != "v1 bytes" {
		t.Fatalf("object after failed Put = %q, want the original %q", got, "v1 bytes")
	}
	// The staging file itself is also gone - a failed write cleans it.
	if _, err := os.Stat(tempPath(filepath.Join(root, "k", "o.bin"))); !os.IsNotExist(err) {
		t.Fatalf("staging file left behind: %v", err)
	}
}

// TestLocalObjectStoreDeleteReclaimsCrashLeftoverTemp: a process crash between
// the temp write and the rename leaves .<key>.tmp; Delete removes it with the
// object so the reconciler can reclaim it (mirrors the legacy DeleteObject
// behavior).
func TestLocalObjectStoreDeleteReclaimsCrashLeftoverTemp(t *testing.T) {
	store, root := newLocalStore(t)
	ctx := context.Background()
	loc := localLoc("k/o.bin")
	dest := filepath.Join(root, "k", "o.bin")

	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tempPath(dest), []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(ctx, loc); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(tempPath(dest)); !os.IsNotExist(err) {
		t.Fatalf("leftover staging file survived Delete: %v", err)
	}
}

// TestLocalObjectStoreSizeMismatch: a declared length the stream cannot meet
// stores nothing.
func TestLocalObjectStoreSizeMismatch(t *testing.T) {
	store, _ := newLocalStore(t)
	ctx := context.Background()
	loc := localLoc("m.bin")

	_, err := store.Put(ctx, loc, strings.NewReader("short"), WriteInfo{SizeBytes: 100})
	if !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("Put = %v, want ErrSizeMismatch", err)
	}
	if _, err := store.Stat(ctx, loc); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Stat after size mismatch = %v, want ErrNotFound", err)
	}
}

// TestLocalObjectStoreOpenWindowEdges covers the range boundary conditions a
// proxy depends on: open-ended lengths, offset at end, offset past end and
// negative offset.
func TestLocalObjectStoreOpenWindowEdges(t *testing.T) {
	store, _ := newLocalStore(t)
	ctx := context.Background()
	loc := localLoc("w.bin")
	if _, err := store.Put(ctx, loc, strings.NewReader("0123456789"), WriteInfo{SizeBytes: 10}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// Open-ended from offset: bytes 8..9.
	obj, err := store.Open(ctx, loc, ReadOptions{Offset: 8, Length: 0})
	if err != nil {
		t.Fatalf("Open open-ended: %v", err)
	}
	got, _ := io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if string(got) != "89" {
		t.Fatalf("open-ended window = %q, want %q", got, "89")
	}

	// Offset exactly at end: an empty body is a legal window.
	obj, err = store.Open(ctx, loc, ReadOptions{Offset: 10, Length: 0})
	if err != nil {
		t.Fatalf("Open at end: %v", err)
	}
	got, _ = io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if len(got) != 0 {
		t.Fatalf("at-end window = %q, want empty", got)
	}

	// Past the end is not-found - no such bytes.
	if _, err := store.Open(ctx, loc, ReadOptions{Offset: 11}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Open past end = %v, want ErrNotFound", err)
	}
	if _, err := store.Open(ctx, loc, ReadOptions{Offset: -1}); !errors.Is(err, ErrLocatorInvalid) {
		t.Fatalf("Open negative offset = %v, want ErrLocatorInvalid", err)
	}
}

// TestLocalObjectStoreCanceledContext: a canceled ctx stops Put before any
// bytes land and fails Open/Stat/Delete without disk work.
func TestLocalObjectStoreCanceledContext(t *testing.T) {
	store, _ := newLocalStore(t)
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	loc := localLoc("c.bin")

	if _, err := store.Put(canceled, loc, strings.NewReader("x"), WriteInfo{SizeBytes: 1}); err == nil {
		t.Fatal("Put on canceled ctx succeeded")
	}
	if _, err := store.Open(canceled, loc, ReadOptions{}); err == nil {
		t.Fatal("Open on canceled ctx succeeded")
	}
	if _, err := store.Stat(canceled, loc); err == nil {
		t.Fatal("Stat on canceled ctx succeeded")
	}
	if err := store.Delete(canceled, loc); err == nil {
		t.Fatal("Delete on canceled ctx succeeded")
	}
}

// TestLocalObjectStoreSignReadUnsupported: the filesystem backend cannot mint
// a URL - it answers the honest refusal, never an empty URL.
func TestLocalObjectStoreSignReadUnsupported(t *testing.T) {
	store, _ := newLocalStore(t)
	signed, err := store.SignRead(context.Background(), localLoc("a.bin"), SignOptions{TTL: time.Minute})
	if !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("SignRead = %v, want ErrCapabilityUnsupported", err)
	}
	if signed.URL != "" {
		t.Fatal("SignRead returned a URL on a backend without presign")
	}
	// SignWrite refuses the same way - no presigned upload exists on a
	// filesystem root.
	signedW, err := store.SignWrite(context.Background(), localLoc("a.bin"), SignOptions{TTL: time.Minute})
	if !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("SignWrite = %v, want ErrCapabilityUnsupported", err)
	}
	if signedW.URL != "" {
		t.Fatal("SignWrite returned a URL on a backend without presign")
	}
}

// TestLocalFactoryPreflightRootErrors: preflight proves the root usable - a
// root that is a file, or a path that cannot be created, fails startup.
func TestLocalFactoryPreflightRootErrors(t *testing.T) {
	// Root is an existing file: MkdirAll fails.
	fileRoot := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(fileRoot, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := (localFactory{}).New(context.Background(), Config{
		Backend: BackendLocal,
		Local:   &LocalConfig{Root: fileRoot},
	}); err == nil {
		t.Fatal("preflight accepted a root that is a file")
	}

	// Root created on demand: a missing dir is created by preflight.
	root := filepath.Join(t.TempDir(), "deep", "nested", "root")
	if _, err := (localFactory{}).New(context.Background(), Config{
		Backend: BackendLocal,
		Local:   &LocalConfig{Root: root},
	}); err != nil {
		t.Fatalf("preflight on a missing root: %v", err)
	}
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		t.Fatalf("preflight did not create the root: %v", err)
	}

	// No local group configured: ErrConfigInvalid, no I/O.
	if _, err := (localFactory{}).New(context.Background(), Config{Backend: BackendLocal}); !errors.Is(err, ErrConfigInvalid) {
		t.Fatalf("factory without config = %v, want ErrConfigInvalid", err)
	}
}

// TestLocalObjectStoreProbe covers the readiness dependency: healthy root
// answers nil, a vanished or file-ified root does not.
func TestLocalObjectStoreProbe(t *testing.T) {
	store, root := newLocalStore(t)
	if err := store.Probe(context.Background()); err != nil {
		t.Fatalf("Probe healthy root: %v", err)
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if err := store.Probe(context.Background()); err == nil {
		t.Fatal("Probe on a deleted root succeeded")
	}
	// Root that is now a file is not a usable directory either.
	if err := os.WriteFile(root, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := store.Probe(context.Background()); err == nil {
		t.Fatal("Probe on a file-ified root succeeded")
	}
}

// TestLocalObjectStoreReadOnlyDirDeleteFails: Delete must return real
// errors - a remove that fails is not idempotent success. Hosts that do not
// enforce directory write permission (Windows on some mounts) skip instead of
// pretending a failure.
func TestLocalObjectStoreReadOnlyDirDeleteFails(t *testing.T) {
	store, root := newLocalStore(t)
	ctx := context.Background()
	loc := localLoc("ro.bin")
	if _, err := store.Put(ctx, loc, strings.NewReader("x"), WriteInfo{SizeBytes: 1}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := os.Chmod(root, 0555); err != nil {
		t.Fatalf("chmod root: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(root, 0755) })
	if err := store.Delete(ctx, loc); err == nil {
		t.Skip("host does not enforce directory permissions - cannot prove the error path")
	}
}
