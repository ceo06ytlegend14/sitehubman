import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
  assertFirebaseScriptConfig,
  firebaseConfig,
} from './firebaseScriptConfig.mjs';

// This seed creates known-credential accounts, so it is restricted to the
// local emulator unless explicitly overridden for a disposable demo project.
const ALLOW_LIVE =
  process.env.SITEHUB_SEED_ALLOW_LIVE === '1' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!ALLOW_LIVE) {
  console.error('REFUSING TO SEED LIVE PROJECT. Set FIRESTORE_EMULATOR_HOST or SITEHUB_SEED_ALLOW_LIVE=1.');
  process.exit(1);
}

assertFirebaseScriptConfig();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Demo-only password for disposable emulator/test projects — never reuse on production.
const SEED_PASSWORD = 'DemoSeed-Password123!';

const SEED_ACCOUNTS = [
  {
    email: 'admin@sitehub.app',
    password: SEED_PASSWORD,
    displayName: 'Demo Admin',
    role: 'customer',
    appRole: 'super_admin',
    title: 'Demo Admin Role',
  },
  {
    email: 'sales@sitehub.app',
    password: SEED_PASSWORD,
    displayName: 'Demo Sales',
    role: 'customer',
    appRole: 'sales',
    title: 'Demo Sales Role',
  },
  {
    email: 'customer@sitehub.app',
    password: SEED_PASSWORD,
    displayName: 'Demo Customer',
    role: 'customer',
    appRole: 'customer',
    title: 'Demo Customer Role',
  },
];

async function seedAccount(account) {
  let uid;
  try {
    const cred = await signInWithEmailAndPassword(auth, account.email, account.password);
    uid = cred.user.uid;
    console.log(`🔑 Signed in as ${account.email}`);
  } catch (signInErr) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, account.email, account.password);
      uid = cred.user.uid;
      await updateProfile(cred.user, { displayName: account.displayName });
      console.log(`✅ Created Auth User: ${account.email}`);
    } catch (createErr) {
      console.error(`❌ Could not sign in or create ${account.email}: ${createErr.message}`);
      return;
    }
  }

  // Write Firestore Profile matching validSelfUserCreate rules
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        email: account.email,
        displayName: account.displayName,
        role: 'customer',
        authType: 'email',
        authProvider: 'email',
        plan: 'free',
        language: 'en',
        isActive: true,
        isGuest: false,
        createdBy: uid,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`✅ Firestore Profile Initialized: ${account.email} (App Role: ${account.appRole})`);

    // Bio Page for public sharing
    await setDoc(
      doc(db, 'bioPages', uid),
      {
        userId: uid,
        name: account.displayName,
        title: account.title,
        slug: account.displayName.toLowerCase().replace(/\s+/g, '-'),
        publicSlug: account.displayName.toLowerCase().replace(/\s+/g, '-'),
        headline: 'Next-Gen NFC & Digital Identity',
        bio: `Demo seed bio for ${account.email}. Not a real person.`,
        theme: 'mono',
        email: account.email,
        phone: '',
        website: '',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`✅ Bio Page Initialized for ${account.displayName}`);
  } catch (err) {
    console.error(`❌ Firestore Write Error for ${account.email}:`, err.message);
  }
}

console.log('🚀 Seeding 3 demo accounts...\n');
for (const acc of SEED_ACCOUNTS) {
  await seedAccount(acc);
}

console.log('\n========================================');
console.log('🎉 3 REAL SEED ACCOUNTS READY FOR IMMEDIATE USE:');
console.log('========================================');
console.log('Demo accounts (roles in Firestore are all "customer"):');
for (const acc of SEED_ACCOUNTS) {
  console.log(`   ${acc.email} / ${SEED_PASSWORD} (${acc.displayName})`);
}
console.log('Privileged roles must be granted by a trusted admin flow, never by this script.');
console.log('========================================\n');

process.exit(0);
