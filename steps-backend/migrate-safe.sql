-- ============================================================
-- SAFE MIGRATION - Preserves all existing data
-- Run with: psql -U postgres -d steps_pms -f migrate-safe.sql
-- ============================================================

-- Create housekeeping_status table if not exists
CREATE TABLE IF NOT EXISTS housekeeping_status (
  id              SERIAL PRIMARY KEY,
  apartment_id    INT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'clean',
  last_updated    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(100),
  notes           TEXT,
  UNIQUE(apartment_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_housekeeping_status_apartment ON housekeeping_status(apartment_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status_status ON housekeeping_status(status);

-- Add missing columns to existing tables
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS cleaning_status VARCHAR(20) DEFAULT 'clean';
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS min_stock_level INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);

-- Create any missing tables (safe - only creates if not exists)
CREATE TABLE IF NOT EXISTS store_items (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  category        VARCHAR(50)  NOT NULL,
  cost            INT          NOT NULL,
  quantity        VARCHAR(50)  NOT NULL,
  stock_value     DECIMAL(10,2) DEFAULT 0,
  unit            VARCHAR(20)  DEFAULT 'units',
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_requests (
  id                 SERIAL PRIMARY KEY,
  item_name          VARCHAR(200) NOT NULL,
  category           VARCHAR(50)  NOT NULL,
  quantity           VARCHAR(50)  NOT NULL,
  cost               INT          NOT NULL DEFAULT 0,
  requested_by       VARCHAR(50)  NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending',
  authorized_quantity VARCHAR(50),
  created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  approved_at        TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outlet_inventory (
  id                 SERIAL PRIMARY KEY,
  outlet             VARCHAR(50)  NOT NULL,
  item_name          VARCHAR(200) NOT NULL,
  category           VARCHAR(50)  NOT NULL,
  quantity           VARCHAR(50)  NOT NULL,
  cost               INT          NOT NULL,
  source_request_id  INT REFERENCES store_requests(id) ON DELETE SET NULL,
  created_at         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outlets (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for store tables
CREATE INDEX IF NOT EXISTS idx_outlet_inventory_outlet ON outlet_inventory(outlet);
CREATE INDEX IF NOT EXISTS idx_store_requests_status ON store_requests(status);
CREATE INDEX IF NOT EXISTS idx_store_items_category ON store_items(category);

-- Insert default outlets only if table is empty
INSERT INTO outlets (name)
SELECT 'housekeeping' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'housekeeping');
INSERT INTO outlets (name)
SELECT 'kitchen' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'kitchen');
INSERT INTO outlets (name)
SELECT 'public' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'public');

-- Function and trigger for users table (safe)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Verification message
SELECT '✅ Safe migration completed! No data was lost.' as status;


-- ============================================================
-- PURCHASE ORDERS TABLES (Added to existing safe migration)
-- ============================================================

-- Create vendors table (if not exists)
CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  type        VARCHAR(50) NOT NULL DEFAULT 'local',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create purchase_orders table (if not exists)
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              SERIAL PRIMARY KEY,
  po_number       VARCHAR(50) NOT NULL UNIQUE,
  vendor_id       INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_amount    INT NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      VARCHAR(100),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create purchase_order_items table (if not exists)
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              SERIAL PRIMARY KEY,
  po_id           INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name       VARCHAR(200) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  unit            VARCHAR(20) DEFAULT 'units',
  unit_price      INT NOT NULL,
  quantity        DECIMAL(10,2) NOT NULL,
  total_price     INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);

-- Insert default vendors (only if they don't exist)
INSERT INTO vendors (name, type)
SELECT 'Local Vendor', 'local'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = 'Local Vendor');

INSERT INTO vendors (name, type)
SELECT 'International Supplier', 'other'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = 'International Supplier');

-- Add updated_at trigger for purchase_orders
CREATE OR REPLACE FUNCTION update_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trigger_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_orders_updated_at();

-- Verification message
SELECT '✅ Purchase Orders tables added to safe migration!' as status;



-- ============================================================
-- SAFE MIGRATION - Add Goods Receipt Note (GRN) Tables
-- This will NOT delete any existing data
-- ============================================================

-- GRN Master table
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
  id              SERIAL PRIMARY KEY,
  grn_number      VARCHAR(50) NOT NULL UNIQUE,
  po_id           INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  vendor_id       INT NOT NULL REFERENCES vendors(id),
  receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'received',
  notes           TEXT,
  created_by      VARCHAR(100),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GRN Items table
CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id              SERIAL PRIMARY KEY,
  grn_id          INT NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
  po_item_id      INT REFERENCES purchase_order_items(id),
  item_name       VARCHAR(200) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  unit            VARCHAR(20) DEFAULT 'units',
  quantity_received DECIMAL(10,2) NOT NULL,
  unit_price      INT NOT NULL,
  total_cost      INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_date ON goods_receipt_notes(receipt_date);
CREATE INDEX IF NOT EXISTS idx_grn_vendor ON goods_receipt_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON goods_receipt_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_po_item ON goods_receipt_items(po_item_id);

-- Add columns to purchase_orders table (if not exists)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS grn_id INT REFERENCES goods_receipt_notes(id);

-- Create trigger for updated_at on goods_receipt_notes
CREATE OR REPLACE FUNCTION update_grn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_grn_updated_at ON goods_receipt_notes;
CREATE TRIGGER trigger_grn_updated_at
  BEFORE UPDATE ON goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_grn_updated_at();

-- Add updated_at column if not exists
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Verification message
SELECT '✅ Goods Receipt Note (GRN) tables created successfully! No data was lost.' as status;

-- Show counts
SELECT 
  (SELECT COUNT(*) FROM goods_receipt_notes) as grn_count,
  (SELECT COUNT(*) FROM goods_receipt_items) as grn_items_count;



-- ============================================================
-- FIX: Add unit column to outlet_inventory table
-- ============================================================

-- Add unit column if it doesn't exist
ALTER TABLE outlet_inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT 'units';

-- Update existing rows to have a default unit
UPDATE outlet_inventory SET unit = 'units' WHERE unit IS NULL;

-- Create index on unit column for better performance
CREATE INDEX IF NOT EXISTS idx_outlet_inventory_unit ON outlet_inventory(unit);

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'outlet_inventory' 
AND column_name = 'unit';

-- Show completion message
SELECT '✅ unit column added to outlet_inventory table successfully!' as status;



-- ============================================================
-- FIX: Recalculate outlet inventory costs based on Main Store
-- ============================================================

-- This will update the cost per unit in outlet_inventory
-- to match the current Main Store cost per unit

-- First, create a temporary function to get Main Store cost
DO $$
DECLARE
    outlet_rec RECORD;
    main_item RECORD;
    new_cost INT;
BEGIN
    FOR outlet_rec IN 
        SELECT DISTINCT item_name, outlet, unit, SUM(CAST(SPLIT_PART(quantity, ' ', 1) AS DECIMAL)) as total_qty
        FROM outlet_inventory 
        GROUP BY item_name, outlet, unit
    LOOP
        -- Get main store item cost
        SELECT cost INTO main_item FROM store_items WHERE LOWER(TRIM(name)) = LOWER(TRIM(outlet_rec.item_name)) LIMIT 1;
        
        IF main_item IS NOT NULL THEN
            new_cost := main_item * outlet_rec.total_qty;
            
            -- Update all entries for this item in this outlet
            UPDATE outlet_inventory 
            SET cost = new_cost
            WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(outlet_rec.item_name)) 
              AND outlet = outlet_rec.outlet;
            
            RAISE NOTICE 'Updated % in %: new total cost = %', outlet_rec.item_name, outlet_rec.outlet, new_cost;
        END IF;
    END LOOP;
