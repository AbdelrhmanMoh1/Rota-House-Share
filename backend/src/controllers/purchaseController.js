const pool = require('../db/pool');
const { broadcast } = require('../websocket/manager');

// =============================================================================
// PURCHASES / CONTRIBUTIONS (Spec 4)
//
// Concept: members crowd-fund a shared purchase. Each purchase has a target
// amount; each contribution adds to a running current_amount. When the
// target is reached the purchase auto-transitions to 'funded'.
//
// Access control:
//   - All routes are behind requireHouseholdMember at the router level, so
//     only household members can see or contribute.
//   - Cancelling is restricted to the creator (or admin) to prevent drama.
// =============================================================================

// GET /api/households/:householdId/purchases
const listPurchases = async (req, res, next) => {
  const { householdId } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.*,
              u.name AS creator_name,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', c.id,
                  'user_id', c.user_id,
                  'name', cu.name,
                  'amount', c.amount,
                  'contributed_at', c.contributed_at
                ) ORDER BY c.contributed_at DESC)
                FROM purchase_contributions c
                JOIN users cu ON cu.id = c.user_id
                WHERE c.purchase_id = p.id
              ), '[]'::json) AS contributions
         FROM purchases p
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.household_id = $1
        ORDER BY p.created_at DESC`,
      [householdId]
    );
    res.json({ purchases: result.rows });
  } catch (err) { next(err); }
};

// POST /api/households/:householdId/purchases
const createPurchase = async (req, res, next) => {
  const { householdId } = req.params;
  const { item_name, description, target_amount } = req.body;

  if (!item_name || typeof item_name !== 'string' || item_name.trim().length === 0) {
    return res.status(400).json({ error: 'Item name is required.' });
  }
  const target = parseFloat(target_amount);
  if (!Number.isFinite(target) || target <= 0) {
    return res.status(400).json({ error: 'Target amount must be a positive number.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO purchases (household_id, created_by, item_name, description, target_amount)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [householdId, req.user.id, item_name.trim(), description || null, target.toFixed(2)]
    );
    broadcast(householdId, { type: 'PURCHASE_CREATED', purchase: result.rows[0] });
    res.status(201).json({ purchase: result.rows[0] });
  } catch (err) { next(err); }
};

// POST /api/households/:householdId/purchases/:purchaseId/contribute
const contributeToPurchase = async (req, res, next) => {
  const { householdId, purchaseId } = req.params;
  const { amount } = req.body;

  const val = parseFloat(amount);
  if (!Number.isFinite(val) || val <= 0) {
    return res.status(400).json({ error: 'Contribution amount must be a positive number.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the purchase row so concurrent contributions can't both
    // push current_amount past target or double-transition status.
    const p = await client.query(
      'SELECT * FROM purchases WHERE id = $1 AND household_id = $2 FOR UPDATE',
      [purchaseId, householdId]
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase not found in this household.' });
    }

    const purchase = p.rows[0];
    if (purchase.status !== 'open') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Purchase is already ${purchase.status}; no more contributions accepted.` });
    }

    // Cap the contribution so we don't overshoot target — the overshoot
    // would just be returned to the user in a real app; here we reject.
    const remaining = parseFloat(purchase.target_amount) - parseFloat(purchase.current_amount);
    if (val > remaining + 0.0001) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Only £${remaining.toFixed(2)} remaining. Contribute that or less.`
      });
    }

    // Record contribution
    const contrib = await client.query(
      `INSERT INTO purchase_contributions (purchase_id, user_id, amount)
       VALUES ($1,$2,$3) RETURNING *`,
      [purchaseId, req.user.id, val.toFixed(2)]
    );

    // Update the running total
    const newTotal = parseFloat(purchase.current_amount) + val;
    const newStatus = newTotal + 0.0001 >= parseFloat(purchase.target_amount) ? 'funded' : 'open';
    const updated = await client.query(
      `UPDATE purchases
          SET current_amount = $1,
              status         = $2,
              updated_at     = NOW()
        WHERE id = $3
        RETURNING *`,
      [newTotal.toFixed(2), newStatus, purchaseId]
    );

    // Notify the household when funded
    if (newStatus === 'funded') {
      const memberIds = await client.query(
        'SELECT user_id FROM household_members WHERE household_id = $1',
        [householdId]
      );
      for (const m of memberIds.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, household_id, type, message, data)
           VALUES ($1,$2,'purchase_funded',$3,$4)`,
          [m.user_id, householdId,
           `Purchase "${purchase.item_name}" is fully funded!`,
           JSON.stringify({ purchase_id: purchaseId })]
        );
      }
    }

    await client.query('COMMIT');
    broadcast(householdId, {
      type: 'PURCHASE_UPDATED',
      purchase: updated.rows[0],
      contribution: contrib.rows[0]
    });
    res.json({ purchase: updated.rows[0], contribution: contrib.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/households/:householdId/purchases/:purchaseId/cancel
// Creator-only (or admin).
const cancelPurchase = async (req, res, next) => {
  const { householdId, purchaseId } = req.params;
  try {
    const p = await pool.query(
      'SELECT created_by, status FROM purchases WHERE id = $1 AND household_id = $2',
      [purchaseId, householdId]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Purchase not found.' });
    if (p.rows[0].status !== 'open') {
      return res.status(409).json({ error: `Cannot cancel a ${p.rows[0].status} purchase.` });
    }
    const isCreator = String(p.rows[0].created_by) === String(req.user.id);
    const isAdmin = req.householdRole === 'admin';
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: 'Only the creator or an admin can cancel this purchase.' });
    }

    const updated = await pool.query(
      `UPDATE purchases SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [purchaseId]
    );
    broadcast(householdId, { type: 'PURCHASE_CANCELLED', purchase: updated.rows[0] });
    res.json({ purchase: updated.rows[0] });
  } catch (err) { next(err); }
};

module.exports = { listPurchases, createPurchase, contributeToPurchase, cancelPurchase };
