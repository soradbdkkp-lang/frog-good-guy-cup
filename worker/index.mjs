const modes = ['closed', 'test', 'live'];
const maxBytes = 15000;
const unavailable = '受付システムに接続できませんでした。';
const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

async function readEntry(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('Missing body');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error('Body too large');
      }
      body += decoder.decode(value, { stream: true });
    }
    const entry = JSON.parse(body + decoder.decode());
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('Invalid entry');
    return entry;
  } finally {
    reader.releaseLock();
  }
}

async function relay(env, action, entry) {
  const endpoint = new URL(env.GGC_APPS_SCRIPT_URL);
  if (endpoint.origin !== 'https://script.google.com' ||
      !/^\/macros\/s\/[\w-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash ||
      !env.GGC_WORKER_SHARED_KEY || env.GGC_WORKER_SHARED_KEY.length < 32) throw Error('Invalid relay configuration');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: env.GGC_WORKER_SHARED_KEY, action, entry }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw Error('Upstream unavailable');
  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/status' && request.method === 'GET') {
      try {
        const result = await relay(env, 'status');
        if (!modes.includes(result?.mode)) throw Error('Invalid status');
        return json({ mode: result.mode });
      } catch {
        return json({ error: unavailable }, 503);
      }
    }
    if (url.pathname !== '/api/entry') return json({ error: '見つかりません。' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST が必要です。' }, 405);
    if (request.headers.get('Origin') !== url.origin ||
        request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: '応募フォームから送信してください。' }, 403);
    }
    let entry;
    try {
      entry = await readEntry(request);
    } catch {
      return json({ error: '応募情報を確認してください。' }, 400);
    }
    try {
      const result = await relay(env, 'submit', entry);
      const prefix = entry.mode === 'test' ? 'TEST-' : entry.mode === 'live' ? 'GGC-' : '';
      if (prefix && result?.mode === entry.mode &&
          typeof result.receipt === 'string' && result.receipt.startsWith(prefix) &&
          /^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(result.receipt.slice(prefix.length))) {
        return json({ receipt: result.receipt, mode: result.mode });
      }
      if (typeof result?.error === 'string' && !result.receipt && !result.denied) {
        return json({ error: result.error, retry: result.retry === true });
      }
      throw Error('Invalid save result');
    } catch {
      return json({ retry: true, error: unavailable }, 503);
    }
  }
};
