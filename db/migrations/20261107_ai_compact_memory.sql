-- Additive compact-memory storage for already deployed quizer_ai chat tables.
-- The complete transcript remains owner-scoped; the AI synopsis is ONLY prompt context.
ALTER TABLE quizer_ai.threads
  ADD COLUMN IF NOT EXISTS turn_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory_turn_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS memory_status varchar(16) NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS memory_claim_id uuid,
  ADD COLUMN IF NOT EXISTS memory_claimed_at timestamptz;

DO $check$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ai_threads_memory_bounds'
      AND conrelid='quizer_ai.threads'::regclass
  ) THEN
    ALTER TABLE quizer_ai.threads ADD CONSTRAINT ai_threads_memory_bounds
      CHECK (turn_count>=0 AND memory_turn_count>=0
        AND memory_turn_count<=turn_count
        AND char_length(memory_summary)<=1600
        AND memory_status IN ('idle','pending','running','attention'));
  END IF;
END $check$;
CREATE INDEX IF NOT EXISTS threads_memory_pending
  ON quizer_ai.threads(updated_at ASC) WHERE memory_status='pending';
