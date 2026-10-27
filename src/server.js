import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { runCheck } from './checker.js';
import { loadConfig, saveConfig } from './config.js';
import { sendToHomematic } from './homematic.js';
import { fetchTodayStatus } from './kitafino/orders.js';
import { buildNotification, sendNotification } from './notify.js';
import { createScheduler, berlinNow, nextRunAt, normalizeTime } from './scheduler.js';
import { readState, updateState } from './state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

let config = loadConfig();

const scheduler = createScheduler({
  getConfig: () => config,
  onRun: () => runCheck({ notify: true, config }),
});

function publicConfig() {
  return {
    kitafino: {
      username: config.kitafino.username,
      hasPassword: Boolean(config.kitafino.password),
    },
    ntfy: {
      url: config.ntfy.url,
      username: config.ntfy.username || '',
      hasPassword: Boolean(config.ntfy.password),
      hasToken: Boolean(config.ntfy.token),
    },
    homematic: {
      enabled: Boolean(config.homematic?.enabled),
      host: config.homematic?.host || '',
      variableName: config.homematic?.variableName || 'Kitafino_Essen',
      variableOrdered: config.homematic?.variableOrdered || '',
      speechMode: config.homematic?.speechMode || 'sentence',
    },
    schedule: {
      enabled: config.schedule.enabled,
      time: config.schedule.time,
      weekdaysOnly: config.schedule.weekdaysOnly,
    },
    server: { port: config.server.port },
  };
}

