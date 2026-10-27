import fs from 'node:fs';
import path from 'node:path';

const STATE_PATH = path.resolve(import.meta.dirname, '..', 'data', 'state.json');

const EMPTY = {
  lastStatus: null,
  lastRun: null,
  lastNotification: null,
  lastHomematic: null,
};

function sanitizeState(raw) {
  const state = { ...EMPTY, ...(raw ?? {}) };
  if (state.lastStatus && typeof state.lastStatus === 'object') {
    const { dashboardHtml: _unused, ...cleanStatus } = state.lastStatus;
    state.lastStatus = cleanStatus;
  }
  return state;
}

export function readState() {
  try {
    return sanitizeState(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')));
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeState(state) {
  const clean = sanitizeState(state);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

export function updateState(patch) {
  return writeState({ ...readState(), ...patch });
}
