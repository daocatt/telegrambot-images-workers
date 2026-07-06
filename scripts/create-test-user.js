import crypto from 'crypto';
import { execSync } from 'child_process';

const email = 'test@example.com';
const password = 'password123';
const tgId = '999999';
const nickname = 'LocalAdmin';

// Generate matching PBKDF2 hash
const salt = crypto.randomBytes(16);
const saltHex = salt.toString('hex');
const iterations = 100000;
const keyLength = 32;

const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
const hashHex = derivedKey.toString('hex');
const passwordHash = `pbkdf2_sha256$${iterations}$${saltHex}$${hashHex}`;

const now = Date.now();

const sql = `INSERT OR REPLACE INTO users (tg_id, nickname, is_admin, status, created_at, email, password_hash, email_verified) VALUES ('${tgId}', '${nickname}', 1, 'active', ${now}, '${email}', '${passwordHash}', 1);`;

console.log(`Creating test user:`);
console.log(`Email: ${email}`);
console.log(`Password: ${password}`);
console.log(`SQL: ${sql}`);

const escapedSql = sql.replace(/\$/g, '\\$');

try {
  console.log(`\n🚣 Inserting into snapflare local D1 database...`);
  execSync(`npx wrangler d1 execute telegrambot_images_db --local --command "${escapedSql}" --env snapflare`, { stdio: 'inherit' });
} catch (e) {
  console.warn(`⚠️ Failed to insert into snapflare database:`, e.message);
}

try {
  console.log(`\n🚣 Inserting into pot local D1 database...`);
  execSync(`npx wrangler d1 execute telegrambot_images_pot --local --command "${escapedSql}" --env pot`, { stdio: 'inherit' });
} catch (e) {
  console.warn(`⚠️ Failed to insert into pot database:`, e.message);
}

try {
  console.log(`\n🚣 Inserting into default local D1 database...`);
  execSync(`npx wrangler d1 execute telegrambot_images_pot --local --command "${escapedSql}"`, { stdio: 'inherit' });
} catch (e) {
  console.error(`❌ Failed to insert into default database:`, e.message);
}

