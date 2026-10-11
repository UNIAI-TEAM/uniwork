-- Group keys became 'sha256:' || hex(sha256(sorted '|'-joined member ids))
-- (groupMemberSetKey). Rehash the list keys of groups created before that, so
-- CreateGroup finds them instead of making a duplicate. A group already
-- duplicated under the digest keeps its list key: the unique index allows one.
UPDATE chat_rooms r
SET member_set_key = 'sha256:' || encode(sha256(convert_to(r.member_set_key, 'UTF8')), 'hex')
WHERE r.kind = 'group'
  AND r.member_set_key NOT LIKE 'sha256:%'
  AND NOT EXISTS (
    SELECT 1 FROM chat_rooms d
    WHERE d.organization_id = r.organization_id
      AND d.kind = 'group'
      AND d.member_set_key = 'sha256:' || encode(sha256(convert_to(r.member_set_key, 'UTF8')), 'hex')
  );
