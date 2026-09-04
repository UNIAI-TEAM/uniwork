package service

import (
	"net/http"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func meetingPastScheduledEnd(m db.Meeting, now time.Time) bool {
	return m.EndsAt.Valid && now.After(m.EndsAt.Time)
}

func errMeetingPastScheduledEnd() error {
	return coded(http.StatusForbidden, "meeting_past_scheduled_end", "cuộc họp đã quá thời gian dự kiến")
}
