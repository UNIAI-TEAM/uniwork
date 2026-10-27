-- Intentionally a no-op. This file reached develop with PR 8 (#468) after
-- 9991792710000050_file_upload_sessions_chat_room_wallpaper (UNI-2135, #407)
-- had already opened the same purpose, and after 9991792700000005 and
-- 9991792710000100 had widened the checks with meeting_audio and
-- ai_attachment. A database that already ran those applies this older prefix
-- late, and its narrower purpose list then fails on existing rows (SQLSTATE
-- 23514), which stopped the dev deploy. 9991792710000050 does the same work in
-- order, and 9991792900000090 restates the full checks, so nothing is lost.
SELECT 1;
