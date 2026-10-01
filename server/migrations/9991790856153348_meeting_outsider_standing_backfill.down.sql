-- Not reversed: the earlier state did not record which outsiders were MEMBER
-- by default and which a host chose, and putting them back on the roll would
-- count them toward quorum again. A no-op keeps the down chain walkable.
SELECT 1;
