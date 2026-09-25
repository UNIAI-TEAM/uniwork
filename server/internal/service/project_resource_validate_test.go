package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateAndNormalizeResourceRef(t *testing.T) {
	t.Parallel()

	if _, err := validateAndNormalizeResourceRef("github_repo", nil); err == nil || !strings.Contains(err.Error(), "required") {
		t.Fatalf("empty ref: %v", err)
	}
	if _, err := validateAndNormalizeResourceRef("wiki", json.RawMessage(`{}`)); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown type: %v", err)
	}

	got, err := validateAndNormalizeResourceRef("github_repo", json.RawMessage(`{"url":"https://github.com/acme/app.git","default_branch_hint":" main ","ref":" v1 "}`))
	if err != nil {
		t.Fatal(err)
	}
	var gh githubRepoRef
	if err := json.Unmarshal(got, &gh); err != nil {
		t.Fatal(err)
	}
	if gh.URL != "https://github.com/acme/app.git" || gh.DefaultBranchHint != "main" || gh.Ref != "v1" {
		t.Fatalf("%+v", gh)
	}

	if _, err := validateGithubRepoRef(json.RawMessage(`{`)); err == nil {
		t.Fatal("expected bad json")
	}
	if _, err := validateGithubRepoRef(json.RawMessage(`{"url":""}`)); err == nil {
		t.Fatal("expected empty url")
	}
	if _, err := validateGithubRepoRef(json.RawMessage(`{"url":"ftp://example.com/r.git"}`)); err == nil {
		t.Fatal("expected invalid scheme")
	}
	if !isValidGitRepoURL("git@github.com:acme/app.git") {
		t.Fatal("ssh scp form")
	}
	if isValidGitRepoURL("git@github.com") {
		t.Fatal("scp form needs colon")
	}
	if isValidGitRepoURL("https:///no-host") {
		t.Fatal("http needs host")
	}

	local, err := validateAndNormalizeResourceRef("local_directory", json.RawMessage(`{"local_path":" /tmp/app ","daemon_id":" d1 ","label":" Lab "}`))
	if err != nil {
		t.Fatal(err)
	}
	var ld localDirectoryRef
	if err := json.Unmarshal(local, &ld); err != nil {
		t.Fatal(err)
	}
	if ld.LocalPath != "/tmp/app" || ld.DaemonID != "d1" || ld.Label != "Lab" || ld.ExecutionMode != "in_place" {
		t.Fatalf("%+v", ld)
	}
	if _, err := validateLocalDirectoryRef(json.RawMessage(`{`)); err == nil {
		t.Fatal("expected bad json")
	}
	if _, err := validateLocalDirectoryRef(json.RawMessage(`{"local_path":"","daemon_id":"d"}`)); err == nil {
		t.Fatal("expected local_path")
	}
	if _, err := validateLocalDirectoryRef(json.RawMessage(`{"local_path":"/x","daemon_id":""}`)); err == nil {
		t.Fatal("expected daemon_id")
	}
	if _, err := validateLocalDirectoryRef(json.RawMessage(`{"local_path":"/x","daemon_id":"d","execution_mode":"container"}`)); err == nil {
		t.Fatal("expected execution_mode")
	}
	ok, err := validateLocalDirectoryRef(json.RawMessage(`{"local_path":"/x","daemon_id":"d","execution_mode":"worktree"}`))
	if err != nil || !strings.Contains(string(ok), "worktree") {
		t.Fatalf("%s %v", ok, err)
	}
}

func TestNormalizeResourceInputAndOptInt32(t *testing.T) {
	t.Parallel()

	if _, err := normalizeResourceInput(CreateProjectResourceInput{ResourceType: "nope", ResourceRef: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected type error")
	}
	if _, err := normalizeResourceInput(CreateProjectResourceInput{ResourceType: "", ResourceRef: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected required type")
	}
	pos := int32(3)
	got, err := normalizeResourceInput(CreateProjectResourceInput{
		ResourceType: "github_repo", ResourceRef: json.RawMessage(`{"url":"https://github.com/a/b"}`), Position: &pos,
	})
	if err != nil || got.Position != 3 || got.Type != "github_repo" {
		t.Fatalf("%+v %v", got, err)
	}
	got, err = normalizeResourceInput(CreateProjectResourceInput{
		ResourceType: "github_repo", ResourceRef: json.RawMessage(`{"url":"https://github.com/a/b"}`),
	})
	if err != nil || got.Position != 0 {
		t.Fatalf("default position %+v %v", got, err)
	}

	if optInt32(nil).Valid {
		t.Fatal("nil opt")
	}
	v := int32(9)
	o := optInt32(&v)
	if !o.Valid || o.Int32 != 9 {
		t.Fatalf("%+v", o)
	}
}
