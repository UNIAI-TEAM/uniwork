package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newMultipartDocEnv(t *testing.T) *docStorageEnv {
	t.Helper()
	env := newRealDocStorageEnv(t, localFileBackend())
	env.store.enableMultipart(true)
	env.svc.SetClock(env.clock.Now)
	return env
}

// nextIDK mints a unique Idempotency-Key for Open calls in tests; the key is
// mandatory (D7), so cases that do not pin a key use this.
var testIDKSeq atomic.Int64

func nextIDK() string {
	return fmt.Sprintf("it-key-%d", testIDKSeq.Add(1))
}

// buildLargePDF builds a valid PDF of exact sizeBytes (> 20 MiB) with %PDF-1.4
// at the start and %%EOF at the tail, plus its UploadSessionProbeInput.
func buildLargePDF(sizeBytes int64, marker string) ([]byte, UploadSessionProbeInput) {
	buf := make([]byte, sizeBytes)
	headPrefix := []byte("%PDF-1.4\n%" + marker + "\n1 0 obj\n<< /Type /Catalog >>\nendobj\n")
	copy(buf, headPrefix)
	for i := len(headPrefix); i < len(buf); i++ {
		buf[i] = ' '
	}
	trailer := []byte("\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")
	copy(buf[int(sizeBytes)-len(trailer):], trailer)
	headLen := min(sizeBytes, int64(UploadSessionMaxProbeHeadBytes))
	return buf, UploadSessionProbeInput{
		HeadB64: base64.StdEncoding.EncodeToString(buf[:headLen]),
	}
}

// buildLargeDOCX builds a valid DOCX ZIP archive of exact sizeBytes (> 20 MiB)
// by padding a stored media entry so the archive reaches sizeBytes, and
// extracts its head (first 64 KiB) and central directory + EOCD tail.
func buildLargeDOCX(t *testing.T, sizeBytes int64, extraEntries map[string][]byte) ([]byte, UploadSessionProbeInput) {
	t.Helper()
	// First build the small entries to measure overhead.
	makeZip := func(padLen int) []byte {
		var b bytes.Buffer
		zw := zip.NewWriter(&b)
		writeStored := func(name string, data []byte) {
			fh := &zip.FileHeader{Name: name, Method: zip.Store}
			w, err := zw.CreateHeader(fh)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := w.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		writeStored("[Content_Types].xml", []byte(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`))
		writeStored("word/document.xml", []byte(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`))
		for k, v := range extraEntries {
			writeStored(k, v)
		}
		if padLen > 0 {
			pad := bytes.Repeat([]byte("A"), padLen)
			writeStored("word/media/image1.bin", pad)
		}
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	baseZip := makeZip(16)
	padNeeded := int(sizeBytes) - len(baseZip) + 16
	if padNeeded < 16 {
		padNeeded = 16
	}
	full := makeZip(padNeeded)
	if int64(len(full)) != sizeBytes {
		t.Fatalf("built zip size = %d, want %d", len(full), sizeBytes)
	}
	cdOffset, cdSize := locateZipCentralDirectory(t, full)
	headLen := min(sizeBytes, int64(UploadSessionMaxProbeHeadBytes))
	return full, UploadSessionProbeInput{
		HeadB64:       base64.StdEncoding.EncodeToString(full[:headLen]),
		CentralDirB64: base64.StdEncoding.EncodeToString(full[cdOffset : cdOffset+cdSize]),
		CDOffset:      cdOffset,
		CDSize:        cdSize,
	}
}

func locateZipCentralDirectory(t *testing.T, archive []byte) (int64, int64) {
	t.Helper()
	eocdIdx := bytes.LastIndex(archive, []byte("PK\x05\x06"))
	if eocdIdx < 0 || eocdIdx+22 > len(archive) {
		t.Fatal("EOCD not found in zip archive")
	}
	cdSize := int64(binary.LittleEndian.Uint32(archive[eocdIdx+12 : eocdIdx+16]))
	cdOffset := int64(binary.LittleEndian.Uint32(archive[eocdIdx+16 : eocdIdx+20]))
	tailSize := int64(len(archive)) - cdOffset
	if cdOffset < 0 || cdOffset+cdSize > int64(len(archive)) {
		t.Fatalf("invalid central directory bounds: offset=%d size=%d total=%d", cdOffset, cdSize, len(archive))
	}
	return cdOffset, tailSize
}

func uploadAllParts(t *testing.T, env *docStorageEnv, sessionID string, fullBody []byte) []CompleteUploadPartInput {
	t.Helper()
	row, err := env.f.q.GetFileMultipartUploadByID(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("get multipart row %s: %v", sessionID, err)
	}
	var out []CompleteUploadPartInput
	partSize := int(row.PartSize)
	for i := 0; i < int(row.TotalParts); i++ {
		start := i * partSize
		end := min(start+partSize, len(fullBody))
		partNum := i + 1
		etag, err := env.store.PutPart(row.ObjectKey, row.StorageUploadID, int32(partNum), fullBody[start:end])
		if err != nil {
			t.Fatalf("put part %d: %v", partNum, err)
		}
		out = append(out, CompleteUploadPartInput{PartNumber: partNum, ETag: etag})
	}
	return out
}

func TestUploadSessionOpenRejectsUnder20MiB(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, probe := buildLargePDF(20<<20+1024, "probe")
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "exact-20mb.pdf",
		SizeBytes: UploadSessionThresholdBytes, // 20 MiB exactly -> must reject
		Probe:     probe})
	ce := wantCode(t, err, "upload_session_too_small")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}
}

func TestUploadSessionOpenRejectsOverMaxBytes(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	maxBytes := env.svc.documentFileMaxBytes()
	_, probe := buildLargePDF(21<<20, "over-cap")
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "huge.pdf",
		SizeBytes: maxBytes + 1,
		Probe:     probe})
	ce := wantCode(t, err, "file_too_large")
	if ce.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", ce.Status)
	}
	if ce.Fields["max_bytes"] != maxBytes {
		t.Fatalf("fields.max_bytes = %v, want %d", ce.Fields["max_bytes"], maxBytes)
	}
}

func TestUploadSessionOpenRejectsDisallowedExtension(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "installer.exe",
		SizeBytes: 25 << 20,
		Probe: UploadSessionProbeInput{
			HeadB64: base64.StdEncoding.EncodeToString([]byte("MZ\x90\x00")),
		}})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
}

func TestUploadSessionOpenRejectsBadMagicInProbe(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	pngBytes := pngBody(t, 4, 4)
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "disguised.pdf",
		SizeBytes: 25 << 20,
		Probe: UploadSessionProbeInput{
			HeadB64: base64.StdEncoding.EncodeToString(pngBytes),
		}})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("multipartCreates = %d, want 0 when probe fails", env.store.multipartCreates)
	}
}

func TestUploadSessionOpenRejectsMacroInZipProbe(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 21 << 20
	_, probe := buildLargeDOCX(t, size, map[string][]byte{
		"word/vbaProject.bin": []byte("macro-payload"),
	})
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "macro.docx",
		SizeBytes: size,
		Probe:     probe})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	reason, _ := ce.Fields["reason"].(string)
	if reason != document.ReasonZipMacro && reason != "zip_macro_payload" {
		t.Fatalf("reason = %q, want %q", reason, document.ReasonZipMacro)
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("multipartCreates = %d, want 0", env.store.multipartCreates)
	}
}

func TestUploadSessionOpenRejectsZipBombInProbe(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 21 << 20
	_, probe := buildLargeDOCX(t, size, nil)
	// Patch the central directory's first entry uncompressed size to 1 GiB (> MaxUncompressedBytes).
	cdRaw, err := base64.StdEncoding.DecodeString(probe.CentralDirB64)
	if err != nil {
		t.Fatal(err)
	}
	// In PK\x01\x02 header, bytes 24..28 are uint32 uncompressed size.
	binary.LittleEndian.PutUint32(cdRaw[24:28], uint32(1<<30))
	probe.CentralDirB64 = base64.StdEncoding.EncodeToString(cdRaw)

	_, err = env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "bomb.docx",
		SizeBytes: size,
		Probe:     probe})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	if ce.Fields["reason"] != document.ReasonZipBomb {
		t.Fatalf("reason = %v, want %s", ce.Fields["reason"], document.ReasonZipBomb)
	}
}

func TestUploadSessionOpenReservesQuotaImmediately(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	// Give the organization a 30 MiB storage limit.
	seedStoragePlan(t, env, 30<<20)

	_, probe := buildLargePDF(50<<20, "quota-exceeded")
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "fifty-mb.pdf",
		SizeBytes: 50 << 20,
		Probe:     probe})
	ce := wantCode(t, err, "quota_exceeded")
	if ce.Status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", ce.Status)
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("CreateMultipart called %d times on quota refusal, want 0", env.store.multipartCreates)
	}
}

func TestUploadSessionOpenRollsBackQuotaWhenCreateMultipartFails(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 60<<20)
	env.store.createMultipartErr = errors.New("s3 create multipart failed")

	_, probe := buildLargePDF(25<<20, "s3-down")
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "fail-mp.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	ce := wantCode(t, err, "storage_unavailable")
	if ce.Status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", ce.Status)
	}

	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after CreateMultipart failure = %d, want 0", used)
	}
}

func TestUploadSessionOpenEnforcesMax4PerUser(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	owner := human(env.tn.owner) // member of both wsA and wsB

	const size = 25 << 20
	body, probe := buildLargePDF(size, "concurrency-cap")

	// Open 2 sessions in wsA and 1 session in wsB (all 'open').
	s1, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "ok-1.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open session 1 (wsA): %v", err)
	}
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "ok-2.pdf",
		SizeBytes: size,
		Probe:     probe}); err != nil {
		t.Fatalf("open session 2 (wsA): %v", err)
	}
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, env.tn.wsB, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "ok-3-wsb.pdf",
		SizeBytes: size,
		Probe:     probe}); err != nil {
		t.Fatalf("open session 3 (wsB): %v", err)
	}

	// Open a 4th session in wsA and hold it in 'validating'.
	s4, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "ok-4-validating.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open session 4 (wsA): %v", err)
	}
	parts4 := uploadAllParts(t, env, s4.SessionID, body)

	inComplete := make(chan struct{})
	releaseComplete := make(chan struct{})
	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			close(inComplete)
			<-releaseComplete
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	completeDone := make(chan error, 1)
	go func() {
		_, cerr := env.svc.CompleteUploadSession(ctx, owner, s4.SessionID, CompleteUploadSessionInput{Parts: parts4})
		completeDone <- cerr
	}()
	<-inComplete

	// 5th open session in wsA or wsB must fail with 429 upload_sessions_exhausted + retry_after = 60.
	for _, wsID := range []string{env.tn.wsA, env.tn.wsB} {
		_, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, wsID, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "fifth.pdf",
			SizeBytes: size,
			Probe:     probe})
		ce := wantCode(t, err, "upload_sessions_exhausted")
		if ce.Status != http.StatusTooManyRequests {
			t.Fatalf("ws=%s status = %d, want 429", wsID, ce.Status)
		}
		if ce.Fields["retry_after"] != 60 {
			t.Fatalf("ws=%s fields.retry_after = %v, want 60", wsID, ce.Fields["retry_after"])
		}
	}

	close(releaseComplete)
	if cerr := <-completeDone; cerr != nil {
		t.Fatalf("complete session 4: %v", cerr)
	}

	// Aborting one frees a slot (and completing s4 also freed one) so the next open succeeds.
	if err := env.svc.AbortUploadSession(ctx, owner, s1.SessionID); err != nil {
		t.Fatalf("abort session 1: %v", err)
	}
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, owner, env.tn.wsB, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "fifth-retry.pdf",
		SizeBytes: size,
		Probe:     probe}); err != nil {
		t.Fatalf("open after abort: %v", err)
	}
}

