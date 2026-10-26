-- Dial-in PINs drawn from now on are 9 digits (UNI-1995 access, issue #24):
-- one SIP trunk serves every tenant, so the PIN space is what a caller
-- cycling guesses has to search. PINs already drawn keep working, and a
-- rotation draws a 9-digit one. 60 random bits before the modulo keep the
-- draw uniform (32 bits mod 10^9 favours the low quarter of the range).
ALTER TABLE meetings ALTER COLUMN dial_in_pin
  SET DEFAULT lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 15))::bit(60)::bigint) % 1000000000)::text, 9, '0');
