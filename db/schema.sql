-- ============================================================
-- Steps Premium Suite - SAFE MIGRATION (Preserves Data)
-- Run this instead of the full schema
-- ============================================================

-- ============================================================
-- CREATE TABLES IF NOT EXISTS (NO DROP)
-- ============================================================

-- APARTMENTS (only if not exists)
CREATE TABLE IF NOT EXISTS apartments (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100)   NOT NULL,
  type            VARCHAR(100)   NOT NULL,
  max_adults      INT            NOT NULL DEFAULT 2,
  emoji           VARCHAR(10)    NOT NULL DEFAULT '',
  color           VARCHAR(20)    NOT NULL DEFAULT '#2d9c6e',
  rate_per_night  INT            NOT NULL DEFAULT 90000,
  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RESERVATIONS
CREATE TABLE IF NOT EXISTS reservations (
  id          SERIAL PRIMARY KEY,
  apt_id      INT            NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  guest       VARCHAR(200)   NOT NULL,
  email       VARCHAR(200)   NOT NULL,
  mobile      VARCHAR(50),
  country     VARCHAR(100),
  city        VARCHAR(100),
  checkin     DATE           NOT NULL,
  checkout    DATE           NOT NULL,
  adults      INT            NOT NULL DEFAULT 1,
  children    INT            NOT NULL DEFAULT 0,
  rate_type   VARCHAR(20)    NOT NULL DEFAULT 'Full',
  total       INT            NOT NULL DEFAULT 0,
  created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT checkout_after_checkin CHECK (checkout > checkin)
);

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_reservations_apt_id ON reservations(apt_id);
CREATE INDEX IF NOT EXISTS idx_reservations_checkin ON reservations(checkin);
CREATE INDEX IF NOT EXISTS idx_reservations_checkout ON reservations(checkout);

-- STORE ITEMS
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

-- STORE REQUESTS
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

-- OUTLET INVENTORY
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

-- OUTLETS
CREATE TABLE IF NOT EXISTS outlets (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  email         VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL DEFAULT 'manager',
  full_name     VARCHAR(200),
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- HOUSEKEEPING STATUS
CREATE TABLE IF NOT EXISTS housekeeping_status (
  id              SERIAL PRIMARY KEY,
  apartment_id    INT NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'clean',
  last_updated    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by      VARCHAR(100),
  notes           TEXT,
  UNIQUE(apartment_id)
);

-- ============================================================
-- ADD INDEXES (IF NOT EXISTS)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_housekeeping_status_apartment ON housekeeping_status(apartment_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status_status ON housekeeping_status(status);
CREATE INDEX IF NOT EXISTS idx_outlet_inventory_outlet ON outlet_inventory(outlet);
CREATE INDEX IF NOT EXISTS idx_store_requests_status ON store_requests(status);
CREATE INDEX IF NOT EXISTS idx_store_items_category ON store_items(category);

-- ============================================================
-- ADD FUNCTION AND TRIGGER (DROP ONLY IF EXISTS)
-- ============================================================
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

-- ============================================================
-- ADD MISSING COLUMNS (SAFE - PRESERVES DATA)
-- ============================================================
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS cleaning_status VARCHAR(20) DEFAULT 'clean';
ALTER TABLE store_items ADD COLUMN IF NOT EXISTS min_stock_level INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);

-- ============================================================
-- INSERT ONLY IF TABLES ARE EMPTY (NO DATA LOSS)
-- ============================================================

-- Insert default outlets (only if no outlets exist)
INSERT INTO outlets (name)
SELECT 'housekeeping' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'housekeeping');
INSERT INTO outlets (name)
SELECT 'kitchen' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'kitchen');
INSERT INTO outlets (name)
SELECT 'public' WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE name = 'public');

-- Insert sample store items (only if store_items is empty)
INSERT INTO store_items (name, category, cost, quantity, stock_value, unit)
SELECT 'Rice (5kg)', 'food', 15000, '100 kg', 100, 'kg'
WHERE NOT EXISTS (SELECT 1 FROM store_items LIMIT 1);

-- ============================================================
-- VERIFICATION (NO DATA LOSS)
-- ============================================================
SELECT 
  '✅ Safe migration completed!' as status,
  (SELECT COUNT(*) FROM apartments) as apartments_count,
  (SELECT COUNT(*) FROM reservations) as reservations_count,
  (SELECT COUNT(*) FROM users) as users_count,
  (SELECT COUNT(*) FROM store_items) as store_items_count;




  -- ============================================================
-- PURCHASE ORDERS TABLES
-- ============================================================

-- Vendors table
CREATE TABLE IF NOT EXISTS vendors (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  type        VARCHAR(50) NOT NULL DEFAULT 'local', -- local, other
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              SERIAL PRIMARY KEY,
  po_number       VARCHAR(50) NOT NULL UNIQUE,
  vendor_id       INT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, completed, cancelled
  total_amount    INT NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      VARCHAR(100),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Order Items table
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

-- Insert default vendors
INSERT INTO vendors (name, type) VALUES 
  ('Local Vendor', 'local'),
  ('International Supplier', 'other')
ON CONFLICT (name) DO NOTHING;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);



-- ============================================================
-- GOODS RECEIPT NOTE (GRN) TABLES
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_date ON goods_receipt_notes(receipt_date);
CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON goods_receipt_items(grn_id);

-- Update purchase_orders table to track received status
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS grn_id INT REFERENCES goods_receipt_notes(id);



-- Add unit column to outlet_inventory table if it doesn't exist
ALTER TABLE outlet_inventory ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT 'units';

-- Update existing rows to have a default unit
UPDATE outlet_inventory SET unit = 'units' WHERE unit IS NULL;



-- ============================================================
-- SALES TABLES FOR POS
-- ============================================================

-- Sales Orders table (master table for each transaction)
CREATE TABLE IF NOT EXISTS sales_orders (
  id              SERIAL PRIMARY KEY,
  order_number    VARCHAR(50) NOT NULL UNIQUE,
  cashier_id      INT REFERENCES users(id),
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
  item_id         INT REFERENCES store_items(id),
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

-- Generate order number function
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number = 'ORD-' || TO_CHAR(NEW.order_date, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_order_number ON sales_orders;
CREATE TRIGGER trigger_order_number
  BEFORE INSERT ON sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_order_number();


-- Add only checkout_time column with default 11:00 AM
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checkout_time TIME DEFAULT '11:00:00';


-- ============================================================
-- ACTIVITY LOG TABLE (Audit Trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(100) NOT NULL,
  action      VARCHAR(50) NOT NULL,  -- CREATE, UPDATE, DELETE, VIEW, LOGIN, LOGOUT
  entity_type VARCHAR(50) NOT NULL,  -- reservation, apartment, user, etc.
  entity_id   INT,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_date ON activity_logs(created_at);