func TestUploadSessionOpenIdempotentReplay(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "idem-replay")
	in := OpenUploadSessionInput{Filename: "replay.pdf",
		SizeBytes: 25 << 20,
		Title:     "Replay Doc",
		Probe:     probe, IdempotencyKey: "idem-open-1"}
	first, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	second, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, in)
	if err != nil {
		t.Fatalf("replay open: %v", err)
	}
	if second.SessionID != first.SessionID || second.FileID != first.FileID {
		t.Fatalf("replay returned %+v, want %+v", second, first)
	}
	if env.store.multipartCreates != 1 {
		t.Fatalf("multipartCreates = %d, want 1", env.store.multipartCreates)
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 25<<20 {
		t.Fatalf("reserved bytes = %d, want %d", used, 25<<20)
	}
}

func TestUploadSessionOpenIdempotentMismatchReturns409(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, probe := buildLargePDF(25<<20, "idem-mismatch")
	in := OpenUploadSessionInput{Filename: "first.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe, IdempotencyKey: "idem-mismatch-1"}
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, in); err != nil {
		t.Fatalf("first open: %v", err)
	}
	in.Filename = "second.pdf"
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, in)
	ce := wantCode(t, err, "idempotency_payload_mismatch")
	if ce.Status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", ce.Status)
	}
}

func TestUploadSessionGetReturnsCompletedPartsAndMissingPresignedURLs(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20 // 4 parts (8M, 8M, 8M, 1M)
	body, probe := buildLargePDF(size, "resume-parts")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "resume.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if opened.TotalParts != 4 || len(opened.Parts) != 4 {
		t.Fatalf("TotalParts=%d len(Parts)=%d, want 4", opened.TotalParts, len(opened.Parts))
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	partSize := int(row.PartSize)
	if _, err := env.store.PutPart(row.ObjectKey, row.StorageUploadID, 1, body[0:partSize]); err != nil {
		t.Fatal(err)
	}
	if _, err := env.store.PutPart(row.ObjectKey, row.StorageUploadID, 2, body[partSize:2*partSize]); err != nil {
		t.Fatal(err)
	}

	got, err := env.svc.GetUploadSession(ctx, member, opened.SessionID)
	if err != nil {
		t.Fatalf("GetUploadSession: %v", err)
	}
	if got.Status != "open" {
		t.Fatalf("status = %q, want open", got.Status)
	}
	if len(got.CompletedParts) != 2 || got.CompletedParts[0].PartNumber != 1 || got.CompletedParts[1].PartNumber != 2 {
		t.Fatalf("CompletedParts = %+v, want parts 1 and 2", got.CompletedParts)
	}
	if len(got.Parts) != 2 || got.Parts[0].PartNumber != 3 || got.Parts[1].PartNumber != 4 {
		t.Fatalf("Parts = %+v, want missing parts 3 and 4", got.Parts)
	}
}

func TestUploadSessionGetRejectsOtherUserWith404(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	other := human(env.tn.aclOwner)

	_, probe := buildLargePDF(25<<20, "other-user")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "private-sess.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	if _, err := env.svc.GetUploadSession(ctx, other, opened.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetUploadSession by other user = %v, want ErrNotFound", err)
	}
	if _, err := env.svc.CompleteUploadSession(ctx, other, opened.SessionID, CompleteUploadSessionInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CompleteUploadSession by other user = %v, want ErrNotFound", err)
	}
	if err := env.svc.AbortUploadSession(ctx, other, opened.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AbortUploadSession by other user = %v, want ErrNotFound", err)
	}
}

func TestUploadSessionGetReChecksRevokedPermission(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, probe := buildLargePDF(25<<20, "revoked-perm")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "revoked.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Remove member from workspace after opening the session.
	if _, err := env.f.pool.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, env.tn.wsA, env.tn.member.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := env.svc.GetUploadSession(ctx, member, opened.SessionID); err == nil {
		t.Fatal("expected error after workspace membership was revoked")
	}
	if _, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{}); err == nil {
		t.Fatal("expected error on Complete after workspace membership was revoked")
	}
	if err := env.svc.AbortUploadSession(ctx, member, opened.SessionID); err == nil {
		t.Fatal("expected error on Abort after workspace membership was revoked")
	}
}

func TestUploadSessionFrameScopeBoundToDocument(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	docA := env.createFile(t, member, "doc-a.pdf", pdfBody("doc-a"))
	docB := env.createFile(t, member, "doc-b.pdf", pdfBody("doc-b"))

	claimsA := OfficeFrameClaims{
		Version:        1,
		DocumentID:     docA.Document.ID,
		WorkspaceID:    env.tn.wsA,
		OrganizationID: env.tn.orgID,
		UserID:         env.tn.member.ID,
	}
	claimsB := claimsA
	claimsB.DocumentID = docB.Document.ID

	_, probe := buildLargePDF(25<<20, "frame-scope")

	// Token for doc A trying to open on doc B -> 404.
	if _, err := env.svc.OpenFrameUploadSession(ctx, claimsA, docB.Document.ID, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "v2.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("OpenFrameUploadSession with mismatched doc = %v, want ErrNotFound", err)
	}

	openedA, err := env.svc.OpenFrameUploadSession(ctx, claimsA, docA.Document.ID, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "v2.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("OpenFrameUploadSession on docA: %v", err)
	}

	// Token for doc B trying to Get/Complete/Abort doc A's session -> 404.
	if _, err := env.svc.GetFrameUploadSession(ctx, claimsB, docB.Document.ID, openedA.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetFrameUploadSession with token B = %v, want ErrNotFound", err)
	}
	if _, err := env.svc.CompleteFrameUploadSession(ctx, claimsB, docB.Document.ID, openedA.SessionID, CompleteUploadSessionInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("CompleteFrameUploadSession with token B = %v, want ErrNotFound", err)
	}
	if err := env.svc.AbortFrameUploadSession(ctx, claimsB, docB.Document.ID, openedA.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AbortFrameUploadSession with token B = %v, want ErrNotFound", err)
	}

	// Non-frame GetUploadSession on a frame session -> 404.
	if _, err := env.svc.GetUploadSession(ctx, member, openedA.SessionID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-frame GetUploadSession on frame session = %v, want ErrNotFound", err)
	}
}

func TestUploadSessionCompleteHappyPathCreatesDocument(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargeDOCX(t, size, nil)
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "quarterly-report.docx",
		SizeBytes: size,
		Title:     "Quarterly Report",
		Probe:     probe})
	if err != nil {
		t.Fatalf("OpenWorkspaceUploadSession: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	res, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err != nil {
		t.Fatalf("CompleteUploadSession: %v", err)
	}
	if res.Document == nil || res.Document.Document.ID == "" {
		t.Fatalf("Complete result missing Document: %+v", res)
	}
	if res.Document.Document.Title != "Quarterly Report" || res.Document.File.SizeBytes != size {
		t.Fatalf("Document = %+v, File = %+v", res.Document.Document, res.Document.File)
	}
	if n := env.countOutbox(t, "document.created", res.Document.Document.ID); n != 1 {
		t.Fatalf("outbox document.created count = %d, want 1", n)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, res.Document.Document.ID); n != 1 {
		t.Fatalf("audit document.created count = %d, want 1", n)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionCompleted, opened.SessionID); n != 1 {
		t.Fatalf("audit document.upload_session_completed count = %d, want 1", n)
	}
}

func TestUploadSessionCompleteRejectsMissingOrMismatchedParts(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargePDF(size, "bad-parts")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "parts.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	// Missing last part -> 422 upload_parts_invalid, and session returns to open.
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{
		Parts: parts[:len(parts)-1],
	})
	ce := wantCode(t, err, "upload_parts_invalid")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}

	// Wrong ETag -> 422 upload_parts_invalid, and session stays open.
	badParts := append([]CompleteUploadPartInput(nil), parts...)
	badParts[0].ETag = `"00000000000000000000000000000000"`
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{
		Parts: badParts,
	})
	wantCode(t, err, "upload_parts_invalid")

	got, err := env.svc.GetUploadSession(ctx, member, opened.SessionID)
	if err != nil || got.Status != "open" {
		t.Fatalf("GetUploadSession after bad parts = %+v, err=%v, want status=open", got, err)
	}

	// Now completing with the valid parts succeeds.
	if _, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts}); err != nil {
		t.Fatalf("Complete with valid parts after retry: %v", err)
	}
}

func TestUploadSessionCompleteRejectsSizeMismatch(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "size-mismatch")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "truncated.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// Truncate the last part by 100 bytes so CompleteMultipart succeeds but Stat size != size_bytes.
	parts := uploadAllParts(t, env, opened.SessionID, body[:len(body)-100])

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, "upload_size_mismatch")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" {
		t.Fatalf("session status = %q, want failed", row.Status)
	}
	if env.store.deletedKeys[row.ObjectKey] == 0 {
		t.Fatalf("expected object %s to be deleted on size mismatch", row.ObjectKey)
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after size mismatch failure = %d, want 0", used)
	}

	// Contract §4: a retried complete on a failed session answers the same
	// error, status and reason - it never re-enters validation.
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	retry := wantCode(t, err, "upload_size_mismatch")
	if retry.Status != http.StatusUnprocessableEntity {
		t.Fatalf("retry status = %d, want 422", retry.Status)
	}
}

func TestUploadSessionCompleteRejectsChangedZipTail(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargeDOCX(t, size, nil)
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "tampered.docx",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Tamper with a byte in the central directory tail before uploading parts.
	tampered := append([]byte(nil), body...)
	tampered[probe.CDOffset+10] ^= 0xff
	parts := uploadAllParts(t, env, opened.SessionID, tampered)

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, "upload_probe_mismatch")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" {
		t.Fatalf("session status = %q, want failed", row.Status)
	}
	if env.store.deletedKeys[row.ObjectKey] == 0 {
		t.Fatalf("expected object %s to be deleted on probe mismatch", row.ObjectKey)
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after probe mismatch = %d, want 0", used)
	}

	// Contract §4: a retried complete on a failed session answers the same
	// error, status and reason - it never re-enters validation.
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	retry := wantCode(t, err, "upload_probe_mismatch")
	if retry.Status != http.StatusUnprocessableEntity {
		t.Fatalf("retry status = %d, want 422", retry.Status)
	}
}

