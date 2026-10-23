-- Documents load dataset (C-01 §9.4, G1-09 / UNI-683). Load tests only:
-- rows go in with plain INSERT, no audit/outbox, into a throwaway database
-- that `go run ./cmd/seed` filled first. Never point this at a shared env.
--
--   psql "$DATABASE_URL" -v org_slug=perf-org-0 -v n=20000 -v tag=search \
--        -f scripts/load/documents-seed.sql
--
-- Seeds :n workspace-visible pages into the first workspace of :org_slug,
-- created by the organization owner. Titles cycle through a few Vietnamese
-- phrases so `?q=` hits a realistic share of rows; search_text is the folded
-- form foldForSearch (internal/service/search_text.go) would store. Ids are
-- 26 upper-case hex characters, a valid Crockford ULID alphabet.
\set ON_ERROR_STOP on
WITH target AS (
  SELECT o.id AS org_id, w.id AS ws_id, o.created_by AS owner_id
  FROM organizations o
  JOIN workspaces w ON w.organization_id = o.id
  WHERE o.slug = :'org_slug'
  ORDER BY w.created_at, w.id
  LIMIT 1
), phrases(i, title, folded) AS (
  VALUES (0, 'Kế hoạch quý', 'ke hoach quy'),
         (1, 'Biên bản họp', 'bien ban hop'),
         (2, 'Đề xuất ngân sách', 'de xuat ngan sach'),
         (3, 'Hướng dẫn quy trình', 'huong dan quy trinh')
), rows AS (
  SELECT g, p.title || ' ' || g AS title, p.folded || ' ' || g AS folded
  FROM generate_series(1, :n) g
  JOIN phrases p ON p.i = g % 4
)
INSERT INTO documents (
  id, organization_id, workspace_id, kind, title, visibility,
  content, content_text, search_text, content_bytes, position,
  acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind,
  content_saved_at
)
SELECT
  '0' || upper(substr(md5(:'tag' || '-' || r.g), 1, 25)),
  t.org_id, t.ws_id, 'page', r.title, 'workspace',
  jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
    jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', r.title))))),
  r.title, r.folded, 1024, r.g,
  t.owner_id, t.owner_id, 'human', t.owner_id, 'human', now()
FROM rows r CROSS JOIN target t;

ANALYZE documents;
SELECT count(*) AS documents_in_org
FROM documents d JOIN organizations o ON o.id = d.organization_id
WHERE o.slug = :'org_slug';
