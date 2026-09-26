package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// localObjectStore is the locator-contract view of the filesystem backend. It
// is a separate type from LocalStorage because Go does not allow two Delete
// signatures on one struct - the legacy Storage interface keeps
// Delete(ctx, key) while this contract speaks Put/Open/Stat/Delete by
// ObjectLocator. Both share uploadDir and the same on-disk layout (object,
// .meta.json sidecar, .<name>.tmp staging file), so objects written through
// one surface are managed correctly by the other.
type localObjectStore struct {
	root string // absolute, already resolved/created by preflight
}

// Backend implements ObjectStore.
func (s *localObjectStore) Backend() Backend { return BackendLocal }

// Capabilities implements ObjectStore. The local backend streams ranged reads
// but cannot mint a presigned URL - local objects are served by the API's own
// authorized route, so a presign-only purpose must not select it.
func (s *localObjectStore) Capabilities() Capabilities {
	return Capabilities{Presign: false, Range: true, VersionedObjects: false}
}

// Put implements ObjectStore. It writes through the same temp file + rename
// the legacy upload uses, so a canceled or failed stream only ever discards
// the staging file - a previous object at the key survives untouched. When
// the locator carries a version or a bucket, or the key fails the object-key
// rules, it is refused before any I/O.
func (s *localObjectStore) Put(ctx context.Context, loc ObjectLocator, body io.Reader, info WriteInfo) (PutResult, error) {
	dest, err := s.localPath(loc)
	if err != nil {
		return PutResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return PutResult{}, err
	}
	counter := &countingReader{r: ctxReader(ctx, body)}
	if err := writeAtomic(dest, counter); err != nil {
		return PutResult{}, fmt.Errorf("local Put: %w", err)
	}
	if info.SizeBytes >= 0 && counter.n != info.SizeBytes {
		// The stream did not deliver the declared length: the object cannot be
		// trusted, so remove it rather than commit a partial write.
		_ = os.Remove(dest)
		return PutResult{}, fmt.Errorf("local Put: %w: declared %d bytes, stored %d", ErrSizeMismatch, info.SizeBytes, counter.n)
	}
	// The same sidecar the legacy Upload writes: it preserves the verified
	// content type so Open/Stat can return it (and ServeFile keeps its
	// Content-Disposition behavior for objects the locator API wrote).
	if info.ContentType != "" || info.Filename != "" {
		meta, _ := json.Marshal(localMeta{Filename: info.Filename, ContentType: info.ContentType})
		// Best-effort, like the legacy path: a missing sidecar costs the
		// download name, never the bytes.
		_ = os.WriteFile(dest+metaSuffix, meta, 0644)
	}
	return PutResult{SizeBytes: counter.n}, nil
}

// Open implements ObjectStore. Offset/Length are served by seeking the open
// file, so a ranged read never buffers the whole object.
func (s *localObjectStore) Open(ctx context.Context, loc ObjectLocator, opts ReadOptions) (*Object, error) {
	path, err := s.localPath(loc)
	if err != nil {
		return nil, err
	}
	if opts.Offset < 0 {
		return nil, fmt.Errorf("local Open: %w: negative offset", ErrLocatorInvalid)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, localErr("Open", err)
	}
	size, err := openFileSize(f)
	if err != nil {
		_ = f.Close()
		return nil, localErr("Open", err)
	}
	if opts.Offset > size {
		_ = f.Close()
		return nil, fmt.Errorf("local Open: %w: offset %d past end of a %d byte object", ErrNotFound, opts.Offset, size)
	}
	if opts.Offset > 0 {
		if _, err := f.Seek(opts.Offset, io.SeekStart); err != nil {
			_ = f.Close()
			return nil, fmt.Errorf("local Open: seek: %w", err)
		}
	}
	remaining := size - opts.Offset
	window := remaining
	if opts.Length > 0 && opts.Length < remaining {
		window = opts.Length
	}
	body := io.Reader(f)
	if window < remaining {
		body = io.LimitReader(f, window)
	}
	info := ObjectInfo{SizeBytes: size, ContentType: localContentType(path), RangeStart: -1, RangeEnd: -1}
	if opts.Offset > 0 || opts.Length > 0 {
		info.RangeStart = opts.Offset
		info.RangeEnd = opts.Offset + window - 1
	}
	return &Object{Info: info, Body: readCloser{Reader: body, c: f}}, nil
}

