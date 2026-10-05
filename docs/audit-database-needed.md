**Audit database for the backend developer**  
The app screens stay as they are. Do not change the card design, tab design, or planting flow.  
The first audit is not created by the phone. An admin assigns it after the planting is approved. The existing tree card then appears on the Assigned tab because it is the same tree id.  
**Full flow**  
1. The user completes planting. The planting task is completed.  
2. The admin approves that planting. The tree is approved.  
3. The admin assigns Audit 1 for that same tree and the same user. This is a new task row. It is not created automatically.  
4. The existing tree-id card appears on the Assigned tab.  
5. The user completes that audit.  
6. The same card moves to the Completed tab.  
7. The admin approves or rejects it.  
8. Approved opens the Approved tab. Rejected opens the Rejected tab.  
9. A rejected audit card shows the existing Edit button and opens the audit edit page.  
10. After the user saves the edit, the card returns to the Completed tab.  
11. The admin approves it. That audit is then complete.  
12. Audit 2, 3, and 4 follow the same path. The admin assigns the next round only after the previous round is approved.  
No screen creates the next audit by itself.  
**Status values the app already reads**  
The tasks.status value decides the tab. Use only these values.  
| | | | |  
|-|-|-|-|  
| **Step** | **Who writes it** | **tasks.status** | **Where the card shows** |   
| Admin assigns the audit | Admin | assigned | Assigned tab |   
| User finishes the audit | App | completed | Completed tab |   
| Admin approves | Admin | approved | Approved tab |   
| Admin rejects | Admin | rejected | Rejected tab |   
| User edits and saves a rejected audit | App | completed | Completed tab again |   
   
The app already sends the user to the Completed tab after a successful audit save. The admin approve or reject then moves that card by changing tasks.status.  
**Tables**  
public.tasks** — the card**  
This table already exists. One planting has one task. Each audit round has its own task for the same tree.  
Columns that already exist and must be written:  
| | | | | | |  
|-|-|-|-|-|-|  
| **Column** | **Planting approval** | **Admin assigns Audit 1** | **User completes audit** | **Admin approves** | **Admin rejects** |   
| id | existing planting task | new UUID | same audit task | same audit task | same audit task |   
| name | unchanged | Audit 1 — ARAV-001 | unchanged | unchanged | unchanged |   
| project_id | existing | same project | unchanged | unchanged | unchanged |   
| assignee_id | existing user | same user | unchanged | unchanged | unchanged |   
| tree_id | tree UUID | same tree UUID | unchanged | unchanged | unchanged |   
| status | approved | assigned | completed | approved | rejected |   
| completed_at | planting time | empty | save time | unchanged | unchanged |   
| created_at | existing | assignment time | unchanged | unchanged | unchanged |   
| created_by | existing | admin user id | unchanged | unchanged | unchanged |   
| reviewed_by | admin user id | empty | empty | admin user id | admin user id |   
| reviewed_at | approval time | empty | empty | approval time | rejection time |   
| review_notes | empty | empty | empty | empty | reason shown on the card |   
| priority | existing | medium | unchanged | unchanged | unchanged |   
| target_count | existing | 1 | unchanged | unchanged | unchanged |   
| due_date | existing | admin due date | unchanged | unchanged | unchanged |   
| task_code | existing | generated | unchanged | unchanged | unchanged |   
| location | existing | tree GPS text | unchanged | unchanged | unchanged |   
   
Columns that are missing and must be added:  
| | | | |  
|-|-|-|-|  
| **Missing column** | **Type** | **What to write** | **Why** |   
| tree_record_id | uuid | tree UUID | Links the card to the existing tree |   
| audit_round | integer | 1, 2, 3, or 4 | Tells the app which audit this card is |   
| task_type | text | audit | Tells the app this card is an audit, not planting |   
| notes | text | optional short note | Task note |   
| remaining | integer | 1 when assigned | Count still left on the task |   
| progress | integer | 0 when assigned | Percent complete, 0 to 100 |   
   