func TestUploadSessionCompleteStreamsFullValidateFile(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "missing-eof")
	// Remove %%EOF from the tail (outside the 64 KiB head probe) so Open passes
	// on head_b64 but Complete's full ValidateFile rejects it with 415.
	copy(body[len(body)-32:], bytes.Repeat([]byte("X"), 32))

	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "corrupt-tail.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	if ce.Fields["reason"] != document.ReasonPDFTrailer {
		t.Fatalf("reason = %v, want %s", ce.Fields["reason"], document.ReasonPDFTrailer)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" {
		t.Fatalf("session status = %q, want failed", row.Status)
	}
	if env.store.deletedKeys[row.ObjectKey] == 0 {
		t.Fatalf("expected object %s to be deleted on ValidateFile failure", row.ObjectKey)
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after ValidateFile failure = %d, want 0", used)
	}

	// Contract §4: a retried complete on a failed session answers the same
	// error, status and fields.reason - it never re-enters validation.
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	retry := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if retry.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("retry status = %d, want 415", retry.Status)
	}
	if retry.Fields["reason"] != document.ReasonPDFTrailer {
		t.Fatalf("retry reason = %v, want %s", retry.Fields["reason"], document.ReasonPDFTrailer)
	}
}

func TestUploadSessionCompleteConcurrentCallReturns409Busy(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargePDF(size, "concurrent-complete")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "concurrent.pdf",
		SizeBytes: size,
		Title:     "Concurrent Doc",
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	inComplete := make(chan struct{})
	releaseComplete := make(chan struct{})
	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			close(inComplete)
			<-releaseComplete
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	var firstRes UploadSessionCompleteResult
	var firstErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		firstRes, firstErr = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	}()

	<-inComplete
	// Second concurrent Complete while first holds the validating lease -> 409 upload_session_busy.
	_, busyErr := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	close(releaseComplete)
	<-done

	if firstErr != nil {
		t.Fatalf("first Complete: %v", firstErr)
	}
	ce := wantCode(t, busyErr, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", ce.Status)
	}
	if ce.Fields["retry_after"] != 5 {
		t.Fatalf("fields.retry_after = %v, want 5", ce.Fields["retry_after"])
	}

	// Calling Complete again after completion returns the same idempotent result.
	replayRes, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err != nil {
		t.Fatalf("idempotent Complete after completion: %v", err)
	}
	if replayRes.Document == nil || replayRes.Document.Document.ID != firstRes.Document.Document.ID {
		t.Fatalf("replay Document = %+v, want %+v", replayRes.Document, firstRes.Document)
	}
}

func TestUploadSessionAbortReleasesQuotaAndAbortsMultipart(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "abort-session")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "abort.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	if err := env.svc.AbortUploadSession(ctx, member, opened.SessionID); err != nil {
		t.Fatalf("first AbortUploadSession: %v", err)
	}
	// Repeating Abort is idempotent.
	if err := env.svc.AbortUploadSession(ctx, member, opened.SessionID); err != nil {
		t.Fatalf("second AbortUploadSession: %v", err)
	}
	if env.store.multipartAborts == 0 {
		t.Fatal("expected AbortMultipart to be called on storage")
	}

	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after Abort = %d, want 0", used)
	}

	// Get and Complete after Abort return 410 upload_session_expired.
	_, err = env.svc.GetUploadSession(ctx, member, opened.SessionID)
	ce := wantCode(t, err, "upload_session_expired")
	if ce.Status != http.StatusGone {
		t.Fatalf("Get after Abort status = %d, want 410", ce.Status)
	}
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{})
	ce = wantCode(t, err, "upload_session_expired")
	if ce.Status != http.StatusGone {
		t.Fatalf("Complete after Abort status = %d, want 410", ce.Status)
	}
}

func TestUploadSessionAbortAfterCompleteReturns409(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargePDF(size, "abort-after-complete")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "done.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)
	if _, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts}); err != nil {
		t.Fatalf("complete: %v", err)
	}

	err = env.svc.AbortUploadSession(ctx, member, opened.SessionID)
	ce := wantCode(t, err, "upload_session_completed")
	if ce.Status != http.StatusConflict {
		t.Fatalf("status = %d, want 409", ce.Status)
	}
}

func TestUploadSessionAbortStealableValidatingAndLiveLeaseBusy(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, probe := buildLargePDF(25<<20, "abort-validating")
	var sessions []UploadSessionView
	for i := 0; i < 4; i++ {
		v, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "slot.pdf",
			SizeBytes: 25 << 20,
			Probe:     probe})
		if err != nil {
			t.Fatalf("open session %d: %v", i+1, err)
		}
		sessions = append(sessions, v)
	}

	// Acquire a live validation lease on session 0.
	now := env.clock.Now().UTC().Truncate(time.Microsecond)
	if _, err := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID:             sessions[0].SessionID,
		LeaseOwner:     "complete:test-live-lease",
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		t.Fatalf("lease session 0: %v", err)
	}

	// Aborting while the lease is live must return 409 upload_session_busy and keep the row validating.
	busyErr := env.svc.AbortUploadSession(ctx, member, sessions[0].SessionID)
	ce := wantCode(t, busyErr, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("live-lease abort status = %d, want 409", ce.Status)
	}
	if ce.Fields["retry_after"] != 5 {
		t.Fatalf("fields.retry_after = %v, want 5", ce.Fields["retry_after"])
	}
	liveRow, err := env.f.q.GetFileMultipartUploadByID(ctx, sessions[0].SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if liveRow.Status != "validating" || liveRow.ClosedAt.Valid {
		t.Fatalf("row after live-lease abort = status %q closed_at %v, want validating with NULL closed_at", liveRow.Status, liveRow.ClosedAt)
	}

	// Expire only the validation lease (session TTL is 24h, lease TTL is 10m).
	env.clock.Advance(UploadSessionValidationLeaseTTL + time.Minute)
	if err := env.svc.AbortUploadSession(ctx, member, sessions[0].SessionID); err != nil {
		t.Fatalf("abort validating session with expired lease: %v", err)
	}

	abortedRow, err := env.f.q.GetFileMultipartUploadByID(ctx, sessions[0].SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if abortedRow.Status != "aborted" || !abortedRow.ClosedAt.Valid {
		t.Fatalf("row after expired-lease abort = status %q closed_at %v, want aborted with closed_at set", abortedRow.Status, abortedRow.ClosedAt)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionAborted, sessions[0].SessionID); n != 1 {
		t.Fatalf("audit document.upload_session_aborted = %d, want 1", n)
	}

	// The D5 concurrency slot is now free so opening another session succeeds.
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "freed-slot.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe}); err != nil {
		t.Fatalf("open after aborting expired-lease validating session: %v", err)
	}
}

func TestExpireMultipartUploadsReclaimsQuotaAndAudits(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "gc-expire")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "expire-me.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Advance clock past 24h TTL.
	env.clock.Advance(25 * time.Hour)
	expiredCount, err := env.svc.ExpireMultipartUploads(ctx, env.clock.Now())
	if err != nil {
		t.Fatalf("ExpireMultipartUploads: %v", err)
	}
	if expiredCount < 1 {
		t.Fatalf("expiredCount = %d, want >= 1", expiredCount)
	}
	if env.store.multipartAborts == 0 {
		t.Fatal("expected AbortMultipart to be called on expired session")
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 0 {
		t.Fatalf("used storage bytes after ExpireMultipartUploads = %d, want 0", used)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, opened.SessionID); n != 1 {
		t.Fatalf("audit document.upload_session_expired = %d, want 1", n)
	}
}

func TestExpireMultipartUploadsConcurrentCallsClaimEachRowOnce(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	_, probe := buildLargePDF(25<<20, "gc-concurrent")
	s1, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "expire-1.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open s1: %v", err)
	}
	s2, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "expire-2.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open s2: %v", err)
	}
	row1, err := env.f.q.GetFileMultipartUploadByID(ctx, s1.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	row2, err := env.f.q.GetFileMultipartUploadByID(ctx, s2.SessionID)
	if err != nil {
		t.Fatal(err)
	}

	env.clock.Advance(25 * time.Hour)
	sweepNow := env.clock.Now()

	firstInAbort := make(chan struct{})
	secondDone := make(chan struct{})
	var entered atomic.Bool
	env.store.beforeAbort = func(key string) {
		if key == row1.ObjectKey || key == row2.ObjectKey {
			if entered.CompareAndSwap(false, true) {
				close(firstInAbort)
				<-secondDone
			}
		}
	}
	defer func() { env.store.beforeAbort = nil }()

	var n1, n2 int
	var err1, err2 error
	done1 := make(chan struct{})
	go func() {
		defer close(done1)
		n1, err1 = env.svc.ExpireMultipartUploads(ctx, sweepNow)
	}()

	<-firstInAbort
	n2, err2 = env.svc.ExpireMultipartUploads(ctx, sweepNow)
	close(secondDone)
	<-done1

	if err1 != nil || err2 != nil {
		t.Fatalf("concurrent ExpireMultipartUploads err1=%v err2=%v", err1, err2)
	}
	if n1+n2 < 2 {
		t.Fatalf("total expired count = %d (n1=%d, n2=%d), want >= 2", n1+n2, n1, n2)
	}
	env.store.mu.Lock()
	aborts1 := env.store.abortsByKey[row1.ObjectKey]
	aborts2 := env.store.abortsByKey[row2.ObjectKey]
	env.store.mu.Unlock()
	if aborts1 != 1 || aborts2 != 1 {
		t.Fatalf("AbortMultipart counts = (%d, %d), want (1, 1)", aborts1, aborts2)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, s1.SessionID); n != 1 {
		t.Fatalf("s1 audit document.upload_session_expired = %d, want 1", n)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, s2.SessionID); n != 1 {
		t.Fatalf("s2 audit document.upload_session_expired = %d, want 1", n)
	}
}

func TestExpireMultipartUploadsLeavesLiveSessionsUntouched(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	// Drain any expired sessions left in the shared test DB by earlier tests.
	for {
		n, err := env.svc.ExpireMultipartUploads(ctx, env.clock.Now().Add(48*time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	env.store.mu.Lock()
	env.store.multipartAborts = 0
	env.store.mu.Unlock()

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	_, probe := buildLargePDF(size, "gc-live-untouched")

	// 1. Live 'open' row.
	openSess, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "live-open.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open live session: %v", err)
	}

	// 2. 'validating' row with a live lease.
	valSess, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "live-validating.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open validating session: %v", err)
	}
	now := env.clock.Now().UTC().Truncate(time.Microsecond)
	if _, err := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID:             valSess.SessionID,
		LeaseOwner:     "complete:live-holder",
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		t.Fatalf("lease validating session: %v", err)
	}

	n, err := env.svc.ExpireMultipartUploads(ctx, env.clock.Now())
	if err != nil {
		t.Fatalf("ExpireMultipartUploads: %v", err)
	}
	if n != 0 {
		t.Fatalf("expiredCount = %d, want 0 for live open and live-leased validating rows", n)
	}
	if env.store.multipartAborts != 0 {
		t.Fatalf("multipartAborts = %d, want 0", env.store.multipartAborts)
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != 2*size {
		t.Fatalf("used storage bytes = %d, want %d (quota still held for both)", used, 2*size)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, openSess.SessionID); n != 0 {
		t.Fatalf("openSess expired audit = %d, want 0", n)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, valSess.SessionID); n != 0 {
		t.Fatalf("valSess expired audit = %d, want 0", n)
	}

	// Also verify a validating row whose session TTL has elapsed while its validation lease is still live is untouched.
	if err := env.svc.AbortUploadSession(ctx, member, openSess.SessionID); err != nil {
		t.Fatalf("abort openSess: %v", err)
	}
	env.store.mu.Lock()
	env.store.multipartAborts = 0
	env.store.mu.Unlock()

	env.clock.Advance(UploadSessionTTL - time.Minute)
	leaseStart := env.clock.Now().UTC().Truncate(time.Microsecond)
	if _, err := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID:             valSess.SessionID,
		LeaseOwner:     "complete:live-holder-2",
		LeaseExpiresAt: pgtype.Timestamptz{Time: leaseStart.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: leaseStart, Valid: true},
	}); err != nil {
		t.Fatalf("re-lease validating session: %v", err)
	}
	// Advance 2 minutes: expires_at <= now, but lease_expires_at > now.
	env.clock.Advance(2 * time.Minute)
	n, err = env.svc.ExpireMultipartUploads(ctx, env.clock.Now())
	if err != nil {
		t.Fatalf("ExpireMultipartUploads with live lease past TTL: %v", err)
	}
	if n != 0 {
		t.Fatalf("expiredCount = %d, want 0 when validation lease is still live", n)
	}
	if env.store.multipartAborts != 0 {
		t.Fatalf("multipartAborts = %d, want 0", env.store.multipartAborts)
	}
	used, err = env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != size {
		t.Fatalf("used storage bytes = %d, want %d (quota still held for live-leased session)", used, size)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionExpired, valSess.SessionID); n != 0 {
		t.Fatalf("valSess expired audit = %d, want 0", n)
	}
}

