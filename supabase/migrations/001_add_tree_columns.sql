-- 1. Add all missing columns
DO $$ BEGIN
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS tree_id text;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS scientific_name text;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS dbh_cm numeric;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS height_m numeric;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS wood_density numeric;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS crown_diameter_m numeric;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS tree_condition text DEFAULT 'Healthy';
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS multi_stem text DEFAULT 'No';
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS age_years integer;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS land_type text DEFAULT 'Roadside';
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS surveyor text;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS survey_date text;
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS event_type text DEFAULT 'Planting';
  ALTER TABLE tree_records ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Column add error: %', SQLERRM;
END $$;

-- 2. Migrate ##META## JSON from notes to proper columns
UPDATE tree_records
SET
  tree_id = COALESCE(tree_id, (regexp_match(notes, '##META##\{"tree_id":"([^"]+)"'))[1]),
  scientific_name = COALESCE(scientific_name, (regexp_match(notes, '##META##\{.*"scientific_name":"([^"]+)"}'))[1]),
  dbh_cm = COALESCE(dbh_cm, (regexp_match(notes, '##META##\{.*"dbh_cm":([0-9.]+)}'))[1]::numeric),
  height_m = COALESCE(height_m, (regexp_match(notes, '##META##\{.*"height_m":([0-9.]+)}'))[1]::numeric),
  wood_density = COALESCE(wood_density, (regexp_match(notes, '##META##\{.*"wood_density":([0-9.]+)}'))[1]::numeric),
  crown_diameter_m = COALESCE(crown_diameter_m, (regexp_match(notes, '##META##\{.*"crown_diameter_m":([0-9.]+)}'))[1]::numeric),
  tree_condition = COALESCE(tree_condition, (regexp_match(notes, '##META##\{.*"tree_condition":"([^"]+)"}'))[1]),
  multi_stem = COALESCE(multi_stem, (regexp_match(notes, '##META##\{.*"multi_stem":"([^"]+)"}'))[1]),
  age_years = COALESCE(age_years, (regexp_match(notes, '##META##\{.*"age_years":([0-9]+)}'))[1]::integer),
  land_type = COALESCE(land_type, (regexp_match(notes, '##META##\{.*"land_type":"([^"]+)"}'))[1]),
  surveyor = COALESCE(surveyor, (regexp_match(notes, '##META##\{.*"surveyor":"([^"]+)"}'))[1]),
  survey_date = COALESCE(survey_date, (regexp_match(notes, '##META##\{.*"survey_date":"([^"]+)"}'))[1]),
  event_type = COALESCE(event_type, (regexp_match(notes, '##META##\{.*"event_type":"([^"]+)"}'))[1]),
  quantity = COALESCE(quantity, (regexp_match(notes, '##META##\{.*"quantity":([0-9]+)}'))[1]::integer),
  notes = regexp_replace(notes, '\n?##META##\{.*\}', '', 'g')
WHERE notes LIKE '%##META##%';

-- 3. Verify
SELECT id, tree_id, species, tree_condition, dbh_cm, height_m, land_type, surveyor
FROM tree_records
WHERE tree_id IS NOT NULL
ORDER BY submitted_at DESC
LIMIT 10;
