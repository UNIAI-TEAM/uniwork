package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
)

func newMultipartDocEnv(t *testing.T) *docStorageEnv {
	t.Helper()
	env := newRealDocStorageEnv(t, localFileBackend())
	env.store.enableMultipart(true)
	env.svc.SetClock(env.clock.Now)
	return env
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "exact-20mb.pdf",
		SizeBytes: UploadSessionThresholdBytes, // 20 MiB exactly -> must reject
		Probe:     probe,
	})
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "huge.pdf",
		SizeBytes: maxBytes + 1,
		Probe:     probe,
	})
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

	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "installer.exe",
		SizeBytes: 25 << 20,
		Probe: UploadSessionProbeInput{
			HeadB64: base64.StdEncoding.EncodeToString([]byte("MZ\x90\x00")),
		},
	})
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "disguised.pdf",
		SizeBytes: 25 << 20,
		Probe: UploadSessionProbeInput{
			HeadB64: base64.StdEncoding.EncodeToString(pngBytes),
		},
	})
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "macro.docx",
		SizeBytes: size,
		Probe:     probe,
	})
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

	_, err = env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "bomb.docx",
		SizeBytes: size,
		Probe:     probe,
	})
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "fifty-mb.pdf",
		SizeBytes: 50 << 20,
		Probe:     probe,
	})
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
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "fail-mp.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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
	member := human(env.tn.member)

	_, probe := buildLargePDF(25<<20, "concurrency-cap")
	var sessions []UploadSessionView
	for i := 0; i < 4; i++ {
		v, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
			Filename:  "ok.pdf",
			SizeBytes: 25 << 20,
			Probe:     probe,
		})
		if err != nil {
			t.Fatalf("open session %d: %v", i+1, err)
		}
		sessions = append(sessions, v)
	}

	// 5th open session must fail with 429 upload_sessions_exhausted + retry_after = 60.
	_, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "fifth.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
	ce := wantCode(t, err, "upload_sessions_exhausted")
	if ce.Status != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", ce.Status)
	}
	if ce.Fields["retry_after"] != 60 {
		t.Fatalf("fields.retry_after = %v, want 60", ce.Fields["retry_after"])
	}

	// Aborting one frees a slot so the next open succeeds.
	if err := env.svc.AbortUploadSession(ctx, member, sessions[0].SessionID); err != nil {
		t.Fatalf("abort session 0: %v", err)
	}
	if _, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "fifth-retry.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	}); err != nil {
		t.Fatalf("open after abort: %v", err)
	}
}

func TestUploadSessionOpenIdempotentReplay(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "idem-replay")
	in := OpenUploadSessionInput{
		Filename:       "replay.pdf",
		SizeBytes:      25 << 20,
		Title:          "Replay Doc",
		Probe:          probe,
		IdempotencyKey: "idem-open-1",
	}
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
	in := OpenUploadSessionInput{
		Filename:       "first.pdf",
		SizeBytes:      25 << 20,
		Probe:          probe,
		IdempotencyKey: "idem-mismatch-1",
	}
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "resume.pdf",
		SizeBytes: size,
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "private-sess.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "revoked.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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
	if _, err := env.svc.OpenFrameUploadSession(ctx, claimsA, docB.Document.ID, OpenUploadSessionInput{
		Filename:  "v2.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("OpenFrameUploadSession with mismatched doc = %v, want ErrNotFound", err)
	}

	openedA, err := env.svc.OpenFrameUploadSession(ctx, claimsA, docA.Document.ID, OpenUploadSessionInput{
		Filename:  "v2.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "quarterly-report.docx",
		SizeBytes: size,
		Title:     "Quarterly Report",
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "parts.pdf",
		SizeBytes: size,
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "truncated.pdf",
		SizeBytes: size,
		Probe:     probe,
	})
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
}

func TestUploadSessionCompleteRejectsChangedZipTail(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	const size = 25 << 20
	body, probe := buildLargeDOCX(t, size, nil)
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "tampered.docx",
		SizeBytes: size,
		Probe:     probe,
	})
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

	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "corrupt-tail.pdf",
		SizeBytes: size,
		Probe:     probe,
	})
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
}

func TestUploadSessionCompleteConcurrentCallReturns409Busy(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	const size = 25 << 20
	body, probe := buildLargePDF(size, "concurrent-complete")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "concurrent.pdf",
		SizeBytes: size,
		Title:     "Concurrent Doc",
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "abort.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "done.pdf",
		SizeBytes: size,
		Probe:     probe,
	})
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

func TestExpireMultipartUploadsReclaimsQuotaAndAudits(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	seedStoragePlan(t, env, 100<<20)
	_, probe := buildLargePDF(25<<20, "gc-expire")
	opened, err := env.svc.OpenWorkspaceUploadSession(ctx, member, env.tn.wsA, OpenUploadSessionInput{
		Filename:  "expire-me.pdf",
		SizeBytes: 25 << 20,
		Probe:     probe,
	})
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

func TestUploadSessionCompleteVersionAndFrameHappyPath(t *testing.T) {
	env := newMultipartDocEnv(t)
	ctx := context.Background()
	member := human(env.tn.member)

	doc := env.createFile(t, member, "report.pdf", pdfBody("v1"))
	const size = 25 << 20
	bodyV2, probeV2 := buildLargePDF(size, "version-v2")

	// Version open -> complete -> CommitFileVersion.
	verSess, err := env.svc.OpenVersionUploadSession(ctx, member, doc.Document.ID, OpenUploadSessionInput{
		Filename:  "report.pdf",
		SizeBytes: size,
		Probe:     probeV2,
	})
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
	frameSess, err := env.svc.OpenFrameUploadSession(ctx, claims, doc.Document.ID, OpenUploadSessionInput{
		Filename:  "report.pdf",
		SizeBytes: size,
		Probe:     probeV3,
	})
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

func seedStoragePlan(t *testing.T, env *docStorageEnv, limitBytes int64) {
	t.Helper()
	env.setStorageLimit(t, limitBytes)
}
