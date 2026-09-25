package billing

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestFromConfig(t *testing.T) {
	t.Parallel()
	if got := FromConfig("manual"); got.Name() != "manual" {
		t.Fatalf("manual name: %q", got.Name())
	}
	if got := FromConfig("stripe"); got.Name() != "stripe" {
		t.Fatalf("stripe stub name: %q", got.Name())
	}
	if got := FromConfig("payos"); got.Name() != "payos" {
		t.Fatalf("payos stub name: %q", got.Name())
	}
	if got := FromConfig("typo"); got.Name() != "manual" {
		t.Fatalf("unknown falls back to manual: %q", got.Name())
	}
}

func TestManualProviderReturnsUnavailable(t *testing.T) {
	t.Parallel()
	var m Manual
	_, err := m.CreateCheckout(context.Background(), CheckoutInput{OrganizationID: "org", PlanCode: "pro"})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("checkout: %v", err)
	}
	_, err = m.ParseWebhook(&http.Request{})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("webhook: %v", err)
	}
}

func TestStubProviderReturnsUnavailable(t *testing.T) {
	t.Parallel()
	s := stub{name: "stripe"}
	if s.Name() != "stripe" {
		t.Fatal("name")
	}
	_, err := s.CreateCheckout(context.Background(), CheckoutInput{})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("checkout: %v", err)
	}
	_, err = s.ParseWebhook(&http.Request{})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("webhook: %v", err)
	}
}
