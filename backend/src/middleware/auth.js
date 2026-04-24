const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // FIX (Bug #7): Include created_at so the frontend can render a real
    // "Member since X ago" string instead of "recently". req.user is what
    // GET /auth/me returns, so adding the column here propagates everywhere.
    const result = await pool.query(
      'SELECT id, name, email, avatar_url, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireHouseholdMember = async (req, res, next) => {
  let householdId = req.params.householdId || req.body.household_id;

  // If the frontend explicitly asks for "mine"
  if (householdId === 'mine') {
    try {
      const householdResult = await pool.query(
        'SELECT household_id FROM household_members WHERE user_id = $1 LIMIT 1',
        [req.user.id]
      );

      if (householdResult.rows.length === 0) {
        return res.status(403).json({ error: 'User is not a member of any household' });
      }

      householdId = householdResult.rows[0].household_id;
      req.params.householdId = householdId;
    } catch (err) {
      return next(err);
    }
  }

  if (!householdId) return res.status(400).json({ error: 'Household ID required' });

  try {
    const result = await pool.query(
      'SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this household' });
    }

    req.householdRole = result.rows[0].role;
    next();
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid Household ID format' });
    next(err);
  }
};

const requireHouseholdAdmin = async (req, res, next) => {
  let householdId = req.params.householdId || req.body.household_id;

  if (householdId === 'mine') {
    try {
      const householdResult = await pool.query(
        'SELECT household_id FROM household_members WHERE user_id = $1 LIMIT 1',
        [req.user.id]
      );
      if (householdResult.rows.length === 0) {
        return res.status(403).json({ error: 'No household found' });
      }
      householdId = householdResult.rows[0].household_id;
      req.params.householdId = householdId;
    } catch (err) {
      return next(err);
    }
  }

  try {
    const result = await pool.query(
      'SELECT role FROM household_members WHERE household_id = $1 AND user_id = $2',
      [householdId, req.user.id]
    );

    if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.householdRole = 'admin';
    next();
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ error: 'Invalid Household ID format' });
    next(err);
  }
};

// FIX (Bug #1, #2): Tiny middleware to prevent browser/proxy caching of
// membership-sensitive endpoints. After a user leaves a household, a cached
// 200 response on /households/mine would still list the old household and
// re-authorize them. Applying this to /auth/me and /households/mine makes
// every membership check a fresh server hit.
const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

module.exports = { authenticate, requireHouseholdMember, requireHouseholdAdmin, noStore };
