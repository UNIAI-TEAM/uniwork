-- Legacy dev seed plan (Stripe/PayOS test); superseded by B1 catalog `team`.
-- Description was inserted with wrong encoding (mojibake in UI).
UPDATE plans SET is_active = false, updated_at = now()
WHERE code = 'team_local';
