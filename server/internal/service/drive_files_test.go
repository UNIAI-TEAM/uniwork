package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestBuildDriveOpenURL(t *testing.T) {
	t.Parallel()

	got := BuildDriveOpenURL(
		"https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=drivesdk",
		"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
		"lan@uniwork.vn",
	)
	want := "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=lan%40uniwork.vn&usp=drivesdk"
	if got != want {
		t.Fatalf("BuildDriveOpenURL with email = %q, want %q", got, want)
	}

	// Unknown viewer access (empty viewerEmail) keeps original webViewLink without authuser.
	gotNoEmail := BuildDriveOpenURL(
		"https://docs.google.com/document/d/ext-1/edit",
		"ext-1",
		"",
	)
	if gotNoEmail != "https://docs.google.com/document/d/ext-1/edit" {
		t.Fatalf("BuildDriveOpenURL without email = %q", gotNoEmail)
	}

	// Empty webViewLink falls back to standard Drive open URL.
	gotFallback := BuildDriveOpenURL("", "ext-fallback-1", "minh@example.com")
	wantFallback := "https://drive.google.com/open?authuser=minh%40example.com&id=ext-fallback-1"
	if gotFallback != wantFallback {
		t.Fatalf("BuildDriveOpenURL fallback = %q, want %q", gotFallback, wantFallback)
	}
}

func TestComputeViewerAccessStates(t *testing.T) {
	t.Parallel()

	state, cid, email := computeViewerAccess("", "", "", false, false)
	if state != DriveViewerAccessUnknown || cid != nil || email != "" {
		t.Fatalf("empty access = (%q, %v, %q), want unknown", state, cid, email)
	}

	state, cid, email = computeViewerAccess("lost", "conn-1", "a@example.com", false, false)
	if state != DriveViewerAccessLost || cid == nil || *cid != "conn-1" || email != "a@example.com" {
		t.Fatalf("lost access = (%q, %v, %q)", state, cid, email)
	}

	state, cid, email = computeViewerAccess("granted", "conn-1", "a@example.com", false, false)
	if state != DriveViewerAccessGranted || cid == nil || *cid != "conn-1" || email != "a@example.com" {
		t.Fatalf("granted access = (%q, %v, %q)", state, cid, email)
	}

	state, cid, email = computeViewerAccess("granted", "conn-1", "a@example.com", true, false)
	if state != DriveViewerAccessConnectionLost || cid == nil || *cid != "conn-1" || email != "a@example.com" {
		t.Fatalf("disconnected granted access = (%q, %v, %q), want connection_lost", state, cid, email)
	}

	state, cid, email = computeViewerAccess("granted", "conn-1", "a@example.com", false, true)
	if state != DriveViewerAccessConnectionLost || cid == nil || *cid != "conn-1" || email != "a@example.com" {
		t.Fatalf("auth_failed granted access = (%q, %v, %q), want connection_lost", state, cid, email)
	}

	svc := &DriveFileService{}
	baseDetail := db.GetDriveFileEnrichedRow{
		ID:             "df-1",
		OrganizationID: "org-1",
		WorkspaceID:    "ws-1",
		ExternalFileID: "ext-1",
		Name:           "Spec",
		MimeType:       DriveMimeGoogleDoc,
		IconKind:       "google_doc",
		SharingState:   DriveSharingStateShared,
		BoundBy:        "u-owner",
		CreatedBy:      "u-owner",
	}
	baseCard := db.ListTaskDriveFilesEnrichedRow{
		ID:             "df-1",
		LinkedTaskID:   "task-1",
		OrganizationID: "org-1",
		WorkspaceID:    "ws-1",
		ExternalFileID: "ext-1",
		Name:           "Spec",
		MimeType:       DriveMimeGoogleDoc,
		IconKind:       "google_doc",
		SharingState:   DriveSharingStateShared,
		BoundBy:        "u-owner",
		CreatedBy:      "u-owner",
	}
	type capCase struct {
		name       string
		role       string
		aiEnabled  bool
		accState   string
		connActive bool
		wantState  string
		wantCanAI  bool
	}
	for _, tc := range []capCase{
		{name: "granted-member-ai-on", role: "member", aiEnabled: true, accState: "granted", connActive: true, wantState: DriveViewerAccessGranted, wantCanAI: true},
		{name: "unknown-member-ai-on", role: "member", aiEnabled: true, accState: "", connActive: false, wantState: DriveViewerAccessUnknown, wantCanAI: false},
		{name: "lost-member-ai-on", role: "member", aiEnabled: true, accState: "lost", connActive: true, wantState: DriveViewerAccessLost, wantCanAI: false},
		{name: "connection-lost-member-ai-on", role: "member", aiEnabled: true, accState: "granted", connActive: false, wantState: DriveViewerAccessConnectionLost, wantCanAI: false},
		{name: "granted-member-ai-off", role: "member", aiEnabled: false, accState: "granted", connActive: true, wantState: DriveViewerAccessGranted, wantCanAI: false},
		{name: "granted-guest-ai-on", role: "guest", aiEnabled: true, accState: "granted", connActive: true, wantState: DriveViewerAccessGranted, wantCanAI: false},
	} {
		aiOn := tc.aiEnabled
		svc.SetAIEnabled(func() bool { return aiOn })
		dr := baseDetail
		dr.ViewerAccessState = pgtype.Text{String: tc.accState, Valid: tc.accState != ""}
		dr.ViewerConnectionID = pgtype.Text{String: "conn-1", Valid: tc.accState != ""}
		dr.ViewerAccountEmail = "v@example.com"
		dr.ViewerConnectionActive = tc.connActive
		dv := svc.buildDriveFileViewFromDetailRow("u-viewer", db.WorkspaceMember{Role: tc.role}, dr, nil, DriveTasksCreatedSummary{}, nil)
		if dv.ViewerAccess != tc.wantState || dv.CanAsk != tc.wantCanAI || dv.CanPropose != tc.wantCanAI {
			t.Fatalf("%s detail: access=%q can_ask=%v can_propose=%v, want access=%q canAI=%v", tc.name, dv.ViewerAccess, dv.CanAsk, dv.CanPropose, tc.wantState, tc.wantCanAI)
		}
		cr := baseCard
		cr.ViewerAccessState = dr.ViewerAccessState
		cr.ViewerConnectionID = dr.ViewerConnectionID
		cr.ViewerAccountEmail = dr.ViewerAccountEmail
		cr.ViewerConnectionActive = dr.ViewerConnectionActive
		cv := svc.buildDriveTaskFileCardView("u-viewer", db.WorkspaceMember{Role: tc.role}, cr, true, DriveTasksCreatedSummary{})
		if cv.ViewerAccess != tc.wantState || cv.CanAsk != tc.wantCanAI || cv.CanPropose != tc.wantCanAI {
			t.Fatalf("%s card: access=%q can_ask=%v can_propose=%v, want access=%q canAI=%v", tc.name, cv.ViewerAccess, cv.CanAsk, cv.CanPropose, tc.wantState, tc.wantCanAI)
		}
	}

	receiptLost := buildDriveFileLinkReceipt(db.DriveFile{ID: "df-1", WorkspaceID: "ws-1", ExternalFileID: "ext-1"}, DriveViewerAccessConnectionLost, "conn-1", "a1@example.com")
	if receiptLost.ViewerAccess != DriveViewerAccessConnectionLost || receiptLost.ViewerAccountEmail != "a1@example.com" {
		t.Fatalf("receiptLost = %+v", receiptLost)
	}
}

func TestNormalizeMetadataForDBAndCursorRoundTrip(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 10, 26, 9, 30, 0, 123456000, time.UTC)
	mod := now.Add(-time.Hour)
	sharedCount := 4
	params := normalizeMetadataForDB(DriveFileMetadata{
		ExternalFileID:    "ext-shared-drive",
		DriveID:           "0ADriveSharedID",
		Name:              "  Kế hoạch Q4  ",
		MimeType:          DriveMimeGoogleSheet,
		ModifiedAt:        &mod,
		ModifiedByDisplay: " Minh Nguyễn ",
		SharingState:      DriveSharingStateShared,
		SharedUserCount:   &sharedCount,
	}, "ext-shared-drive", now)

	if !params.DriveID.Valid || params.DriveID.String != "0ADriveSharedID" {
		t.Fatalf("DriveID = %+v", params.DriveID)
	}
	if params.OwnerDisplay != "Bộ nhớ dùng chung" {
		t.Fatalf("OwnerDisplay fallback for Shared Drive = %q, want Bộ nhớ dùng chung", params.OwnerDisplay)
	}
	if params.IconKind != "google_sheet" {
		t.Fatalf("IconKind = %q, want google_sheet", params.IconKind)
	}
	if !params.SharedUserCount.Valid || params.SharedUserCount.Int32 != 4 {
		t.Fatalf("SharedUserCount = %+v", params.SharedUserCount)
	}

	cur := encodeDriveFilesCursor(now, "01J8X4DRVFILE0000000000001")
	gotTS, gotID, err := decodeDriveFilesCursor(cur)
	if err != nil {
		t.Fatalf("decodeDriveFilesCursor: %v", err)
	}
	if !gotTS.Equal(now) || gotID != "01J8X4DRVFILE0000000000001" {
		t.Fatalf("decoded cursor = (%v, %q), want (%v, %q)", gotTS, gotID, now, "01J8X4DRVFILE0000000000001")
	}
	if _, _, err := decodeDriveFilesCursor("not-valid-base64!!!"); err == nil {
		t.Fatalf("expected error on malformed cursor")
	}
}

func TestWrapTaskCreateDriveFileErrorAndPermissions(t *testing.T) {
	t.Parallel()

	err := wrapTaskCreateDriveFileError(2, "ext-404", ErrDriveFileNotAccessible)
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("expected CodedError, got %T (%v)", err, err)
	}
	if ce.Status != http.StatusNotFound || ce.Code != "drive_file_not_accessible" {
		t.Fatalf("status=%d code=%q, want 404 drive_file_not_accessible", ce.Status, ce.Code)
	}
	if ce.Fields["drive_files_index"] != 2 || ce.Fields["external_file_id"] != "ext-404" {
		t.Fatalf("fields = %+v", ce.Fields)
	}

	f := db.DriveFile{ID: "df-1", CreatedBy: "user-creator", BoundBy: "user-binder"}
	if !canManageDriveFile("user-creator", db.WorkspaceMember{Role: "member"}, f) {
		t.Fatalf("creator must be allowed to manage")
	}
	if !canManageDriveFile("user-binder", db.WorkspaceMember{Role: "member"}, f) {
		t.Fatalf("bound_by must be allowed to manage")
	}
	if !canManageDriveFile("user-admin", db.WorkspaceMember{Role: "admin"}, f) {
		t.Fatalf("workspace admin must be allowed to manage")
	}
	if canManageDriveFile("user-other", db.WorkspaceMember{Role: "member"}, f) {
		t.Fatalf("unrelated member must not be allowed to manage")
	}
	if canManageDriveFile("user-guest", db.WorkspaceMember{Role: "guest"}, f) {
		t.Fatalf("guest must not be allowed to manage")
	}
}

type guestOverrideDBTX struct {
	inner  db.DBTX
	orgID  string
	guests map[string]bool
}

func (g *guestOverrideDBTX) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return g.inner.Exec(ctx, sql, args...)
}

func (g *guestOverrideDBTX) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return g.inner.Query(ctx, sql, args...)
}

func (g *guestOverrideDBTX) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "-- name: GetWorkspaceAccess") && len(args) >= 2 {
		if userID, ok := args[1].(string); ok && g.guests[userID] {
			return driveUnitRowFunc(func(dest ...any) error {
				*(dest[0].(*string)) = "guest"
				*(dest[1].(*string)) = g.orgID
				*(dest[2].(*string)) = OrganizationActive
				*(dest[3].(*string)) = "member"
				*(dest[4].(*pgtype.Timestamptz)) = pgtype.Timestamptz{}
				*(dest[5].(*bool)) = false
				return nil
			})
		}
	}
	return g.inner.QueryRow(ctx, sql, args...)
}

type driveFilesTestEnv struct {
	*driveTestFixture
	owner      db.User
	peer       db.User
	wsA        db.Workspace
	googleSrv  *FakeGoogleDriveServer
	fileSvc    *DriveFileService
	taskSvc    *TaskService
	contentSvc *DriveContentService
	guests     map[string]bool
}

