const router = require('express').Router();
const { authenticate, requireHouseholdMember, requireHouseholdAdmin, noStore } = require('../middleware/auth');
const {
  createHousehold,
  joinHousehold,
  getHousehold,
  getMyHouseholds,
  kickMember,
  regenerateInviteCode,
  inviteMemberByEmail,
  leaveHousehold
} = require('../controllers/householdController');
const { createTask, getTasks } = require('../controllers/taskController');
const { createBill, getBills, getBillSummary } = require('../controllers/billController');
const {
  createPurchase, listPurchases, contributeToPurchase, cancelPurchase
} = require('../controllers/purchaseController');

router.use(authenticate);

// Leaderboard must come BEFORE /:householdId to avoid param collision
router.get('/leaderboard', async (req, res, next) => {
  try {
    const pool = require('../db/pool');
    const { filter = 'weekly' } = req.query;
    const intervals = { weekly: '7 days', monthly: '30 days', alltime: '3650 days' };
    const interval = intervals[filter] || '7 days';
    const result = await pool.query(
      `SELECT h.id, h.name,
         COUNT(ta.id) FILTER (
           WHERE ta.status = 'completed'
           AND ta.completed_at > NOW() - $1::interval
         ) AS completed_chores
       FROM households h
       LEFT JOIN tasks t ON t.household_id = h.id
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       GROUP BY h.id, h.name
       ORDER BY completed_chores DESC
       LIMIT 10`,
      [interval]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/mine',  noStore, getMyHouseholds);
router.post('/',     createHousehold);
router.post('/join', joinHousehold);

// Leave your own household (member self-service)
router.delete('/:householdId/members/me',
  requireHouseholdMember, leaveHousehold);

// FIX (Bug #2): Kick a specific member — admin only.
// requireHouseholdAdmin enforces the admin-only rule at the middleware layer
// so the controller stays focused on domain logic (self-kick guard, reason
// validation, notification write).
router.delete('/:householdId/members/:userId',
  requireHouseholdAdmin, kickMember);

router.get   ('/:householdId',                 requireHouseholdMember, getHousehold);
router.post  ('/:householdId/regenerate-code', requireHouseholdAdmin,  regenerateInviteCode);
router.post  ('/:householdId/invite-email',    requireHouseholdMember, inviteMemberByEmail);

router.get   ('/:householdId/tasks',           requireHouseholdMember, getTasks);
router.post  ('/:householdId/tasks',           requireHouseholdMember, createTask);

router.get   ('/:householdId/bills',           requireHouseholdMember, getBills);
router.post  ('/:householdId/bills',           requireHouseholdMember, createBill);
router.get   ('/:householdId/bills/summary',   requireHouseholdMember, getBillSummary);

// Purchases (spec 4)
router.get ('/:householdId/purchases',                        requireHouseholdMember, listPurchases);
router.post('/:householdId/purchases',                        requireHouseholdMember, createPurchase);
router.post('/:householdId/purchases/:purchaseId/contribute', requireHouseholdMember, contributeToPurchase);
router.post('/:householdId/purchases/:purchaseId/cancel',     requireHouseholdMember, cancelPurchase);

module.exports = router;
