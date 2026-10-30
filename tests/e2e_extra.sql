-- Extra tables/columns the routes touch (test-only; present in the live DB)
ALTER TABLE schools ADD COLUMN payment_status TEXT DEFAULT 'completed';
ALTER TABLE schools ADD COLUMN subscription_expiry TIMESTAMP DEFAULT (now() + interval '1 year');
ALTER TABLE schools ADD COLUMN updated_at TIMESTAMP DEFAULT now();
ALTER TABLE students ADD COLUMN photo TEXT;
CREATE TABLE school_preferences (id SERIAL PRIMARY KEY, school_id INT UNIQUE, theme_color TEXT, logo_url TEXT, stamp_url TEXT, header_text TEXT);
CREATE TABLE report_remarks (id SERIAL PRIMARY KEY, enrollment_id INT, term INT, session_id INT, ai_remark TEXT);
CREATE TABLE countries (id SERIAL PRIMARY KEY, code TEXT);
CREATE TABLE global_class_templates (id SERIAL PRIMARY KEY, country_id INT, display_name TEXT, capacity INT DEFAULT 50);
