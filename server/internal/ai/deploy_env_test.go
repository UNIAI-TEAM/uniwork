package ai

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// checkDeployEnv resolves every capability against the env file at path and
// returns what is wrong. A provider that has no default for a capability
// (embedding on anthropic) leaves that capability off, not broken.
func checkDeployEnv(t *testing.T, path string) []string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	vars := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			vars[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	getenv := func(k string) string { return vars[k] }
	provider := vars["AI_PROVIDER"]
	var extra []string
	for _, m := range strings.Split(vars["AI_MODEL_ALLOW"], ",") {
		if m = strings.TrimSpace(m); m != "" {
			extra = append(extra, m)
		}
	}

	known := false
	for _, p := range policies {
		if _, ok := p.Default[provider]; ok {
			known = true
		}
	}
	if !known {
		return []string{fmt.Sprintf("AI_PROVIDER %q is not a provider with model defaults", provider)}
	}

	var problems []string
	q := db.New(testutil.DB(t))
	caps := make([]string, 0, len(policies))
	for c := range policies {
		caps = append(caps, string(c))
	}
	sort.Strings(caps)
	priced := 0
	for _, name := range caps {
		c := Capability(name)
		if _, ok := policies[c].Default[provider]; !ok {
			t.Logf("%s on %s: off (no default)", c, provider)
			continue
		}
		_, model, err := ResolveModel(c, provider, getenv, extra)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", c, err))
			continue
		}
		if override := modelOverride(c, provider, getenv); override != "" && model != override {
			problems = append(problems, fmt.Sprintf("%s: env asks %q but resolves to %q (outside allowlist, fell back to default)", c, override, model))
		}
		if provider == "anthropic" && strings.Contains(model, "/") {
			problems = append(problems, fmt.Sprintf("%s: anthropic model %q looks like an OpenRouter slug", c, model))
		}
		if _, err := q.AiLatestRate(context.Background(), db.AiLatestRateParams{
			Provider: provider, Model: model, EffectiveAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		}); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %s/%s has no rate: %v", c, provider, model, err))
			continue
		}
		priced++
		t.Logf("%s -> %s/%s priced", c, provider, model)
	}
	if priced == 0 {
		problems = append(problems, "no capability resolved to a priced model")
	}
	return problems
}

// TestDeployEnvResolvesPricedModels proves the production env file resolves
// every capability to the model it asks for (no silent fall back to the
// default) and that the model has a price.
func TestDeployEnvResolvesPricedModels(t *testing.T) {
	for _, p := range checkDeployEnv(t, "../../../deploy/app/env/uniwork-be.env") {
		t.Error(p)
	}
}

// An empty or mistyped AI_PROVIDER must fail, not pass with every capability off.
func TestDeployEnvRejectsUnknownProvider(t *testing.T) {
	for _, v := range []string{"", "off", "anthropc"} {
		path := filepath.Join(t.TempDir(), "x.env")
		if err := os.WriteFile(path, []byte("AI_PROVIDER="+v+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if len(checkDeployEnv(t, path)) == 0 {
			t.Errorf("AI_PROVIDER=%q passed", v)
		}
	}
}
