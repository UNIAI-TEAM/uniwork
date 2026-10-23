-- G1-04b (UNI-678): one archive command stamps a whole subtree with the same
-- batch id, so restore can bring back exactly that batch (C-01 §6.3). NULL on
-- every live document and on rows archived before this column existed.
ALTER TABLE documents ADD COLUMN archive_batch_id TEXT;
