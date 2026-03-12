import crypto from 'crypto';

const tokenSecret = crypto.randomBytes(32).toString('hex');
const pathSecret = crypto.randomBytes(8).toString('hex'); // 16 characters
console.log('\n=============================================================');
console.log('🎉 Your Webhook Secrets have been seamlessly generated:');
console.log('=============================================================\n');
console.log(`\x1b[36mWEBHOOK_SECRET:\x1b[0m      \x1b[32m${tokenSecret}\x1b[0m`);
console.log(`\x1b[36mWEBHOOK_PATH_SECRET:\x1b[0m \x1b[32m${pathSecret}\x1b[0m\n`);
console.log('👉 Please copy these and paste them in your .env file or Cloudflare dashboard.');
console.log('Your webhook will be accessible at: /webhook/YOUR_WEBHOOK_PATH_SECRET\n');
