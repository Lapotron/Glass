CREATE TABLE IF NOT EXISTS summary_jobs (
 site TEXT NOT NULL, day TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(site,day)
);
CREATE INDEX IF NOT EXISTS views_summary_cursor ON views(site,day,content,revision,id);
CREATE INDEX IF NOT EXISTS events_summary_cursor ON events(site,day,content,revision,action,target,surface,rank);
CREATE TABLE IF NOT EXISTS dirty_days (site TEXT NOT NULL, day TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(site,day));
INSERT OR IGNORE INTO dirty_days SELECT site,day,MAX(updated_at) FROM views GROUP BY site,day;
CREATE TABLE IF NOT EXISTS daily_network_keys (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL, expires INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,hash)
);
CREATE INDEX IF NOT EXISTS network_expiry ON daily_network_keys(site,expires);
CREATE TABLE IF NOT EXISTS daily_network_totals (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '', networks INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(site,day,content,revision)
);
CREATE TABLE IF NOT EXISTS database_usage (
 site TEXT NOT NULL, day TEXT NOT NULL, rows_read INTEGER NOT NULL DEFAULT 0, rows_written INTEGER NOT NULL DEFAULT 0,
 last_at INTEGER NOT NULL, PRIMARY KEY(site,day)
);