// Stat implements ObjectStore.
func (s *localObjectStore) Stat(ctx context.Context, loc ObjectLocator) (ObjectInfo, error) {
	path, err := s.localPath(loc)
	if err != nil {
		return ObjectInfo{}, err
	}
	if err := ctx.Err(); err != nil {
		return ObjectInfo{}, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return ObjectInfo{}, localErr("Stat", err)
	}
	if st.IsDir() {
		// A directory under the root is not an object.
		return ObjectInfo{}, fmt.Errorf("local Stat: %w", ErrNotFound)
	}
	return ObjectInfo{SizeBytes: st.Size(), ContentType: localContentType(path), RangeStart: -1, RangeEnd: -1}, nil
}

// Delete implements ObjectStore: idempotent like the legacy DeleteObject, and
// it also reclaims the staging file a crashed Put left behind. The object,
// its sidecar and the staging file all come from the confined path, so a
// delete cannot reach outside the root.
func (s *localObjectStore) Delete(ctx context.Context, loc ObjectLocator) error {
	path, err := s.localPath(loc)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, p := range []string{path, path + metaSuffix, tempPath(path)} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("local Delete: %w", err)
		}
	}
	return nil
}

// SignRead implements ObjectStore. Local has no URL the browser could reach
// without the API, so the capability is reported absent and the call is an
// explicit error instead of a fake URL (spec §3).
func (s *localObjectStore) SignRead(context.Context, ObjectLocator, SignOptions) (SignedURL, error) {
	return SignedURL{}, fmt.Errorf("local SignRead: %w: the filesystem backend serves objects through the API proxy route", ErrCapabilityUnsupported)
}

// SignWrite implements ObjectStore - same refusal as SignRead: a presigned
// PUT has no target on the filesystem backend, so provider-upload flows must
// not run on local.
func (s *localObjectStore) SignWrite(context.Context, ObjectLocator, SignOptions) (SignedURL, error) {
	return SignedURL{}, fmt.Errorf("local SignWrite: %w: the filesystem backend has no presigned upload URL", ErrCapabilityUnsupported)
}

// Probe implements ObjectStore. It answers "is the root still a usable
// directory" - cheap enough for the readiness interval and never a write.
func (s *localObjectStore) Probe(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	st, err := os.Stat(s.root)
	if err != nil {
		return fmt.Errorf("local probe: %w", err)
	}
	if !st.IsDir() {
		return fmt.Errorf("local probe: root is not a directory")
	}
	return nil
}

// localPath confines a locator to the root and returns the filesystem path.
// The lexical check comes first (the key may not escape the root), then the
// path is resolved through any existing symlinks so a link planted inside the
// root cannot redirect a read or a write outside it.
func (s *localObjectStore) localPath(loc ObjectLocator) (string, error) {
	if loc.Storage != BackendLocal {
		return "", fmt.Errorf("local storage: %w: backend %q", ErrLocatorInvalid, string(loc.Storage))
	}
	if loc.Bucket != "" || loc.Version != "" {
		return "", fmt.Errorf("local storage: %w: bucket/version are not local concepts", ErrLocatorInvalid)
	}
	if !validObjectKey(loc.Key) {
		return "", fmt.Errorf("local storage: %w: key", ErrLocatorInvalid)
	}
	target := filepath.Join(s.root, filepath.FromSlash(loc.Key))
	resolved, err := resolveUnderRoot(s.root, target)
	if err != nil {
		return "", fmt.Errorf("local storage: %w: %v", ErrLocatorInvalid, err)
	}
	return resolved, nil
}

