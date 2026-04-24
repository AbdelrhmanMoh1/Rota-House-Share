const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { handleAvatarUpload } = require('../controllers/uploadController');

router.use(authenticate);

// POST /api/upload/avatar  (multipart/form-data, field name: avatar)
router.post('/avatar', handleAvatarUpload);

module.exports = router;
