-- Nhật ký bất biến cho mọi command đổi trạng thái nghiệp vụ (ADR 0009).
-- Không FK: bản ghi phải sống lâu hơn user, workspace, thậm chí organization
-- đã xóa. organization_id = '' là sentinel cho sự kiện auth (không có ngữ cảnh
-- tổ chức lúc đăng nhập) — chỉ platform admin đọc được, xem AuditService.
CREATE TABLE IF NOT EXISTS audit_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,
  actor_kind      TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  changes         TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}',
  correlation_id  TEXT NOT NULL,
  request_id      TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lớp 1: quyền DB. Role ứng dụng không sở hữu schema trong staging/production
-- nên REVOKE là thứ một bug service không vượt được.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;

-- Lớp 2: trigger, đúng cho cả trường hợp app chạy bằng owner của schema (dev,
-- test). TRUNCATE cố ý không chặn: testutil dọn bảng giữa các test bằng nó.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
