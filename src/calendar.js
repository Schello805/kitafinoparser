function escapeIcsText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

function toIcsDate(isoDate) {
  return String(isoDate).replace(/-/g, '');
}

function nextIcsDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}${nm}${nd}`;
}

export function generateCalendarIcs(status) {
  const child = status?.account?.childName || 'Tochter';
  const facility = status?.account?.facility || '';
  const week = status?.week || [];
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kitafino Waechter//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`Kitafino Essen (${child})`)}`,
    `X-WR-CALDESC:${escapeIcsText(`Kitafino Essensplan für ${child}${facility ? ` (${facility})` : ''}`)}`,
    'X-WR-TIMEZONE:Europe/Berlin',
  ];

  for (const day of week) {
    const dtstart = toIcsDate(day.date);
    const dtend = nextIcsDate(day.date);
    const uid = `kitafino-${dtstart}-${status?.account?.customerId || 'child'}@waechter`;

    let summary = '';
    let descriptionLines = [];

    if (day.hasOffer === false) {
      summary = `ℹ️ Kitafino: ${day.note || 'Kein Angebot'}`;
      descriptionLines.push(`Heute gibt es kein Essensangebot bei Kitafino.`);
      if (day.note) descriptionLines.push(`Hinweis: ${day.note}`);
    } else if (day.ordered && day.orderedMenu) {
      const menuPrefix = day.orderedMenu.number ? `Menü ${day.orderedMenu.number}: ` : '';
      summary = `🍱 Kitafino: ${day.orderedMenu.name}`;
      descriptionLines.push(`Essen ist bestellt: ${menuPrefix}${day.orderedMenu.name}`);
      if (day.orderedMenu.price) descriptionLines.push(`Preis: ${day.orderedMenu.price}`);
    } else {
      summary = `❌ Kitafino: KEIN Essen bestellt!`;
      descriptionLines.push(`Für diesen Tag ist bisher kein Essen bestellt!`);
      const firstOffer = (day.menus || []).find((m) => m.available);
      if (firstOffer) {
        descriptionLines.push(`Im Angebot wäre: ${firstOffer.name}${firstOffer.price ? ` (${firstOffer.price})` : ''}`);
      }
    }

    if (day.deadlines && day.deadlines.length > 0) {
      descriptionLines.push(`Fristen: ${day.deadlines.join(' | ')}`);
    }

    if (status?.account?.balance) {
      descriptionLines.push(`Aktuelles Guthaben: ${status.account.balance}`);
    }

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${uid}`);
    ics.push(`DTSTAMP:${dtstamp}`);
    ics.push(`DTSTART;VALUE=DATE:${dtstart}`);
    ics.push(`DTEND;VALUE=DATE:${dtend}`);
    ics.push(`SUMMARY:${escapeIcsText(summary)}`);
    ics.push(`DESCRIPTION:${escapeIcsText(descriptionLines.join('\n'))}`);
    ics.push(`STATUS:${day.ordered ? 'CONFIRMED' : 'TENTATIVE'}`);
    ics.push('TRANSP:TRANSPARENT'); // shows as free so it doesn't block work schedules
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');
  return ics.join('\r\n') + '\r\n';
}
