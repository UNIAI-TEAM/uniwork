package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

type byokPublicResolver struct{}

func (byokPublicResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
}

// The proxy's gates run in order — member, provider/route, entitlement,
// stored key — and only then is a vendor dialled. The dial hook fails, so
// the last case proves the stored key reached the gateway without any
// network traffic.
func TestAIBYOKServiceGates(t *testing.T) {
	f := newAICredentialFixture(t)
	gw := ai.NewGateway(f.q, nil, nil, nil, ai.Options{})
	dialled := 0
	gw.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
		Resolver: byokPublicResolver{},
		Dial: func(context.Context, string, string) (net.Conn, error) {
			dialled++
			return nil, errors.New("no network in tests")
		},
	}))
	ents := NewEntitlementService(f.pool, f.q)
	svc := NewAIBYOKService(f.orgs, ents, f.svc, gw)
	body := []byte(`{"model":"gpt-5.6-terra","messages":[]}`)

	if _, err := svc.Proxy(f.ctx, f.second.ID, f.orgID, "openai", ai.ProxyChatCompletions, ai.ProxySurfaceWeb, body, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member = %v, want not found", err)
	}
	for _, c := range []struct {
		provider string
		op       ai.ProxyOp
	}{{"codex", ai.ProxyChatCompletions}, {"genspark", ai.ProxyModels}, {"openai", ai.ProxyMessages}, {"anthropic", ai.ProxyGenerate}} {
		if _, err := svc.Proxy(f.ctx, f.owner.ID, f.orgID, c.provider, c.op, ai.ProxySurfaceWeb, body, nil); !errors.Is(err, ai.ErrProviderNotSupported) {
			t.Errorf("%s/%s = %v, want provider_not_supported", c.provider, c.op, err)
		}
	}
	noBox := NewAIBYOKService(f.orgs, ents, NewAICredentialService(f.pool, f.q, f.orgs, ents, nil), gw)
	if _, err := noBox.Proxy(f.ctx, f.owner.ID, f.orgID, "openai", ai.ProxyChatCompletions, ai.ProxySurfaceWeb, body, nil); err == nil {
		t.Fatal("without AI_CREDENTIAL_KEY = nil, want 503 ai_credentials_unavailable")
	} else if code, status := aiCredentialCode(err); code != "ai_credentials_unavailable" || status != http.StatusServiceUnavailable {
		t.Fatalf("without AI_CREDENTIAL_KEY = %s %d (%v), want ai_credentials_unavailable 503", code, status, err)
	}
	if _, err := svc.Proxy(f.ctx, f.owner.ID, f.orgID, "openai", ai.ProxyChatCompletions, ai.ProxySurfaceWeb, body, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no stored key = %v, want credential_missing", err)
	} else if code, status := aiCredentialCode(err); code != "credential_missing" || status != 404 {
		t.Fatalf("no stored key = %s %d", code, status)
	}

	if _, _, err := f.svc.SaveAICredential(f.ctx, Human(f.owner.ID), f.orgID, "openai", SaveAICredentialInput{APIKey: strPtr(testAIKey)}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.Proxy(f.ctx, f.owner.ID, f.orgID, "openai", ai.ProxyChatCompletions, ai.ProxySurfaceDesktop, body, nil)
	var aerr *ai.Error
	if !errors.As(err, &aerr) || aerr.Code != "provider_unreachable" || dialled == 0 {
		t.Fatalf("stored key = %v (dialled %d), want provider_unreachable after a dial", err, dialled)
	}

	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"office.ai_byok": false}'::jsonb WHERE organization_id = $1`, f.orgID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Proxy(f.ctx, f.owner.ID, f.orgID, "openai", ai.ProxyChatCompletions, ai.ProxySurfaceWeb, body, nil); !errors.Is(err, ErrEntitlementRequired) {
		t.Fatalf("without office.ai_byok = %v, want entitlement_required", err)
	}
}

// Status and Enabled report whether the person could use the BYOK proxy here:
// a non-member gets ErrNotFound, a member with the plan gets (true, ""), a
// missing credential store gets (false, "ai_credentials_unavailable"), a plan
// without office.ai_byok gets (false, "entitlement_required"), and nothing
// calls a vendor.
func TestAIBYOKServiceEnabled(t *testing.T) {
	f := newAICredentialFixture(t)
	gw := ai.NewGateway(f.q, nil, nil, nil, ai.Options{})
	ents := NewEntitlementService(f.pool, f.q)
	svc := NewAIBYOKService(f.orgs, ents, f.svc, gw)

	if ok, reason, err := svc.Status(f.ctx, f.second.ID, f.orgID); ok || reason != "" || !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member status = %v %q %v, want false \"\" ErrNotFound", ok, reason, err)
	}
	if ok, err := svc.Enabled(f.ctx, f.second.ID, f.orgID); ok || !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member = %v %v, want ErrNotFound", ok, err)
	}
	if ok, reason, err := svc.Status(f.ctx, f.owner.ID, f.orgID); !ok || reason != "" || err != nil {
		t.Fatalf("member with the plan status = %v %q %v, want true \"\" nil", ok, reason, err)
	}
	if ok, err := svc.Enabled(f.ctx, f.owner.ID, f.orgID); !ok || err != nil {
		t.Fatalf("member with the plan = %v %v, want true", ok, err)
	}
	for _, noStore := range []*AIBYOKService{
		NewAIBYOKService(f.orgs, ents, nil, gw),
		NewAIBYOKService(f.orgs, ents, NewAICredentialService(f.pool, f.q, f.orgs, ents, nil), gw),
	} {
		if ok, reason, err := noStore.Status(f.ctx, f.owner.ID, f.orgID); ok || reason != "ai_credentials_unavailable" || err != nil {
			t.Fatalf("no credential store status = %v %q %v, want false \"ai_credentials_unavailable\" nil", ok, reason, err)
		}
		if ok, err := noStore.Enabled(f.ctx, f.owner.ID, f.orgID); ok || err != nil {
			t.Fatalf("no credential store = %v %v, want false", ok, err)
		}
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"office.ai_byok": false}'::jsonb WHERE organization_id = $1`, f.orgID); err != nil {
		t.Fatal(err)
	}
	if ok, reason, err := svc.Status(f.ctx, f.owner.ID, f.orgID); ok || reason != "entitlement_required" || err != nil {
		t.Fatalf("without office.ai_byok status = %v %q %v, want false \"entitlement_required\" nil", ok, reason, err)
	}
	if ok, err := svc.Enabled(f.ctx, f.owner.ID, f.orgID); ok || err != nil {
		t.Fatalf("without office.ai_byok = %v %v, want false", ok, err)
	}
}
