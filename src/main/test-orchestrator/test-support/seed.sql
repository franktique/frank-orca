CREATE TABLE IF NOT EXISTS requests (
  id serial PRIMARY KEY,
  case_id text NOT NULL,
  request_id text NOT NULL,
  status text NOT NULL
);

-- 1,000 rows for the truncation scenario
INSERT INTO requests (case_id, request_id, status)
SELECT 'seed-case', 'seed-request', CASE WHEN n % 2 = 0 THEN 'PENDING' ELSE 'DONE' END
FROM generate_series(1, 1000) AS n;
