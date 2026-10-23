-- MYFOLDER-01 (UNI-1850; addendum §1): drops the pre-system_kind folder-name
-- unique index after 9991792100200003_documents_folder_name_user_uidx is in
-- place.
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_folder_name_uidx;
