ALTER TABLE task_views DROP CONSTRAINT IF EXISTS task_views_scope_variant_pairing;
ALTER TABLE task_views DROP CONSTRAINT IF EXISTS task_views_scope_variant_check;

ALTER TABLE task_views
  ADD CONSTRAINT task_views_scope_variant_check CHECK (
    scope_variant IN ('assigned', 'created', 'involved', 'any')
  );

ALTER TABLE task_views
  ADD CONSTRAINT task_views_check1 CHECK (
    (scope_type = 'my' AND scope_variant IS NOT NULL)
    OR (scope_type <> 'my' AND scope_variant IS NULL)
  );
