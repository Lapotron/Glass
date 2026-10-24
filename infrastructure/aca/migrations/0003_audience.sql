ALTER TABLE views ADD COLUMN audience TEXT NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN bucket INTEGER NOT NULL DEFAULT -1;
CREATE INDEX IF NOT EXISTS visits_cursor ON views(site,first_at,id);
CREATE TABLE IF NOT EXISTS daily_audience (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL,
 dimension TEXT NOT NULL, value TEXT NOT NULL, views INTEGER NOT NULL, qualified INTEGER NOT NULL,
 active INTEGER NOT NULL, refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,dimension,value,refreshed_at)
);
CREATE TABLE IF NOT EXISTS daily_vitals (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL,
 target TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,target,bucket,refreshed_at)
);
CREATE TABLE IF NOT EXISTS maintenance_status (site TEXT PRIMARY KEY, last_started INTEGER, last_succeeded INTEGER);
INSERT INTO dirty_days SELECT site,day,MAX(updated_at,unixepoch()*1000) FROM views GROUP BY site,day
 ON CONFLICT(site,day) DO UPDATE SET updated_at=MAX(dirty_days.updated_at,excluded.updated_at);
