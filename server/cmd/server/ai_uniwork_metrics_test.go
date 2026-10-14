package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/metrics"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The real metrics struct satisfies the surface the UniWork AI service reports
// to (design §7): if a method is renamed on either side this stops compiling,
// instead of the four counters quietly staying at 0.
var _ service.UniworkRunMetrics = (*metrics.AIUniwork)(nil)

// TestMainWiresUniworkRunMetrics pins BE3B-7: the process registers the four
// run/usage counters but never handed them to the service, so they were
// exported at 0 forever. main.go must call
// aiUniworkSvc.SetUniworkMetrics(reg.AIUniwork) beside SetRunStore, guarded by
// reg != nil (a deployment without a metrics registry reports nothing).
func TestMainWiresUniworkRunMetrics(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}
	var wired, guarded bool
	ast.Inspect(file, func(n ast.Node) bool {
		ifStmt, ok := n.(*ast.IfStmt)
		if !ok || !isRegNotNil(ifStmt.Cond) {
			return true
		}
		ast.Inspect(ifStmt.Body, func(m ast.Node) bool {
			call, ok := m.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "SetUniworkMetrics" || len(call.Args) != 1 {
				return true
			}
			wired = true
			if arg, ok := call.Args[0].(*ast.SelectorExpr); ok && arg.Sel.Name == "AIUniwork" {
				guarded = true
			}
			return true
		})
		return true
	})
	if !wired {
		t.Fatal("main.go never calls SetUniworkMetrics; the four run/usage counters of §7 stay at 0 in production (BE3B-7)")
	}
	if !guarded {
		t.Fatal("SetUniworkMetrics is not called with reg.AIUniwork inside an `if reg != nil` guard; a deployment without metrics would report nothing or panic")
	}
}

// isRegNotNil reports whether cond is `reg != nil`.
func isRegNotNil(cond ast.Expr) bool {
	bin, ok := cond.(*ast.BinaryExpr)
	if !ok || bin.Op != token.NEQ {
		return false
	}
	id, ok := bin.X.(*ast.Ident)
	if !ok || id.Name != "reg" {
		return false
	}
	nilID, ok := bin.Y.(*ast.Ident)
	return ok && nilID.Name == "nil"
}
