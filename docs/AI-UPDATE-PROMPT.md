# Paste this to an AI before any TreeApp update

Copy everything below the line into the AI. Attach the new SQL or API notes if the backend changed. Do not shorten the rules.

---

You are updating the Five Elements TreeApp at `d:/5eliment/app/treeapp` (Expo, React Native, Supabase). Read this prompt and the current source of every file you touch before you edit. The source wins over old chat notes and over `README.md`. After a database or API change, adapt reads and writes so the flow below still happens. Do not redesign the flow to match a new column name.

## Outcome you must protect

A field user plants an assigned tree, then completes only the audit round an admin has assigned. Each save moves that one task to Completed. Admin approve or reject moves that same task. The phone never creates the next audit.

## Status and tabs

`tasks.status` is only `assigned`, `in_progress`, `completed`, `approved`, or `rejected`.

- Assigned tab: planting when status is `assigned` or `in_progress`. Audit when (`task_type = 'audit'` OR `audit_round > 0`) AND status is `assigned` or `in_progress`. The audit card’s right-side badge reads ASSIGNED for both of those open statuses. Any other audit status is removed from Assigned.
- Completed tab: status `completed` only. Stay there until admin sets `approved` or `rejected`.
- Approved tab: status `approved` only. If that tree has an open audit, the approved card leaves this tab. After any audit of the tree is approved, drop the older approved planting card and keep the approved audit with the highest `audit_round`.
- Rejected tab: status `rejected` only. Never copy a rejected audit onto Approved.

Normalize loose admin words (`pending`, `open`, `done`, `submitted`, `inprogress`) onto the five statuses. Do not add a new status.

An audit and a planting of the same tree are different task rows. Do not merge them into one card. Do not drop a later assigned audit because an earlier round was just completed.

## Planting logic

1. Admin creates the planting task. The app does not.
2. Assigned card button label is `Planting`. Tapping it calls `startTask`, sets `in_progress`, sets `activeTaskId`, opens Capture.
3. Camera → map confirm → Tree Form.
4. Tree Form calls `insertTreeRecord`, then `completeTask(taskId, treeId, location)` with no audit flag.
5. Task status becomes `completed`. It leaves Assigned and shows on Completed.
6. Admin `approved` plus `tree_records.locked = true` means the planting is approved.
7. Admin `rejected` shows Edit. Saving uses `updateBaselineTree` and sets that same task back to `completed`. If it was rejected, `review_notes = 'edited'`.

`locked = true` must never mark an audit task approved.

Capture scientific name fills from the assigned task, then the local tree, then `##META##` in notes, then `getSpeciesDefault` (Guava = `Psidium guajava`), then a tree fetch only if the field is still empty. Card fronts do not show a scientific-name line. The capture field and the tree profile still do.

## Audit logic

Rounds are 1, 2, 3, 4. Admin inserts each round as its own `tasks` row after the previous round is approved. `submitAudit` returns `nextTask = null`. Do not insert into `tasks` from `submitAudit`, `ensureAuditTaskForTree`, a save handler, or a new trigger.

1. Assigned audit card opens Tree Detail with `treeId`, `taskId`, `asAuditProfile: true`, and `showSaveAudit: true`. The card has no Save Audit button.
2. Tree Detail links the task in this order: if `showSaveAudit`, use `taskId` or the open audit; if `asAuditProfile`, use `taskId` or the open audit or the rejected audit; then rejected audit, open audit, any rejected task, id match, first row. An open audit is `assigned` or `in_progress` with `task_type = 'audit'` or `audit_round > 0`.
3. Save Audit shows only when `showSaveAudit` is true and that linked task is an open audit. It navigates to Edit Tree with `auditRound` of that task, not “whatever round is missing”.
4. Edit Tree treats `auditRound > 0` as an audit. The header tag reads `Audit {round}`. The save button reads Save Audit.
5. Save calls `submitAudit` with the tree, that round, the user, `taskId`, and the photo set, then `completeTask(taskId, treeId, undefined, { asAudit: true, auditRound, editedAfterReject })`.
6. `completeTask` for an audit writes `status = 'completed'`, `completed_at`, `task_type = 'audit'`, `audit_round`, and both `tree_id` and `tree_record_id` as the tree uuid. It does not write `event_type`. `editedAfterReject` also sets `review_notes = 'edited'`. A normal first save does not set `review_notes`.
7. Local store marks that task completed. `openTaskTab('completed')` and navigation go to the Task tab’s Completed list. Do not auto-open Approved.
8. On the next read, if a hold is active, an audit that was just completed stays `completed` even if a slow response still says `assigned` or `in_progress`. Do not let that stale row return it to Assigned. Do not block a different new audit of another tree.
9. Admin `approved` opens Approved. Admin `rejected` opens Rejected. `review_notes` on reject is the reason the user must fix.
10. Rejected audit Edit opens Edit Tree for the same task and same round. Save updates the same monitoring row and returns the same task to `completed` with `review_notes = 'edited'`. The badge reads EDITED (`#ea580c`). Do not create a second task or a second monitoring row for that round.

