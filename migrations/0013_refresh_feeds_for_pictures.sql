-- Blog pictures can now be found for more kinds of WordPress sites. Mark every working blog as due so the next visits to LawDB News re-read them (a few per visit).
UPDATE firm_feeds SET last_checked_at = NULL WHERE status = 'ok';
