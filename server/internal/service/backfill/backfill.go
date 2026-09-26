// Package backfill is the T9b (UNI-747) engine behind cmd/files-backfill: it
// scans the pre-FileService locator columns, classifies each source row by
// the inventory-spec mapping rules (verified / unresolved / held / foreign /
// already_applied), and - in apply mode - mints the files + claimed-session
// pair and rewrites the business reference inside one transaction per batch.
//
// The contract it preserves:
//   - plan is read-only; it never opens a transaction that writes and never
//     touches an object store.
//   - One physical object gets exactly one files row: uidx_files_locator is
//     the anchor, so apply is get-or-create by (storage, bucket, object_key).
//   - A locator shared by two tenants is held, never merged; a locator
//     demonstrably not ours is foreign, never imported.
//   - Legacy/G0 objects stay owned by their legacy columns - a files row is a
//     new reference alongside them, not a transfer of custody, so no backfill
//     path ever deletes or rewrites the object or its legacy column.
//   - Checkpoint rows commit with the batch they describe, so a crash never
//     advances the cursor past unwritten work and resume replays batches
//     idempotently.
package backfill

import (
	"context"
	"fmt"
	"sort"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Cohort names; each maps to an inventory-spec section-9 mapping.
const (
	CohortTaskAttachments   = "task-attachments"   // M1 (M2 dedupe is same-locator)
	CohortAvatars           = "avatars"            // M8 (M9 external = foreign)
	CohortChatFiles         = "chat-files"         // M3
	CohortChatVoice         = "chat-voice"         // M4
	CohortMeetingRecordings = "meeting-recordings" // M5
	CohortCallRecordings    = "call-recordings"    // M6 (M7 call-log refs fold in)
	CohortAuditExports      = "audit-exports"      // M12
	CohortContentRefs       = "content-refs"       // M11: markdown/JSON reference evidence only
)

// cohorts lists every cohort the command knows, in spec order. Implemented
// toggles whether the cohort has a scanner yet — the Advisor's first slice is
// task-attachments only; the rest error loudly instead of silently skipping.
var cohorts = []struct {
	Name        string
	Implemented bool
}{
	{CohortTaskAttachments, true},
	{CohortAvatars, false},
	{CohortChatFiles, false},
	{CohortChatVoice, false},
	{CohortMeetingRecordings, false},
	{CohortCallRecordings, false},
	{CohortAuditExports, false},
	{CohortContentRefs, false},
}

// Class is the classification a source row gets. The names are the report's
// counts and file_backfill_items.status values.
type Class string

const (
	ClassVerified       Class = "verified"        // locator resolves, tenant proven — applyable
	ClassUnresolved     Class = "unresolved"      // cannot safely determine an outcome
	ClassHeld           Class = "held"            // conflicting or unsafe-to-automate evidence
	ClassForeign        Class = "foreign"         // demonstrably not an object we store
	ClassAlreadyApplied Class = "already_applied" // the business reference already carries a file_id
)

// Item is one source row's classification. In apply mode the same shape is
// persisted to file_backfill_items and becomes the mapping report.
type Item struct {
	Cohort         string `json:"cohort"`
	SourceTable    string `json:"source_table"`
	SourceID       string `json:"source_id"`
	Class          Class  `json:"class"`
	Reason         string `json:"reason,omitempty"`
	Storage        string `json:"storage,omitempty"`
	Bucket         string `json:"bucket,omitempty"`
	ObjectKey      string `json:"object_key,omitempty"`
	RawLocator     string `json:"raw_locator,omitempty"`
	OrganizationID string `json:"organization_id,omitempty"`
	WorkspaceID    string `json:"workspace_id,omitempty"`
	FileID         string `json:"file_id,omitempty"`
	Purpose        string `json:"purpose,omitempty"`
	Claimed        bool   `json:"claimed"`
	SharedLocator  bool   `json:"shared_locator,omitempty"`
	Filename       string `json:"filename,omitempty"`
	SizeBytes      int64  `json:"size_bytes"`
}

// locatorID is the dedup key: the files-table locator identity
// (storage, coalesce(bucket,”), object_key). plan resolves the backend only
// where the source column already names one, so an unresolved backend sorts
// under "" — attachments on local vs s3 can collide by key, which the shared
// check treats conservatively (same key, different scope = held either way).
func (it Item) locatorID() string {
	return it.Storage + "\x00" + it.Bucket + "\x00" + it.ObjectKey
}

func (it Item) scopeID() string {
	return it.OrganizationID + "\x00" + it.WorkspaceID
}

// CohortReport is one cohort's tally.
type CohortReport struct {
	Name            string         `json:"name"`
	RowsSeen        int            `json:"rows_seen"`
	Verified        int            `json:"verified"`
	Unresolved      int            `json:"unresolved"`
	Held            int            `json:"held"`
	Foreign         int            `json:"foreign"`
	AlreadyApplied  int            `json:"already_applied"`
	DistinctObjects int            `json:"distinct_objects"` // unique verified locators this cohort would write
	SharedLocators  int            `json:"shared_locators"`  // locators named by >1 scope — always held
	DuplicateRefs   int            `json:"duplicate_refs"`   // extra rows sharing one verified locator
	Reasons         map[string]int `json:"reasons,omitempty"`
	Items           []Item         `json:"items,omitempty"`
}

// Report is the deterministic machine-readable plan/dry-run/verify output.
type Report struct {
	Command string         `json:"command"`
	RunID   string         `json:"run_id,omitempty"`
	Cohorts []CohortReport `json:"cohorts"`
	Totals  CohortReport   `json:"totals"`
}

// Options selects what an engine run covers.
type Options struct {
	// Cohorts, empty = every implemented cohort.
	Cohorts []string
	// BatchSize bounds one keyset page (and one apply transaction).
	BatchSize int32
	// IncludeItems emits the per-row list, not just counts.
	IncludeItems bool
}

func (o *Options) normalize() {
	if o.BatchSize <= 0 {
		o.BatchSize = 500
	}
}

// Engine runs the subcommands against one database handle.
type Engine struct {
	q *db.Queries
}

func New(q *db.Queries) *Engine { return &Engine{q: q} }

// ResolveCohorts validates the selection: unknown names fail, known but not
// yet implemented names fail with the cohort's name so the error says what is
// missing rather than silently producing an empty report.
func ResolveCohorts(names []string) ([]string, error) {
	if len(names) == 0 {
		var out []string
		for _, c := range cohorts {
			if c.Implemented {
				out = append(out, c.Name)
			}
		}
		return out, nil
	}
	known := map[string]bool{}
	implemented := map[string]bool{}
	for _, c := range cohorts {
		known[c.Name] = true
		implemented[c.Name] = c.Implemented
	}
	out := make([]string, 0, len(names))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if !known[n] {
			return nil, fmt.Errorf("unknown cohort %q", n)
		}
		if !implemented[n] {
			return nil, fmt.Errorf("cohort %q is not implemented yet", n)
		}
		out = append(out, n)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no cohorts selected")
	}
	return out, nil
}

