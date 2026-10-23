package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// TestMainWiresMeetingFlags pins the UNI-2023 review finding: MeetingService
// reads the meeting_scribe flag through SetFlags, and without the call in
// main.go scribeFlagOn is false everywhere, so the scribe never dispatches.
func TestMainWiresMeetingFlags(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}
	wired := false
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "SetFlags" || len(call.Args) != 1 {
			return true
		}
		if recv, ok := sel.X.(*ast.Ident); ok && recv.Name == "meetingSvc" {
			if arg, ok := call.Args[0].(*ast.Ident); ok && arg.Name == "flags" {
				wired = true
			}
		}
		return true
	})
	if !wired {
		t.Fatal("main.go never calls meetingSvc.SetFlags(flags); the meeting_scribe flag reads false and the scribe never dispatches")
	}
}
