-- No IPs, raw URLs, search text, form values or comment contents are stored.
CREATE TABLE IF NOT EXISTS views (
 site TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, route TEXT NOT NULL,
 seq INTEGER NOT NULL, active INTEGER NOT NULL, depth REAL NOT NULL, buckets TEXT NOT NULL, sections TEXT NOT NULL,
 end_seen INTEGER NOT NULL, ended INTEGER NOT NULL, consent TEXT NOT NULL, visitor TEXT,
 source TEXT NOT NULL, campaign TEXT NOT NULL, device TEXT NOT NULL, language TEXT NOT NULL,
 first_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(site,id)
);
CREATE INDEX IF NOT EXISTS views_range ON views(site,day,content,revision);
CREATE INDEX IF NOT EXISTS views_visitor ON views(site,visitor,day);
CREATE TABLE IF NOT EXISTS events (
 site TEXT NOT NULL, id TEXT NOT NULL, view_id TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL,
 action TEXT NOT NULL, target TEXT NOT NULL, surface TEXT NOT NULL, rank INTEGER NOT NULL, value REAL NOT NULL,
 PRIMARY KEY(site,id)
);
CREATE INDEX IF NOT EXISTS events_range ON events(site,day,content,action);
CREATE INDEX IF NOT EXISTS events_view ON events(site,view_id);
CREATE TABLE IF NOT EXISTS visitors (site TEXT NOT NULL, id TEXT NOT NULL, first_day TEXT NOT NULL, last_day TEXT NOT NULL, days TEXT NOT NULL, PRIMARY KEY(site,id));
CREATE INDEX IF NOT EXISTS visitors_recent ON visitors(site,last_day);
CREATE TABLE IF NOT EXISTS daily (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL,
 views INTEGER NOT NULL, active INTEGER NOT NULL, qualified INTEGER NOT NULL, completed INTEGER NOT NULL, optin INTEGER NOT NULL, unique_browsers INTEGER NOT NULL,
 impressions INTEGER NOT NULL, clicks INTEGER NOT NULL, retention TEXT NOT NULL, sources TEXT NOT NULL, interactions TEXT NOT NULL, hll TEXT NOT NULL, refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,refreshed_at)
);
CREATE INDEX IF NOT EXISTS daily_range ON daily(site,day,content,revision);
CREATE TABLE IF NOT EXISTS health (site TEXT NOT NULL, day TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL, PRIMARY KEY(site,day));
CREATE TABLE IF NOT EXISTS daily_events (site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, surface TEXT NOT NULL, rank INTEGER NOT NULL, count INTEGER NOT NULL, total REAL NOT NULL, refreshed_at INTEGER NOT NULL, PRIMARY KEY(site,day,content,revision,action,target,surface,rank,refreshed_at));
CREATE INDEX IF NOT EXISTS daily_events_range ON daily_events(site,day,content,action);
CREATE TABLE IF NOT EXISTS daily_sections (site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, section TEXT NOT NULL, active INTEGER NOT NULL, views INTEGER NOT NULL, refreshed_at INTEGER NOT NULL, PRIMARY KEY(site,day,content,revision,section,refreshed_at));
CREATE TABLE IF NOT EXISTS revoked (site TEXT NOT NULL, id TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(site,id));

CREATE TABLE IF NOT EXISTS summaries (site TEXT NOT NULL, day TEXT NOT NULL, refreshed_at INTEGER NOT NULL, PRIMARY KEY(site,day));
