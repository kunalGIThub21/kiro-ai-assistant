const crypto = require('crypto');

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: node scripts/hash-password.js "<StrongPasswordAtLeast10Chars>"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
console.log(`scrypt$${salt}$${derived}`);