`submitAudit` steps, in order:

1. Upload only local photo URIs. Keep existing `https://` URLs. First URL is `photo_url`. All URLs are `photo_urls`. No crop.
2. Write `tree_monitoring_records` for this `tree_record_id` + `monitoring_round` (1–4). One row per pair. A second save of that pair updates it.
3. Update the same tree’s measurements and `survey_date`. Do not set tree stage, tree status, or `locked` from the audit.
4. Close this round’s open or rejected audit tasks only. Skip the planting row. Do not complete or delete a higher round that is already assigned.

## Backend change rules

If a column was renamed, removed, or added:

- Map the new column onto the same meaning. `task_type = 'audit'` and `audit_round` must still be stored when an audit is completed, whatever the new physical names are.
- Keep the five statuses. If the API uses different words, translate them at the service edge in `normalizeTaskStatus`. Do not change tab filters to the raw new words.
- `assignee_id` filters must stay uuids. Never query uuid columns with a text profile id.
- `projects.id` and `tree_records.project_id` are text. `tree_records.id` is uuid. `tree_records.tree_id` is the human code.
- Missing-column retries stay. Never drop `status` or `completed_at` from a task update. Unknown extra fields may be omitted and, for a tree insert, preserved in `notes` as `##META##`.
- Do not create audit tasks in the app to “fill” a schedule. Due labels are display-only.
- Admin approve/reject still only updates the same task row.
- Photo bucket remains `tree-photos` unless the new API returns a finished public URL. Store that URL. Do not store local file URIs.

Tables and the only jobs they have:

- `tasks` — which tab a card is on.
- `tree_records` — the planted tree. Audit updates measurements only.
- `tree_monitoring_records` — one saved visit per round.
- `project_geofences` — one locked boundary per project.
- `profiles`, `projects`, `user_projects` — login and project list. The active project is the cached project if it still exists, else the first of all projects. Assignment rows do not hide other projects.

## UI rules that are part of the logic

- Home “Capture a Tree” opens Task on Assigned. It does not open the camera.
- Home approved count opens Approved. Rejected and Completed counts open those tabs.
- Save Audit is only the tree-profile button of an open assigned audit. Not on the card. Not on Approved.
- Rejected planting: profile button Edit. Rejected audit: card Edit and profile `Edit Audit {round}`.
- Map: while a tree detail card is open, hide Mute, current location, and Auto-Zoom Land Fence. Leave the GPS pill. Restore the controls when the card closes.
- After the land boundary is locked, hide the “boundary still needed” card.
- Tree Detail planting accordion starts closed.
- Do not change planting card layout, colors, or the Planting button while fixing an audit bug.

## Files that own the flow

Change the smallest of these. Do not split the rules across a new helper unless the file already has one.

- Tabs and card actions: `src/screens/Task/TaskScreen.tsx`
- Badge: `src/components/TreeCard.tsx`
- Profile buttons and which task is linked: `src/screens/History/TreeDetailScreen.tsx`
- Save planting vs save audit: `src/screens/History/EditTreeScreen.tsx`
- Complete a task without turning an audit into a planting: `src/services/taskService.ts`
- Audit write and “do not create the next task”: `src/services/auditService.ts`
- Tree insert, monitoring upsert, `locked`: `src/services/treeService.ts`
- Route params `showSaveAudit` and `asAuditProfile`: `src/types/index.ts`
- Capture scientific name: `src/screens/Capture/TreeFormScreen.tsx` and `src/types/index.ts` `getSpeciesDefault`

## Bugfix method

1. Read the file you will edit. Do not patch from memory.
2. Decide whether the bug is planting or audit. Fix only that path.
3. Reproduce the status change in data: which row, which status before, which status after. If you cannot name that, do not edit.
4. Keep both sides of a two-step save in the same change: the database write and the local store update that moves the card.
5. Run `npx tsc --noEmit --pretty false --skipLibCheck` from `d:/5eliment/app/treeapp`. A command that is interrupted is not a pass.

## Done means all of these are still true

- Assigned shows a planting only while it is assigned or in progress, with button Planting.
- Assigned shows an audit only while it is assigned or in progress, badge ASSIGNED, and opening it shows Save Audit on the profile.
- Saving that audit sets that task to completed, keeps `task_type = 'audit'`, opens Completed, and does not insert the next round.
- Approve and reject move that same card and no other round.
- Editing a rejection returns that same card to Completed as EDITED.
- An approved planting does not stay on Approved after its audit is assigned or after a later audit is approved.
- A planting save still does not write audit fields.
