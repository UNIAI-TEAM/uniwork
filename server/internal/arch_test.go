package internal

// Layering rules from CLAUDE.md § Project Shape / § Backend ID Rules, pinned.
// Before this file they were prose: true on the day they were written and
// nothing stopped the next handler from opening a pool. `go list` sees the
// same import graph the compiler does, so a violation fails `make test-go`
// with the offending package named.

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const module = "github.com/unicomhub/uniwork/server/"

// directImports returns pkg -> direct (non-test) imports for every package.
func directImports(t *testing.T) map[string][]string {
	t.Helper()
	cmd := exec.Command("go", "list", "-f", "{{.ImportPath}} {{join .Imports \" \"}}", "./...")
	cmd.Dir = ".."
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	graph := map[string][]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(line)
		graph[strings.TrimPrefix(f[0], module)] = f[1:]
	}
	return graph
}

func TestLayering(t *testing.T) {
	graph := directImports(t)
	rules := []struct {
		from, forbidden, why string
	}{
		// Handlers hand ids to services and map results to SDOs. They may
		// import the generated row types; they may not hold a connection.
		{"internal/handler", "github.com/jackc/pgx/v5/pgxpool", "handlers never query the database"},
		{"internal/handler", module + "pkg/db/queries", "handlers never query the database"},
		{"internal/service", module + "internal/handler", "service → handler inverts the layers"},
		{"pkg/db", module + "internal", "pkg/db is the bottom layer"},
	}
	for pkg, imports := range graph {
		for _, r := range rules {
			if !strings.HasPrefix(pkg, r.from) {
				continue
			}
			for _, imp := range imports {
				if strings.HasPrefix(imp, r.forbidden) {
					t.Errorf("%s imports %s: %s", pkg, imp, r.why)
				}
			}
		}
	}
}