func newDriveFilesTestEnv(t *testing.T) *driveFilesTestEnv {
	t.Helper()
	fx := newDriveTestFixture(t)
	guests := map[string]bool{}
	fx.ws.q = db.New(&guestOverrideDBTX{inner: fx.pool, orgID: fx.org.ID, guests: guests})
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	peer := registerVerified(t, fx.q, as, "drive-peer-"+util.NewID()+"@example.com", "Peer")
	addOrgMember(t, fx.q, fx.org.ID, peer.ID)
	addWorkspaceMember(t, fx.q, fx.work.ID, peer.ID)

	googleSrv := NewFakeGoogleDriveServer(t.Cleanup)
	fileSvc := NewDriveFileService(fx.pool, fx.q, fx.ws, fx.svc, googleSrv.Client)
	fileSvc.SetFlags(fx.svc.flags)
	taskSvc := NewTaskService(fx.pool, fx.q, fx.ws, nil)
	taskSvc.SetDriveFiles(fileSvc)
	contentSvc := NewDriveContentService(fx.pool, fx.q, fx.ws, fileSvc, fx.svc, googleSrv.Client, nil)
	return &driveFilesTestEnv{
		driveTestFixture: fx,
		owner:            fx.user,
		peer:             peer,
		wsA:              fx.work,
		googleSrv:        googleSrv,
		fileSvc:          fileSvc,
		taskSvc:          taskSvc,
		contentSvc:       contentSvc,
		guests:           guests,
	}
}
func (e *driveFilesTestEnv) connectAccount(t *testing.T, userID, _ string, sub, email string) db.DriveConnection {
	t.Helper()
	refEnc, err := e.svc.sealSecret("tok-r-" + sub)
	if err != nil {
		t.Fatal(err)
	}
	accEnc, err := e.svc.sealSecret("tok-a-" + sub)
	if err != nil {
		t.Fatal(err)
	}
	row, err := e.q.CreateDriveConnection(context.Background(), db.CreateDriveConnectionParams{
		ID:              util.NewID(),
		OrganizationID:  e.org.ID,
		UserID:          userID,
		Provider:        "google",
		GoogleSub:       sub,
		GoogleEmail:     email,
		RefreshTokenEnc: refEnc,
		AccessTokenEnc:  accEnc,
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
		Scopes:          "openid email " + DriveGoogleScope,
	})
	if err != nil {
		t.Fatalf("CreateDriveConnection: %v", err)
	}
	return row
}
func TestDriveFileLinkTwoMembersNoCrossEmailLeakAndConcurrentRace(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	connA := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-race", "owner-race@example.com")
	connB := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-peer-race", "peer-race@example.com")

	env.googleSrv.SetFile("ext-shared-race", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:          "ext-shared-race",
			Name:        "Ngân sách 2026",
			MimeType:    DriveMimeGoogleSheet,
			WebViewLink: "https://docs.google.com/spreadsheets/d/ext-shared-race/edit",
			Shared:      new(true),
		},
	})

	var (
		wg   sync.WaitGroup
		resA []DriveFileLinkItemResult
		resB []DriveFileLinkItemResult
		errA error
		errB error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		resA, errA = env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
			ConnectionID:    connA.ID,
			ExternalFileIDs: []string{"ext-shared-race"},
		})
	}()
	go func() {
		defer wg.Done()
		resB, errB = env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
			ConnectionID:    connB.ID,
			ExternalFileIDs: []string{"ext-shared-race"},
		})
	}()
	wg.Wait()

	if errA != nil || errB != nil {
		t.Fatalf("concurrent Link errA=%v errB=%v", errA, errB)
	}
	if len(resA) != 1 || resA[0].Outcome != DriveFileLinkOutcomeLinked || resA[0].File == nil {
		t.Fatalf("resA = %+v", resA)
	}
	if len(resB) != 1 || resB[0].Outcome != DriveFileLinkOutcomeLinked || resB[0].File == nil {
		t.Fatalf("resB = %+v", resB)
	}
	if resA[0].File.ID != resB[0].File.ID {
		t.Fatalf("expected same drive_files row ID, got %q vs %q", resA[0].File.ID, resB[0].File.ID)
	}
	// Each caller sees only their own account email in the receipt, never the other's.
	if resA[0].File.ViewerAccountEmail != "owner-race@example.com" {
		t.Fatalf("resA ViewerAccountEmail = %q", resA[0].File.ViewerAccountEmail)
	}
	if resB[0].File.ViewerAccountEmail != "peer-race@example.com" {
		t.Fatalf("resB ViewerAccountEmail = %q", resB[0].File.ViewerAccountEmail)
	}

	// LinkedFileCount on connections reflects active files opened by that connection.
	connsA, err := env.svc.List(ctx, Human(env.owner.ID), env.wsA.ID)
	if err != nil || len(connsA) != 1 || connsA[0].LinkedFileCount != 1 {
		t.Fatalf("connsA = %+v, err=%v", connsA, err)
	}

	// F04: Two overlapping stale readers claim metadata refresh via conditional UPDATE;
	// only one calls Google files.get, and a transient failure keeps old metadata and respects the 10m throttle.
	sharedFileID := resA[0].File.ID
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, sharedFileID); err != nil {
		t.Fatalf("age metadata_refreshed_at: %v", err)
	}
	env.googleSrv.SetFile("ext-shared-race", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:          "ext-shared-race",
			Name:        "Ngân sách 2026 (Mới)",
			MimeType:    DriveMimeGoogleSheet,
			WebViewLink: "https://docs.google.com/spreadsheets/d/ext-shared-race/edit",
			Shared:      new(true),
		},
	})
	callsBeforeRefresh := len(env.googleSrv.Calls())
	refreshEntered := make(chan struct{})
	refreshRelease := make(chan struct{})
	var refreshOnce sync.Once
	env.googleSrv.SetOverride(func(_ http.ResponseWriter, _ *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "ext-shared-race" && call.Op == "get" {
			refreshOnce.Do(func() { close(refreshEntered) })
			<-refreshRelease
		}
		return false
	})
	var wgRefresh sync.WaitGroup
	wgRefresh.Add(2)
	go func() {
		defer wgRefresh.Done()
		_, _ = env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, sharedFileID)
	}()
	<-refreshEntered
	go func() {
		defer wgRefresh.Done()
		_, _ = env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, sharedFileID)
	}()
	time.Sleep(25 * time.Millisecond)
	close(refreshRelease)
	wgRefresh.Wait()
	env.googleSrv.SetOverride(nil)
	if gotRefreshCalls := len(env.googleSrv.Calls()) - callsBeforeRefresh; gotRefreshCalls != 1 {
		t.Fatalf("overlapping stale readers Google calls = %d, want 1", gotRefreshCalls)
	}

	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, sharedFileID); err != nil {
		t.Fatalf("age metadata_refreshed_at for transient failure: %v", err)
	}
	env.googleSrv.SetFile("ext-shared-race", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-shared-race", Name: "Should Not Apply", MimeType: DriveMimeGoogleSheet},
		DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusServiceUnavailable, Reason: "backendError"},
	})
	callsBeforeFail := len(env.googleSrv.Calls())
	afterFail1, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, sharedFileID)
	if err != nil || afterFail1.Name != "Ngân sách 2026 (Mới)" {
		t.Fatalf("Get on transient refresh failure = %+v, err=%v", afterFail1, err)
	}
	afterFail2, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, sharedFileID)
	if err != nil || afterFail2.Name != "Ngân sách 2026 (Mới)" {
		t.Fatalf("second Get after transient refresh failure = %+v, err=%v", afterFail2, err)
	}
	if gotFailCalls := len(env.googleSrv.Calls()) - callsBeforeFail; gotFailCalls != 1 {
		t.Fatalf("transient refresh failure Google calls across 2 Gets = %d, want 1 (throttle held)", gotFailCalls)
	}
	env.googleSrv.SetFile("ext-shared-race", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-shared-race", Name: "Ngân sách 2026 (Mới)", MimeType: DriveMimeGoogleSheet},
	})
	// F03: A disconnect that commits while files.get is in flight causes the Link
	// save transaction (and task-create linking) to reject the disconnected connection
	// under the FOR SHARE lock without writing any drive_files or access rows.
	connDisc := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-disc", "owner-disc@example.com")
	env.googleSrv.SetFile("ext-disc-inflight", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-disc-inflight", Name: "Inflight Disconnect", MimeType: DriveMimeGoogleDoc},
	})
	inFlightStarted := make(chan struct{})
	inFlightRelease := make(chan struct{})
	var once sync.Once
	env.googleSrv.SetOverride(func(_ http.ResponseWriter, _ *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "ext-disc-inflight" && call.Op == "get" {
			once.Do(func() { close(inFlightStarted) })
			<-inFlightRelease
		}
		return false
	})
	var linkDiscErr error
	linkDone := make(chan struct{})
	go func() {
		defer close(linkDone)
		_, linkDiscErr = env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
			ConnectionID:    connDisc.ID,
			ExternalFileIDs: []string{"ext-disc-inflight"},
		})
	}()
	<-inFlightStarted
	if err := env.svc.Disconnect(ctx, Human(env.owner.ID), env.wsA.ID, connDisc.ID); err != nil {
		close(inFlightRelease)
		t.Fatalf("Disconnect during files.get: %v", err)
	}
	close(inFlightRelease)
	<-linkDone
	env.googleSrv.SetOverride(nil)
	if !errors.Is(linkDiscErr, ErrNotFound) {
		t.Fatalf("Link after inflight Disconnect = %v, want ErrNotFound", linkDiscErr)
	}
	var discFileCount int
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_files WHERE workspace_id = $1 AND external_file_id = 'ext-disc-inflight'`, env.wsA.ID).Scan(&discFileCount); err != nil || discFileCount != 0 {
		t.Fatalf("discFileCount = %d, err=%v, want 0", discFileCount, err)
	}
}

func TestDriveFileLinkSameMemberOverrideRuleAndRebind(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	connA1 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-a1", "a1@example.com")
	connA2 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-a2", "a2@example.com")
	connB := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-b1", "b1@example.com")
	connB2 := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-b2", "b2@example.com")

	// Make peer a workspace admin so peer can also test admin Rebind.
	if _, err := env.ws.UpdateMemberRole(ctx, env.owner.ID, env.wsA.ID, env.peer.ID, "admin"); err != nil {
		t.Fatalf("UpdateMemberRole: %v", err)
	}

	overrideMedia := map[string][]byte{
		"tok-a-sub-a1": []byte("body-from-tok-a1"),
		"tok-a-sub-a2": []byte("body-from-tok-a2"),
		"tok-a-sub-b1": []byte("body-from-tok-b1"),
		"tok-a-sub-b2": []byte("body-from-tok-b2"),
	}
	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-override-1",
			Name:     "Tài liệu kiến trúc",
			MimeType: DriveMimePlainText,
		},
		MediaByToken: overrideMedia,
	})

	// 1. Owner links with connA1 -> outcome "linked".
	r1, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA1.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(r1) != 1 || r1[0].Outcome != DriveFileLinkOutcomeLinked {
		t.Fatalf("first Link = %+v, err=%v", r1, err)
	}
	fileID := r1[0].File.ID

	// 2. Owner links again with connA1 -> outcome "already_linked", account_email = a1@example.com.
	r2, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA1.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(r2) != 1 || r2[0].Outcome != DriveFileLinkOutcomeAlreadyLinked || r2[0].AccountEmail != "a1@example.com" {
		t.Fatalf("second Link same conn = %+v, err=%v", r2, err)
	}

	// 3. Owner links with connA2 while connA1 is granted -> §6.3 override rule keeps connA1!
	r3, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA2.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(r3) != 1 || r3[0].Outcome != DriveFileLinkOutcomeAlreadyLinked || r3[0].AccountEmail != "a1@example.com" || r3[0].File.ViewerAccess != DriveViewerAccessGranted {
		t.Fatalf("third Link diff conn = %+v, err=%v", r3, err)
	}
	dcDedup, err := env.contentSvc.ReadForAI(ctx, env.owner.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni)
	if err != nil || dcDedup.Text != "body-from-tok-a1" || dcDedup.GoogleEmail != "a1@example.com" {
		t.Fatalf("ReadForAI after same-member dedup = %+v, err=%v, want body-from-tok-a1", dcDedup, err)
	}

	// 3b (F08). When kept connA1 has auth_failed_at set and owner links with active connA2,
	// the already_linked receipt reports viewer_access=connection_lost and keeps a1@example.com, consistent with Get.
	if _, err := env.pool.Exec(ctx, `UPDATE drive_connections SET auth_failed_at = now() WHERE id = $1`, connA1.ID); err != nil {
		t.Fatalf("mark connA1 auth_failed: %v", err)
	}
	r3Lost, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA2.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(r3Lost) != 1 || r3Lost[0].Outcome != DriveFileLinkOutcomeAlreadyLinked || r3Lost[0].AccountEmail != "a1@example.com" || r3Lost[0].File.ViewerAccess != DriveViewerAccessConnectionLost {
		t.Fatalf("already_linked with lost kept conn = %+v, err=%v", r3Lost, err)
	}
	getLost, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, fileID)
	if err != nil || getLost.ViewerAccess != DriveViewerAccessConnectionLost || getLost.CanAsk || getLost.CanPropose {
		t.Fatalf("Get with lost kept conn = %+v, err=%v", getLost, err)
	}
	if _, err := env.pool.Exec(ctx, `UPDATE drive_connections SET auth_failed_at = NULL WHERE id = $1`, connA1.ID); err != nil {
		t.Fatalf("clear connA1 auth_failed: %v", err)
	}
	// 4. Owner (bound_by) calls ChangeReadAccount (PUT .../access) -> 409 use_rebind.
	_, err = env.fileSvc.ChangeReadAccount(ctx, Human(env.owner.ID), env.wsA.ID, fileID, connA2.ID)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusConflict || ce.Code != "use_rebind" {
		t.Fatalf("ChangeReadAccount by bound_by = %v, want 409 use_rebind", err)
	}

	// 5 (F05 + F06). Attach to a task so peer sees the file with viewer_access=unknown;
	// ChangeReadAccount when unknown -> 409 use_grant_access.
	taskPut, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{Title: "PUT Access Task"})
	if err != nil {
		t.Fatalf("Create taskPut: %v", err)
	}
	taskPutID := taskPut.ID
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connA1.ID, ExternalFileIDs: []string{"ext-override-1"}, TaskID: &taskPutID,
	}); err != nil {
		t.Fatalf("Link to taskPut: %v", err)
	}
	_, err = env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID)
	if !errors.As(err, &ce) || ce.Status != http.StatusConflict || ce.Code != "use_grant_access" {
		t.Fatalf("ChangeReadAccount when unknown = %v, want 409 use_grant_access", err)
	}

	rb, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connB.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(rb) != 1 || rb[0].Outcome != DriveFileLinkOutcomeLinked {
		t.Fatalf("peer Link = %+v, err=%v", rb, err)
	}
	viewB, err := env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID)
	if err != nil || viewB.ViewerAccountEmail != "b2@example.com" || viewB.BoundAccountEmail != "a1@example.com" {
		t.Fatalf("peer ChangeReadAccount = %+v, err=%v", viewB, err)
	}

	// F06a: Transient error on PUT access leaves kept granted row untouched.
	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimeGoogleDoc},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-b2": {Status: http.StatusServiceUnavailable, Reason: "backendError"},
		},
	})
	if _, err := env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID); err == nil {
		t.Fatal("expected error on transient 503 PUT access")
	}
	afterTransient, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil || afterTransient.ViewerAccess != DriveViewerAccessGranted || afterTransient.ViewerAccountEmail != "b2@example.com" {
		t.Fatalf("peer after transient PUT error = %+v, err=%v", afterTransient, err)
	}

	// F06b: Candidate other connection (connB) ACL failure leaves kept row on connB2 untouched.
	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimeGoogleDoc},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-b1": {Status: http.StatusForbidden, Reason: "insufficientFilePermissions"},
		},
	})
	if _, err := env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID); err == nil {
		t.Fatal("expected error on candidate connB ACL failure")
	}
	afterCandidateFail, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil || afterCandidateFail.ViewerAccess != DriveViewerAccessGranted || afterCandidateFail.ViewerAccountEmail != "b2@example.com" {
		t.Fatalf("peer after candidate connB PUT error = %+v, err=%v", afterCandidateFail, err)
	}

	// F06c: Current connection (connB2) ACL failure marks peer's row lost; subsequent PUT when lost -> 409 use_grant_access (F05).
	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimeGoogleDoc},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-b2": {Status: http.StatusNotFound, Reason: "notFound"},
		},
	})
	if _, err := env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID); err == nil {
		t.Fatal("expected error on current connB2 ACL loss")
	}
	afterCurrentLoss, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil || afterCurrentLoss.ViewerAccess != DriveViewerAccessLost {
		t.Fatalf("peer after current connB2 PUT ACL loss = %+v, err=%v, want lost", afterCurrentLoss, err)
	}
	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimePlainText},
		MediaByToken: overrideMedia,
	})
	_, err = env.fileSvc.ChangeReadAccount(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID)
	if !errors.As(err, &ce) || ce.Status != http.StatusConflict || ce.Code != "use_grant_access" {
		t.Fatalf("ChangeReadAccount when lost = %v, want 409 use_grant_access", err)
	}
	if _, err := env.fileSvc.GrantAccess(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID); err != nil {
		t.Fatalf("recover peer GrantAccess: %v", err)
	}

	// 6. Admin peer calls Rebind with connB -> bound_by becomes peer, bound_account_email becomes b1@example.com,
	// created_by stays owner, and owner's own drive_file_access still points to connA1 (a1@example.com)!
	reboundView, err := env.fileSvc.Rebind(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID)
	if err != nil {
		t.Fatalf("admin Rebind: %v", err)
	}
	if reboundView.BoundByID != env.peer.ID || reboundView.CreatedBy != env.owner.ID || reboundView.BoundAccountEmail != "b1@example.com" {
		t.Fatalf("reboundView = %+v", reboundView)
	}
	ownerViewAfterRebind, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, fileID)
	if err != nil {
		t.Fatalf("owner Get after admin Rebind: %v", err)
	}
	if ownerViewAfterRebind.ViewerAccountEmail != "a1@example.com" || ownerViewAfterRebind.ViewerAccess != DriveViewerAccessGranted {
		t.Fatalf("owner viewer access after admin Rebind = %+v, want a1@example.com granted", ownerViewAfterRebind)
	}
	dcOwnerAfterRebind, err := env.contentSvc.ReadForAI(ctx, env.owner.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni)
	if err != nil || dcOwnerAfterRebind.Text != "body-from-tok-a1" || dcOwnerAfterRebind.GoogleEmail != "a1@example.com" {
		t.Fatalf("owner ReadForAI after peer Rebind = %+v, err=%v, want body-from-tok-a1", dcOwnerAfterRebind, err)
	}
	dcPeerAfterRebind, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni)
	if err != nil || dcPeerAfterRebind.Text != "body-from-tok-b1" || dcPeerAfterRebind.GoogleEmail != "b1@example.com" {
		t.Fatalf("peer ReadForAI after peer Rebind = %+v, err=%v, want body-from-tok-b1", dcPeerAfterRebind, err)
	}

	// 7 (F11). Lost bound_by row re-picked with a different connection via POST GrantAccess
	// (and via Link) updates both drive_files and drive_file_access and audits drive_file.rebound.
	if err := env.fileSvc.RecordFileAccessLost(ctx, env.peer.ID, env.wsA.ID, fileID, connB.ID); err != nil {
		t.Fatalf("RecordFileAccessLost peer connB: %v", err)
	}
	var reboundAuditBefore, updatedOutboxBefore int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.rebound' AND resource_id = $2`, env.org.ID, fileID).Scan(&reboundAuditBefore)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updatedOutboxBefore)
	postRebound, err := env.fileSvc.GrantAccess(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB2.ID)
	if err != nil || postRebound.ConnectionID != connB2.ID || postRebound.BoundAccountEmail != "b2@example.com" || postRebound.AccessLostAt != nil || postRebound.ViewerAccess != DriveViewerAccessGranted || postRebound.ViewerAccountEmail != "b2@example.com" {
		t.Fatalf("GrantAccess lost bound_by diff conn = %+v, err=%v", postRebound, err)
	}
	var reboundAuditMid, updatedOutboxMid int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.rebound' AND resource_id = $2`, env.org.ID, fileID).Scan(&reboundAuditMid)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updatedOutboxMid)
	if reboundAuditMid != reboundAuditBefore+1 || updatedOutboxMid != updatedOutboxBefore+1 {
		t.Fatalf("POST access rebound audit=%d->%d outbox=%d->%d", reboundAuditBefore, reboundAuditMid, updatedOutboxBefore, updatedOutboxMid)
	}
	if err := env.fileSvc.RecordFileAccessLost(ctx, env.peer.ID, env.wsA.ID, fileID, connB2.ID); err != nil {
		t.Fatalf("RecordFileAccessLost peer connB2: %v", err)
	}
	var reboundAuditPreLink, updatedOutboxPreLink int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.rebound' AND resource_id = $2`, env.org.ID, fileID).Scan(&reboundAuditPreLink)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updatedOutboxPreLink)
	linkRebound, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connB.ID,
		ExternalFileIDs: []string{"ext-override-1"},
	})
	if err != nil || len(linkRebound) != 1 || linkRebound[0].Outcome != DriveFileLinkOutcomeLinked || linkRebound[0].File.ViewerAccountEmail != "b1@example.com" {
		t.Fatalf("Link lost bound_by diff conn = %+v, err=%v", linkRebound, err)
	}
	afterLinkRebound, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil || afterLinkRebound.ConnectionID != connB.ID || afterLinkRebound.BoundAccountEmail != "b1@example.com" || afterLinkRebound.AccessLostAt != nil || afterLinkRebound.ViewerAccountEmail != "b1@example.com" {
		t.Fatalf("Get after Link rebound = %+v, err=%v", afterLinkRebound, err)
	}
	var reboundAuditAfter, updatedOutboxAfter int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.rebound' AND resource_id = $2`, env.org.ID, fileID).Scan(&reboundAuditAfter)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updatedOutboxAfter)
	if reboundAuditAfter != reboundAuditPreLink+1 || updatedOutboxAfter != updatedOutboxPreLink+1 {
		t.Fatalf("Link rebound audit=%d->%d outbox=%d->%d", reboundAuditPreLink, reboundAuditAfter, updatedOutboxPreLink, updatedOutboxAfter)
	}

	// 8 (F11). Transient error control, non-bound ACL loss (only caller row lost, no access_lost_at or drive_file.updated),
	// and bound ACL loss (sets access_lost_at + emits workspace drive_file.updated).
	var lostAudit0, accOutbox0, updOutbox0 int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.access_lost' AND resource_id = $2`, env.org.ID, fileID).Scan(&lostAudit0)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.access_changed' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&accOutbox0)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updOutbox0)

	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimePlainText},
		MediaByToken: overrideMedia,
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-a1": {Status: http.StatusServiceUnavailable, Reason: "backendError"},
		},
	})
	if _, err := env.contentSvc.ReadForAI(ctx, env.owner.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("transient ReadForAI = %v, want ErrDriveUnavailable", err)
	}
	var lostAudit1, accOutbox1, updOutbox1 int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.access_lost' AND resource_id = $2`, env.org.ID, fileID).Scan(&lostAudit1)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.access_changed' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&accOutbox1)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updOutbox1)
	if lostAudit1 != lostAudit0 || accOutbox1 != accOutbox0 || updOutbox1 != updOutbox0 {
		t.Fatalf("transient error mutated state: audit %d->%d acc %d->%d upd %d->%d", lostAudit0, lostAudit1, accOutbox0, accOutbox1, updOutbox0, updOutbox1)
	}

	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimePlainText},
		MediaByToken: overrideMedia,
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-a1": {Status: http.StatusForbidden, Reason: "insufficientFilePermissions"},
		},
	})
	if _, err := env.contentSvc.ReadForAI(ctx, env.owner.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("non-bound ACL loss ReadForAI = %v, want ErrDriveFileNotAccessible", err)
	}
	ownerAfterNonBoundLoss, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, fileID)
	if err != nil || ownerAfterNonBoundLoss.ViewerAccess != DriveViewerAccessLost || ownerAfterNonBoundLoss.AccessLostAt != nil {
		t.Fatalf("owner Get after non-bound loss = %+v, err=%v", ownerAfterNonBoundLoss, err)
	}
	var lostAudit2, accOutbox2, updOutbox2 int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.access_lost' AND resource_id = $2`, env.org.ID, fileID).Scan(&lostAudit2)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.access_changed' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&accOutbox2)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updOutbox2)
	if lostAudit2 != lostAudit1+1 || accOutbox2 != accOutbox1+1 || updOutbox2 != updOutbox1 {
		t.Fatalf("non-bound loss events: audit %d->%d acc %d->%d upd %d->%d (want upd unchanged)", lostAudit1, lostAudit2, accOutbox1, accOutbox2, updOutbox1, updOutbox2)
	}

	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-override-1", Name: "Tài liệu kiến trúc", MimeType: DriveMimePlainText},
		MediaByToken: overrideMedia,
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-a-sub-b1": {Status: http.StatusNotFound, Reason: "notFound"},
		},
	})
	if _, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("bound ACL loss ReadForAI = %v, want ErrDriveFileNotAccessible", err)
	}
	peerAfterBoundLoss, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil || peerAfterBoundLoss.ViewerAccess != DriveViewerAccessLost || peerAfterBoundLoss.AccessLostAt == nil {
		t.Fatalf("peer Get after bound loss = %+v, err=%v, want lost with AccessLostAt!=nil", peerAfterBoundLoss, err)
	}
	var lostAudit3, accOutbox3, updOutbox3 int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_file.access_lost' AND resource_id = $2`, env.org.ID, fileID).Scan(&lostAudit3)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.access_changed' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&accOutbox3)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, fileID).Scan(&updOutbox3)
	if lostAudit3 != lostAudit2+1 || accOutbox3 != accOutbox2+1 || updOutbox3 != updOutbox2+1 {
		t.Fatalf("bound loss events: audit %d->%d acc %d->%d upd %d->%d (want all +1)", lostAudit2, lostAudit3, accOutbox2, accOutbox3, updOutbox2, updOutbox3)
	}
}

