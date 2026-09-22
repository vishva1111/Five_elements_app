-- The tasks_status_check constraint only allowed ('assigned', 'in_progress', 'completed').
-- It never included 'approved'/'rejected', even though the entire task-review feature
-- (backend PUT /api/admin/tasks/:id/approve|reject, the app's TaskStatus type, the Task
-- Review UI) has always assumed those were valid statuses. Every approve/reject attempt
-- was failing with a 500 "violates check constraint tasks_status_check" until this fix.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('assigned', 'in_progress', 'completed', 'approved', 'rejected'));
