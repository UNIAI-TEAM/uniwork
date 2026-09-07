package migrations

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Migrations 001–004 predate the rules below and are frozen: they carry
// foreign keys and non-concurrent indexes, and rewriting applied history would
// diverge every existing database from the files. Everything after this
// prefix is held to the rules.
const maxLegacyMigrationPrefix = 4

var migrationPrefixPattern = regexp.MustCompile(`^(\d+)_`)

// The two production rules. Both exist because they cannot be checked by eye:
//
//   - A FOREIGN KEY makes the database the owner of a relationship the
//     application must already enforce, and cascades delete rows nobody asked
//     to delete. Relationships and dependent cleanup live in service code,
//     inside a transaction when they must commit together.
//   - A plain CREATE INDEX takes a lock that blocks writes on the table for the
//     duration of the build. CONCURRENTLY does not — but PostgreSQL refuses it
//     inside a transaction or a multi-statement string, which is why each one
//     must be the only statement in its file, and why the runner applies files
//     outside a transaction.
var (
	foreignKeyPattern  = regexp.MustCompile(`(?i)\b(FOREIGN\s+KEY|REFERENCES)\b`)
	createIndexPattern = regexp.MustCompile(`(?i)\bCREATE\s+(UNIQUE\s+)?INDEX\b`)
	concurrentPattern  = regexp.MustCompile(`(?i)^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b`)
)

func TestMigrationFilesHaveMatchingDirections(t *testing.T) {
	directionsByStem := map[string]map[string]bool{}
	for _, name := range migrationFileNames(t) {
		stem, direction, ok := splitMigrationFilename(name)
		if !ok {
			continue
		}
		if directionsByStem[stem] == nil {
			directionsByStem[stem] = map[string]bool{}
		}
		directionsByStem[stem][direction] = true
	}
	for stem, directions := range directionsByStem {
		if !directions["up"] || !directions["down"] {
			t.Errorf("migration %s must have both .up.sql and .down.sql files", stem)
		}
	}
}

func TestMigrationNumericPrefixesAreUnique(t *testing.T) {
	for prefix, stems := range migrationStemsByPrefix(t) {
		if len(stems) > 1 {
			sort.Strings(stems)
			t.Errorf("migration prefix %s is reused by %v; use the next unique prefix instead", prefix, stems)
		}
	}
}

func TestNewMigrationsHaveNoForeignKeys(t *testing.T) {
	for _, name := range newMigrationUpFiles(t) {
		sql := stripSQLComments(readMigration(t, name))
		if loc := foreignKeyPattern.FindStringIndex(sql); loc != nil {
			t.Errorf("%s declares %q: foreign keys are not allowed — enforce the relationship and its cleanup in application code", name, sql[loc[0]:loc[1]])
		}
	}
}

func TestNewMigrationsCreateIndexesConcurrently(t *testing.T) {
	for _, name := range newMigrationUpFiles(t) {
		sql := stripSQLComments(readMigration(t, name))
		creates := createIndexPattern.FindAllStringIndex(sql, -1)
		if len(creates) == 0 {
			continue
		}
		for _, loc := range creates {
			if !concurrentPattern.MatchString(sql[loc[0]:]) {
				t.Errorf("%s creates an index without CONCURRENTLY; a plain CREATE INDEX blocks writes for the whole build", name)
				break
			}
		}
		if n := countStatements(sql); n != 1 {
			t.Errorf("%s holds %d statements; a concurrent index build must be the only statement in its file — PostgreSQL rejects it in a multi-statement string", name, n)
		}
	}
}

func TestTaskFoundationTablesAndColumnsExist(t *testing.T) {
	required := map[string][]string{
		"task_statuses":     {"organization_id", "workspace_id", "key", "category", "is_system"},
		"task_labels":       {"organization_id", "workspace_id", "name", "color"},
		"task_properties":   {"organization_id", "workspace_id", "name", "type", "config"},
		"projects":          {"organization_id", "workspace_id", "title", "status", "priority", "revision"},
		"project_resources": {"organization_id", "workspace_id", "project_id", "resource_type", "resource_ref"},
		"task_views":        {"organization_id", "workspace_id", "scope_type", "query", "display", "revision"},
	}
	all := ""
	for _, name := range newMigrationUpFiles(t) {
		all += "\n" + stripSQLComments(readMigration(t, name))
	}
	for table, columns := range required {
		body, ok := createdTables(all)[table]
		if !ok {
			t.Errorf("missing table %s", table)
			continue
		}
		for _, column := range columns {
			if !regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(column) + `\b`).MatchString(body) {
				t.Errorf("%s missing %s", table, column)
			}
		}
	}
}