func TestDriveFileVisibilityGateGrantAccessAndUnlinkReLink(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	connA := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-vis-a", "vis-a@example.com")
	connB := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-vis-b", "vis-b@example.com")

	env.googleSrv.SetFile("ext-vis-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-vis-1",
			Name:     "Báo cáo mật",
			MimeType: DriveMimeGoogleDoc,
		},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Nội dung báo cáo"),
		},
	})

	// Owner links file without any task.
	res, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA.ID,
		ExternalFileIDs: []string{"ext-vis-1"},
	})
	if err != nil || len(res) != 1 {
		t.Fatalf("Link = %+v, err=%v", res, err)
	}
	fileID := res[0].File.ID

	// Peer has no drive_file_access row and file is linked to 0 tasks -> Get, GrantAccess, History, ReadForAI all return 404.
	if _, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer Get on unattached file = %v, want ErrNotFound", err)
	}
	if _, err := env.fileSvc.GrantAccess(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer GrantAccess on unattached file = %v, want ErrNotFound", err)
	}
	if err := env.fileSvc.AuthorizeDriveFileHistory(ctx, env.peer.ID, env.wsA.ID, fileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer AuthorizeDriveFileHistory on unattached file = %v, want ErrNotFound", err)
	}
	if _, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotFound) {
		t.Fatalf("peer ReadForAI on unattached file = %v, want ErrDriveFileNotFound", err)
	}

	// Create two tasks: taskHidden (hidden from peer by TaskAccessPolicy) and taskVisible (visible to peer).
	taskHidden, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{Title: "Hidden Task"})
	if err != nil {
		t.Fatalf("Create taskHidden: %v", err)
	}
	taskVisible, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{Title: "Visible Task"})
	if err != nil {
		t.Fatalf("Create taskVisible: %v", err)
	}
	env.fileSvc.SetTaskAccessPolicy(DriveTaskAccessPolicy{
		CanViewTask: func(_ context.Context, userID string, _ db.WorkspaceMember, taskID string) bool {
			if userID == env.peer.ID && taskID == taskHidden.ID {
				return false
			}
			return true
		},
	})

	// Link file to taskHidden -> peer still cannot view taskHidden, so Get still 404s.
	hidID := taskHidden.ID
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA.ID,
		ExternalFileIDs: []string{"ext-vis-1"},
		TaskID:          &hidID,
	}); err != nil {
		t.Fatalf("Link to taskHidden: %v", err)
	}
	if _, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer Get with only hidden task = %v, want ErrNotFound", err)
	}

	// Link file to taskVisible -> peer can now view the file, sees UsedInCount=1 (only taskVisible), viewer_access=unknown.
	visID := taskVisible.ID
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA.ID,
		ExternalFileIDs: []string{"ext-vis-1"},
		TaskID:          &visID,
	}); err != nil {
		t.Fatalf("Link to taskVisible: %v", err)
	}
	peerDetail, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID)
	if err != nil {
		t.Fatalf("peer Get with visible task: %v", err)
	}
	if peerDetail.ViewerAccess != DriveViewerAccessUnknown || peerDetail.CanAsk || peerDetail.CanPropose || peerDetail.UsedInCount != 1 || peerDetail.UsedInTasks[0].TaskID != taskVisible.ID {
		t.Fatalf("peerDetail = %+v", peerDetail)
	}
	// Owner sees both tasks (UsedInCount=2).
	ownerDetail, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, fileID)
	if err != nil || ownerDetail.UsedInCount != 2 {
		t.Fatalf("ownerDetail UsedInCount = %d, err=%v", ownerDetail.UsedInCount, err)
	}

	// Peer calling ReadForAI before granting access gets ErrDriveAccessRequired (409), not 404.
	if _, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveAccessRequired) {
		t.Fatalf("peer ReadForAI before GrantAccess = %v, want ErrDriveAccessRequired", err)
	}

	// Remove from taskVisible -> peer loses visibility again (404).
	if err := env.fileSvc.RemoveFromTask(ctx, Human(env.owner.ID), taskVisible.ID, fileID); err != nil {
		t.Fatalf("RemoveFromTask: %v", err)
	}
	if _, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, fileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer Get after RemoveFromTask = %v, want ErrNotFound", err)
	}

	// Re-attach to taskVisible, peer grants access via GrantAccess (POST .../access), then reads via ReadForAI using peer's own connection.
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA.ID,
		ExternalFileIDs: []string{"ext-vis-1"},
		TaskID:          &visID,
	}); err != nil {
		t.Fatalf("re-Link to taskVisible: %v", err)
	}
	grantedView, err := env.fileSvc.GrantAccess(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID)
	if err != nil || grantedView.ViewerAccess != DriveViewerAccessGranted || !grantedView.CanAsk || !grantedView.CanPropose || grantedView.ViewerAccountEmail != "vis-b@example.com" {
		t.Fatalf("peer GrantAccess = %+v, err=%v", grantedView, err)
	}
	// Idempotent second POST GrantAccess returns 200 with kept account.
	idempView, err := env.fileSvc.GrantAccess(ctx, Human(env.peer.ID), env.wsA.ID, fileID, connB.ID)
	if err != nil || idempView.ViewerAccountEmail != "vis-b@example.com" {
		t.Fatalf("idempotent GrantAccess = %+v, err=%v", idempView, err)
	}

	content, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni)
	if err != nil || content.GoogleEmail != "vis-b@example.com" || content.Text != "# Nội dung báo cáo" {
		t.Fatalf("peer ReadForAI after GrantAccess = %+v, err=%v", content, err)
	}
	callsBeforeGate := len(env.googleSrv.Calls())
	env.fileSvc.SetFlags(driveConnectorFlags(t, false))
	if _, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("ReadForAI with flag off = %v, want ErrDriveUnavailable", err)
	}
	env.fileSvc.SetFlags(driveConnectorFlags(t, true))
	env.svc.SetProvider(nil)
	if _, err := env.contentSvc.ReadForAI(ctx, env.peer.ID, env.wsA.ID, fileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("ReadForAI with provider unconfigured = %v, want ErrDriveUnavailable", err)
	}
	if gotCalls := len(env.googleSrv.Calls()) - callsBeforeGate; gotCalls != 0 {
		t.Fatalf("Google calls while flag off / provider unconfigured = %d, want 0", gotCalls)
	}
	env.svc.SetProvider(env.fake)

	// Unlink soft-deletes the file and removes all task links; re-linking the same external_file_id creates a new active row.
	if err := env.fileSvc.Unlink(ctx, Human(env.owner.ID), env.wsA.ID, fileID); err != nil {
		t.Fatalf("Unlink: %v", err)
	}
	cardsAfterUnlink, err := env.fileSvc.ListForTask(ctx, Human(env.owner.ID), taskVisible.ID)
	if err != nil || len(cardsAfterUnlink) != 0 {
		t.Fatalf("ListForTask after Unlink = %+v, err=%v", cardsAfterUnlink, err)
	}
	relinked, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connA.ID,
		ExternalFileIDs: []string{"ext-vis-1"},
	})
	if err != nil || len(relinked) != 1 || relinked[0].Outcome != DriveFileLinkOutcomeLinked || relinked[0].File.ID == fileID {
		t.Fatalf("re-Link after Unlink = %+v, err=%v", relinked, err)
	}
}

