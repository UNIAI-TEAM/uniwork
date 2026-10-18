package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// multipartTestStore is the in-memory multipart adapter the handler tests and
// the isolation world run the chunked upload flow on (contract §7): the local
// adapter has no multipart and cannot presign, so the world's Documents
// service is wired over this wrapper instead. It stores parts in memory,
// assembles them through the wrapped adapter's own Put (so Open, Stat, Range
// and Delete are the real local ones), and mints part URLs that name the
// upload id and part number - the client of a test PUTs with
// multipartTestStore.PutPart rather than over HTTP.
//
// It reports Presign alongside Multipart because SupportsChunkedUpload (the
// one reader of that flag) requires both; the only presign call the flow makes
// is SignUploadPart, which this type implements.
type multipartTestStore struct {
	storage.ObjectStore
	mu      sync.Mutex
	seq     int
	uploads map[string]*multipartTestUpload
	// assembled records the object version CompleteMultipart reported, keyed
	// by object key, so a test can assert the staged version reached the row.
	versions map[string]string
}

type multipartTestUpload struct {
	loc     storage.ObjectLocator
	info    storage.WriteInfo
	parts   map[int32]multipartTestPart
	aborted bool
	done    bool
}

type multipartTestPart struct {
	data []byte
	etag string
}

func newMultipartTestStore(inner storage.ObjectStore) *multipartTestStore {
	return &multipartTestStore{
		ObjectStore: inner,
		uploads:     map[string]*multipartTestUpload{},
		versions:    map[string]string{},
	}
}

func (s *multipartTestStore) Capabilities() storage.Capabilities {
	caps := s.ObjectStore.Capabilities()
	caps.Multipart = true
	caps.Presign = true
	return caps
}

func (s *multipartTestStore) CreateMultipart(_ context.Context, loc storage.ObjectLocator, info storage.WriteInfo) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	uploadID := fmt.Sprintf("test-mp-%d", s.seq)
	s.uploads[uploadID] = &multipartTestUpload{loc: loc, info: info, parts: map[int32]multipartTestPart{}}
	return uploadID, nil
}

func (s *multipartTestStore) SignUploadPart(_ context.Context, loc storage.ObjectLocator, uploadID string, partNumber int32, opts storage.SignOptions) (storage.SignedURL, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	up, ok := s.uploads[uploadID]
	if !ok || up.done || up.aborted || up.loc.Key != loc.Key {
		return storage.SignedURL{}, storage.ErrMultipartNotFound
	}
	return storage.SignedURL{
		URL:       fmt.Sprintf("http://multipart.test/%s?uploadId=%s&partNumber=%d", loc.Key, uploadID, partNumber),
		Method:    http.MethodPut,
		ExpiresAt: time.Now().UTC().Add(opts.TTL),
	}, nil
}

// SignWrite and SignRead answer a synthetic URL. The handler tests never fetch
// one; the isolation world's Office job service only hands the URL to the stub
// engine, which never PUTs, so nothing dereferences it. A test that needs a
// real byte-for-byte presign route should use the service harness's signer.
func (s *multipartTestStore) SignWrite(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	return storage.SignedURL{URL: "http://multipart.test/write/" + loc.Key, Method: http.MethodPut, ExpiresAt: time.Now().UTC().Add(opts.TTL)}, nil
}

func (s *multipartTestStore) SignRead(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	return storage.SignedURL{URL: "http://multipart.test/read/" + loc.Key, Method: http.MethodGet, ExpiresAt: time.Now().UTC().Add(opts.TTL)}, nil
}

func (s *multipartTestStore) ListParts(_ context.Context, loc storage.ObjectLocator, uploadID string) ([]storage.MultipartPart, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	up, ok := s.uploads[uploadID]
	if !ok || up.done || up.aborted || up.loc.Key != loc.Key {
		return nil, storage.ErrMultipartNotFound
	}
	out := make([]storage.MultipartPart, 0, len(up.parts))
	for num, p := range up.parts {
		out = append(out, storage.MultipartPart{PartNumber: num, ETag: p.etag, SizeBytes: int64(len(p.data))})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PartNumber < out[j].PartNumber })
	return out, nil
}

