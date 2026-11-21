const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

function runtime() {
  const props = { ENTRY_MODE: 'test', TEST_SHEET_ID: 'test', LIVE_SHEET_ID: 'live', WORKER_SHARED_KEY: 'test-key-'.repeat(5) };
  const tables = {};
  let failFlush = false;
  let now = Date.parse('2026-11-20T09:00:00+09:00');
  const context = vm.createContext({
    Date: class extends Date {
      static now() { return now; }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...props }), getProperty: key => props[key]
    }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: value => ({ setMimeType: () => value })
    },
    SpreadsheetApp: {
      flush() {
        if (failFlush) {
          failFlush = false;
          throw Error('Lost acknowledgement');
        }
      },
      openById(id) {
        return {
          getSheetByName: () => tables[id]?.sheet || null,
          insertSheet() {
            const rows = [];
            const sheet = {
              getLastRow: () => rows.length,
              setFrozenRows() {},
              getRange(row, col, height, width) {
                return {
                  setNumberFormat() {},
                  setValues: values => { rows[row - 1] = Array.from(values[0]); },
                  getValues: () => [rows[row - 1].slice(col - 1, col - 1 + width)],
                  createTextFinder: value => ({ matchEntireCell: () => ({
                    findNext() {
                      const offset = rows.slice(row - 1, row - 1 + height).findIndex(cells => cells[col - 1] === value);
                      return offset < 0 ? null : { getRow: () => row + offset };
                    }
                  }) })
                };
              }
            };
            tables[id] = { sheet, rows };
            return sheet;
          }
        };
      }
    },
    LockService: { getScriptLock: () => {
      let locked = false;
      return {
        waitLock() { locked = true; },
        tryLock() { locked = true; return true; },
        releaseLock() { assert.ok(locked); locked = false; }
      };
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value, encoding) => createHash(algorithm).update(value, encoding).digest(),
      base64EncodeWebSafe: value => value.toString('base64url'),
      getUuid: randomUUID
    }
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  context.setupSheets_();
  return { props, tables, submit: context.submitEntry_, post: context.doPost,
    setTime: value => { now = Date.parse(value); },
    loseAcknowledgement: () => { failFlush = true; } };
}

function entry(format, count) {
  return {
    id: randomUUID().replaceAll('-', ''), mode: 'test', format,
    discord: 'qa-example', early16: true, early17: false, clip: true,
    url: 'https://example.com/clip', agree: true, eligible: true, clipConsent: true,
    players: Array.from({ length: count }, (_, i) => ({
      name: '架空選手' + i, gameId: 'fake#' + i, platform: 'Steam', minor: false
    }))
  };
}

test('all five submission formats save the expected roles and return test receipts', () => {
  const { tables, submit } = runtime();
  const formats = [['team', 5], ['killer', 1], ['solo', 1], ['duo', 2], ['squad', 4]];
  for (const [format, count] of formats) {
    const data = entry(format, count);
    const result = submit(data);
    assert.match(result.receipt, /^TEST-/);
    const row = tables.test.rows.at(-1);
    const hasKiller = format === 'team' || format === 'killer';
    const players = JSON.parse(row[11]);
    assert.equal(row[1], result.receipt);
    assert.equal(row[4], format);
    assert.equal(row[9], hasKiller ? data.url : '');
    assert.equal(players.length, count);
    assert.equal(players.filter(player => player.role === 'チャッキー').length, Number(hasKiller));
  }
  assert.equal(tables.test.rows.length, 6);
  assert.equal(tables.live.rows.length, 1);
});

test('rejects missing data, wrong counts and missing guardian consent', () => {
  const { tables, submit } = runtime();
  const data = entry('duo', 2);
  data.players[1].minor = true;
  assert.match(submit(data).error, /保護者/);
  assert.ok(submit({ ...data, players: data.players.slice(0, 1) }).error);
  data.players[1].guardian = true;
  assert.ok(submit({ ...data, early16: undefined }).error);
  assert.ok(submit({ ...data, agree: false }).error);
  assert.ok(submit({ ...data, eligible: false }).error);
  assert.ok(submit({ ...data, players: [{ ...data.players[0], platform: 'Xbox' }, data.players[1]] }).error);
  assert.ok(submit({ ...data, discord: ' ' }).error);
  assert.ok(submit({ ...entry('killer', 1), clipConsent: false }).error);
  assert.ok(submit({ ...entry('killer', 1), url: 'javascript:example' }).error);
  assert.equal(tables.test.rows.length, 1);
  assert.match(submit(data).receipt, /^TEST-/);
  assert.equal(JSON.parse(tables.test.rows[1][11])[1].guardian, true);
  const dm = submit({ ...entry('killer', 1), url: '' });
  assert.match(dm.receipt, /^TEST-/);
  assert.match(tables.test.rows[2][10], /クリップ利用同意/);
});

