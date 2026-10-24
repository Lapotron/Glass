-- Joint keys are generated from existing coarse observations. No new reader identifiers.
ALTER TABLE views ADD COLUMN segment_key TEXT GENERATED ALWAYS AS (json_array(
 COALESCE(NULLIF(json_extract(audience,'$.country'),''),'Unknown'),
 COALESCE(NULLIF(json_extract(audience,'$.device'),''),NULLIF(device,''),'Unknown'),
 COALESCE(NULLIF(json_extract(audience,'$.browser'),''),'Unknown'),
 COALESCE(NULLIF(json_extract(audience,'$.os'),''),'Unknown'),
 COALESCE(NULLIF(source,''),'direct'),COALESCE(NULLIF(campaign,''),'(none)'),COALESCE(NULLIF(language,''),'Unknown')
)) VIRTUAL;
CREATE INDEX views_segments ON views(site,day,content,revision,segment_key,id);
CREATE INDEX events_segment_cursor ON events(site,day,id);
CREATE TABLE segment_daily (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, segment_key TEXT NOT NULL,
 views INTEGER NOT NULL, active INTEGER NOT NULL, qualified INTEGER NOT NULL, completed INTEGER NOT NULL, optin INTEGER NOT NULL,
 unique_browsers INTEGER NOT NULL, impressions INTEGER NOT NULL DEFAULT 0,clicks INTEGER NOT NULL DEFAULT 0,retention TEXT NOT NULL, sources TEXT NOT NULL, hll TEXT NOT NULL,
 audience TEXT NOT NULL, sections TEXT NOT NULL, refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,segment_key,refreshed_at)
);
CREATE TABLE segment_events (
 site TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, revision TEXT NOT NULL, segment_key TEXT NOT NULL,
 action TEXT NOT NULL,target TEXT NOT NULL,surface TEXT NOT NULL,rank INTEGER NOT NULL,bucket INTEGER NOT NULL,
 count INTEGER NOT NULL,total REAL NOT NULL,refreshed_at INTEGER NOT NULL,
 PRIMARY KEY(site,day,content,revision,segment_key,action,target,surface,rank,bucket,refreshed_at)
);
CREATE TABLE segment_coverage (site TEXT NOT NULL,day TEXT NOT NULL,refreshed_at INTEGER NOT NULL,PRIMARY KEY(site,day,refreshed_at));
CREATE TABLE segment_event_jobs (site TEXT NOT NULL,day TEXT NOT NULL,refreshed_at INTEGER NOT NULL,cursor TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(site,day,refreshed_at));
-- Revisit only days with a complete retained source. Partially expired days stay unavailable.
INSERT INTO dirty_days SELECT v.site,v.day,MAX(v.updated_at,unixepoch()*1000) FROM views v
 WHERE v.day>=date('now','-90 days') GROUP BY v.site,v.day
 HAVING COUNT(*)>=COALESCE((SELECT SUM(d.views) FROM daily d JOIN summaries s ON s.site=d.site AND s.day=d.day AND s.refreshed_at=d.refreshed_at WHERE d.site=v.site AND d.day=v.day),0)
 ON CONFLICT(site,day) DO UPDATE SET updated_at=MAX(dirty_days.updated_at,excluded.updated_at);
