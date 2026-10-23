-- Work Graph (C-11, ADR 0019): a projection of the business tables. Only
-- internal/graph/projector writes these tables (arch test), so a rebuild from
-- the sources always reproduces them. No foreign keys (migration rules): the
-- graph_edges_validate trigger checks the catalogue triple and that both nodes
-- sit in the edge's organization.

CREATE TABLE graph_edge_types (
  edge_type       TEXT NOT NULL,
  from_type       TEXT NOT NULL,
  to_type         TEXT NOT NULL,
  human_creatable BOOLEAN NOT NULL DEFAULT false,
  temporal        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (edge_type, from_type, to_type)
);

CREATE TABLE graph_nodes (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT,
  node_type         TEXT NOT NULL,
  subtype           TEXT NOT NULL DEFAULT '',
  source_id         TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '',
  visibility        TEXT NOT NULL,
  reader_ids        TEXT[] NOT NULL DEFAULT '{}',
  occurred_at       TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT graph_nodes_node_type_check CHECK (node_type IN (
    'MEETING', 'DECISION', 'TASK', 'COMMITMENT', 'EXECUTION', 'WORK_PRODUCT', 'KNOWLEDGE',
    'ACTOR', 'TEAM', 'PROJECT', 'CUSTOMER', 'GOAL', 'DOCUMENT', 'THREAD')),
  CONSTRAINT graph_nodes_visibility_check CHECK (visibility IN ('organization', 'workspace', 'members', 'private'))
);

CREATE TABLE graph_edges (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  from_node       TEXT NOT NULL,
  to_node         TEXT NOT NULL,
  edge_type       TEXT NOT NULL,
  origin          TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_kind   TEXT NOT NULL,
  evidence_id     TEXT NOT NULL,
  actor_kind      TEXT NOT NULL DEFAULT '',
  actor_id        TEXT NOT NULL DEFAULT '',
  attrs           JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT graph_edges_origin_check CHECK (origin IN ('SYSTEM', 'HUMAN', 'AI_CONFIRMED', 'AI_SUGGESTED')),
  CONSTRAINT graph_edges_evidence_check CHECK (evidence_kind IN ('outbox_event', 'work_link', 'source_row') AND evidence_id <> ''),
  CONSTRAINT graph_edges_valid_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT graph_edges_not_self_check CHECK (from_node <> to_node)
);

CREATE TABLE graph_node_facts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  value           TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_kind   TEXT NOT NULL,
  evidence_id     TEXT NOT NULL,
  attrs           JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT graph_node_facts_type_check CHECK (fact_type IN ('due', 'status')),
  CONSTRAINT graph_node_facts_evidence_check CHECK (evidence_kind IN ('outbox_event', 'work_link', 'source_row') AND evidence_id <> ''),
  CONSTRAINT graph_node_facts_valid_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- One row per node waiting to be projected. The marker consumer upserts it
-- (mark_seq counts the marks); the projector worker deletes it only if no
-- mark arrived while it was projecting.
CREATE TABLE graph_dirty (
  organization_id TEXT NOT NULL,
  node_type       TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  mark_seq        BIGINT NOT NULL DEFAULT 1,
  last_event_id   TEXT NOT NULL DEFAULT '',
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_kind      TEXT NOT NULL DEFAULT '',
  actor_id        TEXT NOT NULL DEFAULT '',
  attempts        INT NOT NULL DEFAULT 0,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  last_error      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, node_type, source_id)
);

CREATE OR REPLACE FUNCTION graph_edges_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f graph_nodes%ROWTYPE;
  t graph_nodes%ROWTYPE;
BEGIN
  SELECT * INTO f FROM graph_nodes WHERE id = NEW.from_node;
  SELECT * INTO t FROM graph_nodes WHERE id = NEW.to_node;
  IF f.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'graph edge % names a node that does not exist', NEW.id USING ERRCODE = '23514';
  END IF;
  IF f.organization_id <> NEW.organization_id OR t.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'graph edge % crosses organizations', NEW.id USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM graph_edge_types
    WHERE edge_type = NEW.edge_type AND from_type = f.node_type AND to_type = t.node_type
  ) THEN
    RAISE EXCEPTION 'graph edge %: % from % to % is not in the catalogue', NEW.id, NEW.edge_type, f.node_type, t.node_type
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS graph_edges_validate ON graph_edges;
CREATE TRIGGER graph_edges_validate BEFORE INSERT ON graph_edges
  FOR EACH ROW EXECUTE FUNCTION graph_edges_validate();