func TestCreateTaskWithDriveFilesAtomicRollback(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	connA := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-tc-a", "tc-a@example.com")
	env.googleSrv.SetFile("ext-tc-ok", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-tc-ok",
			Name:     "OK File",
			MimeType: DriveMimeGoogleDoc,
		},
	})

	// 0 (F07). A workspace guest with an organization Drive connection is refused
	// when creating a task with drive_files (ErrForbidden, nothing written), while
	// plain task creation without drive_files remains unchanged.
	as := NewAuthService(env.pool, env.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	guestUser := registerVerified(t, env.q, as, "drive-tc-guest-"+util.NewID()+"@example.com", "TC Guest")
	addOrgMember(t, env.q, env.org.ID, guestUser.ID)
	env.guests[guestUser.ID] = true
	connGuest := env.connectAccount(t, guestUser.ID, env.wsA.ID, "sub-tc-guest", "tc-guest@example.com")
	var tasksBeforeGuest, filesBeforeGuest int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, env.wsA.ID).Scan(&tasksBeforeGuest)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_files WHERE workspace_id = $1`, env.wsA.ID).Scan(&filesBeforeGuest)
	_, err := env.taskSvc.Create(ctx, Human(guestUser.ID), env.wsA.ID, CreateTaskInput{
		Title: "Guest Task With Drive",
		DriveFiles: []CreateTaskDriveFileInput{
			{ConnectionID: connGuest.ID, ExternalFileID: "ext-tc-ok"},
		},
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest Create with DriveFiles = %v, want ErrForbidden", err)
	}
	var tasksAfterGuest, filesAfterGuest int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, env.wsA.ID).Scan(&tasksAfterGuest)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_files WHERE workspace_id = $1`, env.wsA.ID).Scan(&filesAfterGuest)
	if tasksAfterGuest != tasksBeforeGuest || filesAfterGuest != filesBeforeGuest {
		t.Fatalf("guest Create with DriveFiles wrote rows: tasks %d->%d, files %d->%d", tasksBeforeGuest, tasksAfterGuest, filesBeforeGuest, filesAfterGuest)
	}
	plainGuestTask, err := env.taskSvc.Create(ctx, Human(guestUser.ID), env.wsA.ID, CreateTaskInput{Title: "Guest Plain Task"})
	if err != nil {
		t.Fatalf("guest plain Create without DriveFiles: %v", err)
	}
	if err := env.taskSvc.Delete(ctx, env.owner.ID, plainGuestTask.ID); err != nil {
		t.Fatalf("cleanup plainGuestTask: %v", err)
	}

	// 1 (F13). Atomic rollback when the second Drive file is not accessible on Google Drive:
	// counts tasks, all three Drive tables, audit_events, and outbox_events before/after and asserts no new rows.
	snapshotCounts := func() [6]int {
		var c [6]int
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE organization_id = $1 AND workspace_id = $2`, env.org.ID, env.wsA.ID).Scan(&c[0])
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_files WHERE organization_id = $1 AND workspace_id = $2`, env.org.ID, env.wsA.ID).Scan(&c[1])
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_access WHERE organization_id = $1 AND workspace_id = $2`, env.org.ID, env.wsA.ID).Scan(&c[2])
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE organization_id = $1 AND workspace_id = $2`, env.org.ID, env.wsA.ID).Scan(&c[3])
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND workspace_id = $2`, env.org.ID, env.wsA.ID).Scan(&c[4])
		_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE workspace_id = $1`, env.wsA.ID).Scan(&c[5])
		return c
	}
	beforeRollback := snapshotCounts()
	_, err = env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{
		Title: "Task Rollback Test",
		DriveFiles: []CreateTaskDriveFileInput{
			{ConnectionID: connA.ID, ExternalFileID: "ext-tc-ok"},
			{ConnectionID: connA.ID, ExternalFileID: "ext-tc-missing"},
		},
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_file_not_accessible" {
		t.Fatalf("Create with missing 2nd DriveFile = %v, want 404 drive_file_not_accessible", err)
	}
	if ce.Fields["drive_files_index"] != 1 || ce.Fields["external_file_id"] != "ext-tc-missing" {
		t.Fatalf("error fields = %+v", ce.Fields)
	}
	afterRollback := snapshotCounts()
	if afterRollback != beforeRollback {
		t.Fatalf("atomic rollback left rows: before=%v after=%v (tasks, drive_files, drive_file_access, drive_file_task_links, audit_events, outbox_events)", beforeRollback, afterRollback)
	}
	mine, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil || mine.TotalCount != 0 || len(mine.Files) != 0 {
		t.Fatalf("ListMine after rollback = %+v, err=%v", mine, err)
	}

	// 2. Success when all DriveFiles succeed.
	createdTask, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{
		Title: "Task Drive Success",
		DriveFiles: []CreateTaskDriveFileInput{
			{ConnectionID: connA.ID, ExternalFileID: "ext-tc-ok"},
		},
	})
	if err != nil {
		t.Fatalf("Create with valid DriveFiles: %v", err)
	}
	cards, err := env.fileSvc.ListForTask(ctx, Human(env.owner.ID), createdTask.ID)
	if err != nil || len(cards) != 1 || cards[0].ExternalFileID != "ext-tc-ok" {
		t.Fatalf("ListForTask on created task = %+v, err=%v", cards, err)
	}
	// 3 (F09 + UNI-2171 trash). Single and batch task deletion (Trash) keep the
	// task's drive_file_task_links rows so Restore brings them back with no relink,
	// while Drive reads (Get, ListMine, ListForTask, and the task-link visibility
	// gate) skip trashed tasks; only Purge removes drive_file_task_links and emits
	// drive_file.updated while retaining drive_files and drive_file_access rows.
	driveFileID := cards[0].ID
	batchTask1, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{
		Title:      "Batch Delete Drive 1",
		DriveFiles: []CreateTaskDriveFileInput{{ConnectionID: connA.ID, ExternalFileID: "ext-tc-ok"}},
	})
	if err != nil {
		t.Fatalf("Create batchTask1: %v", err)
	}
	batchTask2, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{
		Title:      "Batch Delete Drive 2",
		DriveFiles: []CreateTaskDriveFileInput{{ConnectionID: connA.ID, ExternalFileID: "ext-tc-ok"}},
	})
	if err != nil {
		t.Fatalf("Create batchTask2: %v", err)
	}
	if peerDetail, perr := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, driveFileID); perr != nil || peerDetail.UsedInCount != 3 {
		t.Fatalf("peer Get with 3 live tasks = %+v, err=%v, want UsedInCount=3", peerDetail, perr)
	}
	var updatedOutboxBefore int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, driveFileID).Scan(&updatedOutboxBefore)
	if err := env.taskSvc.Delete(ctx, env.owner.ID, createdTask.ID); err != nil {
		t.Fatalf("Delete createdTask: %v", err)
	}
	var singleLinkCount int
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE task_id = $1`, createdTask.ID).Scan(&singleLinkCount); err != nil || singleLinkCount != 1 {
		t.Fatalf("singleLinkCount after Delete (trash) = %d, err=%v, want 1", singleLinkCount, err)
	}
	if _, err := env.fileSvc.ListForTask(ctx, Human(env.owner.ID), createdTask.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ListForTask on trashed createdTask = %v, want ErrNotFound", err)
	}
	if afterSingleTrash, gerr := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, driveFileID); gerr != nil || afterSingleTrash.UsedInCount != 2 || len(afterSingleTrash.UsedInTasks) != 2 {
		t.Fatalf("Get after single task trash = %+v, err=%v, want UsedInCount=2", afterSingleTrash, gerr)
	}
	if n, err := env.taskSvc.BatchDeleteTasks(ctx, Human(env.owner.ID), env.wsA.ID, []string{batchTask1.ID, batchTask2.ID}); err != nil || n != 2 {
		t.Fatalf("BatchDeleteTasks = %d, err=%v, want 2", n, err)
	}
	var totalLinkCount int
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE drive_file_id = $1`, driveFileID).Scan(&totalLinkCount); err != nil || totalLinkCount != 3 {
		t.Fatalf("totalLinkCount after single+batch trash = %d, err=%v, want 3", totalLinkCount, err)
	}
	trashedDetail, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, driveFileID)
	if err != nil || trashedDetail.UsedInCount != 0 || len(trashedDetail.UsedInTasks) != 0 {
		t.Fatalf("Get while all linked tasks trashed = %+v, err=%v, want UsedInCount=0", trashedDetail, err)
	}
	trashedMine, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil || len(trashedMine.Files) != 1 || trashedMine.Files[0].UsedInCount != 0 || len(trashedMine.Files[0].UsedInTasks) != 0 {
		t.Fatalf("ListMine while all linked tasks trashed = %+v, err=%v, want UsedInCount=0", trashedMine, err)
	}
	if _, perr := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, driveFileID); !errors.Is(perr, ErrNotFound) {
		t.Fatalf("peer Get while all linked tasks trashed = %v, want ErrNotFound", perr)
	}

	// Restore brings the tasks and their Drive links back with no relink.
	if _, err := env.taskSvc.Restore(ctx, Human(env.owner.ID), createdTask.ID); err != nil {
		t.Fatalf("Restore createdTask: %v", err)
	}
	restoredCards, err := env.fileSvc.ListForTask(ctx, Human(env.owner.ID), createdTask.ID)
	if err != nil || len(restoredCards) != 1 || restoredCards[0].ID != driveFileID {
		t.Fatalf("ListForTask after Restore(createdTask) = %+v, err=%v", restoredCards, err)
	}
	if peerRestored, perr := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, driveFileID); perr != nil || peerRestored.UsedInCount != 1 || peerRestored.UsedInTasks[0].TaskID != createdTask.ID {
		t.Fatalf("peer Get after Restore(createdTask) = %+v, err=%v, want UsedInCount=1", peerRestored, perr)
	}
	if _, err := env.taskSvc.Restore(ctx, Human(env.owner.ID), batchTask1.ID); err != nil {
		t.Fatalf("Restore batchTask1 batch: %v", err)
	}
	restoredMine, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil || len(restoredMine.Files) != 1 || restoredMine.Files[0].UsedInCount != 3 || len(restoredMine.Files[0].UsedInTasks) != 3 {
		t.Fatalf("ListMine after Restore all = %+v, err=%v, want UsedInCount=3", restoredMine, err)
	}

	// Trash again and Purge: Purge deletes drive_file_task_links and emits drive_file.updated.
	if err := env.taskSvc.Delete(ctx, env.owner.ID, createdTask.ID); err != nil {
		t.Fatalf("re-Delete createdTask: %v", err)
	}
	if err := env.taskSvc.Purge(ctx, Human(env.owner.ID), createdTask.ID); err != nil {
		t.Fatalf("Purge createdTask: %v", err)
	}
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE task_id = $1`, createdTask.ID).Scan(&singleLinkCount); err != nil || singleLinkCount != 0 {
		t.Fatalf("singleLinkCount after Purge = %d, err=%v, want 0", singleLinkCount, err)
	}
	if n, err := env.taskSvc.BatchDeleteTasks(ctx, Human(env.owner.ID), env.wsA.ID, []string{batchTask1.ID, batchTask2.ID}); err != nil || n != 2 {
		t.Fatalf("re-BatchDeleteTasks = %d, err=%v, want 2", n, err)
	}
	if err := env.taskSvc.Purge(ctx, Human(env.owner.ID), batchTask1.ID); err != nil {
		t.Fatalf("Purge batchTask1: %v", err)
	}
	if err := env.taskSvc.Purge(ctx, Human(env.owner.ID), batchTask2.ID); err != nil {
		t.Fatalf("Purge batchTask2: %v", err)
	}
	if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE drive_file_id = $1`, driveFileID).Scan(&totalLinkCount); err != nil || totalLinkCount != 0 {
		t.Fatalf("totalLinkCount after Purge all = %d, err=%v, want 0", totalLinkCount, err)
	}
	var updatedOutboxAfter int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, driveFileID).Scan(&updatedOutboxAfter)
	if updatedOutboxAfter-updatedOutboxBefore < 3 {
		t.Fatalf("drive_file.updated outbox events = %d->%d, want +3", updatedOutboxBefore, updatedOutboxAfter)
	}
	retainedDetail, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, driveFileID)
	if err != nil || retainedDetail.UsedInCount != 0 || retainedDetail.ViewerAccess != DriveViewerAccessGranted {
		t.Fatalf("retainedDetail after task purges = %+v, err=%v", retainedDetail, err)
	}

	// Verify flag off returns 404 feature_disabled.
	env.fileSvc.SetFlags(driveConnectorFlags(t, false))
	_, err = env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "feature_disabled" {
		t.Fatalf("ListMine with flag off = %v, want 404 feature_disabled", err)
	}
}

