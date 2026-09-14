-- Add missing columns to tree_records table
-- Run this in Supabase SQL Editor to fix schema cache errors

-- Tree identification
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS tree_id text;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS scientific_name text;

-- Measurements
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS dbh_cm numeric;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS height_m numeric;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS wood_density numeric;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS crown_diameter_m numeric;

-- Condition & metadata
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS tree_condition text DEFAULT 'Healthy';
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS multi_stem text DEFAULT 'No';
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS age_years integer;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS land_type text DEFAULT 'Roadside';
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS surveyor text;
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS survey_date text;

-- Event info (may already exist)
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'Planting';
ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
