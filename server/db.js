// SQLite storage using Node's built-in driver (node:sqlite, Node 22.13+).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS equipment (
  id       TEXT PRIMARY KEY,                -- site tag, e.g. BS-A1
  name     TEXT NOT NULL,
  location TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parts (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  equipment_id      TEXT NOT NULL REFERENCES equipment(id),
  quantity          INTEGER NOT NULL,
  installed_on      TEXT NOT NULL,          -- ISO date
  service_life_days INTEGER NOT NULL,
  spares_on_hand    INTEGER NOT NULL DEFAULT 0,
  failed_at         TEXT,                   -- set when a part breaks (demo "destroy")
  previous_lifespan_days INTEGER            -- how long the unit before this one lasted, if known
);
CREATE TABLE IF NOT EXISTS supplier_requests (
  id          INTEGER PRIMARY KEY,
  part_id     INTEGER NOT NULL REFERENCES parts(id),
  scope       TEXT NOT NULL,
  evidence    TEXT NOT NULL,                -- JSON array of document refs
  status      TEXT NOT NULL CHECK (status IN ('open','ordered','purchased','cancelled')),
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id             INTEGER PRIMARY KEY,
  request_id     INTEGER NOT NULL REFERENCES supplier_requests(id),
  supplier       TEXT NOT NULL,
  included       TEXT NOT NULL,
  excluded       TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL,
  unit_price_gbp INTEGER NOT NULL,
  match          TEXT NOT NULL CHECK (match IN ('exact','equivalent')),  -- exact OEM part or a compatible alternative
  offered_part   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY,
  request_id        INTEGER NOT NULL UNIQUE REFERENCES supplier_requests(id),
  quote_id          INTEGER NOT NULL REFERENCES quotes(id),
  quantity          INTEGER NOT NULL,
  total_gbp         INTEGER NOT NULL,
  delivery_site     TEXT NOT NULL,
  po_reference      TEXT,
  notes             TEXT,
  expected_delivery TEXT NOT NULL,          -- ISO date
  placed_by         TEXT NOT NULL,
  placed_at         TEXT NOT NULL
);
-- Every time a part was bought: seeded history, orders placed here, and purchases made elsewhere.
CREATE TABLE IF NOT EXISTS purchase_history (
  id             INTEGER PRIMARY KEY,
  part_id        INTEGER NOT NULL REFERENCES parts(id),
  supplier       TEXT NOT NULL,
  unit_price_gbp INTEGER NOT NULL,
  quantity       INTEGER NOT NULL,
  purchased_on   TEXT NOT NULL              -- ISO date
);
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  part_id    INTEGER NOT NULL REFERENCES parts(id),
  request_id INTEGER REFERENCES supplier_requests(id),  -- null for events not tied to a request
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  detail     TEXT,
  at         TEXT NOT NULL
);
`;

const DAY = 86400000;
const isoDate = d => d.toISOString().slice(0, 10);

// Install dates are set relative to today so the demo always shows one part near end of life.
function seed(db, today = new Date()) {
  const ago = days => isoDate(new Date(today.getTime() - days * DAY));
  const insert = db.prepare(`INSERT INTO parts (name, equipment_id, quantity, installed_on, service_life_days, spares_on_hand, previous_lifespan_days)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const history = db.prepare('INSERT INTO purchase_history (part_id, supplier, unit_price_gbp, quantity, purchased_on) VALUES (?, ?, ?, ?, ?)');
  const equipment = db.prepare('INSERT INTO equipment (id, name, location) VALUES (?, ?, ?)');
  equipment.run('UPS-A', 'UPS A (800 kVA)', 'Electrical room');
  equipment.run('BS-A1', 'Battery string A1', 'Electrical room');
  equipment.run('CRAH-3', 'CRAH unit 3', 'Data hall');
  equipment.run('GEN-1', 'Generator 1', 'Generator yard');

  const part = (name, equipment, qty, life, daysLeft, spares, lastBought, previousLifespan = null) => {
    const installed = ago(life - daysLeft);
    const { lastInsertRowid } = insert.run(name, equipment, qty, installed, life, spares, previousLifespan);
    const [supplier, unitPrice] = lastBought;
    history.run(lastInsertRowid, supplier, unitPrice, qty, ago(life - daysLeft + 14));
  };
  part('VRLA jars BS-12', 'BS-A1', 40, 1825, 62, 0, ['Volta Critical Supply', 165]);
  // The previous fan kit only lasted 700 days; this one is 670 days old, so it is due on that history.
  part('Fan kit F-210', 'CRAH-3', 1, 1095, 425, 2, ['Northbank Power Services', 320], 700);
  part('Air filters G4', 'CRAH-3', 12, 180, 20, 12, ['Cellstock Direct', 18]);
  part('DC capacitor bank', 'UPS-A', 6, 2555, 900, 0, ['Volta Critical Supply', 240], 2100);
  part('Starter batteries 24V', 'GEN-1', 2, 1095, 40, 0, ['Cellstock Direct', 95]);
  part('Fuel filters', 'GEN-1', 4, 365, 200, 4, ['Northbank Power Services', 30]);
}

function open(file = path.join(__dirname, '..', 'data', 'ntgl.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (db.prepare('SELECT COUNT(*) AS n FROM parts').get().n === 0) seed(db);
  return db;
}

function reset(db) {
  db.exec('DELETE FROM audit_log; DELETE FROM orders; DELETE FROM quotes; DELETE FROM supplier_requests; DELETE FROM purchase_history; DELETE FROM parts; DELETE FROM equipment;');
  seed(db);
}

module.exports = { open, reset, seed };
