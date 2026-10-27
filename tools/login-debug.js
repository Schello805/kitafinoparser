#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, DEBUG_DIR, loadConfig } from '../src/config.js';
import { createClient } from '../src/kitafino/http.js';
import { login } from '../src/kitafino/login.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user') args.user = argv[++i];
    else if (arg === '--pass') args.pass = argv[++i];
  }
  return args;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function saveDump(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return path.relative(process.cwd(), file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const username = args.user || config.kitafino.username;
  const password = args.pass || config.kitafino.password;

  console.log('Kitafino Login-Check');
  console.log('Konfiguration:', path.relative(process.cwd(), CONFIG_PATH));

  if (!username || !password) {
    console.error(
      '\nFehlende Zugangsdaten. Trage sie in config/config.json ein\n' +
        'und starte danach erneut:  npm run check-login\n',
    );
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(DEBUG_DIR, stamp());
  fs.mkdirSync(outDir, { recursive: true });

  const client = createClient();
  let result;

  try {
    result = await login({ username, password, client });
  } catch (err) {
    console.error('\nFehler beim Login:', err.message);
    process.exitCode = 1;
    return;
  }

  console.log('\nAbgelaufene Schritte:');
  client.hops.forEach((hop, index) => {
    console.log(`  ${index + 1}. ${hop.status} ${hop.method} ${hop.url}`);
    if (hop.location) console.log(`     -> ${hop.location}`);
  });

  const files = [
    saveDump(outDir, '01-start.html', result.start.text()),
    saveDump(outDir, '02-nach-login.html', result.response.text()),
  ];

  console.log('\nFormular:');
  console.log(`  action:   ${result.form.action}`);
  console.log(`  enctype:  ${result.form.enctype || '(kein enctype)'}`);
  console.log(`  Benutzer: ${result.form.usernameName}`);
  console.log(`  Passwort: ${result.form.passwordName}`);
  console.log(
    `  Cookies:  ${client.jar.list().map((c) => c.name).join(', ') || '(keine)'}`,
  );
  console.log('\nHTML-Dumps:');
  files.forEach((file) => console.log(`  ${file}`));

  if (result.ok) {
    console.log('\nERGEBNIS: Login erfolgreich.');
    console.log('Die Session-Cookies bleiben im Client und können für die Bestellseite genutzt werden.');
  } else {
    console.log('\nERGEBNIS: Login fehlgeschlagen.');
    console.log(`Grund: ${result.error}`);
    console.log(
      '\nPrüfe Benutzername/Passwort (die Webseite nutzt dieselben Daten wie die Kitafino-App).',
    );
    process.exitCode = 2;
  }
}

await main();