tasks.title is not required. The app reads tasks.name. tasks.captured already exists. tasks.remaining and tasks.progress are missing. Do not store captured, remaining, or progress on the phone. captured is the number of saved trees for that task. remaining is target_count - captured. progress is that share as a percent.  
Admin assignment example for the first audit:  
insert into public.tasks (  
   name,  
   project_id,  
   assignee_id,  
   tree_id,  
   tree_record_id,  
   task_type,  
   audit_round,  
   status,  
   priority,  
   target_count,  
   due_date,  
   created_by,  
   location  
 ) values (  
   'Audit 1 — ARAV-001',  
   '<project id>',  
   '<same field user id>',  
   '<tree uuid>',  
   '<tree uuid>',  
   'audit',  
   1,  
   'assigned',  
   'medium',  
   1,  
   now(),  
   '<admin user id>',  
   '<latitude, longitude>'  
 );  
   
When the user completes it, update that same row:  
update public.tasks  
 set status = 'completed',  
     completed_at = now()  
 where id = '<audit task id>';  
   
When the admin rejects it:  
update public.tasks  
 set status = 'rejected',  
     reviewed_by = '<admin user id>',  
     reviewed_at = now(),  
     review_notes = '<reason the user must fix>'  
 where id = '<audit task id>';  
   
When the admin approves it:  
update public.tasks  
 set status = 'approved',  
     reviewed_by = '<admin user id>',  
     reviewed_at = now(),  
     review_notes = null  
 where id = '<audit task id>';  
   
Rules:  
- Do not create this audit row from a database trigger.  
- Do not create Audit 2 until the admin assigns it.  
- One tree can have only one task for each audit_round.  
- A rejected audit is edited on the same task. Do not create a second task for the correction.  
- After the correction is saved, set that same task back to completed.  
public.tree_monitoring_records** — the audit data**  
This table does not exist. The live API returns PGRST205 for it. This is the save error in the app. Create it. One row is one completed audit round for one tree.  
| | | | |  
|-|-|-|-|  
| **Column** | **Type** | **Required** | **What the audit page writes** |   
| id | uuid default gen_random_uuid() | yes | Generated id |   
| tree_record_id | uuid | yes | Existing tree UUID |   
| tree_id | text | yes | Existing project tree id, such as ARAV-001 |   
| monitoring_round | integer | yes | 1, 2, 3, or 4 |   
| user_id | uuid | yes | Field user who saved it |   
| project_id | text | yes | Project id |   
| photo_url | text | yes | First audit photo |   
| photo_urls | jsonb | yes | All 3 photo URLs |   
| latitude | double precision | yes | Tree latitude |   
| longitude | double precision | yes | Tree longitude |   
| dbh_cm | numeric | no | Trunk diameter |   
| height_m | numeric | no | Tree height |   
| crown_diameter_m | numeric | no | Crown width |   
| wood_density | numeric | no | Wood density |   
| age_years | numeric | no | Age |   
| multi_stem | boolean | no | More than one stem |   
| tree_condition | text | yes | Healthy, Average, Poor, or Dead |   
| health_status | text | yes | healthy, dead, or unknown |   
| survival_status | text | yes | alive, dead, or missing |   
| notes | text | no | Field notes |   
| surveyor | text | no | Surveyor name |   
| survey_date | date | yes | Audit date |   
| submitted_at | timestamptz default now() | yes | Save time |   
   
The unique key is (tree_record_id, monitoring_round).  
- The first save inserts that row.  
- Edit Audit updates the same row. It does not insert a second row for the same round.  
- The app reads these rows by tree_record_id and orders them by monitoring_round.  
public.tree_records** — the existing tree**  
This table already exists. The audit must not create a new tree. It updates the same tree with the latest visit.  
Columns that already exist and are updated after an audit save:  
| | |  
|-|-|  
| **Column** | **What to write** |   
| photo_url | Latest first photo |   
| survey_date | Audit date |   
| surveyor | Surveyor name |   
| dbh_cm | Latest diameter |   
| height_m | Latest height |   
| crown_diameter_m | Latest crown |   
| wood_density | Latest density |   
| age_years | Latest age |   
| multi_stem | Latest value |   
| tree_condition | Latest condition |   
| health_status | Latest health |   
| notes | Latest visible notes |   
   
Missing columns to add:  
| | | | |  
|-|-|-|-|  
| **Missing column** | **Type** | **What to write** | **Why** |   
| photo_urls | jsonb | all 3 latest photo URLs | The tree card and detail page need the full set |   
| locked | boolean default false | true when admin approves planting | The app treats a locked tree as approved |   
   
