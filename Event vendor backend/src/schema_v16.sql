-- schema_v16.sql  
-- Run in Supabase SQL Editor.
-- Drops ALL foreign-key constraints on the threads table so demo vendors
-- (IDs not present in the vendors table) can receive messages.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM   pg_constraint
    WHERE  conrelid = 'threads'::regclass
      AND  contype  = 'f'
  LOOP
    EXECUTE format('ALTER TABLE threads DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped constraint: %', c.conname;
  END LOOP;
END $$;

-- Confirm result
SELECT conname, contype
FROM   pg_constraint
WHERE  conrelid = 'threads'::regclass;
