// Package billing is the payment-provider boundary (spec F-02 §4.5). It never
// imports service and never writes the database: a provider parses a webhook
// or opens a checkout and returns the result; BillingService is the only
// writer of subscriptions.
package billing

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// ErrProviderUnavailable: the configured provider cannot do this (manual has
// no checkout; stripe/payos are stubs until C-04).
var ErrProviderUnavailable = errors.New("billing_provider_unavailable")

type CheckoutInput struct {
	OrganizationID string
	PlanCode       string
	CustomerEmail  string
	SuccessURL     string
	CancelURL      string
}

type CheckoutSession struct {
	URL string
}

// InvoiceData is the invoice half of a provider event.
type InvoiceData struct {
	ProviderInvoiceID string
	Status            string
	AmountDue         int64
	AmountPaid        int64
	Currency          string
	HostedURL         string
}

// Event is a provider callback normalised to what BillingService understands.
type Event struct {
	ProviderEventID string
	Type            string // subscription.activated | subscription.updated | subscription.canceled | invoice.paid | invoice.failed
	OrganizationID  string
	PlanCode        string
	PeriodStart     time.Time
	PeriodEnd       time.Time
	Invoice         *InvoiceData
}

type Provider interface {
	Name() string
	// CreateCheckout returns the URL an organization owner pays at.
	CreateCheckout(ctx context.Context, in CheckoutInput) (CheckoutSession, error)
	// ParseWebhook verifies the signature and normalises the body. No DB.
	ParseWebhook(r *http.Request) (Event, error)
}

// Manual is always available: a platform admin changes plans by hand.
type Manual struct{}

func (Manual) Name() string { return "manual" }
func (Manual) CreateCheckout(context.Context, CheckoutInput) (CheckoutSession, error) {
	return CheckoutSession{}, ErrProviderUnavailable
}
func (Manual) ParseWebhook(*http.Request) (Event, error) { return Event{}, ErrProviderUnavailable }

// stub stands in for stripe and payos (OPEN_QUESTIONS B2) until C-04 wires
// the real adapters; it keeps the configuration surface stable.
type stub struct{ name string }

func (s stub) Name() string { return s.name }
func (stub) CreateCheckout(context.Context, CheckoutInput) (CheckoutSession, error) {
	return CheckoutSession{}, ErrProviderUnavailable
}
func (stub) ParseWebhook(*http.Request) (Event, error) { return Event{}, ErrProviderUnavailable }

// FromConfig picks the provider named by BILLING_PROVIDER; unknown names fall
// back to manual so a typo cannot open a payment path.
func FromConfig(name string) Provider {
	switch name {
	case "stripe", "payos":
		return stub{name: name}
	}
	return Manual{}
}
