-- Optional accounts (see .claude/docs/adr-002-accounts.md).
-- Identity lives in Supabase's auth.users; Whimsy keeps per-user data here.

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  home_airports TEXT NOT NULL DEFAULT '[]', -- JSON IATA codes, default "From" filter
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_deals (
  user_id UUID NOT NULL,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, deal_id)
);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS alerts_user ON alerts (user_id);
CREATE INDEX IF NOT EXISTS alerts_email ON alerts (email);

-- Deleting an auth user removes everything they own. Only where Supabase's auth
-- schema exists (local dev/tests run on PGlite without it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_user_fk FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
    ALTER TABLE saved_deals ADD CONSTRAINT saved_deals_user_fk FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
    ALTER TABLE alerts ADD CONSTRAINT alerts_user_fk FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Same lockdown as every other table: only the API (table owner) can touch these.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_deals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profiles, saved_deals FROM anon, authenticated;
