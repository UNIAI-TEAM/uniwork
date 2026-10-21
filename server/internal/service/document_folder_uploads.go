package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Folder upload (UNI-2052). One PLAN validates the whole folder, creates the
// folder tree under a fresh root folder, and writes one batch row whose file
// rows each carry an upload target; COMPLETE (w2) turns uploaded files into
// documents. The plan is refused as a whole, writing nothing, when any limit
// or path is wrong. Rows, folders, audit and the one document.batch_uploaded
// event commit in one transaction; the upload targets are minted after it,
// so a storage call never runs under the tree lock.

// DocumentBatchUploadedTopic is the aggregate event a PLAN and every COMPLETE
// that created a document write instead of one document.created each.
const DocumentBatchUploadedTopic = "document.batch_uploaded"

const (
	// folderUploadMaxFolders caps the folders one plan may create, the root
	// folder included.
	folderUploadMaxFolders = 500
	// folderUploadCompleteBatch is how many files one COMPLETE may carry.
	folderUploadCompleteBatch = 50
	// folderUploadParallel is the number of files a client should upload at
	// once; published in GET /config, not enforced.
	folderUploadParallel = 6
	// folderUploadTTL is how long a batch stays open for uploads.
	folderUploadTTL = 24 * time.Hour
	// folderUploadMaxOpen is how many open batches one creator may hold; the
	// next plan answers 429 folder_uploads_busy.
	folderUploadMaxOpen      = 2
	folderUploadBusyRetry    = 30
	folderUploadMaxSegment   = 255
	folderUploadMaxFilename  = 255
	folderUploadTargetPut    = "put"
	folderUploadTargetMulti  = "multipart"
	folderUploadStatusOpen   = "open"
	folderUploadFilePending  = "pending"
	folderUploadOpenedVia    = "folder"
	folderUploadResourceType = "folder_upload_batch"

	idempotencyScopeFolderUploadPlan = "documents.folder_uploads.plan"
)

var folderUploadFileKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// FolderUploadLimits is the folder upload block of GET /api/v1/config and
// what a PLAN enforces.
type FolderUploadLimits struct {
	MaxFiles      int
	MaxFolders    int
	MaxTotalBytes int64
	MaxDepth      int
	CompleteBatch int
	Parallel      int
}

// folderUploadConfig is the FOLDER_UPLOAD_* part of the limits; zero fields
// read as the defaults.
type folderUploadConfig struct {
	maxFiles int
	maxBytes int64
}

// SetFolderUploadLimits wires FOLDER_UPLOAD_MAX_FILES and
// FOLDER_UPLOAD_MAX_BYTES; a value <= 0 keeps the default.
func (s *DocumentService) SetFolderUploadLimits(maxFiles int, maxBytes int64) {
	s.folderUpload = folderUploadConfig{maxFiles: maxFiles, maxBytes: maxBytes}
}

// FolderUploadLimits answers the limits a PLAN enforces.
func (s *DocumentService) FolderUploadLimits() FolderUploadLimits {
	out := FolderUploadLimits{
		MaxFiles: 500, MaxFolders: folderUploadMaxFolders, MaxTotalBytes: 2 << 30,
		MaxDepth: maxDocumentDepth, CompleteBatch: folderUploadCompleteBatch, Parallel: folderUploadParallel,
	}
	if s != nil && s.folderUpload.maxFiles > 0 {
		out.MaxFiles = s.folderUpload.maxFiles
	}
	if s != nil && s.folderUpload.maxBytes > 0 {
		out.MaxTotalBytes = s.folderUpload.maxBytes
	}
	return out
}

// DocumentUploadExtensions lists the extensions a document upload accepts
// (lowercase, no dot), as GET /api/v1/config publishes them.
func DocumentUploadExtensions() []string { return document.UploadExtensions() }

// FolderUploadFileInput is one file of a PLAN. Probe is required only for a
// file the multipart flow will carry (over UploadSessionThresholdBytes on a
// store that can run it).
type FolderUploadFileInput struct {
	FileKey   string
	Path      string
	Filename  string
	SizeBytes int64
	Probe     *UploadSessionProbeInput
}

// CreateFolderUploadInput is the PLAN body plus its Idempotency-Key.
type CreateFolderUploadInput struct {
	ParentID           *string
	RootName           string
	ShareWithWorkspace bool
	Folders            []string
	Files              []FolderUploadFileInput
	IdempotencyKey     string
}

// FolderUploadTarget is where a pending file's bytes go: a single PUT (a
// presigned storage URL, or the server content route when the store cannot
// presign), or a multipart session with one URL per missing part.
type FolderUploadTarget struct {
	Kind    string
	Method  string
	URL     string
	Headers map[string]string
	// Auth is "session" on the server content route: the client sends it
	// through its session transport. A signed URL has no Auth and takes no
	// credential.
	Auth      string
	SessionID string
	PartSize  int64
	Parts     []UploadSessionPartURL
	ExpiresAt time.Time
}

// FolderUploadFolder is one folder the plan created; Path "" is the root.
type FolderUploadFolder struct {
	Path string
	ID   string
}