// Plan scans every selected cohort and classifies every row. Read-only: it
// issues SELECTs only and never opens the object store.
func (e *Engine) Plan(ctx context.Context, opts Options) (*Report, error) {
	opts.normalize()
	names, err := ResolveCohorts(opts.Cohorts)
	if err != nil {
		return nil, err
	}
	rep := &Report{Command: "plan"}
	for _, name := range names {
		cr, items, err := e.scanCohort(ctx, name, opts.BatchSize)
		if err != nil {
			return nil, fmt.Errorf("plan %s: %w", name, err)
		}
		// Items stay attached through the shared-locator pass, which rewrites
		// classes and re-tallies; they are dropped afterwards when the caller
		// asked for counts only.
		cr.Items = items
		rep.Cohorts = append(rep.Cohorts, *cr)
	}
	markSharedLocators(rep)
	tally(rep)
	if !opts.IncludeItems {
		for i := range rep.Cohorts {
			rep.Cohorts[i].Items = nil
		}
	}
	return rep, nil
}

// scanCohort pages through one cohort's source rows and classifies each.
func (e *Engine) scanCohort(ctx context.Context, cohort string, batch int32) (*CohortReport, []Item, error) {
	cr := &CohortReport{Name: cohort, Reasons: map[string]int{}}
	var items []Item
	after := ""
	for {
		var page []Item
		var err error
		switch cohort {
		case CohortTaskAttachments:
			page, err = e.scanAttachments(ctx, after, batch)
		default:
			err = fmt.Errorf("cohort %q is not implemented yet", cohort)
		}
		if err != nil {
			return nil, nil, err
		}
		if len(page) == 0 {
			break
		}
		for _, it := range page {
			cr.RowsSeen++
			countClass(cr, it)
			if it.Reason != "" {
				cr.Reasons[it.Reason]++
			}
			items = append(items, it)
			after = it.SourceID
		}
		if int32(len(page)) < batch {
			break
		}
	}
	return cr, items, nil
}

