package migrations

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestEveryQueryNamesItsTenant is the query-scope scanner of ADR 0008: a sqlc
// query that reads or changes a tenant table (one that carries
// organization_id) either constrains it by a parameter -
// `organization_id = $n` or `workspace_id = $n`, the tenant the service took
// from RequireMember - or says in a `-- tenant:` line why it does not have
// to. A plain INSERT … VALUES names its tenant in the row it writes (the
// column is NOT NULL) and needs neither; an INSERT … SELECT reads, and an
// upsert (ON CONFLICT … DO UPDATE) rewrites whatever row its conflict key
// finds, so both need one - an upsert whose conflict key holds
// organization_id or workspace_id names its tenant there. An optional filter
// (sqlc.narg, "NULL means all") does not count.
//
// The reasons are a closed set, so a reviewer reads one word and knows what
// to check in the caller:
//
//	by-id   the query loads rows by their own id; the service authorizes the
//	        row's workspace or organization before it uses or returns it
//	parent  the query is keyed by a parent row (name it: "parent meeting_id")
//	        that the service authorized first
//	self    the caller's own rows: keyed by the caller's user id
//	token   looked up by a secret the caller presents (an invitation token, a
//	        share-link token); holding it is the grant
//	system  a worker or maintenance job that spans tenants by design and
//	        answers no request
//	platform the platform console (F-11), across tenants by design behind
//	        RequirePlatformRole; TestAdminQueriesStayInAdminService keeps
//	        these queries in the admin service
//
// The isolation matrix (internal/handler/isolation_matrix_test.go) is what
// proves the callers keep these promises; this scanner makes every new query
// state one.
func TestEveryQueryNamesItsTenant(t *testing.T) {
	tenant := tenantTables(t)
	var missing []string
	for _, q := range sqlcQueries(t) {
		if !q.needsTenant(tenant) {
			continue
		}
		reason := q.tenantReason()
		switch {
		case reason == "":
			missing = append(missing, q.file+": "+q.name+" ("+strings.Join(q.tenantTablesIn(tenant), ", ")+")")
		case !tenantReasonPattern.MatchString(reason):
			missing = append(missing, q.file+": "+q.name+" has `-- tenant: "+reason+"`, which is not one of by-id, parent <column>, self, token, system, platform")
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("%d queries touch a tenant table without `organization_id = $n` / `workspace_id = $n` and without a `-- tenant:` reason (ADR 0008):\n  %s",
			len(missing), strings.Join(missing, "\n  "))
	}
}

// A reason that names no tenant table is noise: it would hide the next query
// that really needs one.
func TestTenantReasonsSitOnTenantQueries(t *testing.T) {
	tenant := tenantTables(t)
	var stray []string
	for _, q := range sqlcQueries(t) {
		if q.tenantReason() == "" {
			continue
		}
		if !q.needsTenant(tenant) {
			stray = append(stray, q.file+": "+q.name)
		}
	}
	if len(stray) > 0 {
		sort.Strings(stray)
		t.Fatalf("`-- tenant:` on queries that already name their tenant or touch no tenant table; drop the line:\n  %s", strings.Join(stray, "\n  "))
	}
}

var tenantReasonPattern = regexp.MustCompile(`^(by-id|self|token|system|platform|parent [a-z_]+)\b`)

type sqlcQuery struct {
	file, name string
	comments   []string
	sql        string // comments stripped, lower-cased
}

var (
	queryNamePattern   = regexp.MustCompile(`(?m)^--\s*name:\s*(\w+)`)
	tableRefPattern    = regexp.MustCompile(`\b(?:from|join|update)\s+(?:only\s+)?([a-z_][a-z0-9_]*)\b`)
	insertTarget       = regexp.MustCompile(`\binsert\s+into\s+([a-z_][a-z0-9_]*)\b`)
	upsertPattern      = regexp.MustCompile(`\bon\s+conflict\b[\s\S]*?\bdo\s+update\b`)
	conflictTarget     = regexp.MustCompile(`\bon\s+conflict\s*\(([^)]*)\)`)
	tenantColumn       = regexp.MustCompile(`\b(?:organization_id|workspace_id)\b`)
	cteNamePattern     = regexp.MustCompile(`(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s+as\s+(?:materialized\s+|not\s+materialized\s+)?\(`)
	tenantReasonLine   = regexp.MustCompile(`^--\s*tenant:\s*(.*)$`)
	paramTenantForward = regexp.MustCompile(`\b(?:organization_id|workspace_id)\s*(?:=|in)\s*(?:any\s*\(\s*)?(?:\$\d+|sqlc\.arg\(|@\w+)`)
	paramTenantReverse = regexp.MustCompile(`(?:\$\d+|sqlc\.arg\([^)]*\)|@\w+)\s*=\s*(?:[a-z_]+\.)?(?:organization_id|workspace_id)\b`)
	insertSelectFrom   = regexp.MustCompile(`\bselect\b[\s\S]*\bfrom\b`)
)

func sqlcQueries(t *testing.T) []sqlcQuery {
	t.Helper()
	dir := filepath.Join("..", "pkg", "db", "queries")
	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no sqlc query files under %s: %v", dir, err)
	}
	var out []sqlcQuery
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		text := string(raw)
		idx := queryNamePattern.FindAllStringSubmatchIndex(text, -1)
		for i, m := range idx {
			end := len(text)
			if i+1 < len(idx) {
				end = idx[i+1][0]
			}
			// The block starts after the whole `-- name: X :kind` line.
			block := text[m[1]:end]
			if nl := strings.Index(block, "\n"); nl >= 0 {
				block = block[nl+1:]
			}
			q := sqlcQuery{file: filepath.Base(f), name: text[m[2]:m[3]]}
			var body []string
			for _, line := range strings.Split(block, "\n") {
				trimmed := strings.TrimSpace(line)
				if strings.HasPrefix(trimmed, "--") {
					q.comments = append(q.comments, trimmed)
					continue
				}
				if i := strings.Index(line, "--"); i >= 0 {
					line = line[:i]
				}
				body = append(body, line)
			}
			q.sql = strings.ToLower(strings.Join(body, "\n"))
			out = append(out, q)
		}
	}
	return out
}

