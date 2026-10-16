-- Marcas crudas del reloj (cada vez que alguien pone la cara), tal como llegan de CrossChex
CREATE TABLE marks (
  uuid TEXT PRIMARY KEY NOT NULL,
  workno TEXT NOT NULL,
  checktime TEXT NOT NULL,   -- ISO en UTC
  local_date TEXT NOT NULL,  -- YYYY-MM-DD en hora de Buenos Aires
  checktype INTEGER NOT NULL,
  device_serial TEXT,
  first_name TEXT,
  last_name TEXT,
  source TEXT NOT NULL,      -- webhook | api
  received_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0  -- 1 cuando el dia ya se paso a Odoo
);

CREATE INDEX marks_by_employee_day ON marks (workno, local_date);
CREATE INDEX marks_pending ON marks (synced, local_date);
