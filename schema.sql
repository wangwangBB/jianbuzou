PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL,
  checkin_at TEXT NOT NULL,
  checkout_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  user_agent TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_code TEXT NOT NULL DEFAULT 'ALL',
  title TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  explanation TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id TEXT NOT NULL,
  point_code TEXT NOT NULL CHECK (point_code IN ('cp1','cp2','cp3')),
  question_id INTEGER,
  question_title TEXT NOT NULL,
  selected_option TEXT NOT NULL CHECK (selected_option IN ('A','B','C','D')),
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  is_correct INTEGER NOT NULL,
  answered_at TEXT NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE SET NULL,
  UNIQUE (participant_id, point_code)
);

CREATE INDEX IF NOT EXISTS idx_participants_checkin_at ON participants(checkin_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_participant ON checkpoint_records(participant_id);
CREATE INDEX IF NOT EXISTS idx_records_point ON checkpoint_records(point_code);
CREATE INDEX IF NOT EXISTS idx_questions_enabled_point ON questions(enabled, point_code);


-- Staff display links; created automatically on first admin sharing use.
CREATE TABLE IF NOT EXISTS qr_staff_shares (
  point_code TEXT PRIMARY KEY CHECK(point_code IN ('start','cp1','cp2','cp3')),
  share_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
