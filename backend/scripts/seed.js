require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../src/config/db');

(async () => {
  try {
    console.log('🌱 Seeding database...');

    // Create demo users
    const hash = await bcrypt.hash('password123', 12);
    const users = [
      { id: uuidv4(), name: 'Alice', email: 'alice@demo.com' },
      { id: uuidv4(), name: 'Bob',   email: 'bob@demo.com'   },
      { id: uuidv4(), name: 'Carol', email: 'carol@demo.com' },
    ];

    for (const u of users) {
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [u.id, u.name, u.email, hash]
      );
    }

    // Create a demo household
    const householdId = uuidv4();
    await pool.query(
      'INSERT INTO households (id, name, invite_code, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [householdId, 'Demo House', 'DEMO01', users[0].id]
    );

    // Add all users as members
    for (let i = 0; i < users.length; i++) {
      await pool.query(
        'INSERT INTO household_members (household_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [householdId, users[i].id, i === 0 ? 'admin' : 'member']
      );
    }

    // Create demo tasks
    const rotationOrder = `{${users.map(u => u.id).join(',')}}`;
    await pool.query(
      `INSERT INTO tasks (id, household_id, title, assigned_to, recurrence, rotation_order, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '7 days',$7) ON CONFLICT DO NOTHING`,
      [uuidv4(), householdId, 'Clean kitchen', users[0].id, 'weekly', rotationOrder, users[0].id]
    );
    await pool.query(
      `INSERT INTO tasks (id, household_id, title, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uuidv4(), householdId, 'Take out bins', users[1].id, users[0].id]
    );

    // Create demo bill
    const billId = uuidv4();
    await pool.query(
      'INSERT INTO bills (id, household_id, title, total_amount, paid_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [billId, householdId, 'Monthly rent', 1500.00, users[0].id]
    );
    for (const u of users) {
      await pool.query(
        'INSERT INTO bill_splits (id, bill_id, user_id, amount) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [uuidv4(), billId, u.id, 500.00]
      );
    }

    console.log('✅ Seed complete!');
    console.log('   Demo users: alice@demo.com, bob@demo.com, carol@demo.com');
    console.log('   Password: password123');
    console.log('   Invite code: DEMO01');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    await pool.end();
  }
})();
