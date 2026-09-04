-- outbox_events thôi là bảng riêng của Meeting: mọi bounded context ghi vào
-- đây, một Dispatcher chung fan-out theo topic (spec audit §3.3, §4.4).
-- Cột status giữ nguyên để ClaimPendingOutbox và index 021 không phải đổi;
-- done_at/dead_at thêm để tuân quy ước timestamp và để đo lag.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS event_version   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correlation_id  TEXT,
  ADD COLUMN IF NOT EXISTS actor_kind      TEXT,
  ADD COLUMN IF NOT EXISTS actor_id        TEXT,
  ADD COLUMN IF NOT EXISTS done_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_at         TIMESTAMPTZ;

UPDATE outbox_events o SET organization_id = w.organization_id
  FROM workspaces w WHERE w.id = o.workspace_id AND o.organization_id IS NULL;

ALTER TABLE outbox_events ALTER COLUMN workspace_id DROP NOT NULL;
