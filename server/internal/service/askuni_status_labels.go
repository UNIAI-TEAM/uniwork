package service

import (
	"context"
	"maps"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The Vietnamese labels the web shows for status keys
// (packages/core/i18n/locales/vi.json: tasks.status_*, projects.status.*,
// meetings.status_*). Ask UNI hands them to the model beside the key, so a
// Vietnamese answer reads like the screen instead of saying "todo" (UNI-2137).
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

// statusLine is a status on a tool's field line: the label the person sees,
// then the key a filter takes. A key without a label stays as it is.
func statusLine(labels map[string]string, key string) string {
	if l := labels[key]; l != "" && l != key {
		return l + " (key: " + key + ")"
	}
	return key
}

// statusLabel is the label alone, for the Vietnamese excerpts a citation quotes.
func statusLabel(labels map[string]string, key string) string {
	if l := labels[key]; l != "" {
		return l
	}
	return key
}
