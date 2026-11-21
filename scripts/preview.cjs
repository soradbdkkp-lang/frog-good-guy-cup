const { createServer } = require('node:http');
const { createHash, randomUUID } = require('node:crypto');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');

const port = Number(process.env.GGC_PREVIEW_PORT || 8238);
const origin = `http://127.0.0.1:${port}`;
process.env.GGC_FORM_URL = origin + '/form/';
const files = require('./build.cjs');
const validation = vm.createContext({});
vm.runInContext(readFileSync('apps-script/Code.gs', 'utf8'), validation);
const receipts = new Map();

function json(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, origin);
  if (pathname === '/form/api/status' && request.method === 'GET') return json(response, { mode: 'test' });
  if (pathname === '/form/api/entry' && request.method === 'POST' && request.headers.origin === origin) {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 15000) return json(response, { error: '入力内容が長すぎます。' }, 400);
      }
      const data = JSON.parse(body);
      const normalized = createHash('sha256').update(JSON.stringify(validation.validate_(data))).digest('hex');
      const previous = receipts.get(data.id);
      if (previous && previous.normalized !== normalized) return json(response, { error: '再送内容が一致しません。' });
      const receipt = previous?.receipt || 'TEST-' + randomUUID().toUpperCase();
      receipts.set(data.id, { normalized, receipt });
      return json(response, { mode: 'test', receipt });
    } catch (error) {
      return json(response, { error: error.message });
    }
  }
  const route = {
    '/': 'pages/index.html', '/index.html': 'pages/index.html', '/style.css': 'pages/style.css',
    '/back-to-top.js': 'pages/back-to-top.js',
    '/share-card.png': 'pages/share-card.png',
    '/favicon-32.png': 'pages/favicon-32.png', '/favicon.ico': 'pages/favicon.ico',
    '/apple-touch-icon.png': 'pages/apple-touch-icon.png',
    '/game-rules.html': 'pages/game-rules.html', '/scoring.html': 'pages/scoring.html',
    '/perk-rules.html': 'pages/perk-rules.html', '/killer-rules.html': 'pages/killer-rules.html',
    '/penalties.html': 'pages/penalties.html', '/ranking.html': 'pages/ranking.html',
    '/prizes.html': 'pages/prizes.html', '/entry-guide.html': 'pages/entry-guide.html',
    '/form/': 'worker/index.html', '/form/style.css': 'worker/style.css',
    '/form/entry.js': 'worker/entry.js'
  }[pathname];
  if (request.method !== 'GET' || !route) return response.writeHead(404).end();
  const type = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', png: 'image/png', ico: 'image/x-icon' }[route.split('.').at(-1)];
  let content = files['dist/' + route];
  if (route.endsWith('index.html')) {
    content = content.replace('</header>', '</header><p class="notice">公開前の確認版です。応募の送信は保存されません。架空の情報でお試しください。</p>');
  } else if (route.endsWith('entry.js')) {
    content = content.replace('試験応募を保存しました', '試験送信が完了しました')
      .replace('試験用の受付番号です。', '確認用の番号です。応募は保存されていません。');
  }
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(content);
}).listen(port, '127.0.0.1', () => console.log(origin + '/'));