// TestDriveFilePrincipalIsolationGuestAndDeactivatedMember covers F12:
// 1. Admin ListMine sees only the caller's own rows when foreign rows exist in the workspace.
// 2. Workspace guest reads the Drive card on a readable task (default policy) and is refused Link/RemoveFromTask/Unlink/Rebind.
// 3. Deactivated organization member is refused on all Drive read and write entry points (with before and after controls).
func TestDriveFilePrincipalIsolationGuestAndDeactivatedMember(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	as := NewAuthService(env.pool, env.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	adminEmpty := registerVerified(t, env.q, as, "drive-admin-empty-"+util.NewID()+"@example.com", "Admin Empty")
	addOrgMember(t, env.q, env.org.ID, adminEmpty.ID)
	addWorkspaceMember(t, env.q, env.wsA.ID, adminEmpty.ID)
	if _, err := env.ws.UpdateMemberRole(ctx, env.owner.ID, env.wsA.ID, env.peer.ID, "admin"); err != nil {
		t.Fatalf("promote peer to admin: %v", err)
	}
	if _, err := env.ws.UpdateMemberRole(ctx, env.owner.ID, env.wsA.ID, adminEmpty.ID, "admin"); err != nil {
		t.Fatalf("promote adminEmpty to admin: %v", err)
	}

	guest := registerVerified(t, env.q, as, "drive-guest-"+util.NewID()+"@example.com", "Guest")
	addOrgMember(t, env.q, env.org.ID, guest.ID)
	env.guests[guest.ID] = true

	deact := registerVerified(t, env.q, as, "drive-deact-"+util.NewID()+"@example.com", "Deact Member")
	addOrgMember(t, env.q, env.org.ID, deact.ID)
	addWorkspaceMember(t, env.q, env.wsA.ID, deact.ID)

	connOwner := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-f12-owner", "f12-owner@example.com")
	connPeerAdmin := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-f12-peer", "f12-peer@example.com")
	connGuest := env.connectAccount(t, guest.ID, env.wsA.ID, "sub-f12-guest", "f12-guest@example.com")
	connDeact := env.connectAccount(t, deact.ID, env.wsA.ID, "sub-f12-deact", "f12-deact@example.com")

	env.googleSrv.SetFile("ext-f12-owner-only", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-f12-owner-only", Name: "Owner Secret Doc", MimeType: DriveMimePlainText},
		DefaultMedia: []byte("owner secret"),
	})
	env.googleSrv.SetFile("ext-f12-shared", FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: "ext-f12-shared", Name: "Team Shared Doc", MimeType: DriveMimePlainText},
		DefaultMedia: []byte("team shared body"),
	})

	taskReadable, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{Title: "Readable Task"})
	if err != nil {
		t.Fatalf("Create taskReadable: %v", err)
	}
	taskID := taskReadable.ID
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connOwner.ID, ExternalFileIDs: []string{"ext-f12-owner-only"},
	}); err != nil {
		t.Fatalf("owner Link owner-only: %v", err)
	}
	sharedLinkRes, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connOwner.ID, ExternalFileIDs: []string{"ext-f12-shared"}, TaskID: &taskID,
	})
	if err != nil || len(sharedLinkRes) != 1 {
		t.Fatalf("owner Link shared: %+v, err=%v", sharedLinkRes, err)
	}
	sharedFileID := sharedLinkRes[0].File.ID
	if _, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connPeerAdmin.ID, ExternalFileIDs: []string{"ext-f12-shared"},
	}); err != nil {
		t.Fatalf("peer admin Link shared: %v", err)
	}

	// 1. Admin ListMine sees only own rows (not owner's ext-f12-owner-only).
	peerMine, err := env.fileSvc.ListMine(ctx, Human(env.peer.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil || peerMine.TotalCount != 1 || len(peerMine.Files) != 1 || peerMine.Files[0].ID != sharedFileID {
		t.Fatalf("admin peer ListMine = %+v, err=%v, want only sharedFileID", peerMine, err)
	}
	emptyAdminMine, err := env.fileSvc.ListMine(ctx, Human(adminEmpty.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil || emptyAdminMine.TotalCount != 0 || len(emptyAdminMine.Files) != 0 {
		t.Fatalf("adminEmpty ListMine = %+v, err=%v, want 0 files", emptyAdminMine, err)
	}

	// 2. Guest reads the card of a readable task (default production policy) and is refused Link/RemoveFromTask/Unlink/Rebind.
	guestCards, err := env.fileSvc.ListForTask(ctx, Human(guest.ID), taskReadable.ID)
	if err != nil || len(guestCards) != 1 || guestCards[0].ID != sharedFileID || guestCards[0].CanRemoveFromTask || guestCards[0].CanAsk || guestCards[0].CanPropose {
		t.Fatalf("guest ListForTask = %+v, err=%v", guestCards, err)
	}
	guestDetail, err := env.fileSvc.Get(ctx, Human(guest.ID), env.wsA.ID, sharedFileID)
	if err != nil || guestDetail.CanUnlink || guestDetail.CanRebind || guestDetail.CanAsk || guestDetail.CanPropose {
		t.Fatalf("guest Get = %+v, err=%v", guestDetail, err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(guest.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connGuest.ID, ExternalFileIDs: []string{"ext-f12-shared"},
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest Link = %v, want ErrForbidden", err)
	}
	if err := env.fileSvc.RemoveFromTask(ctx, Human(guest.ID), taskReadable.ID, sharedFileID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest RemoveFromTask = %v, want ErrForbidden", err)
	}
	if err := env.fileSvc.Unlink(ctx, Human(guest.ID), env.wsA.ID, sharedFileID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest Unlink = %v, want ErrForbidden", err)
	}
	if _, err := env.fileSvc.Rebind(ctx, Human(guest.ID), env.wsA.ID, sharedFileID, connGuest.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest Rebind = %v, want ErrForbidden", err)
	}

	// 3. Deactivated member: before control succeeds, deactivated refused on read/write entry points, after reactivation control succeeds.
	if _, err := env.fileSvc.Link(ctx, Human(deact.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connDeact.ID, ExternalFileIDs: []string{"ext-f12-shared"},
	}); err != nil {
		t.Fatalf("deact before control Link: %v", err)
	}
	if mine, err := env.fileSvc.ListMine(ctx, Human(deact.ID), env.wsA.ID, ListDriveFilesFilter{}); err != nil || mine.TotalCount != 1 {
		t.Fatalf("deact before control ListMine = %+v, err=%v", mine, err)
	}
	if _, err := env.fileSvc.Get(ctx, Human(deact.ID), env.wsA.ID, sharedFileID); err != nil {
		t.Fatalf("deact before control Get: %v", err)
	}
	if _, err := env.contentSvc.ReadForAI(ctx, deact.ID, env.wsA.ID, sharedFileID, DriveContentPurposeAskUni); err != nil {
		t.Fatalf("deact before control ReadForAI: %v", err)
	}

	if _, err := env.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, env.org.ID, deact.ID); err != nil {
		t.Fatalf("deactivate member: %v", err)
	}
	if _, err := env.fileSvc.ListMine(ctx, Human(deact.ID), env.wsA.ID, ListDriveFilesFilter{}); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact ListMine = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.Get(ctx, Human(deact.ID), env.wsA.ID, sharedFileID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact Get = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.ListForTask(ctx, Human(deact.ID), taskReadable.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact ListForTask = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(deact.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connDeact.ID, ExternalFileIDs: []string{"ext-f12-shared"},
	}); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact Link = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.GrantAccess(ctx, Human(deact.ID), env.wsA.ID, sharedFileID, connDeact.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact GrantAccess = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.ChangeReadAccount(ctx, Human(deact.ID), env.wsA.ID, sharedFileID, connDeact.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact ChangeReadAccount = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.Rebind(ctx, Human(deact.ID), env.wsA.ID, sharedFileID, connDeact.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact Rebind = %v, want ErrMemberDeactivated", err)
	}
	if err := env.fileSvc.Unlink(ctx, Human(deact.ID), env.wsA.ID, sharedFileID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact Unlink = %v, want ErrMemberDeactivated", err)
	}
	if err := env.fileSvc.RemoveFromTask(ctx, Human(deact.ID), taskReadable.ID, sharedFileID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact RemoveFromTask = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.fileSvc.PickerToken(ctx, Human(deact.ID), env.wsA.ID, connDeact.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact PickerToken = %v, want ErrMemberDeactivated", err)
	}
	if err := env.fileSvc.AuthorizeDriveFileHistory(ctx, deact.ID, env.wsA.ID, sharedFileID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact AuthorizeDriveFileHistory = %v, want ErrMemberDeactivated", err)
	}
	if err := env.fileSvc.AuthorizeDriveConnectionHistory(ctx, deact.ID, env.wsA.ID, connDeact.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact AuthorizeDriveConnectionHistory = %v, want ErrMemberDeactivated", err)
	}
	if _, err := env.contentSvc.ReadForAI(ctx, deact.ID, env.wsA.ID, sharedFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deact ReadForAI = %v, want ErrMemberDeactivated", err)
	}

	if _, err := env.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`, env.org.ID, deact.ID); err != nil {
		t.Fatalf("reactivate member: %v", err)
	}
	if mine, err := env.fileSvc.ListMine(ctx, Human(deact.ID), env.wsA.ID, ListDriveFilesFilter{}); err != nil || mine.TotalCount != 1 {
		t.Fatalf("deact after reactivation ListMine = %+v, err=%v", mine, err)
	}
	if _, err := env.fileSvc.Get(ctx, Human(deact.ID), env.wsA.ID, sharedFileID); err != nil {
		t.Fatalf("deact after reactivation Get: %v", err)
	}
}

type failingDriveRoundTripper struct {
	t *testing.T
}

func (f failingDriveRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	f.t.Errorf("unexpected outbound HTTP request under DRIVE_FAKE_PROVIDER=1: %s %s", req.Method, req.URL.String())
	return nil, errors.New("outbound HTTP disabled in fake provider test")
}

func TestDriveFakeProviderInMemoryFilesGet(t *testing.T) {
	t.Parallel()

	box := testDriveBox(t)
	connSvc := NewDriveConnectionService(nil, nil, nil, box)
	connSvc.ConfigureOAuth(config.Config{
		AppEnv:            "development",
		DriveFakeProvider: true,
	})
	fileSvc := NewDriveFileService(nil, nil, nil, connSvc, nil)
	fileSvc.api.httpClient.Transport = failingDriveRoundTripper{t: t}

	accEnc, err := connSvc.sealSecret("fake-access-token")
	if err != nil {
		t.Fatal(err)
	}
	conn := db.DriveConnection{
		ID:              "01J8X4FAKECONN000000000001",
		AccessTokenEnc:  accEnc,
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
	}

	extID := "ext-fake-doc-seed-01"
	meta, err := fileSvc.api.FilesGetWithConnection(context.Background(), connSvc, conn, extID)
	if err != nil {
		t.Fatalf("FilesGetWithConnection under DRIVE_FAKE_PROVIDER=1: %v", err)
	}
	wantWebURL := "https://docs.google.com/document/d/" + extID + "/edit"
	if meta.ExternalFileID != extID ||
		meta.Name != extID ||
		meta.MimeType != DriveMimeGoogleDoc ||
		meta.IconKind != "google_doc" ||
		meta.WebViewLink != wantWebURL ||
		meta.OwnerDisplay != "Fake Drive Owner" ||
		meta.SharingState != DriveSharingStateShared ||
		meta.Trashed {
		t.Fatalf("fake FilesGetWithConnection metadata = %+v", meta)
	}
}

func TestDriveFakeProviderLinkAndCreateTaskWithDriveFiles(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	fx.svc.ConfigureOAuth(config.Config{
		AppEnv:            "development",
		DriveFakeProvider: true,
		FrontendOrigin:    "http://localhost:3000",
		APIPublicURL:      "http://localhost:8080",
	})
	fileSvc := NewDriveFileService(fx.pool, fx.q, fx.ws, fx.svc, nil)
	fileSvc.SetFlags(fx.svc.flags)
	fileSvc.api.httpClient.Transport = failingDriveRoundTripper{t: t}

	taskSvc := NewTaskService(fx.pool, fx.q, fx.ws, nil)
	taskSvc.SetDriveFiles(fileSvc)

	refEnc, err := fx.svc.sealSecret("tok-r-fake-link")
	if err != nil {
		t.Fatal(err)
	}
	accEnc, err := fx.svc.sealSecret("tok-a-fake-link")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := fx.q.CreateDriveConnection(ctx, db.CreateDriveConnectionParams{
		ID:              util.NewID(),
		OrganizationID:  fx.org.ID,
		UserID:          fx.user.ID,
		Provider:        "google",
		GoogleSub:       "sub-fake-link-" + util.NewID(),
		GoogleEmail:     "fake-link@example.com",
		RefreshTokenEnc: refEnc,
		AccessTokenEnc:  accEnc,
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
		Scopes:          "openid email " + DriveGoogleScope,
	})
	if err != nil {
		t.Fatalf("CreateDriveConnection: %v", err)
	}

	extLinkID := "ext-fake-link-doc"
	linkRes, err := fileSvc.Link(ctx, Human(fx.user.ID), fx.work.ID, LinkDriveFilesInput{
		ConnectionID:    conn.ID,
		ExternalFileIDs: []string{extLinkID},
	})
	if err != nil || len(linkRes) != 1 || linkRes[0].Outcome != DriveFileLinkOutcomeLinked || linkRes[0].File == nil {
		t.Fatalf("Link under DRIVE_FAKE_PROVIDER=1 = %+v, err=%v", linkRes, err)
	}
	got, err := fileSvc.Get(ctx, Human(fx.user.ID), fx.work.ID, linkRes[0].File.ID)
	if err != nil {
		t.Fatalf("Get linked Drive file: %v", err)
	}
	wantLinkURL := "https://docs.google.com/document/d/" + extLinkID + "/edit"
	if got.ExternalFileID != extLinkID ||
		got.Name != extLinkID ||
		got.MimeType != DriveMimeGoogleDoc ||
		got.IconKind != "google_doc" ||
		got.WebViewLink != wantLinkURL ||
		got.OwnerDisplay != "Fake Drive Owner" ||
		got.SharingState != DriveSharingStateShared {
		t.Fatalf("Link stored metadata = %+v", got)
	}

	extTaskID := "ext-fake-task-doc"
	createdTask, err := taskSvc.Create(ctx, Human(fx.user.ID), fx.work.ID, CreateTaskInput{
		Title: "Fake Drive Task",
		DriveFiles: []CreateTaskDriveFileInput{{
			ConnectionID:   conn.ID,
			ExternalFileID: extTaskID,
		}},
	})
	if err != nil {
		t.Fatalf("CreateTask with DriveFiles under DRIVE_FAKE_PROVIDER=1: %v", err)
	}
	cards, err := fileSvc.ListForTask(ctx, Human(fx.user.ID), createdTask.ID)
	if err != nil || len(cards) != 1 {
		t.Fatalf("ListForTask = %+v, err=%v", cards, err)
	}
	taskFile, err := fileSvc.Get(ctx, Human(fx.user.ID), fx.work.ID, cards[0].ID)
	if err != nil {
		t.Fatalf("Get task Drive file: %v", err)
	}
	wantTaskURL := "https://docs.google.com/document/d/" + extTaskID + "/edit"
	if taskFile.ExternalFileID != extTaskID ||
		taskFile.Name != extTaskID ||
		taskFile.MimeType != DriveMimeGoogleDoc ||
		taskFile.IconKind != "google_doc" ||
		taskFile.WebViewLink != wantTaskURL ||
		taskFile.OwnerDisplay != "Fake Drive Owner" ||
		taskFile.SharingState != DriveSharingStateShared {
		t.Fatalf("CreateTask stored Drive file = %+v", taskFile)
	}
}

// TestDriveFileServiceDefaultFlagEnabled verifies that with a real flag service
// and no DB override, FF_* env, or YAML rule, DriveFileService evaluates
// drive_connector at its catalogue default (true), and refuses with 404
// feature_disabled when FF_DRIVE_CONNECTOR=false.
func TestDriveFileServiceDefaultFlagEnabled(t *testing.T) {
	isolateDriveConnectorFlagSources(t)
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()

	realFlags, _, err := featureflags.NewService(env.q, nil)
	if err != nil {
		t.Fatal(err)
	}
	env.svc.SetFlags(realFlags)
	env.fileSvc.SetFlags(realFlags)

	if _, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{}); err != nil {
		t.Fatalf("ListMine with default flag (no override/env/YAML): %v, want nil", err)
	}

	t.Setenv("FF_DRIVE_CONNECTOR", "false")
	var ce CodedError
	if _, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{}); !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "feature_disabled" {
		t.Fatalf("ListMine with FF_DRIVE_CONNECTOR=false = %v, want 404 feature_disabled", err)
	}
}

// TestDriveFolderParentAndNameFolder (UNI-2221) verifies:
//   - files.get metadata parsing for no parent -> drive_folder = nil,
//     parent id with 404 folder name -> drive_folder = {id, name: nil},
//     and parent id with 200 folder name -> drive_folder = {id, name: "..."}
//   - POST /workspaces/{workspaceID}/drive-folders/{driveFolderID}/name updates
//     drive_folder_name on all active files in the caller's workspace with that
//     parent id, never touches another workspace's rows, refuses 403/404 from
//     Google without altering stored state, refuses another user's connection
//     with 404, and writes drive_folder.named audit + drive_file.updated outbox
//   - when another member's metadata refresh gets 404 on a folder that was
//     already named in the workspace, the stored drive_folder_name is kept;
//     when a refresh gets 200 with a new folder name, it updates the name.
func TestDriveFolderParentAndNameFolder(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()
	wsBView, err := env.ws.CreateInOrg(ctx, env.owner.ID, env.org.ID, "Drive Folder WS B", "drive-fldr-wsb-"+strings.ToLower(util.NewID()[:6]))
	if err != nil {
		t.Fatalf("create wsB: %v", err)
	}
	wsB := wsBView.Workspace
	connOwnerA := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-fldr", "owner-fldr@example.com")
	connPeerA := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-peer-fldr", "peer-fldr@example.com")

	// 1. Metadata parsing: no parent, parent with 404 folder, parent with 200 folder.
	env.googleSrv.SetFile("ext-no-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-no-parent",
			Name:     "Root Doc",
			MimeType: DriveMimeGoogleDoc,
		},
	})
	env.googleSrv.SetFile("ext-unpicked-folder-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-folder-1",
			Name:     "Spec 1",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-unpicked"},
		},
	})
	env.googleSrv.SetFile("ext-unpicked-folder-2", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-folder-2",
			Name:     "Spec 2",
			MimeType: DriveMimeGoogleSheet,
			Parents:  []string{"fld-unpicked"},
		},
	})
	env.googleSrv.SetFile("fld-picked", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-picked",
			Name:     "Picked Folder",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	env.googleSrv.SetFile("ext-picked-folder-file", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-picked-folder-file",
			Name:     "Notes In Picked Folder",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-picked"},
		},
	})

	beforeBatchCalls := len(env.googleSrv.Calls())
	linked, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID: connOwnerA.ID,
		ExternalFileIDs: []string{
			"ext-no-parent",
			"ext-unpicked-folder-1",
			"ext-unpicked-folder-2",
			"ext-picked-folder-file",
		},
	})
	if err != nil || len(linked) != 4 {
		t.Fatalf("Link 4 files = %+v, err=%v", linked, err)
	}
	// F5: 2 children under fld-unpicked + 1 child under fld-picked -> 1 call for fld-unpicked and 1 call for fld-picked (2 total parent calls).
	var unpickedParentCalls, pickedParentCalls int
	for _, c := range env.googleSrv.Calls()[beforeBatchCalls:] {
		switch c.FileID {
		case "fld-unpicked":
			unpickedParentCalls++
		case "fld-picked":
			pickedParentCalls++
		}
	}
	if unpickedParentCalls != 1 || pickedParentCalls != 1 {
		t.Fatalf("Link batch parent calls: fld-unpicked=%d fld-picked=%d, want (1, 1)", unpickedParentCalls, pickedParentCalls)
	}

	fileNoParent, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[0].File.ID)
	if err != nil {
		t.Fatalf("Get fileNoParent: %v", err)
	}
	if fileNoParent.DriveFolder != nil {
		t.Fatalf("fileNoParent.DriveFolder = %+v, want nil", fileNoParent.DriveFolder)
	}

	fileUnpicked1, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[1].File.ID)
	if err != nil {
		t.Fatalf("Get fileUnpicked1: %v", err)
	}
	if fileUnpicked1.DriveFolder == nil || fileUnpicked1.DriveFolder.ID != "fld-unpicked" || fileUnpicked1.DriveFolder.Name != nil {
		t.Fatalf("fileUnpicked1.DriveFolder = %+v, want {ID:fld-unpicked, Name:nil}", fileUnpicked1.DriveFolder)
	}
	if fileUnpicked1.AccessLostAt != nil || fileUnpicked1.ViewerAccess != DriveViewerAccessGranted {
		t.Fatalf("fileUnpicked1 after 404 parent lookup marked access lost: AccessLostAt=%v ViewerAccess=%q", fileUnpicked1.AccessLostAt, fileUnpicked1.ViewerAccess)
	}

	filePicked, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[3].File.ID)
	if err != nil {
		t.Fatalf("Get filePicked: %v", err)
	}
	if filePicked.DriveFolder == nil || filePicked.DriveFolder.ID != "fld-picked" || filePicked.DriveFolder.Name == nil || *filePicked.DriveFolder.Name != "Picked Folder" {
		t.Fatalf("filePicked.DriveFolder = %+v, want {ID:fld-picked, Name:Picked Folder}", filePicked.DriveFolder)
	}

	// Link a file in wsB with the same parent folder id "fld-unpicked" to verify workspace isolation.
	linkedWsB, err := env.fileSvc.Link(ctx, Human(env.owner.ID), wsB.ID, LinkDriveFilesInput{
		ConnectionID:    connOwnerA.ID,
		ExternalFileIDs: []string{"ext-unpicked-folder-1"},
	})
	if err != nil || len(linkedWsB) != 1 || linkedWsB[0].File == nil {
		t.Fatalf("Link in wsB = %+v, err=%v", linkedWsB, err)
	}

	// 2. Refusals on NameFolder:
	// (a) Guest refused with ErrForbidden and makes zero Google calls; foreign connection refused with ErrNotFound and zero Google calls.
	env.guests[env.peer.ID] = true
	beforeGateCalls := len(env.googleSrv.Calls())
	if _, err := env.fileSvc.NameFolder(ctx, Human(env.peer.ID), env.wsA.ID, "fld-unpicked", connPeerA.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("NameFolder as guest = %v, want ErrForbidden", err)
	}
	delete(env.guests, env.peer.ID)
	if _, err := env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connPeerA.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("NameFolder with peer connection = %v, want ErrNotFound", err)
	}
	if gotCalls := len(env.googleSrv.Calls()) - beforeGateCalls; gotCalls != 0 {
		t.Fatalf("NameFolder gate refusals made %d Google calls, want 0", gotCalls)
	}

	// (b) Folder still 404 at Google -> 404 drive_folder_not_found, nothing changed.
	_, err = env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connOwnerA.ID)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_folder_not_found" {
		t.Fatalf("NameFolder 404 at Google = %v (ce=%+v), want 404 drive_folder_not_found", err, ce)
	}
	// (c) Folder 403 insufficientFilePermissions / appNotAuthorizedToFile / domainPolicy at Google -> 404 drive_folder_not_found, nothing changed.
	for _, reason := range []string{"insufficientFilePermissions", "appNotAuthorizedToFile", "domainPolicy"} {
		env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
			DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusForbidden, Reason: reason},
		})
		_, err = env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connOwnerA.ID)
		ce = CodedError{}
		if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_folder_not_found" {
			t.Fatalf("NameFolder 403 (%s) at Google = %v (ce=%+v), want 404 drive_folder_not_found", reason, err, ce)
		}
	}
	// (d) Non-folder MIME, missing MIME, or trashed folder -> 422 drive_folder_not_folder; empty/whitespace name -> 404 drive_folder_not_found.
	for _, badMeta := range []googleDriveFileJSON{
		{ID: "fld-unpicked", Name: "Plain Doc", MimeType: DriveMimeGoogleDoc},
		{ID: "fld-unpicked", Name: "Missing Mime", MimeType: ""},
		{ID: "fld-unpicked", Name: "Trashed Folder", MimeType: DriveMimeGoogleFolder, Trashed: true},
	} {
		env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{Metadata: badMeta})
		_, err = env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connOwnerA.ID)
		ce = CodedError{}
		if !errors.As(err, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != "drive_folder_not_folder" {
			t.Fatalf("NameFolder invalid folder (%+v) = %v (ce=%+v), want 422 drive_folder_not_folder", badMeta, err, ce)
		}
	}
	for _, blankName := range []string{"", "   \t "} {
		env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
			Metadata: googleDriveFileJSON{ID: "fld-unpicked", Name: blankName, MimeType: DriveMimeGoogleFolder},
		})
		_, err = env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connOwnerA.ID)
		ce = CodedError{}
		if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_folder_not_found" {
			t.Fatalf("NameFolder blank name %q = %v (ce=%+v), want 404 drive_folder_not_found", blankName, err, ce)
		}
	}

	// 3. User picks the folder in Google Picker -> Google now returns 200 with name.
	var auditNamedBefore, outboxF1Before, outboxF2Before int
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND workspace_id = $2 AND action = 'drive_folder.named' AND resource_id = 'fld-unpicked'`, env.org.ID, env.wsA.ID).Scan(&auditNamedBefore)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, linked[1].File.ID).Scan(&outboxF1Before)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, linked[2].File.ID).Scan(&outboxF2Before)

	env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-unpicked",
			Name:     "Hồ sơ thiết kế Q4",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	namedRes, err := env.fileSvc.NameFolder(ctx, Human(env.owner.ID), env.wsA.ID, "fld-unpicked", connOwnerA.ID)
	if err != nil {
		t.Fatalf("NameFolder 200: %v", err)
	}
	if namedRes.UpdatedCount != 2 || namedRes.DriveFolder.ID != "fld-unpicked" || namedRes.DriveFolder.Name == nil || *namedRes.DriveFolder.Name != "Hồ sơ thiết kế Q4" {
		t.Fatalf("NameFolder result = %+v, want UpdatedCount=2 Name=Hồ sơ thiết kế Q4", namedRes)
	}
	var auditNamedAfter, outboxF1After, outboxF2After int
	var auditMetaRaw string
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND workspace_id = $2 AND action = 'drive_folder.named' AND resource_id = 'fld-unpicked'`, env.org.ID, env.wsA.ID).Scan(&auditNamedAfter)
	_ = env.pool.QueryRow(ctx, `SELECT metadata::text FROM audit_events WHERE organization_id = $1 AND workspace_id = $2 AND action = 'drive_folder.named' AND resource_id = 'fld-unpicked' ORDER BY created_at DESC LIMIT 1`, env.org.ID, env.wsA.ID).Scan(&auditMetaRaw)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, linked[1].File.ID).Scan(&outboxF1After)
	_ = env.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'drive_file.updated' AND payload::jsonb->>'drive_file_id' = $1`, linked[2].File.ID).Scan(&outboxF2After)
	if auditNamedAfter != auditNamedBefore+1 || outboxF1After != outboxF1Before+1 || outboxF2After != outboxF2Before+1 {
		t.Fatalf("2-file NameFolder audit=%d->%d outbox1=%d->%d outbox2=%d->%d, want +1 each", auditNamedBefore, auditNamedAfter, outboxF1Before, outboxF1After, outboxF2Before, outboxF2After)
	}
	if strings.Contains(auditMetaRaw, "Hồ sơ thiết kế Q4") {
		t.Fatalf("audit metadata leaked folder name: %s", auditMetaRaw)
	}

	// Both files in wsA now report the folder name, while wsB's file remains unnamed.
	after1, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[1].File.ID)
	if err != nil || after1.DriveFolder == nil || after1.DriveFolder.Name == nil || *after1.DriveFolder.Name != "Hồ sơ thiết kế Q4" {
		t.Fatalf("wsA file 1 after NameFolder = %+v, err=%v", after1.DriveFolder, err)
	}
	after2, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[2].File.ID)
	if err != nil || after2.DriveFolder == nil || after2.DriveFolder.Name == nil || *after2.DriveFolder.Name != "Hồ sơ thiết kế Q4" {
		t.Fatalf("wsA file 2 after NameFolder = %+v, err=%v", after2.DriveFolder, err)
	}
	wsBFile, err := env.fileSvc.Get(ctx, Human(env.owner.ID), wsB.ID, linkedWsB[0].File.ID)
	if err != nil || wsBFile.DriveFolder == nil || wsBFile.DriveFolder.Name != nil {
		t.Fatalf("wsB file DriveFolder = %+v (err=%v), want Name=nil (workspace isolated)", wsBFile.DriveFolder, err)
	}

	// 4. Refresh preservation: peer links ext-unpicked-folder-1 with peer's token,
	// where peer's token gets 404 on fld-unpicked. The stored name "Hồ sơ thiết kế Q4"
	// MUST be kept, not wiped to NULL.
	peerToken := "tok-a-sub-peer-fldr"
	env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-unpicked",
			Name:     "Hồ sơ thiết kế Q4",
			MimeType: DriveMimeGoogleFolder,
		},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			peerToken: {Status: http.StatusNotFound, Reason: "notFound"},
		},
	})
	if _, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connPeerA.ID,
		ExternalFileIDs: []string{"ext-unpicked-folder-1"},
	}); err != nil {
		t.Fatalf("peer Link existing file: %v", err)
	}
	// F4: Peer links a brand-new sibling child in wsA under fld-unpicked while peer's token gets 404 on fld-unpicked:
	// the new row copies "Hồ sơ thiết kế Q4" from the active same-workspace sibling.
	env.googleSrv.SetFile("ext-unpicked-folder-3-sibling", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-folder-3-sibling",
			Name:     "Spec 3 Sibling",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-unpicked"},
		},
	})
	linkedSiblingWsA, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connPeerA.ID,
		ExternalFileIDs: []string{"ext-unpicked-folder-3-sibling"},
	})
	if err != nil || len(linkedSiblingWsA) != 1 || linkedSiblingWsA[0].File == nil {
		t.Fatalf("peer Link new sibling in wsA = %+v, err=%v", linkedSiblingWsA, err)
	}
	siblingWsAGot, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, linkedSiblingWsA[0].File.ID)
	if err != nil || siblingWsAGot.DriveFolder == nil || siblingWsAGot.DriveFolder.Name == nil || *siblingWsAGot.DriveFolder.Name != "Hồ sơ thiết kế Q4" {
		t.Fatalf("new sibling in wsA DriveFolder = %+v (err=%v), want inherited name Hồ sơ thiết kế Q4", siblingWsAGot.DriveFolder, err)
	}
	// Cross-workspace check (F4): linking a new child under fld-unpicked in wsB when lookup fails MUST NOT copy wsA's folder name.
	env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusNotFound, Reason: "notFound"},
	})
	env.googleSrv.SetFile("ext-unpicked-wsb-new", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-wsb-new",
			Name:     "WSB New Child",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-unpicked"},
		},
	})
	linkedNewWsB, err := env.fileSvc.Link(ctx, Human(env.owner.ID), wsB.ID, LinkDriveFilesInput{
		ConnectionID:    connOwnerA.ID,
		ExternalFileIDs: []string{"ext-unpicked-wsb-new"},
	})
	if err != nil || len(linkedNewWsB) != 1 || linkedNewWsB[0].File == nil {
		t.Fatalf("Link new child in wsB = %+v, err=%v", linkedNewWsB, err)
	}
	newWsBGot, err := env.fileSvc.Get(ctx, Human(env.owner.ID), wsB.ID, linkedNewWsB[0].File.ID)
	if err != nil || newWsBGot.DriveFolder == nil || newWsBGot.DriveFolder.Name != nil {
		t.Fatalf("new child in wsB inherited cross-workspace folder name: %+v, err=%v", newWsBGot.DriveFolder, err)
	}
	// Unlinked row check (F4): if the only named row for a folder in wsA is unlinked, a new child under that folder when lookup 404s MUST NOT copy the unlinked row's name.
	if err := env.fileSvc.Unlink(ctx, Human(env.owner.ID), env.wsA.ID, linked[3].File.ID); err != nil {
		t.Fatalf("Unlink filePicked: %v", err)
	}
	env.googleSrv.SetFile("fld-picked", FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusNotFound, Reason: "notFound"},
	})
	env.googleSrv.SetFile("ext-picked-after-unlink", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-picked-after-unlink",
			Name:     "Child After Unlink",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-picked"},
		},
	})
	linkedAfterUnlink, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connOwnerA.ID,
		ExternalFileIDs: []string{"ext-picked-after-unlink"},
	})
	if err != nil || len(linkedAfterUnlink) != 1 || linkedAfterUnlink[0].File == nil {
		t.Fatalf("Link after unlink = %+v, err=%v", linkedAfterUnlink, err)
	}
	afterUnlinkGot, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linkedAfterUnlink[0].File.ID)
	if err != nil || afterUnlinkGot.DriveFolder == nil || afterUnlinkGot.DriveFolder.Name != nil {
		t.Fatalf("child linked after sole named sibling was unlinked copied unlinked name: %+v, err=%v", afterUnlinkGot.DriveFolder, err)
	}

	// Restore fld-unpicked 200 for owner and 404 for peer, then age metadata_refreshed_at and trigger opportunistic refresh as peer.
	env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-unpicked",
			Name:     "Hồ sơ thiết kế Q4",
			MimeType: DriveMimeGoogleFolder,
		},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			peerToken: {Status: http.StatusNotFound, Reason: "notFound"},
		},
	})
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, linked[1].File.ID); err != nil {
		t.Fatalf("age metadata_refreshed_at: %v", err)
	}
	peerGot, err := env.fileSvc.Get(ctx, Human(env.peer.ID), env.wsA.ID, linked[1].File.ID)
	if err != nil {
		t.Fatalf("peer Get after stale refresh: %v", err)
	}
	if peerGot.DriveFolder == nil || peerGot.DriveFolder.Name == nil || *peerGot.DriveFolder.Name != "Hồ sơ thiết kế Q4" {
		t.Fatalf("peer refresh with 404 on folder wiped stored folder name: %+v", peerGot.DriveFolder)
	}

	// When owner refreshes and Google returns 200 with a renamed folder, the new name overwrites the old one.
	env.googleSrv.SetFile("fld-unpicked", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-unpicked",
			Name:     "Hồ sơ thiết kế Q4 (Đã đổi tên)",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, linked[1].File.ID); err != nil {
		t.Fatalf("age metadata_refreshed_at for owner rename refresh: %v", err)
	}
	ownerRefreshed, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[1].File.ID)
	if err != nil {
		t.Fatalf("owner Get after folder rename: %v", err)
	}
	if ownerRefreshed.DriveFolder == nil || ownerRefreshed.DriveFolder.Name == nil || *ownerRefreshed.DriveFolder.Name != "Hồ sơ thiết kế Q4 (Đã đổi tên)" {
		t.Fatalf("owner refresh after folder rename = %+v, want Hồ sơ thiết kế Q4 (Đã đổi tên)", ownerRefreshed.DriveFolder)
	}

	// 5. Parent change clears the old name on both UpdateDriveFileMetadata (refresh/link) and Rebind when the new parent is unnamed.
	env.googleSrv.SetFile("ext-unpicked-folder-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-folder-1",
			Name:     "Spec 1 Moved",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-moved-404"},
		},
	})
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, linked[1].File.ID); err != nil {
		t.Fatalf("age metadata_refreshed_at for parent move refresh: %v", err)
	}
	movedRefreshed, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, linked[1].File.ID)
	if err != nil {
		t.Fatalf("owner Get after parent move: %v", err)
	}
	if movedRefreshed.DriveFolder == nil || movedRefreshed.DriveFolder.ID != "fld-moved-404" || movedRefreshed.DriveFolder.Name != nil {
		t.Fatalf("UpdateDriveFileMetadata after parent move kept old name: %+v, want {ID:fld-moved-404, Name:nil}", movedRefreshed.DriveFolder)
	}

	connOwnerA2 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-fldr-2", "owner-fldr2@example.com")
	env.googleSrv.SetFile("ext-unpicked-folder-2", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-unpicked-folder-2",
			Name:     "Spec 2 Rebound Moved",
			MimeType: DriveMimeGoogleSheet,
			Parents:  []string{"fld-rebound-404"},
		},
	})
	reboundView, err := env.fileSvc.Rebind(ctx, Human(env.owner.ID), env.wsA.ID, linked[2].File.ID, connOwnerA2.ID)
	if err != nil {
		t.Fatalf("Rebind after parent move: %v", err)
	}
	if reboundView.DriveFolder == nil || reboundView.DriveFolder.ID != "fld-rebound-404" || reboundView.DriveFolder.Name != nil {
		t.Fatalf("RebindDriveFile after parent move kept old name: %+v, want {ID:fld-rebound-404, Name:nil}", reboundView.DriveFolder)
	}

	// 6. Slow parent (F7): when parent lookup exceeds the child context budget, Link still succeeds and writes the row with unknown folder name.
	env.googleSrv.Client.parentLookupBudget = 50 * time.Millisecond
	defer func() { env.googleSrv.Client.parentLookupBudget = 0 }()
	env.googleSrv.SetOverride(func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "fld-slow-link" {
			<-r.Context().Done()
			return true
		}
		return false
	})
	defer env.googleSrv.SetOverride(nil)
	env.googleSrv.SetFile("ext-slow-parent-child", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-slow-parent-child",
			Name:     "Slow Parent Child",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-slow-link"},
		},
	})
	linkSlowCtx, linkSlowCancel := context.WithTimeout(ctx, 10*time.Second)
	defer linkSlowCancel()
	slowLinked, err := env.fileSvc.Link(linkSlowCtx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connOwnerA.ID,
		ExternalFileIDs: []string{"ext-slow-parent-child"},
	})
	if err != nil || len(slowLinked) != 1 || slowLinked[0].File == nil {
		t.Fatalf("Link with slow parent = %+v, err=%v", slowLinked, err)
	}
	slowGot, err := env.fileSvc.Get(ctx, Human(env.owner.ID), env.wsA.ID, slowLinked[0].File.ID)
	if err != nil || slowGot.DriveFolder == nil || slowGot.DriveFolder.ID != "fld-slow-link" || slowGot.DriveFolder.Name != nil {
		t.Fatalf("Get slowLinked = %+v (err=%v), want {ID:fld-slow-link, Name:nil}", slowGot.DriveFolder, err)
	}
}

