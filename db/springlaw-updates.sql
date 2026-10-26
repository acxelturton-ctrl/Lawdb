-- Spring Law (springlaw-toronto) is an owner listing, so its pictures and facts are not in the repo's firm files.
-- These statements add them from the firm's own website and the team photo the firm sent in. Each one only fills a field that is still empty,
-- so running this file twice changes nothing the second time, and an owner's own upload or edit is never replaced.
-- Logo: the firm's wordmark (images/logos/springlaw-toronto.jpg).
UPDATE firms SET data = json_set(data, '$.type', 'logo', '$.src', 'images/logos/springlaw-toronto.jpg'), updated_at = datetime('now') WHERE slug = 'springlaw-toronto' AND json_extract(data, '$.type') = 'mono';
-- Cover: the team photo (images/hero/springlaw-toronto.webp), with the crop that keeps the faces in the banner.
UPDATE firms SET data = json_set(data, '$.heroImage', 'images/hero/springlaw-toronto.webp', '$.heroPos', 'center 18%'), updated_at = datetime('now') WHERE slug = 'springlaw-toronto' AND json_extract(data, '$.heroImage') IS NULL;
-- Lawyers named on the firm's team page (the staff on the same page are not lawyers, so they are not listed here).
UPDATE firms SET data = json_set(data, '$.details', json('{"lawyers":[{"name":"Lisa Stam","title":"Lawyer, Managing Partner"},{"name":"Marnie Baizley","title":"Partner, Lawyer"},{"name":"Emily Elder"},{"name":"Shauna Fabrizi"},{"name":"Lexa Cutler"},{"name":"Jeffrey Adams"},{"name":"Jessica Paglia"},{"name":"Calvin To"},{"name":"Vivian Liu"}]}')), updated_at = datetime('now') WHERE slug = 'springlaw-toronto' AND json_extract(data, '$.details') IS NULL;
-- Social profiles linked from the firm's own homepage.
UPDATE firms SET data = json_set(data, '$.social', json('{"facebook":"https://www.facebook.com/SpringLawFirm","instagram":"https://www.instagram.com/springlawfirm","linkedin":"https://www.linkedin.com/company/16228196","x":"https://x.com/SpringLawFirm","youtube":"https://www.youtube.com/channel/UCyY-ZRzfbfzFqDxIBQclFpQ"}')), updated_at = datetime('now') WHERE slug = 'springlaw-toronto' AND json_extract(data, '$.social') IS NULL;
