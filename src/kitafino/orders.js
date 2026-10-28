import * as cheerio from 'cheerio';

import { login } from './login.js';

const DATE_PATTERN = /(\d{2})\.(\d{2})\.(\d{4})/;
const PRICE_PATTERN = /€\s*[\d.,]+/g;
const GERMAN_TIME_ZONE = 'Europe/Berlin';

const REMOVE_FROM_NAME = [
  '.menu_nr',
  '.preis_button',
  '.preis_info_zu_men',
  '.bestellt_check',
  '.bestellt_check_str',
  '.bestellt_button_check',
  '.bestellt_button_str',
];

export function todayInBerlin(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GERMAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function parseMenu($, wrapper) {
  const control = $(wrapper).find('a, button').first();
  if (!control.length) return null;

  const classes = control.attr('class') || '';
  const number = clean(control.find('.menu_nr').first().text());
  const price = clean(control.find('.preis_button').first().text());
  const clone = control.clone();
  clone.find('br').replaceWith(' ');
  clone.find(REMOVE_FROM_NAME.join(',')).remove();
  const name = clean(
    clone
      .text()
      .replace(/BESTELLT/gi, '')
      .replace(PRICE_PATTERN, '')
      .replace(/\s*-\s*$/, ''),
  );

  if (!name && !number) return null;

  return {
    number: number || null,
    name,
    price: price || null,
    ordered: /order_button_bestellt/.test(classes),
    locked: /lock|disabled/.test(classes),
    available: Boolean(number),
  };
}

export function parseAccountInfo(html) {
  const $ = cheerio.load(html);
  const facility = clean($('#joy1 > a').first().text()) || null;

  const userAnchor = $('#joy2 > a').first().clone();
  const rawId = clean(userAnchor.find('#joy2_1').text()).replace(/^\[|\]$/g, '') || null;
  userAnchor.find('#joy2_1, i').remove();
  const rawName = clean(userAnchor.text());
  let childName = rawName || null;
  if (rawName && rawName.includes(',')) {
    const [last, first] = rawName.split(',').map((part) => clean(part));
    if (first && last) childName = `${first} ${last}`;
  }

  const balanceAnchor = $('#joy3 > a, #joy3_1 > a').first().clone();
  const lowBalanceWarning =
    clean($('#joy3 .fi-alert').attr('title')) ||
    ($('#joy3 .fi-alert').length > 0 ? 'Guthaben ist bald aufgebraucht' : null);
  balanceAnchor.find('i').remove();
  const rawBalance = clean(balanceAnchor.text());
  const balance = rawBalance ? `€ ${rawBalance}` : null;

  let balanceAmount = null;
  if (rawBalance) {
    const numMatch = rawBalance.replace(/\s+/g, '').replace(',', '.').match(/[\d.]+/);
    if (numMatch) {
      const parsed = parseFloat(numMatch[0]);
      if (!Number.isNaN(parsed)) balanceAmount = parsed;
    }
  }

  if (!facility && !childName && !balance) return null;

  return {
    childName,
    customerId: rawId,
    facility,
    balance,
    balanceAmount,
    lowBalance: Boolean(lowBalanceWarning),
    lowBalanceWarning,
  };
}

export function parseOrdersHtml(html) {
  const $ = cheerio.load(html);
  const days = [];

  $('.order_table').each((_, table) => {
    const block = $(table);
    const header = clean(block.find('strong.left').first().text());
    const match = header.match(DATE_PATTERN);
    if (!match) return;

    const [, day, month, year] = match;
    const deadlines = block
      .find('.fristen_info')
      .map((_, el) => clean($(el).text()))
      .get()
      .filter(Boolean);

    const entries = [];
    block.find('.order_button_wrapper').each((__, wrapper) => {
      const menu = parseMenu($, wrapper);
      if (menu) entries.push(menu);
    });

    const menus = entries.filter((menu) => menu.available);
    const note = entries.find((menu) => !menu.available)?.name ?? null;
    const hasOffer = menus.length > 0;
    const orderedMenu = menus.find((menu) => menu.ordered) ?? null;

    days.push({
      date: `${year}-${month}-${day}`,
      label: header,
      hasOffer,
      ordered: Boolean(orderedMenu),
      menus,
      orderedMenu,
      note,
      deadlines,
    });
  });

  return days;
}

export function pickDay(days, isoDate) {
  return days.find((day) => day.date === isoDate) ?? null;
}

export async function fetchOrderDays({ username, password, client } = {}) {
  const session = await login({ username, password, client });
  if (!session.ok) {
    const error = new Error(session.error || 'Login fehlgeschlagen');
    error.code = 'LOGIN_FAILED';
    throw error;
  }

  const html = session.response.text();
  const days = parseOrdersHtml(html);
  const account = parseAccountInfo(html);

  return {
    days,
    account,
    client: session.client,
    dashboardHtml: html,
    dashboardUrl: session.response.url.href,
  };
}

export async function fetchTodayStatus({ username, password, client } = {}) {
  const { days, account } = await fetchOrderDays({
    username,
    password,
    client,
  });

  const today = todayInBerlin();
  const day = pickDay(days, today);
  const hasOffer = Boolean(day?.hasOffer);

  return {
    checkedAt: new Date().toISOString(),
    date: today,
    account,
    day,
    ordered: Boolean(day?.ordered),
    isKitaDay: hasOffer,
    note: day?.note ?? null,
    menus: day?.menus ?? [],
    orderedMenu: day?.orderedMenu ?? null,
    week: days.map((d) => ({
      date: d.date,
      label: d.label,
      isToday: d.date === today,
      hasOffer: d.hasOffer,
      ordered: d.ordered,
      orderedMenu: d.orderedMenu,
      menus: d.menus,
      note: d.note,
      deadlines: d.deadlines,
    })),
  };
}
