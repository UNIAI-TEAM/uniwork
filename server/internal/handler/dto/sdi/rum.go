package sdi

// RUMSampleSDI is POST /api/v1/rum, one web-vitals sample from the browser.
type RUMSampleSDI struct {
	Metric string  `json:"metric" enum:"lcp,inp,cls,ttfb" description:"Tên chỉ số web-vitals" example:"lcp"`
	Value  float64 `json:"value" description:"Giá trị: mili giây cho lcp/inp/ttfb, điểm cho cls" example:"1830"`
	Route  string  `json:"route" description:"Route pattern của trang (không phải path thật)" example:"/[orgSlug]/[workspaceSlug]/tasks"`
}