// FolderUploadFile is one file of a batch. Target is set only while the file
// is pending.
type FolderUploadFile struct {
	FileKey    string
	Path       string
	Filename   string
	SizeBytes  int64
	Status     string
	DocumentID string
	ErrorCode  string
	Target     *FolderUploadTarget
}

// FolderUploadCounts sums a batch's files by status.
type FolderUploadCounts struct {
	Total   int
	Done    int
	Failed  int
	Pending int
}

// FolderUploadBatch is the creator's view of one batch.
type FolderUploadBatch struct {
	ID                 string
	Status             string
	ParentID           string
	RootFolderID       string
	RootTitle          string
	ShareWithWorkspace bool
	Folders            []FolderUploadFolder
	Files              []FolderUploadFile
	Counts             FolderUploadCounts
	TotalBytes         int64
	ExpiresAt          time.Time
	CreatedAt          time.Time
}

func errFolderUploadTooManyFiles(max, count int) error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "folder_upload_too_many_files",
		Msg:    "thư mục có quá nhiều tệp: hãy tải lên từng phần nhỏ hơn",
		Fields: map[string]any{"max": max, "count": count},
	}
}

func errFolderUploadTooManyFolders(max, count int) error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "folder_upload_too_many_folders",
		Msg:    "thư mục có quá nhiều thư mục con: hãy tải lên từng phần nhỏ hơn",
		Fields: map[string]any{"max": max, "count": count},
	}
}

func errFolderUploadTooLarge(max, total int64) error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "folder_upload_too_large",
		Msg:    "tổng dung lượng thư mục vượt giới hạn: hãy tải lên từng phần nhỏ hơn",
		Fields: map[string]any{"max_bytes": max, "total_bytes": total},
	}
}

func errFolderUploadFileTooLarge(path, filename string, max int64) error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "folder_upload_file_too_large",
		Msg:    "một tệp trong thư mục vượt dung lượng cho phép",
		Fields: map[string]any{"path": path, "filename": filename, "max_bytes": max},
	}
}

func errFolderUploadUnsupportedType(path, filename string) error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "folder_upload_unsupported_type",
		Msg:    "thư mục có tệp định dạng không được hỗ trợ",
		Fields: map[string]any{"path": path, "filename": filename},
	}
}

func errFolderUploadTooDeep() error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "document_too_deep",
		Msg:    "cây tài liệu sâu tối đa " + strconv.Itoa(maxDocumentDepth) + " cấp",
		Fields: map[string]any{"max_depth": maxDocumentDepth},
	}
}

func errFolderUploadsBusy() error {
	return CodedError{
		Status: http.StatusTooManyRequests, Code: "folder_uploads_busy",
		Msg:    "bạn đang có hai lượt tải thư mục chưa xong: hãy đợi một lượt xong rồi thử lại",
		Fields: map[string]any{"retry_after": folderUploadBusyRetry},
	}
}

// errFolderUploadPath is the 400 of a path or a file the plan cannot place;
// field names the offending key (path or file_key) and value is what the
// caller sent, never anything read from the database.
func errFolderUploadPath(field, value, msg string) error {
	return CodedError{
		Status: http.StatusBadRequest, Code: "invalid_request", Msg: msg,
		Fields: map[string]any{field: value},
	}
}

// folderPlanFile is one validated file of a plan.
type folderPlanFile struct {
	in        FolderUploadFileInput
	path      string
	filename  string
	mime      string
	multipart bool
	headSHA   string
	tailSHA   string
	cdOffset  int64
	cdSize    int64
}

// folderPlan is a validated PLAN: folders ordered parents first ("" is not
// listed), each with its title; files in the order sent.
type folderPlan struct {
	rootTitle  string
	folders    []string
	titles     map[string]string
	files      []folderPlanFile
	totalBytes int64
	// depth is the deepest level below the root folder: a folder at "a/b" is
	// 2, a file inside it 3, the root folder itself 0.
	depth int
}

// splitFolderPath checks one relative path ("" is the root) and answers its
// NFC segments.
func splitFolderPath(raw string) ([]string, error) {
	if raw == "" {
		return nil, nil
	}
	p := norm.NFC.String(raw)
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, "\\") || strings.HasSuffix(p, "/") {
		return nil, errFolderUploadPath("path", raw, "đường dẫn phải tương đối, dùng '/' phân tách")
	}
	segs := strings.Split(p, "/")
	for _, seg := range segs {
		if strings.TrimSpace(seg) == "" || seg == "." || seg == ".." {
			return nil, errFolderUploadPath("path", raw, "đường dẫn có đoạn rỗng hoặc '..'")
		}
		if len([]rune(seg)) > folderUploadMaxSegment {
			return nil, errFolderUploadPath("path", raw, "mỗi đoạn của đường dẫn tối đa 255 ký tự")
		}
		if strings.IndexFunc(seg, unicode.IsControl) >= 0 || strings.Contains(seg, "\\") {
			return nil, errFolderUploadPath("path", raw, "đường dẫn có ký tự không hợp lệ")
		}
	}
	return segs, nil
}

