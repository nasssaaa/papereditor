import { getConfig } from './config.js';
import { Store } from './store.js';
const [username, displayName] = process.argv.slice(2),
  password = process.env.PAPEREDITOR_ADMIN_PASSWORD;
if (!username || !password || password.length < 10)
  throw new Error(
    'Usage: PAPEREDITOR_ADMIN_PASSWORD=... npm run admin -- username displayName (password: at least 10 characters)',
  );
const store = new Store(getConfig());
store.addUser(username, displayName || username, password, true);
store.close();
console.log('Administrator created.');
