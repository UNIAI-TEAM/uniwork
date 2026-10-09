package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// byokCredentialResolver decrypts the caller's stored key for one provider
// (AICredentialService, UNI-1008 W1). ErrNotFound when none is stored.
type byokCredentialResolver interface {
	Resolve(ctx context.Context, userID, orgID, provider string) (ai.BYOKCredential, error)
}

type byokEntitlements interface {
	Can(ctx context.Context, orgID, feature string) error
}

// AIBYOKService is the web host's door to a vendor with the person's own
// key (ADR 0029): the gates run here, the bytes move in ai.Gateway. Nothing
// is written but the usage row; a proxied call never touches business data.
type AIBYOKService struct {
	orgs  *OrganizationService
	ents  byokEntitlements
	creds byokCredentialResolver
	gw    *ai.Gateway
}

// NewAIBYOKService: creds nil answers credential_missing for every call
// until the credential store is wired.
func NewAIBYOKService(orgs *OrganizationService, ents byokEntitlements, creds byokCredentialResolver, gw *ai.Gateway) *AIBYOKService {
	return &AIBYOKService{orgs: orgs, ents: ents, creds: creds, gw: gw}
}

// Proxy runs the gates in order — organization member, provider/route
// match, plan entitlement, stored key — then hands the call to the gateway.
// The caller copies the returned stream to the client and closes it.
func (s *AIBYOKService) Proxy(ctx context.Context, userID, orgID, providerID string, op ai.ProxyOp, body json.RawMessage) (*ai.ProxyStream, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return nil, err
	}
	p, ok := provider.LookupBYOKProvider(providerID)
	if !ok || !ai.ProxyOpFits(op, p.Protocol) {
		return nil, ai.ErrProviderNotSupported
	}
	if err := s.ents.Can(ctx, orgID, FeatureOfficeAIBYOK); err != nil {
		return nil, err
	}
	if s.creds == nil {
		return nil, errCredentialMissing()
	}
	cred, err := s.creds.Resolve(ctx, userID, orgID, providerID)
	if errors.Is(err, ErrNotFound) {
		return nil, errCredentialMissing()
	}
	if err != nil {
		return nil, err
	}
	return s.gw.Proxy(ctx, ai.ProxyRequest{
		Actor: Human(userID), OrganizationID: orgID, Credential: cred, Op: op, Body: body,
	})
}
