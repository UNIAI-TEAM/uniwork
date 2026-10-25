-- Organization meeting settings (UNI-2026, spec 2026-10-20-meeting-scribe-agent-design
-- §6.2, D16). One row per organization that has touched the settings; no row
-- reads as the defaults, the way document_settings does. auto_summary_enabled
-- is the organization's switch for the summary the system makes when a
-- meeting ends (A5); on by default. No FK (post-004 rule).
CREATE TABLE IF NOT EXISTS meeting_settings (
  organization_id       TEXT NOT NULL PRIMARY KEY,
  auto_summary_enabled  BOOLEAN NOT NULL DEFAULT true,
  updated_by            TEXT NOT NULL,
  updated_by_kind       TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_settings_updated_by_kind_check
    CHECK (updated_by_kind IN ('human', 'agent', 'system'))
);
