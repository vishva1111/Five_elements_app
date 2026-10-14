# TreeApp — developer guide

Five Elements field app. A signed-in user works one active project: plant assigned trees, save admin-assigned audits, and review the same trees on the map and in search.

This document describes the app as the source works today. `README.md` is older and is not the contract. When this file and the source disagree, read the source, then update this file.

Stack: Expo 57, React Native 0.86, React 19, React Navigation 6, Zustand, Supabase (`@supabase/supabase-js`). Maps render in a WebView (Mapbox when `EXPO_PUBLIC_MAPBOX_TOKEN` is set, otherwise the map falls back). Photos go to the `tree-photos` bucket.

## 1. How the app is wired

`App.tsx` owns navigation and the auth listener.

- No session, or `projectSelectionPending`, shows `Login`.
- A session shows the main tabs plus extra stack screens.
- The auth listener must not `await` database work inside the callback. Supabase holds an auth lock while that callback runs. Awaiting there deadlocks the next sign-in.

Tabs, left to right:

| Tab | Screen | Job |
| --- | --- | --- |
| Home | `src/screens/Home/HomeScreen.tsx` | Project, capture entry, counts |
| Task | `src/screens/Task/TaskScreen.tsx` | Assigned, Completed, Approved, Rejected |
| Search | `src/screens/History/HistoryScreen.tsx` | Condition, status, and audit history |
| Profile | `src/screens/Profile/ProfileScreen.tsx` | User, projects, sign out |

Stack screens above the tabs:

| Route | Screen |
| --- | --- |
| `ProjectSelect` | `src/screens/Home/ProjectSelectScreen.tsx` |
| `Notifications` | `src/screens/Home/NotificationHistoryScreen.tsx` |
| `Capture` | Camera → Map picker → Tree form → Success |
| `TreeDetail` | `src/screens/History/TreeDetailScreen.tsx` |
| `EditTree` | `src/screens/History/EditTreeScreen.tsx` |
| `Map` | `src/screens/Map/TreeMapScreen.tsx` |

The floating tab bar hides on Tree Detail, Edit Tree, Map, and any nested screen that is not the first screen of its stack. Home, Task, Search, and Profile stay swipeable.

Search has its own stack: History list, Tree Detail, Edit Tree, Map.

## 2. Modules

### Screens

| Path | Responsibility |
| --- | --- |
| `src/screens/Auth/LoginScreen.tsx` | Sign in. May own project choice while `projectSelectionPending` is true. |
| `src/screens/Home/HomeScreen.tsx` | Active project, Capture a Tree, approved / rejected / completed counts, land-boundary prompt. |
| `src/screens/Home/ProjectSelectScreen.tsx` | Change the active project. |
| `src/screens/Home/NotificationHistoryScreen.tsx` | Work notices. Opening the list clears seen notices. |
| `src/screens/Task/TaskScreen.tsx` | The only place task cards are split into tabs. |
| `src/screens/Capture/CaptureScreen.tsx` | Camera for a planting. |
| `src/screens/Capture/MapPickerScreen.tsx` | Confirm GPS on the map. |
| `src/screens/Capture/TreeFormScreen.tsx` | Save the planting. |
| `src/screens/Capture/SubmitSuccessScreen.tsx` | Success after planting save. |
| `src/screens/History/HistoryScreen.tsx` | Search. Audited trees use the audit card. Planted-only trees stay planting cards. |
| `src/screens/History/TreeDetailScreen.tsx` | Tree profile. Save Audit and Edit Audit live here, not on the task card. |
| `src/screens/History/EditTreeScreen.tsx` | Planting resubmit, or the audit form when `auditRound` is set. |
| `src/screens/History/UpdateTreeScreen.tsx` | Older update screen. The live audit and reject paths use Edit Tree. |
| `src/screens/Map/TreeMapScreen.tsx` | All project trees, land-boundary walk, tree detail card. |
| `src/screens/Profile/ProfileScreen.tsx` | Name, projects list, sign out. |

