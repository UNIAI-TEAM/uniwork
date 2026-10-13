package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

// The pod bound of A11 refuses the turn past its cap and gives the slot back
// on release; without Redis the shared bounds are dropped and this one still
// holds. The refusal carries the Retry-After the handler sets.
func TestAIUniworkConcurrencyBound(t *testing.T) {
	limiter := newUniworkConcurrency(nil, 1, UniworkOrgMax, UniworkGlobalMax, UniworkDeadline+10*time.Second)
	ctx := context.Background()
	release, err := limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}
	_, err = limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("Acquire past the pod bound = %v, want a CodedError", err)
	}
	if ce.Code != "ai_uniwork_busy" || ce.Status != http.StatusTooManyRequests {
		t.Fatalf("Acquire past the pod bound = %s/%d, want ai_uniwork_busy/429", ce.Code, ce.Status)
	}
	if retry, _ := ce.Fields["retry_after"].(int); retry != UniworkBusyRetryAfter {
		t.Fatalf("retry_after = %v, want %d", ce.Fields["retry_after"], UniworkBusyRetryAfter)
	}
	release()
	again, err := limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	if err != nil {
		t.Fatalf("Acquire after release: %v", err)
	}
	again()
}

// The module → format table is derived from the two tables the app already
// reads: every module it names is a genoffice web module, and every token is
// one of the per-format flags office_ai_uniwork_<token>.
func TestAIUniworkFormatTokens(t *testing.T) {
	modules := make(map[string]bool, len(officeFrameModules))
	for _, m := range officeFrameModules {
		modules[m.module] = true
	}
	formats := make(map[string]bool, len(officeAIUniworkFormats))
	for _, f := range officeAIUniworkFormats {
		formats[f] = true
	}
	for module, token := range uniworkModuleFormats {
		if !modules[module] {
			t.Errorf("uniworkModuleFormats names %q, which officeFrameModules does not know", module)
		}
		if !formats[token] {
			t.Errorf("uniworkModuleFormats maps %q to %q, which is not in officeAIUniworkFormats", module, token)
		}
		if got := uniworkFormatToken(module); got != token {
			t.Errorf("uniworkFormatToken(%q) = %q, want %q", module, got, token)
		}
	}
	if token := uniworkFormatToken("not-a-module"); token != "" {
		t.Fatalf("uniworkFormatToken of an unknown module = %q, want \"\" so only the kill switch applies", token)
	}
	for _, module := range []string{OfficeFrameModuleDocs, OfficeFrameModuleSheets} {
		if uniworkFormatToken(module) == "" {
			t.Errorf("module %q has no format token; a per-format flag would never be checked", module)
		}
	}
}