**SQL to run**  
Run this in the Supabase SQL Editor.  
create table if not exists public.tree_monitoring_records (  
   id uuid primary key default gen_random_uuid(),  
   tree_record_id uuid not null,  
   tree_id text,  
   monitoring_round integer not null check (monitoring_round between 1 and 4),  
   user_id uuid,  
   project_id text,  
   photo_url text,  
   photo_urls jsonb,  
   latitude double precision,  
   longitude double precision,  
   dbh_cm numeric,  
   height_m numeric,  
   crown_diameter_m numeric,  
   wood_density numeric,  
   age_years numeric,  
   multi_stem boolean,  
   tree_condition text,  
   health_status text,  
   survival_status text,  
   notes text,  
   surveyor text,  
   survey_date date,  
   submitted_at timestamptz not null default now(),  
   unique (tree_record_id, monitoring_round)  
 );  
   
 create index if not exists tree_monitoring_records_tree_idx  
   on public.tree_monitoring_records (tree_record_id, monitoring_round);  
   
 alter table public.tree_monitoring_records enable row level security;  
   
 drop policy if exists audit_select_authenticated on public.tree_monitoring_records;  
 create policy audit_select_authenticated  
   on public.tree_monitoring_records for select to authenticated using (true);  
   
 drop policy if exists audit_insert_authenticated on public.tree_monitoring_records;  
 create policy audit_insert_authenticated  
   on public.tree_monitoring_records for insert to authenticated with check (true);  
   
 drop policy if exists audit_update_authenticated on public.tree_monitoring_records;  
 create policy audit_update_authenticated  
   on public.tree_monitoring_records for update to authenticated using (true) with check (true);  
   
 alter table public.tasks  
   add column if not exists tree_record_id uuid,  
   add column if not exists audit_round integer,  
   add column if not exists task_type text,  
   add column if not exists notes text,  
   add column if not exists remaining integer,  
   add column if not exists progress integer;  
   
 alter table public.profiles  
   add column if not exists credits integer default 500,  
   add column if not exists full_name text;  
   
 create unique index if not exists tasks_one_audit_round_per_tree  
   on public.tasks (tree_record_id, audit_round)  
   where task_type = 'audit' and audit_round is not null;  
   
 create index if not exists tasks_assignee_status_idx  
   on public.tasks (assignee_id, status);  
   
 alter table public.tree_records  
   add column if not exists photo_urls jsonb,  
   add column if not exists locked boolean default false;  
   
 create table if not exists public.project_geofences (  
   id uuid primary key default gen_random_uuid(),  
   project_id text not null unique,  
   project_name text,  
   coordinates jsonb not null,  
   area_sq_m numeric,  
   perimeter_m numeric,  
   status text not null default 'locked',  
   locked boolean not null default true,  
   locked_at timestamptz,  
   locked_by uuid,  
   locked_by_name text,  
   created_by uuid,  
   notes text,  
   created_at timestamptz not null default now(),  
   updated_at timestamptz not null default now()  
 );  
   
 alter table public.project_geofences enable row level security;  
   
 drop policy if exists geofence_select_authenticated on public.project_geofences;  
 create policy geofence_select_authenticated  
   on public.project_geofences for select to authenticated using (true);  
   
 drop policy if exists geofence_insert_authenticated on public.project_geofences;  
 create policy geofence_insert_authenticated  
   on public.project_geofences for insert to authenticated with check (true);  
   
 drop policy if exists geofence_update_authenticated on public.project_geofences;  
 create policy geofence_update_authenticated  
   on public.project_geofences for update to authenticated using (true) with check (true);  
   
 create table if not exists public.geofence_change_requests (  
   id uuid primary key default gen_random_uuid(),  
   project_id text not null,  
   project_name text,  
   requested_by uuid,  
   requested_by_name text,  
   reason text not null,  
   status text not null default 'pending',  
   created_at timestamptz not null default now(),  
   reviewed_at timestamptz,  
   reviewed_by uuid,  
   reviewed_by_name text,  
   review_notes text  
 );  
   
 alter table public.geofence_change_requests enable row level security;  
   
 drop policy if exists geofence_request_select_authenticated on public.geofence_change_requests;  
 create policy geofence_request_select_authenticated  
   on public.geofence_change_requests for select to authenticated using (true);  
   
 drop policy if exists geofence_request_insert_authenticated on public.geofence_change_requests;  
 create policy geofence_request_insert_authenticated  
   on public.geofence_change_requests for insert to authenticated with check (true);  
   
 drop policy if exists geofence_request_update_authenticated on public.geofence_change_requests;  
 create policy geofence_request_update_authenticated  
   on public.geofence_change_requests for update to authenticated using (true) with check (true);  
   
