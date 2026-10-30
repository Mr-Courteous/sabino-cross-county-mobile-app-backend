-- Free trial bookkeeping. Optional but recommended: sign-up works without it,
-- but the "one trial per phone number" check and trial reporting need it.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_trial         BOOLEAN   DEFAULT false;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMP;  -- while subscription_expiry still equals this, the school has not paid yet
CREATE INDEX IF NOT EXISTS idx_schools_trial_started ON schools(trial_started_at) WHERE trial_started_at IS NOT NULL;
