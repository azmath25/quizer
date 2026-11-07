-- Owner-scoped image references for teacher AI conversations. Bytes stay in
-- Quizer private asset storage, never in the Neon message body.
ALTER TABLE quizer_ai.messages
  ADD COLUMN IF NOT EXISTS image_asset_id varchar(128),
  ADD COLUMN IF NOT EXISTS image_job_id char(64);
DO $constraints$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='ai_messages_image_refs'
      AND conrelid='quizer_ai.messages'::regclass
  ) THEN
    ALTER TABLE quizer_ai.messages ADD CONSTRAINT ai_messages_image_refs
      CHECK (
        (image_asset_id IS NULL OR image_asset_id ~ '^[A-Za-z0-9_-]{1,128}$')
        AND (image_job_id IS NULL OR image_job_id ~ '^[a-f0-9]{64}$')
      );
  END IF;
END $constraints$;
