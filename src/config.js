import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

export const CONFIG_PATH =
  process.env.KITAFINO_CONFIG || path.join(ROOT, 'config', 'config.json');

export const DEBUG_DIR = path.join(ROOT, 'debug');

export const DEFAULTS = {
  kitafino: {
    username: '',
    password: '',
    projectId: '',
  },
  ntfy: {
    url: 'https://ntfy.schellenberger.biz/kitafino',
    token: '',
    username: '',
    password: '',
  },
  homematic: {
    enabled: false,
    host: '',
    variableName: 'Kitafino_Essen',
    variableOrdered: '',
    speechMode: 'sentence',
  },
  balanceWatch: {
    enabled: true,
    threshold: 10.0,
    notifyNtfy: true,
    homematicVariable: 'Kitafino_Guthaben_Warnung',
    homematicBalanceVar: '',
  },
  schedule: {
    enabled: true,
    time: '06:30',
    weekdaysOnly: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3010,
  },
};

function merge(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = merge(target[key] ?? {}, value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return merge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(DEFAULTS);
    throw new Error(`config.json ist nicht lesbar: ${err.message}`);
  }
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  return config;
}