func TestUploadSessionCompleteVersionAndFrameHappyPath(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	doc := env.createFile(t, member, "report.pdf", pdfBody("v1"))
	const size = 25 << 20
	bodyV2, probeV2 := buildLargePDF(size, "version-v2")

	// Version open -> complete -> CommitFileVersion.
	verSess, err := env.svc.OpenVersionUploadSession(ctx, member, doc.Document.ID, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "report.pdf",
		SizeBytes: size,
		Probe:     probeV2})
	if err != nil {
		t.Fatalf("OpenVersionUploadSession: %v", err)
	}
	verParts := uploadAllParts(t, env, verSess.SessionID, bodyV2)
	verRes, err := env.svc.CompleteUploadSession(ctx, member, verSess.SessionID, CompleteUploadSessionInput{Parts: verParts})
	if err != nil {
		t.Fatalf("CompleteUploadSession (version): %v", err)
	}
	if verRes.Upload == nil || verRes.Upload.UploadID == "" || verRes.Upload.SizeBytes != size {
		t.Fatalf("version Complete result = %+v", verRes)
	}
	committedV2, err := env.svc.CommitFileVersion(ctx, member, doc.Document.ID, CommitFileVersionInput{
		UploadID:     verRes.Upload.UploadID,
		BaseRevision: doc.Document.Revision,
	})
	if err != nil {
		t.Fatalf("CommitFileVersion v2: %v", err)
	}
	if committedV2.Document.CurrentVersion != 2 {
		t.Fatalf("CurrentVersion = %d, want 2", committedV2.Document.CurrentVersion)
	}

	// Frame open -> complete -> CommitFileVersion.
	bodyV3, probeV3 := buildLargePDF(size, "frame-v3")
	claims := OfficeFrameClaims{
		Version:        1,
		DocumentID:     doc.Document.ID,
		WorkspaceID:    env.tn.wsA,
		OrganizationID: env.tn.orgID,
		UserID:         env.tn.member.ID,
		Module:         OfficeFrameModulePDF,
	}
	frameSess, err := env.svc.OpenFrameUploadSession(ctx, claims, doc.Document.ID, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "report.pdf",
		SizeBytes: size,
		Probe:     probeV3})
	if err != nil {
		t.Fatalf("OpenFrameUploadSession: %v", err)
	}
	frameParts := uploadAllParts(t, env, frameSess.SessionID, bodyV3)
	frameRes, err := env.svc.CompleteFrameUploadSession(ctx, claims, doc.Document.ID, frameSess.SessionID, CompleteUploadSessionInput{Parts: frameParts})
	if err != nil {
		t.Fatalf("CompleteFrameUploadSession: %v", err)
	}
	if frameRes.Upload == nil || frameRes.Upload.UploadID == "" {
		t.Fatalf("frame Complete result = %+v", frameRes)
	}
	committedV3, err := env.svc.CommitFileVersion(ctx, member, doc.Document.ID, CommitFileVersionInput{
		UploadID:     frameRes.Upload.UploadID,
		BaseRevision: committedV2.Document.Revision,
	})
	if err != nil {
		t.Fatalf("CommitFileVersion v3: %v", err)
	}
	if committedV3.Document.CurrentVersion != 3 {
		t.Fatalf("CurrentVersion = %d, want 3", committedV3.Document.CurrentVersion)
	}
}

func TestSupportsChunkedUploadReflectsStoreCapabilities(t *testing.T) {
	env := newRealDocStorageEnv(t, localFileBackend())
	if env.svc.SupportsChunkedUpload() {
		t.Fatal("SupportsChunkedUpload = true on local non-multipart store, want false")
	}
	env.store.enableMultipart(true)
	if !env.svc.SupportsChunkedUpload() {
		t.Fatal("SupportsChunkedUpload = false when Multipart && Presign enabled, want true")
	}
}

func TestUploadSessionProbeTailNotNullAndAlwaysCompared(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	_, pdfProbe := buildLargePDF(size, "tail-not-null")
	pdfSess, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "non-zip.pdf",
		SizeBytes: size,
		Probe:     pdfProbe})
	if err != nil {
		t.Fatalf("open pdf session: %v", err)
	}

	// 1. probe_tail_sha256 must be NOT NULL (empty string for non-zip) in DB.
	var tailIsNull bool
	var tailVal string
	if err := env.f.pool.QueryRow(ctx,
		`SELECT probe_tail_sha256 IS NULL, COALESCE(probe_tail_sha256, '') FROM file_multipart_uploads WHERE id = $1`,
		pdfSess.SessionID,
	).Scan(&tailIsNull, &tailVal); err != nil {
		t.Fatal(err)
	}
	if tailIsNull || tailVal != "" {
		t.Fatalf("non-zip probe_tail_sha256 isNull=%v val=%q, want isNull=false val=\"\"", tailIsNull, tailVal)
	}
	if _, err := env.f.pool.Exec(ctx,
		`UPDATE file_multipart_uploads SET probe_tail_sha256 = NULL WHERE id = $1`,
		pdfSess.SessionID,
	); err == nil {
		t.Fatal("expected NOT NULL violation when setting probe_tail_sha256 = NULL")
	}

	// 2. CHECK ((cd_offset IS NULL) = (cd_size IS NULL)) must reject unpaired values.
	if _, err := env.f.pool.Exec(ctx,
		`UPDATE file_multipart_uploads SET cd_offset = 100, cd_size = NULL WHERE id = $1`,
		pdfSess.SessionID,
	); err == nil {
		t.Fatal("expected CHECK violation when cd_offset IS NOT NULL and cd_size IS NULL")
	}

	// 3. Zip session stores 64-hex digest and Complete always compares the tail.
	docxBody, docxProbe := buildLargeDOCX(t, size, nil)
	docxSess, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "zip-tail.docx",
		SizeBytes: size,
		Probe:     docxProbe})
	if err != nil {
		t.Fatalf("open docx session: %v", err)
	}
	if err := env.f.pool.QueryRow(ctx,
		`SELECT COALESCE(probe_tail_sha256, '') FROM file_multipart_uploads WHERE id = $1`,
		docxSess.SessionID,
	).Scan(&tailVal); err != nil {
		t.Fatal(err)
	}
	if len(tailVal) != 64 {
		t.Fatalf("zip probe_tail_sha256 len = %d (%q), want 64-hex digest", len(tailVal), tailVal)
	}

	// Force probe_tail_sha256 to empty string on the zip row; Complete must still compare and fail.
	if _, err := env.f.pool.Exec(ctx,
		`UPDATE file_multipart_uploads SET probe_tail_sha256 = '' WHERE id = $1`,
		docxSess.SessionID,
	); err != nil {
		t.Fatal(err)
	}
	parts := uploadAllParts(t, env, docxSess.SessionID, docxBody)
	_, err = env.svc.CompleteUploadSession(ctx, member, docxSess.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, "upload_probe_mismatch")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}
}

func TestUploadSessionFailFencedByLeaseOwner(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "fail-lease-fence")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "fenced.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Tamper with the first byte of the uploaded body so Completer A hits the
	// head-probe mismatch failure path after CompleteMultipart.
	tampered := append([]byte(nil), body...)
	tampered[10] ^= 0xff
	parts := uploadAllParts(t, env, opened.SessionID, tampered)

	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			// Expire Completer A's validation lease and let Completer B steal the lease.
			env.clock.Advance(UploadSessionValidationLeaseTTL + time.Minute)
			nowB := env.clock.Now().UTC().Truncate(time.Microsecond)
			if _, lerr := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
				ID:             opened.SessionID,
				LeaseOwner:     "complete:worker-B",
				LeaseExpiresAt: pgtype.Timestamptz{Time: nowB.Add(UploadSessionValidationLeaseTTL), Valid: true},
				Now:            pgtype.Timestamptz{Time: nowB, Valid: true},
			}); lerr != nil {
				t.Errorf("worker B lease failed: %v", lerr)
			}
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	// Completer A's fail path must notice its lease was lost, not fail B's row or delete B's object, and return 409 busy.
	_, errA := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, errA, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("Completer A status = %d, want 409", ce.Status)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "validating" || row.LeaseOwner.String != "complete:worker-B" {
		t.Fatalf("row after A's fenced fail = status %q lease_owner %q, want validating with complete:worker-B", row.Status, row.LeaseOwner.String)
	}
	if env.store.deletedKeys[row.ObjectKey] != 0 {
		t.Fatalf("deletedKeys[%s] = %d, want 0 when lease was lost", row.ObjectKey, env.store.deletedKeys[row.ObjectKey])
	}
	used, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if used != size {
		t.Fatalf("used storage bytes = %d, want %d (still reserved for B)", used, size)
	}
}

func TestUploadSessionLeaseReleasePastExpiryDoesNotResurrectToOpen(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	_, probe := buildLargePDF(size, "release-past-expiry")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "expire-during-complete.pdf",
		SizeBytes: size,
		Probe:     probe})
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	// Lease just before expires_at, then advance past expires_at inside ListParts so releaseLease runs past TTL.
	env.clock.Advance(UploadSessionTTL - time.Minute)
	env.store.beforeListParts = func() {
		env.clock.Advance(2 * time.Minute)
	}
	defer func() { env.store.beforeListParts = nil }()

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: nil})
	ce := wantCode(t, err, "upload_session_expired")
	if ce.Status != http.StatusGone {
		t.Fatalf("Complete past expiry status = %d, want 410", ce.Status)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status == "open" {
		t.Fatalf("row status = %q after past-TTL lease release, must not resurrect to open", row.Status)
	}
}

func seedStoragePlan(t *testing.T, env *docStorageEnv, limitBytes int64) {
	t.Helper()
	env.setStorageLimit(t, limitBytes)
}

