-- Outbox + lịch sử email. Không FK: user_id NULL khi mời email chưa có account,
-- và lịch sử phải sống lâu hơn user. Trạng thái suy từ timestamp:
-- sent_at/failed_at đều NULL = đang chờ.
CREATE TABLE emails (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  user_id         TEXT,
  locale          TEXT NOT NULL,
  subject         TEXT NOT NULL,
  html            TEXT NOT NULL,
  text            TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
