ALTER TABLE dating_preferences ADD COLUMN passport_latitude REAL CHECK(passport_latitude BETWEEN -90 AND 90);
ALTER TABLE dating_preferences ADD COLUMN passport_longitude REAL CHECK(passport_longitude BETWEEN -180 AND 180);
