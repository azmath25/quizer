-- Quizer AI assistant memory and extracted-text documents.
-- Apply to an isolated Neon *development branch* first. Never migrate production
-- without review and an explicit release approval. Existing quiz tables unaffected.
CREATE SCHEMA IF NOT EXISTS quizer_ai;

CREATE TABLE IF NOT EXISTS quizer_ai.threads (
  id uuid PRIMARY KEY,
  owner_uid varchar(128) NOT NULL,
  title varchar(120) NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_uid)
);
CREATE INDEX IF NOT EXISTS threads_owner_recent
  ON quizer_ai.threads(owner_uid, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS quizer_ai.messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL,
  owner_uid varchar(128) NOT NULL,
  request_id varchar(100) NOT NULL,
  role varchar(12) NOT NULL CHECK (role IN ('user','assistant')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 14000),
  mimo_run_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (thread_id, owner_uid) REFERENCES quizer_ai.threads(id, owner_uid) ON DELETE CASCADE,
  UNIQUE(owner_uid, request_id, role)
);
CREATE INDEX IF NOT EXISTS messages_thread_created
  ON quizer_ai.messages(owner_uid, thread_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS quizer_ai.documents (
  id uuid PRIMARY KEY,
  owner_uid varchar(128) NOT NULL,
  label varchar(160) NOT NULL,
  source_type varchar(12) NOT NULL CHECK (source_type IN ('text','pdf','image')),
  status varchar(24) NOT NULL CHECK (status IN ('text_ready','awaiting_file','review_required','failed')),
  text_excerpt text NOT NULL DEFAULT '' CHECK (char_length(text_excerpt) <= 20000),
  page_count integer NOT NULL DEFAULT 1 CHECK (page_count BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, owner_uid)
);
CREATE INDEX IF NOT EXISTS documents_owner_recent
  ON quizer_ai.documents(owner_uid, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS quizer_ai.document_pages (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL,
  owner_uid varchar(128) NOT NULL,
  page_number integer NOT NULL CHECK (page_number BETWEEN 1 AND 500),
  extracted_text text NOT NULL DEFAULT '' CHECK (char_length(extracted_text) <= 10000),
  has_figure boolean NOT NULL DEFAULT false,
  figure_description text NOT NULL DEFAULT '' CHECK (char_length(figure_description) <= 2000),
  review_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, owner_uid) REFERENCES quizer_ai.documents(id, owner_uid) ON DELETE CASCADE,
  UNIQUE(document_id, page_number)
);
CREATE INDEX IF NOT EXISTS document_pages_owner
  ON quizer_ai.document_pages(owner_uid, document_id, page_number);

-- All access is through Firebase server code with explicit owner_uid filters.
-- Do NOT expose database credentials, raw SQL or direct Neon clients to browsers.
