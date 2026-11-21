const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const vm = require('node:vm');

const template = readFileSync('apps-script/Index.html', 'utf8');
const policy = readFileSync('apps-script/Code.gs', 'utf8');
const context = vm.createContext({});
vm.runInContext(policy, context);
const { FORMATS, PLATFORMS, ENTRY_PERIOD_LABEL } = vm.runInContext('({ FORMATS, PLATFORMS, ENTRY_PERIOD_LABEL })', context);
const [baseCss, body] = [template.match(/<style>([\s\S]+?)<\/style>/)[1], template.match(/<main>([\s\S]+?)<\/main>/)[1]];
const [rules, entry] = body.split('  <section id="entry">');
const [eligibility, conditionalForm] = entry.split("    <? if (state === 'closed') { ?>");
const form = conditionalForm.match(/<form id="application">[\s\S]+?<\/form>/)[0];
const completion = conditionalForm.match(/<div id="done"[\s\S]+?<\/div>/)[0];
const player = template.match(/<template id="player">[\s\S]+?<\/template>/)[0]
  .replace(/<\? platforms\.forEach[\s\S]+?<\? \}\); \?>/,
    PLATFORMS.map(platform => `<option value="${platform}">${platform}</option>`).join(''));
const theme = readFileSync('web/theme.css', 'utf8');
const css = baseCss + '\n' + theme;
const styleVersion = createHash('sha256').update(css).digest('hex').slice(0, 12);

const configuredUrl = process.env.GGC_FORM_URL || 'http://127.0.0.1:8787/';
const formUrl = new URL(configuredUrl);
const isLocal = ['127.0.0.1', 'localhost'].includes(formUrl.hostname);
if (formUrl.username || formUrl.password || !(formUrl.protocol === 'https:' || (formUrl.protocol === 'http:' && isLocal))) {
  throw Error('GGC_FORM_URL must be a public HTTPS URL or a local preview URL.');
}
if (process.argv.includes('--production') && isLocal) throw Error('Set the deployed GGC_FORM_URL before building for GitHub Pages.');
const safeUrl = formUrl.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const siteUrl = 'https://soradbdkkp-lang.github.io/frog-good-guy-cup/';
const shareTitle = 'ふろぐ Good Guy Cup';
const shareDescription = '2027年1月11日（月・祝）開催。チャッキー限定の Dead by Daylight 大会。大会ルール・参加条件・応募はこちら。';
const shareImageUrl = new URL('share-card.png', siteUrl).href;
const shareImageAlt = 'ふろぐ Good Guy Cupの大会告知画像。チャッキーとティファニー、開催日2027年1月11日。';
const faviconMetadata = `
<link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png">
<link rel="icon" sizes="any" href="./favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">`;
const shareMetadata = `
<meta name="description" content="${shareDescription}">
<link rel="canonical" href="${siteUrl}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="${shareTitle}">
<meta property="og:title" content="${shareTitle}">
<meta property="og:description" content="${shareDescription}">
<meta property="og:url" content="${siteUrl}">
<meta property="og:image" content="${shareImageUrl}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${shareImageAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${shareTitle}">
<meta name="twitter:description" content="${shareDescription}">
<meta name="twitter:image" content="${shareImageUrl}">
<meta name="twitter:image:alt" content="${shareImageAlt}">`;
const layout = (title, content, metadata = '') => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="./style.css?v=${styleVersion}">${metadata}</head>
<body><main>${content}</main></body></html>`;

const formatOptions = form.match(/<select id="format"[^>]*>([\s\S]*?)<\/select>/)[1];
const labels = [...formatOptions.matchAll(/<option value="([a-z0-9]+)"( data-priority)?>([^<]+)<\/option>/g)];
const formatCards = `<fieldset id="format"><legend>応募形式を選択</legend><div class="format-list">
  ${labels.map(([, key, priority, label]) => `<label class="format-card"><input type="radio" name="entry-format" value="${key}" required>
    <span>${label}</span>${priority ? '<small>選考優先</small>' : ''}</label>`).join('\n')}
  </div></fieldset>`;
const formMarkup = form
  .replace(/<label class="field">応募形式[\s\S]+?<\/label>/, formatCards)
  .replace('<form id="application">', '<form id="application" hidden>');
const applicationPeriod = `<aside class="notice" aria-label="応募期間">
  <strong>応募期間　${ENTRY_PERIOD_LABEL}</strong>
  <p>応募状況によっては、募集期間が前後する可能性があります。</p>
