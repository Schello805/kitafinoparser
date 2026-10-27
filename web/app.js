const $ = (id) => document.getElementById(id);

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

let state = null;
let settingsDirty = false;
let initialCheckDone = false;

const UserInvalidFallback = (() => {
  const dirtyState = new WeakMap();

  const updateState = (input) => {
    const isValid = input.checkValidity();
    input.classList.toggle('user-invalid-fallback', !isValid);
    input.classList.toggle('user-valid-fallback', isValid);
    if (!isValid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  };

  const handleEvent = (event) => {
    const input = event.target;
    if (event.type === 'reset') {
      const controls = input.elements || [];
      for (const control of controls) {
        dirtyState.delete(control);
        control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
        control.removeAttribute('aria-invalid');
      }
      return;
    }

    if (!input?.checkValidity) return;

    if (event.type === 'input' || event.type === 'change') {
      const current = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      current.hasInteracted = true;
      dirtyState.set(input, current);
      if (current.hasBlurred) updateState(input);
    } else if (event.type === 'blur') {
      const current = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      current.hasBlurred = true;
      dirtyState.set(input, current);
      if (current.hasInteracted) updateState(input);
    }
  };

  const init = (root = document) => {
    if (CSS.supports('selector(:user-invalid)')) return;
    root.addEventListener('blur', handleEvent, true);
    root.addEventListener('input', handleEvent);
    root.addEventListener('change', handleEvent);
    root.addEventListener('reset', handleEvent, true);
  };

  return { init };
})();

const syncAria = (el) => {
  if (!el?.matches || !el.checkValidity) return;
  el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
};

document.addEventListener('blur', (e) => syncAria(e.target), true);
document.addEventListener('input', (e) => {
  if (e.target?.hasAttribute?.('aria-invalid')) syncAria(e.target);
});

async function api(path, body) {
  const options = body
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    : {};

  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function timeOf(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dateTimeOf(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function dayAndMonth(isoDate) {
  if (!isoDate) return '';
  const [, month, day] = isoDate.split('-');
  return `${day}.${month}.`;
}

function weekdayShortOf(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return WEEKDAYS_SHORT[date.getUTCDay()];
}

function weekdayFullOf(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return WEEKDAYS[date.getUTCDay()];
}

function showBanner(message, tone = 'error') {
  const banner = $('banner');
  banner.hidden = !message;
  banner.dataset.tone = tone;
  banner.textContent = message ?? '';
}

function setSettingsOpen(open, scrollIntoView = false) {
  const form = $('settings');
  form.hidden = !open;
  $('toggle-settings').textContent = open ? 'Schließen' : 'Öffnen';
  $('toggle-settings').setAttribute('aria-expanded', String(open));
  $('open-settings-top').setAttribute('aria-expanded', String(open));
  if (open && scrollIntoView) {
    $('settings-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderAccount() {
  const account = state?.lastStatus?.account;
  const bar = $('account-bar');
  const childEl = $('account-child');
  const facilityEl = $('account-facility');
  const balanceEl = $('account-balance');

  if (!account || (!account.childName && !account.facility && !account.balance)) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  if (account.childName) {
    childEl.hidden = false;
    childEl.textContent = account.childName;
  } else {
    childEl.hidden = true;
  }

  if (account.facility) {
    facilityEl.hidden = false;
    facilityEl.textContent = account.facility;
  } else {
    facilityEl.hidden = true;
  }

  if (account.balance) {
    balanceEl.hidden = false;
    balanceEl.dataset.warn = String(Boolean(account.lowBalance));
    balanceEl.textContent = account.lowBalance
      ? `Guthaben: ${account.balance} (niedrig)`
      : `Guthaben: ${account.balance}`;
    balanceEl.title = account.lowBalanceWarning || 'Aktuelles Kitafino-Guthaben';
  } else {
    balanceEl.hidden = true;
  }
}

function renderStatus() {
  const card = $('status');
  const status = state?.lastStatus;
  const run = state?.lastRun;
  const deadlinesEl = $('status-deadlines');

  $('status-date').textContent = status?.date
    ? `${weekdayFullOf(status.date)}, ${shortDate(status.date)}`
    : '';

  if (!status) {
    card.dataset.state = 'closed';
    $('status-chip').textContent = 'Keine Daten';
    $('status-headline').textContent = 'Noch nicht abgefragt';
    $('status-menu').textContent =
      'Klicke auf „Jetzt prüfen“, um die heutige Bestellung abzurufen.';
    deadlinesEl.hidden = true;
    $('status-meta').textContent = '';
    return;
  }

  if (status.isKitaDay === false) {
    card.dataset.state = 'closed';
    $('status-chip').textContent = 'ℹ Kein Essensangebot';
    $('status-headline').textContent = status.note || 'Heute kein Essensplan';
    $('status-menu').textContent =
      'Für heute führt Kitafino kein Essensangebot (z. B. schulfreier Tag oder freitags kein Angebot).';
  } else if (status.ordered && status.orderedMenu) {
    card.dataset.state = 'ordered';
    $('status-chip').textContent = '✓ Essen ist bestellt';
    $('status-headline').textContent = 'Essen ist bestellt!';
    const menuPrefix = status.orderedMenu.number
      ? `Menü ${status.orderedMenu.number}: `
      : '';
    const priceSuffix = status.orderedMenu.price ? ` · ${status.orderedMenu.price}` : '';
    $('status-menu').textContent = menuPrefix + status.orderedMenu.name + priceSuffix;
  } else {
    card.dataset.state = 'missing';
    $('status-chip').textContent = '⚠ Nicht bestellt';
    $('status-headline').textContent = 'Heute KEIN Essen bestellt!';
    const offer = (status.menus || []).find((menu) => menu.available);
    $('status-menu').textContent = offer
      ? `Im Angebot wäre: ${offer.name}${offer.price ? ` · ${offer.price}` : ''}`
      : 'Für heute ist kein Menü ausgewählt.';
  }

  const deadlines = status.day?.deadlines ?? [];
  if (deadlines.length > 0) {
    deadlinesEl.hidden = false;
    deadlinesEl.innerHTML = '';
    for (const d of deadlines) {
      const tag = document.createElement('span');
      tag.className = 'deadline-tag';
      tag.textContent = d;
      deadlinesEl.append(tag);
    }
  } else {
    deadlinesEl.hidden = true;
  }

  const parts = [`Zuletzt aktualisiert: ${timeOf(status.checkedAt)} Uhr`];
  if (run && run.ok === false) {
    parts.push(`Letzter Abruf fehlgeschlagen (${run.error || 'Fehler'})`);
  }
  $('status-meta').textContent = parts.join(' · ');
}

function renderWeek() {
  const list = $('week');
  const summary = $('week-summary');
  list.textContent = '';
  const week = state?.lastStatus?.week ?? [];
  const todayIso = state?.now?.date || state?.lastStatus?.date;

  if (!week.length) {
    summary.textContent = '';
    const empty = document.createElement('li');
    empty.className = 'week-item';
    empty.textContent = 'Noch keine Wochendaten vorhanden. Klicke auf „Jetzt prüfen“.';
    list.append(empty);
    return;
  }

  const orderedCount = week.filter((d) => d.ordered).length;
  const offerCount = week.filter((d) => d.hasOffer !== false).length;
  summary.textContent = `${orderedCount} von ${offerCount} Tagen bestellt`;

  for (const day of week) {
    const item = document.createElement('li');
    const isToday = day.date === todayIso || Boolean(day.isToday);
    const hasOffer = day.hasOffer !== false;
    const dayState = !hasOffer ? 'closed' : day.ordered ? 'ordered' : 'missing';

    item.className = 'week-item';
    item.dataset.state = dayState;
    item.dataset.today = String(isToday);

    // Left Date Column
    const dateCol = document.createElement('div');
    dateCol.className = 'week-date-col';

    const dayRow = document.createElement('div');
    dayRow.className = 'week-day-row';

    const dayName = document.createElement('span');
    dayName.className = 'week-day-name';
    dayName.textContent = weekdayShortOf(day.date);
    dayRow.append(dayName);

    if (isToday) {
      const todayTag = document.createElement('span');
      todayTag.className = 'today-tag';
      todayTag.textContent = 'Heute';
      dayRow.append(todayTag);
    }

    const dateNum = document.createElement('span');
    dateNum.className = 'week-date-num';
    dateNum.textContent = dayAndMonth(day.date);

    dateCol.append(dayRow, dateNum);

    // Center Menu Column
    const menuCol = document.createElement('div');
    menuCol.className = 'week-menu-col';

    const menuTitle = document.createElement('div');
    menuTitle.className = 'week-menu-title';

    if (!hasOffer) {
      menuTitle.textContent = day.note || 'Kein Essensangebot';
      menuCol.append(menuTitle);
    } else if (day.ordered && day.orderedMenu) {
      menuTitle.textContent = day.orderedMenu.name;
      menuCol.append(menuTitle);
      if (day.orderedMenu.price) {
        const menuPrice = document.createElement('div');
        menuPrice.className = 'week-menu-price';
        menuPrice.textContent = day.orderedMenu.price;
        menuCol.append(menuPrice);
      }
    } else {
      const firstOffer = (day.menus || []).find((m) => m.available);
      menuTitle.textContent = firstOffer
        ? `Nicht bestellt (Angebot: ${firstOffer.name})`
        : 'Kein Essen bestellt';
      menuCol.append(menuTitle);
      if (firstOffer?.price) {
        const menuPrice = document.createElement('div');
        menuPrice.className = 'week-menu-price';
        menuPrice.textContent = firstOffer.price;
        menuCol.append(menuPrice);
      }
    }

    // Right Badge
    const badge = document.createElement('span');
    badge.className = 'week-badge';
    badge.dataset.state = dayState;

    if (!hasOffer) {
      badge.textContent = '– Kein Angebot';
    } else if (day.ordered) {
      badge.textContent = '✓ Bestellt';
    } else {
      badge.textContent = '✗ Offen';
    }

    item.append(dateCol, menuCol, badge);
    list.append(item);
  }
}

function renderSettings() {
  const config = state?.config;
  if (!config) return;

  const hasKitafinoCreds = Boolean(config.kitafino.username && config.kitafino.hasPassword);
  const kitafinoBadge = $('kitafino-cred-badge');
  kitafinoBadge.dataset.ok = String(hasKitafinoCreds);
  kitafinoBadge.textContent = hasKitafinoCreds ? '✓ Gespeichert' : 'Fehlt noch';

  const hasNtfyAuth = Boolean(config.ntfy.hasToken || config.ntfy.hasPassword);
  const ntfyBadge = $('ntfy-cred-badge');
  ntfyBadge.dataset.ok = String(Boolean(config.ntfy.url));
  ntfyBadge.textContent = hasNtfyAuth
    ? '✓ Gespeichert (+ Auth)'
    : config.ntfy.url
      ? '✓ URL gespeichert'
      : 'Fehlt noch';

  const hmBadge = $('homematic-badge');
  const hmEnabled = Boolean(config.homematic?.enabled && config.homematic?.host);
  hmBadge.dataset.ok = String(hmEnabled);
  hmBadge.textContent = hmEnabled ? '✓ Aktiviert' : 'Inaktiv';

  if (!initialCheckDone) {
    initialCheckDone = true;
    if (!hasKitafinoCreds) {
      setSettingsOpen(true, false);
    }
  }

  if (!settingsDirty) {
    $('username').value = config.kitafino.username ?? '';
    $('ntfy-url').value = config.ntfy.url ?? '';
    $('ntfy-username').value = config.ntfy.username ?? '';
    $('schedule-time').value = config.schedule.time ?? '06:30';
    $('weekdays-only').checked = Boolean(config.schedule.weekdaysOnly);
    $('schedule-enabled').checked = Boolean(config.schedule.enabled);
    $('password').value = '';
    $('ntfy-token').value = '';
    $('ntfy-password').value = '';
    $('clear-token').checked = false;
    $('password').placeholder = config.kitafino.hasPassword
      ? '•••••••• (gespeichert – leer lassen zum Behalten)'
      : 'Kitafino-Passwort eintragen';
    $('ntfy-token').placeholder = config.ntfy.hasToken
      ? '•••••••• (Token gespeichert – leer lassen zum Behalten)'
      : 'Kein Token gesetzt';
    $('ntfy-password').placeholder = config.ntfy.hasPassword
      ? '•••••••• (gespeichert)'
      : 'Optional bei Basic-Auth';

    // Homematic fields
    $('homematic-enabled').checked = Boolean(config.homematic?.enabled);
    $('homematic-host').value = config.homematic?.host ?? '';
    $('homematic-var').value = config.homematic?.variableName || 'Kitafino_Essen';
    $('homematic-var-bool').value = config.homematic?.variableOrdered ?? '';
    $('homematic-speech-mode').value = config.homematic?.speechMode || 'sentence';
  }

  const info = [
    config.schedule.enabled
      ? `Nächster automatischer Abruf: ${dateTimeOf(state.nextCheck)}`
      : 'Automatischer Abruf deaktiviert',
    config.schedule.weekdaysOnly ? 'Mo–Fr' : 'Täglich',
    `ntfy: ${config.ntfy.url ? 'aktiv' : 'keine URL'}`,
    `Homematic: ${config.homematic?.enabled ? (config.homematic?.host || 'aktiv') : 'deaktiviert'}`,
  ];
  $('schedule-info').textContent = info.join(' · ');

  const notification = state.lastNotification;
  if (!notification) {
    $('notify-state').textContent = '';
  } else if (notification.ok) {
    $('notify-state').textContent =
      `Letzte ntfy-Nachricht: ${timeOf(notification.at)} Uhr` +
      (notification.test ? ' (Test)' : '') +
      (notification.message ? `: „${notification.message}“` : '');
  } else {
    $('notify-state').textContent = `ntfy-Nachricht fehlgeschlagen: ${notification.error}`;
  }

  const hmState = state.lastHomematic;
  if (!hmState) {
    $('homematic-state').textContent = '';
  } else if (hmState.ok) {
    $('homematic-state').textContent =
      `Homematic aktualisiert: ${timeOf(hmState.at)} Uhr` +
      (hmState.test ? ' (Test)' : '') +
      (hmState.text ? ` → „${hmState.text}“ (${hmState.variable || 'Variable'})` : '');
  } else {
    $('homematic-state').textContent = `Homematic-Fehler: ${hmState.error}`;
  }
}

function render() {
  renderAccount();
  renderStatus();
  renderWeek();
  renderSettings();
}

async function loadState() {
  const { data } = await api('/api/state');
  state = data;
  render();
}

function bindPasswordToggle(buttonId, inputId, labelShow, labelHide) {
  const btn = $(buttonId);
  const input = $(inputId);
  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-pressed', String(!showing));
    btn.setAttribute('aria-label', showing ? labelShow : labelHide);
    btn.textContent = showing ? 'Anzeigen' : 'Verbergen';
  });
}

bindPasswordToggle('toggle-password', 'password', 'Passwort anzeigen', 'Passwort verbergen');
bindPasswordToggle('toggle-token', 'ntfy-token', 'Token anzeigen', 'Token verbergen');

async function triggerCheck({ notify = false, button }) {
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.textContent = notify ? 'Prüfe & sende …' : 'Prüfe …';
  showBanner(null);

  try {
    const { ok, data } = await api('/api/check', { notify });
    state = data;
    render();
    if (!ok) {
      showBanner(data.error || 'Abruf fehlgeschlagen.');
    } else {
      let msg = 'Essen erfolgreich von Kitafino abgerufen.';
      if (notify) msg += ' Nachricht an ntfy gesendet.';
      if (data.config?.homematic?.enabled) msg += ' Homematic-Variable aktualisiert.';
      showBanner(msg, 'ok');
    }
  } catch (err) {
    showBanner(err.message);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
}

$('check').addEventListener('click', () => {
  triggerCheck({ notify: false, button: $('check') });
});

$('check-notify').addEventListener('click', () => {
  triggerCheck({ notify: true, button: $('check-notify') });
});

$('test').addEventListener('click', async () => {
  const button = $('test');
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Sende …';
  showBanner(null);

  try {
    const { ok, data } = await api('/api/notify-test');
    state = data;
    render();
    if (!ok) {
      showBanner(data.error || 'Test-Nachricht an ntfy fehlgeschlagen.');
    } else {
      showBanner('Test-Nachricht wurde an den ntfy-Server gesendet.', 'ok');
    }
  } catch (err) {
    showBanner(err.message);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

$('test-homematic').addEventListener('click', async () => {
  const btn = $('test-homematic');
  const msg = $('homematic-test-msg');
  btn.disabled = true;
  btn.textContent = 'Übermittle …';
  msg.textContent = '';
  msg.dataset.tone = '';

  try {
    const { ok, data } = await api('/api/homematic-test', {
      host: $('homematic-host').value,
      variableName: $('homematic-var').value,
      variableOrdered: $('homematic-var-bool').value,
      speechMode: $('homematic-speech-mode').value,
    });
    if (data?.config) {
      state = data;
      render();
    }
    if (ok) {
      msg.textContent = data.message || '✓ Variable in Homematic erfolgreich aktualisiert.';
      msg.dataset.tone = 'ok';
    } else {
      msg.textContent = data.error || 'Homematic-Verbindung fehlgeschlagen.';
      msg.dataset.tone = 'error';
    }
  } catch (err) {
    msg.textContent = err.message;
    msg.dataset.tone = 'error';
  } finally {
    btn.disabled = false;
    btn.textContent = '📢 Homematic testen';
  }
});

$('refresh').addEventListener('click', () => {
  loadState().catch((err) => showBanner(err.message));
});

$('toggle-settings').addEventListener('click', () => {
  const form = $('settings');
  setSettingsOpen(form.hidden, false);
});

$('open-settings-top').addEventListener('click', () => {
  const form = $('settings');
  setSettingsOpen(form.hidden, form.hidden);
});

$('test-login').addEventListener('click', async () => {
  const btn = $('test-login');
  const msg = $('login-test-msg');
  btn.disabled = true;
  btn.textContent = 'Teste Login …';
  msg.textContent = '';
  msg.dataset.tone = '';

  try {
    const { ok, data } = await api('/api/login-test', {
      username: $('username').value,
      password: $('password').value,
    });
    if (data?.config) {
      state = data;
      render();
    }
    if (ok) {
      const child = data.account?.childName || 'Konto';
      const bal = data.account?.balance ? `, Guthaben: ${data.account.balance}` : '';
      msg.textContent = `✓ Login erfolgreich (${child}${bal})`;
      msg.dataset.tone = 'ok';
    } else {
      msg.textContent = data.error || 'Login fehlgeschlagen.';
      msg.dataset.tone = 'error';
    }
  } catch (err) {
    msg.textContent = err.message;
    msg.dataset.tone = 'error';
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Login testen';
  }
});

$('settings').addEventListener('input', () => {
  settingsDirty = true;
  $('settings-msg').textContent = '';
});

$('settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = $('settings');
  if (!form.checkValidity()) {
    const firstInvalid = form.querySelector(':invalid');
    if (firstInvalid) {
      firstInvalid.classList.add('user-invalid-fallback');
      firstInvalid.setAttribute('aria-invalid', 'true');
      firstInvalid.focus();
    }
    return;
  }

  const saveBtn = $('save-settings');
  const message = $('settings-msg');
  saveBtn.disabled = true;
  message.textContent = 'Speichere …';
  message.dataset.tone = '';

  try {
    const { ok, data } = await api('/api/settings', {
      kitafino: {
        username: $('username').value,
        password: $('password').value,
      },
      ntfy: {
        url: $('ntfy-url').value,
        token: $('ntfy-token').value,
        username: $('ntfy-username').value,
        password: $('ntfy-password').value,
        clearToken: $('clear-token').checked,
      },
      homematic: {
        enabled: $('homematic-enabled').checked,
        host: $('homematic-host').value,
        variableName: $('homematic-var').value,
        variableOrdered: $('homematic-var-bool').value,
        speechMode: $('homematic-speech-mode').value,
      },
      schedule: {
        time: $('schedule-time').value,
        weekdaysOnly: $('weekdays-only').checked,
        enabled: $('schedule-enabled').checked,
      },
    });

    if (ok) {
      state = data;
      settingsDirty = false;
      render();
      message.textContent = '✓ Einstellungen gespeichert.';
      message.dataset.tone = 'ok';
    } else {
      message.textContent = data.error || 'Speichern fehlgeschlagen.';
      message.dataset.tone = 'error';
    }
  } catch (err) {
    message.textContent = err.message;
    message.dataset.tone = 'error';
  } finally {
    saveBtn.disabled = false;
  }
});

UserInvalidFallback.init($('settings'));
loadState().catch((err) => showBanner(err.message));
