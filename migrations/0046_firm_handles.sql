-- A firm's public address is /firm/<handle> (no city on the end). The handle is kept apart from the slug: the slug stays the firm's key in every table and in
-- the data files, so nothing that points at a firm has to move. The handle is also copied into the firm's JSON (data.handle) so every list that reads the
-- JSON has it. A firm without a handle is reachable at /firm/<slug>. The old /firms/<slug> addresses redirect (301) to the handle.
ALTER TABLE firms ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_firms_handle ON firms (handle) WHERE handle IS NOT NULL;
