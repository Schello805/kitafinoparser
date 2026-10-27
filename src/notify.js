function encodeHeader(value) {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function formatShortDate(isoDate) {
  const [, month, day] = isoDate.split('-');
  return `${day}.${month}.`;
}

export function buildNotification(status) {
  const date = formatShortDate(status.date);
  const lowBalanceSuffix =
    status.account?.lowBalance && status.account?.balance
      ? ` (Guthaben niedrig: ${status.account.balance})`
      : '';

  if (!status.isKitaDay) {
    const reason = status.note
      ? `${status.note} (${date}).`
      : `Für heute (${date}) gibt es keinen Kitafino-Essensplan.`;
    return {
      title: 'Kitafino: kein Essensangebot',
      message: reason + lowBalanceSuffix,
      priority: 'default',
      tags: 'calendar',
    };
  }

  if (status.ordered && status.orderedMenu) {
    const menu = status.orderedMenu;
    return {
      title: 'Kitafino: Essen ist bestellt',
      message:
        `Heute (${date}) gibt es: ${menu.name}${menu.price ? ` (${menu.price})` : ''}` +
        lowBalanceSuffix,
      priority: 'default',
      tags: 'white_check_mark,stew',
    };
  }

  const offer = status.menus.find((menu) => menu.available);
  return {
    title: 'Kitafino: KEIN Essen bestellt',
    message:
      `Für heute (${date}) ist kein Essen bestellt!` +
      (offer ? ` Im Angebot wäre: ${offer.name}.` : '') +
      lowBalanceSuffix,
    priority: 'high',
    tags: 'warning,bread',
  };
}

export async function sendNotification(
  { url, token, username, password } = {},
  notification,
) {
  if (!url) throw new Error('Keine ntfy-URL konfiguriert.');

  const headers = {
    Title: encodeHeader(notification.title),
    Priority: notification.priority || 'default',
    Tags: notification.tags || '',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (username || password) {
    const credentials = Buffer.from(
      `${username ?? ''}:${password ?? ''}`,
      'utf8',
    ).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: notification.message,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `ntfy antwortete mit ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  return { ok: true, status: response.status };
}
