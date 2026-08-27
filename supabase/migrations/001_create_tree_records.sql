-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Create tree_records table and tree-photos storage bucket
-- Project: Five Elements CARM — TreeApp
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create tree_records table
CREATE TABLE IF NOT EXISTS public.tree_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  photo_url     TEXT NOT NULL,
  latitude      FLOAT8 NOT NULL,
  longitude     FLOAT8 NOT NULL,
  species       TEXT NOT NULL,
  health_status TEXT NOT NULL DEFAULT 'unknown'
                CHECK (health_status IN ('healthy', 'sick', 'dead', 'unknown')),
  notes         TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced        BOOLEAN NOT NULL DEFAULT TRUE
);

-- 2. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_tree_records_user_id ON public.tree_records(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_records_project_id ON public.tree_records(project_id);
CREATE INDEX IF NOT EXISTS idx_tree_records_submitted_at ON public.tree_records(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tree_records_health_status ON public.tree_records(health_status);

-- 3. Enable Row Level Security
ALTER TABLE public.tree_records ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Field users can insert their own records
CREATE POLICY "field_users_insert_own"
  ON public.tree_records
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Field users can view their own records
CREATE POLICY "field_users_select_own"
  ON public.tree_records
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all records
-- (Assumes a profiles table with a role column — adjust if needed)
CREATE POLICY "admins_select_all"
  ON public.tree_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update records
CREATE POLICY "admins_update_all"
  ON public.tree_records
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 5. Enable Realtime on tree_records
-- Run this in Supabase Dashboard → Database → Replication
-- OR via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE public.tree_records;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Bucket Setup (run in Supabase Dashboard → Storage)
-- OR via SQL using storage schema:
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tree-photos',
  'tree-photos',
  TRUE,
  5242880,  -- 5MB max per photo
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to their own folder
CREATE POLICY "auth_users_upload_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tree-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anyone can view photos (public bucket)
CREATE POLICY "public_read_tree_photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'tree-photos');

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (run after migration to confirm)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT * FROM public.tree_records LIMIT 5;
-- SELECT * FROM storage.buckets WHERE id = 'tree-photos';