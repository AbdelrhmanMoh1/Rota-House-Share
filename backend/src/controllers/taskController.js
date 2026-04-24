const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// POST /api/households/:householdId/tasks
const createTask = async (req, res, next) => {
  const { householdId } = req.params;
  const { title, description, assigned_to, rotation_type = 'round-robin', frequency_days = 7 } = req.body;
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query(
      `INSERT INTO tasks (household_id, created_by, title, description, rotation_type, frequency_days)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [householdId, req.user.id, title, description || null, rotation_type, frequency_days]
    );
    const taskId = task.rows[0].id;

    let firstAssignee = assigned_to;
    if (!firstAssignee) {
      const members = await client.query(
        'SELECT user_id FROM household_members WHERE household_id = $1 ORDER BY joined_at LIMIT 1',
        [householdId]
      );
      if (members.rows.length > 0) firstAssignee = members.rows[0].user_id;
    }

    if (firstAssignee) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + frequency_days);
      await client.query(
        'INSERT INTO task_assignments (task_id, assigned_to, due_date) VALUES ($1, $2, $3)',
        [taskId, firstAssignee, dueDate.toISOString().split('T')[0]]
      );
    }

    await client.query('COMMIT');
    broadcast(householdId, { type: 'TASK_CREATED', task: task.rows[0] });
    res.status(201).json({ task: task.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/households/:householdId/tasks
const getTasks = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         t.id, t.title, t.description, t.household_id, t.frequency_days, t.created_at,
         ta.id   AS assignment_id,
         COALESCE(ta.status, 'pending') AS status,
         ta.due_date,
         ta.completed_at,
         u.id    AS assigned_to_id,
         u.name  AS assigned_to_name
       FROM tasks t
       LEFT JOIN LATERAL (
         SELECT * FROM task_assignments
         WHERE task_id = t.id
         ORDER BY created_at DESC LIMIT 1
       ) ta ON TRUE
       LEFT JOIN users u ON u.id = ta.assigned_to
       WHERE t.household_id = $1
       ORDER BY t.created_at DESC`,
      [householdId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

// =============================================================================
// FIX (Bug #1): Proper toggle endpoint.
//
// PATCH /api/tasks/:taskId/toggle
//
// The old endpoint /api/tasks/:taskId/complete only matched rows where
// status='pending'. That produced two failure modes users saw as "nothing
// happens":
//   (a) a task that was already completed couldn't be un-ticked —> 404
//   (b) an offline-created task (local_ prefix, not a UUID) —> DB error
//       swallowed by the frontend catch block, optimistic flip reverted
//       on refetch.
//
// The new toggle:
//   - Loads the latest assignment (FOR UPDATE, transactional)
//   - If no assignment exists (shouldn't happen, but guarded), 404
//   - Flips pending <-> completed on THAT assignment — no new insert,
//     so round-robin does not advance on a mistaken click + unclick.
//   - On a fresh pending -> completed transition AND round-robin mode,
//     we still create the NEXT assignment to keep the rotation going.
//     Un-ticking does NOT remove the next assignment (that would get
//     weird if someone already completed it).
//   - Returns the new status so the frontend can render from truth,
//     not from an optimistic guess.
// =============================================================================
const toggleTaskStatus = async (req, res, next) => {
  const { taskId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load the latest assignment for this task
    const latest = await client.query(
      `SELECT * FROM task_assignments
       WHERE task_id = $1
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [taskId]
    );
    if (latest.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No assignment found for this task' });
    }

    const assignment = latest.rows[0];
    const nextStatus = assignment.status === 'completed' ? 'pending' : 'completed';

    // 2. Flip it
    // FIX: compute completed_at in JS so we don't reuse $1 in two different
    // type contexts (which caused "inconsistent types deduced for parameter $1").
    const completedAt = nextStatus === 'completed' ? new Date() : null;
    const updated = await client.query(
      `UPDATE task_assignments
         SET status       = $1,
             completed_at = $2
       WHERE id = $3
       RETURNING *`,
      [nextStatus, completedAt, assignment.id]
    );

    // 3. If we just completed it AND rotation is round-robin AND the next
    //    rotation hasn't already been queued (no younger pending assignment),
    //    create the next assignment.
    if (nextStatus === 'completed') {
      const task = await client.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      if (task.rows.length > 0) {
        const t = task.rows[0];
        if (t.rotation_type === 'round-robin') {
          // Only auto-create next assignment when no newer pending one exists
          const newerPending = await client.query(
            `SELECT id FROM task_assignments
             WHERE task_id = $1 AND status = 'pending' AND id <> $2`,
            [taskId, assignment.id]
          );
          if (newerPending.rows.length === 0) {
            const members = await client.query(
              'SELECT user_id FROM household_members WHERE household_id = $1 ORDER BY joined_at',
              [t.household_id]
            );
            const ids = members.rows.map(r => r.user_id);
            if (ids.length > 0) {
              const nextIndex = (t.current_index + 1) % ids.length;
              const nextUser  = ids[nextIndex];
              const dueDate   = new Date();
              dueDate.setDate(dueDate.getDate() + (t.frequency_days || 7));
              await client.query(
                'INSERT INTO task_assignments (task_id, assigned_to, due_date) VALUES ($1,$2,$3)',
                [taskId, nextUser, dueDate.toISOString().split('T')[0]]
              );
              await client.query('UPDATE tasks SET current_index = $1 WHERE id = $2', [nextIndex, taskId]);
              await client.query(
                `INSERT INTO notifications (user_id, household_id, type, message, data)
                 VALUES ($1,$2,'task_assigned',$3,$4)`,
                [nextUser, t.household_id, `You have been assigned: ${t.title}`,
                  JSON.stringify({ task_id: taskId, due_date: dueDate })]
              );
              broadcast(t.household_id, { type: 'TASK_ASSIGNED', taskId, assignedTo: nextUser });
            }
          }
        }
        broadcast(t.household_id, { type: 'TASK_TOGGLED', taskId, status: nextStatus, by: req.user.id });
      }
    }

    await client.query('COMMIT');
    res.json({ assignment: updated.rows[0], status: nextStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

const assignTask = async (req, res, next) => {
  const { taskId } = req.params;
  const { user_id, due_date } = req.body;
  if (!user_id || !due_date) return res.status(400).json({ error: 'user_id and due_date are required' });
  try {
    const result = await pool.query(
      'INSERT INTO task_assignments (task_id, assigned_to, due_date) VALUES ($1,$2,$3) RETURNING *',
      [taskId, user_id, due_date]
    );
    const task = await pool.query('SELECT household_id, title FROM tasks WHERE id = $1', [taskId]);
    if (task.rows.length > 0) {
      broadcast(task.rows[0].household_id, { type: 'TASK_ASSIGNED', taskId, assignedTo: user_id });
    }
    res.json({ assignment: result.rows[0] });
  } catch (err) { next(err); }
};

const deleteTask = async (req, res, next) => {
  const { taskId } = req.params;
  try {
    const task = await pool.query('SELECT household_id FROM tasks WHERE id = $1', [taskId]);
    if (task.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    broadcast(task.rows[0].household_id, { type: 'TASK_DELETED', taskId });
    res.json({ message: 'Task deleted' });
  } catch (err) { next(err); }
};

module.exports = { createTask, getTasks, toggleTaskStatus, assignTask, deleteTask };
