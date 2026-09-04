ALTER TABLE chat_rooms ADD COLUMN organization_id TEXT;

UPDATE chat_rooms r
SET organization_id = w.organization_id
FROM workspaces w
WHERE r.workspace_id = w.id
  AND r.organization_id IS NULL;