END $$;

-- Verify the update
SELECT 
    item_name,
    outlet,
    SUM(CAST(SPLIT_PART(quantity, ' ', 1) AS DECIMAL)) as total_quantity,
    SUM(cost) as total_cost,
    ROUND(SUM(cost) / NULLIF(SUM(CAST(SPLIT_PART(quantity, ' ', 1) AS DECIMAL)), 0)) as cost_per_unit
FROM outlet_inventory 
GROUP BY item_name, outlet
ORDER BY item_name;

SELECT '✅ Outlet inventory costs recalculated based on Main Store prices!' as status;



-- ============================================================
-- SALES TABLES FOR POS (Add this to migrate-safe.sql)
-- ============================================================

-- Sales Orders table (master table for each transaction)
CREATE TABLE IF NOT EXISTS sales_orders (
  id              SERIAL PRIMARY KEY,
  order_number    VARCHAR(50) NOT NULL UNIQUE,
  cashier_id      INT REFERENCES users(id) ON DELETE SET NULL,
  cashier_name    VARCHAR(100) NOT NULL,
  order_date      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_amount    INT NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sales Items table (items sold in each order)
CREATE TABLE IF NOT EXISTS sales_items (
  id              SERIAL PRIMARY KEY,
  sale_id         INT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id         INT REFERENCES store_items(id) ON DELETE SET NULL,
  item_name       VARCHAR(200) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  unit            VARCHAR(20) DEFAULT 'units',
  quantity        DECIMAL(10,2) NOT NULL,
  unit_price      INT NOT NULL,
  total_price     INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_cashier ON sales_orders(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON sales_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_item ON sales_items(item_id);

-- Auto-generate order number function
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number = 'ORD-' || TO_CHAR(NEW.order_date, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_order_number ON sales_orders;
CREATE TRIGGER trigger_order_number
  BEFORE INSERT ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_order_number();


-- ============================================================
-- SAFE MIGRATION - Add Time Tracking to Reservations
-- ============================================================
-- ============================================================
-- ADD CHECKOUT TIME TRACKING TO RESERVATIONS
-- ============================================================



-- ============================================================
-- ADD CHECKOUT TIME TO RESERVATIONS (11:00 AM default)
-- ============================================================

-- Add checkout_time column with default 11:00 AM (if not exists)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checkout_time TIME DEFAULT '11:00:00';

-- Create index for faster queries on checkout_time
CREATE INDEX IF NOT EXISTS idx_reservations_checkout_time ON reservations(checkout_time);

-- Update any existing NULL checkout_time values to default '11:00:00'
UPDATE reservations SET checkout_time = '11:00:00' WHERE checkout_time IS NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Checkout time migration completed!';
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='checkout_time') THEN
        RAISE NOTICE '✅ checkout_time column: ADDED (default 11:00:00)';
    ELSE
        RAISE NOTICE '❌ checkout_time column: MISSING';
    END IF;
END $$;




-- ============================================================
-- ACTIVITY LOG TABLE (Audit Trail - SAFE MIGRATION)
-- ============================================================

-- Create activity_logs table if not exists
CREATE TABLE IF NOT EXISTS activity_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(100) NOT NULL,
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   INT,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(created_at);

-- ============================================================
-- VERIFICATION
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✅ Activity logs table migration completed!';
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs') THEN
        RAISE NOTICE '✅ activity_logs table: CREATED';
    ELSE
        RAISE NOTICE '❌ activity_logs table: MISSING';
    END IF;
END $$;



-- Create countries table if not exists (clean version)
CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Delete any existing data to start fresh (only if needed)
TRUNCATE countries;

-- Insert clean countries (no special characters)
INSERT INTO countries (name) VALUES 
('Afghanistan'), ('Albania'), ('Algeria'), ('Andorra'), ('Angola'),
('Argentina'), ('Armenia'), ('Australia'), ('Austria'), ('Bahamas'),
('Bahrain'), ('Bangladesh'), ('Barbados'), ('Belarus'), ('Belgium'),
('Belize'), ('Benin'), ('Bhutan'), ('Bolivia'), ('Botswana'), ('Brazil'),
('Brunei'), ('Bulgaria'), ('Burkina Faso'), ('Burundi'), ('Cabo Verde'),
('Cambodia'), ('Cameroon'), ('Canada'), ('Chad'), ('Chile'), ('China'),
('Colombia'), ('Comoros'), ('Congo'), ('Costa Rica'), ('Croatia'), ('Cuba'),
('Cyprus'), ('Czech Republic'), ('Denmark'), ('Djibouti'), ('Dominica'),
('Dominican Republic'), ('Ecuador'), ('Egypt'), ('El Salvador'), ('Eritrea'),
('Estonia'), ('Eswatini'), ('Ethiopia'), ('Fiji'), ('Finland'), ('France'),
('Gabon'), ('Gambia'), ('Georgia'), ('Germany'), ('Ghana'), ('Greece'),
('Grenada'), ('Guatemala'), ('Guinea'), ('Guinea-Bissau'), ('Guyana'),
('Haiti'), ('Honduras'), ('Hungary'), ('Iceland'), ('India'), ('Indonesia'),
('Iran'), ('Iraq'), ('Ireland'), ('Israel'), ('Italy'), ('Jamaica'), ('Japan'),
('Jordan'), ('Kazakhstan'), ('Kenya'), ('Kiribati'), ('Kuwait'), ('Kyrgyzstan'),
('Laos'), ('Latvia'), ('Lebanon'), ('Lesotho'), ('Liberia'), ('Libya'),
('Liechtenstein'), ('Lithuania'), ('Luxembourg'), ('Madagascar'), ('Malawi'),
('Malaysia'), ('Maldives'), ('Mali'), ('Malta'), ('Marshall Islands'),
('Mauritania'), ('Mauritius'), ('Mexico'), ('Micronesia'), ('Moldova'),
('Monaco'), ('Mongolia'), ('Montenegro'), ('Morocco'), ('Mozambique'),
('Myanmar'), ('Namibia'), ('Nauru'), ('Nepal'), ('Netherlands'), ('New Zealand'),
('Nicaragua'), ('Niger'), ('Nigeria'), ('North Korea'), ('North Macedonia'),
('Norway'), ('Oman'), ('Pakistan'), ('Palau'), ('Panama'), ('Papua New Guinea'),
('Paraguay'), ('Peru'), ('Philippines'), ('Poland'), ('Portugal'), ('Qatar'),
('Romania'), ('Russia'), ('Rwanda'), ('Saint Kitts and Nevis'), ('Saint Lucia'),
('Saint Vincent and the Grenadines'), ('Samoa'), ('San Marino'), ('Sao Tome and Principe'),
('Saudi Arabia'), ('Senegal'), ('Serbia'), ('Seychelles'), ('Sierra Leone'),
('Singapore'), ('Slovakia'), ('Slovenia'), ('Solomon Islands'), ('Somalia'),
('South Africa'), ('South Sudan'), ('Spain'), ('Sri Lanka'), ('Sudan'), ('Suriname'),
('Sweden'), ('Switzerland'), ('Syria'), ('Taiwan'), ('Tajikistan'), ('Tanzania'),
('Thailand'), ('Timor-Leste'), ('Togo'), ('Tonga'), ('Trinidad and Tobago'),
('Tunisia'), ('Turkey'), ('Turkmenistan'), ('Tuvalu'), ('Uganda'), ('Ukraine'),
('United Arab Emirates'), ('United Kingdom'), ('United States'), ('Uruguay'),
('Uzbekistan'), ('Vanuatu'), ('Vatican City'), ('Venezuela'), ('Vietnam'),
('Yemen'), ('Zambia'), ('Zimbabwe');



-- ============================================================
-- ADD IDENTIFICATION COLUMNS TO RESERVATIONS
-- ============================================================

-- Add identification columns if they don't exist
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS identification_type VARCHAR(50);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS identification_number VARCHAR(100);

-- Create index for faster searches
CREATE INDEX IF NOT EXISTS idx_reservations_identification ON reservations(identification_number);

-- Verification
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='identification_type') THEN
        RAISE NOTICE '✅ identification_type column added successfully';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='identification_number') THEN
        RAISE NOTICE '✅ identification_number column added successfully';
    END IF;
END $$;


-- ============================================================
-- MAINTENANCE TASKS TABLE
-- ============================================================

-- Create maintenance_tasks table if not exists
CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id                SERIAL PRIMARY KEY,
  task_number       VARCHAR(50) NOT NULL UNIQUE,
  technician_name   VARCHAR(100) NOT NULL,
  item_type         VARCHAR(50) NOT NULL,
  description       TEXT NOT NULL,
  labour_cost       INT DEFAULT 0,
  tools             JSONB DEFAULT '[]'::jsonb,
  total_tools_cost  INT DEFAULT 0,
  total_cost        INT DEFAULT 0,
  task_date         DATE NOT NULL,
  remarks           TEXT,
  status            VARCHAR(20) DEFAULT 'pending',
  created_by        VARCHAR(100),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_date ON maintenance_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_status ON maintenance_tasks(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_item_type ON maintenance_tasks(item_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_technician ON maintenance_tasks(technician_name);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_maintenance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_maintenance_updated_at ON maintenance_tasks;
CREATE TRIGGER trigger_maintenance_updated_at
  BEFORE UPDATE ON maintenance_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_maintenance_updated_at();

-- Verification
DO $$
BEGIN
    RAISE NOTICE '✅ Maintenance tasks table migration completed!';
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'maintenance_tasks') THEN
        RAISE NOTICE '✅ maintenance_tasks table: CREATED';
    ELSE
        RAISE NOTICE '❌ maintenance_tasks table: MISSING';
    END IF;
END $$;


-- ============================================================
-- DAILY ACTIVITIES TABLE
-- ============================================================

-- Create daily_activities table if not exists
CREATE TABLE IF NOT EXISTS daily_activities (
  id SERIAL PRIMARY KEY,
  activity_date DATE NOT NULL,
  description TEXT NOT NULL,
  prepared_by VARCHAR(100) NOT NULL,
  remarks TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_daily_activities_date ON daily_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_daily_activities_prepared_by ON daily_activities(prepared_by);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_daily_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_daily_activities_updated_at ON daily_activities;
CREATE TRIGGER trigger_daily_activities_updated_at
  BEFORE UPDATE ON daily_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_activities_updated_at();

-- Verification
DO $$
BEGIN
    RAISE NOTICE '✅ Daily activities table migration completed!';
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_activities') THEN
        RAISE NOTICE '✅ daily_activities table: CREATED';
    ELSE
        RAISE NOTICE '❌ daily_activities table: MISSING';
    END IF;
END $$;





-- ============================================================
-- ADD TASKS COLUMNS TO DAILY ACTIVITIES
-- ============================================================

ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks_description TEXT;

DO $$
BEGIN
    RAISE NOTICE '✅ Tasks columns added to daily_activities table';
END $$;



-- ============================================================
-- EXPENDITURES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS expenditures (
  id SERIAL PRIMARY KEY,
  expenditure_number VARCHAR(50) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  amount INT NOT NULL,
  expenditure_date DATE NOT NULL,
  paid_to VARCHAR(100),
  payment_method VARCHAR(50) DEFAULT 'cash',
  receipt_number VARCHAR(100),
  remarks TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenditures_date ON expenditures(expenditure_date);
CREATE INDEX IF NOT EXISTS idx_expenditures_category ON expenditures(category);

CREATE OR REPLACE FUNCTION update_expenditures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_expenditures_updated_at ON expenditures;
CREATE TRIGGER trigger_expenditures_updated_at
  BEFORE UPDATE ON expenditures
  FOR EACH ROW
  EXECUTE FUNCTION update_expenditures_updated_at();

DO $$
BEGIN
    RAISE NOTICE '✅ Expenditures table created successfully!';
END $$;



-- Add missing columns to daily_activities table (safe - no data loss)
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks_description TEXT;
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS prepared_by VARCHAR(100);
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS remarks TEXT;



-- ============================================================
-- FIX DAILY ACTIVITIES TABLE
-- ============================================================

ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS tasks_description TEXT;
ALTER TABLE daily_activities ADD COLUMN IF NOT EXISTS prepared_by VARCHAR(100);
ALTER TABLE daily_activities DROP COLUMN IF EXISTS description;



-- ============================================================
-- STAFF ACTIVITIES TABLE (Safe Migration - No Data Loss)
-- ============================================================

-- Create the new clean table
CREATE TABLE IF NOT EXISTS staff_activities (
  id SERIAL PRIMARY KEY,
  activity_date DATE NOT NULL,
  tasks JSONB DEFAULT '[]'::jsonb,
  tasks_description TEXT,
  prepared_by VARCHAR(100) NOT NULL,
  remarks TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_staff_activities_date ON staff_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_staff_activities_prepared_by ON staff_activities(prepared_by);

-- Copy data from old daily_activities if it exists and has data
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_activities') THEN
        INSERT INTO staff_activities (activity_date, prepared_by, remarks, created_at)
        SELECT activity_date, prepared_by, remarks, created_at
        FROM daily_activities 
        WHERE activity_date IS NOT NULL
        ON CONFLICT DO NOTHING;
        RAISE NOTICE '✅ Copied data from daily_activities to staff_activities';
    END IF;
END $$;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_staff_activities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_staff_activities_updated_at ON staff_activities;
CREATE TRIGGER trigger_staff_activities_updated_at
  BEFORE UPDATE ON staff_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_staff_activities_updated_at();

-- Verification
DO $$
BEGIN
    RAISE NOTICE '✅ Staff activities table migration completed!';
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'staff_activities') THEN
        RAISE NOTICE '✅ staff_activities table: CREATED';
    END IF;
END $$;


-- ============================================================
-- SAFE MIGRATION: UPDATE MAINTENANCE TASKS TABLE
-- ============================================================

-- Add item_name column if missing
ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS item_name VARCHAR(200);

-- Rename item_type to repair_type if column exists and rename hasn't been done
DO $$
BEGIN
    -- Check if old column exists and new column doesn't exist
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='maintenance_tasks' AND column_name='item_type') 
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='maintenance_tasks' AND column_name='repair_type') THEN
        ALTER TABLE maintenance_tasks RENAME COLUMN item_type TO repair_type;
        RAISE NOTICE '✅ Renamed item_type column to repair_type';
    END IF;
END $$;

-- Add repair_type if it doesn't exist (for new installations or if above didn't run)
ALTER TABLE maintenance_tasks ADD COLUMN IF NOT EXISTS repair_type VARCHAR(50);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_repair_type ON maintenance_tasks(repair_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_item_name ON maintenance_tasks(item_name);

-- Update any NULL repair_type values from existing data (copy from item_type if available)
UPDATE maintenance_tasks SET repair_type = 'Other' WHERE repair_type IS NULL;

-- Verification
DO $$
DECLARE
    has_repair_type BOOLEAN;
    has_item_name BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='maintenance_tasks' AND column_name='repair_type') INTO has_repair_type;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='maintenance_tasks' AND column_name='item_name') INTO has_item_name;
    
    IF has_repair_type THEN
        RAISE NOTICE '✅ repair_type column: EXISTS';
    ELSE
        RAISE NOTICE '❌ repair_type column: MISSING';
    END IF;
    
    IF has_item_name THEN
        RAISE NOTICE '✅ item_name column: EXISTS';
    ELSE
        RAISE NOTICE '❌ item_name column: MISSING';
    END IF;
