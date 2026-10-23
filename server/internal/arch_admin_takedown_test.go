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

// TestReportedContentRemoverIsTheConsoleOnlyContentSeam holds ADR 0042: the
// platform console reads no content and changes content in exactly one way,
// the operator's takedown of a reported message, through
// ReportedContentRemover.RemoveReportedMessageQ, which start-up wires to the
// chat service. TestAdminQueriesStayInAdminService cannot see a call that
// goes through an interface, so this test pins the seam itself: the
// interface keeps its one method, AdminService holds no other service that
// owns content, the admin files call nothing else on it, and main.go wires
// the chat service and nothing else into it.
func TestReportedContentRemoverIsTheConsoleOnlyContentSeam(t *testing.T) {
	fset := token.NewFileSet()
	adminFiles, err := filepath.Glob("service/admin*.go")
	if err != nil {
		t.Fatal(err)
	}
	var interfaces []string
	var fields []string
	removerCalls := map[string]bool{}
	call := regexp.MustCompile(`\bs\.remover\.(\w+)\(`)
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
	if got := strings.Join(interfaces, " "); got != "ReportedContentRemover{RemoveReportedMessageQ}" {
		t.Errorf("admin service interfaces = %q; the console's one content seam is ReportedContentRemover{RemoveReportedMessageQ} (ADR 0042)", got)
	}
	allowed := map[string]bool{
		"*pgxpool.Pool": true, "*db.Queries": true, "*BillingService": true, "*EntitlementService": true,
		"*Readiness": true, "func() int64": true, "[]string": true, "ReportedContentRemover": true,
	}
	for _, f := range fields {
		if !allowed[f] {
			t.Errorf("AdminService holds a %s: the console reaches content only through ReportedContentRemover (ADR 0042)", f)
		}
	}
	var calls []string
	for name := range removerCalls {
		calls = append(calls, name)
	}
	sort.Strings(calls)
	if strings.Join(calls, ",") != "RemoveReportedMessageQ" {
		t.Errorf("admin files call %v on the remover; only RemoveReportedMessageQ is allowed (ADR 0042)", calls)
	}

	var wired []string
	wiring := regexp.MustCompile(`\.SetReportedContentRemover\(([^)]*)\)`)
	err = filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
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
	if strings.Join(wired, " ") != "../cmd/server/main.go:chatSvc" {
		t.Errorf("SetReportedContentRemover wired as %v; only cmd/server/main.go wires it, with the chat service (ADR 0042)", wired)
	}
}
