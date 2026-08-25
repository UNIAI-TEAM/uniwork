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