// validateFolderPlan checks everything a PLAN can check without the database:
// counts first, then every path and file, then the sizes. The first problem
// refuses the whole plan.
func (s *DocumentService) validateFolderPlan(in CreateFolderUploadInput, limits FolderUploadLimits) (folderPlan, error) {
	if len(in.Files) > limits.MaxFiles {
		return folderPlan{}, errFolderUploadTooManyFiles(limits.MaxFiles, len(in.Files))
	}
	// The root folder counts: a plan creates 1 + len(folders) folders.
	if created := 1 + len(in.Folders); created > limits.MaxFolders {
		return folderPlan{}, errFolderUploadTooManyFolders(limits.MaxFolders, created)
	}
	rootTitle, err := normalizeDocumentTitle(DocumentKindFolder, in.RootName)
	if err != nil {
		return folderPlan{}, err
	}
	plan := folderPlan{rootTitle: rootTitle, titles: map[string]string{}}
	known := map[string]bool{"": true}
	segsOf := map[string][]string{}
	for _, raw := range in.Folders {
		segs, err := splitFolderPath(raw)
		if err != nil {
			return folderPlan{}, err
		}
		if len(segs) == 0 {
			return folderPlan{}, errFolderUploadPath("path", raw, "đường dẫn thư mục không được rỗng")
		}
		p := strings.Join(segs, "/")
		if _, dup := segsOf[p]; dup {
			return folderPlan{}, errFolderUploadPath("path", raw, "thư mục bị khai báo hai lần")
		}
		segsOf[p] = segs
		title, err := normalizeDocumentTitle(DocumentKindFolder, segs[len(segs)-1])
		if err != nil {
			return folderPlan{}, errFolderUploadPath("path", raw, "tên thư mục không hợp lệ")
		}
		plan.titles[p] = title
		plan.folders = append(plan.folders, p)
		plan.depth = max(plan.depth, len(segs))
	}
	// Parents first: a stable sort by depth keeps the caller's order among
	// siblings, so positions follow the order the folders were sent in.
	sort.SliceStable(plan.folders, func(i, j int) bool {
		return len(segsOf[plan.folders[i]]) < len(segsOf[plan.folders[j]])
	})
	for _, p := range plan.folders {
		segs := segsOf[p]
		if parent := strings.Join(segs[:len(segs)-1], "/"); !known[parent] {
			return folderPlan{}, errFolderUploadPath("path", p, "thư mục cha phải có trong folders")
		}
		known[p] = true
	}

	maxBytes := s.documentFileMaxBytes()
	chunked := s.SupportsChunkedUpload()
	keys := make(map[string]bool, len(in.Files))
	names := make(map[string]bool, len(in.Files))
	for _, f := range in.Files {
		if !folderUploadFileKeyPattern.MatchString(f.FileKey) {
			return folderPlan{}, errFolderUploadPath("file_key", f.FileKey, "file_key gồm 1-64 ký tự A-Z, a-z, 0-9, '_' hoặc '-'")
		}
		if keys[f.FileKey] {
			return folderPlan{}, errFolderUploadPath("file_key", f.FileKey, "file_key bị trùng trong kế hoạch")
		}
		keys[f.FileKey] = true
		segs, err := splitFolderPath(f.Path)
		if err != nil {
			return folderPlan{}, err
		}
		p := strings.Join(segs, "/")
		if !known[p] {
			return folderPlan{}, errFolderUploadPath("path", f.Path, "thư mục của tệp phải có trong folders")
		}
		name := norm.NFC.String(strings.TrimSpace(f.Filename))
		if name == "" || strings.ContainsAny(name, "/\\") || strings.IndexFunc(name, unicode.IsControl) >= 0 ||
			len([]rune(name)) > folderUploadMaxFilename {
			return folderPlan{}, errFolderUploadPath("path", f.Path, "tên tệp không hợp lệ")
		}
		if names[p+"/"+name] {
			return folderPlan{}, errFolderUploadPath("path", f.Path, "hai tệp cùng tên trong một thư mục")
		}
		names[p+"/"+name] = true
		if f.SizeBytes < 0 {
			return folderPlan{}, errFolderUploadPath("path", f.Path, "size_bytes không hợp lệ")
		}
		pf := folderPlanFile{in: f, path: p, filename: name}
		plan.files = append(plan.files, pf)
		plan.depth = max(plan.depth, len(segs)+1)
	}
	for i := range plan.files {
		pf := &plan.files[i]
		mime, ok := document.ExpectedMIMEForExtension(pf.filename)
		if !ok {
			return folderPlan{}, errFolderUploadUnsupportedType(pf.path, pf.filename)
		}
		pf.mime = mime
		if pf.in.SizeBytes > maxBytes {
			return folderPlan{}, errFolderUploadFileTooLarge(pf.path, pf.filename, maxBytes)
		}
		plan.totalBytes += pf.in.SizeBytes
	}
	if plan.totalBytes > limits.MaxTotalBytes {
		return folderPlan{}, errFolderUploadTooLarge(limits.MaxTotalBytes, plan.totalBytes)
	}
	for i := range plan.files {
		pf := &plan.files[i]
		if !chunked || pf.in.SizeBytes <= UploadSessionThresholdBytes {
			continue
		}
		pf.multipart = true
		if err := s.checkFolderUploadProbe(pf); err != nil {
			return folderPlan{}, err
		}
	}
	return plan, nil
}

