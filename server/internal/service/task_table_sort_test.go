package service

import (
	"context"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// tableSortKey is the Go-side model of one row's sort value.
type tableSortKey struct {
	null bool
	f    float64
	s    string
}

func compareSortKeys(a, b tableSortKey) int {
	switch {
	case a.f < b.f:
		return -1
	case a.f > b.f:
		return 1
	}
	return strings.Compare(a.s, b.s)
}

// expectedTableOrder sorts tasks the way the table query does: nulls last in
// both directions, then created_at DESC, id DESC.
func expectedTableOrder(tasks []db.Task, key func(db.Task) tableSortKey, desc bool) []string {
	out := append([]db.Task(nil), tasks...)
	sort.SliceStable(out, func(i, j int) bool {
		a, b := key(out[i]), key(out[j])
		if a.null != b.null {
			return !a.null
		}
		if !a.null {
			if c := compareSortKeys(a, b); c != 0 {
				if desc {
					return c > 0
				}
				return c < 0
			}
		}
		ta, tb := out[i].CreatedAt.Time, out[j].CreatedAt.Time
		if !ta.Equal(tb) {
			return ta.After(tb)
		}
		return out[i].ID > out[j].ID
	})
	ids := make([]string, len(out))
	for i, task := range out {
		ids[i] = task.ID
	}
	return ids
}

func TestTableRowsSortsAcrossPages(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	numProp, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{Name: "Điểm", Type: "number"})
	if err != nil {
		t.Fatal(err)
	}
	dateProp, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{Name: "Hạn nội bộ", Type: "date"})
	if err != nil {
		t.Fatal(err)
	}

	specs := []struct{ title, due, status, priority, num, date string }{
		{"g", "2026-10-01", "todo", "high", "3.14159265358979", "2026-01-05"},
		{"a", "", "done", "low", "10", ""},
		{"e", "2026-09-20", "in_progress", "urgent", "-2.5", "2026-01-05"},
		{"c", "2026-10-01", "todo", "", "", "2025-12-31"},
		{"b", "", "in_progress", "medium", "3.14159265358979", "2026-03-01"},
		{"f", "2026-09-20", "done", "high", "0.1", ""},
		{"d", "2026-11-11", "todo", "", "100.000001", "2026-03-01"},
	}
	for _, sp := range specs {
		in := CreateTaskInput{Title: sp.title, Priority: sp.priority, Properties: map[string]json.RawMessage{}}
		if sp.due != "" {
			due := sp.due
			in.DueDate = &due
		}
		if sp.num != "" {
			in.Properties[numProp.ID] = json.RawMessage(sp.num)
		}
		if sp.date != "" {
			in.Properties[dateProp.ID] = json.RawMessage(strconv.Quote(sp.date))
		}
		task := mkTask(t, s, actor, w.ID, in)
		if sp.status != "todo" {
			setTableStatus(t, s, actor, task.ID, sp.status)
		}
	}

	base := allRows(t, s, actor, w.ID, TableRowsInput{})
	if len(base) != len(specs) {
		t.Fatalf("base rows = %d, want %d", len(base), len(specs))
	}
	tasks := make([]db.Task, len(base))
	for i, r := range base {
		tasks[i] = r.Task
	}

	statuses, err := s.q.ListTaskStatuses(ctx, db.ListTaskStatusesParams{OrganizationID: w.OrganizationID, WorkspaceID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	statusRank := map[string]float64{}
	for _, st := range statuses {
		statusRank[st.Key] = st.Position
	}
	priorityRank := map[string]float64{"urgent": 0, "high": 1, "medium": 2, "low": 3}
	propRaw := func(task db.Task, id string) (string, bool) {
		var props map[string]json.RawMessage
		_ = json.Unmarshal(task.Properties, &props)
		raw, ok := props[id]
		return string(raw), ok
	}

	withNum, withDate := 0, 0
	for _, task := range tasks {
		if _, ok := propRaw(task, numProp.ID); ok {
			withNum++
		}
		if _, ok := propRaw(task, dateProp.ID); ok {
			withDate++
		}
	}
	if withNum != 6 || withDate != 5 {
		t.Fatalf("stored property values: number=%d date=%d, want 6 and 5", withNum, withDate)
	}

	keys := map[string]func(db.Task) tableSortKey{
		"title":      func(x db.Task) tableSortKey { return tableSortKey{s: strings.ToLower(x.Title)} },
		"created_at": func(x db.Task) tableSortKey { return tableSortKey{f: float64(x.CreatedAt.Time.UnixMicro())} },
		"due_date": func(x db.Task) tableSortKey {
			if !x.DueDate.Valid {
				return tableSortKey{null: true}
			}
			return tableSortKey{f: float64(x.DueDate.Time.Unix())}
		},
		"priority": func(x db.Task) tableSortKey {
			r, ok := priorityRank[x.Priority]
			if !ok {
				r = 4
			}
			return tableSortKey{f: r}
		},
		"status": func(x db.Task) tableSortKey {
			r, ok := statusRank[x.Status]
			if !ok {
				r = 1e9
			}
			return tableSortKey{f: r}
		},
		"position": func(x db.Task) tableSortKey { return tableSortKey{f: x.Position} },
		"property:" + numProp.ID: func(x db.Task) tableSortKey {
			raw, ok := propRaw(x, numProp.ID)
			if !ok {
				return tableSortKey{null: true}
			}
			f, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				t.Fatalf("number %q: %v", raw, err)
			}
			return tableSortKey{f: f}
		},
		"property:" + dateProp.ID: func(x db.Task) tableSortKey {
			raw, ok := propRaw(x, dateProp.ID)
			if !ok {
				return tableSortKey{null: true}
			}
			v, _ := strconv.Unquote(raw)
			return tableSortKey{s: v}
		},
	}

	for field, key := range keys {
		for _, dir := range []string{"asc", "desc"} {
			rows := allRows(t, s, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{SortField: field, SortDir: dir}})
			got := rowIDs(rows)
			seen := map[string]bool{}
			for _, id := range got {
				if seen[id] {
					t.Fatalf("%s %s: duplicate id %s across pages", field, dir, id)
				}
				seen[id] = true
			}
			// Position sort ignores direction.
			desc := dir == "desc" && field != "position"
			want := expectedTableOrder(tasks, key, desc)
			if strings.Join(got, ",") != strings.Join(want, ",") {
				t.Fatalf("%s %s: got %v, want %v", field, dir, titlesOf(rows), titlesFor(tasks, want))
			}
		}
	}
}

func titlesOf(rows []TableRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Task.Title
	}
	return out
}

func titlesFor(tasks []db.Task, ids []string) []string {
	byID := map[string]string{}
	for _, task := range tasks {
		byID[task.ID] = task.Title
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = byID[id]
	}
	return out
}
