const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { payBillSplit, deleteBill } = require('../controllers/billController');

router.use(authenticate);
router.post('/:billId/pay', payBillSplit);
router.delete('/:billId', deleteBill);

module.exports = router;
