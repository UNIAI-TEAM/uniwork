package service

import "sort"

// Rows kept when an organization is deleted. Audit is append-only (ADR 0012).
// Invoices and payment intents are accounting documents. The dossier, the
// membership rows and the subscription stay so the erasure has something to
// point at; files are released through FileService instead of a raw delete.
// Outbox and the Work Graph are not business content: the graph is wiped by
// the projector, and the in-flight deletion event still sits in the outbox.
var tenantDeleteRetain = map[string]bool{
	"audit_events":                 true,
	"audit_exports":                true,
	"audit_retention_policies":     true,
	"billing_payment_intents":      true,
	"data_subject_requests":        true,
	"files":                        true,
	"graph_dirty":                  true,
	"graph_edges":                  true,
	"graph_node_facts":             true,
	"graph_nodes":                  true,
	"invoices":                     true,
	"organization_member_profiles": true,
	"organization_members":         true,
	"outbox_events":                true,
	"subscriptions":                true,
}

// tenantDeleteTables is every tenant table the deletion job removes.
// A table that is neither retained nor listed for export fails the
// classification test before it can reach this function.
func tenantDeleteTables() []string {
	seen := map[string]bool{}
	var out []string
	add := func(name string) {
		if tenantDeleteRetain[name] || seen[name] {
			return
		}
		seen[name] = true
		out = append(out, name)
	}
	for _, name := range tenantExportIncludedTables {
		add(name)
	}
	for name := range tenantExportExcluded {
		add(name)
	}
	sort.Strings(out)
	return out
}