### Services

| Path | Responsibility |
| --- | --- |
| `src/services/supabase.ts` | Client. Bucket name `tree-photos`. |
| `src/services/treeService.ts` | Trees, projects, profile, credits, monitoring reads and writes. |
| `src/services/taskService.ts` | Load tasks, start a planting, complete a planting or an audit. |
| `src/services/auditService.ts` | Audit schedule math and `submitAudit`. Does not insert the next audit task. |
| `src/services/storageService.ts` | Photo upload. |
| `src/services/projectGeofenceService.ts` | One land boundary per project, plus change requests. |
| `src/services/geofenceService.ts` | Per-tree circle alerts. |
| `src/services/treeLocationService.js` | GPS capture helper. |
| `src/services/mapboxConfig.ts` | Mapbox token and style. Empty token means no Mapbox. |
| `src/services/appDialog.tsx` | In-app notices. Not a second navigation system. |

### State

| Store | Holds |
| --- | --- |
| `src/store/authStore.ts` | User, session, assigned projects, active project, project-selection flag. |
| `src/store/taskStore.ts` | Task list, the planting started from a card (`activeTaskId`), and `pendingTaskTab` after an audit save. |
| `src/store/treeStore.ts` | Tree list for the open session. |
| `src/store/projectRefreshStore.ts` | `refreshKey`. Incrementing it reloads project-scoped screens. |

`activeTaskId` is how Camera → Map picker → Tree form know which planting to complete. Do not require every capture screen to grow its own task id param.

`pendingTaskTab` plus a short hold in Task Screen stop a slow read from putting a just-saved audit back on Assigned.

### Shared UI and types

- `src/components/TreeCard.tsx` — one card for planting and audit. The right-side badge is the tab signal.
- `src/components/FloatingTabBar.tsx` — tab bar.
- `src/types/index.ts` — `TreeRecord`, `Task`, route params, species defaults, the four audit rounds.
- `src/utils/treeId.ts` — project tree codes such as `ARAV-001`, and `##META##` notes parsing.

Species defaults live in `SPECIES_DEFAULTS`. Guava is `Psidium guajava`. `getSpeciesDefault` matches the common name, aliases split on `/`, then a contains-match of at least 4 characters.

## 3. Identity and project rules

- `projects.id` is text (a slug), not a uuid.
- `tree_records.id` is a uuid. `tree_records.tree_id` is the human code (`ARAV-001`).
- `tree_records.project_id` is text.
- `tasks.assignee_id` is a uuid. A profile id such as `partner-…` must never be sent in a uuid filter. `assigneeIdentity` already drops non-uuids.
- The active project is the last one this user selected, if it still exists, otherwise the first project returned by `fetchAllProjects`. Assigned projects do not gate that list.
- A task with an empty `project_id` still shows for the active project when it is assigned or in progress. That is how a planting can appear before it has a tree.

## 4. Task status is the tab

`tasks.status` is only one of: `assigned`, `in_progress`, `completed`, `approved`, `rejected`.

`normalizeTaskStatus` also accepts loose admin values (`pending`, `open`, `done`, `submitted`, `inprogress`) and maps them onto those five. Do not add a sixth status.

| Status | Who writes it | Where the card goes |
| --- | --- | --- |
| `assigned` | Admin, when they assign planting or an audit | Assigned |
| `in_progress` | App, when the user taps Planting on an assigned planting | Assigned |
| `completed` | App, after planting save or audit save | Completed |
| `approved` | Admin | Approved |
| `rejected` | Admin. `review_notes` is the reason | Rejected |

`in_progress` is still an open card. On an audit card the right-side badge still reads `ASSIGNED`. Completed, approved, rejected, and edited audits are removed from Assigned.

An audit is a task with `task_type = 'audit'` or `audit_round > 0`. Anything else on Assigned is a planting, including a missing `task_type`.

Counts on Home and Task count a tree once. An audit is not a second tree. Home adds open audits on top of that tree count so the Capture ring can show work that is still assigned.