INSERT INTO graph_edge_types (edge_type, from_type, to_type, human_creatable, temporal) VALUES
  ('DECIDED_IN', 'DECISION', 'MEETING', false, false),
  ('DRIVES', 'DECISION', 'TASK', false, false),
  ('DRIVES', 'DECISION', 'COMMITMENT', false, false),
  ('SUPERSEDES', 'DECISION', 'DECISION', false, false),
  ('OWNED_BY', 'TASK', 'ACTOR', false, true),
  ('OWNED_BY', 'PROJECT', 'ACTOR', false, true),
  ('OWNED_BY', 'GOAL', 'ACTOR', false, true),
  ('EXECUTED_BY', 'EXECUTION', 'ACTOR', false, false),
  ('EXECUTES', 'EXECUTION', 'TASK', false, false),
  ('PRODUCED', 'EXECUTION', 'WORK_PRODUCT', false, false),
  ('REALIZED_AS', 'WORK_PRODUCT', 'DOCUMENT', false, false),
  ('PROMOTED_TO', 'WORK_PRODUCT', 'KNOWLEDGE', false, false),
  ('INFORMS', 'KNOWLEDGE', 'MEETING', true, false),
  ('INFORMS', 'KNOWLEDGE', 'TASK', true, false),
  ('INFORMS', 'KNOWLEDGE', 'DECISION', true, false),
  ('BELONGS_TO', 'TASK', 'PROJECT', false, true),
  ('BELONGS_TO', 'TASK', 'TASK', false, true),
  ('BELONGS_TO', 'MEETING', 'PROJECT', false, true),
  ('BELONGS_TO', 'PROJECT', 'PROJECT', false, true),
  ('BELONGS_TO', 'DOCUMENT', 'PROJECT', false, true),
  ('BELONGS_TO', 'THREAD', 'PROJECT', false, true),
  ('BELONGS_TO', 'ACTOR', 'TEAM', false, true),
  ('BELONGS_TO', 'TEAM', 'TEAM', false, true),
  ('BELONGS_TO', 'MEETING', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'DECISION', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'TASK', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'COMMITMENT', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'EXECUTION', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'WORK_PRODUCT', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'KNOWLEDGE', 'CUSTOMER', false, true),
  ('CONTRIBUTES_TO', 'PROJECT', 'GOAL', true, true),
  ('CONTRIBUTES_TO', 'TASK', 'GOAL', true, true),
  ('CONTRIBUTES_TO', 'DECISION', 'GOAL', true, true),
  ('PARTICIPATED_IN', 'ACTOR', 'MEETING', false, true),
  ('DISCUSSED_IN', 'TASK', 'THREAD', true, false),
  ('DISCUSSED_IN', 'MEETING', 'THREAD', true, false),
  ('DISCUSSED_IN', 'PROJECT', 'THREAD', true, false),
  ('DISCUSSED_IN', 'DECISION', 'THREAD', true, false),
  ('EVIDENCED_BY', 'TASK', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'TASK', 'THREAD', true, false),
  ('EVIDENCED_BY', 'MEETING', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'MEETING', 'THREAD', true, false),
  ('EVIDENCED_BY', 'PROJECT', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'PROJECT', 'THREAD', true, false),
  ('EVIDENCED_BY', 'DECISION', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'DECISION', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'TASK', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'TASK', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'TASK', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'TASK', 'CUSTOMER', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'CUSTOMER', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'CUSTOMER', true, false),
  ('DEPENDS_ON', 'TASK', 'TASK', false, true),
  ('DEPENDS_ON', 'TASK', 'COMMITMENT', false, true),
  ('DEPENDS_ON', 'TASK', 'DECISION', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'TASK', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'COMMITMENT', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'DECISION', false, true)
ON CONFLICT DO NOTHING;