test('retry after lost acknowledgement recovers the same record and rejects changed payload', () => {
  const { tables, submit, loseAcknowledgement } = runtime();
  const data = { ...entry('solo', 1), discord: '=1+1' };
  loseAcknowledgement();
  assert.equal(submit(data).retry, true);
  const result = submit(data);
  assert.equal(result.receipt, tables.test.rows[1][1]);
  assert.equal(submit(data).receipt, result.receipt);
  assert.ok(submit({ ...data, discord: 'changed' }).error);
  assert.equal(tables.test.rows.length, 2);
  assert.equal(tables.test.rows[1][5], "'=1+1");
});

test('closed and stale modes cannot write, and live goes to the other spreadsheet', () => {
  const { props, tables, submit } = runtime();
  const data = entry('solo', 1);
  props.ENTRY_MODE = 'closed';
  assert.ok(submit(data).error);
  props.ENTRY_MODE = 'live';
  assert.ok(submit(data).error);
  assert.match(submit({ ...data, mode: 'live' }).receipt, /^GGC-/);
  assert.equal(tables.test.rows.length, 1);
  assert.equal(tables.live.rows.length, 2);
});

test('live submissions obey the Japan-time opening and closing boundaries', () => {
  const { props, tables, submit, setTime } = runtime();
  props.ENTRY_MODE = 'live';
  const live = () => ({ ...entry('solo', 1), mode: 'live' });
  setTime('2026-11-19T23:59:59.999+09:00');
  assert.ok(submit(live()).error);
  setTime('2026-11-20T00:00:00+09:00');
  assert.match(submit(live()).receipt, /^GGC-/);
  setTime('2026-11-30T23:59:59.999+09:00');
  assert.match(submit(live()).receipt, /^GGC-/);
  setTime('2026-12-01T00:00:00+09:00');
  assert.ok(submit(live()).error);
  assert.equal(tables.live.rows.length, 3);
});

