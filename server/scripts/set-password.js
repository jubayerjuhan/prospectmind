import 'dotenv/config';
import connectDB from '../src/config/db.js';
import User from '../src/models/User.js';

const [EMAIL, NEW_PASSWORD] = process.argv.slice(2);

async function run() {
  if (!EMAIL || !NEW_PASSWORD) {
    console.error('Usage: node scripts/set-password.js <email> <new-password>');
    process.exit(1);
  }

  await connectDB();
  const user = await User.findOne({ email: EMAIL }).select('+password');
  if (!user) {
    console.error(`No user found with email ${EMAIL}`);
    process.exit(1);
  }
  user.password = NEW_PASSWORD; // pre('save') hook re-hashes with bcrypt
  await user.save();
  console.log(`Password updated for ${EMAIL}`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
