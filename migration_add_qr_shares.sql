

-- Staff display links; created automatically on first admin sharing use.
CREATE TABLE IF NOT EXISTS qr_staff_shares (
  point_code TEXT PRIMARY KEY CHECK(point_code IN ('start','cp1','cp2','cp3')),
  share_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
