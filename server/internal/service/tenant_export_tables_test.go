package service

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestTenantExportClassifiesEveryTenantTable(t *testing.T) {
	got := tenantTablesFromMigrations(t)
	included := map[string]bool{}
	for _, name := range tenantExportIncludedTables {
		if included[name] {
			t.Errorf("included twice: %s", name)
		}
		included[name] = true
		if _, excluded := tenantExportExcluded[name]; excluded {
			t.Errorf("%s is both included and excluded", name)
		}
	}
	for name := range tenantExportExcluded {
		if reason := strings.TrimSpace(tenantExportExcluded[name]); reason == "" {
			t.Errorf("%s is excluded without a reason", name)
		}
	}
	var missing, extra []string
	for name := range got {
		if included[name] || tenantExportExcluded[name] != "" {
			continue
		}
		missing = append(missing, name)
	}
	for name := range included {
		if !got[name] {
			extra = append(extra, name)
		}
	}
	for name := range tenantExportExcluded {
		if !got[name] {
			extra = append(extra, name+" (excluded)")
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 || len(extra) > 0 {
		t.Fatalf("unclassified tenant tables: %v; classified tables that are not tenant tables: %v", missing, extra)
	}
}

func TestRedactTenantRowDropsSecretsAndStorageLocators(t *testing.T) {
	clean, summary, err := redactTenantRow("files", `{
		"id":"f1","original_filename":"a.png","size_bytes":4,"checksum_sha256":"abc",
		"object_key":"privacy/exports/x","bucket":"b","object_version":"1",
		"password_enc":"secret","token_hash":"h","checksum_ok":true
	}`)
	if err != nil {
		t.Fatal(err)
	}
	text := string(clean)
	for _, forbidden := range []string{"object_key", "privacy/exports", "password_enc", "token_hash", "secret"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("redacted row still has %q: %s", forbidden, text)
		}
	}
	if !strings.Contains(text, "checksum_sha256") || summary == nil || summary.FileID != "f1" || summary.Filename != "a.png" {
		t.Fatalf("file summary = %+v row %s", summary, text)
	}
}

var (
	tenantCreateTable = regexp.MustCompile(`(?i)\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(`)
	tenantAddOrg      = regexp.MustCompile(`(?is)\bALTER\s+TABLE\s+(\w+)\b[^;]*?\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?organization_id\b`)
	tenantOrgColumn   = regexp.MustCompile(`(?i)\borganization_id\b`)
	tenantSQLComment  = regexp.MustCompile(`--[^\n]*`)
)

func tenantTablesFromMigrations(t *testing.T) map[string]bool {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("no migrations: %v", err)
	}
	has := map[string]bool{}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sql := tenantSQLComment.ReplaceAllString(string(raw), "")
		for _, loc := range tenantCreateTable.FindAllStringSubmatchIndex(sql, -1) {
			table := strings.ToLower(sql[loc[2]:loc[3]])
			depth, i := 1, loc[1]
			for ; i < len(sql) && depth > 0; i++ {
				switch sql[i] {
				case '(':
					depth++
				case ')':
					depth--
				}
			}
			if tenantOrgColumn.MatchString(sql[loc[1] : i-1]) {
				has[table] = true
			}
		}
		for _, m := range tenantAddOrg.FindAllStringSubmatch(sql, -1) {
			has[strings.ToLower(m[1])] = true
		}
	}
	return has
}
