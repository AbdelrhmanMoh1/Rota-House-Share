const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

// POST /api/auth/register
const register = async (req, res, next) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, avatar_url, created_at',
      [name, email.toLowerCase(), hashed]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: generateToken(user.id) });
  } catch (err) { next(err); }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const { password_hash: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token: generateToken(user.id) });
  } catch (err) { next(err); }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  res.json({ user: req.user });
};

// PUT /api/auth/me
// FIX (Bug #3 consequence): avatar_url is now expected to be a short string —
// either a remote URL, a /uploads/... path (from the new multer endpoint),
// or a short emoji. We hard-reject long values so a client that still tries
// to send a Base64 data URL gets a clean error instead of bloating the DB.
const updateProfile = async (req, res, next) => {
  const { name, email, avatar_url } = req.body;

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  if (email !== undefined) {
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
  }
  if (avatar_url !== undefined && avatar_url !== null) {
    if (typeof avatar_url !== 'string') {
      return res.status(400).json({ error: 'avatar_url must be a string' });
    }
    if (avatar_url.startsWith('data:')) {
      return res.status(400).json({
        error: 'Base64 avatars are not accepted. Upload the file via POST /api/upload/avatar instead.'
      });
    }
    if (avatar_url.length > 500) {
      return res.status(400).json({ error: 'avatar_url is too long' });
    }
  }

  try {
    if (email) {
      const clash = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [email.toLowerCase(), req.user.id]
      );
      if (clash.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use by another account' });
      }
    }

    const result = await pool.query(
      `UPDATE users SET
         name       = COALESCE($1, name),
         email      = COALESCE($2, email),
         avatar_url = COALESCE($3, avatar_url),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, avatar_url, created_at`,
      [
        name ? name.trim() : null,
        email ? email.toLowerCase() : null,
        avatar_url !== undefined ? avatar_url : null,
        req.user.id
      ]
    );
    res.json({ user: result.rows[0] });
  } catch (err) { next(err); }
};

module.exports = { register, login, getMe, updateProfile };
