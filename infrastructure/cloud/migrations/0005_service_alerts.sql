-- A singleton lease and delivery journal. No URL, credentials or reader data are stored here.
CREATE TABLE IF NOT EXISTS cloud_service_alerts (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0, endpoint_hash TEXT NOT NULL DEFAULT '', sent TEXT NOT NULL DEFAULT '[]', pending TEXT, pending_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_check INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_status INTEGER, last_attempt INTEGER);
INSERT OR IGNORE INTO cloud_service_alerts(id) VALUES(1);