## 5. Planting flow

1. Admin assigns a planting task: `status = assigned`, not an audit.
2. The Assigned card shows the task code (or the first 8 characters of the task id) and a **Planting** button.
3. Tapping Planting calls `startTask`, sets local status to `in_progress`, stores `activeTaskId`, and opens Capture.
4. The user takes photos, confirms the map point, and submits Tree Form.
5. Tree Form writes one `tree_records` row through `insertTreeRecord`, then `completeTask(taskId, treeId, location)` **without** `asAudit`.
6. That task becomes `completed` and leaves Assigned.
7. Admin approves: `tasks.status = approved` and the tree is `locked = true`. The card moves to Approved.
8. Admin rejects: `tasks.status = rejected` and `review_notes` holds the reason. The card shows **Edit**. Saving the planting edit calls `updateBaselineTree` and returns that task to `completed`.

Planting rules:

- The phone does not invent a planting task. `createTask` exists, but capture does not call it.
- A planting save does not write `task_type = 'audit'` and does not write `audit_round`.
- `locked = true` means the planting was approved. It must not by itself mark an audit task approved. `taskStatusFromTree` already refuses that.
- If a column is missing, `insertTreeRecord` retries and stores the extra fields in `notes` as `##META##{...}`. Prefer real columns. Do not stop reading `##META##` until every live row has been migrated.
- The capture form fills scientific name from the assigned task, the local tree, notes meta, then `getSpeciesDefault`. The field stays a stored value even when the common name is not in the species list.
- Card fronts show the species, not a scientific-name line. Scientific name belongs on the capture form and the tree profile.

## 6. Audit flow

Audits are rounds 1, 2, 3, and 4. The phone never creates the next round.

1. The planting is completed, then admin-approved (`locked` tree, planting task `approved`).
2. Admin inserts a **new** `tasks` row for Audit 1: same tree, same user, `task_type = 'audit'`, `audit_round = 1`, `status = 'assigned'`. No trigger and no app code may insert that row.
3. The audit card appears on Assigned. The right-side badge reads `ASSIGNED` while status is `assigned` or `in_progress`.
4. The card does not start the form. It opens Tree Detail with `taskId`, `asAuditProfile`, and `showSaveAudit: true`.
5. Tree Detail shows an ASSIGNED pill and a **Save Audit** button only when `showSaveAudit` is true and the linked task is an open audit. The button opens Edit Tree with `auditRound`.
6. Save Audit calls `submitAudit`, then `completeTask(..., { asAudit: true, auditRound })`.
7. The app sets that task to `completed` locally, asks the Task tab to open Completed, and navigates there.
8. Admin sets that same task to `approved` or `rejected`.
9. Realtime (and a 12-second fallback read) moves the card: `approved` opens Approved, `rejected` opens Rejected.
10. A rejected audit shows **Edit** on the card and **Edit Audit {round}** on the profile. Both open the same audit task. They do not create a new task.
11. Saving the correction sets `review_notes = 'edited'` only because it was rejected, sets status back to `completed`, and the badge shows `EDITED`.
12. Admin approves that same row. Audit 2, 3, and 4 are new admin-assigned rows after the previous round is approved. Same path. After round 4 is approved, the profile can show “All 4 Audits Completed”.

What `submitAudit` writes:

1. Uploads local photos. `https://` URLs are kept. The first URL is `photo_url`. The set is `photo_urls`.
2. Inserts the monitoring row (`tree_monitoring_records`) for `(tree_record_id, monitoring_round)`.
3. Copies measurements onto the same `tree_records` row (`survey_date`, condition, size). It does **not** set the tree’s stage or status to completed, and it does **not** unlock or lock the tree.
4. Closes the open audit task for **this round only** via `completeTask` with `asAudit: true`.
5. Returns `nextTask = null`. It does not insert Audit N+1.