// checkFolderUploadProbe is the upload-session probe check (openUploadSession
// step 4) for one large file of a plan; the hashes it keeps are what the
// multipart session records.
func (s *DocumentService) checkFolderUploadProbe(pf *folderPlanFile) error {
	if pf.in.Probe == nil || strings.TrimSpace(pf.in.Probe.HeadB64) == "" {
		return errFolderUploadPath("path", pf.in.Path, "tệp lớn cần probe")
	}
	probe := *pf.in.Probe
	head, err := decodeBase64Probe(probe.HeadB64)
	if err != nil {
		return errFolderUploadPath("path", pf.in.Path, "probe.head_b64 không hợp lệ hoặc vượt quá 64 KiB")
	}
	if want := min(pf.in.SizeBytes, int64(UploadSessionMaxProbeHeadBytes)); int64(len(head)) != want {
		return documentValidationError(&document.FileError{
			Reason: document.ReasonProbeHeadShort,
			Msg:    "the probe head must be exactly " + strconv.FormatInt(want, 10) + " bytes",
		})
	}
	var centralDir []byte
	if strings.TrimSpace(probe.CentralDirB64) != "" {
		centralDir, err = decodeBase64Probe(probe.CentralDirB64)
		if err != nil || len(centralDir) > UploadSessionMaxProbeCentralSize || probe.CDSize > UploadSessionMaxProbeCentralSize {
			return errFolderUploadPath("path", pf.in.Path, "probe.central_dir_b64 không hợp lệ hoặc vượt quá 1 MiB")
		}
	}
	if err := document.ValidateUploadProbe(pf.mime, pf.in.SizeBytes, head, centralDir, probe.CDOffset, probe.CDSize, s.fileLimits()); err != nil {
		return documentValidationError(err)
	}
	pf.headSHA = sha256Hex(head)
	pf.cdOffset, pf.cdSize = -1, -1
	if len(centralDir) > 0 {
		pf.tailSHA = sha256Hex(centralDir)
		pf.cdOffset, pf.cdSize = probe.CDOffset, probe.CDSize
	}
	return nil
}

// folderUploadFingerprint is the whole plan as sent, so a retry with the same
// key and another plan answers 409 idempotency_payload_mismatch.
func folderUploadFingerprint(workspaceID, parentID string, in CreateFolderUploadInput) string {
	parts := []string{idempotencyScopeFolderUploadPlan, workspaceID, parentID, in.RootName,
		strconv.FormatBool(in.ShareWithWorkspace), "folders"}
	parts = append(parts, in.Folders...)
	parts = append(parts, "files")
	for _, f := range in.Files {
		parts = append(parts, f.FileKey, f.Path, f.Filename, strconv.FormatInt(f.SizeBytes, 10))
		if f.Probe != nil {
			parts = append(parts, f.Probe.HeadB64, f.Probe.CentralDirB64,
				strconv.FormatInt(f.Probe.CDOffset, 10), strconv.FormatInt(f.Probe.CDSize, 10))
		} else {
			parts = append(parts, "-")
		}
	}
	return IdempotencyFingerprint(parts...)
}

// CreateFolderUpload is the PLAN (UNI-2052 §2). It refuses the whole plan on
// the first limit, path or gate problem; otherwise it creates the root folder
// (named "<name> (n)" when a live sibling folder already holds the name) and
// every subfolder, the batch and its file rows, one documents.folder_upload_planned
// audit row plus one document.created audit row per folder, and one
// document.batch_uploaded event, in one transaction. The upload targets are
// minted after the commit; a retry with the same Idempotency-Key answers the
// same batch with fresh targets.
func (s *DocumentService) CreateFolderUpload(ctx context.Context, actor Actor, workspaceID string, in CreateFolderUploadInput) (FolderUploadBatch, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return FolderUploadBatch{}, ErrForbidden
	}
	key := strings.TrimSpace(in.IdempotencyKey)
	if key == "" {
		return FolderUploadBatch{}, Invalid("Idempotency-Key bắt buộc")
	}
	var parentID string
	if in.ParentID != nil {
		parentID = strings.TrimSpace(*in.ParentID)
	}
	plan, err := s.validateFolderPlan(in, s.FolderUploadLimits())
	if err != nil {
		return FolderUploadBatch{}, err
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		return FolderUploadBatch{}, err
	}
	orgID, err := s.workspaceOrganization(ctx, workspaceID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	opts := IdempotencyOptions{Fingerprint: folderUploadFingerprint(workspaceID, parentID, in), RequireFingerprint: true}
	replay, err := PeekIdempotent(ctx, s.q, orgID, workspaceID, idempotencyScopeFolderUploadPlan, key, actor.ID, opts)
	if err != nil {
		return FolderUploadBatch{}, NormalizeIdempotencyError(err)
	}
	if replay != nil && len(replay.Body) > 0 {
		return s.replayFolderUpload(ctx, actor, orgID, workspaceID, replay.Body)
	}
	if s.entitlements != nil && plan.totalBytes > 0 {
		if err := s.entitlements.CheckQuota(ctx, orgID, FeatureStorageBytes, plan.totalBytes); err != nil {
			return FolderUploadBatch{}, err
		}
	}

	batchID, err := s.planFolderUpload(ctx, actor, orgID, workspaceID, parentID, key, opts, plan, in.ShareWithWorkspace)
	if err != nil {
		var r folderUploadReplay
		if errors.As(err, &r) {
			return s.replayFolderUpload(ctx, actor, orgID, workspaceID, r.body)
		}
		return FolderUploadBatch{}, err
	}
	return s.folderUploadView(ctx, actor, orgID, workspaceID, batchID, true)
}