func (q sqlcQuery) tenantReason() string {
	for _, c := range q.comments {
		if m := tenantReasonLine.FindStringSubmatch(c); m != nil {
			return strings.TrimSpace(m[1])
		}
	}
	return ""
}

func (q sqlcQuery) tablesRead() map[string]bool {
	ctes := map[string]bool{}
	for _, m := range cteNamePattern.FindAllStringSubmatch(q.sql, -1) {
		ctes[m[1]] = true
	}
	out := map[string]bool{}
	for _, m := range tableRefPattern.FindAllStringSubmatchIndex(q.sql, -1) {
		name := q.sql[m[2]:m[3]]
		// `FROM unnest(…)`, `EXTRACT(EPOCH FROM now())`: a call, not a table.
		// `DO UPDATE SET`: a keyword.
		if rest := strings.TrimLeft(q.sql[m[3]:], " \t\n"); strings.HasPrefix(rest, "(") || ctes[name] || name == "set" {
			continue
		}
		out[name] = true
	}
	// The target of INSERT INTO t (cols…) is followed by "(" but is a table.
	for _, m := range insertTarget.FindAllStringSubmatch(q.sql, -1) {
		out[m[1]] = true
	}
	return out
}

func (q sqlcQuery) tenantTablesIn(tenant map[string]bool) []string {
	var out []string
	for name := range q.tablesRead() {
		if tenant[name] {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

func (q sqlcQuery) touchesAny(tenant map[string]bool) bool { return len(q.tenantTablesIn(tenant)) > 0 }

func (q sqlcQuery) paramTenantPredicate() bool {
	return paramTenantForward.MatchString(q.sql) || paramTenantReverse.MatchString(q.sql)
}

// needsTenant: the query touches a tenant table and nothing in it names the
// tenant - no parameterized predicate, not a plain INSERT … VALUES, and not
// an upsert keyed by the tenant.
func (q sqlcQuery) needsTenant(tenant map[string]bool) bool {
	if !q.touchesAny(tenant) || q.paramTenantPredicate() {
		return false
	}
	s := strings.TrimSpace(q.sql)
	if !strings.HasPrefix(s, "insert") {
		return true
	}
	if insertSelectFrom.MatchString(s) {
		return true
	}
	if upsertPattern.MatchString(s) {
		m := conflictTarget.FindStringSubmatch(s)
		return m == nil || !tenantColumn.MatchString(m[1])
	}
	return false
}

// tenantTables is every table some migration gives an organization_id column
// and no later migration drops.
func tenantTables(t *testing.T) map[string]bool {
	t.Helper()
	has := map[string]bool{}
	dropTable := regexp.MustCompile(`(?i)\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)`)
	for _, name := range migrationFileNames(t) {
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		sql := stripSQLComments(readMigration(t, name))
		for table, body := range createdTables(sql) {
			if organizationIDPattern.MatchString(body) {
				has[strings.ToLower(table)] = true
			}
		}
		for _, m := range alterAddOrganizationIDPattern.FindAllStringSubmatch(sql, -1) {
			has[strings.ToLower(m[1])] = true
		}
		for _, m := range dropTable.FindAllStringSubmatch(sql, -1) {
			delete(has, strings.ToLower(m[1]))
		}
	}
	return has
}
