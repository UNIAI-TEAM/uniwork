package service

import (
	"context"
	"maps"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The Vietnamese labels the web shows for status keys
// (packages/core/i18n/locales/vi.json: tasks.status_*, projects.status.*,
// meetings.status_*). Ask UNI hands them to the model in place of the key, so a
// Vietnamese answer reads like the screen instead of saying "todo" (UNI-2137).
// No key rides beside a label: the model copied it as "Cần làm (todo)" (UNI-2150).
// TestAskStatusLabelsMatchTheWeb pins them to vi.json.
var (
	viTaskStatus = map[string]string{
		"backlog": "Backlog", "todo": "Cần làm", "in_progress": "Đang làm", "in_review": "Đang review",
		"blocked": "Đang chặn", "done": "Hoàn thành", "cancelled": "Đã hủy",
	}
	viProjectStatus = map[string]string{
		"planned": "Đã lên kế hoạch", "in_progress": "Đang làm", "paused": "Tạm dừng", "completed": "Hoàn thành", "cancelled": "Đã hủy",
	}
	viMeetingStatus = map[string]string{
		"SCHEDULED": "Đã lên lịch", "IN_PROGRESS": "Đang diễn ra", "OVERTIME": "Quá giờ",
		"MISSED": "Không diễn ra", "ENDED": "Đã kết thúc", "CANCELED": "Đã hủy",
	}
	// Tasks and projects share the priority keys and labels (tasks.priority_*,
	// projects.priority.*). Answers said "Mức ưu tiên: none" (UNI-2151).
	viPriority = map[string]string{
		"none": "Không ưu tiên", "low": "Thấp", "medium": "Trung bình", "high": "Cao", "urgent": "Khẩn cấp",
	}
)

// taskStatusLabels names every status key of the workspace the way the web's
// status catalog does (useStatusCatalog): an untouched built-in by its label
// above, a custom or edited status by its own name. Best effort, like
// memberNames: without the catalog the built-ins still read.
func (s *AskUNIService) taskStatusLabels(ctx context.Context, tc ai.ToolContext) map[string]string {
	labels := maps.Clone(viTaskStatus)
	rows, err := s.tasks.ListTaskStatuses(ctx, Human(tc.ActorID), tc.WorkspaceID, true)
	if err != nil {
		return labels
	}
	for _, r := range rows {
		if _, builtIn := viTaskStatus[r.Key]; !r.IsSystem || !builtIn || r.Customized {
			labels[r.Key] = r.Name
		}
	}
	return labels
}

// statusLabel is the label the person sees, for a tool's field line and the
// Vietnamese excerpts a citation quotes. A key without a label stays as it is.
func statusLabel(labels map[string]string, key string) string {
	if l := labels[key]; l != "" {
		return l
	}
	return key
}

// priorityLabel is a task's or project's priority as the web shows it; an
// empty one reads as "none" does (UNI-2151).
func priorityLabel(key string) string {
	if key == "" {
		key = "none"
	}
	return statusLabel(viPriority, key)
}

// statusKey is the key a status or priority filter takes for what the model
// passed: the key itself, or a label it read, in any case. Anything else stays
// as it is and matches nothing.
func statusKey(labels map[string]string, v string) string {
	if _, ok := labels[v]; ok {
		return v
	}
	for _, key := range slices.Sorted(maps.Keys(labels)) {
		if strings.EqualFold(labels[key], strings.TrimSpace(v)) {
			return key
		}
	}
	return v
}