// buildLargeODT builds a valid ODF text package of exact sizeBytes: a stored
// `mimetype` entry naming ODT first (the ODF-mandated shape odfType reads),
// content.xml, and a stored pad entry, with its probe (head + central dir).
func buildLargeODT(t *testing.T, sizeBytes int64, compressMimetype bool) ([]byte, UploadSessionProbeInput) {
	t.Helper()
	makeZip := func(padLen int) []byte {
		var b bytes.Buffer
		zw := zip.NewWriter(&b)
		writeStored := func(name string, data []byte, compress bool) {
			method := zip.Store
			if compress {
				method = zip.Deflate
			}
			fh := &zip.FileHeader{Name: name, Method: method}
			w, err := zw.CreateHeader(fh)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := w.Write(data); err != nil {
				t.Fatal(err)
			}
		}
		writeStored("mimetype", []byte("application/vnd.oasis.opendocument.text"), compressMimetype)
		writeStored("content.xml", []byte(`<?xml version="1.0"?><office:document-content/>`), false)
		if padLen > 0 {
			writeStored("media/pad.bin", bytes.Repeat([]byte("P"), padLen), false)
		}
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	baseZip := makeZip(16)
	padNeeded := int(sizeBytes) - len(baseZip) + 16
	if padNeeded < 16 {
		padNeeded = 16
	}
	full := makeZip(padNeeded)
	if int64(len(full)) != sizeBytes {
		t.Fatalf("built odt size = %d, want %d", len(full), sizeBytes)
	}
	// Go's zip writer defers CRC and sizes into a data descriptor (flag 0x8),
	// which leaves them zero in the local header - and odfType proves ODF by
	// reading the mimetype bytes straight out of that header. Patch entry 0
	// (the stored mimetype) the way a real ODT writer emits it: descriptor
	// flag cleared, crc + sizes in the header. The dangling descriptor after
	// the entry is harmless: every reader here goes by the central directory.
	if !compressMimetype {
		if !bytes.HasPrefix(full, []byte("PK\x03\x04")) {
			t.Fatal("expected the mimetype local header at offset 0")
		}
		mimeData := []byte("application/vnd.oasis.opendocument.text")
		binary.LittleEndian.PutUint16(full[6:], 0)
		binary.LittleEndian.PutUint32(full[14:], crc32.ChecksumIEEE(mimeData))
		binary.LittleEndian.PutUint32(full[18:], uint32(len(mimeData)))
		binary.LittleEndian.PutUint32(full[22:], uint32(len(mimeData)))
	}
	cdOffset, cdSize := locateZipCentralDirectory(t, full)
	headLen := min(sizeBytes, int64(UploadSessionMaxProbeHeadBytes))
	return full, UploadSessionProbeInput{
		HeadB64:       base64.StdEncoding.EncodeToString(full[:headLen]),
		CentralDirB64: base64.StdEncoding.EncodeToString(full[cdOffset : cdOffset+cdSize]),
		CDOffset:      cdOffset,
		CDSize:        cdSize,
	}
}

// multipartSideEffects counts the rows and reservations a refused open must
// leave untouched: no multipart row, no file row, no FileService session, no
// reserved bytes and no S3 multipart upload.
func multipartSideEffects(t *testing.T, env *docStorageEnv) (rows, fileRows, sessRows int, reserved int64) {
	t.Helper()
	ctx := context.Background()
	if err := env.f.pool.QueryRow(ctx,
		`SELECT count(*) FROM file_multipart_uploads WHERE created_by = $1`, env.tn.member.ID,
	).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if err := env.f.pool.QueryRow(ctx,
		`SELECT count(*) FROM files WHERE organization_id = $1`, env.tn.orgID,
	).Scan(&fileRows); err != nil {
		t.Fatal(err)
	}
	if err := env.f.pool.QueryRow(ctx,
		`SELECT count(*) FROM file_upload_sessions WHERE created_by = $1`, env.tn.member.ID,
	).Scan(&sessRows); err != nil {
		t.Fatal(err)
	}
	res, err := env.f.q.CountStorageBytesInOrganization(ctx, env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	return rows, fileRows, sessRows, res
}

func TestUploadSessionOpenRequiresIdempotencyKey(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	doc := env.createFile(t, member, "frame-base.pdf", pdfBody("frame-base"))
	claims := OfficeFrameClaims{
		Version:        1,
		DocumentID:     doc.Document.ID,
		WorkspaceID:    env.tn.wsA,
		OrganizationID: env.tn.orgID,
		UserID:         env.tn.member.ID,
		Module:         OfficeFrameModulePDF,
	}

	rows0, fileRows0, sessRows0, reserved0 := multipartSideEffects(t, env)
	_, probe := buildLargePDF(25<<20, "blank-key")

	wantRefusal := func(t *testing.T, err error) {
		t.Helper()
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("blank-key open error = %#v (%v), want ValidationError (400 invalid_request)", err, err)
		}
	}
	for _, key := range []string{"", "   "} {
		_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "nokey-ws.pdf", SizeBytes: 25 << 20, Probe: probe, IdempotencyKey: key})
		wantRefusal(t, err)
		_, err = env.svc.OpenVersionUploadSession(ctx, member, doc.Document.ID, OpenUploadSessionInput{Filename: "nokey-ver.pdf", SizeBytes: 25 << 20, Probe: probe, IdempotencyKey: key})
		wantRefusal(t, err)
		_, err = env.svc.OpenFrameUploadSession(ctx, claims, doc.Document.ID, OpenUploadSessionInput{Filename: "nokey-frame.pdf", SizeBytes: 25 << 20, Probe: probe, IdempotencyKey: key})
		wantRefusal(t, err)
	}

	rows, fileRows, sessRows, reserved := multipartSideEffects(t, env)
	if rows != rows0 || fileRows != fileRows0 || sessRows != sessRows0 || reserved != reserved0 {
		t.Fatalf("blank-key open left side effects: rows %d->%d files %d->%d sessions %d->%d reserved %d->%d",
			rows0, rows, fileRows0, fileRows, sessRows0, sessRows, reserved0, reserved)
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("multipartCreates = %d, want 0 for refused opens", env.store.multipartCreates)
	}
}

func TestUploadSessionOpenRejectsShortProbeHead(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	body, _ := buildLargePDF(25<<20, "short-head")
	shortHead := body[:UploadSessionMaxProbeHeadBytes-1024] // 63 KiB, one short of the required 64
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "short-head.pdf",
		SizeBytes: 25 << 20,
		Probe: UploadSessionProbeInput{
			HeadB64: base64.StdEncoding.EncodeToString(shortHead),
		}, IdempotencyKey: "short-head-1"})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	if _, ok := ce.Fields["reason"].(string); !ok || ce.Fields["reason"] == "" {
		t.Fatalf("fields.reason = %v, want a refusal reason", ce.Fields["reason"])
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("multipartCreates = %d, want 0 for a short head", env.store.multipartCreates)
	}

	// Exactly the required head length still opens.
	full, probe := buildLargePDF(25<<20, "full-head")
	_ = full
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "full-head.pdf", SizeBytes: 25 << 20, Probe: probe, IdempotencyKey: "full-head-1"})
	if err != nil {
		t.Fatalf("open with a full head: %v", err)
	}
	if opened.SessionID == "" {
		t.Fatal("open with a full head returned no session id")
	}
}

func TestUploadSessionOpenAndCompleteODT(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargeODT(t, size, false)
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "big-report.odt",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "odt-open-1"})
	if err != nil {
		t.Fatalf("open ODT session: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)
	res, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err != nil {
		t.Fatalf("complete ODT session: %v", err)
	}
	if res.Document == nil || res.Document.Document.ID == "" {
		t.Fatalf("ODT complete result missing document: %+v", res)
	}
}

func TestUploadSessionOpenRejectsMalformedODFProbe(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	// A compressed mimetype entry is malformed ODF (the spec requires it
	// stored): the probe sees it from the central directory alone.
	_, probe := buildLargeODT(t, size, true)
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "deflated.odt",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "odt-bad-1"})
	ce := wantCode(t, err, document.ErrCodeUnsupportedMedia)
	if ce.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415", ce.Status)
	}
	reason, _ := ce.Fields["reason"].(string)
	if reason == "" {
		t.Fatalf("fields.reason missing in %#v", ce.Fields)
	}
	if env.store.multipartCreates != 0 {
		t.Fatalf("multipartCreates = %d, want 0 for a malformed ODF probe", env.store.multipartCreates)
	}
}

func TestUploadSessionAbortWhileCompleteHoldsLeaseReturnsBusy(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "abort-vs-complete")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "race.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "race-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	inComplete := make(chan struct{})
	releaseComplete := make(chan struct{})
	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			close(inComplete)
			<-releaseComplete
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	completeDone := make(chan error, 1)
	go func() {
		_, cerr := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
		completeDone <- cerr
	}()
	<-inComplete

	// Complete holds the validating lease: Abort must answer busy and touch
	// neither the multipart upload nor the FileService session.
	abortErr := env.svc.AbortUploadSession(ctx, member, opened.SessionID)
	ce := wantCode(t, abortErr, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("abort status = %d, want 409", ce.Status)
	}
	if env.store.multipartAborts != 0 {
		t.Fatalf("multipartAborts = %d, want 0 while a lease is held", env.store.multipartAborts)
	}
	var sessStatus string
	if err := env.f.pool.QueryRow(ctx,
		`SELECT status FROM file_upload_sessions WHERE id = (SELECT file_upload_session_id FROM file_multipart_uploads WHERE id = $1)`,
		opened.SessionID,
	).Scan(&sessStatus); err != nil {
		t.Fatal(err)
	}
	if sessStatus != "receiving" {
		t.Fatalf("file session status = %q, want receiving (cancel untouched)", sessStatus)
	}

	close(releaseComplete)
	if cerr := <-completeDone; cerr != nil {
		t.Fatalf("complete: %v", cerr)
	}
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "completed" {
		t.Fatalf("row status = %q, want completed", row.Status)
	}
}

func TestUploadSessionCompleteRetriesAfterTransientPostAssemblyFailure(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "resume-after-assembly")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "resume.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "resume-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	// One transient failure after CompleteMultipart (Stat): the retry must
	// resume on the already-assembled object, not fail with parts_invalid.
	env.store.mu.Lock()
	env.store.statErrOnce = errTestStorageDown
	env.store.mu.Unlock()

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, "storage_unavailable")
	if ce.Status != http.StatusServiceUnavailable {
		t.Fatalf("first complete status = %d, want 503", ce.Status)
	}
	if env.store.multipartCompletes != 1 {
		t.Fatalf("multipartCompletes = %d, want 1", env.store.multipartCompletes)
	}

	res, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err != nil {
		t.Fatalf("retry complete: %v", err)
	}
	if res.Document == nil || res.Document.Document.ID == "" {
		t.Fatalf("retried complete result = %+v, want a document", res)
	}
	if env.store.multipartCompletes != 1 {
		t.Fatalf("multipartCompletes = %d after retry, want 1 (no second assembly)", env.store.multipartCompletes)
	}
}