</aside>`;
const formPage = layout('応募フォーム | ふろぐ Good Guy Cup', `
  <header class="form-header"><h1>ふろぐ Good Guy Cup</h1><p>応募フォーム</p></header>
  <section id="entry">${applicationPeriod}${eligibility.replace('<h2>応募フォーム</h2>', '<h2>応募要項</h2>')}
  <p id="entry-state" class="notice" role="status">受付状況を確認しています。</p>
  ${formMarkup}<p id="message" role="status"></p>${completion}</section>
  ${player}<script type="module" src="./entry.js"></script>`);

const detailDefinitions = [
  ['game-rules', '大会ルール'],
  ['scoring', '得点と勝敗'],
  ['perk-rules', 'サバイバー制限'],
  ['killer-rules', 'キラー制限'],
  ['penalties', 'ペナルティ'],
  ['ranking', '順位決定方法'],
  ['prizes', '賞金'],
  ['entry-guide', '応募']
];
const navigation = [['index', '大会概要'], ...detailDefinitions.filter(([id]) =>
  ['game-rules', 'perk-rules', 'killer-rules', 'ranking', 'prizes', 'entry-guide'].includes(id))];
const siteNavigation = current => `
  <nav id="page-top" tabindex="-1" class="site-nav" aria-label="大会サイトのページ">
    ${navigation.map(([id, title]) =>
      `<a href="./${id}.html"${id === current ? ' aria-current="page"' : ''}>${title}</a>`).join('')}
  </nav>`;
const details = Object.fromEntries(
  Array.from(rules.matchAll(/<section id="([^"]+)">[\s\S]+?<\/section>/g), ([markup, id]) => [id, markup])
);
details['game-rules'] += readFileSync('web/match-operations.html', 'utf8');
const contents = {
  'game-rules': [
    ['#game-rules', '大会形式・試合進行'], ['#in-match', '試合中のルール'],
    ['#match-operations', 'Discord・リザルト・配信'], ['./perk-rules.html', 'サバイバー制限'],
    ['./killer-rules.html', 'キラー制限'], ['./scoring.html', '得点と勝敗'], ['./penalties.html', 'ペナルティ']
  ],
  'scoring': [
    ['#scoring', '役割ごとの得点'], ['#match-result', '勝敗の決め方'],
    ['#early-escape', '発電機5台の修理前の脱出'], ['#tiebreak', 'チーム得点が同じ場合']
  ],
  'perk-rules': [['#perk-rules', 'パーク制限'], ['#perk-categories', 'カテゴリ別一覧'], ['#equipment', 'キャラクター・アイテム']],
  'killer-rules': [
    ['#killer-perks', 'パーク'], ['#killer-add-ons', 'アドオン'], ['#killer-offerings', 'オファリング'],
    ['#map-selection', 'マップの選択・申告'], ['#afc', 'AFC'], ['#carry-drop', '試合中の禁止行為'], ['#killer-related', '関連ルール']
  ],
  penalties: [
    ['#loadout', 'パーク構成違反・再試合'], ['#report', '違反の申告・試合停止と再開'],
    ['#connection', '事故切断・クラッシュ・高Ping'], ['#common-penalties', 'バグ・グリッチと共通ペナルティ'],
    ['#void-match', '無効試合'], ['#late-absence', '遅刻・欠員']
  ],
  prizes: [['#prizes', '賞金と対象'], ['#memento-tiebreak', 'メメント特別賞の同数判定']],
  'entry-guide': [['#entry-conditions', '参加条件・応募形式'], ['#selection', '選考基準'], ['#apply', '応募フォーム']]
};
const tableOfContents = (title, links) => links ? `
  <nav class="page-toc" aria-label="${title}の目次">
    <h2>目次</h2>
    <ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>
  </nav>` : '';
details.penalties = readFileSync('web/penalties.html', 'utf8');
details.ranking = '<section><p>順位決定方法は、出場チーム数の確定後に決定し、当選チーム発表後にこのページで公開します。</p></section>';
details['entry-guide'] = `<section>${applicationPeriod}${eligibility.replace('<h2>応募フォーム</h2>', '<h2>応募資格と選考</h2>')}
  <a id="apply" class="button" href="${safeUrl}">応募フォームへ</a></section>`;

const approvedSite = layout('ふろぐ Good Guy Cup', `
  ${siteNavigation('index')}
  ${rules.replace('href="#entry"', `href="${safeUrl}"`).replace(/<section id="[^"]+">[\s\S]+?<\/section>/g, '')}
  ${applicationPeriod}
  <section class="rules-notice" aria-labelledby="rules-notice-heading">
    <h2 id="rules-notice-heading">大会ルールに関するお知らせ</h2>
    <ul>
      <li><strong>マップの室内・屋外の分類は現在調整中です。</strong></li>
      <li><strong>ゲームのアップデート内容によっては、使用制限を変更する場合があります。</strong></li>
    </ul>
  </section>
  <section aria-labelledby="detail-heading">
    <h2 id="detail-heading">大会ルール・参加案内</h2>
    <div class="detail-links">${navigation.slice(1).map(([id, title]) =>
      `<a href="./${id}.html"><strong>${title}</strong></a>`).join('')}</div>
  </section>`, shareMetadata + faviconMetadata);

const detailPages = Object.fromEntries(detailDefinitions.map(([id, title]) => [
  `dist/pages/${id}.html`,
  layout(`${title} | ふろぐ Good Guy Cup`, `
    ${siteNavigation(id)}
    <header class="form-header detail-header"><h1>${title}</h1></header>
    ${tableOfContents(title, contents[id])}
    ${details[id]}
    ${contents[id] ? '<a class="back-to-top" href="#page-top" hidden>上部に戻る</a><script src="./back-to-top.js" defer></script>' : ''}`, faviconMetadata)
]));

let formScript = template.match(/<script>([\s\S]+?)<\/script>/)[1]
  .replace('const mode = <?!= JSON.stringify(state) ?>;', 'let mode;')
  .replace('const formats = <?!= JSON.stringify(formats) ?>;', `const formats = ${JSON.stringify(FORMATS)};`)
  .replace(/get\('format'\)\.value/g, "form.querySelector('[name=entry-format]:checked')?.value")
  .replace('form.addEventListener(\'submit\', event => {', "form.addEventListener('submit', async event => {")
  .replace(/  google\.script\.run\.withFailureHandler[\s\S]+?\.withSuccessHandler\(result => \{/, `  try {
    const response = await fetch('./api/entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw Error('Entry request failed');`)
  .replace('  }).submitEntry(data);', `  } catch {
    retry('通信結果を確認できませんでした。同じ内容で再送してください。');
  }`);

formScript += `
async function loadStatus() {
  const status = get('entry-state');
  try {
    const response = await fetch('./api/status', { cache: 'no-store' });
    if (!response.ok) throw Error('Status unavailable');
    ({ mode } = await response.json());
    if (mode === 'live' || mode === 'test') {
      form.hidden = false;
      status.hidden = mode === 'live';
      status.textContent = mode === 'test' ? '試験受付です。架空の情報を入力してください。' : '';
      return;
    }
    if (mode !== 'closed') throw Error('Invalid mode');
    status.textContent = '現在、応募受付は停止しています。';
  } catch {
    status.textContent = '受付状況を確認できませんでした。ページを再読み込みしてください。';
  }
}
loadStatus();
`;
new vm.Script(formScript);
const files = {
  'dist/pages/index.html': approvedSite,
  'dist/pages/style.css': css,
  'dist/pages/share-card.png': readFileSync('web/share-card.png'),
  ...Object.fromEntries(['favicon-32.png', 'favicon.ico', 'apple-touch-icon.png'].map(name =>
    [`dist/pages/${name}`, readFileSync(`web/${name}`)])),
  'dist/pages/back-to-top.js': readFileSync('web/back-to-top.js', 'utf8'),
  'dist/pages/.nojekyll': '',
  ...detailPages,
  'dist/worker/index.html': formPage,
  'dist/worker/style.css': css,
  'dist/worker/entry.js': formScript
};
if (require.main === module) {
  for (const directory of ['dist/pages', 'dist/worker']) {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }
  for (const [path, contents] of Object.entries(files)) writeFileSync(path, contents);
}
module.exports = files;
