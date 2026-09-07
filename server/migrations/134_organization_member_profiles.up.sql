-- F-03: who a person is inside one company. users holds the global identity
-- (email, display name, avatar, locale, timezone); everything that is true
-- only "at this company" lives here, so the same person in two organizations
-- has two profiles (spec §2 decision 1).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS organization_member_profiles (
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  department_id   TEXT,
  manager_id      TEXT,
  employee_code   TEXT,
  phone           TEXT NOT NULL DEFAULT '',
  -- OPEN_QUESTIONS P3: an internal directory shows email to the organization,
  -- but a phone number is personal data (Nghị định 13) and stays hidden until
  -- its owner turns it on.
  phone_visible   BOOLEAN NOT NULL DEFAULT false,
  location        TEXT NOT NULL DEFAULT '',
  bio             TEXT NOT NULL DEFAULT '',
  joined_on       DATE,
  -- Written by the service, never by a trigger: lower-case, diacritics folded,
  -- so "an" finds "Nguyễn Văn Ân" and the trigram index can serve it.
  search_text     TEXT NOT NULL DEFAULT '',
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- Every existing membership gets an empty profile in the same breath, so the
-- directory has a row per person from the first request and no read path has
-- to cope with a missing profile.
INSERT INTO organization_member_profiles (organization_id, user_id, search_text, updated_by)
SELECT m.organization_id, m.user_id,
       lower(u.display_name || ' ' || u.email),
       m.user_id
FROM organization_members m JOIN users u ON u.id = m.user_id
ON CONFLICT DO NOTHING;
