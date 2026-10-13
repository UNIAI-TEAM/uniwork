-- Diacritic folding for search (UNI-1305 item C, review open point c).
-- Vietnamese users type "hop dong" against a file named "Hợp đồng"; the
-- unaccent extension is not installed, so this is the IMMUTABLE fold the
-- documents-home file search compares against. It must agree with
-- foldForSearch in internal/service/search_text.go: lower case, accents and
-- combining marks removed, đ -> d, whitespace collapsed. Upper case letters
-- map explicitly (translate, not lower()), so the result does not depend on the
-- database collation. service.TestDocumentSourceFoldAgreesWithGo holds the two
-- together on a database; service.TestUwFoldSearchTableMatchesGo reads the
-- translate table below and holds every Vietnamese letter (all tones, both
-- cases, đ/Đ) to foldForSearch without one.
--
-- Scope: Vietnamese plus the Latin letters of the European names the table
-- lists. Outside that the two differ: Go lower-cases every script and strips
-- every combining mark, this function lower-cases only the listed Latin
-- capitals and strips U+0300-U+036F. So a Cyrillic or Greek capital, or a
-- precomposed Latin letter not in the table (ĉ ŝ ǎ ...), is not folded here.
-- Widening it means extending the table and the test together.
CREATE OR REPLACE FUNCTION uw_fold_search(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(input, 'àÀáÁảẢãÃạẠăĂằẰắẮẳẲẵẴặẶâÂầẦấẤẩẨẫẪậẬäÄåÅāĀąĄǎǍçÇćĆčČđĐèÈéÉẻẺẽẼẹẸêÊềỀếẾểỂễỄệỆëËēĒęĘěĚȩȨğĞìÌíÍỉỈĩĨịỊîÎïÏīĪįĮñÑńŃňŇòÒóÓỏỎõÕọỌôÔồỒốỐổỔỗỖộỘơƠờỜớỚởỞỡỠợỢöÖōŌőŐřŘśŚšŠşŞţŢťŤùÙúÚủỦũŨụỤưƯừỪứỨửỬữỮựỰûÛüÜūŪůŮűŰųŲỳỲýÝỷỶỹỸỵỴÿŸźŹżŻžŽABCDEFGHIJKLMNOPQRSTUVWXYZ', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaccccccddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeggiiiiiiiiiiiiiiiiiinnnnnnoooooooooooooooooooooooooooooooooooooooorrssssssttttuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuyyyyyyyyyyyyzzzzzzabcdefghijklmnopqrstuvwxyz'),
      '[\u0300-\u036F]', '', 'g'),
    '[[:space:]]+', ' ', 'g'))
$$;