// folderUploadReplay carries a ledger hit found inside the plan transaction
// out of it, so the replay is answered after the rollback.
type folderUploadReplay struct{ body []byte }

func (folderUploadReplay) Error() string { return "folder upload replay" }

// folderUploadLedger is what the idempotency ledger keeps for a plan.
type folderUploadLedger struct {
	BatchID string `json:"batch_id"`
}

func (s *DocumentService) replayFolderUpload(ctx context.Context, actor Actor, orgID, workspaceID string, body []byte) (FolderUploadBatch, error) {
	var r folderUploadLedger
	if err := json.Unmarshal(body, &r); err != nil || r.BatchID == "" {
		return FolderUploadBatch{}, ErrNotFound
	}
	return s.folderUploadView(ctx, actor, orgID, workspaceID, r.BatchID, true)
}

// planFolderUpload is the PLAN transaction. Lock order: idempotency claim,
// the creator's open-batch lock, the workspace tree lock, the parent row.
func (s *DocumentService) planFolderUpload(ctx context.Context, actor Actor, orgID, workspaceID, parentID, key string, opts IdempotencyOptions, plan folderPlan, share bool) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		return "", err
	}
	replay, commitIdem, err := BeginIdempotent(ctx, q, orgID, workspaceID, idempotencyScopeFolderUploadPlan, key, actor.ID, opts)
	if err != nil {
		return "", NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return "", folderUploadReplay{body: replay.Body}
	}
	if err := q.LockFolderUploadCreator(ctx, actor.ID); err != nil {
		return "", err
	}
	open, err := q.CountOpenFolderUploadsByCreator(ctx, db.CountOpenFolderUploadsByCreatorParams{
		OrganizationID: orgID, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return "", err
	}
	if open >= folderUploadMaxOpen {
		return "", errFolderUploadsBusy()
	}
	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return "", err
	}
	rootDepth := 1
	if parentID != "" {
		parent, err := s.lockPageParent(ctx, q, actor, parentID, orgID, workspaceID, DocumentKindFolder)
		if err != nil {
			return "", err
		}
		d, err := documentDepth(ctx, q, parent)
		if err != nil {
			return "", err
		}
		rootDepth = d + 1
	}
	if rootDepth+plan.depth > maxDocumentDepth {
		return "", errFolderUploadTooDeep()
	}
	rootTitle, err := s.folderUploadRootTitle(ctx, q, documentNameScope{
		OrganizationID: orgID, WorkspaceID: workspaceID, ParentID: parentID, Kind: DocumentKindFolder,
	}, plan.rootTitle)
	if err != nil {
		return "", err
	}
	batchID := util.NewID()
	rootPosition, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
		OrganizationID: orgID, WorkspaceID: workspaceID, ParentID: nullText(parentID),
	})
	if err != nil {
		return "", err
	}
	ids := map[string]string{}
	rootID, err := s.insertFolderUploadFolder(ctx, q, actor, orgID, workspaceID, parentID, rootTitle, rootPosition, batchID)
	if err != nil {
		return "", documentTitleWriteError(DocumentKindFolder, err)
	}
	ids[""] = rootID
	// A new folder has no children yet, so its children sit at 0, 1, 2... in
	// the order the plan sent them.
	next := map[string]float64{}
	for _, p := range plan.folders {
		parentPath := ""
		if i := strings.LastIndex(p, "/"); i >= 0 {
			parentPath = p[:i]
		}
		id, err := s.insertFolderUploadFolder(ctx, q, actor, orgID, workspaceID, ids[parentPath], plan.titles[p], next[parentPath], batchID)
		if err != nil {
			if isUniqueViolation(err) {
				// Two sibling folders whose names differ only in case collide
				// on the folder-name index: the plan cannot place them.
				return "", errFolderUploadPath("path", p, "hai thư mục cùng tên trong một thư mục")
			}
			return "", err
		}
		next[parentPath]++
		ids[p] = id
	}
	foldersJSON, err := json.Marshal(ids)
	if err != nil {
		return "", err
	}
	expires := s.now().UTC().Add(folderUploadTTL)
	if _, err := q.InsertDocumentFolderUpload(ctx, db.InsertDocumentFolderUploadParams{
		ID: batchID, OrganizationID: orgID, WorkspaceID: workspaceID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind), ParentID: nullText(parentID),
		RootFolderID: rootID, RootTitle: rootTitle, ShareWithWorkspace: share,
		FileCount: int32(len(plan.files)), TotalBytes: plan.totalBytes, Folders: foldersJSON,
		ExpiresAt: fileTime(expires),
	}); err != nil {
		return "", err
	}
	if len(plan.files) > 0 {
		params := db.InsertDocumentFolderUploadFilesParams{OrganizationID: orgID, WorkspaceID: workspaceID, BatchID: batchID}
		for _, f := range plan.files {
			kind := folderUploadTargetPut
			if f.multipart {
				kind = folderUploadTargetMulti
			}
			offset, size := f.cdOffset, f.cdSize
			if !f.multipart {
				offset, size = -1, -1
			}
			params.Ids = append(params.Ids, util.NewID())
			params.FileKeys = append(params.FileKeys, f.in.FileKey)
			params.FolderIds = append(params.FolderIds, ids[f.path])
			params.Paths = append(params.Paths, f.path)
			params.Filenames = append(params.Filenames, f.filename)
			params.Sizes = append(params.Sizes, f.in.SizeBytes)
			params.TargetKinds = append(params.TargetKinds, kind)
			params.ProbeHeads = append(params.ProbeHeads, f.headSHA)
			params.ProbeTails = append(params.ProbeTails, f.tailSHA)
			params.CdOffsets = append(params.CdOffsets, offset)
			params.CdSizes = append(params.CdSizes, size)
		}
		if _, err := q.InsertDocumentFolderUploadFiles(ctx, params); err != nil {
			return "", err
		}
	}
	folderIDs := make([]string, 0, len(ids))
	folderIDs = append(folderIDs, rootID)
	for _, p := range plan.folders {
		folderIDs = append(folderIDs, ids[p])
	}
	meta := map[string]any{
		"root_folder_id": rootID, "folder_ids": folderIDs, "file_count": len(plan.files),
		"total_bytes": plan.totalBytes, "share_with_workspace": share, "parent_id": nil,
	}
	if parentID != "" {
		meta["parent_id"] = parentID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID, Actor: actor,
		Action: audit.ActionDocumentsFolderUploadPlanned, ResourceType: folderUploadResourceType, ResourceID: batchID,
		Metadata: meta,
	}, audit.Event{Topic: DocumentBatchUploadedTopic, Payload: map[string]string{
		"batch_id": batchID, "workspace_id": workspaceID, "root_folder_id": rootID,
	}}); err != nil {
		return "", err
	}
	body, err := json.Marshal(folderUploadLedger{BatchID: batchID})
	if err != nil {
		return "", err
	}
	if err := commitIdem(http.StatusCreated, body); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return batchID, nil
}

