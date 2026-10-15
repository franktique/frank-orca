-- Kept apart from seed.sql so suites that do not test the 50 MB limit stay fast.
CREATE TABLE big_text (id int PRIMARY KEY, body text NOT NULL);

INSERT INTO big_text
SELECT g, repeat(md5(g::text), 32768 / 32 * 2) FROM generate_series(1, 1000) AS g;
