-- Profile photo: the picture itself lives in R2 (avatars/<user id>); these remember its type and when it changed (used to refresh browsers).
ALTER TABLE users ADD COLUMN avatar_type TEXT;
ALTER TABLE users ADD COLUMN avatar_at TEXT;