// folderUploadRootTitle is the root folder's name: the chosen name when no
// live sibling folder holds it, else the smallest free "<name> (n)" from 1
// (§4). The tree lock the caller holds serializes two plans of one name.
func (s *DocumentService) folderUploadRootTitle(ctx context.Context, q *db.Queries, scope documentNameScope, title string) (string, error) {
	rows, err := s.nameKeys(ctx, q, scope, []string{title})
	if err != nil {
		return "", err
	}
	if len(rows) == 1 && !rows[0].Taken {
		return title, nil
	}
	for start := 1; start <= maxTitleSuffix; start += titleSuffixWindow {
		titles := make([]string, 0, titleSuffixWindow)
		for n := start; n < start+titleSuffixWindow && n <= maxTitleSuffix; n++ {
			titles = append(titles, suffixedTitle(DocumentKindFolder, title, n))
		}
		rows, err := s.nameKeys(ctx, q, scope, titles)
		if err != nil {
			return "", err
		}
		for i, row := range rows {
			if !row.Taken {
				return titles[i], nil
			}
		}
	}
	return "", errDocumentNameExhausted(DocumentKindFolder)
}

// insertFolderUploadFolder writes one private folder of the plan and its
// document.created audit row. No document.created event: the batch's one
// document.batch_uploaded event stands for the whole tree.
func (s *DocumentService) insertFolderUploadFolder(ctx context.Context, q *db.Queries, actor Actor, orgID, workspaceID, parentID, title string, position float64, batchID string) (string, error) {
	visibility, level := createHomeRow("", nil)
	doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
		ID:             util.NewID(),
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		ParentID:       nullText(parentID),
		Kind:           DocumentKindFolder,
		Title:          title,
		Visibility:     visibility,
		WorkspaceLevel: level,
		SearchText:     documentSearchText(title, ""),
		Revision:       1,
		Position:       position,
		AclOwnerID:     aclOwnerFor(actor),
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
	})
	if err != nil {
		return "", err
	}
	created := map[string]any{"title": doc.Title, "kind": doc.Kind, "visibility": doc.Visibility}
	if parentID != "" {
		created["parent_id"] = parentID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID, Actor: actor,
		Action: audit.ActionDocumentCreated, ResourceType: "document", ResourceID: doc.ID,
		Changes: audit.Diff(nil, created), Metadata: map[string]any{"batch_id": batchID},
	}); err != nil {
		return "", err
	}
	return doc.ID, nil
}