// Membership is decided in WorkspaceService.RequireMember and nowhere else
// (CLAUDE.md § Database and Migration Rules). The two sqlc queries that read
// workspace_members for a decision may only be called from that file, and the
// organization membership row only from the two files that own that lifecycle
// (spec F-03 §8) — a third caller would be a second place a deactivated member
// could slip through.
func TestMembershipDecidedInOnePlace(t *testing.T) {
	decision := regexp.MustCompile(`\.(GetWorkspaceMember|GetWorkspaceAccess|GetWorkspaceAgentMember|GetOrganizationMember)\(`)
	owners := map[string]bool{
		"internal/service/workspace.go":            true,
		"internal/service/organization.go":         true,
		"internal/service/organization_members.go": true,
	}
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") {
			return nil
		}
		for owner := range owners {
			if strings.HasSuffix(slash, owner) {
				return nil
			}
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if decision.Match(src) {
			t.Errorf("%s reads a membership row directly; go through WorkspaceService.RequireMember or OrganizationService.RequireMember", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The profile table is written in one place (spec F-03 §8). Every other
// command that needs a profile row — creating an organization, accepting an
// invitation, renaming yourself — goes through the helpers in people.go, so
// the folded search column can never be written by a caller that forgot to
// rebuild it.
func TestMemberProfilesWrittenInOnePlace(t *testing.T) {
	write := regexp.MustCompile(`\.(UpsertMemberProfile|UpdateMemberProfile|SetMemberProfileSearchText|ClearDepartmentFromProfiles)\(`)
	owners := []string{
		"internal/service/people.go",
		"internal/service/department.go",
	}
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") {
			return nil
		}
		for _, owner := range owners {
			if strings.HasSuffix(slash, owner) {
				return nil
			}
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if write.Match(src) {
			t.Errorf("%s writes organization_member_profiles directly; go through people.go", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// An actor's kind is decided by the service layer (ADR 0007). A handler only
// ever holds a signed-in person, so the only constructor it may call is
// service.Human; building an agent or system actor anywhere else would let a
// request claim to be an agent. Tests are exempt: they set up both kinds.
func TestActorConstructedOnlyInService(t *testing.T) {
	construct := regexp.MustCompile(`audit\.(Actor\{|System\(|KindAgent|KindSystem)`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		// internal/notification is a worker on the service tier: it reads
		// committed events and its jobs act as "system" (F-07). No request
		// reaches it, which is what the rule protects against.
		if strings.Contains(slash, "internal/service/") || strings.Contains(slash, "internal/audit/") ||
			strings.Contains(slash, "internal/notification/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if construct.Match(src) {
			t.Errorf("%s constructs an actor kind directly; only internal/service decides who an actor is", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Audit rows and domain events are written in exactly one place. The rule
// "every command writes audit and outbox in the same transaction" (ADR 0009)
// is only worth stating if it cannot be worked around, and the way it gets
// worked around is a service reaching for the insert directly — at which point
// nothing decides the correlation id, the actor kind or the event version.
//
// internal/audit is the only caller; everything else goes through
// audit.Recorder.Record or, for infrastructure topics, Recorder.Emit.
func TestAuditAndOutboxWritesGoThroughTheAuditPackage(t *testing.T) {
	writes := regexp.MustCompile(`\.(InsertAuditEvent|InsertDomainOutboxEvent)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") || strings.Contains(slash, "internal/audit/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if writes.Match(src) {
			t.Errorf("%s writes audit_events or outbox_events directly; go through internal/audit", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The subscription and usage tables have one writer and one reader (spec F-02
// §4.1): EntitlementService decides the gate, BillingService changes the plan.
// A gate re-implemented beside a business command would drift from the
// fail-closed formula, so the sqlc queries on plans, subscriptions and
// usage_* are callable from those two files only.
func TestBillingQueriesStayInBillingServices(t *testing.T) {
	billing := regexp.MustCompile(`\.(ListActivePlans|GetPlanByCode|GetPlanByID|GetDefaultPlan|ListFeatures|ListPlanFeatures|ListActivePlanFeatures|GetLiveSubscription|LockLiveSubscription|CreateSubscription|ChangeSubscriptionPlan|SetSubscriptionCancelAt|InsertUsageEvent|GetUsageCounter|ListUsageCounters|AddUsageWithinLimit|MarkUsageThresholdNotified)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		// cmd/seed is the k6 fixture tool: it COPYs rows straight into the
		// tables and only reads the default plan to point them at it.
		if strings.Contains(slash, "pkg/db/generated") ||
			strings.Contains(slash, "cmd/seed/") ||
			strings.HasSuffix(slash, "internal/service/entitlement.go") ||
			strings.HasSuffix(slash, "internal/service/billing.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if billing.Match(src) {
			t.Errorf("%s touches plans/subscriptions/usage directly; go through EntitlementService or BillingService", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Notification preferences are read in one place (spec F-07 §8.1 #9): the
// consumer decides the channel and the service exposes the matrix. A second
// reader would re-implement the defaults and drift from them.
func TestNotificationPreferencesReadInOnePlace(t *testing.T) {
	prefs := regexp.MustCompile(`\.(ListNotificationPreferences|ListNotificationPreferencesByUsers|UpsertNotificationPreference)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") || strings.Contains(slash, "internal/notification/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if prefs.Match(src) {
			t.Errorf("%s touches notification_preferences directly; go through internal/notification", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The AI gateway is the one door to a model (spec F-09 §2 #1, ADR 0010).
// Three shapes hold it: only internal/ai/provider may import a vendor SDK;
// internal/ai never imports the service tier (context comes in through
// ai.SourceReader, so there is no second read path and no cycle); and the
// only sqlc queries internal/ai may call are its own Ai* ones, so the model
// side of the house cannot reach a business table by accident.
func TestProviderSDKOnlyInAIProvider(t *testing.T) {
	graph := directImports(t)
	for pkg, imports := range graph {
		for _, imp := range imports {
			if strings.HasPrefix(imp, "github.com/anthropics/") && pkg != "internal/ai/provider" {
				t.Errorf("%s imports %s; vendor SDKs live in internal/ai/provider only", pkg, imp)
			}
			if strings.HasPrefix(pkg, "internal/ai") && strings.HasPrefix(imp, module+"internal/service") {
				t.Errorf("%s imports %s; the gateway never reaches the service tier", pkg, imp)
			}
		}
	}
}

func TestAIPackageOnlyCallsAiQueries(t *testing.T) {
	call := regexp.MustCompile(`\bq\.([A-Z]\w*)\(`)
	err := filepath.WalkDir("../internal/ai", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range call.FindAllStringSubmatch(string(src), -1) {
			if !strings.HasPrefix(m[1], "Ai") {
				t.Errorf("%s calls q.%s; internal/ai may only call Ai* queries (ADR 0010)", path, m[1])
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// The platform console reads across tenants, so its query set (admin.sql) is
// fenced: only service/admin.go calls Admin* queries, and admin.go never
// reaches a content service (task, chat, meeting) — metadata only (F-11 §5.1).
func TestAdminQueriesStayInAdminService(t *testing.T) {
	adminQueries := regexp.MustCompile(`\bq\.(AdminListOrganizations|AdminCountOrganizations|AdminGetOrganization|AdminSetOrganizationStatus|InsertAdminAction|ListAdminActionsByTarget|ListAdminActionsByTrace|AdminListAuditEventsByCorrelation|AdminListOutboxEventsByCorrelation|AdminOutboxSummary|SetUserPlatformRole|ListPlatformRoleUsers|ListFlagOverridesByKey|AdminListAllFlagOverrides|CountFlagOverridesByKey|GetFlagOverride|UpsertFlagOverride|DeleteFlagOverride)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.HasSuffix(slash, "internal/service/admin.go") || strings.HasSuffix(slash, "internal/service/admin_flags.go") || strings.Contains(slash, "pkg/db/generated/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if adminQueries.Match(src) {
			t.Errorf("%s calls an admin.sql query; only service/admin.go may", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	src, err := os.ReadFile("service/admin.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"TaskService", "ChatService", "MeetingService", "GetTask", "chat_messages", "ListTasks"} {
		if strings.Contains(string(src), forbidden) {
			t.Errorf("service/admin.go mentions %s: the console never returns content", forbidden)
		}
	}
}
