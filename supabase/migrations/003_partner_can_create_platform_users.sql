-- Partners create users, not just field staff.
--
-- Until now a partner could only invite people into three partner-scoped roles
-- (admin, field_officer, viewer), all of which are ways of working *inside* the
-- partner org. The requirement is broader: a partner also onboards Business and
-- Individual accounts — real platform users with their own dashboards — and the
-- trees captured against that partner's projects roll up to the partner.
--
-- Two constraints blocked that:
--
--   1. partner_team_members.role only allowed the three partner roles, so a
--      business/individual invite failed with
--      "violates check constraint partner_team_members_role_check".
--
--   2. There was no link from a team member back to their auth account, so an
--      invited person could not be resolved to the user who then signs in and
--      captures. Email was doing that job implicitly, which breaks the moment
--      someone changes their address.
--
-- Run this in the Supabase SQL editor before using the new invite options.

-- ── 1. Allow the two platform account types as invite roles ─────────────────
ALTER TABLE partner_team_members
  DROP CONSTRAINT IF EXISTS partner_team_members_role_check;

ALTER TABLE partner_team_members
  ADD CONSTRAINT partner_team_members_role_check
  CHECK (role IN ('admin', 'field_officer', 'viewer', 'business', 'individual'));

-- ── 2. Link a team member to the account that was created for them ──────────
-- Nullable: rows seeded before this migration have no auth account, and the
-- backend still falls back to matching on email for those.
ALTER TABLE partner_team_members
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS partner_team_members_user_id_idx
  ON partner_team_members (user_id);

-- One membership per person per org, so a repeated invite updates rather than
-- silently duplicating. Partial, because legacy rows have a NULL user_id.
CREATE UNIQUE INDEX IF NOT EXISTS partner_team_members_partner_user_idx
  ON partner_team_members (partner_id, user_id)
  WHERE user_id IS NOT NULL;

-- ── 3. Backfill the link for existing rows, by email ────────────────────────
-- profiles has no email column, so the address lives in auth.users.
UPDATE partner_team_members tm
SET user_id = u.id
FROM auth.users u
WHERE tm.user_id IS NULL
  AND lower(u.email) = lower(tm.email);