// folderUploadRow reads one batch for its creator; everyone else, and a
// creator who lost the workspace since, gets ErrNotFound.
func (s *DocumentService) folderUploadRow(ctx context.Context, actor Actor, orgID, workspaceID, batchID string) (db.DocumentFolderUpload, error) {
	row, err := s.q.GetDocumentFolderUpload(ctx, db.GetDocumentFolderUploadParams{
		ID: batchID, OrganizationID: orgID, WorkspaceID: workspaceID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentFolderUpload{}, ErrNotFound
	}
	return row, err
}

// folderUploadView answers the batch with its folders, its files and, when
// mint is set and the batch is open, a target for every pending file.
func (s *DocumentService) folderUploadView(ctx context.Context, actor Actor, orgID, workspaceID, batchID string, mint bool) (FolderUploadBatch, error) {
	row, err := s.folderUploadRow(ctx, actor, orgID, workspaceID, batchID)
	if err != nil {
		return FolderUploadBatch{}, err
	}
	fileRows, err := s.q.ListDocumentFolderUploadFiles(ctx, db.ListDocumentFolderUploadFilesParams{
		BatchID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
	})
	if err != nil {
		return FolderUploadBatch{}, err
	}
	out := FolderUploadBatch{
		ID: row.ID, Status: row.Status, ParentID: row.ParentID.String,
		RootFolderID: row.RootFolderID, RootTitle: row.RootTitle, ShareWithWorkspace: row.ShareWithWorkspace,
		TotalBytes: row.TotalBytes, ExpiresAt: row.ExpiresAt.Time.UTC(), CreatedAt: row.CreatedAt.Time.UTC(),
		Folders: []FolderUploadFolder{}, Files: make([]FolderUploadFile, 0, len(fileRows)),
	}
	var folders map[string]string
	if err := json.Unmarshal(row.Folders, &folders); err == nil {
		for p, id := range folders {
			out.Folders = append(out.Folders, FolderUploadFolder{Path: p, ID: id})
		}
	}
	sort.Slice(out.Folders, func(i, j int) bool { return out.Folders[i].Path < out.Folders[j].Path })
	mint = mint && row.Status == folderUploadStatusOpen && s.now().Before(row.ExpiresAt.Time)
	for _, f := range fileRows {
		v := FolderUploadFile{
			FileKey: f.FileKey, Path: f.Path, Filename: f.Filename, SizeBytes: f.SizeBytes,
			Status: f.Status, DocumentID: f.DocumentID.String, ErrorCode: f.ErrorCode.String,
		}
		out.Counts.Total++
		switch f.Status {
		case "done":
			out.Counts.Done++
		case "failed":
			out.Counts.Failed++
		default:
			out.Counts.Pending++
			if mint {
				t, err := s.mintFolderUploadTarget(ctx, actor, row, f)
				if err != nil {
					return FolderUploadBatch{}, err
				}
				v.Target = &t
			}
		}
		out.Files = append(out.Files, v)
	}
	// Files are listed by server id (a ULID), which is the order they were
	// planned in.
	return out, nil
}

// FolderUploadContentPath is the server content route (§1 #2) a file's PUT
// goes to when the store cannot presign a write.
func FolderUploadContentPath(workspaceID, batchID, fileKey string) string {
	return "/api/v1/workspaces/" + workspaceID + "/documents/folder-uploads/" + batchID + "/files/" + fileKey + "/content"
}

// mintFolderUploadTarget answers the target of one pending file, opening its
// FileService intent the first time and re-signing it after that.
func (s *DocumentService) mintFolderUploadTarget(ctx context.Context, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile) (FolderUploadTarget, error) {
	if f.TargetKind == folderUploadTargetMulti {
		return s.mintFolderUploadMultipart(ctx, actor, batch, f)
	}
	if s.files == nil {
		return FolderUploadTarget{}, documentFileError(errDocumentStoreMissing)
	}
	po, err := s.files.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: actor, Purpose: files.DocumentFile,
		Scope:       documentScope(batch.OrganizationID, batch.WorkspaceID),
		OperationID: "folder-upload:" + f.ID, Deadline: batch.ExpiresAt.Time,
	})
	if errors.Is(err, storage.ErrCapabilityUnsupported) {
		// The store cannot presign (local, CI): the bytes go through the
		// server's content route, which records the file when they arrive.
		return FolderUploadTarget{
			Kind: folderUploadTargetPut, Method: http.MethodPut,
			URL:       FolderUploadContentPath(batch.WorkspaceID, batch.ID, f.FileKey),
			Headers:   map[string]string{"Content-Type": "application/octet-stream"},
			Auth:      "session",
			ExpiresAt: batch.ExpiresAt.Time.UTC(),
		}, nil
	}
	if err != nil {
		return FolderUploadTarget{}, documentFileError(err)
	}
	if !f.UploadRef.Valid {
		if _, err := s.q.SetDocumentFolderUploadFileRef(ctx, db.SetDocumentFolderUploadFileRefParams{
			UploadRef: nullText(string(po.FileID)), ID: f.ID,
			OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID,
		}); err != nil {
			return FolderUploadTarget{}, err
		}
	}
	return FolderUploadTarget{
		Kind: folderUploadTargetPut, Method: po.WriteTarget.Method, URL: po.WriteTarget.URL,
		Headers: po.WriteTarget.Headers, ExpiresAt: po.WriteTarget.ExpiresAt.UTC(),
	}, nil
}

