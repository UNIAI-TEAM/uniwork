-- Expand task_views.scope_variant for workspace/project Members/Agents tabs
-- (Multica checklist). Drop auto-named CHECKs from 111 and replace pairing.
ALTER TABLE task_views DROP CONSTRAINT IF EXISTS task_views_scope_variant_check;
ALTER TABLE task_views DROP CONSTRAINT IF EXISTS task_views_check1;

ALTER TABLE task_views
  ADD CONSTRAINT task_views_scope_variant_check CHECK (
    scope_variant IS NULL
    OR scope_variant IN ('assigned', 'created', 'involved', 'any', 'members', 'agents')
  );

ALTER TABLE task_views
  ADD CONSTRAINT task_views_scope_variant_pairing CHECK (
    (scope_type = 'my' AND scope_variant IN ('assigned', 'created', 'involved', 'any'))
    OR (scope_type = 'workspace' AND (scope_variant IS NULL OR scope_variant IN ('members', 'agents')))
    OR (scope_type = 'project' AND (scope_variant IS NULL OR scope_variant IN ('members', 'agents')))
  );