// TestListDriveFoldersAggregate (UNI-2221 item 7) verifies:
//   - GET /workspaces/{workspaceID}/drive-folders returns one entry per parent folder
//     Plus {id: nil, name: nil} for files without a parent
//   - ordering: named A-Z (case-insensitive), then unnamed by id, then null id last
//   - sum of file_count equals CountMyDriveFiles (ListMine TotalCount) for the same viewer/filter
//   - another member's files for which the viewer has no drive_file_access row are excluded
//   - another workspace's rows never appear
//   - unknown/foreign drive_connection_id filter returns ErrNotFound (404).
func TestListDriveFoldersAggregate(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()
	wsBView, err := env.ws.CreateInOrg(ctx, env.owner.ID, env.org.ID, "Drive Folder Agg WS B", "drive-agg-wsb-"+strings.ToLower(util.NewID()[:6]))
	if err != nil {
		t.Fatalf("create wsB: %v", err)
	}
	wsB := wsBView.Workspace
	connOwner1 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-agg-1", "owner-agg1@example.com")
	connOwner2 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-agg-2", "owner-agg2@example.com")
	connPeer := env.connectAccount(t, env.peer.ID, env.wsA.ID, "sub-peer-agg", "peer-agg@example.com")

	// Configure folders:
	// - "fld-b" named "Beta Folder" (2 files for owner on connOwner1)
	// - "fld-a" named "alpha folder" (1 file for owner on connOwner2)
	// - "fld-u2" unnamed (404) (1 file for owner on connOwner1)
	// - "fld-u1" unnamed (404) (1 file for owner on connOwner1)
	// - no parent (2 files for owner on connOwner1)
	// - "fld-peer-only" named "Peer Secret Folder" (1 file linked only by peer)
	env.googleSrv.SetFile("fld-b", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-b", Name: "Beta Folder", MimeType: DriveMimeGoogleFolder},
	})
	env.googleSrv.SetFile("fld-a", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-a", Name: "alpha folder", MimeType: DriveMimeGoogleFolder},
	})
	env.googleSrv.SetFile("fld-peer-only", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-peer-only", Name: "Peer Secret Folder", MimeType: DriveMimeGoogleFolder},
	})

	for _, f := range []struct {
		id      string
		parents []string
	}{
		{id: "agg-b-1", parents: []string{"fld-b"}},
		{id: "agg-b-2", parents: []string{"fld-b"}},
		{id: "agg-a-1", parents: []string{"fld-a"}},
		{id: "agg-u2-1", parents: []string{"fld-u2"}},
		{id: "agg-u1-1", parents: []string{"fld-u1"}},
		{id: "agg-root-1", parents: nil},
		{id: "agg-root-2", parents: nil},
		{id: "agg-peer-1", parents: []string{"fld-peer-only"}},
		{id: "agg-wsb-1", parents: []string{"fld-b"}},
	} {
		env.googleSrv.SetFile(f.id, FakeGoogleDriveFile{
			Metadata: googleDriveFileJSON{
				ID:       f.id,
				Name:     "Doc " + f.id,
				MimeType: DriveMimeGoogleDoc,
				Parents:  f.parents,
			},
		})
	}

	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connOwner1.ID,
		ExternalFileIDs: []string{"agg-b-1", "agg-b-2", "agg-u2-1", "agg-u1-1", "agg-root-1", "agg-root-2"},
	}); err != nil {
		t.Fatalf("owner Link conn1: %v", err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connOwner2.ID,
		ExternalFileIDs: []string{"agg-a-1"},
	}); err != nil {
		t.Fatalf("owner Link conn2: %v", err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(env.peer.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    connPeer.ID,
		ExternalFileIDs: []string{"agg-peer-1"},
	}); err != nil {
		t.Fatalf("peer Link: %v", err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), wsB.ID, LinkDriveFilesInput{
		ConnectionID:    connOwner1.ID,
		ExternalFileIDs: []string{"agg-wsb-1"},
	}); err != nil {
		t.Fatalf("owner Link wsB: %v", err)
	}

	// 1. All connections for owner in wsA:
	folders, err := env.fileSvc.ListFolders(ctx, Human(env.owner.ID), env.wsA.ID, "")
	if err != nil {
		t.Fatalf("ListFolders owner wsA: %v", err)
	}
	if len(folders) != 5 {
		t.Fatalf("len(folders) = %d, want 5: %+v", len(folders), folders)
	}
	// Expected order:
	// 0: fld-a ("alpha folder", count=1)
	// 1: fld-b ("Beta Folder", count=2)
	// 2: fld-u1 (nil, count=1)
	// 3: fld-u2 (nil, count=1)
	// 4: nil (nil, count=2)
	if folders[0].ID == nil || *folders[0].ID != "fld-a" || folders[0].Name == nil || *folders[0].Name != "alpha folder" || folders[0].FileCount != 1 {
		t.Fatalf("folders[0] = %+v, want fld-a (alpha folder, 1)", folders[0])
	}
	if folders[1].ID == nil || *folders[1].ID != "fld-b" || folders[1].Name == nil || *folders[1].Name != "Beta Folder" || folders[1].FileCount != 2 {
		t.Fatalf("folders[1] = %+v, want fld-b (Beta Folder, 2)", folders[1])
	}
	if folders[2].ID == nil || *folders[2].ID != "fld-u1" || folders[2].Name != nil || folders[2].FileCount != 1 {
		t.Fatalf("folders[2] = %+v, want fld-u1 (nil, 1)", folders[2])
	}
	if folders[3].ID == nil || *folders[3].ID != "fld-u2" || folders[3].Name != nil || folders[3].FileCount != 1 {
		t.Fatalf("folders[3] = %+v, want fld-u2 (nil, 1)", folders[3])
	}
	if folders[4].ID != nil || folders[4].Name != nil || folders[4].FileCount != 2 {
		t.Fatalf("folders[4] = %+v, want nil (nil, 2)", folders[4])
	}

	var sumAll int64
	for _, g := range folders {
		sumAll += g.FileCount
	}
	listAll, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil {
		t.Fatalf("ListMine owner wsA: %v", err)
	}
	if sumAll != listAll.TotalCount {
		t.Fatalf("sum(file_count) = %d, want ListMine.TotalCount = %d", sumAll, listAll.TotalCount)
	}

	// 2. Filtered by connOwner1:
	foldersConn1, err := env.fileSvc.ListFolders(ctx, Human(env.owner.ID), env.wsA.ID, connOwner1.ID)
	if err != nil {
		t.Fatalf("ListFolders connOwner1: %v", err)
	}
	var sumConn1 int64
	for _, g := range foldersConn1 {
		sumConn1 += g.FileCount
	}
	listConn1, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{ConnectionID: connOwner1.ID})
	if err != nil {
		t.Fatalf("ListMine connOwner1: %v", err)
	}
	if sumConn1 != listConn1.TotalCount || sumConn1 != 6 {
		t.Fatalf("sumConn1 = %d, want ListMine.TotalCount = %d (6)", sumConn1, listConn1.TotalCount)
	}

	// 3. Peer's connection ID or malformed ID -> ErrNotFound (404).
	if _, err := env.fileSvc.ListFolders(ctx, Human(env.owner.ID), env.wsA.ID, connPeer.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ListFolders with peer connection = %v, want ErrNotFound", err)
	}
	if _, err := env.fileSvc.ListFolders(ctx, Human(env.owner.ID), env.wsA.ID, "not-a-valid-conn"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ListFolders with unknown connection = %v, want ErrNotFound", err)
	}
}

