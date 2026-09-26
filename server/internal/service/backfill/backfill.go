// Package backfill is the T9b (UNI-747) engine behind cmd/files-backfill: it
// scans the pre-FileService locator columns, classifies each source row by
// the inventory-spec mapping rules (verified / unresolved / held / foreign /
// already_applied), and — in apply mode — mints the files + claimed-session
// pair and rewrites the business reference inside one transaction per batch.
//
// The contract it preserves:
//   - plan is read-only; it never opens a transaction that writes and never
//     touches an object store.
//   - One physical object gets exactly one files row: uidx_files_locator is
//     the anchor, so apply is get-or-create by (storage, bucket, object_key).
//   - A locator shared by two tenants is held, never merged; a locator
//     demonstrably not ours is foreign, never imported.
//   - Legacy/G0 objects stay owned by their legacy columns — a files row is a
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

	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Cohort names; each maps to an inventory-spec section-9 mapping.
const (
	CohortTaskAttachments   = "task-attachments"   // M1 (M2 dedupe is same-locator)
	CohortAvatars           = "avatars"            // M8 (M9 external = foreign)
	CohortChatFiles         = "chat-files"         // M3
	CohortChatVoice         = "chat-voice"         // M4
	CohortMeetingRecordings = "meeting-recordings" // M5
	CohortCallRecordings    = "call-recordings"    // M6 (+M7 call-log refs)
	CohortAuditExports      = "audit-exports"      // M12
	CohortContentRefs       = "content-refs"       // M11: markdown/JSON reference evidence only
)

// cohorts lists every cohort the command knows, in spec order.
var cohorts = []struct {
	Name string
}{
	{CohortTaskAttachments},
	{CohortAvatars},
	{CohortChatFiles},
	{CohortChatVoice},
	{CohortMeetingRecordings},
	{CohortCallRecordings},
	{CohortAuditExports},
	{CohortContentRefs},
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
	UserID         string `json:"user_id,omitempty"`
	FileID         string `json:"file_id,omitempty"`
	Purpose        string `json:"purpose,omitempty"`
	Claimed        bool   `json:"claimed"`
	SharedLocator  bool   `json:"shared_locator,omitempty"`
	Filename       string `json:"filename,omitempty"`
	SizeBytes      int64  `json:"size_bytes"`
	ContentType    string `json:"content_type,omitempty"`
	ActorID        string `json:"actor_id,omitempty"`
	ActorKind      string `json:"actor_kind,omitempty"`
	// Verdict is set by verify only; apply/plan leave it empty.
	Verdict string `json:"verdict,omitempty"`

	// Internal apply state — never serialized into the report.
	runID    string
	replaced bool
}

// locatorID is the dedup key: the files-table locator identity
// (storage, coalesce(bucket,”), object_key). plan resolves the backend only
// where the source column already names one, so an unresolved backend sorts
// under "" — the shared check treats identical keys under different scopes
// as a conflict either way, which is the conservative verdict.
func (it Item) locatorID() string {
	return it.Storage + "\x00" + it.Bucket + "\x00" + it.ObjectKey
}

func (it Item) scopeID() string {
	return it.OrganizationID + "\x00" + it.WorkspaceID + "\x00" + it.UserID
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
	// Verify-only tallies: per-verdict counts plus pass/fail buckets.
	Checks     map[string]int `json:"checks,omitempty"`
	VerifiedOK int            `json:"verified_ok,omitempty"`
	Failed     int            `json:"failed,omitempty"`
	Items      []Item         `json:"items,omitempty"`
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
	// Cohorts, empty = every cohort.
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

// scanFn pages one scan unit: cursor "" is the start, a "" next cursor is
// exhaustion. The cursor shape is owned by the unit (a row id for
// single-table units; "<table>\x00<id>" for content refs).
type scanFn func(ctx context.Context, cursor string, limit int32) (items []Item, next string, err error)

// Engine runs the subcommands against one database handle; resolver maps
// stored URL locators to storage authorities (nil-safe: URL cohorts then
// classify every URL row foreign, never silently verify).
type Engine struct {
	q        *db.Queries
	resolver *Resolver
	pool     *pgxpool.Pool
	stat     Statter
	defaults Defaults
}

func New(q *db.Queries, resolver *Resolver) *Engine {
	if resolver == nil {
		resolver = &Resolver{}
	}
	return &Engine{q: q, resolver: resolver}
}

// ResolveCohorts validates the selection; unknown names fail loudly.
func ResolveCohorts(names []string) ([]string, error) {
	if len(names) == 0 {
		out := make([]string, 0, len(cohorts))
		for _, c := range cohorts {
			out = append(out, c.Name)
		}
		return out, nil
	}
	known := map[string]bool{}
	for _, c := range cohorts {
		known[c.Name] = true
	}
	out := make([]string, 0, len(names))
	seen := map[string]bool{}
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if !known[n] {
			return nil, fmt.Errorf("unknown cohort %q", n)
		}
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no cohorts selected")
	}
	return out, nil
}

