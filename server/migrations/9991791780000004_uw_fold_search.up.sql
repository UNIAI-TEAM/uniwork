-- Diacritic folding for search (UNI-1305 item C, review open point c).
-- Vietnamese users type "hop dong" against a file named "Hợp đồng"; the
-- unaccent extension is not installed, so this is the IMMUTABLE fold the
-- documents-home file search compares against. It must agree with
-- foldForSearch in internal/service/search_text.go: lower case, accents and
-- combining marks removed, đ -> d, whitespace collapsed. Upper case letters
-- map explicitly (translate, not lower()), so the result does not depend on the
-- database collation. service.TestDocumentSourceFoldAgreesWithGo holds the two
-- together.
CREATE OR REPLACE FUNCTION uw_fold_search(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(input, 'àÀáÁảẢãÃạẠăĂằẰắẮẳẲẵẴặẶâÂầẦấẤẩẨẫẪậẬäÄåÅāĀąĄǎǍçÇćĆčČđĐèÈéÉẻẺẽẼẹẸêÊềỀếẾểỂễỄệỆëËēĒęĘěĚȩȨğĞìÌíÍỉỈĩĨịỊîÎïÏīĪįĮñÑńŃňŇòÒóÓỏỎõÕọỌôÔồỒốỐổỔỗỖộỘơƠờỜớỚởỞỡỠợỢöÖōŌőŐřŘśŚšŠşŞţŢťŤùÙúÚủỦũŨụỤưƯừỪứỨửỬữỮựỰûÛüÜūŪůŮűŰųŲỳỲýÝỷỶỹỸỵỴÿŸźŹżŻžŽABCDEFGHIJKLMNOPQRSTUVWXYZ', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaccccccddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeggiiiiiiiiiiiiiiiiiinnnnnnoooooooooooooooooooooooooooooooooooooooorrssssssttttuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuyyyyyyyyyyyyzzzzzzabcdefghijklmnopqrstuvwxyz'),
      '[\u0300-\u036F]', '', 'g'),
    '[[:space:]]+', ' ', 'g'))
$$;
