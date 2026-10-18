-- MYFOLDER-01 (UNI-1891). Every document that sits inside a My Folder
-- (system_kind = 'my_folder') owned by a member OTHER than actor_id, in one
-- workspace: the other members' My Folders themselves plus every descendant.
--
-- An organization owner/admin holds AdminScope (see_all) on every restricted
-- document, so the admin listings - the flat list, the tree, the trash, the
-- recent list, the search, the access report and the change-feed snapshot -
-- would otherwise reach a page a member keeps inside their private folder:
-- its title and its id, which the addendum and contract v0.1 keep private to
-- the owner (opening it by id already answers 403 document_restricted). Those
-- rows are listed HERE, once, and each query excludes them with a NOT EXISTS
-- over this set - the list permission predicate is inlined in a dozen places,
-- so one function keeps the rule in one place instead of a twelfth copy.
--
-- The walk goes DOWN parent_id from the other members' My Folders: the seed
-- is one index probe (idx_documents_my_folder_uidx, partial on
-- system_kind = 'my_folder'), the step is one per child
-- (idx_documents_ws_parent_all on workspace_id, parent_id), and the result is
-- not correlated to the calling query's row, so the planner evaluates it once
-- per statement and uses it as an anti-join rather than once per candidate.
-- Every row carries the tenant pair, so a poisoned parent_id can never leave
-- the workspace; max_level is the corrupted-chain guard the sibling recursive
-- queries already use (subtreeMaxLevel = 2 * maxDocumentDepth). A My Folder is
-- a root (its parent_id is NULL), so it is never an intermediate step on the
-- way to a row that is not its own descendant. A row whose acl_owner_id is
-- NULL belongs to no member, so it is foreign to every actor.
--
-- The caller gates this on see_all: for a plain member the function's answer
-- is never consulted, and the acl_owner and share legs of the predicate keep
-- admitting the actor's own My Folder and any descendant explicitly shared
-- with them (the card removes only what admin scope ADDS).
CREATE OR REPLACE FUNCTION uw_my_folder_foreign_ids(
  actor_id text,
  organization_id text,
  workspace_id text,
  max_level int
) RETURNS TABLE (document_id text)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH RECURSIVE mfs AS (
    SELECT mf.id, 1 AS lvl
    FROM documents mf
    WHERE mf.organization_id = uw_my_folder_foreign_ids.organization_id
      AND mf.workspace_id = uw_my_folder_foreign_ids.workspace_id
      AND mf.system_kind = 'my_folder'
      AND mf.acl_owner_id IS DISTINCT FROM uw_my_folder_foreign_ids.actor_id
    UNION ALL
    SELECT c.id, mfs.lvl + 1
    FROM documents c
    JOIN mfs ON c.parent_id = mfs.id
    WHERE c.organization_id = uw_my_folder_foreign_ids.organization_id
      AND c.workspace_id = uw_my_folder_foreign_ids.workspace_id
      AND mfs.lvl < uw_my_folder_foreign_ids.max_level
  )
  SELECT mfs.id FROM mfs;
$$;
