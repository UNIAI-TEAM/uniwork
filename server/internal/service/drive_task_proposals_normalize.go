package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

const (
	driveMaxProposalItems          = 20
	driveMaxProposalChecklistItems = 10
	driveMaxProposalQuoteRunes     = 300
)

// Drive task proposal statuses (spec §6.5, sdo/drive_codes.go).
const (
	DriveProposalStatusReady     = "ready"
	DriveProposalStatusConverted = "converted"
	DriveProposalStatusDiscarded = "discarded"
)

// Drive assignee access states on DriveTaskProposalItem (spec §8.2, sdo/drive_codes.go).
const (
	DriveAssigneeAccessGranted = "granted"
	DriveAssigneeAccessUnknown = "unknown"
)

// DriveProposalExcerpt is the source section and quote UNI extracted for one
// proposed task (spec §8.2). Its JSON shape matches sdo.DriveProposalExcerptDTO.
type DriveProposalExcerpt struct {
	Section string `json:"section"`
	Quote   string `json:"quote"`
}

// DriveDuplicateTask identifies an open task that may duplicate a proposed task
// title (spec §8.2, §8.4). Its JSON shape matches sdo.DriveDuplicateTaskDTO.
type DriveDuplicateTask struct {
	TaskID     string `json:"task_id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
}

// DriveTaskProposalItem is the service-layer item stored in drive_task_proposals.items
// and returned on GET/POST proposal responses (spec §6.5, §8.2, seam §2).
// Its JSON shape matches sdo.DriveTaskProposalItemDTO byte-for-byte.
type DriveTaskProposalItem struct {
	Index               int                  `json:"index"`
	Title               string               `json:"title"`
	AssigneeMemberID    *string              `json:"assignee_member_id,omitempty"`
	AssigneeBasis       string               `json:"assignee_basis,omitempty"`
	AssigneeDriveAccess string               `json:"assignee_drive_access,omitempty"`
	Priority            string               `json:"priority,omitempty"`
	PriorityBasis       string               `json:"priority_basis,omitempty"`
	StartDate           *string              `json:"start_date,omitempty"`
	StartBasis          string               `json:"start_basis,omitempty"`
	DueDate             *string              `json:"due_date,omitempty"`
	DueBasis            string               `json:"due_basis,omitempty"`
	LabelIDs            []string             `json:"label_ids"`
	LabelBasis          string               `json:"label_basis,omitempty"`
	Goal                string               `json:"goal"`
	Checklist           []string             `json:"checklist"`
	Excerpt             DriveProposalExcerpt `json:"excerpt"`
	BlockedByIndexes    []int                `json:"blocked_by_indexes"`
	PossibleDuplicate   *DriveDuplicateTask  `json:"possible_duplicate,omitempty"`
}

// driveProposalRawExcerpt is the raw excerpt decoded from drive_task_proposals@1 output.
type driveProposalRawExcerpt struct {
	Section string `json:"section"`
	Quote   string `json:"quote"`
}

// driveProposalRawItem is one raw item decoded from drive_task_proposals@1 output
// before server normalization (spec §8.2 steps 4-5).
type driveProposalRawItem struct {
	Title            string                  `json:"title"`
	AssigneeMemberID string                  `json:"assignee_member_id"`
	AssigneeBasis    string                  `json:"assignee_basis"`
	Priority         string                  `json:"priority"`
	PriorityBasis    string                  `json:"priority_basis"`
	StartDate        string                  `json:"start_date"`
	StartBasis       string                  `json:"start_basis"`
	DueDate          string                  `json:"due_date"`
	DueBasis         string                  `json:"due_basis"`
	LabelIDs         []string                `json:"label_ids"`
	LabelBasis       string                  `json:"label_basis"`
	Goal             string                  `json:"goal"`
	Checklist        []string                `json:"checklist"`
	Excerpt          driveProposalRawExcerpt `json:"excerpt"`
	BlockedByIndexes []int                   `json:"blocked_by_indexes"`
}

// parseDriveProposalRawItems decodes the JSON output of drive_task_proposals@1
// and returns ai.ErrOutputInvalid when the output is not a JSON object with an
// "items" array or fails to decode (contract §2.4).
func parseDriveProposalRawItems(text string) ([]driveProposalRawItem, error) {
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("%w: no JSON object in response", ai.ErrOutputInvalid)
	}
	var payload struct {
		Items *[]*driveProposalRawItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(text[start:end+1]), &payload); err != nil {
		return nil, fmt.Errorf("%w: %w", ai.ErrOutputInvalid, err)
	}
	if payload.Items == nil {
		return nil, fmt.Errorf("%w: missing items array", ai.ErrOutputInvalid)
	}
	out := make([]driveProposalRawItem, len(*payload.Items))
	for i, item := range *payload.Items {
		if item != nil {
			out[i] = *item
		}
	}
	return out, nil
}

// normalizeDriveProposalItems normalizes the model's raw task proposal items
// (spec §8.2 step 5, contract §2.5, seam §2):
//   - drops items with an empty title first, caps at 20 items, and assigns
//     dense 0-based indexes 0..n-1;
//   - translates blocked_by_indexes from raw item coordinates into dense
//     0..n-1 indexes (dropping references to empty-title or capped-out items)
//     before removing out-of-range, self-referential, duplicate, or cycle edges;
//   - drops assignee_member_id and label_ids not present in the workspace maps;
//   - drops start_date and due_date that are not valid YYYY-MM-DD dates;
//   - clears priority outside low|medium|high|urgent;
//   - clears the corresponding *_basis whenever a field is empty or dropped;
//   - truncates excerpt.quote to 300 runes and checklist to 10 items.
func normalizeDriveProposalItems(raw []driveProposalRawItem, members map[string]bool, labels map[string]bool) []DriveTaskProposalItem {
	type keptRaw struct {
		rawIndex int
		item     driveProposalRawItem
	}
	kept := make([]keptRaw, 0, min(len(raw), driveMaxProposalItems))
	rawToDense := make(map[int]int, min(len(raw), driveMaxProposalItems))
	for rawIdx, r := range raw {
		title := strings.TrimSpace(r.Title)
		if title == "" {
			continue
		}
		r.Title = title
		rawToDense[rawIdx] = len(kept)
		kept = append(kept, keptRaw{rawIndex: rawIdx, item: r})
		if len(kept) == driveMaxProposalItems {
			break
		}
	}

	n := len(kept)
	out := make([]DriveTaskProposalItem, n)
	rawBlocked := make([][]int, n)

	for i, kr := range kept {
		r := kr.item
		rawBlocked[i] = r.BlockedByIndexes
		var assigneeID *string
		var assigneeBasis string
		if id := strings.TrimSpace(r.AssigneeMemberID); id != "" && members[id] {
			assigneeID = &id
			assigneeBasis = strings.TrimSpace(r.AssigneeBasis)
		}

		var priority, priorityBasis string
		if p := normalizeDriveProposalPriority(r.Priority); p != "" {
			priority = p
			priorityBasis = strings.TrimSpace(r.PriorityBasis)
		}

		var startDate *string
		var startBasis string
		if d, ok := normalizeDriveProposalDate(r.StartDate); ok {
			startDate = &d
			startBasis = strings.TrimSpace(r.StartBasis)
		}

		var dueDate *string
		var dueBasis string
		if d, ok := normalizeDriveProposalDate(r.DueDate); ok {
			dueDate = &d
			dueBasis = strings.TrimSpace(r.DueBasis)
		}

		labelIDs := make([]string, 0, len(r.LabelIDs))
		seenLabels := make(map[string]bool, len(r.LabelIDs))
		for _, lid := range r.LabelIDs {
			lid = strings.TrimSpace(lid)
			if lid == "" || !labels[lid] || seenLabels[lid] {
				continue
			}
			seenLabels[lid] = true
			labelIDs = append(labelIDs, lid)
		}
		var labelBasis string
		if len(labelIDs) > 0 {
			labelBasis = strings.TrimSpace(r.LabelBasis)
		}

		checklist := make([]string, 0, min(len(r.Checklist), driveMaxProposalChecklistItems))
		for _, step := range r.Checklist {
			step = strings.TrimSpace(step)
			if step == "" {
				continue
			}
			checklist = append(checklist, step)
			if len(checklist) == driveMaxProposalChecklistItems {
				break
			}
		}

		out[i] = DriveTaskProposalItem{
			Index:            i,
			Title:            r.Title,
			AssigneeMemberID: assigneeID,
			AssigneeBasis:    assigneeBasis,
			Priority:         priority,
			PriorityBasis:    priorityBasis,
			StartDate:        startDate,
			StartBasis:       startBasis,
			DueDate:          dueDate,
			DueBasis:         dueBasis,
			LabelIDs:         labelIDs,
			LabelBasis:       labelBasis,
			Goal:             strings.TrimSpace(r.Goal),
			Checklist:        checklist,
			Excerpt: DriveProposalExcerpt{
				Section: strings.TrimSpace(r.Excerpt.Section),
				Quote:   truncateRunes(strings.TrimSpace(r.Excerpt.Quote), driveMaxProposalQuoteRunes),
			},
			BlockedByIndexes: []int{},
		}
	}

	// Translate blocked_by_indexes from raw coordinates to dense indexes, then
	// drop unmapped (dropped/capped), out-of-range, self, duplicates, and any
	// edge that would close a cycle in the accepted dependency graph.
	adj := make([][]int, n)
	for i := range n {
		seen := make(map[int]bool, len(rawBlocked[i]))
		cleaned := make([]int, 0, len(rawBlocked[i]))
		for _, rawDep := range rawBlocked[i] {
			dep, ok := rawToDense[rawDep]
			if !ok || dep < 0 || dep >= n || dep == i || seen[dep] {
				continue
			}
			if driveProposalReachable(adj, dep, i) {
				continue
			}
			seen[dep] = true
			cleaned = append(cleaned, dep)
			adj[i] = append(adj[i], dep)
		}
		out[i].BlockedByIndexes = cleaned
	}

	return out
}

func normalizeDriveProposalPriority(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "low", "medium", "high", "urgent":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return ""
	}
}

func normalizeDriveProposalDate(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	if len(s) != len("2006-01-02") {
		return "", false
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s {
		return "", false
	}
	return s, true
}

func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes])
}

// driveProposalReachable reports whether start can reach target following
// directed edges in adj.
func driveProposalReachable(adj [][]int, start, target int) bool {
	if start == target {
		return true
	}
	visited := make([]bool, len(adj))
	stack := []int{start}
	visited[start] = true
	for len(stack) > 0 {
		curr := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, next := range adj[curr] {
			if next == target {
				return true
			}
			if !visited[next] {
				visited[next] = true
				stack = append(stack, next)
			}
		}
	}
	return false
}

// ErrDriveSourceChanged is returned when the Drive file, caller access row, or
// bound connection changed while generating or converting a proposal (spec §8.2 step 6, §8.2b).
var ErrDriveSourceChanged = errors.New("drive source changed")
