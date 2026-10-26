package service

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
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

type driveFilesTestEnv struct {
	*driveTestFixture
	owner      db.User
	peer       db.User
	wsA        db.Workspace
	googleSrv  *FakeGoogleDriveServer
	fileSvc    *DriveFileService
	taskSvc    *TaskService
	contentSvc *DriveContentService
}

func newDriveFilesTestEnv(t *testing.T) *driveFilesTestEnv {
	t.Helper()
	fx := newDriveTestFixture(t)
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

	env.googleSrv.SetFile("ext-override-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "ext-override-1",
			Name:     "Tài liệu kiến trúc",
			MimeType: DriveMimeGoogleDoc,
		},
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
	if err != nil || len(r3) != 1 || r3[0].Outcome != DriveFileLinkOutcomeAlreadyLinked || r3[0].AccountEmail != "a1@example.com" {
		t.Fatalf("third Link diff conn = %+v, err=%v", r3, err)
	}

	// 4. Owner (bound_by) calls ChangeReadAccount (PUT .../access) -> 409 use_rebind.
	_, err = env.fileSvc.ChangeReadAccount(ctx, Human(env.owner.ID), env.wsA.ID, fileID, connA2.ID)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusConflict || ce.Code != "use_rebind" {
		t.Fatalf("ChangeReadAccount by bound_by = %v, want 409 use_rebind", err)
	}

	// 5. Peer links with connB -> outcome "linked"; then switches own read account to connB2 via ChangeReadAccount.
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
	if peerDetail.ViewerAccess != DriveViewerAccessUnknown || peerDetail.UsedInCount != 1 || peerDetail.UsedInTasks[0].TaskID != taskVisible.ID {
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
	if err != nil || grantedView.ViewerAccess != DriveViewerAccessGranted || grantedView.ViewerAccountEmail != "vis-b@example.com" {
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

	// 1. Atomic rollback when the second Drive file is not accessible on Google Drive.
	_, err := env.taskSvc.Create(ctx, Human(env.owner.ID), env.wsA.ID, CreateTaskInput{
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

	// Verify neither the task nor the first drive_files row was committed.
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

	// Verify flag off returns 404 feature_disabled.
	env.fileSvc.SetFlags(driveConnectorFlags(t, false))
	_, err = env.fileSvc.ListMine(ctx, Human(env.owner.ID), env.wsA.ID, ListDriveFilesFilter{})
	if !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "feature_disabled" {
		t.Fatalf("ListMine with flag off = %v, want 404 feature_disabled", err)
	}
}
