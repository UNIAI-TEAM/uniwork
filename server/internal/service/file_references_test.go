package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fileServiceTables are FileService's own tables; their file_id columns are
// coordination, not business references. file_backfill_items is the
// files-backfill ledger: a row records what a run did to a file, and must not
// keep that file alive for the collector.
var fileServiceTables = map[string]bool{"files": true, "file_upload_sessions": true, "file_jobs": true, "file_backfill_items": true, "file_derivatives": true}

var (
	alterTableRe  = regexp.MustCompile(`(?is)ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?(\w+)"?(.*)`)
	addColumnRe   = regexp.MustCompile(`(?i)ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w*file_id)"?\s`)
	dropColumnRe  = regexp.MustCompile(`(?i)DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w*file_id)"?`)
	createTableRe = regexp.MustCompile(`(?is)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\((.*)\)`)
	columnDefRe   = regexp.MustCompile(`(?im)^\s*"?(\w*file_id)"?\s+TEXT\b`)
	sqlCommentRe  = regexp.MustCompile(`--[^\n]*`)
)

// TestEveryFileIDColumnHasAReferenceSource is the static guard of spec 9.2:
// every column a migration creates that stores a FileService file id is in
// the collector's catalogue, and every catalogue row names a column that
// exists. A new column fails here until its provider and tenant query join
// managedFileReferenceSources.
func TestEveryFileIDColumnHasAReferenceSource(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	sort.Strings(paths)
	columns := map[string]bool{}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, stmt := range strings.Split(sqlCommentRe.ReplaceAllString(string(raw), ""), ";") {
			if m := createTableRe.FindStringSubmatch(stmt); m != nil {
				for _, c := range columnDefRe.FindAllStringSubmatch(m[2], -1) {
					columns[strings.ToLower(m[1])+"."+strings.ToLower(c[1])] = true
				}
				continue
			}
			if m := alterTableRe.FindStringSubmatch(stmt); m != nil {
				table := strings.ToLower(m[1])
				for _, c := range addColumnRe.FindAllStringSubmatch(m[2], -1) {
					columns[table+"."+strings.ToLower(c[1])] = true
				}
				for _, c := range dropColumnRe.FindAllStringSubmatch(m[2], -1) {
					delete(columns, table+"."+strings.ToLower(c[1]))
				}
			}
		}
	}
	catalogue := map[string]bool{}
	for _, src := range managedFileReferenceSources() {
		catalogue[src.Table+"."+src.Column] = true
		if src.tenants == nil {
			t.Errorf("%s.%s has no tenant query", src.Table, src.Column)
		}
	}
	for col := range columns {
		table := strings.SplitN(col, ".", 2)[0]
		if fileServiceTables[table] {
			continue
		}
		if !catalogue[col] {
			t.Errorf("migration adds %s but managedFileReferenceSources has no row for it: add its ReferenceProvider, tenant query and catalogue row", col)
		}
	}
	for col := range catalogue {
		if !columns[col] {
			t.Errorf("catalogue lists %s, which no migration creates", col)
		}
	}
}

func TestFileReferenceRegistryValidation(t *testing.T) {
	sources := managedFileReferenceSources()
	for name, providers := range map[string][]files.ReferenceProvider{
		"nil":       {nil},
		"nil ptr":   {(*memProvider)(nil)},
		"no name":   {newMemProvider(" ")},
		"duplicate": {newMemProvider("a"), newMemProvider("a")},
		"bad purpose": {
			&memProvider{name: "bad", purposes: []files.UploadPurpose{"nope"}, holds: map[files.FileID]files.HoldReason{}},
		},
	} {
		if _, err := newFileReferenceRegistry(providers, sources); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}

	prod, err := newFileReferenceRegistry(productionProviders(), sources)
	if err != nil {
		t.Fatal(err)
	}
	if err := prod.coverage(files.DefaultRegistry()); err != nil {
		t.Fatalf("production provider set: %v", err)
	}
	// Without the audit export provider both its column and its enabled
	// purpose are uncovered, so the collector must refuse to delete.
	var partial []files.ReferenceProvider
	for _, p := range productionProviders() {
		if p.Name() != "audit.exports" {
			partial = append(partial, p)
		}
	}
	gap, err := newFileReferenceRegistry(partial, sources)
	if err != nil {
		t.Fatal(err)
	}
	err = gap.coverage(files.DefaultRegistry())
	if !errors.Is(err, errFileReferenceCoverage) || !strings.Contains(err.Error(), "audit_exports.file_id") || !strings.Contains(err.Error(), "purpose audit_export") {
		t.Fatalf("coverage = %v, want the audit_exports column and audit_export purpose gaps", err)
	}
	// Disabled purposes need no provider, but UNI-675 registered
	// documents.versions and documents.assets already: the schema's file_id
	// columns exist before G1-03 opens document_file/document_asset, and the
	// registry must still prove them covered. The purposes stay Disabled.
	if !prod.covers(files.DocumentFile) || !prod.covers(files.DocumentAsset) {
		t.Fatal("document purposes should be covered by the G1-01 providers")
	}
}