// resolveUnderRoot resolves target through the symlinks that already exist and
// verifies the answer stays under root. The root itself is resolved first, so
// a deployment that mounts the upload dir through a symlink compares like for
// like. For a target that does not exist yet (a Put) the deepest existing
// ancestor is resolved and the remainder re-joined - a symlinked directory
// anywhere in the chain still fails the check.
//
// EvalSymlinks is not enough on Windows: it leaves a junction (mount-point
// reparse point) opaque when the junction is the last existing component, so
// "root/linked/new.bin" through a junction into another directory would pass
// the containment check and Put would stream outside the root. The component
// walk below refuses any existing component that is a link, a reparse point,
// or otherwise not a plain directory along the way.
func resolveUnderRoot(root, target string) (string, error) {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve root: %w", err)
	}
	resolved, err := resolveExisting(target)
	if err != nil {
		return "", err
	}
	if !isUnder(resolvedRoot, resolved) {
		return "", fmt.Errorf("path escapes the storage root")
	}
	if err := checkComponentsPlain(resolvedRoot, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

// checkComponentsPlain walks every component of target below root and refuses
// components that are not plain directories (ancestors) or a plain file or
// directory (the leaf). A junction or other reparse point reports
// ModeIrregular rather than IsDir, so it is caught here even where
// EvalSymlinks left it opaque. Missing components are fine: Put creates
// plain directories for them inside the root.
func checkComponentsPlain(root, target string) error {
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes the storage root")
	}
	segs := strings.Split(rel, string(filepath.Separator))
	cur := root
	for i, seg := range segs {
		if seg == "" || seg == "." {
			continue
		}
		cur = filepath.Join(cur, seg)
		fi, err := os.Lstat(cur)
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return fmt.Errorf("inspect path: %w", err)
		}
		last := i == len(segs)-1
		if fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
			return fmt.Errorf("path component %q is a link or reparse point", seg)
		}
		if !last && !fi.IsDir() {
			return fmt.Errorf("path component %q is not a directory", seg)
		}
		if last && !fi.IsDir() && !fi.Mode().IsRegular() {
			return fmt.Errorf("path %q is not a regular file", seg)
		}
	}
	return nil
}

// resolveExisting returns target with every symlink in its existing prefix
// resolved. Missing trailing components are appended after resolution, so the
// result is where the filesystem would actually put the file.
func resolveExisting(target string) (string, error) {
	path := target
	var tail []string
	for {
		if _, err := os.Lstat(path); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("inspect path: %w", err)
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", fmt.Errorf("no existing ancestor for path")
		}
		tail = append(tail, filepath.Base(path))
		path = parent
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}
	for i := len(tail) - 1; i >= 0; i-- {
		resolved = filepath.Join(resolved, tail[i])
	}
	return resolved, nil
}

// countingReader counts bytes as they stream through, so Put can verify a
// declared length and always report the stored size.
type countingReader struct {
	r io.Reader
	n int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	r.n += int64(n)
	return n, err
}

// ctxReader fails the read as soon as ctx is done, so a canceled upload stops
// the copy loop instead of streaming the rest of the body into a staging file
// nobody will rename.
func ctxReader(ctx context.Context, r io.Reader) io.Reader {
	return &ctxBoundReader{ctx: ctx, r: r}
}

type ctxBoundReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *ctxBoundReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

// readCloser couples a (possibly limited) view of a file with the file handle
// the view must close.
type readCloser struct {
	io.Reader
	c io.Closer
}

func (r readCloser) Close() error { return r.c.Close() }

// localContentType reads the verified type from the sidecar an upload wrote;
// absent sidecar means the object predates it and the type stays empty rather
// than being guessed.
func localContentType(path string) string {
	meta, ok := readLocalMeta(path)
	if !ok {
		return ""
	}
	return meta.ContentType
}

// localErr maps filesystem errors onto the contract sentinels: missing object
// is ErrNotFound and nothing else is allowed to masquerade as it (spec §9.4:
// a timeout or a permission failure is not a successful delete's not-found).
func localErr(op string, err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("local %s: %w", op, ErrNotFound)
	}
	return fmt.Errorf("local %s: %w", op, err)
}

func openFileSize(f *os.File) (int64, error) {
	st, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if st.IsDir() {
		return 0, os.ErrNotExist
	}
	return st.Size(), nil
}
