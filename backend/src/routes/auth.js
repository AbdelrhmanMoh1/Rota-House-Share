const router = require('express').Router();
const { authenticate, noStore } = require('../middleware/auth');
const { register, login, getMe, updateProfile } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
// FIX (Bug #1, #2): noStore prevents the browser from caching a stale
// "who am I" response. This is critical because /auth/me underpins every
// page's authentication check.
router.get('/me', authenticate, noStore, getMe);
router.put('/me', authenticate, updateProfile);

module.exports = router;