`completeTask` for an audit always sends `status = 'completed'`, `completed_at`, `task_type = 'audit'`, and `audit_round`. It must not send `event_type`. The admin panel treats a completed row without `task_type = 'audit'` as a planting.

Closing rules:

- Close the task id that was opened, plus any other open or rejected audit task of the **same** round.
- Do not delete or complete a later round that is already `assigned`.
- A planting row linked to the same tree is not an audit and must not be closed by the audit save.
- One tree, one task per `audit_round`. A correction updates that task and that monitoring row.

Approved-tab rules:

- A tree with an open audit (`assigned` or `in_progress`) leaves Approved. The open audit on Assigned is the card the user must work. The tree must not sit on both tabs.
- After an audit is approved, the old approved planting card of that tree leaves Approved. The approved audit with the highest round stays.
- A rejected audit is never copied onto Approved.

Tree Detail task pick, in order:

1. If `showSaveAudit`, the requested `taskId`, else the open audit.
2. If `asAuditProfile`, the requested task, else the open audit, else the rejected audit.
3. Then a rejected audit, an open audit, any rejected task, a task whose id equals the tree id, then the first task.

`showSaveAudit` is what keeps Save Audit from turning into Edit Audit. Do not drop `taskId` when opening the profile from a card.

Schedule math in `getAuditStatus` is display-only. It is not stored and it does not create tasks. Planting does not start the audit clock. `MONITORING_ROUNDS` labels are the four visits. Do not turn “due” into an automatic task insert.

## 7. Home, search, map, profile

Home:

- **Capture a Tree** opens Task on the Assigned tab. It does not open the camera. The camera opens from the planting card’s Planting button.
- The ring on that card is the open-work count (`taskStats.assigned`), not a second tree list.
- The approved number opens Task on Approved. Rejected and Completed open those tabs.
- A project with no locked land boundary shows a prompt that opens Map with `startGeofenceWalk: true`. After the boundary is locked, that card stays hidden.

Search:

- Categories are condition, status, and audit.
- An audited tree uses the audit card. A tree with no audit stays a planting card.
- Rejected rows still offer Edit into Tree Detail.

Map:

- Shows project trees and the project polygon from `project_geofences`.
- Opening a tree’s detail card hides Mute, current-location, and Auto-Zoom Land Fence. The GPS pill at the top left stays.
- Those controls return when the card closes.
- The walk flow saves corners, area, and perimeter, then locks the boundary. Change requests use `geofence_change_requests`.

Profile:

- Shows the user and the project list. Sign out clears the session and the tree store.
- Hourly email digest is not part of the field UI.

## 8. Database contract

The phone talks to Supabase tables directly. There is no separate REST layer in this repo.

| Table | Role |
| --- | --- |
| `profiles` | Name, `auth_id`, credits. Credits default to 500 minus trees the user added in the active project. |
| `projects` | `id` text, `name`. |
| `user_projects` | Optional assignment rows. Not the gate for the active-project list. |
| `tree_records` | One row per planted tree. |
| `tree_monitoring_records` | One row per tree per audit round. |
| `tasks` | One planting task, plus one task per audit round. This row decides the tab. |
| `project_geofences` | One boundary per `project_id`. |
| `geofence_change_requests` | Unlock / change requests. |
| storage `tree-photos` | Public photo URLs saved on the tree and the monitoring row. |

Schema source: `supabase/migrations/001_add_tree_columns.sql`. Partner SQL is in `003_partner_can_create_platform_users.sql` and `004_partner_team_members_project.sql`.

`tasks.status` check constraint allows only the five statuses in section 4.

Task columns the app reads and writes:

- Identity: `id`, `name`, `task_code`, `project_id`, `assignee_id`, `created_by`, `created_at`
- Tree link: `tree_id`, `tree_record_id` (both set to the tree uuid on complete)
- Audit: `task_type`, `audit_round`
- Flow: `status`, `started_at`, `completed_at`, `due_date`, `priority`, `target_count`, `location`
- Review: `reviewed_by`, `reviewed_at`, `review_notes` (`edited` after a rejected card is saved)

