const pool = require('../db/pool');
const crypto = require('crypto');

const generateInviteCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

// POST /api/households
// FIX (Schema 5.1): creating a household while you already created one
// violates UNIQUE(created_by). We catch it and return a clean 409.
// Creating while already being a member also violates UNIQUE(user_id) on
// household_members — we check that up front and return 409.
const createHousehold = async (req, res, next) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Household name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Pre-flight: are you already in a household?
    const existing = await client.query(
      'SELECT household_id FROM household_members WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You are already in a household. Leave it before creating a new one.' });
    }

    let invite_code, conflict = true;
    while (conflict) {
      invite_code = generateInviteCode();
      const check = await client.query('SELECT id FROM households WHERE invite_code = $1', [invite_code]);
      conflict = check.rows.length > 0;
    }

    let hh;
    try {
      hh = await client.query(
        'INSERT INTO households (created_by, name, address, invite_code) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user.id, name, address || '', invite_code]
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint && err.constraint.includes('created_by')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'You have already created a household.' });
      }
      throw err;
    }

    await client.query(
      'INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,$3)',
      [hh.rows[0].id, req.user.id, 'admin']
    );

    await client.query('COMMIT');
    res.status(201).json(hh.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/households/:householdId
const getHousehold = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const hh = await pool.query('SELECT * FROM households WHERE id = $1', [householdId]);
    if (hh.rows.length === 0) return res.status(404).json({ error: 'Household not found' });

    const members = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, hm.role, hm.joined_at
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = $1`,
      [householdId]
    );

    res.json({ ...hh.rows[0], members: members.rows });
  } catch (err) { next(err); }
};

// GET /api/households/mine
const getMyHouseholds = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT h.*, hm.role
       FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE hm.user_id = $1
       ORDER BY h.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

// POST /api/households/join
// UNIQUE(user_id) on household_members makes "already in a household" a 409.
const joinHousehold = async (req, res, next) => {
  const { invite_code } = req.body;
  if (!invite_code) return res.status(400).json({ error: 'Invite code is required' });

  try {
    const hh = await pool.query('SELECT * FROM households WHERE invite_code = $1', [invite_code.toUpperCase()]);
    if (hh.rows.length === 0) return res.status(404).json({ error: 'Invalid invite code' });

    const household = hh.rows[0];

    try {
      await pool.query(
        'INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,$3)',
        [household.id, req.user.id, 'member']
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'You are already in a household. Leave it first to join another.' });
      }
      throw err;
    }

    res.json({ household });
  } catch (err) { next(err); }
};

const inviteMemberByEmail = async (req, res, next) => {
  const { householdId } = req.params;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const userResult = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: `No account found for ${email}. They need to register first.` });
    }
    const invitedUser = userResult.rows[0];

    try {
      await pool.query(
        'INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,$3)',
        [householdId, invitedUser.id, 'member']
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: `${invitedUser.name} is already in a household.` });
      }
      throw err;
    }

    res.json({ message: `${invitedUser.name} added successfully!`, user: invitedUser });
  } catch (err) { next(err); }
};

const regenerateInviteCode = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const invite_code = generateInviteCode();
    const result = await pool.query(
      'UPDATE households SET invite_code = $1 WHERE id = $2 RETURNING invite_code',
      [invite_code, householdId]
    );
    res.json({ invite_code: result.rows[0].invite_code });
  } catch (err) { next(err); }
};

// =============================================================================
// KICK MEMBER (Bug #2)
// DELETE /api/households/:householdId/members/:userId
//
// Rules:
//   - Caller must be admin of the household (enforced by requireHouseholdAdmin
//     middleware on the route).
//   - Cannot kick yourself (use leaveHousehold instead).
//   - Target must currently be a member of this household.
//   - Kick reason is REQUIRED; stored in a notification row so we don't need
//     a new table. The kicked user sees it in their notification list.
// =============================================================================
const kickMember = async (req, res, next) => {
  const { householdId, userId } = req.params;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return res.status(400).json({ error: 'A reason is required to kick a member.' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ error: 'Reason is too long (max 500 characters).' });
  }
  if (String(userId) === String(req.user.id)) {
    return res.status(400).json({ error: 'You cannot kick yourself. Use Leave Household instead.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Confirm the target is in this household and lock the row
    const m = await client.query(
      `SELECT hm.id, u.name AS kicked_name
         FROM household_members hm
         JOIN users u ON u.id = hm.user_id
        WHERE hm.household_id = $1 AND hm.user_id = $2
        FOR UPDATE`,
      [householdId, userId]
    );
    if (m.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That user is not a member of this household.' });
    }

    // Remove them
    await client.query(
      'DELETE FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, userId]
    );

    // Record a notification so the kicked user learns about it next time
    // they hit /api/notifications, and so we have an audit trail.
    await client.query(
      `INSERT INTO notifications (user_id, household_id, type, message, data)
       VALUES ($1, $2, 'member_kicked', $3, $4)`,
      [
        userId,
        householdId,
        'You were removed from the household.',
        JSON.stringify({ reason: reason.trim(), by: req.user.id, by_name: req.user.name })
      ]
    );

    await client.query('COMMIT');
    res.json({
      ok: true,
      message: `${m.rows[0].kicked_name} has been removed.`,
      reason: reason.trim()
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// DELETE /api/households/:householdId/members/me
const leaveHousehold = async (req, res, next) => {
  const { householdId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const m = await client.query(
      `SELECT id, role FROM household_members
       WHERE household_id = $1 AND user_id = $2
       FOR UPDATE`,
      [householdId, req.user.id]
    );
    if (m.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'You are not a member of this household' });
    }

    // If leaving user is last admin but group has other members, promote.
    if (m.rows[0].role === 'admin') {
      const otherAdmins = await client.query(
        `SELECT 1 FROM household_members
         WHERE household_id = $1 AND user_id <> $2 AND role = 'admin' LIMIT 1`,
        [householdId, req.user.id]
      );
      if (otherAdmins.rows.length === 0) {
        await client.query(
          `UPDATE household_members
             SET role = 'admin'
           WHERE id = (
             SELECT id FROM household_members
              WHERE household_id = $1 AND user_id <> $2
              ORDER BY joined_at ASC LIMIT 1
           )`,
          [householdId, req.user.id]
        );
      }
    }

    // Remove the membership row
    await client.query(
      'DELETE FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, req.user.id]
    );

    // FIX (Schema 5.1 side-effect): if the leaving user is the CREATOR and
    // the household survives, NULL out households.created_by so that the
    // user can create a new household later. Without this, UNIQUE(created_by)
    // would block the user from creating anything ever again.
    const remaining = await client.query(
      'SELECT COUNT(*)::int AS n FROM household_members WHERE household_id = $1',
      [householdId]
    );
    if (remaining.rows[0].n === 0) {
      await client.query('DELETE FROM households WHERE id = $1', [householdId]);
    } else {
      await client.query(
        `UPDATE households SET created_by = NULL
         WHERE id = $1 AND created_by = $2`,
        [householdId, req.user.id]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: 'You have left the household.' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  createHousehold,
  joinHousehold,
  getHousehold,
  getMyHouseholds,
  kickMember,
  regenerateInviteCode,
  inviteMemberByEmail,
  leaveHousehold
};
