package service

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"
)

// The model reads a status the way the web shows it, with no key beside it
// (UNI-2137): a Vietnamese answer then says "Cần làm", never "todo". A key next
// to the label was copied into answers as "Cần làm (todo)" (UNI-2150). A
// priority reads the same way: answers said "Mức ưu tiên: none" (UNI-2151).
func TestAskAgentStatusesAndPrioritiesReadAsTheWebShowsThem(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	if _, err := s.tasks.CreateTaskStatus(ctx, Human(x.ua.ID), x.w.ID, CreateTaskStatusInput{Key: "qa_check", Name: "Chờ QA", Category: "in_review", Color: "#8b5cf6"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: "Kiểm thử biểu mẫu", Status: "qa_check", Priority: "high"}); err != nil {
		t.Fatal(err)
	}
	pr, err := s.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Website mới"})
	if err != nil {
		t.Fatal(err)
	}
	x.meeting(t, x.ua.ID, x.w.ID, "Họp giao ban", "")

	for _, c := range []struct{ tool, args string }{
		{"list_tasks", `{"status":"","project_id":"","assignee_id":"","priority":"","due_from":"","due_to":"","overdue":false,"limit":0}`},
		{"get_task", `{"task":"` + x.taskID + `"}`},
		{"list_projects", `{"query":"","include_closed":false}`},
		{"get_project", `{"project_id":"` + pr.ID + `"}`},
		{"list_meetings", `{"from":"","to":"","hosted_by_me":false,"status":""}`},
		{"search", `{"query":"Chuẩn bị báo cáo quý"}`},
	} {
		var b strings.Builder
		for _, it := range runAgentTool(t, s, tc, c.tool, c.args) {
			b.WriteString(it.Text + "\n")
		}
		text := b.String()
		want := map[string][]string{
			"list_tasks":    {"Status: Cần làm\n", "Status: Chờ QA\n", "Priority: Cao\n", "Priority: Không ưu tiên\n"},
			"get_task":      {"Status: Cần làm\n", "Priority: Không ưu tiên\n"},
			"list_projects": {"Status: Đã lên kế hoạch\n", "Priority: Không ưu tiên\n"},
			"get_project":   {"Status: Đã lên kế hoạch\n", "Priority: Không ưu tiên\n"},
			"list_meetings": {"Status: Đã lên lịch\n"},
			"search":        {"Trạng thái: Cần làm · Ưu tiên: Không ưu tiên"},
		}[c.tool]
		for _, w := range want {
			if !strings.Contains(text, w) {
				t.Errorf("%s does not say %q:\n%s", c.tool, w, text)
			}
		}
		if raw := rawWords(labelLines(text), append(rawLabelKeys(), "qa_check")); len(raw) > 0 {
			t.Errorf("%s hands the model the raw %v with a status or priority:\n%s", c.tool, raw, text)
		}
	}
}

