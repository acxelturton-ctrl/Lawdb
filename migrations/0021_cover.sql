-- Profile cover photo (the banner behind the profile photo). The picture lives in R2 (covers/<user id>); these remember its type and when it changed.
ALTER TABLE users ADD COLUMN cover_type TEXT;
ALTER TABLE users ADD COLUMN cover_at TEXT;
