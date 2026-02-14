-- Add "Others" country for schools not in the predefined list
-- Run this script to add the Others country to the database

INSERT INTO countries (code, name, description)
VALUES ('OTH', 'Others', 'For schools located outside the listed countries')
ON CONFLICT (name) DO NOTHING;

-- Verify the insertion
SELECT id, code, name FROM countries WHERE name = 'Others';
