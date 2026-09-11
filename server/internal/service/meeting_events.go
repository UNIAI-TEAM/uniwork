package service

import (
	"strconv"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func meetingEventPayload(m db.Meeting) map[string]string {
	return map[string]string{
		"meeting_id": m.ID,
		"version":    strconv.FormatInt(int64(m.Version), 10),
	}
}

func meetingRelatedPayload(m db.Meeting, extra map[string]string) map[string]string {
	p := meetingEventPayload(m)
	for k, v := range extra {
		p[k] = v
	}
	return p
}