// heldBy asks every provider and keeps the strongest reason; one provider
// error fails the whole call.
func TestFileReferenceHeldByStrongestReason(t *testing.T) {
	a, b := newMemProvider("a"), newMemProvider("b")
	r, err := newFileReferenceRegistry([]files.ReferenceProvider{a, b}, nil)
	if err != nil {
		t.Fatal(err)
	}
	a.hold("f1", files.HoldActive)
	b.hold("f1", files.HoldLegalHold)
	b.hold("f2", "")
	held, err := r.heldBy(context.Background(), nil, []files.FileID{"f1", "f2", "f3"})
	if err != nil {
		t.Fatal(err)
	}
	if held["f1"].Reason != files.HoldLegalHold || held["f1"].Provider != "b" {
		t.Errorf("f1 = %+v, want legal_hold from b", held["f1"])
	}
	if held["f2"].Reason != files.HoldActive {
		t.Errorf("f2 = %+v, an empty reason still holds as active", held["f2"])
	}
	if _, ok := held["f3"]; ok {
		t.Error("f3 held")
	}
	b.fail(errors.New("down"))
	if _, err := r.heldBy(context.Background(), nil, []files.FileID{"f1"}); err == nil {
		t.Fatal("provider error swallowed")
	}
}

func TestFileCrossTenantRules(t *testing.T) {
	orgFile := db.File{ID: "f", OrganizationID: pgtype.Text{String: "org-a", Valid: true}}
	avatarFile := db.File{ID: "f"}
	org := FileReferenceSource{Table: "attachments", Column: "file_id"}
	identity := FileReferenceSource{Table: "users", Column: "avatar_file_id", IdentityTenant: true}
	ref := func(src FileReferenceSource, org string, known bool) fileReferenceTenantAt {
		return fileReferenceTenantAt{fileReferenceTenant: fileReferenceTenant{FileID: "f", OrganizationID: org, Known: known}, Source: src}
	}
	for _, tc := range []struct {
		name string
		file db.File
		refs []fileReferenceTenantAt
		bad  bool
	}{
		{"same tenant", orgFile, []fileReferenceTenantAt{ref(org, "org-a", true)}, false},
		{"other tenant", orgFile, []fileReferenceTenantAt{ref(org, "org-b", true)}, true},
		{"unresolved tenant", orgFile, []fileReferenceTenantAt{ref(org, "", false)}, true},
		{"identity row on org file", orgFile, []fileReferenceTenantAt{ref(identity, "", true)}, true},
		{"identity row on avatar", avatarFile, []fileReferenceTenantAt{ref(identity, "", true)}, false},
		{"org row on avatar", avatarFile, []fileReferenceTenantAt{ref(org, "org-a", true)}, true},
		{"no references", orgFile, nil, false},
	} {
		if _, bad := crossTenant(tc.file, tc.refs); bad != tc.bad {
			t.Errorf("%s: crossTenant = %v, want %v", tc.name, bad, tc.bad)
		}
	}
}

// Every tenant query and the legacy-locator query run against the real
// schema (a typo in a join is a runtime error the collector would turn into
// an aborted batch every day).
func TestFileReferenceQueriesRun(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	r, err := newFileReferenceRegistry(productionProviders(), managedFileReferenceSources())
	if err != nil {
		t.Fatal(err)
	}
	ids := []files.FileID{"01J8ZQ0K7V9W1Y2X3Z4A5B6Q01"}
	if _, err := r.referenceTenants(context.Background(), q, ids); err != nil {
		t.Fatalf("tenant queries: %v", err)
	}
	if _, err := r.heldBy(context.Background(), q, ids); err != nil {
		t.Fatalf("providers: %v", err)
	}
	if _, err := q.FileGCLegacyManagedLocators(context.Background()); err != nil {
		t.Fatalf("legacy locator query: %v", err)
	}
}

func writeFileAt(path string, mod time.Time) error {
	if err := os.WriteFile(path, []byte("spool"), 0o600); err != nil {
		return err
	}
	return touchAt(path, mod)
}

func touchAt(path string, mod time.Time) error { return os.Chtimes(path, mod, mod) }

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// A legacy locator holds a managed object when it is the key, a URL ending in
// it, or such a URL with a query string or fragment (a stored signed URL).
func TestNamedByLegacyLocator(t *testing.T) {
	key := "v1/orgs/o/workspaces/w/tasks/attachments/2026/09/F1/original"
	for _, tc := range []struct {
		loc  string
		want bool
	}{
		{key, true},
		{"https://cdn.example.test/" + key, true},
		{"https://cdn.example.test/" + key + "?v=1", true},
		{"https://s3.example.test/bucket/" + key + "?X-Amz-Signature=abc#frag", true},
		{"https://cdn.example.test/" + key + "-thumb", false},
		{"v1/orgs/o/workspaces/w/tasks/attachments/2026/09/F2/original", false},
		{"https://cdn.example.test/?next=" + key + "x", false},
	} {
		if got := namedByLegacyLocator(key, []string{tc.loc}); got != tc.want {
			t.Errorf("namedByLegacyLocator(%q) = %v, want %v", tc.loc, got, tc.want)
		}
	}
}