func TestUploadSessionCompleteStaleLeaseOwnerCannotStage(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "stale-owner")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "stale.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "stale-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	// Completer A passes assembly and validation, then loses its lease to B
	// inside the streamed validation read.
	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			env.clock.Advance(UploadSessionValidationLeaseTTL + time.Minute)
			nowB := env.clock.Now().UTC().Truncate(time.Microsecond)
			if _, lerr := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
				ID:             opened.SessionID,
				LeaseOwner:     "complete:stealer",
				LeaseExpiresAt: pgtype.Timestamptz{Time: nowB.Add(UploadSessionValidationLeaseTTL), Valid: true},
				Now:            pgtype.Timestamptz{Time: nowB, Valid: true},
			}); lerr != nil {
				t.Errorf("stealer lease: %v", lerr)
			}
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	_, errA := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, errA, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("stale complete status = %d, want 409", ce.Status)
	}

	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "validating" || row.LeaseOwner.String != "complete:stealer" {
		t.Fatalf("row = status %q owner %q, want validating under complete:stealer", row.Status, row.LeaseOwner.String)
	}
	var sessStatus, fileStatus string
	if err := env.f.pool.QueryRow(ctx,
		`SELECT (SELECT status FROM file_upload_sessions WHERE id = m.file_upload_session_id),
		        (SELECT status FROM files WHERE id = m.file_id)
		 FROM file_multipart_uploads m WHERE m.id = $1`,
		opened.SessionID,
	).Scan(&sessStatus, &fileStatus); err != nil {
		t.Fatal(err)
	}
	if sessStatus != "receiving" || fileStatus == "ready" {
		t.Fatalf("stale owner staged: session %q file %q, want receiving/not-ready", sessStatus, fileStatus)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionCompleted, opened.SessionID); n != 0 {
		t.Fatalf("completed audit = %d, want 0 for a stale owner", n)
	}

	// The new owner can finish the session once its lease is handed back.
	now := env.clock.Now().UTC().Truncate(time.Microsecond)
	if _, err := env.f.q.ReleaseFileMultipartUploadLease(ctx, db.ReleaseFileMultipartUploadLeaseParams{
		ID:         opened.SessionID,
		LeaseOwner: "complete:stealer",
		Now:        pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		t.Fatalf("release stealer lease: %v", err)
	}
	if _, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts}); err != nil {
		t.Fatalf("complete under the current owner: %v", err)
	}
}

// failFileStatusUpdates makes the next UPDATE ... SET status = 'failed' on
// files fail inside the database - the stand-in for a scoped write failure
// after an earlier statement of the same transaction already ran. The
// returned drop removes it early; it is dropped again at cleanup.
func failFileStatusUpdates(t *testing.T, env *docStorageEnv) (drop func()) {
	t.Helper()
	ctx := context.Background()
	exec := func(sql string) {
		t.Helper()
		if _, err := env.f.pool.Exec(ctx, sql); err != nil {
			t.Fatalf("inject file-status failure: %v", err)
		}
	}
	exec(`CREATE OR REPLACE FUNCTION uni_test_file_status_fail() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'uni_test_file_status_fail: MarkFileFailed refused';
END $fn$ LANGUAGE plpgsql;`)
	exec(`CREATE TRIGGER uni_test_file_status_fail BEFORE UPDATE ON files
  FOR EACH ROW WHEN (NEW.status = 'failed')
  EXECUTE FUNCTION uni_test_file_status_fail();`)
	dropped := false
	drop = func() {
		if dropped {
			return
		}
		dropped = true
		exec(`DROP TRIGGER IF EXISTS uni_test_file_status_fail ON files`)
		exec(`DROP FUNCTION IF EXISTS uni_test_file_status_fail()`)
	}
	t.Cleanup(drop)
	return drop
}

// listFileJobs is every job row queued for a file.
func listFileJobs(t *testing.T, env *docStorageEnv, fileID string) []db.FileJob {
	t.Helper()
	jobs, err := env.f.q.ListFileJobsByFile(context.Background(), fileID)
	if err != nil {
		t.Fatalf("list jobs for %s: %v", fileID, err)
	}
	return jobs
}

func usedStorageBytes(t *testing.T, env *docStorageEnv) int64 {
	t.Helper()
	used, err := env.f.q.CountStorageBytesInOrganization(context.Background(), env.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	return used
}

func jobStatuses(jobs []db.FileJob, operation string) []string {
	var out []string
	for _, j := range jobs {
		if j.Operation == operation {
			out = append(out, j.Status)
		}
	}
	return out
}

func countStatus(statuses []string, want string) int {
	n := 0
	for _, s := range statuses {
		if s == want {
			n++
		}
	}
	return n
}

// A scoped SQL failure after the cancellation already changed the session
// must reach the caller and roll the whole cancellation back; the retry then
// releases the reservation exactly once (R2-4).
func TestUploadSessionFailOnSQLFailureRollsBackAndRetries(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	realOnly(t, env)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "cancel-sql-fail")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "cancel-sql.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "csf-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body[:len(body)-100]) // size mismatch at Stat

	base, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	drop := failFileStatusUpdates(t, env)

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err == nil {
		t.Fatal("expected an error when the cancellation SQL fails")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Message != "uni_test_file_status_fail: MarkFileFailed refused" {
		t.Fatalf("error = %v, want the injected SQL failure to reach the caller", err)
	}

	// CancelUploadSession already ran in that transaction: every row it
	// touched must have rolled back with it.
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "open" || row.ClosedAt.Valid {
		t.Fatalf("multipart row = status %q closed_at %v, want open/unchanged", row.Status, row.ClosedAt)
	}
	if row.LeaseOwner.Valid || row.LeaseExpiresAt.Valid {
		t.Fatalf("lease = (%v, %v), want released for the retry", row.LeaseOwner, row.LeaseExpiresAt)
	}
	var sessStatus, fileStatus string
	if err := env.f.pool.QueryRow(ctx,
		`SELECT (SELECT status FROM file_upload_sessions WHERE id = $1),
		        (SELECT status FROM files WHERE id = $2)`,
		base.FileUploadSessionID, base.FileID,
	).Scan(&sessStatus, &fileStatus); err != nil {
		t.Fatal(err)
	}
	if sessStatus != "receiving" || fileStatus != "pending" {
		t.Fatalf("rolled-back rows = session %q file %q, want receiving/pending", sessStatus, fileStatus)
	}
	jobs := listFileJobs(t, env, base.FileID)
	if got := jobStatuses(jobs, fileJobReconcile); len(got) != 1 || got[0] != "pending" {
		t.Fatalf("reconcile jobs = %v, want one pending (the cancellation's void rolled back)", got)
	}
	if got := jobStatuses(jobs, fileJobCleanup); len(got) != 0 {
		t.Fatalf("cleanup jobs = %v, want none while the cancellation is uncommitted", got)
	}
	if used := usedStorageBytes(t, env); used != size {
		t.Fatalf("reserved bytes = %d, want %d held after the rollback", used, size)
	}
	if n := env.countAudit(t, audit.ActionDocumentUploadSessionAborted, opened.SessionID); n != 0 {
		t.Fatalf("terminal audit rows = %d, want 0", n)
	}

	// Retry: the reservation releases exactly once and the row fails closed.
	drop()
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	ce := wantCode(t, err, "upload_size_mismatch")
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("retry status = %d, want 422", ce.Status)
	}
	row, err = env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" {
		t.Fatalf("row status = %q, want failed after retry", row.Status)
	}
	if used := usedStorageBytes(t, env); used != 0 {
		t.Fatalf("reserved bytes = %d, want 0 after the retried release", used)
	}
	jobs = listFileJobs(t, env, base.FileID)
	if got := jobStatuses(jobs, fileJobCleanup); len(got) != 1 || got[0] != "pending" {
		t.Fatalf("cleanup jobs = %v, want exactly one pending", got)
	}
	if got := jobStatuses(jobs, fileJobReconcile); len(got) != 1 || got[0] != "canceled" {
		t.Fatalf("reconcile jobs = %v, want the intent job canceled", got)
	}

	// A third Complete replays the stored failure and releases nothing again.
	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	wantCode(t, err, "upload_size_mismatch")
	if used := usedStorageBytes(t, env); used != 0 {
		t.Fatalf("reserved bytes = %d after the replayed failure, want 0", used)
	}
	if got := jobStatuses(listFileJobs(t, env, base.FileID), fileJobCleanup); len(got) != 1 {
		t.Fatalf("cleanup jobs = %v after the replay, want one release only", got)
	}
}

// An open that already reserved quota and then died before its multipart row
// committed has no discoverable session: the reconcile job written with the
// intent is the only path that releases the reservation once the write lease
// lapses (R2-2).
func TestUploadSessionFailedOpenLeavesRecoverableReconcileJob(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)
	realOnly(t, env)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	_, probe := buildLargePDF(size, "open-recover")

	env.store.createMultipartErr = errors.New("s3 create multipart failed")
	drop := failFileStatusUpdates(t, env)

	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "lost-open.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "recover-1"})
	ce := wantCode(t, err, "storage_unavailable")
	if ce.Status != http.StatusServiceUnavailable {
		t.Fatalf("open status = %d, want 503", ce.Status)
	}
	drop()

	// The intent survived both failures: file, session and lease with no
	// multipart row, and quota still reserved for it.
	var fileID, sessStatus, leaseOwner string
	var leaseExpires time.Time
	if err := env.f.pool.QueryRow(ctx,
		`SELECT f.id, s.status, COALESCE(s.lease_owner, ''), s.lease_expires_at
		 FROM files f JOIN file_upload_sessions s ON s.file_id = f.id
		 WHERE f.organization_id = $1`, env.tn.orgID,
	).Scan(&fileID, &sessStatus, &leaseOwner, &leaseExpires); err != nil {
		t.Fatalf("abandoned intent not found: %v", err)
	}
	if sessStatus != "receiving" || leaseOwner == "" {
		t.Fatalf("session = %q lease %q, want a receiving session under a write lease", sessStatus, leaseOwner)
	}
	if !leaseExpires.After(env.clock.Now()) {
		t.Fatalf("lease expires %s, want a live lease", leaseExpires)
	}
	jobs := listFileJobs(t, env, fileID)
	if len(jobs) != 1 || jobs[0].Operation != fileJobReconcile || jobs[0].Status != "pending" {
		t.Fatalf("jobs = %+v, want exactly one pending reconcile job", jobs)
	}
	if !jobs[0].NextAttemptAt.Time.Equal(leaseExpires.UTC()) {
		t.Fatalf("reconcile due %s, want the lease deadline %s", jobs[0].NextAttemptAt.Time, leaseExpires.UTC())
	}
	if used := usedStorageBytes(t, env); used != size {
		t.Fatalf("reserved bytes = %d, want %d", used, size)
	}

	// Nothing releases it while the lease runs: the collector waits.
	if _, err := env.real.SweepFiles(ctx); err != nil {
		t.Fatalf("sweep under a live lease: %v", err)
	}
	if used := usedStorageBytes(t, env); used != size {
		t.Fatalf("reserved bytes = %d, want %d before the lease lapses", used, size)
	}

	// Past the lease deadline the reconcile job releases the reservation.
	env.clock.Advance(UploadSessionTTL + 2*time.Hour)
	rep, err := env.real.SweepFiles(ctx)
	if err != nil {
		t.Fatalf("sweep past the lease deadline: %v", err)
	}
	released := false
	for _, e := range rep.Entries {
		if e.FileID == files.FileID(fileID) && e.Operation == fileJobReconcile {
			if e.Action != FileGCDone || e.Reason != "abandoned_intent" {
				t.Fatalf("reconcile entry = %+v, want done/abandoned_intent", e)
			}
			released = true
		}
	}
	if !released {
		t.Fatalf("no reconcile entry for the abandoned intent in %+v", rep.Entries)
	}
	if used := usedStorageBytes(t, env); used != 0 {
		t.Fatalf("reserved bytes = %d after the sweep, want the reservation released", used)
	}
	jobs = listFileJobs(t, env, fileID)
	reconcile := jobStatuses(jobs, fileJobReconcile)
	if countStatus(reconcile, "succeeded") != 1 {
		t.Fatalf("reconcile jobs = %v, want the abandoned intent finished exactly once", reconcile)
	}
	finishCount := len(jobs)

	// A second sweep releases nothing again.
	if _, err := env.real.SweepFiles(ctx); err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if used := usedStorageBytes(t, env); used != 0 {
		t.Fatalf("reserved bytes = %d after the second sweep, want 0", used)
	}
	if got := len(listFileJobs(t, env, fileID)); got > finishCount {
		t.Fatalf("job rows = %d after the second sweep, want no second release (was %d)", got, finishCount)
	}
}