Tree columns the app reads and writes: `id`, `tree_id`, `user_id`, `project_id`, `photo_url`, `photo_urls`, `latitude`, `longitude`, `species`, `scientific_name`, `health_status`, `tree_condition`, `notes`, `submitted_at`, `event_type`, `quantity`, measurements (`dbh_cm`, `height_m`, `wood_density`, `crown_diameter_m`, `multi_stem`, `age_years`), `land_type`, `surveyor`, `survey_date`, `locked`, plus assignment leftovers `assigned_to` and `team_member_id`.

Monitoring columns: `tree_record_id`, `tree_id` (human code), `monitoring_round` 1–4, `user_id`, `project_id`, photos, lat/lng, measurements, `tree_condition`, `health_status`, `survival_status` (`alive` / `dead` / `missing`), `notes`, `surveyor`, `survey_date`, `submitted_at`. Unique key is `(tree_record_id, monitoring_round)`.

Writes retry when PostgREST says a column is missing. `status` and `completed_at` are never dropped from a task update. A missing extra column must not leave the task open.

Admin assignment for an audit, so the app can see it:

```sql
insert into public.tasks (
  name, project_id, assignee_id, tree_id, tree_record_id,
  task_type, audit_round, status, priority, target_count,
  due_date, created_by, location
) values (
  'Audit 1 — ARAV-001',
  '<project id>',
  '<field user auth uuid>',
  '<tree uuid>',
  '<tree uuid>',
  'audit',
  1,
  'assigned',
  'medium',
  1,
  now(),
  '<admin uuid>',
  '<latitude, longitude>'
);
```

Approve and reject update that same row’s `status`, `reviewed_by`, `reviewed_at`, and `review_notes`. They do not insert a new task.

## 9. Card badge

`TreeCard` is the right-side badge.

- Open audit (`assigned` or `in_progress`): `ASSIGNED`.
- Completed audit with empty review notes: `COMPLETED`.
- Completed after a reject edit (`review_notes` set): `EDITED` in `#ea580c`.
- Approved audit: `APPROVED` on `#f3e8ff` / `#ddd6fe`.
- Rejected audit: `REJECTED`.
- Planting uses the same status words, in uppercase, and is not labeled Audit.

Assigned planting cards are not tappable on the body. The Planting button starts capture. Assigned audit cards open the profile. Rejected cards use Edit.

Condition (Healthy / Stressed / Diseased / Dead) is shown only after a monitoring round exists. The latest audit wins.

## 10. Do not change these behaviors while fixing a bug

- Do not create Audit 2, 3, or 4 in the app or in a database trigger.
- Do not store an audit as a planting. Audit completion must keep `task_type = 'audit'`.
- Do not put a finished audit back on Assigned beside the next round.
- Do not show Save Audit on the task card. It stays on the assigned audit’s tree profile.
- Do not show Save Audit on an approved or rejected profile. Rejected uses Edit / Edit Audit.
- Do not remove planting from Assigned while it is `assigned` or `in_progress`.
- Do not let `tree.locked` approve an audit task.
- Do not write the audit result onto `tree_records.status` or `stage`.
- Do not drop scientific name from the capture form or the profile. Do not put it back on the card front.
- Do not cover map controls with the detail card. Hide those controls while the card is open.
- Keep the planting accordion on Tree Detail closed until the user opens it.
- Keep photos full-frame. Do not add a crop step back into the audit upload.

## 11. Run

```bash
npm install
npm start
```

Copy `.env.example` to `.env`. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Optional: `EXPO_PUBLIC_MAPBOX_TOKEN`.

Apply `supabase/migrations/001_add_tree_columns.sql` in the Supabase SQL editor when a write fails with a schema-cache or missing-column error. The app will still save by dropping unknown columns, but audits need `tree_monitoring_records`, `tasks.task_type`, and `tasks.audit_round`.

Typecheck:

```bash
npx tsc --noEmit --pretty false --skipLibCheck
```