// unitsFor maps a cohort to the scans that feed it. The chat-messages unit
// emits items for three cohorts at once; items carry their own cohort tag so
// the engine attributes each to the right report column.
func (e *Engine) unitsFor(cohort string) []scanFn {
	switch cohort {
	case CohortTaskAttachments:
		return []scanFn{e.scanAttachments}
	case CohortAvatars:
		return []scanFn{e.scanAvatars}
	case CohortChatFiles, CohortChatVoice:
		return []scanFn{e.scanChat}
	case CohortMeetingRecordings:
		return []scanFn{e.scanMeetingRecordings}
	case CohortCallRecordings:
		return []scanFn{e.scanCallRecordings, e.scanChatCallLogRefs}
	case CohortAuditExports:
		return []scanFn{e.scanAuditExports}
	case CohortContentRefs:
		return []scanFn{e.scanContentRefs}
	default:
		return nil
	}
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
		items, err := e.scanAll(ctx, name, opts.BatchSize)
		if err != nil {
			return nil, fmt.Errorf("plan %s: %w", name, err)
		}
		if name == CohortCallRecordings {
			items = reconcileCallLogRefs(items)
		}
		rep.Cohorts = append(rep.Cohorts, CohortReport{Name: name, Items: items})
	}
	markSharedLocators(rep)
	for i := range rep.Cohorts {
		retally(&rep.Cohorts[i])
	}
	tally(rep)
	if !opts.IncludeItems {
		for i := range rep.Cohorts {
			rep.Cohorts[i].Items = nil
		}
	}
	return rep, nil
}

// scanAll walks a cohort's units to exhaustion, keeping only items the unit
// tagged for this cohort (the chat unit feeds three).
func (e *Engine) scanAll(ctx context.Context, cohort string, batch int32) ([]Item, error) {
	var items []Item
	for _, unit := range e.unitsFor(cohort) {
		cursor := ""
		for {
			page, next, err := unit(ctx, cursor, batch)
			if err != nil {
				return nil, err
			}
			for _, it := range page {
				if it.Cohort == cohort {
					items = append(items, it)
				}
			}
			if next == "" {
				break
			}
			cursor = next
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].SourceID < items[j].SourceID })
	return items, nil
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

// retally recomputes a cohort's counts from its items after the
// shared-locator pass rewrote classes.
func retally(cr *CohortReport) {
	cr.Verified, cr.Held, cr.Unresolved, cr.Foreign, cr.AlreadyApplied = 0, 0, 0, 0, 0
	cr.Reasons = map[string]int{}
	cr.DistinctObjects, cr.DuplicateRefs, cr.SharedLocators = 0, 0, 0
	cr.RowsSeen = len(cr.Items)
	seen := map[string]bool{}
	heldLocators := map[string]bool{}
	for _, it := range cr.Items {
		countClass(cr, it)
		if it.Reason != "" {
			cr.Reasons[it.Reason]++
		}
		if it.Class == ClassHeld && it.Reason == "cross_scope_shared_locator" {
			heldLocators[it.locatorID()] = true
		}
		// Content refs are evidence about another row's locator, never an
		// object claim of their own — they neither dedupe nor get deduped.
		if it.Cohort == CohortContentRefs {
			continue
		}
		if it.Class == ClassVerified && it.ObjectKey != "" {
			id := it.locatorID()
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

// markSharedLocators is the cross-row pass: a locator named by verified rows
// with different scopes (org, workspace or avatar user) is cross-scope shared
// and every reference to it is held — it is never merged into one scope's
// file (spec §9 held rule). Same-scope duplicates stay verified and dedupe.
func markSharedLocators(rep *Report) {
	byLocator := map[string][]*Item{}
	for ci := range rep.Cohorts {
		if rep.Cohorts[ci].Name == CohortContentRefs {
			continue // evidence rows, not object claims
		}
		for i := range rep.Cohorts[ci].Items {
			it := &rep.Cohorts[ci].Items[i]
			if it.Class == ClassVerified && it.ObjectKey != "" {
				byLocator[it.locatorID()] = append(byLocator[it.locatorID()], it)
			}
		}
	}
	for _, group := range byLocator {
		if len(group) < 2 {
			continue
		}
		scopes := map[string]bool{}
		for _, it := range group {
			scopes[it.scopeID()] = true
		}
		if len(scopes) > 1 {
			for _, it := range group {
				it.Class = ClassHeld
				it.Reason = "cross_scope_shared_locator"
				it.SharedLocator = true
			}
		} else {
			for _, it := range group {
				it.SharedLocator = true
			}
		}
	}
}

func tally(rep *Report) {
	// Reset so callers that re-classify items (dry-run stat pass, verify
	// verdicts) can tally again without double-counting.
	rep.Totals = CohortReport{}
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
	fmt.Fprintf(&b, "%-20s %8s %8s %10s %6s %8s %15s %9s %9s %7s\n",
		"cohort", "seen", "verified", "unresolved", "held", "foreign", "already_applied", "objects", "dup_refs", "shared")
	for _, c := range r.Cohorts {
		fmt.Fprintf(&b, "%-20s %8d %8d %10d %6d %8d %15d %9d %9d %7d\n",
			c.Name, c.RowsSeen, c.Verified, c.Unresolved, c.Held, c.Foreign,
			c.AlreadyApplied, c.DistinctObjects, c.DuplicateRefs, c.SharedLocators)
	}
	t := r.Totals
	fmt.Fprintf(&b, "%-20s %8d %8d %10d %6d %8d %15d %9d %9d %7d\n",
		"TOTAL", t.RowsSeen, t.Verified, t.Unresolved, t.Held, t.Foreign,
		t.AlreadyApplied, t.DistinctObjects, t.DuplicateRefs, t.SharedLocators)
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
