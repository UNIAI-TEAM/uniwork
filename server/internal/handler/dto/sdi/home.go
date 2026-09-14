package sdi

import "encoding/json"

// PutHomePreferenceSDI is PUT /api/v1/workspaces/{workspaceID}/home/preferences.
type PutHomePreferenceSDI struct {
	Prefs json.RawMessage `json:"prefs" description:"Bố cục trang chủ: khối bật/tắt, thứ tự, mật độ. Object JSON, tối đa 8 KiB" example:"{\"enabled\":{\"brief\":false},\"order\":[\"mywork\",\"stats\"],\"layout\":\"compact\"}"`
}
