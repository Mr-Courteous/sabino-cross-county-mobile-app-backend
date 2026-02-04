const pool = require('./db');

const schema = `
-- Users/School Admins Table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schools Table
CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(255),
  logo_url VARCHAR(500),
  stamp_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Countries Table (for global curriculum management)
CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  code VARCHAR(3) UNIQUE NOT NULL,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Global Class Templates Table (scalable curriculum system)
-- Templates define standard classes (JSS1, JSS2, JSS3, SSS1, SSS2, SSS3, etc) for each country
-- Schools copy these templates on registration to get standardized class structure
CREATE TABLE IF NOT EXISTS global_class_templates (
  id SERIAL PRIMARY KEY,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  class_code VARCHAR(20) NOT NULL,
  class_name VARCHAR(50) NOT NULL,
  form_teacher VARCHAR(100),
  capacity INTEGER DEFAULT 50,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(country_id, class_code)
);

-- Subscription Plans Table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  duration_days INTEGER NOT NULL,
  features JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- School Subscriptions Table
CREATE TABLE IF NOT EXISTS school_subscriptions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(50) DEFAULT 'active',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  auto_renew BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Academic Sessions Table (replaces academic_years - simplifies to session names like "2024/2025")
CREATE TABLE IF NOT EXISTS academic_sessions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_name VARCHAR(9) NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, session_name),
  CONSTRAINT valid_session_format CHECK (session_name ~ '^\d{4}/\d{4}$')
);

-- Classes Table (JSS1 to SSS3 - independent of specific sessions)
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_name VARCHAR(50) NOT NULL,
  form_teacher VARCHAR(100),
  capacity INTEGER DEFAULT 50,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, class_name)
);

-- Students Table (now independent of class - uses enrollments for class assignment)
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255),
  registration_number VARCHAR(50) UNIQUE,
  date_of_birth DATE,
  gender VARCHAR(10),
  phone VARCHAR(20),
  photo VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enrollments Table (handles student-to-class assignments per academic session)
-- Links students to classes via academic_sessions
-- Allows proper handling of promotions, repeaters, transfers, and historical tracking
CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, student_id, class_id, session_id),
  CONSTRAINT valid_enrollment_status CHECK (status IN ('active', 'promoted', 'repeated', 'transferred', 'graduated'))
);

-- School Preferences Table (for logo, stamp, etc)
CREATE TABLE IF NOT EXISTS school_preferences (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  theme_color VARCHAR(7),
  logo_url VARCHAR(500),
  stamp_url VARCHAR(500),
  header_text TEXT,
  footer_text TEXT,
  custom_settings JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subjects Table (Scalable subject management per school)
CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_name VARCHAR(100) NOT NULL,
  subject_code VARCHAR(20),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, subject_code)
);

-- Scores Table (Enhanced for Educational Data Model with enrollment tracking)
-- Structure: 4 CA scores + Exam score per subject per term per enrollment (student-class pair)
-- Links to enrollments which include session_id, eliminating redundancy
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  term INTEGER NOT NULL CHECK (term IN (1, 2, 3)),
  ca1_score DECIMAL(5, 2),
  ca2_score DECIMAL(5, 2),
  ca3_score DECIMAL(5, 2),
  ca4_score DECIMAL(5, 2),
  exam_score DECIMAL(5, 2),
  total_score DECIMAL(6, 2) GENERATED ALWAYS AS (
    COALESCE(ca1_score, 0) + COALESCE(ca2_score, 0) + COALESCE(ca3_score, 0) + 
    COALESCE(ca4_score, 0) + COALESCE(exam_score, 0)
  ) STORED,
  teacher_remark TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(school_id, enrollment_id, subject_id, term)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_schools_owner ON schools(owner_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_school ON school_subscriptions(school_id);
CREATE INDEX IF NOT EXISTS idx_academic_sessions_school ON academic_sessions(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_school ON enrollments(school_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_session ON enrollments(session_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_school_session ON enrollments(school_id, session_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_session ON enrollments(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_scores_enrollment ON scores(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_scores_subject ON scores(subject_id);
CREATE INDEX IF NOT EXISTS idx_scores_term ON scores(term);
CREATE INDEX IF NOT EXISTS idx_scores_school_enrollment ON scores(school_id, enrollment_id);
CREATE INDEX IF NOT EXISTS idx_scores_school_term ON scores(school_id, term);
CREATE INDEX IF NOT EXISTS idx_countries_code ON countries(code);
CREATE INDEX IF NOT EXISTS idx_global_templates_country ON global_class_templates(country_id);
CREATE INDEX IF NOT EXISTS idx_global_templates_code ON global_class_templates(class_code);
`;

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(schema);
    console.log('✓ Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigrations();