function statePayload() {
  const state = readState();
  const next = nextRunAt(config);
  return {
    ...state,
    now: berlinNow(),
    nextCheck: next ? next.toISOString() : null,
    config: publicConfig(),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload === undefined ? '' : body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Anfrage zu groß'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleSettings(body) {
  const next = structuredClone(config);
  const kitafino = body.kitafino ?? {};
  const ntfy = body.ntfy ?? {};
  const homematic = body.homematic ?? {};
  const schedule = body.schedule ?? {};

  if (typeof kitafino.username === 'string') {
    next.kitafino.username = kitafino.username.trim();
  }
  if (typeof kitafino.password === 'string' && kitafino.password.length > 0) {
    next.kitafino.password = kitafino.password;
  }
  if (kitafino.clearPassword === true) {
    next.kitafino.password = '';
  }

  if (typeof ntfy.url === 'string') {
    if (!isValidHttpUrl(ntfy.url.trim())) {
      return { error: 'Die ntfy-URL muss mit http:// oder https:// beginnen.' };
    }
    next.ntfy.url = ntfy.url.trim();
  }
  if (typeof ntfy.username === 'string') {
    next.ntfy.username = ntfy.username.trim();
  }
  if (typeof ntfy.password === 'string' && ntfy.password.length > 0) {
    next.ntfy.password = ntfy.password;
  }
  if (typeof ntfy.token === 'string' && ntfy.token.length > 0) {
    next.ntfy.token = ntfy.token.trim();
  }
  if (ntfy.clearToken === true) {
    next.ntfy.token = '';
    next.ntfy.password = '';
  }

  if (typeof homematic.enabled === 'boolean') {
    next.homematic.enabled = homematic.enabled;
  }
  if (typeof homematic.host === 'string') {
    next.homematic.host = homematic.host.trim();
  }
  if (typeof homematic.variableName === 'string') {
    next.homematic.variableName = homematic.variableName.trim() || 'Kitafino_Essen';
  }
  if (typeof homematic.variableOrdered === 'string') {
    next.homematic.variableOrdered = homematic.variableOrdered.trim();
  }
  if (typeof homematic.speechMode === 'string') {
    next.homematic.speechMode = homematic.speechMode.trim() === 'menuOnly' ? 'menuOnly' : 'sentence';
  }

  if (typeof schedule.time === 'string') {
    next.schedule.time = normalizeTime(schedule.time, config.schedule.time);
  }
  if (typeof schedule.enabled === 'boolean') next.schedule.enabled = schedule.enabled;
  if (typeof schedule.weekdaysOnly === 'boolean') {
    next.schedule.weekdaysOnly = schedule.weekdaysOnly;
  }

  config = saveConfig(next);
  return { nextCheck: nextRunAt(config)?.toISOString() ?? null };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/state') {
    return sendJson(res, 200, statePayload());
  }

  if (req.method === 'POST' && pathname === '/api/check') {
    const body = await readBody(req).catch(() => ({}));
    const result = await runCheck({ notify: Boolean(body.notify), config });
    const payload = statePayload();
    return sendJson(res, result.ok ? 200 : 502, {
      ...payload,
      error: result.ok ? null : result.error,
    });
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    const body = await readBody(req);
    const result = await handleSettings(body);
    if (result.error) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, { ...statePayload(), ...result });
  }

  if (req.method === 'POST' && pathname === '/api/login-test') {
    const body = await readBody(req).catch(() => ({}));
    const username = body.username?.trim() || config.kitafino.username;
    const password = body.password || config.kitafino.password;

    if (!username || !password) {
      return sendJson(res, 400, {
        error: 'Bitte Benutzername und Passwort für Kitafino angeben.',
      });
    }

    try {
      const status = await fetchTodayStatus({ username, password });
      updateState({
        lastStatus: status,
        lastRun: { at: new Date().toISOString(), ok: true, error: null },
      });
      return sendJson(res, 200, {
        ...statePayload(),
        ok: true,
        account: status.account,
      });
    } catch (err) {
      return sendJson(res, 502, {
        ...statePayload(),
        ok: false,
        error: err.message,
      });
    }
  }

  if (req.method === 'POST' && pathname === '/api/homematic-test') {
    const body = await readBody(req).catch(() => ({}));
    const hmConfig = {
      host: body.host?.trim() || config.homematic?.host,
      variableName: body.variableName?.trim() || config.homematic?.variableName || 'Kitafino_Essen',
      variableOrdered: body.variableOrdered !== undefined ? body.variableOrdered?.trim() : config.homematic?.variableOrdered,
      speechMode: body.speechMode?.trim() || config.homematic?.speechMode || 'sentence',
    };

    if (!hmConfig.host) {
      return sendJson(res, 400, { error: 'Bitte die IP-Adresse oder den Hostnamen deiner Homematic CCU angeben.' });
    }

    const status = readState().lastStatus;
    try {
      const result = await sendToHomematic(hmConfig, status);
      updateState({
        lastHomematic: {
          at: new Date().toISOString(),
          ok: true,
          error: null,
          text: result.text,
          variable: result.variableName,
          test: true,
        },
      });
      return sendJson(res, 200, {
        ...statePayload(),
        ok: true,
        message: `Erfolgreich an Homematic übermittelt: „${result.text}“ in Variable „${result.variableName}“`,
      });
    } catch (err) {
      updateState({
        lastHomematic: {
          at: new Date().toISOString(),
          ok: false,
          error: err.message,
          test: true,
        },
      });
      return sendJson(res, 502, { ...statePayload(), ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/notify-test') {
    const status = readState().lastStatus;
    const notification = status
      ? buildNotification(status)
      : {
          title: 'Kitafino: Test-Nachricht',
          message: 'Die Verbindung zum ntfy-Server funktioniert!',
          priority: 'default',
          tags: 'white_check_mark',
        };
    try {
      await sendNotification(config.ntfy, notification);
      updateState({
        lastNotification: {
          at: new Date().toISOString(),
          ok: true,
          error: null,
          message: notification.message,
          test: true,
        },
      });
      return sendJson(res, 200, statePayload());
    } catch (err) {
      updateState({
        lastNotification: {
          at: new Date().toISOString(),
          ok: false,
          error: err.message,
          message: notification.message,
          test: true,
        },
      });
      return sendJson(res, 502, { ...statePayload(), error: err.message });
    }
  }

  return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);

  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403);
    return res.end('Verboten');
  }

  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    await serveStatic(res, pathname);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

const { port, host } = config.server;
server.listen(port, host, () => {
  console.log(`Kitafino-Wächter läuft auf http://localhost:${port}`);
  console.log(
    `${config.schedule.enabled ? `Nächster Abruf: ${nextRunAt(config)?.toLocaleString('de-DE') ?? '–'} (${config.schedule.weekdaysOnly ? 'Mo–Fr' : 'täglich'})` : 'Automatischer Abruf ist deaktiviert.'}`,
  );
  scheduler.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nBeende Server.');
    server.close(() => process.exit(0));
  });
}
