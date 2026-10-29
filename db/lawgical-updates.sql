-- Lawgical Law Corporation (lawgical-law-corporation) is an owner-approved listing, so its contact details and offices live in the database.
-- These statements add them from the firm's Google listing (Surrey: phone, website, 5.0 from 120 reviews) and the office addresses the firm gave.
-- Each one only fills a field that is still empty, so running this file twice changes nothing the second time, and an owner's own edit is never replaced.
-- Phone and website: the Surrey office's Google listing. The Vancouver office has no phone of its own; the address at 1500 W Georgia St 13th floor
-- belongs to a shared business centre, so the firm's main line is used there too.
UPDATE firms SET data = json_set(data, '$.phone', '+17785983785'), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.phone') IS NULL;
UPDATE firms SET data = json_set(data, '$.website', 'https://lawgicalcorp.com'), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.website') IS NULL;
-- Both offices, each address linked to directions on the profile. All offices are by appointment only.
UPDATE firms SET data = json_set(data, '$.offices', json('[{"name":"Surrey","address":"5455 152 St #208, Surrey, BC V3S 5A5"},{"name":"Vancouver","address":"#1300 - 1500 West Georgia Street, Vancouver, BC V6G 2Z6"}]'), '$.appointmentOnly', json('true')), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.offices') IS NULL;
-- Logo: the firm's square mark (images/logos/lawgical-law-corporation.png). Only for a listing still showing the monogram.
UPDATE firms SET data = json_set(data, '$.type', 'logo', '$.src', 'images/logos/lawgical-law-corporation.png'), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.type') = 'mono';
-- Cover: the firm's wordmark (images/hero/lawgical-law-corporation.webp), shown whole.
UPDATE firms SET data = json_set(data, '$.heroImage', 'images/hero/lawgical-law-corporation.webp', '$.heroPos', 'center center'), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.heroImage') IS NULL;
-- Bio picture under the description: the team photo (images/bio/lawgical-law-corporation-team.webp).
UPDATE firms SET data = json_set(data, '$.bioImage', 'images/bio/lawgical-law-corporation-team.webp'), updated_at = datetime('now') WHERE slug = 'lawgical-law-corporation' AND json_extract(data, '$.bioImage') IS NULL;
