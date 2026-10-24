CREATE INDEX IF NOT EXISTS cloud_sources ON cloud_files(path) WHERE path GLOB '.studio/builds/*/source.json';
CREATE INDEX IF NOT EXISTS cloud_jobs_updated ON cloud_jobs(updated);
CREATE TABLE IF NOT EXISTS cloud_progress(job_id TEXT PRIMARY KEY,phase TEXT NOT NULL DEFAULT 'building',logs TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS cloud_schedule_cache(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,next_due TEXT,error TEXT);
CREATE TRIGGER IF NOT EXISTS cloud_parent_guard BEFORE INSERT ON cloud_commits WHEN NEW.parent!=(SELECT version FROM cloud_workspace WHERE id=1) BEGIN SELECT RAISE(ABORT,'workspace version conflict'); END;