Reload the Supabase API schema after running it.  
**GPS tag and map**  
No new map table is needed. A tree pin is the existing tree_records row.  
These columns already exist and already hold the GPS tag:  
| | |  
|-|-|  
| **Existing column** | **What it holds** |   
| tree_records.latitude | Tagged latitude |   
| tree_records.longitude | Tagged longitude |   
| tree_records.photo_url | Photo taken at that point |   
| tree_records.species | Tree name shown on the map |   
| tree_records.health_status | Pin condition |   
| tasks.location | Same GPS as text on the task card |   
   
The map boundary is not stored on the tree. It is the missing project_geofences.coordinates value.  
**Profile — missing columns**  
public.profiles already exists. profiles.auth_id and profiles.display_name already exist. These two columns are missing and the app writes them:  
| | | | |  
|-|-|-|-|  
| **Missing column** | **Type** | **What to write** | **Why** |   
|   |   |   | |   
| full_name | text | User name | Name shown on audit and boundary records |   
   
public.user_projects already exists with user_id and project_id. No new column is needed there. It stores which projects belong to the signed-in user.  
Photos are files, not rows. They go in the existing Supabase Storage bucket tree-photos. tree_records.photo_url and photo_urls store only the public URLs.  
**Land boundary — missing tables**  
The live API returns PGRST205 for both tables below. They do not exist yet.  
public.project_geofences** — one boundary for one project**  
| | | |  
|-|-|-|  
| **Column** | **Type** | **What to write** |   
| id | uuid | Generated id |   
| project_id | text unique | Project id |   
| project_name | text | Project name |   
| coordinates | jsonb | Corner points: latitude, longitude, accuracy, timestamp |   
| area_sq_m | numeric | Area inside the boundary |   
| perimeter_m | numeric | Boundary length |   
| status | text | draft, pending_admin, or locked |   
| locked | boolean | true when the boundary is finished |   
| locked_at | timestamptz | Lock time |   
| locked_by | uuid | Admin or user id |   
| locked_by_name | text | Name shown in the app |   
| created_by | uuid | User who drew it |   
| notes | text | Optional note |   
| created_at | timestamptz | First save |   
| updated_at | timestamptz | Latest save |   
   
One project has one row. A new save updates that same row.  
public.geofence_change_requests** — request to change a locked boundary**  
| | | |  
|-|-|-|  
| **Column** | **Type** | **What to write** |   
| id | uuid | Generated id |   
| project_id | text | Project id |   
| project_name | text | Project name |   
| requested_by | uuid | User asking for the change |   
| requested_by_name | text | User name |   
| reason | text | Why the boundary should change |   
| status | text | pending, approved, or rejected |   
| created_at | timestamptz | Request time |   
| reviewed_at | timestamptz | Admin review time |   
| reviewed_by | uuid | Admin id |   
| reviewed_by_name | text | Admin name |   
| review_notes | text | Admin note |   
   
**Still only on the phone**  
These are not database tables. They are temporary phone copies and do not replace the tables above.  
| | | |  
|-|-|-|  
| **Phone storage** | **What it copies** | **Database it should use** |   
| Planting queue | A tree capture waiting for network | tree_records |   
| Project list cache | Project names | projects |   
| Dashboard count cache | Calculated counts | tree_records and tasks |   
| Login session | Signed-in user | Keep on the phone |   
   
No separate tagging table is needed.  
**Speed**  
- Read tasks for one user with assignee_id and status. The index above is for that query.  
- Read audits for the visible trees with one tree_record_id in (...) query, not one query per card.  
- Keep photos in photo_urls. Do not save a new audit row for each photo.  
- Do not add a local phone database for audits. The audit save and the card status both come from Supabase.  
**What is not the audit database**  
tree_monitoring_records is the audit table. Phone storage is not a substitute.  
These files are not part of this backend flow:  
- src/services/captureQueue.ts is only the planting offline queue.  
- src/store/queueStore.ts and src/screens/Capture/SyncQueueScreen.tsx belong to that same planting queue.  
- Login storage in src/services/supabase.ts must stay. It keeps the user signed in.  
The unused phone-only audit file src/services/localMonitoringService.ts has been removed. src/services/localTaskService.ts is already gone.  
