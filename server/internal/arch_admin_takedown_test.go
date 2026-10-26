package internal

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestReportedContentRemoverIsTheConsoleOnlyContentSeam holds ADR 0042 and
// ADR 0046: the platform console reads no content and changes content in
// exactly two ways. The operator's takedown of a reported message goes
// through ReportedContentRemover.RemoveReportedMessageQ, which start-up wires
// to the chat service (ADR 0042); scheduling or cancelling an organization's
// privacy deletion goes through OrganizationDeletionQueue, which start-up
// wires to the privacy service (ADR 0046). TestAdminQueriesStayInAdminService
// cannot see a call that goes through an interface, so this test pins both
// seams: each interface keeps its methods, AdminService holds no other
// service that owns content (never *PrivacyExportService, which could export
// tenant files), the admin files call nothing else on either field, and
// main.go wires the chat and privacy services and nothing else into them.
func TestReportedContentRemoverIsTheConsoleOnlyContentSeam(t *testing.T) {
	fset := token.NewFileSet()
	adminFiles, err := filepath.Glob("service/admin*.go")
	if err != nil {
		t.Fatal(err)
	}
	var interfaces []string
	var fields []string
	removerCalls := map[string]bool{}
	deletionCalls := map[string]bool{}
	call := regexp.MustCompile(`\bs\.remover\.(\w+)\(`)
	deletionCall := regexp.MustCompile(`\bs\.deletion\.(\w+)\(`)
	for _, path := range adminFiles {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range call.FindAllStringSubmatch(string(src), -1) {
			removerCalls[m[1]] = true
		}
		for _, m := range deletionCall.FindAllStringSubmatch(string(src), -1) {
			deletionCalls[m[1]] = true
		}
		ast.Inspect(file, func(n ast.Node) bool {
			spec, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			switch typ := spec.Type.(type) {
			case *ast.InterfaceType:
				var methods []string
				for _, m := range typ.Methods.List {
					for _, name := range m.Names {
						methods = append(methods, name.Name)
					}
				}
				interfaces = append(interfaces, spec.Name.Name+"{"+strings.Join(methods, ",")+"}")
			case *ast.StructType:
				if spec.Name.Name != "AdminService" {
					return true
				}
				for _, f := range typ.Fields.List {
					fields = append(fields, string(src[fset.Position(f.Type.Pos()).Offset:fset.Position(f.Type.End()).Offset]))
				}
			}
			return true
		})
	}
	const seams = "ReportedContentRemover{RemoveReportedMessageQ} OrganizationDeletionQueue{queueDeletion,cancelDeletion}"
	if got := strings.Join(interfaces, " "); got != seams {
		t.Errorf("admin service interfaces = %q; the console's content seams are %s (ADR 0042, ADR 0046)", got, seams)
	}
	allowed := map[string]bool{
		"*pgxpool.Pool": true, "*db.Queries": true, "*BillingService": true, "*EntitlementService": true,
		"*Readiness": true, "func() int64": true, "[]string": true, "ReportedContentRemover": true,
		"OrganizationDeletionQueue": true,
	}
	for _, f := range fields {
		if !allowed[f] {
			t.Errorf("AdminService holds a %s: the console reaches content only through ReportedContentRemover and OrganizationDeletionQueue (ADR 0042, ADR 0046)", f)
		}
	}
	if got := sortedKeys(removerCalls); got != "RemoveReportedMessageQ" {
		t.Errorf("admin files call %v on the remover; only RemoveReportedMessageQ is allowed (ADR 0042)", got)
	}
	if got := sortedKeys(deletionCalls); got != "cancelDeletion,queueDeletion" {
		t.Errorf("admin files call %v on the deletion queue; only queueDeletion and cancelDeletion are allowed (ADR 0046)", got)
	}

	if got := wiredSetter(t, "SetReportedContentRemover"); got != "../cmd/server/main.go:chatSvc" {
		t.Errorf("SetReportedContentRemover wired as %v; only cmd/server/main.go wires it, with the chat service (ADR 0042)", got)
	}
	if got := wiredSetter(t, "SetOrganizationDeletionQueue"); got != "../cmd/server/main.go:privacySvc" {
		t.Errorf("SetOrganizationDeletionQueue wired as %v; only cmd/server/main.go wires it, with the privacy service (ADR 0046)", got)
	}
}

func sortedKeys(set map[string]bool) string {
	var keys []string
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

// wiredSetter lists every non-test call of the named setter under server/ as
// path:argument.
func wiredSetter(t *testing.T, setter string) string {
	t.Helper()
	var wired []string
	wiring := regexp.MustCompile(`\.` + setter + `\(([^)]*)\)`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range wiring.FindAllStringSubmatch(string(src), -1) {
			wired = append(wired, filepath.ToSlash(path)+":"+strings.TrimSpace(m[1]))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return strings.Join(wired, " ")
}
