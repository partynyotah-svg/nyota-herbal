import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const entries = [
  {
    email: (process.env.INITIAL_SUPER_ADMIN_EMAIL || 'lewis.nyotah@gmail.com').trim().toLowerCase(),
    password: process.env.INITIAL_SUPER_ADMIN_PASSWORD,
    role: 'super_admin',
    display_name: 'Super Administrator',
    business_name: 'Nyota Herbal & Natural Wellness',
  },
  {
    email: (process.env.INITIAL_ADMIN_EMAIL || 'partynyotah@gmail.com').trim().toLowerCase(),
    password: process.env.INITIAL_ADMIN_PASSWORD,
    role: 'admin',
    display_name: 'Administrator',
    business_name: 'Independent Herbal Seller',
  },
];

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check your local .env file and run this from the project root.');
  process.exit(1);
}
if (entries.some(x => !x.password || x.password.length < 12)) {
  console.error('Both INITIAL_SUPER_ADMIN_PASSWORD and INITIAL_ADMIN_PASSWORD must be set and at least 12 characters long.');
  process.exit(1);
}
if (entries[0].password === entries[1].password) {
  console.error('The two temporary passwords must be DIFFERENT.');
  process.exit(1);
}
if (entries[0].email === entries[1].email) {
  console.error('The super-admin and admin email addresses must be different.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list Supabase Auth users: ${error.message}`);
    const found = data.users.find(u => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
}

for (const entry of entries) {
  console.log(`Processing ${entry.role}: ${entry.email}`);
  let user = await findUser(entry.email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email: entry.email,
      password: entry.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Auth user creation failed for ${entry.email}: ${error.message}`);
    user = data.user;
    console.log(`Created Auth user (${user.id}).`);
  } else {
    const { data, error } = await db.auth.admin.updateUserById(user.id, {
      password: entry.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Auth user exists but password update failed for ${entry.email}: ${error.message}`);
    user = data.user;
    console.log(`Auth user already existed; updated password (${user.id}).`);
  }

  const { error: profileError } = await db.from('profiles').upsert({
    id: user.id,
    email: entry.email,
    role: entry.role,
    display_name: entry.display_name,
    business_name: entry.business_name,
    status: 'active',
  }, { onConflict: 'id' });
  if (profileError) {
    throw new Error(`Auth user exists but profile upsert failed for ${entry.email}: ${profileError.message}. Check that supabase/schema.sql has been run in this SAME project and that profiles columns match the project schema.`);
  }
  console.log(`Profile saved with role=${entry.role}, status=active.`);
}

console.log('\nSUCCESS: both Auth users and profiles are ready. Use the two passwords from your local .env to sign in, then change them.');
