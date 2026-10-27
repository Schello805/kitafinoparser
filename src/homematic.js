function cleanSpeechText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/€\s*[\d.,]+/g, '')
    .replace(/\(\s*dessert:\s*([^)]+)\)/i, ', als Dessert $1')
    .replace(/\s*-\s*$/, '')
    .trim();
}

function firstNameOf(account) {
  const name = account?.childName?.trim();
  if (!name) return 'Deine Tochter';
  return name.split(/\s+/)[0];
}

export function buildHomematicSpeechText(status, mode = 'sentence') {
  if (!status) return 'Es liegen noch keine Daten von Kitafino vor.';

  const child = firstNameOf(status.account);
  const orderedMenu = status.orderedMenu;
  const menuName = orderedMenu ? cleanSpeechText(orderedMenu.name) : '';

  if (mode === 'menuOnly') {
    if (!status.isKitaDay) return status.note || 'Kein Essensangebot';
    if (status.ordered && menuName) return menuName;
    return 'Kein Essen bestellt';
  }

  // mode === 'sentence' (Optimiert für Sprachausgabe auf Alexa)
  if (!status.isKitaDay) {
    if (status.note) return `Heute gibt es bei Kitafino kein Essensangebot: ${status.note}.`;
    return 'Heute gibt es bei Kitafino kein Essensangebot.';
  }

  if (status.ordered && menuName) {
    return `${child} hat heute Essen bestellt: ${menuName}.`;
  }

  const offer = (status.menus || []).find((m) => m.available);
  const offerName = offer ? cleanSpeechText(offer.name) : '';
  if (offerName) {
    return `Achtung: Für ${child} ist heute kein Essen bestellt! Im Angebot wäre ${offerName}.`;
  }

  return `Achtung: Für ${child} ist heute kein Essen bestellt.`;
}

export function normalizeCcuUrl(rawHost) {
  let host = String(rawHost ?? '').trim();
  if (!host) throw new Error('Keine Homematic-IP oder Hostname angegeben.');

  if (!/^https?:\/\//i.test(host)) {
    // If no protocol, check if port is included
    if (/:[0-9]+/.test(host)) {
      host = `http://${host}`;
    } else {
      host = `http://${host}:8181`;
    }
  }

  const url = new URL(host);
  if (!url.port && url.protocol === 'http:') {
    url.port = '8181';
  }
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/rega.exe';
  }
  return url;
}

function escapeRegaString(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ');
}

export async function sendToHomematic({
  host,
  variableName = 'Kitafino_Essen',
  variableOrdered = '',
  speechMode = 'sentence',
} = {}, status) {
  if (!host) throw new Error('Homematic Host/IP nicht konfiguriert.');
  if (!variableName) throw new Error('Name der Homematic-Systemvariable fehlt.');

  const text = buildHomematicSpeechText(status, speechMode);
  const escapedText = escapeRegaString(text);
  const escapedVarName = escapeRegaString(variableName.trim());
  const isOrdered = Boolean(status?.ordered);

  let script = `object sv = dom.GetObject(ID_SYSTEM_VARIABLES).Get("${escapedVarName}");\n`;
  script += `if (sv) { sv.State("${escapedText}"); }\n`;

  if (variableOrdered && variableOrdered.trim()) {
    const escapedVarBool = escapeRegaString(variableOrdered.trim());
    script += `object svB = dom.GetObject(ID_SYSTEM_VARIABLES).Get("${escapedVarBool}");\n`;
    script += `if (svB) { svB.State(${isOrdered ? 'true' : 'false'}); }\n`;
  }

  script += `Write("<ok>");`;

  const endpoint = normalizeCcuUrl(host);

  // CCU ReGaHss expects ISO-8859-1 (latin1) to handle German umlauts properly
  const bodyBuffer = Buffer.from(script, 'latin1');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(endpoint.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=ISO-8859-1',
        'Content-Length': String(bodyBuffer.length),
      },
      body: bodyBuffer,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Homematic CCU antwortete mit HTTP ${res.status}`);
    }

    const answer = await res.text();
    if (!answer.includes('<ok>')) {
      throw new Error(`Homematic Script-Antwort unerwartet: ${answer.slice(0, 150)}`);
    }

    return {
      ok: true,
      text,
      variableName,
      variableOrdered: variableOrdered || null,
      ordered: isOrdered,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Zeitüberschreitung bei Verbindung zu Homematic (${endpoint.hostname})`);
    }
    throw new Error(`Homematic-Fehler: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