test('browser script parses after Apps Script template substitution', () => {
  const page = fs.readFileSync('apps-script/Index.html', 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('<?!= JSON.stringify(state) ?>', '"test"')
    .replace('<?!= JSON.stringify(formats) ?>', '{}');
  assert.ok(new vm.Script(script));
});

test('built site links to the Worker, and form exposes five choices and four platforms', () => {
  const files = require('../scripts/build.cjs');
  const website = files['dist/pages/index.html'];
  const form = files['dist/worker/index.html'];
  for (const page of [website, form, files['dist/pages/entry-guide.html']]) {
    assert.match(page, /2026年11月20日（金）～11月30日（月）23:59（日本時間）/);
    assert.match(page, /応募状況によっては、募集期間が前後する可能性があります。/);
  }
  assert.match(website, /href="http:\/\/127\.0\.0\.1:8787\/"/);
  assert.doesNotMatch(website, /<form/);
  const nav = html => html.match(/<nav id="page-top"[\s\S]*?<\/nav>/)[0];
  const labels = html => Array.from(nav(html).matchAll(/<a [^>]*>([^<]+)<\/a>/g), match => match[1]);
  const pages = ['game-rules', 'scoring', 'perk-rules', 'killer-rules', 'penalties', 'ranking', 'prizes', 'entry-guide'];
  for (const page of ['index', ...pages]) {
    assert.deepEqual(labels(files[`dist/pages/${page}.html`]), ['大会概要', '大会ルール', 'サバイバー制限', 'キラー制限', '順位決定方法', '賞金', '応募']);
  }
  for (const page of pages) {
    const html = files[`dist/pages/${page}.html`];
    assert.doesNotMatch(html, /大会トップに戻る/);
    if (page === 'ranking') continue;
    const toc = html.match(/<nav class="page-toc"[\s\S]+?<\/nav>/)[0];
    for (const [, target] of toc.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${target}"`));
    assert.match(html, /class="back-to-top" href="#page-top" hidden/);
  }
  const rules = files['dist/pages/game-rules.html'];
  for (const page of ['scoring', 'perk-rules', 'killer-rules', 'penalties']) assert.ok(rules.includes(`href="./${page}.html"`));
  assert.match(files['dist/pages/killer-rules.html'], /「隠れ場なし」「露見する闇」/);
  assert.doesNotMatch(rules, /隠れ場なし|露見する闇/);
  assert.doesNotMatch(website, /安心感／有能の証明/);
  assert.doesNotMatch(website, /各対戦は前半・後半の2ゲーム制/);
  assert.match(files['dist/pages/game-rules.html'], /各対戦は前半・後半の2ゲーム制/);
  for (const page of [website, files['dist/pages/game-rules.html'], files['dist/pages/perk-rules.html']]) {
    assert.match(page, /マップの室内・屋外の分類は現在調整中です。/);
  }
  for (const page of [website, files['dist/pages/perk-rules.html']]) {
    assert.match(page, /ゲームのアップデート内容によっては、使用制限を変更する場合があります。/);
  }
  const perks = files['dist/pages/perk-rules.html'];
  assert.match(perks, /いずれの一覧にも記載されていないパークは使用できません/);
  assert.match(perks, /発電機系<\/th><td>1個<\/td><td>1個<\/td><td>地雷爆破、幻影、盗聴、抑圧の同盟/);
  assert.match(perks, /その他<\/th><td>総枠内で何個でも可<\/td><td>総枠内で何個でも可/);
  assert.match(files['dist/pages/scoring.html'], /ハッチ・ゲートのどちらから脱出した場合も/);
  assert.match(files['dist/pages/penalties.html'], /再試合は合計10枠です/);
  assert.match(files['dist/pages/ranking.html'], /順位決定方法は、出場チーム数の確定後に決定し、当選チーム発表後にこのページで公開します。/);
  assert.match(files['dist/pages/prizes.html'], /2,000円＋大会通算メメント数×200円/);
  for (const page of [website, form, ...pages.map(id => files[`dist/pages/${id}.html`])]) {
    assert.doesNotMatch(page, /個別禁止パーク|屋外では発電機系|吟遊詩人の鼓舞|地下室|最大2名までの重複|一覧にないパークは使用可/);
  }
  assert.match(form, /チャッキー担当者は、本人がチャッキーを使用したとき/);
  assert.match(form, /提出していただいたクリップは、選手紹介動画に使用させていただく予定です。/);
  assert.match(website, /aria-current="page">大会概要/);
  assert.match(files['dist/pages/ranking.html'], /aria-current="page">順位決定方法/);
  assert.equal((form.match(/name="entry-format"/g) || []).length, 5);
  assert.equal((form.match(/<option value="(?:Steam|PlayStation 4|PlayStation 5|Nintendo Switch)"/g) || []).length, 4);
  assert.doesNotMatch(form, /<\?/);
  assert.match(files['dist/worker/entry.js'], /fetch\('\.\/api\/entry'/);
});

test('Worker relay reaches the authenticated save handler and strips private response data', async t => {
  const { default: worker } = require('../worker/index.mjs');
  const { props, tables, post } = runtime();
  const env = { GGC_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/example/exec',
    GGC_WORKER_SHARED_KEY: props.WORKER_SHARED_KEY };
  const upstream = t.mock.method(globalThis, 'fetch', async (_url, options) =>
    new Response(post({ postData: { contents: options.body } })));
  const origin = 'https://entry.example.test';
  const req = (data, source = origin) => new Request(origin + '/api/entry', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: source }, body: JSON.stringify(data)
  });
  assert.deepEqual(await (await worker.fetch(new Request(origin + '/api/status'), env)).json(), { mode: 'test' });
  const data = entry('killer', 1);
  assert.equal((await worker.fetch(req(data, 'https://other.example.test'), env)).status, 403);
  assert.equal(upstream.mock.callCount(), 1);
  assert.equal((await worker.fetch(req(data), { ...env, GGC_WORKER_SHARED_KEY: 'wrong'.repeat(8) })).status, 503);
  assert.equal(tables.test.rows.length, 1);
  const result = await (await worker.fetch(req(data), env)).json();
  assert.match(result.receipt, /^TEST-/);
  assert.deepEqual(Object.keys(result).sort(), ['mode', 'receipt']);
  assert.equal((await (await worker.fetch(req(data), env)).json()).receipt, result.receipt);
  props.ENTRY_MODE = 'closed';
  assert.ok((await (await worker.fetch(req({ ...data, id: randomUUID().replaceAll('-', '') }), env)).json()).error);
  assert.equal(tables.test.rows.length, 2);
  assert.equal(tables.live.rows.length, 1);
});
