const TIME_ZONE = 'Europe/Berlin';
const TICK_MS = 20_000;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKEND = new Set(['Sat', 'Sun']);

export function berlinNow(date = new Date()) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
    isWeekend: WEEKEND.has(parts.weekday),
  };
}

export function normalizeTime(value, fallback = '06:30') {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function nextRunAt(config, from = new Date()) {
  if (!config.schedule.enabled) return null;

  const target = normalizeTime(config.schedule.time);
  const limit = 8 * 24 * 60;

  for (let minute = 1; minute <= limit; minute += 1) {
    const candidate = new Date(from.getTime() + minute * 60_000);
    const local = berlinNow(candidate);
    if (config.schedule.weekdaysOnly && local.isWeekend) continue;
    if (local.time === target) return candidate;
  }

  return null;
}

export function createScheduler({ getConfig, onRun, logger = console }) {
  let timer = null;
  let lastTriggered = null;
  let running = false;

  async function tick() {
    const config = getConfig();
    if (!config.schedule.enabled) return;

    const now = berlinNow();

    const target = normalizeTime(config.schedule.time);
    if (config.schedule.weekdaysOnly && now.isWeekend) return;
    if (now.time !== target) return;
    if (lastTriggered === now.date) return;

    lastTriggered = now.date;
    if (running) return;
    running = true;

    try {
      logger.log(`[scheduler] Starte geplanten Abruf um ${now.time}`);
      await onRun();
    } catch (err) {
      logger.error(`[scheduler] Abruf fehlgeschlagen: ${err.message}`);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch((err) => logger.error(err.message));
      }, TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    lastTriggered,
    nextRun() {
      return nextRunAt(getConfig());
    },
  };
}
