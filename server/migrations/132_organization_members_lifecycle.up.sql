-- F-03: organization membership gets a lifecycle. Deactivation is a timestamp,
-- not a boolean, so "when" is answerable without a second table; the row stays
-- and workspace membership stays with it, keeping history intact while every
-- membership gate refuses the person (spec §2 decision 2).
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS deactivated_by TEXT;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS invited_by TEXT;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Migration 004 grandfathered one organization per legacy workspace and copied
-- every workspace owner across, so an organization can hold several owners
-- today. The unique index in 108 would fail on those rows: keep the earliest
-- owner and demote the rest to admin, which is what the product means by
-- "exactly one owner" (spec §2 decision 3).
UPDATE organization_members m
SET role = 'admin', updated_at = now()
WHERE m.role = 'owner'
  AND EXISTS (
    SELECT 1 FROM organization_members e
    WHERE e.organization_id = m.organization_id
      AND e.role = 'owner'
      AND (e.created_at, e.user_id) < (m.created_at, m.user_id)
  );