// TestValidateDriveFolderFilter (UNI-2221 part C) verifies without a database
// that parseDriveFolderFilter accepts empty (no filter), "none", and Google-id
// shaped values (^[A-Za-z0-9_-]{10,256}$), while rejecting short, malformed, or
// overlong values with a 400 invalid_request CodedError.
func TestValidateDriveFolderFilter(t *testing.T) {
	t.Parallel()

	sqlArg, echo, err := parseDriveFolderFilter("")
	if err != nil || sqlArg.Valid || echo != nil {
		t.Fatalf("empty filter = (%+v, %v, %v), want invalid Text and nil echo", sqlArg, echo, err)
	}

	sqlArg, echo, err = parseDriveFolderFilter("none")
	if err != nil || !sqlArg.Valid || sqlArg.String != "none" || echo == nil || *echo != "none" {
		t.Fatalf("none filter = (%+v, %v, %v), want 'none'", sqlArg, echo, err)
	}

	for _, validID := range []string{
		"fld-http-1",
		"1FldrJ8X4DRV0N1P2Q3R4S5T6U7V8",
		strings.Repeat("a", 256),
	} {
		sqlArg, echo, err = parseDriveFolderFilter(validID)
		if err != nil || !sqlArg.Valid || sqlArg.String != validID || echo == nil || *echo != validID {
			t.Fatalf("valid filter %q = (%+v, %v, %v)", validID, sqlArg, echo, err)
		}
	}

	for _, bad := range []string{
		" ",
		" none ",
		" fld-http-1 ",
		"\tnone\n",
		"x",
		"none2",
		"123456789",
		"a/b",
		"fld-bad/id-123",
		"fld bad space",
		strings.Repeat("a", 257),
	} {
		_, _, err = parseDriveFolderFilter(bad)
		var ve ValidationError
		if !errors.As(err, &ve) || ve.Msg == "" {
			t.Fatalf("bad filter %q err = %T (%v), want ValidationError", bad, err, err)
		}
	}
}

