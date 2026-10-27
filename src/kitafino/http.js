export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function parseSetCookie(raw, requestUrl) {
  const [pair, ...attributes] = raw.split(';');
  const index = pair.indexOf('=');
  if (index < 1) return null;

  const cookie = {
    name: pair.slice(0, index).trim(),
    value: pair.slice(index + 1).trim(),
    domain: requestUrl.hostname,
    hostOnly: true,
    path: '/',
    secure: false,
    expiresAt: null,
  };

  for (const attribute of attributes) {
    const [key, ...rest] = attribute.split('=');
    const name = key.trim().toLowerCase();
    const value = rest.join('=').trim();

    if (name === 'domain' && value) {
      cookie.domain = value.replace(/^\./, '').toLowerCase();
      cookie.hostOnly = false;
    } else if (name === 'path' && value) {
      cookie.path = value;
    } else if (name === 'secure') {
      cookie.secure = true;
    } else if (name === 'max-age' && value) {
      cookie.expiresAt = Date.now() + Number(value) * 1000;
    } else if (name === 'expires' && value) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) cookie.expiresAt = parsed;
    }
  }

  return cookie;
}

export class CookieJar {
  #cookies = new Map();

  store(response, requestUrl) {
    const raw =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];

    for (const header of raw) {
      const cookie = parseSetCookie(header, requestUrl);
      if (!cookie) continue;
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (cookie.expiresAt !== null && cookie.expiresAt < Date.now()) {
        this.#cookies.delete(key);
      } else {
        this.#cookies.set(key, cookie);
      }
    }
  }

  headerFor(url) {
    const now = Date.now();
    const parts = [];

    for (const [key, cookie] of this.#cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt < now) {
        this.#cookies.delete(key);
        continue;
      }
      if (!this.#matches(cookie, url)) continue;
      parts.push(`${cookie.name}=${cookie.value}`);
    }

    return parts.join('; ');
  }

  #matches(cookie, url) {
    const host = url.hostname.toLowerCase();
    const hostOk = cookie.hostOnly
      ? host === cookie.domain
      : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
    if (!hostOk) return false;
    if (cookie.secure && url.protocol !== 'https:') return false;
    return url.pathname.startsWith(cookie.path);
  }

  list() {
    return [...this.#cookies.values()].map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
    }));
  }
}

export class HttpResponse {
  constructor({ status, url, headers, body, hops }) {
    this.status = status;
    this.url = url;
    this.headers = headers;
    this.body = body;
    this.hops = hops;
  }

  get pathAndQuery() {
    return this.url.pathname + this.url.search;
  }

  text() {
    return this.body;
  }
}

export function createClient({ jar = new CookieJar() } = {}) {
  const hops = [];

  async function request(input, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body = undefined,
      referer,
      maxRedirects = 10,
    } = options;

    let url = new URL(String(input));
    let currentMethod = method.toUpperCase();
    let currentBody = body;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const requestHeaders = {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'de-DE,de;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      };

      if (referer) requestHeaders.Referer = referer;
      const cookieHeader = jar.headerFor(url);
      if (cookieHeader) requestHeaders.Cookie = cookieHeader;

      const response = await fetch(url, {
        method: currentMethod,
        headers: requestHeaders,
        body: currentBody,
        redirect: 'manual',
      });

      jar.store(response, url);
      hops.push({
        method: currentMethod,
        url: url.href,
        status: response.status,
        location: response.headers.get('location') || null,
      });

      const location = response.headers.get('location');
      if (!REDIRECT_STATUS.has(response.status) || !location) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const charset = (response.headers.get('content-type') || '')
          .toLowerCase()
          .includes('iso-8859-1')
          ? 'latin1'
          : 'utf8';

        return new HttpResponse({
          status: response.status,
          url,
          headers: Object.fromEntries(response.headers.entries()),
          body: buffer.toString(charset),
          hops: hops.slice(),
        });
      }

      const next = new URL(location, url);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          currentMethod !== 'GET' &&
          currentMethod !== 'HEAD')
      ) {
        currentMethod = 'GET';
        currentBody = undefined;
      }

      url = next;
    }

    throw new Error(`Zu viele Weiterleitungen (${input})`);
  }

  return {
    jar,
    hops,
    get: (url, options = {}) => request(url, { ...options, method: 'GET' }),
    postForm: (url, form, options = {}) =>
      request(url, {
        ...options,
        method: 'POST',
        body: form,
        headers: {
          Origin: new URL(url).origin,
          ...options.headers,
        },
      }),
  };
}