END $$;






-- ============================================================
-- SAFE MIGRATION: ADD CONTACT NUMBER TO MAINTENANCE TASKS
-- ============================================================

-- Add contact_number column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='maintenance_tasks' AND column_name='contact_number') THEN
        ALTER TABLE maintenance_tasks ADD COLUMN contact_number VARCHAR(50);
        RAISE NOTICE '✅ contact_number column added to maintenance_tasks';
    ELSE
        RAISE NOTICE 'ℹ️ contact_number column already exists';
    END IF;
END $$;

-- Create index for contact_number
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_contact_number ON maintenance_tasks(contact_number);

-- Verification
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='maintenance_tasks' AND column_name='contact_number') THEN
        RAISE NOTICE '✅ contact_number column is ready for use';
    END IF;
END $$;



-- ============================================================
-- CREATE MAINTENANCE RECORDS TABLE (Safe - No conflicts)
-- ============================================================

-- Drop old table if you want to replace it (optional - comment out if you want to keep old data)
-- DROP TABLE IF EXISTS maintenance_tasks CASCADE;

-- Create new maintenance_records table
CREATE TABLE IF NOT EXISTS maintenance_records (
  id SERIAL PRIMARY KEY,
  task_number VARCHAR(50) NOT NULL UNIQUE,
  technician_name VARCHAR(100) NOT NULL,
  contact_number VARCHAR(50),
  repair_type VARCHAR(50) NOT NULL,
  item_name VARCHAR(200),
  description TEXT NOT NULL,
  labour_cost INT DEFAULT 0,
  tools JSONB DEFAULT '[]'::jsonb,
  total_tools_cost INT DEFAULT 0,
  total_cost INT DEFAULT 0,
  task_date DATE NOT NULL,
  remarks TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_maintenance_records_date ON maintenance_records(task_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_status ON maintenance_records(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_repair_type ON maintenance_records(repair_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_technician ON maintenance_records(technician_name);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_contact_number ON maintenance_records(contact_number);

-- Create trigger
CREATE OR REPLACE FUNCTION update_maintenance_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_maintenance_records_updated_at ON maintenance_records;
CREATE TRIGGER trigger_maintenance_records_updated_at
  BEFORE UPDATE ON maintenance_records
  FOR EACH ROW
  EXECUTE FUNCTION update_maintenance_records_updated_at();

-- Copy data from old table if it exists and has data
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'maintenance_tasks') THEN
        INSERT INTO maintenance_records (
            task_number, technician_name, repair_type, item_name, description,
            labour_cost, tools, total_tools_cost, total_cost, task_date, remarks, status, created_by, created_at, updated_at
        )
        SELECT 
            task_number, technician_name, 
            COALESCE(repair_type, item_type, 'Other') as repair_type,
            item_name, description,
            labour_cost, tools, total_tools_cost, total_cost, task_date, remarks, status, created_by, created_at, updated_at
        FROM maintenance_tasks
        WHERE task_number IS NOT NULL
        ON CONFLICT (task_number) DO NOTHING;
        RAISE NOTICE '✅ Copied data from maintenance_tasks to maintenance_records';
    END IF;
END $$;

-- Verification
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'maintenance_records') THEN
        RAISE NOTICE '✅ maintenance_records table created successfully';
    END IF;
END $$;



-- ============================================================
-- ADD PAYMENT COLUMNS TO RESERVATIONS TABLE
-- ============================================================

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS amount_paid INT DEFAULT 0;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS balance INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reservations_payment_status ON reservations(payment_status);
CREATE INDEX IF NOT EXISTS idx_reservations_payment_method ON reservations(payment_method);

-- Initialize existing records
UPDATE reservations SET balance = total WHERE balance IS NULL;
UPDATE reservations SET payment_status = 'unpaid' WHERE payment_status IS NULL;
UPDATE reservations SET amount_paid = 0 WHERE amount_paid IS NULL;

SELECT '✅ Payment columns added to reservations table!' as status;




-- ============================================================
-- ADD PAYMENT COLUMNS TO RESERVATIONS TABLE (SAFE MIGRATION)
-- ============================================================

DO $$
BEGIN
    -- Add columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='payment_status') THEN
        ALTER TABLE reservations ADD COLUMN payment_status VARCHAR(20) DEFAULT 'unpaid';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='payment_method') THEN
        ALTER TABLE reservations ADD COLUMN payment_method VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='payment_date') THEN
        ALTER TABLE reservations ADD COLUMN payment_date TIMESTAMP;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='amount_paid') THEN
        ALTER TABLE reservations ADD COLUMN amount_paid INT DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='balance') THEN
        ALTER TABLE reservations ADD COLUMN balance INT DEFAULT 0;
    END IF;
    
    RAISE NOTICE '✅ Payment columns checked/added';
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_reservations_payment_status ON reservations(payment_status);
CREATE INDEX IF NOT EXISTS idx_reservations_payment_method ON reservations(payment_method);

