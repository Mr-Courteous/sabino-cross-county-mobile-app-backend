-- Extra tables/columns the routes touch (test-only; present in the live DB)
ALTER TABLE schools ADD COLUMN payment_status TEXT DEFAULT 'completed';
ALTER TABLE schools ADD COLUMN subscription_expiry TIMESTAMP DEFAULT (now() + interval '1 year');
ALTER TABLE schools ADD COLUMN updated_at TIMESTAMP DEFAULT now();
ALTER TABLE students ADD COLUMN photo TEXT;
CREATE TABLE school_preferences (id SERIAL PRIMARY KEY, school_id INT UNIQUE, theme_color TEXT, logo_url TEXT, stamp_url TEXT, header_text TEXT);
CREATE TABLE report_remarks (id SERIAL PRIMARY KEY, enrollment_id INT, term INT, session_id INT, ai_remark TEXT);
CREATE TABLE countries (id SERIAL PRIMARY KEY, code TEXT);
CREATE TABLE global_class_templates (id SERIAL PRIMARY KEY, country_id INT, display_name TEXT, capacity INT DEFAULT 50);
-- columns the student/parent routes read (present in the live DB)
ALTER TABLE students ADD COLUMN email TEXT;
ALTER TABLE students ADD COLUMN phone TEXT;
ALTER TABLE students ADD COLUMN date_of_birth DATE;
ALTER TABLE students ADD COLUMN gender TEXT;
ALTER TABLE students ADD COLUMN address TEXT;
ALTER TABLE students ADD COLUMN password_hash TEXT;
ALTER TABLE academic_years ADD COLUMN year_label TEXT;
ALTER TABLE enrollments ADD COLUMN created_at TIMESTAMP DEFAULT now();
ALTER TABLE schools ADD COLUMN email TEXT;
ALTER TABLE schools ADD COLUMN country TEXT;
ALTER TABLE schools ADD COLUMN country_id INT;
ALTER TABLE schools ADD COLUMN phone TEXT;
CREATE TABLE IF NOT EXISTS email_verifications (email TEXT PRIMARY KEY, otp_code TEXT, expires_at TIMESTAMP, is_verified BOOLEAN DEFAULT false);