// With no key in sight, the model filters by the label it read: a custom
// status by its name, a built-in by the web's label, in any case (UNI-2150).
// The key still works.
func TestAskAgentListTasksFiltersByTheStatusLabel(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	ctx := context.Background()
	if _, err := s.tasks.CreateTaskStatus(ctx, Human(x.ua.ID), x.w.ID, CreateTaskStatusInput{Key: "qa_check", Name: "Chờ QA", Category: "in_review", Color: "#8b5cf6"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.tasks.Create(ctx, Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: "Kiểm thử biểu mẫu", Status: "qa_check"}); err != nil {
		t.Fatal(err)
	}
	titles := func(status string) string {
		var got []string
		for _, it := range runAgentTool(t, s, tc, "list_tasks", `{"status":"`+status+`","project_id":"","assignee_id":"","priority":"","due_from":"","due_to":"","overdue":false,"limit":0}`) {
			got = append(got, it.Title)
		}
		return strings.Join(got, ", ")
	}
	todo := titles("todo")
	if todo == "" {
		t.Fatal("the world has no todo task to filter by")
	}
	for status, want := range map[string]string{"Chờ QA": "Kiểm thử biểu mẫu", "chờ qa": "Kiểm thử biểu mẫu", "qa_check": "Kiểm thử biểu mẫu", "Cần làm": todo} {
		if got := titles(status); got != want {
			t.Errorf("list_tasks status %q = [%s], want [%s]", status, got, want)
		}
	}
}

// The model filters by the priority label it read as well as by the key, in
// any case (UNI-2151).
func TestAskAgentListTasksFiltersByThePriorityLabel(t *testing.T) {
	x, s, tc := newAgentWorld(t)
	if _, err := s.tasks.Create(context.Background(), Human(x.ua.ID), x.w.ID, CreateTaskInput{Title: "Kiểm thử biểu mẫu", Priority: "high"}); err != nil {
		t.Fatal(err)
	}
	titles := func(priority string) string {
		var got []string
		for _, it := range runAgentTool(t, s, tc, "list_tasks", `{"status":"","project_id":"","assignee_id":"","priority":"`+priority+`","due_from":"","due_to":"","overdue":false,"limit":0}`) {
			got = append(got, it.Title)
		}
		return strings.Join(got, ", ")
	}
	none := titles("none")
	if none == "" {
		t.Fatal("the world has no task without a priority to filter by")
	}
	for priority, want := range map[string]string{"Cao": "Kiểm thử biểu mẫu", "cao": "Kiểm thử biểu mẫu", "high": "Kiểm thử biểu mẫu", "Không ưu tiên": none} {
		if got := titles(priority); got != want {
			t.Errorf("list_tasks priority %q = [%s], want [%s]", priority, got, want)
		}
	}
}

// The labels are the web's (useStatusCatalog, the project and meeting badges):
// a renamed key in vi.json fails here before a Vietnamese answer drifts from the UI.
func TestAskStatusLabelsMatchTheWeb(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/core/i18n/locales/vi.json")
	if err != nil {
		t.Fatal(err)
	}
	var vi struct {
		Tasks    map[string]any `json:"tasks"`
		Meetings map[string]any `json:"meetings"`
		Projects struct {
			Status   map[string]string `json:"status"`
			Priority map[string]string `json:"priority"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(raw, &vi); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name   string
		labels map[string]string
		web    func(key string) any
	}{
		{"tasks.status_", viTaskStatus, func(k string) any { return vi.Tasks["status_"+k] }},
		{"projects.status.", viProjectStatus, func(k string) any { return vi.Projects.Status[k] }},
		{"meetings.status_", viMeetingStatus, func(k string) any { return vi.Meetings["status_"+k] }},
		{"tasks.priority_", viPriority, func(k string) any { return vi.Tasks["priority_"+k] }},
		{"projects.priority.", viPriority, func(k string) any { return vi.Projects.Priority[k] }},
	} {
		for key, label := range c.labels {
			if got := c.web(key); got != label {
				t.Errorf("%s%s = %v in vi.json, server says %q", c.name, key, got, label)
			}
		}
	}
	for _, st := range BuiltInTaskStatuses() {
		if viTaskStatus[st.Key] == "" {
			t.Errorf("built-in status %q has no label", st.Key)
		}
	}
	for _, st := range validProjectStatuses {
		if viProjectStatus[st] == "" {
			t.Errorf("project status %q has no label", st)
		}
	}
	for _, p := range append(slices.Collect(maps.Keys(validPriority)), validProjectPriorities...) {
		if viPriority[p] == "" {
			t.Errorf("priority %q has no label", p)
		}
	}
}

func TestRawWordsMatchWholeWordsOnly(t *testing.T) {
	words := []string{"todo", "in_progress", "done"}
	for answer, want := range map[string]string{
		"Banner Tết đang todo.":             "todo",
		"todo":                              "todo",
		"(in_progress), hạn hôm qua":        "in_progress",
		"Banner Tết Cần làm, hạn 21/10":     "",
		"todolist và in_progress_x, undone": "",
	} {
		if got := strings.Join(rawWords(answer, words), ","); got != want {
			t.Errorf("rawWords(%q) = %q, want %q", answer, got, want)
		}
	}
}
