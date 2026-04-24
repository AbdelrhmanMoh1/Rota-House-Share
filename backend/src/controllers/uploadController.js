// =============================================================================
// UPLOAD CONTROLLER (Bug #3 — PayloadTooLargeError)
//
// Root cause recap: the old profile flow encoded the image as a Base64 data
// URL and shoved it in a JSON body. A 400KB JPEG becomes ~540KB Base64, which
// blows past Express's default JSON limit (100KB) and returns
// PayloadTooLargeError. Raising the limit is the WRONG fix — it lets large
// blobs through the JSON parser, bloats the DB, kills cache efficiency, and
// doesn't validate content.
//
// The right fix is multipart/form-data with multer:
//   - Browser sends raw binary bytes in a multipart request.
//   - multer writes the file to disk under uploads/avatars/.
//   - File size cap is enforced at the middleware layer (2 MB).
//   - MIME type is validated server-side (never trust the client).
//   - Only the PATH (e.g. /uploads/avatars/<uuid>.jpg) ends up in the
//     users.avatar_url column — tiny string, fast cache, DB stays lean.
// =============================================================================

const path = require('path');
const fs   = require('fs');
const multer = require('multer');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');

const UPLOAD_ROOT   = path.join(__dirname, '../../uploads');
const AVATAR_DIR    = path.join(UPLOAD_ROOT, 'avatars');
const MAX_BYTES     = 2 * 1024 * 1024;  // 2 MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT   = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename:    (req, file, cb) => {
    const ext = ALLOWED_EXT[file.mimetype] || '.bin';
    cb(null, `${req.user.id}-${randomUUID()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, or WebP images are allowed.'), false);
  }
  cb(null, true);
};

const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 1 }
}).single('avatar');

// POST /api/upload/avatar
// Saves file, updates users.avatar_url, returns { avatar_url } pointing at
// the public /uploads/... URL the frontend can use directly in <img src>.
const handleAvatarUpload = (req, res, next) => {
  uploadAvatar(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Max size is 2 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Send a multipart form with field "avatar".' });
    }

    const publicUrl = `/uploads/avatars/${req.file.filename}`;
    try {
      // Look up the old URL so we can delete the file afterwards
      const prev = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
      const oldUrl = prev.rows[0]?.avatar_url;

      await pool.query(
        'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [publicUrl, req.user.id]
      );

      // Best-effort cleanup of the previous uploaded file (ignore errors)
      if (oldUrl && oldUrl.startsWith('/uploads/avatars/')) {
        const oldPath = path.join(UPLOAD_ROOT, oldUrl.replace(/^\/uploads\//, ''));
        fs.unlink(oldPath, () => {});
      }

      res.json({ avatar_url: publicUrl });
    } catch (dbErr) {
      // If the DB write fails, delete the orphan we just saved
      fs.unlink(req.file.path, () => {});
      next(dbErr);
    }
  });
};

module.exports = { handleAvatarUpload };
