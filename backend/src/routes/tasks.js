const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { toggleTaskStatus, assignTask, deleteTask } = require('../controllers/taskController');

router.use(authenticate);

// FIX (Bug #1): The frontend now POSTs to /toggle. /complete is kept as an
// alias so older clients don't break, but both go through the same toggle
// logic which flips in whichever direction is needed.
router.patch ('/:taskId/toggle',   toggleTaskStatus);
router.patch ('/:taskId/complete', toggleTaskStatus);

router.put   ('/:taskId/assign',   assignTask);
router.delete('/:taskId',          deleteTask);

module.exports = router;
