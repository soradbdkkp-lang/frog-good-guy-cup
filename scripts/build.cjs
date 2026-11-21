const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
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

const configuredUrl = process.env.GGC_FORM_URL || 'http://127.0.0.1:8787/';
const formUrl = new URL(configuredUrl);
const isLocal = ['127.0.0.1', 'localhost'].includes(formUrl.hostname);
if (formUrl.username || formUrl.password || !(formUrl.protocol === 'https:' || (formUrl.protocol === 'http:' && isLocal))) {
  throw Error('GGC_FORM_URL must be a public HTTPS URL or a local preview URL.');
}
if (process.argv.includes('--production') && isLocal) throw Error('Set the deployed GGC_FORM_URL before building for GitHub Pages.');
const safeUrl = formUrl.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const layout = (title, content) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="./style.css"></head>
<body><main>${content}</main></body></html>`;

const labels = [...form.matchAll(/<option value="(team|killer|solo|duo|squad)">([^<]+)<\/option>/g)];
const formatCards = `<fieldset id="format"><legend>応募形式を選択</legend><div class="format-list">
  ${labels.map(([, key, label]) => `<label class="format-card"><input type="radio" name="entry-format" value="${key}" required>
    <span>${label}</span>${key === 'team' ? '<small>選考優先</small>' : ''}</label>`).join('\n')}
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
  ['game-rules', 'ranking', 'prizes', 'entry-guide'].includes(id))];
const siteNavigation = current => `
  <nav class="site-nav" aria-label="大会サイトのページ">
    ${navigation.map(([id, title]) =>
      `<a href="./${id}.html"${id === current ? ' aria-current="page"' : ''}>${title}</a>`).join('')}
  </nav>`;
const details = Object.fromEntries(
  Array.from(rules.matchAll(/<section id="([^"]+)">[\s\S]+?<\/section>/g), ([markup, id]) => [id, markup])
);
details['game-rules'] = `<nav class="detail-links" aria-label="大会ルールの目次">
  <a href="#game-rules">大会形式・試合進行</a>
  <a href="./perk-rules.html">サバイバー制限</a>
  <a href="./killer-rules.html">キラー制限</a>
  <a href="./scoring.html">得点と勝敗</a>
  <a href="./penalties.html">ペナルティ</a>
  <a href="#match-operations">Discord・リザルト・配信</a>
</nav>${details['game-rules']}${readFileSync('web/match-operations.html', 'utf8')}`;
details.penalties = readFileSync('web/penalties.html', 'utf8');
details.ranking = '<section><p>順位決定方法は、出場チーム数の確定後に決定し、当選チーム発表後にこのページで公開します。</p></section>';
details['entry-guide'] = `<section>${applicationPeriod}${eligibility.replace('<h2>応募フォーム</h2>', '<h2>応募資格と選考</h2>')}
  <a class="button" href="${safeUrl}">応募フォームへ</a></section>`;

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
  </section>`);

const detailPages = Object.fromEntries(detailDefinitions.map(([id, title]) => [
  `dist/pages/${id}.html`,
  layout(`${title} | ふろぐ Good Guy Cup`, `
    ${siteNavigation(id)}
    <header class="form-header detail-header"><h1>${title}</h1></header>
    ${details[id]}`)
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
const css = baseCss + '\n' + theme;
const files = {
  'dist/pages/index.html': approvedSite,
  'dist/pages/style.css': css,
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