func (s *multipartTestStore) CompleteMultipart(ctx context.Context, loc storage.ObjectLocator, uploadID string, parts []storage.MultipartPart) (storage.PutResult, error) {
	s.mu.Lock()
	up, ok := s.uploads[uploadID]
	if !ok || up.done || up.aborted || up.loc.Key != loc.Key {
		s.mu.Unlock()
		return storage.PutResult{}, storage.ErrMultipartNotFound
	}
	if len(parts) == 0 {
		s.mu.Unlock()
		return storage.PutResult{}, storage.ErrMultipartPartsInvalid
	}
	var assembled bytes.Buffer
	var prev int32
	for _, p := range parts {
		if p.PartNumber <= prev {
			s.mu.Unlock()
			return storage.PutResult{}, storage.ErrMultipartPartsInvalid
		}
		prev = p.PartNumber
		stored, exists := up.parts[p.PartNumber]
		if !exists || normalizePartETag(stored.etag) != normalizePartETag(p.ETag) {
			s.mu.Unlock()
			return storage.PutResult{}, storage.ErrMultipartPartsInvalid
		}
		assembled.Write(stored.data)
	}
	info := up.info
	up.done = true
	s.mu.Unlock()

	body := assembled.Bytes()
	info.SizeBytes = int64(len(body))
	res, err := s.ObjectStore.Put(ctx, loc, bytes.NewReader(body), info)
	if err != nil {
		return storage.PutResult{}, err
	}
	s.mu.Lock()
	s.versions[loc.Key] = res.VersionID
	s.mu.Unlock()
	return res, nil
}

func (s *multipartTestStore) AbortMultipart(_ context.Context, loc storage.ObjectLocator, uploadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if up, ok := s.uploads[uploadID]; ok && up.loc.Key == loc.Key {
		up.aborted = true
	}
	return nil
}

// PutPart is the client's PUT to a signed part URL: store the bytes and
// answer the ETag the client must send back on complete.
func (s *multipartTestStore) PutPart(t *testing.T, key, uploadID string, partNumber int32, data []byte) string {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	up, ok := s.uploads[uploadID]
	if !ok || up.done || up.aborted || up.loc.Key != key {
		t.Fatalf("PutPart: upload %s for key %s is not open", uploadID, key)
	}
	sum := sha256.Sum256(data)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	up.parts[partNumber] = multipartTestPart{data: append([]byte(nil), data...), etag: etag}
	return etag
}

// openUploadForKey reports the id of the open upload for an object key, the
// handle PutPart needs from a test that only knows the session id.
func (s *multipartTestStore) openUploadForKey(key string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, up := range s.uploads {
		if up.loc.Key == key && !up.done && !up.aborted {
			return id, true
		}
	}
	return "", false
}

// hasUpload reports whether the upload id is still open, so a test can prove
// an abort or a failure reached the storage.
func (s *multipartTestStore) hasUpload(uploadID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	up, ok := s.uploads[uploadID]
	return ok && !up.done && !up.aborted
}

// openUploadCount reports how many multipart uploads the store still holds
// open, so a test can prove a refused create never reached the storage.
func (s *multipartTestStore) openUploadCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, up := range s.uploads {
		if !up.done && !up.aborted {
			n++
		}
	}
	return n
}

func normalizePartETag(etag string) string {
	return string(bytes.Trim([]byte(etag), `"`))
}

// newMultipartDocuments wires a Documents service over a real FileService on
// the multipart test store: the world every large-upload handler test needs,
// since Documents refuses the flow (503 storage_unavailable) on a store
// without multipart + presign.
func newMultipartDocuments(t *testing.T, pool *pgxpool.Pool, q *db.Queries, docs *service.DocumentService, chat *service.ChatService, meetings *service.MeetingService, inner storage.ObjectStore) (*service.FileService, *multipartTestStore) {
	t.Helper()
	store := newMultipartTestStore(inner)
	fs, err := service.NewFileService(service.FileServiceOptions{
		Pool: pool, Store: store, SpoolDir: t.TempDir(),
		ReferenceProviders: service.FileReferenceProviders(chat, meetings),
		Quota:              service.NewEntitlementService(pool, q),
	})
	if err != nil {
		t.Fatalf("multipart file service: %v", err)
	}
	docs.SetFiles(fs)
	return fs, store
}