// --- helpers ---------------------------------------------------------------

func migrationFileNames(t *testing.T) []string {
	t.Helper()
	entries, err := fsys.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	if len(names) == 0 {
		t.Fatal("no migration files embedded")
	}
	sort.Strings(names)
	return names
}

func readMigration(t *testing.T, name string) string {
	t.Helper()
	b, err := fsys.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func migrationStemsByPrefix(t *testing.T) map[string][]string {
	t.Helper()
	byPrefix := map[string][]string{}
	for _, name := range migrationFileNames(t) {
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		stem := strings.TrimSuffix(name, ".up.sql")
		m := migrationPrefixPattern.FindStringSubmatch(stem)
		if m == nil {
			t.Fatalf("migration %s does not start with a numeric prefix followed by underscore", stem)
		}
		byPrefix[m[1]] = append(byPrefix[m[1]], stem)
	}
	return byPrefix
}

// newMigrationUpFiles returns the up files past the frozen legacy range.
func newMigrationUpFiles(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, name := range migrationFileNames(t) {
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		m := migrationPrefixPattern.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		n, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatalf("parse migration prefix %q: %v", m[1], err)
		}
		if n > maxLegacyMigrationPrefix {
			out = append(out, name)
		}
	}
	return out
}

func splitMigrationFilename(name string) (stem, direction string, ok bool) {
	for _, d := range []string{"up", "down"} {
		suffix := fmt.Sprintf(".%s.sql", d)
		if strings.HasSuffix(name, suffix) {
			return strings.TrimSuffix(name, suffix), d, true
		}
	}
	return "", "", false
}

