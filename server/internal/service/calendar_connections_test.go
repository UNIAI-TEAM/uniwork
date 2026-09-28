package service

import "testing"

func TestProviderEventMapsGoogleAllDayAndOutlookUTC(t *testing.T) {
	google := providerEvent{ID: "g1", Summary: "Focus", Start: providerDate{Date: "2026-09-28"}, End: providerDate{Date: "2026-09-29"}, HTMLLink: "https://calendar.google.com/event"}
	g, ok := google.calendarEvent("google", "primary")
	if !ok || !g.AllDay || g.Start != "2026-09-28" || g.ExternalURL == nil {
		t.Fatalf("google map: %#v, %v", g, ok)
	}
	outlook := providerEvent{ID: "o1", Subject: "Review", Start: providerDate{DateTime: "2026-09-28T08:30:00", TimeZone: "UTC"}, End: providerDate{DateTime: "2026-09-28T09:00:00", TimeZone: "UTC"}}
	o, ok := outlook.calendarEvent("outlook", "default")
	if !ok || o.Start != "2026-09-28T08:30:00Z" || o.End == nil || *o.End != "2026-09-28T09:00:00Z" {
		t.Fatalf("outlook map: %#v, %v", o, ok)
	}
	outlookAllDay := providerEvent{ID: "o2", Subject: "Holiday", IsAllDay: true, Start: providerDate{DateTime: "2026-09-28T00:00:00.0000000"}, End: providerDate{DateTime: "2026-09-29T00:00:00.0000000"}}
	a, ok := outlookAllDay.calendarEvent("outlook", "default")
	if !ok || !a.AllDay || a.Start != "2026-09-28" || a.End == nil || *a.End != "2026-09-29" {
		t.Fatalf("outlook all-day map: %#v, %v", a, ok)
	}
}

func TestProviderEventSkipsCancelled(t *testing.T) {
	if _, ok := (providerEvent{Status: "cancelled"}).calendarEvent("google", "primary"); ok {
		t.Fatal("cancelled event must be skipped")
	}
}

func TestProviderNextPageURLOnlyAllowsExpectedHTTPSHost(t *testing.T) {
	valid, err := providerNextPageURL("https://graph.microsoft.com/v1.0/me/events?$skiptoken=abc", "graph.microsoft.com")
	if err != nil || valid == "" {
		t.Fatalf("valid next page URL: %q, %v", valid, err)
	}
	for _, candidate := range []string{
		"http://graph.microsoft.com/v1.0/me/events",
		"https://graph.microsoft.com.example.com/steal",
		"https://evil.example/steal",
	} {
		if _, err := providerNextPageURL(candidate, "graph.microsoft.com"); err == nil {
			t.Fatalf("expected %q to be rejected", candidate)
		}
	}
}
