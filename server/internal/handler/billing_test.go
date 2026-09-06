package handler

import "testing"

// The owner reads the default subscription with usage, cannot buy a paid
// plan without a provider, and gets a stable 409 on a stale row_version.
func TestBillingEndpoints(t *testing.T) {
	w := newAuditWorld(t)

	res, out := doJSON(t, w.srv, "GET", "/api/v1/plans", w.token, nil)
	if res.StatusCode != 200 || len(out["plans"].([]any)) < 1 {
		t.Fatalf("list plans: %d %v", res.StatusCode, out)
	}
	defaultPlan := out["plans"].([]any)[0].(map[string]any)

	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/billing", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get subscription: %d %v", res.StatusCode, out)
	}
	sub := out["subscription"].(map[string]any)
	if sub["plan_code"] != defaultPlan["code"] || sub["status"] != "active" || sub["row_version"].(float64) != 1 {
		t.Fatalf("default subscription: %v", sub)
	}
	var members map[string]any
	for _, e := range out["entitlements"].([]any) {
		if m := e.(map[string]any); m["feature_key"] == "members.max" {
			members = m
		}
	}
	if members == nil || members["current_usage"].(float64) != 1 || members["quota_limit"] != nil {
		t.Fatalf("members.max entitlement: %v", members)
	}

	res, out = doJSON(t, w.srv, "PATCH", "/api/v1/orgs/"+w.orgID+"/billing/plan", w.token,
		map[string]any{"plan_code": defaultPlan["code"], "row_version": 7})
	if res.StatusCode != 409 || out["error"].(map[string]any)["code"] != "version_conflict" {
		t.Fatalf("stale version: %d %v", res.StatusCode, out)
	}
	fields := out["error"].(map[string]any)["fields"].(map[string]any)
	if fields["expected"].(float64) != 7 || fields["actual"].(float64) != 1 {
		t.Fatalf("version_conflict fields: %v", fields)
	}

	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/billing/cancel", w.token, nil)
	if res.StatusCode != 200 || out["subscription"].(map[string]any)["cancel_at"] == nil {
		t.Fatalf("cancel: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/billing/resume", w.token, nil)
	if res.StatusCode != 200 || out["subscription"].(map[string]any)["cancel_at"] != nil {
		t.Fatalf("resume: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+w.orgID+"/billing/checkout", w.token,
		map[string]string{"plan_code": defaultPlan["code"].(string), "success_path": "/x", "cancel_path": "/y"})
	if res.StatusCode != 503 || out["error"].(map[string]any)["code"] != "billing_provider_unavailable" {
		t.Fatalf("checkout on manual: %d %v", res.StatusCode, out)
	}

	// Someone outside the organization sees nothing.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "stranger@example.com", "password": "password123", "display_name": "Stranger",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register stranger: %d %v", res.StatusCode, out)
	}
	stranger := out["access_token"].(string)
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/billing", stranger, nil)
	if res.StatusCode != 403 {
		t.Fatalf("stranger reads billing: %d", res.StatusCode)
	}
}