-- Initialize existing records safely
UPDATE reservations SET balance = total WHERE balance IS NULL;
UPDATE reservations SET payment_status = 'unpaid' WHERE payment_status IS NULL;
UPDATE reservations SET amount_paid = 0 WHERE amount_paid IS NULL;

SELECT '✅ Payment columns added to reservations table!' as status;



-- ============================================================
-- ADD POS COLUMN TO STORE_ITEMS TABLE
-- ============================================================

-- Add pos column if it doesn't exist
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS pos VARCHAR(20) DEFAULT NULL;

-- Create index for faster POS filtering
CREATE INDEX IF NOT EXISTS idx_store_items_pos ON store_items(pos);

-- Verification
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='store_items' AND column_name='pos') THEN
        RAISE NOTICE '✅ pos column added to store_items table';
    ELSE
        RAISE NOTICE '❌ pos column MISSING from store_items';
    END IF;
END $$;

SELECT '✅ POS column added to store_items table!' as status;

-- ============================================================
-- POS TYPE COLUMN FOR SALES ORDERS
-- ============================================================
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pos_type VARCHAR(20) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_pos_type ON sales_orders(pos_type);
SELECT '✅ pos_type column added to sales_orders table!' as status;

-- ============================================================
-- LAUNDRY SERVICES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS laundry_services (
  id SERIAL PRIMARY KEY,
  room_number VARCHAR(20) NOT NULL,
  clothes_type VARCHAR(200),
  services VARCHAR(500),
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  housekeeper_name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(50),
  payment_status VARCHAR(20) DEFAULT 'pending',
  amount_paid DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_laundry_service_date ON laundry_services(service_date);
CREATE INDEX IF NOT EXISTS idx_laundry_payment_status ON laundry_services(payment_status);
SELECT '✅ laundry_services table created!' as status;

-- ─── Under Maintenance flag on apartments ──────────────────────────────────
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS under_maintenance BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_apartments_maintenance ON apartments(under_maintenance);
SELECT '✅ apartments.under_maintenance column added!' as status;

-- ─── Waiter name on sales_orders (Bar/Restaurant POS) ──────────────────────
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS waiter_name VARCHAR(200);
SELECT '✅ sales_orders.waiter_name column added!' as status;

-- ─── Payment method on maintenance_records ─────────────────────────────────
ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
SELECT '✅ maintenance_records.payment_method column added!' as status;