// mintFolderUploadMultipart opens the BIGUP-S1 multipart session of a large
// file (opened_via 'folder') the first time and answers its missing parts.
func (s *DocumentService) mintFolderUploadMultipart(ctx context.Context, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile) (FolderUploadTarget, error) {
	fs, err := s.multipartFileService()
	if err != nil {
		return FolderUploadTarget{}, err
	}
	sessionID := f.UploadRef.String
	if !f.UploadRef.Valid {
		sessionID, err = s.openFolderUploadMultipart(ctx, fs, actor, batch, f)
		if err != nil {
			return FolderUploadTarget{}, err
		}
	}
	row, err := s.q.GetFileMultipartUploadByID(ctx, sessionID)
	if err != nil {
		return FolderUploadTarget{}, err
	}
	view, err := s.getUploadSessionView(ctx, row)
	if err != nil {
		return FolderUploadTarget{}, err
	}
	return FolderUploadTarget{
		Kind: folderUploadTargetMulti, SessionID: view.SessionID, PartSize: view.PartSize,
		Parts: view.Parts, ExpiresAt: view.ExpiresAt,
	}, nil
}

// openFolderUploadMultipart reserves and creates the multipart upload, then
// records the session and the file's reference in one transaction. A
// concurrent mint that recorded first wins: this one aborts what it prepared
// and answers the winner's session.
func (s *DocumentService) openFolderUploadMultipart(ctx context.Context, fs *FileService, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile) (string, error) {
	mime, _ := document.ExpectedMIMEForExtension(f.Filename)
	filename := files.SanitizeFilename(f.Filename)
	prep, err := fs.prepareMultipartUpload(ctx, actor, documentScope(batch.OrganizationID, batch.WorkspaceID), filename, mime, f.SizeBytes, s.entitlements)
	if err != nil {
		return "", documentFileError(err)
	}
	abort := func() error {
		abortErr := fs.store.AbortMultipart(context.WithoutCancel(ctx), locator(prep.file), prep.storageUploadID)
		return errors.Join(abortErr, fs.cancelMultipartFileSession(ctx, prep.file.ID, prep.fileSession.ID, false))
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	totalParts := int((f.SizeBytes + UploadSessionPartSizeBytes - 1) / UploadSessionPartSizeBytes)
	sessionID := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", errors.Join(err, abort())
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	var cdOffset, cdSize pgtype.Int8
	if f.CdOffset.Valid {
		cdOffset, cdSize = f.CdOffset, f.CdSize
	}
	if _, err := q.InsertFileMultipartUpload(ctx, db.InsertFileMultipartUploadParams{
		ID: sessionID, OrganizationID: batch.OrganizationID, WorkspaceID: batch.WorkspaceID,
		FileID: prep.file.ID, FileUploadSessionID: prep.fileSession.ID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind), OpenedVia: folderUploadOpenedVia,
		StorageUploadID: prep.storageUploadID, ObjectKey: prep.file.ObjectKey, Filename: filename,
		SizeBytes: f.SizeBytes, PartSize: UploadSessionPartSizeBytes, TotalParts: int32(totalParts),
		ProbeHeadSha256: f.ProbeHeadSha256.String, ProbeTailSha256: f.ProbeTailSha256.String,
		CdOffset: cdOffset, CdSize: cdSize,
		ExpiresAt: batch.ExpiresAt, CreatedAt: fileTime(now),
	}); err != nil {
		return "", errors.Join(err, abort())
	}
	n, err := q.SetDocumentFolderUploadFileRef(ctx, db.SetDocumentFolderUploadFileRefParams{
		UploadRef: nullText(sessionID), ID: f.ID, OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID,
	})
	if err != nil {
		return "", errors.Join(err, abort())
	}
	if n == 0 {
		_ = tx.Rollback(ctx)
		if err := abort(); err != nil {
			return "", err
		}
		cur, err := s.q.GetDocumentFolderUploadFileByKey(ctx, db.GetDocumentFolderUploadFileByKeyParams{
			BatchID: f.BatchID, FileKey: f.FileKey, OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID,
		})
		if err != nil {
			return "", err
		}
		if !cur.UploadRef.Valid {
			return "", ErrNotFound
		}
		return cur.UploadRef.String, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return "", errors.Join(err, abort())
	}
	return sessionID, nil
}
