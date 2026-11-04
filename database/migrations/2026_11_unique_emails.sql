-- =====================================================================
-- One login email = one account, enforced by the DATABASE itself.
-- Idempotent. Never rewrites or deletes existing data: if old duplicates
-- already exist, the index is skipped with a NOTICE and the triggers still
-- protect every NEW or CHANGED email.
--
--   staff vs staff   : unique index on LOWER(email)  (case-insensitive)
--   staff vs school  : triggers in both directions (a staff login can't
--                      reuse a school owner's email, and vice versa)
-- Parent accounts are a separate login area and are intentionally not
-- included (one person can be a teacher and a parent).
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL THEN
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_email_lower ON staff (LOWER(email));
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'uq_staff_email_lower NOT created: staff already has emails that differ only by letter case. Fix those rows, then run this again. The triggers below still protect new/changed emails.';
    END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_staff_email() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND LOWER(NEW.email) = LOWER(OLD.email) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM schools WHERE LOWER(email) = LOWER(NEW.email)) THEN
    RAISE EXCEPTION 'The email % already belongs to a school account', NEW.email USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_school_email() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND LOWER(NEW.email) = LOWER(OLD.email) THEN
    RETURN NEW;
  END IF;
  IF to_regclass('public.staff') IS NOT NULL
     AND EXISTS (SELECT 1 FROM staff WHERE LOWER(email) = LOWER(NEW.email)) THEN
    RAISE EXCEPTION 'The email % already belongs to a staff account', NEW.email USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_staff_email ON staff;
    CREATE TRIGGER trg_guard_staff_email
      BEFORE INSERT OR UPDATE OF email ON staff
      FOR EACH ROW EXECUTE FUNCTION guard_staff_email();
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_guard_school_email ON schools;
CREATE TRIGGER trg_guard_school_email
  BEFORE INSERT OR UPDATE OF email ON schools
  FOR EACH ROW EXECUTE FUNCTION guard_school_email();