// TestListMineDriveFolderFilter (UNI-2221 part C) verifies on PostgreSQL:
//   - filtering by folder ID returns only that parent's files, filtered TotalCount,
//     echoed DriveFolderID, and cursor pagination with Limit=1 over the filtered set
//   - filtering by "none" returns only parentless files (drive_folder_id IS NULL)
//   - combining drive_folder_id with ConnectionID narrows to files matching both
//   - an unknown well-shaped folder ID returns 200 empty page (TotalCount=0), never 404
//   - bad values ("x", "none2", "a/b") return 400 invalid_request
//   - for every group of ListFolders (including id == nil -> "none"),
//     group.FileCount == ListMine(filter).TotalCount.
func TestListMineDriveFolderFilter(t *testing.T) {
	env := newDriveFilesTestEnv(t)
	ctx := context.Background()
	conn1 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-flt-1", "owner-flt1@example.com")
	conn2 := env.connectAccount(t, env.owner.ID, env.wsA.ID, "sub-owner-flt-2", "owner-flt2@example.com")

	env.googleSrv.SetFile("fld-alpha-01", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-alpha-01", Name: "Alpha Folder", MimeType: DriveMimeGoogleFolder},
	})
	env.googleSrv.SetFile("fld-beta-002", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-beta-002", Name: "Beta Folder", MimeType: DriveMimeGoogleFolder},
	})

	for _, f := range []struct {
		id      string
		parents []string
	}{
		{id: "flt-a-1", parents: []string{"fld-alpha-01"}},
		{id: "flt-a-2", parents: []string{"fld-alpha-01"}},
		{id: "flt-b-1", parents: []string{"fld-beta-002"}},
		{id: "flt-u-1", parents: []string{"fld-unnam-01"}},
		{id: "flt-r-1", parents: nil},
		{id: "flt-r-2", parents: nil},
	} {
		env.googleSrv.SetFile(f.id, FakeGoogleDriveFile{
			Metadata: googleDriveFileJSON{
				ID:       f.id,
				Name:     "Doc " + f.id,
				MimeType: DriveMimeGoogleDoc,
				Parents:  f.parents,
			},
		})
	}

	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    conn1.ID,
		ExternalFileIDs: []string{"flt-a-1", "flt-b-1", "flt-u-1", "flt-r-1"},
	}); err != nil {
		t.Fatalf("Link conn1: %v", err)
	}
	if _, err := env.fileSvc.Link(ctx, Human(env.owner.ID), env.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    conn2.ID,
		ExternalFileIDs: []string{"flt-a-2", "flt-r-2"},
	}); err != nil {
		t.Fatalf("Link conn2: %v", err)
	}

	// 1. Unfiltered ListMine returns all 6 files and DriveFolderID == nil.
	allRes, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if err != nil {
		t.Fatalf("ListMine unfiltered: %v", err)
	}
	if allRes.TotalCount != 6 || len(allRes.Files) != 6 || allRes.DriveFolderID != nil {
		t.Fatalf("ListMine unfiltered = total=%d len=%d folderID=%v, want 6, 6, nil", allRes.TotalCount, len(allRes.Files), allRes.DriveFolderID)
	}

	// 2. Filter by folder ID ("fld-alpha-01") returns only its 2 files, TotalCount=2, DriveFolderID="fld-alpha-01".
	alphaRes, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-alpha-01",
	})
	if err != nil {
		t.Fatalf("ListMine fld-alpha-01: %v", err)
	}
	if alphaRes.TotalCount != 2 || len(alphaRes.Files) != 2 || alphaRes.DriveFolderID == nil || *alphaRes.DriveFolderID != "fld-alpha-01" {
		t.Fatalf("ListMine fld-alpha-01 = %+v, want 2 files and echo fld-alpha-01", alphaRes)
	}
	for _, f := range alphaRes.Files {
		if f.DriveFolder == nil || f.DriveFolder.ID != "fld-alpha-01" {
			t.Fatalf("ListMine fld-alpha-01 returned wrong parent: %+v", f.DriveFolder)
		}
	}

	// 3. Cursor paging over the filtered set with Limit=1 preserves sort order and filtered TotalCount.
	page1, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-alpha-01",
		Limit:         1,
	})
	if err != nil {
		t.Fatalf("ListMine fld-alpha-01 page1: %v", err)
	}
	if page1.TotalCount != 2 || len(page1.Files) != 1 || page1.NextCursor == nil || page1.Files[0].ID != alphaRes.Files[0].ID {
		t.Fatalf("page1 = %+v, want 1st file of alphaRes and non-nil NextCursor", page1)
	}
	page2, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-alpha-01",
		Cursor:        *page1.NextCursor,
		Limit:         1,
	})
	if err != nil {
		t.Fatalf("ListMine fld-alpha-01 page2: %v", err)
	}
	if page2.TotalCount != 2 || len(page2.Files) != 1 || page2.NextCursor != nil || page2.Files[0].ID != alphaRes.Files[1].ID {
		t.Fatalf("page2 = %+v, want 2nd file of alphaRes and nil NextCursor", page2)
	}

	// 4. Filter by "none" returns only parentless files (flt-r-1, flt-r-2).
	noneRes, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "none",
	})
	if err != nil {
		t.Fatalf("ListMine none: %v", err)
	}
	if noneRes.TotalCount != 2 || len(noneRes.Files) != 2 || noneRes.DriveFolderID == nil || *noneRes.DriveFolderID != "none" {
		t.Fatalf("ListMine none = %+v, want 2 files and echo none", noneRes)
	}
	for _, f := range noneRes.Files {
		if f.DriveFolder != nil {
			t.Fatalf("ListMine none returned file with folder: %+v", f.DriveFolder)
		}
	}

	// 5. Combined with ConnectionID narrows to files matching both connection and folder filter.
	alphaConn1, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		ConnectionID:  conn1.ID,
		DriveFolderID: "fld-alpha-01",
	})
	if err != nil {
		t.Fatalf("ListMine conn1 + fld-alpha-01: %v", err)
	}
	if alphaConn1.TotalCount != 1 || len(alphaConn1.Files) != 1 || alphaConn1.Files[0].ExternalFileID != "flt-a-1" {
		t.Fatalf("ListMine conn1 + fld-alpha-01 = %+v, want only flt-a-1", alphaConn1)
	}
	noneConn2, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		ConnectionID:  conn2.ID,
		DriveFolderID: "none",
	})
	if err != nil {
		t.Fatalf("ListMine conn2 + none: %v", err)
	}
	if noneConn2.TotalCount != 1 || len(noneConn2.Files) != 1 || noneConn2.Files[0].ExternalFileID != "flt-r-2" {
		t.Fatalf("ListMine conn2 + none = %+v, want only flt-r-2", noneConn2)
	}

	// 6. Unknown well-shaped folder ID -> 200 empty page, never 404.
	unknownRes, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-unknown-99",
	})
	if err != nil {
		t.Fatalf("ListMine unknown folder ID: %v", err)
	}
	if unknownRes.TotalCount != 0 || len(unknownRes.Files) != 0 || unknownRes.NextCursor != nil || unknownRes.DriveFolderID == nil || *unknownRes.DriveFolderID != "fld-unknown-99" {
		t.Fatalf("ListMine unknown folder ID = %+v, want empty page with echoed id", unknownRes)
	}

	// 7. Bad values ("x", "none2", "a/b") -> 400 invalid_request.
	for _, bad := range []string{"x", "none2", "a/b"} {
		_, berr := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
			DriveFolderID: bad,
		})
		var ve ValidationError
		if !errors.As(berr, &ve) || ve.Msg == "" {
			t.Fatalf("ListMine bad drive_folder_id %q = %T (%v), want ValidationError", bad, berr, berr)
		}
	}

	// 8. For every group of ListFolders (including id == nil -> "none"),
	// group.FileCount == ListMine(filter).TotalCount across both unfiltered and connection-filtered calls.
	for _, cid := range []string{"", conn1.ID, conn2.ID} {
		groups, gerr := env.fileSvc.ListFolders(ctx, Human(env.owner.ID), env.wsA.ID, cid)
		if gerr != nil {
			t.Fatalf("ListFolders(%q): %v", cid, gerr)
		}
		for _, g := range groups {
			folderParam := "none"
			if g.ID != nil {
				folderParam = *g.ID
			}
			filtered, ferr := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
				ConnectionID:  cid,
				DriveFolderID: folderParam,
			})
			if ferr != nil {
				t.Fatalf("ListMine(conn=%q, folder=%q): %v", cid, folderParam, ferr)
			}
			if filtered.TotalCount != g.FileCount || int64(len(filtered.Files)) != g.FileCount {
				t.Fatalf("conn=%q folder=%q: ListFolders.FileCount=%d != ListMine.TotalCount=%d (len=%d)", cid, folderParam, g.FileCount, filtered.TotalCount, len(filtered.Files))
			}
		}
	}

	// 9. Stale metadata on a folder-filtered ListMine call skips opportunistic refresh:
	// returns flt-a-1 with drive_folder.id == fld-alpha-01, total_count unchanged, and
	// does not rewrite the stored drive_files row when the provider reports another parent.
	staleFileID := alphaConn1.Files[0].ID
	env.googleSrv.SetFile("flt-a-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "flt-a-1",
			Name:     "Doc flt-a-1 Moved",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-beta-002"},
		},
	})
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, staleFileID); err != nil {
		t.Fatalf("age metadata_refreshed_at on flt-a-1: %v", err)
	}
	staleAlphaRes, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-alpha-01",
	})
	if err != nil {
		t.Fatalf("ListMine fld-alpha-01 with stale metadata: %v", err)
	}
	if staleAlphaRes.TotalCount != 2 || len(staleAlphaRes.Files) != 2 {
		t.Fatalf("ListMine fld-alpha-01 with stale metadata = total=%d len=%d, want 2, 2", staleAlphaRes.TotalCount, len(staleAlphaRes.Files))
	}
	for _, f := range staleAlphaRes.Files {
		if f.DriveFolder == nil || f.DriveFolder.ID != "fld-alpha-01" {
			t.Fatalf("ListMine fld-alpha-01 with stale metadata file %s drive_folder = %+v, want id=fld-alpha-01", f.ExternalFileID, f.DriveFolder)
		}
	}
	var storedParentID *string
	var stillStale bool
	if err := env.pool.QueryRow(ctx, `SELECT drive_folder_id, metadata_refreshed_at < now() - interval '10 minutes' FROM drive_files WHERE id = $1`, staleFileID).Scan(&storedParentID, &stillStale); err != nil {
		t.Fatalf("query stored drive_files row for flt-a-1: %v", err)
	}
	if storedParentID == nil || *storedParentID != "fld-alpha-01" || !stillStale {
		t.Fatalf("stored row after filtered ListMine = (drive_folder_id=%v, stillStale=%v), want (fld-alpha-01, true)", storedParentID, stillStale)
	}

	// 10. Stale parentless row whose provider still reports no parent stays on the
	// "none" page with its refresh timestamp updated.
	var r1ID, r2ID string
	for _, f := range noneRes.Files {
		switch f.ExternalFileID {
		case "flt-r-1":
			r1ID = f.ID
		case "flt-r-2":
			r2ID = f.ID
		}
	}
	if r1ID == "" || r2ID == "" {
		t.Fatalf("missing parentless file IDs: r1=%q r2=%q", r1ID, r2ID)
	}
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, r1ID); err != nil {
		t.Fatalf("age metadata_refreshed_at on flt-r-1: %v", err)
	}
	noneStillParentless, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "none",
	})
	if err != nil {
		t.Fatalf("ListMine none (still parentless): %v", err)
	}
	if noneStillParentless.TotalCount != 2 || len(noneStillParentless.Files) != 2 || noneStillParentless.DriveFolderID == nil || *noneStillParentless.DriveFolderID != "none" {
		t.Fatalf("ListMine none (still parentless) = %+v, want 2 files and echo none", noneStillParentless)
	}
	for _, f := range noneStillParentless.Files {
		if f.DriveFolder != nil {
			t.Fatalf("ListMine none (still parentless) returned file with folder: %+v", f.DriveFolder)
		}
	}
	if err := env.pool.QueryRow(ctx, `SELECT drive_folder_id, metadata_refreshed_at < now() - interval '10 minutes' FROM drive_files WHERE id = $1`, r1ID).Scan(&storedParentID, &stillStale); err != nil {
		t.Fatalf("query stored drive_files row for flt-r-1: %v", err)
	}
	if storedParentID != nil || stillStale {
		t.Fatalf("stored row for flt-r-1 after ListMine(none) = (drive_folder_id=%v, stillStale=%v), want (nil, false)", storedParentID, stillStale)
	}

	// 11. Stale parentless row whose provider now reports parent fld-alpha-01 is
	// refreshed on ListMine("none"), re-queried out of the "none" page and total_count,
	// keep paging consistent (Limit=1 over two parentless rows where the first gains a
	// parent returns the remaining parentless row with NextCursor == nil and TotalCount == 1),
	// and appears in a subsequent ListMine("fld-alpha-01").
	firstNoneExtID := noneRes.Files[0].ExternalFileID
	firstNoneID := noneRes.Files[0].ID
	secondNoneExtID := noneRes.Files[1].ExternalFileID
	env.googleSrv.SetFile(firstNoneExtID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       firstNoneExtID,
			Name:     "Doc " + firstNoneExtID,
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-alpha-01"},
		},
	})
	if _, err := env.pool.Exec(ctx, `UPDATE drive_files SET metadata_refreshed_at = now() - interval '11 minutes' WHERE id = $1`, firstNoneID); err != nil {
		t.Fatalf("age metadata_refreshed_at on %s: %v", firstNoneExtID, err)
	}
	noneAfterGain, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "none",
		Limit:         1,
	})
	if err != nil {
		t.Fatalf("ListMine none Limit=1 after parent gained: %v", err)
	}
	if noneAfterGain.TotalCount != 1 || len(noneAfterGain.Files) != 1 || noneAfterGain.NextCursor != nil || noneAfterGain.DriveFolderID == nil || *noneAfterGain.DriveFolderID != "none" {
		t.Fatalf("ListMine none Limit=1 after parent gained = %+v, want TotalCount=1 len=1 NextCursor=nil DriveFolderID=none", noneAfterGain)
	}
	if noneAfterGain.Files[0].ExternalFileID != secondNoneExtID || noneAfterGain.Files[0].DriveFolder != nil {
		t.Fatalf("ListMine none Limit=1 remaining file = %+v, want %s with nil DriveFolder", noneAfterGain.Files[0], secondNoneExtID)
	}
	if err := env.pool.QueryRow(ctx, `SELECT drive_folder_id, metadata_refreshed_at < now() - interval '10 minutes' FROM drive_files WHERE id = $1`, firstNoneID).Scan(&storedParentID, &stillStale); err != nil {
		t.Fatalf("query stored drive_files row for %s: %v", firstNoneExtID, err)
	}
	if storedParentID == nil || *storedParentID != "fld-alpha-01" || stillStale {
		t.Fatalf("stored row for %s after ListMine(none) = (drive_folder_id=%v, stillStale=%v), want (fld-alpha-01, false)", firstNoneExtID, storedParentID, stillStale)
	}
	alphaAfterGain, err := env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{
		DriveFolderID: "fld-alpha-01",
	})
	if err != nil {
		t.Fatalf("ListMine fld-alpha-01 after parent gained: %v", err)
	}
	if alphaAfterGain.TotalCount != 3 || len(alphaAfterGain.Files) != 3 {
		t.Fatalf("ListMine fld-alpha-01 after parent gained = total=%d len=%d, want 3, 3", alphaAfterGain.TotalCount, len(alphaAfterGain.Files))
	}
	foundGained := false
	for _, f := range alphaAfterGain.Files {
		if f.ExternalFileID == firstNoneExtID {
			foundGained = true
		}
	}
	if !foundGained {
		t.Fatalf("ListMine fld-alpha-01 after parent gained did not include %s: %+v", firstNoneExtID, alphaAfterGain.Files)
	}
}