func countClass(cr *CohortReport, it Item) {
	switch it.Class {
	case ClassVerified:
		cr.Verified++
	case ClassUnresolved:
		cr.Unresolved++
	case ClassHeld:
		cr.Held++
	case ClassForeign:
		cr.Foreign++
	case ClassAlreadyApplied:
		cr.AlreadyApplied++
	}
}

// markSharedLocators is the cross-row pass: a locator named by rows with
// different verified scopes is cross-tenant shared and every reference to it
// is held — it is never merged into one tenant's file (spec §9 held rule).
// Rows that failed to classify keep their verdict; only verified items can
// become held here.
func markSharedLocators(rep *Report) {
	byLocator := map[string][]*Item{}
	for ci := range rep.Cohorts {
		for i := range rep.Cohorts[ci].Items {
			it := &rep.Cohorts[ci].Items[i]
			if it.Class == ClassVerified && it.ObjectKey != "" {
				byLocator[it.locatorID()] = append(byLocator[it.locatorID()], it)
			}
		}
	}
	// Re-tally per cohort after reclassification; also counts the locators
	// that were held for sharing and the in-scope duplicates.
	for ci := range rep.Cohorts {
		cr := &rep.Cohorts[ci]
		cr.Verified, cr.Held, cr.Unresolved, cr.Foreign, cr.AlreadyApplied = 0, 0, 0, 0, 0
		cr.Reasons = map[string]int{}
		cr.DistinctObjects, cr.DuplicateRefs, cr.SharedLocators = 0, 0, 0
		heldLocators := map[string]bool{}
		seen := map[string]bool{}
		for i := range cr.Items {
			it := &cr.Items[i]
			id := it.locatorID()
			group := byLocator[id]
			if it.Class == ClassVerified && it.ObjectKey != "" && len(group) > 0 {
				scopes := map[string]bool{}
				for _, g := range group {
					scopes[g.scopeID()] = true
				}
				if len(scopes) > 1 {
					it.Class = ClassHeld
					it.Reason = "cross_scope_shared_locator"
					it.SharedLocator = true
					heldLocators[id] = true
				} else if len(group) > 1 {
					it.SharedLocator = true
				}
			}
			countClass(cr, *it)
			if it.Reason != "" {
				cr.Reasons[it.Reason]++
			}
			if it.Class == ClassVerified && it.ObjectKey != "" {
				if seen[id] {
					cr.DuplicateRefs++
				} else {
					seen[id] = true
					cr.DistinctObjects++
				}
			}
		}
		cr.SharedLocators = len(heldLocators)
	}
}

func tally(rep *Report) {
	t := &rep.Totals
	t.Name = "totals"
	for _, cr := range rep.Cohorts {
		t.RowsSeen += cr.RowsSeen
		t.Verified += cr.Verified
		t.Unresolved += cr.Unresolved
		t.Held += cr.Held
		t.Foreign += cr.Foreign
		t.AlreadyApplied += cr.AlreadyApplied
		t.DistinctObjects += cr.DistinctObjects
		t.SharedLocators += cr.SharedLocators
		t.DuplicateRefs += cr.DuplicateRefs
	}
}

// Human renders the report as aligned plain text.
func (r *Report) Human() string {
	var b strings.Builder
	fmt.Fprintf(&b, "files-backfill %s\n", r.Command)
	fmt.Fprintf(&b, "%-20s %8s %8s %10s %6s %8s %15s %9s %9s\n",
		"cohort", "seen", "verified", "unresolved", "held", "foreign", "already_applied", "objects", "dup_refs")
	for _, c := range r.Cohorts {
		fmt.Fprintf(&b, "%-20s %8d %8d %10d %6d %8d %15d %9d %9d\n",
			c.Name, c.RowsSeen, c.Verified, c.Unresolved, c.Held, c.Foreign,
			c.AlreadyApplied, c.DistinctObjects, c.DuplicateRefs)
	}
	t := r.Totals
	fmt.Fprintf(&b, "%-20s %8d %8d %10d %6d %8d %15d %9d %9d\n",
		"TOTAL", t.RowsSeen, t.Verified, t.Unresolved, t.Held, t.Foreign,
		t.AlreadyApplied, t.DistinctObjects, t.DuplicateRefs)
	for _, c := range r.Cohorts {
		if len(c.Reasons) == 0 {
			continue
		}
		fmt.Fprintf(&b, "\n%s reasons:\n", c.Name)
		keys := make([]string, 0, len(c.Reasons))
		for k := range c.Reasons {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprintf(&b, "  %-32s %d\n", k, c.Reasons[k])
		}
	}
	return b.String()
}
