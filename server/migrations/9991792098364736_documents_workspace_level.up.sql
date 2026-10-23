-- SH-S1 (UNI-1780): the workspace home row gets its own level. The column is
-- the level every effective member of the document's workspace holds while
-- visibility = 'workspace'; it is ignored while the document is 'restricted'
-- (no home row). DEFAULT 'edit' makes this migration rights-neutral: every
-- existing workspace-visible row keeps exactly the level the resolver granted
-- before the column existed. No index (the column is never filtered on its
-- own) and no 'manage' (Q-S1: the home row tops out at edit).
ALTER TABLE documents
    ADD COLUMN workspace_level TEXT NOT NULL DEFAULT 'edit'
        CONSTRAINT documents_workspace_level_check CHECK (workspace_level IN ('view', 'comment', 'edit'));
