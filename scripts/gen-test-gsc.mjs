// Local/CI helper: adds a throw-away fake Google service account to .dev.vars so the smoke test can exercise the Search Console code
// against a fake Google running on this computer (port 8798). Nothing here is a real key.
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { type: 'service_account', client_email: 'lawdb-search@smoke-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
appendFileSync('.dev.vars', [
  `GSC_SERVICE_ACCOUNT_JSON='${JSON.stringify(key)}'`,
  'GSC_API_BASE=http://127.0.0.1:8798',
  'GSC_TOKEN_URL=http://127.0.0.1:8798/token',
  `GSC_TEST_PUBLIC_KEY_B64=${Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')}`,
  // pretend Google and LinkedIn sign-in (the smoke test plays the provider on port 8797)
  'GOOGLE_CLIENT_ID=test-google-id', 'GOOGLE_CLIENT_SECRET=test-google-secret', 'GOOGLE_AUTH_URL=http://127.0.0.1:8797/google/auth', 'GOOGLE_TOKEN_URL=http://127.0.0.1:8797/google/token', 'GOOGLE_USERINFO_URL=http://127.0.0.1:8797/google/userinfo',
  'LINKEDIN_CLIENT_ID=test-li-id', 'LINKEDIN_CLIENT_SECRET=test-li-secret', 'LINKEDIN_AUTH_URL=http://127.0.0.1:8797/linkedin/auth', 'LINKEDIN_TOKEN_URL=http://127.0.0.1:8797/linkedin/token', 'LINKEDIN_USERINFO_URL=http://127.0.0.1:8797/linkedin/userinfo',
  '',
].join('\n'));
console.log('added a test Google service account to .dev.vars');