// A refusal after assembly on a versioned bucket must record the assembled
// version on the file row before the cleanup job is queued: FileGC builds its
// locator from that row and refuses an unversioned delete, so a failed
// best-effort delete would otherwise keep the object forever (R2-1).
func TestUploadSessionFailureRecordsAssembledVersionForCleanup(t *testing.T) {
	env := newVersionedDocStorageEnv(t, localFileBackend())
	env.store.enableMultipart(true)
	env.svc.SetClock(env.clock.Now)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "version-cleanup")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "versioned.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "ver-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body[:len(body)-100]) // size mismatch at Stat
	mpRow, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}

	// The bucket reports a version for the assembled object, and the direct
	// delete after the refusal fails: only the queued cleanup job can remove it.
	env.gcs.setVersioned(true, "ver-assembled-1")
	env.gcs.setDelete(errTestStorageDown, false)

	_, err = env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
	wantCode(t, err, "upload_size_mismatch")

	file, err := env.f.q.GetFileByID(ctx, mpRow.FileID)
	if err != nil {
		t.Fatal(err)
	}
	if file.ObjectVersion.String != "ver-assembled-1" {
		t.Fatalf("files.object_version = %q, want the assembled version recorded before cleanup", file.ObjectVersion.String)
	}
	if got := env.gcs.deletedVersions(); len(got) != 0 {
		t.Fatalf("deleted versions = %v, want none: the best-effort delete failed", got)
	}

	// The real cleanup job now deletes exactly that version and completes.
	env.gcs.setDelete(nil, false)
	rep, err := env.real.SweepFiles(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if got := env.gcs.deletedVersions(); len(got) != 1 || got[0] != "ver-assembled-1" {
		t.Fatalf("deleted versions = %v, want exactly [ver-assembled-1]", got)
	}
	file, err = env.f.q.GetFileByID(ctx, mpRow.FileID)
	if err != nil {
		t.Fatal(err)
	}
	if file.Status != "deleted" {
		t.Fatalf("file status = %q, want deleted after the cleanup", file.Status)
	}
	done := false
	for _, e := range rep.Entries {
		if e.FileID == files.FileID(mpRow.FileID) && e.Operation == fileJobCleanup {
			if e.Action != FileGCDeleted {
				t.Fatalf("cleanup entry = %+v, want deleted", e)
			}
			done = true
		}
	}
	if !done {
		t.Fatalf("no cleanup entry for the failed upload in %+v", rep.Entries)
	}
	if got := jobStatuses(listFileJobs(t, env, mpRow.FileID), fileJobCleanup); len(got) != 1 || got[0] != "succeeded" {
		t.Fatalf("cleanup jobs = %v, want one succeeded", got)
	}
}

// An abort that starts from a stale open snapshot - the row was authorized
// before a concurrent Complete took the validating lease - must not destroy
// that completion: the conditional claim, not the earlier read, decides
// (R2-3).
func TestUploadSessionAbortStaleOpenSnapshotCannotDestroyCompletion(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargePDF(size, "stale-abort")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "stale-abort.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "stale-abort-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	// The snapshot a losing abort would carry: an authorized open row.
	stale, err := env.svc.authorizeNonFrameUploadSession(ctx, member, opened.SessionID)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if stale.Status != "open" {
		t.Fatalf("snapshot status = %q, want open", stale.Status)
	}

	inComplete := make(chan struct{})
	releaseComplete := make(chan struct{})
	var once sync.Once
	env.store.beforeComplete = func() {
		once.Do(func() {
			close(inComplete)
			<-releaseComplete
		})
	}
	defer func() { env.store.beforeComplete = nil }()

	completeDone := make(chan error, 1)
	go func() {
		_, cerr := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts})
		completeDone <- cerr
	}()
	<-inComplete

	// Complete now holds the validating lease; the stale snapshot still says
	// open, so only the conditional claim can refuse.
	abortErr := env.svc.abortUploadSession(ctx, member, stale)
	ce := wantCode(t, abortErr, "upload_session_busy")
	if ce.Status != http.StatusConflict {
		t.Fatalf("abort status = %d, want 409", ce.Status)
	}
	if env.store.multipartAborts != 0 {
		t.Fatalf("multipartAborts = %d, want 0 while Complete holds the lease", env.store.multipartAborts)
	}
	var sessStatus string
	if err := env.f.pool.QueryRow(ctx,
		`SELECT status FROM file_upload_sessions WHERE id = (SELECT file_upload_session_id FROM file_multipart_uploads WHERE id = $1)`,
		opened.SessionID,
	).Scan(&sessStatus); err != nil {
		t.Fatal(err)
	}
	if sessStatus != "receiving" {
		t.Fatalf("file session status = %q, want receiving (cancellation untouched)", sessStatus)
	}

	// The winner finishes: the stale abort changed nothing.
	close(releaseComplete)
	if cerr := <-completeDone; cerr != nil {
		t.Fatalf("complete: %v", cerr)
	}
	row, err := env.f.q.GetFileMultipartUploadByID(ctx, opened.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "completed" {
		t.Fatalf("row status = %q, want completed", row.Status)
	}
}

func TestUploadSessionGetReportsValidatingAndCompleted(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargePDF(size, "get-states")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{Filename: "states.pdf",
		SizeBytes: size,
		Probe:     probe, IdempotencyKey: "states-1"})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	parts := uploadAllParts(t, env, opened.SessionID, body)

	// While a validation lease is held, GET reports validating and no parts.
	now := env.clock.Now().UTC().Truncate(time.Microsecond)
	if _, err := env.f.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID:             opened.SessionID,
		LeaseOwner:     "complete:held",
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		t.Fatalf("lease: %v", err)
	}
	got, err := env.svc.GetUploadSession(ctx, member, opened.SessionID)
	if err != nil {
		t.Fatalf("GET under lease: %v", err)
	}
	if got.Status != "validating" {
		t.Fatalf("status = %q, want validating", got.Status)
	}
	if len(got.Parts) != 0 || len(got.CompletedParts) != 0 {
		t.Fatalf("validating GET returned parts %+v / completed %+v, want none", got.Parts, got.CompletedParts)
	}

	// Drop the lease and complete for real; afterwards GET reports completed
	// with no parts to resume.
	if _, err := env.f.q.ReleaseFileMultipartUploadLease(ctx, db.ReleaseFileMultipartUploadLeaseParams{
		ID:         opened.SessionID,
		LeaseOwner: "complete:held",
		Now:        pgtype.Timestamptz{Time: env.clock.Now().UTC().Truncate(time.Microsecond), Valid: true},
	}); err != nil {
		t.Fatalf("release: %v", err)
	}
	if _, err := env.svc.CompleteUploadSession(ctx, member, opened.SessionID, CompleteUploadSessionInput{Parts: parts}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	got, err = env.svc.GetUploadSession(ctx, member, opened.SessionID)
	if err != nil {
		t.Fatalf("GET after completion: %v", err)
	}
	if got.Status != "completed" {
		t.Fatalf("status = %q, want completed", got.Status)
	}
	if len(got.Parts) != 0 || len(got.CompletedParts) != 0 {
		t.Fatalf("completed GET returned parts %+v / completed %+v, want none", got.Parts, got.CompletedParts)
	}
}

