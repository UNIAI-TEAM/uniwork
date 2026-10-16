package ai

import (
	"bufio"
	"context"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDeployEnvResolvesPricedModels reads the production env file and proves
// every capability resolves to the model the file asks for (no silent fall back
// to the default) and that the model has a price. A provider that has no
// default for a capability (embedding on anthropic) is off, not an error.
func TestDeployEnvResolvesPricedModels(t *testing.T) {
	f, err := os.Open("../../../deploy/app/env/uniwork-be.env")
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

	q := db.New(testutil.DB(t))
	caps := make([]string, 0, len(policies))
	for c := range policies {
		caps = append(caps, string(c))
	}
	sort.Strings(caps)
	for _, name := range caps {
		c := Capability(name)
		if _, ok := policies[c].Default[provider]; !ok {
			t.Logf("%s on %s: off (no default)", c, provider)
			continue
		}
		_, model, err := ResolveModel(c, provider, getenv, extra)
		if err != nil {
			t.Errorf("%s: %v", c, err)
			continue
		}
		override := strings.TrimSpace(getenv("AI_MODEL_" + strings.ToUpper(name)))
		if override == "" && provider == "anthropic" {
			override = strings.TrimSpace(getenv("ANTHROPIC_MODEL"))
		}
		if override != "" && model != override {
			t.Errorf("%s: env asks %q but resolves to %q (outside allowlist, fell back to default)", c, override, model)
		}
		if provider == "anthropic" && strings.Contains(model, "/") {
			t.Errorf("%s: anthropic model %q looks like an OpenRouter slug", c, model)
		}
		if _, err := q.AiLatestRate(context.Background(), db.AiLatestRateParams{
			Provider: provider, Model: model, EffectiveAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		}); err != nil {
			t.Errorf("%s: %s/%s has no rate: %v", c, provider, model, err)
			continue
		}
		t.Logf("%s -> %s/%s priced", c, provider, model)
	}
}
