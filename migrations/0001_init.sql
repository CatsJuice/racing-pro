-- players are anonymous: an id + a secret token kept in the browser
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_submit INTEGER NOT NULL DEFAULT 0
);

-- one row per (track version, player): their personal best
CREATE TABLE laps (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  track_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  time REAL NOT NULL,
  sectors TEXT NOT NULL,
  car TEXT NOT NULL,
  assist TEXT NOT NULL,
  rewinds INTEGER NOT NULL DEFAULT 0,
  top_speed REAL NOT NULL,
  created INTEGER NOT NULL,
  frames BLOB NOT NULL,
  UNIQUE (track_id, track_hash, user_id)
);

CREATE INDEX laps_board ON laps (track_id, track_hash, time);
