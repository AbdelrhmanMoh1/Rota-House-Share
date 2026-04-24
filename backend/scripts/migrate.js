require('dotenv').config();
const pool = require('../src/db/pool');

// =============================================================================
// SCHEMA — rewritten to meet the new requirements.
//
// Column ordering convention (spec 5.5):
//   1. PK
//   2. FKs (in logical order)
//   3. other columns (business fields then timestamps)
//
// Enforced at DB level (spec 5 final goal):
//   - One user can create at most one household -> UNIQUE (created_by) on households
//   - One user can belong to at most one household -> UNIQUE (user_id) on household_members
//   - One household -> many users -> the user_id unique constraint still allows this
//     because the constraint is on household_members.user_id, not household_id.
//
// Bills table: paid_by column REMOVED (spec 5.4). Payment is tracked per-person
// via bill_splits.paid.
//
// Core tables (spec 5.6 — all 8 preserved): users, households, household_members,
// tasks, task_assignments, bills, bill_splits, notifications.
//
// Extra tables for the purchase/contribution feature (spec 4):
// purchases, purchase_contributions. These are additive — no existing table
// was removed or merged.
// =============================================================================

const schema = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- ---------------------------------------------------------------------------
  -- users
  -- PK → no FKs → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- households
  -- PK → FK created_by (UNIQUE → one household per creator) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS households (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by  UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name        VARCHAR(100) NOT NULL,
    address     TEXT,
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- household_members
  -- PK → FKs (household_id, user_id) → data columns
  -- UNIQUE (user_id): a user is in at most ONE household.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS household_members (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    joined_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- tasks
  -- PK → FKs (household_id, created_by) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS tasks (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    title          VARCHAR(200) NOT NULL,
    description    TEXT,
    rotation_type  VARCHAR(20) DEFAULT 'round-robin' CHECK (rotation_type IN ('round-robin','manual')),
    frequency_days INT DEFAULT 7,
    current_index  INT DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- task_assignments
  -- PK → FKs (task_id, assigned_to) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS task_assignments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    assigned_to  UUID REFERENCES users(id) ON DELETE CASCADE,
    due_date     DATE NOT NULL,
    completed_at TIMESTAMPTZ,
    status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue')),
    notes        TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- bills
  -- PK → FKs (household_id, created_by) → data columns
  -- paid_by REMOVED (spec 5.4) — payment is tracked per member in bill_splits.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS bills (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    title           VARCHAR(200) NOT NULL,
    total_amount    NUMERIC(10,2) NOT NULL,
    due_date        DATE,
    split_type      VARCHAR(20) DEFAULT 'equal' CHECK (split_type IN ('equal','custom')),
    status          VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
    recurring       BOOLEAN DEFAULT FALSE,
    recurrence_days INT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- bill_splits
  -- PK → FKs (bill_id, user_id) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS bill_splits (
    id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount  NUMERIC(10,2) NOT NULL,
    paid    BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at TIMESTAMPTZ,
    UNIQUE (bill_id, user_id)
  );

  -- ---------------------------------------------------------------------------
  -- notifications
  -- PK → FKs (user_id, household_id) → data columns
  -- Also used to carry "kicked" events: type = 'member_kicked', reason in data JSONB.
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS notifications (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    type         VARCHAR(50) NOT NULL,
    message      TEXT NOT NULL,
    data         JSONB,
    read         BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- NEW: purchases (shared buys with fundraising)
  -- PK → FKs (household_id, created_by) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS purchases (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    household_id   UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    item_name      VARCHAR(200) NOT NULL,
    description    TEXT,
    target_amount  NUMERIC(10,2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    status         VARCHAR(20) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','funded','cancelled')),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- ---------------------------------------------------------------------------
  -- NEW: purchase_contributions (who paid in, how much, when)
  -- PK → FKs (purchase_id, user_id) → data columns
  -- ---------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS purchase_contributions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id    UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    contributed_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- Indexes for hot paths
  CREATE INDEX IF NOT EXISTS idx_tasks_household         ON tasks(household_id);
  CREATE INDEX IF NOT EXISTS idx_members_household       ON household_members(household_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_task        ON task_assignments(task_id);
  CREATE INDEX IF NOT EXISTS idx_splits_bill             ON bill_splits(bill_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_purchases_household     ON purchases(household_id);
  CREATE INDEX IF NOT EXISTS idx_contributions_purchase  ON purchase_contributions(purchase_id);
`;

// =============================================================================
// UPGRADE PATH
// If you already have data, running the CREATE statements above is safe
// (IF NOT EXISTS), but the NEW CONSTRAINTS will not be applied to existing
// tables. The block below runs the necessary ALTERs idempotently.
// =============================================================================

const upgrades = `
  -- 5.4: drop bills.paid_by if it exists
  ALTER TABLE bills DROP COLUMN IF EXISTS paid_by;

  -- 5.1: UNIQUE (created_by) on households, if not yet present
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'households_created_by_key'
    ) THEN
      BEGIN
        ALTER TABLE households ADD CONSTRAINT households_created_by_key UNIQUE (created_by);
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'Cannot add UNIQUE(created_by) on households: you have duplicate creators. Clean up households table first.';
      END;
    END IF;
  END$$;

  -- 5.2: UNIQUE (user_id) on household_members, if not yet present
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'household_members_user_id_key'
    ) THEN
      BEGIN
        ALTER TABLE household_members ADD CONSTRAINT household_members_user_id_key UNIQUE (user_id);
      EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'Cannot add UNIQUE(user_id) on household_members: a user is in multiple households. Deduplicate first.';
      END;
    END IF;
  END$$;

  -- Drop the old composite unique on (household_id, user_id) because the
  -- stricter UNIQUE(user_id) supersedes it. Harmless if it was never there.
  ALTER TABLE household_members DROP CONSTRAINT IF EXISTS household_members_household_id_user_id_key;
`;

(async () => {
  try {
    console.log('Running migrations…');
    await pool.query(schema);
    console.log('  Base schema OK');
    await pool.query(upgrades);
    console.log('  Upgrade statements OK');
    console.log('✅ Migrations complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