// stripSQLComments removes `-- …` line comments so a rule cannot be tripped
// (or satisfied) by prose.
func stripSQLComments(sql string) string {
	var b strings.Builder
	for _, line := range strings.Split(sql, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}

// countStatements counts semicolon-terminated statements, ignoring blank
// trailing text. Good enough for migration files, which never embed
// semicolons in string literals.
func countStatements(sql string) int {
	n := 0
	for _, part := range strings.Split(sql, ";") {
		if strings.TrimSpace(part) != "" {
			n++
		}
	}
	return n
}

// --- ADR 0008: organization_id on every business table ------------------------
//
// The tenant boundary is the organization. A business table without
// `organization_id NOT NULL` cannot be isolated at the service layer, and a
// missing column is invisible in review until the first cross-tenant read.
// Two checks: new tables must carry the column from their first migration, and
// the tables that predate the ADR are listed by name so the debt can only
// shrink — backfill one, remove it here; add one without the column, fail.

// Tables created before this prefix are the backfill debt below; every
// CREATE TABLE after it is held to the rule.
const maxPreTenantMigrationPrefix = 65

// Identity and infrastructure tables that are not tenant data. Add a name
// here only with the reason beside it.
var tenantExemptTables = map[string]string{
	"users":                    "identity, above every organization",
	"refresh_tokens":           "session credential, keyed by user",
	"email_verification_codes": "pre-registration, no organization yet",
	"password_reset_tokens":    "credential recovery, keyed by user",
	"organizations":            "the tenant itself",
	"emails":                   "transactional mail outbox, provider-facing",
	"webhook_inbox":            "raw provider callbacks, before they are attributed",
	"plans":                    "the global plan catalogue, shared by every tenant (F-02)",
	"features":                 "the entitlement vocabulary, shared by every tenant (F-02)",
	"plan_features":            "catalogue rows, keyed by plan (F-02)",
	"notification_preferences": "per-user setting, above every organization (F-07)",
	"push_subscriptions":       "per-user browser credential, above every organization (F-07)",
	"notification_deliveries":  "consumer idempotency ledger keyed by outbox event (F-07)",
	"ai_model_rates":           "global model price list, shared by every tenant (F-09)",
	"admin_actions":            "platform-admin ledger; a target may be any organization, user or flag (F-11)",
	"feature_flag_overrides":   "flag overrides scoped to organization, user or global; the scope is a column (F-11)",
}

// Business tables created before ADR 0008 that still lack organization_id.
// ADR 0008 schedules the backfill with F-08 / ADR 0007; each backfill migration
// removes its table from this list. Names only ever leave.
var tenantBackfillDebt = []string{
	"chat_messages", "chat_room_members",
	"invitations", "workspace_members",
	"meetings", "meeting_attendees", "meeting_notes",
	"meeting_participants", "meeting_invitations", "meeting_access_grants",
	"meeting_invite_links", "meeting_join_requests", "meeting_conference_sessions",
	"meeting_attendance_sessions", "meeting_audit_logs", "meeting_guests",
	"meeting_provider_events", "meeting_chat_messages",
	"meeting_transcript_segments", "meeting_summaries", "meeting_recordings",
}

func TestNewTablesCarryOrganizationID(t *testing.T) {
	for _, name := range newMigrationUpFiles(t) {
		if migrationPrefix(t, name) <= maxPreTenantMigrationPrefix {
			continue
		}
		for table, body := range createdTables(stripSQLComments(readMigration(t, name))) {
			if _, exempt := tenantExemptTables[table]; exempt {
				continue
			}
			if !tenantColumnPattern.MatchString(body) {
				t.Errorf("%s creates %s without `organization_id TEXT NOT NULL` (ADR 0008); a business table is tenant-scoped from its first migration, or is listed in tenantExemptTables with a reason", name, table)
			}
		}
	}
}

func TestTablesWithoutOrganizationIDAreTheKnownDebt(t *testing.T) {
	has := map[string]bool{}
	created := map[string]bool{}
	for _, name := range migrationFileNames(t) {
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		sql := stripSQLComments(readMigration(t, name))
		for table, body := range createdTables(sql) {
			created[table] = true
			if organizationIDPattern.MatchString(body) {
				has[table] = true
			}
		}
		for _, m := range alterAddOrganizationIDPattern.FindAllStringSubmatch(sql, -1) {
			has[m[1]] = true
		}
	}
	var missing []string
	for table := range created {
		if _, exempt := tenantExemptTables[table]; exempt || has[table] {
			continue
		}
		missing = append(missing, table)
	}
	sort.Strings(missing)
	want := append([]string(nil), tenantBackfillDebt...)
	sort.Strings(want)
	if strings.Join(missing, ",") != strings.Join(want, ",") {
		t.Errorf("tables without organization_id (ADR 0008) differ from tenantBackfillDebt.\n  actual: %v\n  listed: %v\nBackfilled one? Remove it from the list. Added a new table? Give it the column, or exempt it with a reason.", missing, want)
	}
}

var (
	organizationIDPattern         = regexp.MustCompile(`(?i)\borganization_id\b`)
	tenantColumnPattern           = regexp.MustCompile(`(?i)\borganization_id\s+TEXT\s+NOT\s+NULL\b`)
	createTablePattern            = regexp.MustCompile(`(?i)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(`)
	alterAddOrganizationIDPattern = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(\w+)\b[^;]*?\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?organization_id\b`)
)

// createdTables maps each table a migration creates to its column list body.
// ponytail: paren-depth scan, not a SQL parser — enough for the flat
// CREATE TABLE bodies in this directory.
func createdTables(sql string) map[string]string {
	out := map[string]string{}
	for _, loc := range createTablePattern.FindAllStringSubmatchIndex(sql, -1) {
		table := strings.ToLower(sql[loc[2]:loc[3]])
		depth, start := 1, loc[1]
		for i := start; i < len(sql); i++ {
			switch sql[i] {
			case '(':
				depth++
			case ')':
				depth--
			}
			if depth == 0 {
				out[table] = sql[start:i]
				break
			}
		}
	}
	return out
}

// --- ADR 0007: created_by always travels with created_by_kind ---------------
//
// Attribution is a pair: who, and what kind of actor. A table that records
// only the id cannot tell a person from an agent, and the UI has no honest way
// to draw the badge. Tables created after the actor-kind migration must
// declare both columns together.
const maxPreActorKindMigrationPrefix = 65

var (
	createdByPattern     = regexp.MustCompile(`(?i)\bcreated_by\s+TEXT\b`)
	createdByKindPattern = regexp.MustCompile(`(?i)\bcreated_by_kind\s+TEXT\b`)
)

func TestActorKindOnEveryCreatedBy(t *testing.T) {
	for _, name := range newMigrationUpFiles(t) {
		if migrationPrefix(t, name) <= maxPreActorKindMigrationPrefix {
			continue
		}
		for table, body := range createdTables(stripSQLComments(readMigration(t, name))) {
			if createdByPattern.MatchString(body) && !createdByKindPattern.MatchString(body) {
				t.Errorf("%s creates %s with created_by but no created_by_kind (ADR 0007); attribution is the pair", name, table)
			}
		}
	}
}

func migrationPrefix(t *testing.T, name string) int {
	t.Helper()
	m := migrationPrefixPattern.FindStringSubmatch(name)
	if m == nil {
		t.Fatalf("migration %s has no numeric prefix", name)
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return n
}
