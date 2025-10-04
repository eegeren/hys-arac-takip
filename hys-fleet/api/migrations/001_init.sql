CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_thresholds (
  id SERIAL PRIMARY KEY,
  days_before INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS notifications_log (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  threshold_days INTEGER NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  UNIQUE (document_id, threshold_days)
);

INSERT INTO users (email, full_name)
VALUES ('admin@hysfleet.local', 'HYS Fleet Admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO vehicles (plate, model)
VALUES ('34ABC123', 'Volvo FH16')
ON CONFLICT (plate) DO NOTHING;

WITH upsert_vehicle AS (
  SELECT id FROM vehicles WHERE plate = '34ABC123'
)
INSERT INTO documents (vehicle_id, doc_type, valid_from, valid_to)
SELECT id,
       doc_type,
       DATE '2024-01-01',
       valid_to
FROM upsert_vehicle,
     (VALUES
        ('annual_inspection', DATE '2024-09-15'),
        ('insurance_policy', DATE '2024-10-01'),
        ('k_document', DATE '2024-08-30')
     ) AS docs(doc_type, valid_to)
ON CONFLICT DO NOTHING;

INSERT INTO notify_thresholds (days_before) VALUES (30) ON CONFLICT DO NOTHING;\nINSERT INTO notify_thresholds (days_before) VALUES (15) ON CONFLICT DO NOTHING;\nINSERT INTO notify_thresholds (days_before) VALUES (7) ON CONFLICT DO NOTHING;\nINSERT INTO notify_thresholds (days_before) VALUES (1) ON CONFLICT DO NOTHING;\n
