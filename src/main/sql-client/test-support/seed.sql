CREATE SCHEMA "CaseManagement";

CREATE TABLE "CaseManagement"."SurgicalCase" (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  note text,
  amount numeric(30, 10),
  payload jsonb,
  scheduled_at timestamptz,
  room_ids int[],
  attachment bytea,
  duration interval,
  nullable_flag boolean
);

INSERT INTO "CaseManagement"."SurgicalCase"
  (id, title, note, amount, payload, scheduled_at, room_ids, attachment, duration, nullable_flag)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Appendectomy', 'plain text',
   12345678901234567890.1234567890, '{"a": 1, "b": [true, null]}', '2026-01-02 03:04:05.678+00',
   '{1,2,3}', '\xdeadbeef', '1 day 02:03:04', true),
  ('22222222-2222-2222-2222-222222222222', 'Knee repair', 'NULL',
   0.0000000001, '[]', '2026-06-07 08:09:10+00',
   '{}', '\x', '00:00:01.5', false),
  ('33333333-3333-3333-3333-333333333333', 'Cataract', NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL);

CREATE VIEW "CaseManagement"."ScheduledCase" AS
  SELECT id, title, scheduled_at FROM "CaseManagement"."SurgicalCase" WHERE scheduled_at IS NOT NULL;

CREATE MATERIALIZED VIEW "CaseManagement"."CaseTitleCount" AS
  SELECT title, count(*) AS n FROM "CaseManagement"."SurgicalCase" GROUP BY title;

CREATE TABLE wide_rows AS
SELECT
  g AS id,
  (SELECT 'c' || g) AS c1, g * 2 AS c2, g * 3 AS c3, g * 4 AS c4, g * 5 AS c5,
  g * 6 AS c6, g * 7 AS c7, g * 8 AS c8, g * 9 AS c9, g * 10 AS c10,
  g * 11 AS c11, g * 12 AS c12, g * 13 AS c13, g * 14 AS c14, g * 15 AS c15,
  g * 16 AS c16, g * 17 AS c17, g * 18 AS c18, g * 19 AS c19, g * 20 AS c20,
  g * 21 AS c21, g * 22 AS c22, g * 23 AS c23, g * 24 AS c24, g * 25 AS c25,
  g * 26 AS c26, g * 27 AS c27, g * 28 AS c28, g * 29 AS c29, g * 30 AS c30,
  g * 31 AS c31, g * 32 AS c32, g * 33 AS c33, g * 34 AS c34, g * 35 AS c35,
  g * 36 AS c36, g * 37 AS c37, g * 38 AS c38, g * 39 AS c39
FROM generate_series(1, 5000) AS g;

ALTER TABLE wide_rows ADD PRIMARY KEY (id);
