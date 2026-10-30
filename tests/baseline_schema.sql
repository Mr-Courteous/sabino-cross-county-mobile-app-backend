-- Minimal reproduction of the LIVE schema as the app code uses it
-- (session_id on scores, global_subjects, academic_years). Test-only.
CREATE TABLE schools (id SERIAL PRIMARY KEY, name TEXT);
CREATE TABLE users (id SERIAL PRIMARY KEY);
CREATE TABLE classes (id SERIAL PRIMARY KEY, school_id INT REFERENCES schools(id), class_name VARCHAR(50) NOT NULL, capacity INT DEFAULT 50, created_at TIMESTAMP DEFAULT now(), UNIQUE(school_id, class_name));
CREATE TABLE academic_years (id SERIAL PRIMARY KEY, school_id INT, session_name TEXT);
CREATE TABLE students (id SERIAL PRIMARY KEY, school_id INT, first_name TEXT, last_name TEXT, registration_number TEXT);
CREATE TABLE enrollments (id SERIAL PRIMARY KEY, school_id INT, student_id INT REFERENCES students(id), class_id INT REFERENCES classes(id), session_id INT, status TEXT DEFAULT 'active');
CREATE TABLE global_subjects (id SERIAL PRIMARY KEY, subject_name VARCHAR(100) NOT NULL UNIQUE, category TEXT, education_level TEXT);
CREATE TABLE scores (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  enrollment_id INT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  subject_id INT NOT NULL REFERENCES global_subjects(id) ON DELETE CASCADE,
  session_id INT, term INT NOT NULL,
  ca1_score DECIMAL(5,2), ca2_score DECIMAL(5,2), ca3_score DECIMAL(5,2), ca4_score DECIMAL(5,2), exam_score DECIMAL(5,2),
  total_score DECIMAL(6,2) GENERATED ALWAYS AS (COALESCE(ca1_score,0)+COALESCE(ca2_score,0)+COALESCE(ca3_score,0)+COALESCE(ca4_score,0)+COALESCE(exam_score,0)) STORED,
  teacher_remark TEXT, updated_by INT, created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(school_id, enrollment_id, subject_id, session_id, term)
);
