import * as cheerio from 'cheerio';

import { createClient } from './http.js';

export const ENTRY_URL = 'https://www.kitafino.de/sys_k2/index.php';
export const AUTH_LOGIN_URL = 'https://auth.kitafino.de/sys_k2/index.php?action=login';

const USERNAME_FIELD = /^(benutzername|username|user|login|email|e_mail|mail)$/i;
const PASSWORD_FIELD = /^(passwort|password|pass|pwd)$/i;

const LOGIN_ERROR_HINTS = [
  'benutzername oder passwort',
  'passwort falsch',
  'falsche zugangsdaten',
  'ungültige zugangsdaten',
  'login fehlgeschlagen',
  'anmeldung fehlgeschlagen',
];

export function readLoginForm(html, pageUrl) {
  const $ = cheerio.load(html);
  const $form = $('form')
    .filter((_, el) => $(el).find('input[type="password"]').length > 0)
    .first();

  if (!$form.length) return null;

  const action = new URL($form.attr('action') || pageUrl.href, pageUrl).href;
  const fields = [];
  let usernameName = null;
  let passwordName = null;

  $form.find('input[name]').each((_, el) => {
    const name = $(el).attr('name');
    const type = ($(el).attr('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'file') return;

    if (type === 'password') passwordName = name;
    else if (type === 'text' && USERNAME_FIELD.test(name)) usernameName = name;

    const checked = $(el).is('[checked]');
    if (type === 'checkbox' || type === 'radio') {
      if (checked) fields.push({ name, value: $(el).attr('value') ?? '1' });
      return;
    }

    fields.push({ name, value: $(el).attr('value') ?? '' });
  });

  if (!usernameName) {
    const fallback = fields.find((f) => USERNAME_FIELD.test(f.name));
    usernameName = fallback ? fallback.name : 'benutzername';
  }

  return {
    action,
    enctype: ($form.attr('enctype') || '').toLowerCase(),
    method: ($form.attr('method') || 'post').toUpperCase(),
    usernameName,
    passwordName: passwordName || 'passwort',
    fields,
    rememberMeName: fields.some((f) => /^rememberme$/i.test(f.name))
      ? 'rememberme'
      : null,
  };
}

export function looksLikeLoginPage(html) {
  const $ = cheerio.load(html);
  return $('input[type="password"]').length > 0;
}

export function findLoginError(html) {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ').toLowerCase();
  const hint = LOGIN_ERROR_HINTS.find((h) => text.includes(h));
  if (!hint) return null;

  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.includes(hint));
  return (sentence || hint).trim();
}

export async function login({ username, password, client, rememberMe = true } = {}) {
  const http = client || createClient();

  const start = await http.get(ENTRY_URL);
  const form = readLoginForm(start.text(), start.url);

  if (!form) {
    throw new Error(
      'Auf der Kitafino-Startseite wurde kein Login-Formular gefunden. ' +
        'Vermutlich hat sich die Seite geändert.',
    );
  }
  if (form.method !== 'POST') {
    throw new Error(`Unerwartete Login-Methode: ${form.method}`);
  }

  const body = new FormData();
  for (const field of form.fields) {
    if (form.rememberMeName && field.name === form.rememberMeName) continue;
    body.append(field.name, field.value);
  }
  body.set(form.usernameName, username);
  body.set(form.passwordName, password);
  if (form.rememberMeName && rememberMe) body.append(form.rememberMeName, '1');

  const response = await http.postForm(form.action, body, {
    referer: start.url.href,
  });

  const html = response.text();
  const backAtLogin = /action=login/i.test(response.pathAndQuery);
  const stillHasForm = looksLikeLoginPage(html);
  const error = findLoginError(html);
  const ok = !backAtLogin && !stillHasForm;

  return {
    ok,
    client: http,
    form,
    start,
    response,
    error: ok ? null : error || 'Kitafino leitet zurück auf die Login-Seite.',
  };
}
