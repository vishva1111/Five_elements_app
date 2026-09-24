-- New platform accounts (Business/Individual "Users") are now created within
-- one project, not just under the org generally — the partner picks a
-- project at creation time and it's compulsory. partner_team_members has
-- nowhere to hold that yet.
--
-- projects.id is a text slug (e.g. "ahmedabad-urban-canopy"), not a uuid, so
-- the FK below references it as text.
--
-- Run this in the Supabase SQL editor before creating Users with a project.
-- Existing Team org-role members (admin/field_officer/viewer) are untouched —
-- project_id stays null for them; it's only required for Business/Individual.

ALTER TABLE partner_team_members
  ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS partner_team_members_project_id_idx
  ON partner_team_members (project_id);
