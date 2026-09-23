-- ════════════════════════════════════════════════════════════════════════════
-- 001 — All schema the app needs: tree_records columns + monitoring rounds
--
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run: every statement is IF NOT EXISTS / DROP-then-CREATE.
--
-- WHY THIS IS NEEDED
-- The live database is missing everything the Update flow reads and writes:
--   • public.tree_monitoring_records  → the "Round N" card can only ever say
--                                       "No monitoring records yet", and saving
--                                       an update fails with a schema-cache error
--   • tree_records.tree_id, scientific_name, dbh_cm, height_m, wood_density,
--     crown_diameter_m, tree_condition, multi_stem, age_years, land_type,
--     surveyor, survey_date, event_type, quantity, locked
--     (so tree IDs are never persisted and measurements are dropped on insert)
--
-- Confirmed live types:
--   projects.id              text   (slug, e.g. 'aravalli-dryland-forest')
--   tree_records.id          uuid
--   tree_records.project_id  text
--   tree_records.user_id     uuid
--
-- NOTE: Do NOT wrap the ALTERs in a DO/EXCEPTION block — that swallows errors
-- and rolls the whole block back (a previous version did, and the columns never
-- appeared). This file deliberately lets errors surface.
-- ════════════════════════════════════════════════════════════════════════════

-- Required for gen_random_uuid() used below (usually already enabled on Supabase).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. tree_records: columns the app reads/writes ──────────────────────────
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS tree_id          text;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS scientific_name  text;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS dbh_cm           numeric;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS height_m         numeric;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS wood_density     numeric;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS crown_diameter_m numeric;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS tree_condition   text DEFAULT 'Healthy';
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS multi_stem       text DEFAULT 'No';
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS age_years        integer;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS land_type        text DEFAULT 'Roadside';
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS surveyor         text;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS survey_date      text;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS event_type       text DEFAULT 'Planting';
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS quantity         integer DEFAULT 1;
ALTER TABLE public.tree_records ADD COLUMN IF NOT EXISTS locked           boolean NOT NULL DEFAULT false;

-- Per-project lookup index (used for ID sequencing)
CREATE INDEX IF NOT EXISTS tree_records_project_id_idx
  ON public.tree_records (project_id);


-- ─── 2. Monitoring rounds — one row per tree per round ──────────────────────
CREATE TABLE IF NOT EXISTS public.tree_monitoring_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_record_id    uuid REFERENCES public.tree_records (id) ON DELETE CASCADE,
  tree_id           text NOT NULL,                 -- project ID, e.g. ARAV-001
  monitoring_round  integer NOT NULL DEFAULT 1,    -- 1 = Planting … 4 = Periodic
  user_id           uuid,
  project_id        text,
  photo_url         text,
  latitude          double precision,
  longitude         double precision,
  dbh_cm            numeric,
  height_m          numeric,
  crown_diameter_m  numeric,
  tree_condition    text,
  health_status     text,
  survival_status   text,                          -- alive | dead | missing
  notes             text,
  surveyor          text,
  survey_date       text,
  submitted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tree_monitoring_records_tree_id_idx
  ON public.tree_monitoring_records (tree_id);
CREATE INDEX IF NOT EXISTS tree_monitoring_records_tree_record_idx
  ON public.tree_monitoring_records (tree_record_id);
CREATE INDEX IF NOT EXISTS tree_monitoring_records_round_idx
  ON public.tree_monitoring_records (monitoring_round);

-- ─── 3. Access for signed-in app users ──────────────────────────────────────
ALTER TABLE public.tree_monitoring_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monitoring_select_authenticated ON public.tree_monitoring_records;
CREATE POLICY monitoring_select_authenticated ON public.tree_monitoring_records
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS monitoring_insert_authenticated ON public.tree_monitoring_records;
CREATE POLICY monitoring_insert_authenticated ON public.tree_monitoring_records
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS monitoring_update_authenticated ON public.tree_monitoring_records;
CREATE POLICY monitoring_update_authenticated ON public.tree_monitoring_records
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS monitoring_delete_authenticated ON public.tree_monitoring_records;
CREATE POLICY monitoring_delete_authenticated ON public.tree_monitoring_records
  FOR DELETE TO authenticated USING (true);

-- ─── 4. Lift tree IDs out of the legacy ##META## notes blob ─────────────────
UPDATE public.tree_records
SET tree_id = COALESCE(tree_id, (regexp_match(notes, '##META##.*"tree_id":"([^"]+)"'))[1])
WHERE notes LIKE '%##META##%'
  AND (tree_id IS NULL OR tree_id = '');

-- ─── 5. Migrate remaining ##META## JSON from notes to proper columns ────────
UPDATE public.tree_records
SET
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

-- ─── 6. Enforce unique tree IDs (after clearing any duplicates) ─────────────
-- Offline devices may each have assigned IDs locally; keep the oldest of any
-- clash and let the app re-assign the rest on next load.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tree_id ORDER BY submitted_at, id) AS rn
  FROM public.tree_records
  WHERE tree_id IS NOT NULL AND tree_id <> ''
)
UPDATE public.tree_records t
SET tree_id = NULL
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS tree_records_tree_id_key
  ON public.tree_records (tree_id) WHERE tree_id IS NOT NULL;

-- ─── 7. Let PostgREST see the new table/columns immediately ────────────────
NOTIFY pgrst, 'reload schema';

-- ─── 8. Verify ──────────────────────────────────────────────────────────────
-- Expect trees_with_id > 0 and monitoring_rows = 0 to start with.
SELECT count(*) FILTER (WHERE tree_id IS NOT NULL) AS trees_with_id,
       count(*)                                    AS total_trees
FROM public.tree_records;

SELECT count(*) AS monitoring_rows FROM public.tree_monitoring_records;