func TestOfficeFrameUploadSessionWrappers(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	frame := NewOfficeFrameService(env.svc, "office-frame-test-secret-0123456789abcdef")
	if frame == nil {
		t.Fatal("NewOfficeFrameService returned nil")
	}

	docA := env.createFile(t, member, "frame-a.pdf", pdfBody("frame-a"))
	docB := env.createFile(t, member, "frame-b.pdf", pdfBody("frame-b"))
	claimsA := OfficeFrameClaims{
		Version:        1,
		DocumentID:     docA.Document.ID,
		WorkspaceID:    env.tn.wsA,
		OrganizationID: env.tn.orgID,
		UserID:         env.tn.member.ID,
		Module:         OfficeFrameModulePDF,
	}
	claimsB := claimsA
	claimsB.DocumentID = docB.Document.ID

	const size = 25 << 20
	body, probe := buildLargePDF(size, "frame-wrappers")
	openSeq := 0
	open := func() UploadSessionView {
		openSeq++
		v, err := frame.OpenUploadSession(ctx, claimsA, docA.Document.ID, OpenUploadSessionInput{Filename: "wrap.pdf",
			SizeBytes: size,
			Probe:     probe, IdempotencyKey: fmt.Sprintf("wrap-open-%d", openSeq)})
		if err != nil {
			t.Fatalf("frame open: %v", err)
		}
		return v
	}

	// Valid claims: each wrapper delegates and returns the inner result.
	sessGet := open()
	got, err := frame.GetUploadSession(ctx, claimsA, docA.Document.ID, sessGet.SessionID)
	if err != nil || got.SessionID != sessGet.SessionID {
		t.Fatalf("wrapper Get = %+v, %v", got, err)
	}
	sessComplete := open()
	parts := uploadAllParts(t, env, sessComplete.SessionID, body)
	res, err := frame.CompleteUploadSession(ctx, claimsA, docA.Document.ID, sessComplete.SessionID, CompleteUploadSessionInput{Parts: parts})
	if err != nil || res.Upload == nil {
		t.Fatalf("wrapper Complete = %+v, %v", res, err)
	}
	sessAbort := open()
	if err := frame.AbortUploadSession(ctx, claimsA, docA.Document.ID, sessAbort.SessionID); err != nil {
		t.Fatalf("wrapper Abort: %v", err)
	}

	// Mismatched document: the token names docA but the call targets docB, or
	// the token names docB but the session belongs to docA.
	for _, tc := range []struct {
		name string
		call func() error
	}{
		{"open", func() error {
			_, err := frame.OpenUploadSession(ctx, claimsA, docB.Document.ID, OpenUploadSessionInput{Filename: "x.pdf", SizeBytes: size, Probe: probe, IdempotencyKey: "wrap-x"})
			return err
		}},
		{"get", func() error {
			_, err := frame.GetUploadSession(ctx, claimsB, docB.Document.ID, sessGet.SessionID)
			return err
		}},
		{"complete", func() error {
			_, err := frame.CompleteUploadSession(ctx, claimsB, docB.Document.ID, sessGet.SessionID, CompleteUploadSessionInput{})
			return err
		}},
		{"abort", func() error {
			return frame.AbortUploadSession(ctx, claimsB, docB.Document.ID, sessGet.SessionID)
		}},
	} {
		if err := tc.call(); !errors.Is(err, ErrNotFound) {
			t.Fatalf("wrapper %s with mismatched document = %v, want ErrNotFound", tc.name, err)
		}
	}

	// Wrong module: same user, document and tenant as the token, but the
	// token was minted for another format. Only the wrapper's AuthorizeSave
	// binds the module - the delegate rechecks user, document and tenant -
	// so an old-format frame token kept driving a save (R2-6).
	sessWrongModule := open()
	wrongModule := claimsA
	wrongModule.Module = OfficeFrameModuleSlides
	for _, tc := range []struct {
		name string
		call func() error
	}{
		{"open", func() error {
			_, err := frame.OpenUploadSession(ctx, wrongModule, docA.Document.ID, OpenUploadSessionInput{Filename: "z.pdf", SizeBytes: size, Probe: probe, IdempotencyKey: "wrap-z"})
			return err
		}},
		{"get", func() error {
			_, err := frame.GetUploadSession(ctx, wrongModule, docA.Document.ID, sessWrongModule.SessionID)
			return err
		}},
		{"complete", func() error {
			_, err := frame.CompleteUploadSession(ctx, wrongModule, docA.Document.ID, sessWrongModule.SessionID, CompleteUploadSessionInput{})
			return err
		}},
		{"abort", func() error {
			return frame.AbortUploadSession(ctx, wrongModule, docA.Document.ID, sessWrongModule.SessionID)
		}},
	} {
		if err := tc.call(); !errors.Is(err, ErrNotFound) {
			t.Fatalf("wrapper %s with the wrong module = %v, want ErrNotFound", tc.name, err)
		}
	}

	// Revoked access: membership gone, so AuthorizeSave refuses before the
	// delegate runs.
	sessRevoked := open()
	if _, err := env.f.pool.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, env.tn.wsA, env.tn.member.ID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		call func() error
	}{
		{"open", func() error {
			_, err := frame.OpenUploadSession(ctx, claimsA, docA.Document.ID, OpenUploadSessionInput{Filename: "y.pdf", SizeBytes: size, Probe: probe, IdempotencyKey: "wrap-y"})
			return err
		}},
		{"get", func() error {
			_, err := frame.GetUploadSession(ctx, claimsA, docA.Document.ID, sessRevoked.SessionID)
			return err
		}},
		{"complete", func() error {
			_, err := frame.CompleteUploadSession(ctx, claimsA, docA.Document.ID, sessRevoked.SessionID, CompleteUploadSessionInput{})
			return err
		}},
		{"abort", func() error {
			return frame.AbortUploadSession(ctx, claimsA, docA.Document.ID, sessRevoked.SessionID)
		}},
	} {
		if err := tc.call(); err == nil {
			t.Fatalf("wrapper %s after revoked access succeeded, want a refusal", tc.name)
		}
	}
}

// versionLockEnv is the multipart scene plus a file document: the shape the
// lock-check cases need, a version target both `member` and `aclOwner` may
// write (workspace level edit), on a store that can open a session.
type versionLockEnv struct {
	*lockWorld
	env *docStorageEnv
	doc db.Document
}

func newVersionLockEnv(t *testing.T) *versionLockEnv {
	t.Helper()
	env := newMultipartDocEnv(t)
	w := &lockWorld{ctx: context.Background(), env: env, svc: env.svc, tn: env.tn}
	doc := env.createFile(t, human(env.tn.aclOwner), "report.pdf", pdfBody("v1")).Document
	return &versionLockEnv{lockWorld: w, env: env, doc: doc}
}

// insertAgentTenure plants a live tenure whose holder is an agent: no command
// creates one (agents never hold a lock), but the create-time check must
// refuse a human caller while one is live.
func (v *versionLockEnv) insertAgentTenure(t *testing.T) string {
	t.Helper()
	id := util.NewID()
	v.exec(t, `INSERT INTO document_edit_locks (
			id, organization_id, document_id, user_id, base_revision,
			acquired_at, heartbeat_at, expires_at, granted_via)
		VALUES ($1, $2, $3, $4, $5, now(), now(), now() + interval '2 minutes', 'acquire')`,
		id, v.doc.OrganizationID, v.doc.ID, v.tn.agent, v.doc.Revision)
	return id
}

// lockSideEffects is the count of rows and storage calls a create would leave
// behind: the multipart rows and FileService file/session rows of the tenant,
// plus the CreateMultipart calls at the storage.
func (v *versionLockEnv) lockSideEffects(t *testing.T) lockSideEffectCounts {
	t.Helper()
	rows, fileRows, sessRows, _ := multipartSideEffects(t, v.env)
	return lockSideEffectCounts{rows: rows, files: fileRows, sessions: sessRows, multipart: v.env.store.multipartCreates}
}

// lockSideEffectCounts is comparable, so a test asserts a refused create left
// every one of them unchanged in a single check.
type lockSideEffectCounts struct {
	rows, files, sessions, multipart int
}

func (v *versionLockEnv) versionInput(t *testing.T) OpenUploadSessionInput {
	t.Helper()
	_, probe := buildLargePDF(25<<20, "lock-version")
	return OpenUploadSessionInput{IdempotencyKey: nextIDK(), Filename: "report.pdf", SizeBytes: 25 << 20, Probe: probe}
}

func (v *versionLockEnv) frameClaims() OfficeFrameClaims {
	return OfficeFrameClaims{
		Version: 1, DocumentID: v.doc.ID, WorkspaceID: v.doc.WorkspaceID,
		OrganizationID: v.doc.OrganizationID, UserID: v.tn.member.ID, Module: OfficeFrameModulePDF,
	}
}

// wantVersionLocked checks the create-time 423 body against the gate's shape:
// the holder, never the lock id.
func (v *versionLockEnv) wantVersionLocked(t *testing.T, what string, err error, heldByMe bool) {
	t.Helper()
	v.wantVersionLockedBy(t, what, err, heldByMe, v.tn.aclOwner.ID)
}

// wantVersionLockedBy is wantVersionLocked with an explicit holder, for the
// agent tenure whose holder is not the person the test calls with.
func (v *versionLockEnv) wantVersionLockedBy(t *testing.T, what string, err error, heldByMe bool, holderID string) {
	t.Helper()
	ce := wantCode(t, err, "document_locked")
	if ce.Status != http.StatusLocked || !errors.Is(err, ErrDocumentLocked) || errors.Is(err, ErrConflict) {
		t.Fatalf("%s: status %d, locked %v, conflict %v", what, ce.Status, errors.Is(err, ErrDocumentLocked), errors.Is(err, ErrConflict))
	}
	if ce.Fields["holder_id"] != holderID || ce.Fields["held_by_me"] != heldByMe {
		t.Fatalf("%s: fields %v", what, ce.Fields)
	}
	for _, k := range []string{"holder_id", "holder_name", "since", "expires_at", "held_by_me", "current_revision"} {
		if _, ok := ce.Fields[k]; !ok {
			t.Fatalf("%s: 423 lacks %s: %v", what, k, ce.Fields)
		}
	}
	if ce.Fields["current_revision"] != strconv.FormatInt(v.doc.Revision, 10) {
		t.Fatalf("%s: current_revision %v, want %d", what, ce.Fields["current_revision"], v.doc.Revision)
	}
	for _, k := range []string{"lock_id", "offline_hold_until"} {
		if _, ok := ce.Fields[k]; ok {
			t.Fatalf("%s: 423 carries %s: %v", what, k, ce.Fields)
		}
	}
}

// TestVersionUploadSessionOpenRefusedWhileLocked is BIGUP-LOCKCHECK S-1/S-2 at
// the service layer: a version create is refused 423 document_locked while
// another holder (another person, or an agent) holds the live lock, the
// caller's own lock and a dead or absent lock pass, and an idempotent replay
// is refused too.
func TestVersionUploadSessionOpenRefusedWhileLocked(t *testing.T) {
	v := newVersionLockEnv(t)
	ctx := v.ctx
	member, holder := human(v.tn.member), human(v.tn.aclOwner)

	// No lock: the version create passes.
	if _, err := v.svc.OpenVersionUploadSession(ctx, member, v.doc.ID, v.versionInput(t)); err != nil {
		t.Fatalf("open with no lock: %v", err)
	}

	// Another person holds: 423, and nothing was created for this call.
	held := v.acquire(t, v.tn.aclOwner, v.doc.ID, "editor-holder")
	before := v.lockSideEffects(t)
	_, err := v.svc.OpenVersionUploadSession(ctx, member, v.doc.ID, v.versionInput(t))
	v.wantVersionLocked(t, "another person holds", err, false)
	// The frame route is the same rule.
	_, err = v.svc.OpenFrameUploadSession(ctx, v.frameClaims(), v.doc.ID, v.versionInput(t))
	v.wantVersionLocked(t, "another person holds (frame)", err, false)
	after := v.lockSideEffects(t)
	if before != after {
		t.Fatalf("a refused create left side effects: %v -> %v", before, after)
	}

	// The holder itself passes (the create carries no lock id).
	if _, err := v.svc.OpenVersionUploadSession(ctx, holder, v.doc.ID, v.versionInput(t)); err != nil {
		t.Fatalf("holder open: %v", err)
	}

	// A replay of a create made before the lock was taken is refused too: the
	// idempotency pre-check runs after the lock check.
	replay := v.versionInput(t)
	if _, err := v.svc.OpenVersionUploadSession(ctx, holder, v.doc.ID, replay); err != nil {
		t.Fatalf("pre-lock create: %v", err)
	}
	if _, err := v.svc.OpenVersionUploadSession(ctx, holder, v.doc.ID, replay); err != nil {
		t.Fatalf("pre-lock replay: %v", err)
	}
	_, err = v.svc.OpenVersionUploadSession(ctx, member, v.doc.ID, replay)
	v.wantVersionLocked(t, "replay under a lock", err, false)

	// An expired tenure (past TTL, not swept) passes.
	if err := v.svc.ReleaseDocumentEditLock(ctx, holder, v.doc.ID, held.Lock.ID); err != nil {
		t.Fatal(err)
	}
	dead := v.acquire(t, v.tn.aclOwner, v.doc.ID, "editor-dead")
	v.expire(t, dead.Lock.ID)
	if _, err := v.svc.OpenVersionUploadSession(ctx, member, v.doc.ID, v.versionInput(t)); err != nil {
		t.Fatalf("open under an expired lock: %v", err)
	}

	// An agent tenure refuses a human caller.
	if err := v.svc.ReleaseDocumentEditLock(ctx, holder, v.doc.ID, dead.Lock.ID); err != nil {
		t.Fatal(err)
	}
	v.insertAgentTenure(t)
	_, err = v.svc.OpenVersionUploadSession(ctx, member, v.doc.ID, v.versionInput(t))
	v.wantVersionLockedBy(t, "an agent holds", err, false, v.tn.agent)
}
