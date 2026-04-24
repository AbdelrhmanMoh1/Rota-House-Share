const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// POST /api/households/:householdId/bills
// FIX (Schema 5.4): bills.paid_by is GONE. Who paid is implicit in
// bill_splits — whichever user has `paid = TRUE` covered their share.
// The creator's own share is pre-marked paid (they fronted the bill).
const createBill = async (req, res, next) => {
  const { householdId } = req.params;
  const { title, total_amount, due_date, split_type = 'equal', splits, recurring, recurrence_days } = req.body;
  if (!title || !total_amount) return res.status(400).json({ error: 'Title and total_amount are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bill = await client.query(
      `INSERT INTO bills (household_id, created_by, title, total_amount, due_date, split_type, recurring, recurrence_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [householdId, req.user.id, title, total_amount, due_date || null, split_type, recurring || false, recurrence_days || null]
    );
    const billId = bill.rows[0].id;

    let splitRows;
    if (split_type === 'equal') {
      const members = await client.query(
        'SELECT user_id FROM household_members WHERE household_id = $1', [householdId]
      );
      if (members.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No members to split with.' });
      }
      const perPerson = (parseFloat(total_amount) / members.rows.length).toFixed(2);
      splitRows = members.rows.map(m => ({ user_id: m.user_id, amount: perPerson }));
    } else {
      if (!splits || !splits.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'splits array required for custom split_type' });
      }
      splitRows = splits;
    }

    for (const s of splitRows) {
      // Creator's own share is pre-marked as paid (they paid the bill upfront)
      const paid = String(s.user_id) === String(req.user.id);
      await client.query(
        'INSERT INTO bill_splits (bill_id, user_id, amount, paid, paid_at) VALUES ($1, $2, $3, $4, $5)',
        [billId, s.user_id, s.amount, paid, paid ? new Date() : null]
      );
      if (!paid) {
        await client.query(
          `INSERT INTO notifications (user_id, household_id, type, message, data)
           VALUES ($1,$2,'bill_created',$3,$4)`,
          [s.user_id, householdId, `New bill: ${title} – you owe £${s.amount}`,
            JSON.stringify({ bill_id: billId, amount: s.amount })]
        );
      }
    }

    await client.query('COMMIT');
    broadcast(householdId, { type: 'BILL_CREATED', bill: bill.rows[0] });
    res.status(201).json({ bill: bill.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
};

// GET /api/households/:householdId/bills
const getBills = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const bills = await pool.query(
      `SELECT b.*,
         json_agg(json_build_object(
           'user_id', bs.user_id,
           'name',    u.name,
           'amount',  bs.amount,
           'paid',    bs.paid,
           'paid_at', bs.paid_at
         )) AS splits
       FROM bills b
       LEFT JOIN bill_splits bs ON bs.bill_id = b.id
       LEFT JOIN users u ON u.id = bs.user_id
       WHERE b.household_id = $1
       GROUP BY b.id ORDER BY b.created_at DESC`,
      [householdId]
    );
    res.json({ bills: bills.rows });
  } catch (err) { next(err); }
};

// POST /api/bills/:billId/pay
const payBillSplit = async (req, res, next) => {
  const { billId } = req.params;
  try {
    const result = await pool.query(
      `UPDATE bill_splits SET paid = TRUE, paid_at = NOW()
       WHERE bill_id = $1 AND user_id = $2 AND paid = FALSE RETURNING *`,
      [billId, req.user.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'No unpaid split found for you on this bill' });

    const remaining = await pool.query(
      'SELECT COUNT(*) FROM bill_splits WHERE bill_id = $1 AND paid = FALSE', [billId]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query("UPDATE bills SET status = 'paid' WHERE id = $1", [billId]);
    } else {
      await pool.query("UPDATE bills SET status = 'partial' WHERE id = $1", [billId]);
    }

    const bill = await pool.query('SELECT household_id FROM bills WHERE id = $1', [billId]);
    if (bill.rows.length > 0) {
      broadcast(bill.rows[0].household_id, { type: 'BILL_PAID', billId, paidBy: req.user.id });
    }
    res.json({ split: result.rows[0] });
  } catch (err) { next(err); }
};

const deleteBill = async (req, res, next) => {
  const { billId } = req.params;
  try {
    const bill = await pool.query('SELECT household_id FROM bills WHERE id = $1', [billId]);
    if (bill.rows.length === 0) return res.status(404).json({ error: 'Bill not found' });
    await pool.query('DELETE FROM bills WHERE id = $1', [billId]);
    broadcast(bill.rows[0].household_id, { type: 'BILL_DELETED', billId });
    res.json({ message: 'Bill deleted' });
  } catch (err) { next(err); }
};

const getBillSummary = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const result = await pool.query(
      `SELECT u.id, u.name,
         COALESCE(SUM(bs.amount) FILTER (WHERE bs.paid = FALSE), 0) AS total_owed,
         COALESCE(SUM(bs.amount) FILTER (WHERE bs.paid = TRUE), 0)  AS total_paid
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       LEFT JOIN bill_splits bs ON bs.user_id = hm.user_id
       LEFT JOIN bills b ON b.id = bs.bill_id AND b.household_id = $1
       WHERE hm.household_id = $1
       GROUP BY u.id, u.name`,
      [householdId]
    );
    res.json({ summary: result.rows });
  } catch (err) { next(err); }
};

module.exports = { createBill, getBills, payBillSplit, deleteBill, getBillSummary };
