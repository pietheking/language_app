-- Repeatable initial migration. Content limits are enforced in both API and SQL.
CREATE TABLE IF NOT EXISTS saved_translations (
  id uuid PRIMARY KEY,
  owner_hash char(64) NOT NULL,
  fingerprint char(64) NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 5000),
  source varchar(10) NOT NULL CHECK (source IN ('auto','en','es','fr','de','pt','it','ja','ig','yo','ha')),
  target varchar(10) NOT NULL CHECK (target IN ('en','es','fr','de','pt','it','ja','ig','yo','ha')),
  translation text NOT NULL CHECK (char_length(translation) BETWEEN 1 AND 20000),
  detected_source varchar(10),
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_hash, fingerprint)
);
CREATE INDEX IF NOT EXISTS saved_translations_owner_date
  ON saved_translations (owner_hash, saved_at DESC, id DESC);
