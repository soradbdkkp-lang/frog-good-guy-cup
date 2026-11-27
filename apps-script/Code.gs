const FORMATS = {
  team: ['チャッキー', 'サバイバー', 'サバイバー', 'サバイバー', 'サバイバー'],
  team4: ['チャッキー兼サバイバー', 'サバイバー', 'サバイバー', 'サバイバー'],
  killer: ['チャッキー'],
  solo: ['サバイバー'],
  duo: ['サバイバー', 'サバイバー'],
  squad: ['サバイバー', 'サバイバー', 'サバイバー', 'サバイバー']
};
const HEADERS = ['送信ID', '受付番号', '受付日時（UTC）', '区分', '応募形式', '連絡用Discord',
  '16時対応', '17時対応', 'クリップ提出', '共有URL', '注意事項同意', '選手情報（JSON）', '送信内容照合'];
const EXTRA_HEADERS = ['連絡用X（Twitter）ID', 'チーム名'];
const TAB = '応募一覧';
const PLATFORMS = ['Steam', 'PlayStation 4', 'PlayStation 5', 'Nintendo Switch'];
const ENTRY_START = Date.parse('2026-11-20T00:00:00+09:00');
const ENTRY_END_EXCLUSIVE = Date.parse('2026-12-13T00:00:00+09:00');
const ENTRY_PERIOD_LABEL = '2026年11月21日（土）～12月12日（土）23:59（日本時間）';

function doGet() {
  return ContentService.createTextOutput('Good Guy Cup');
}

function status_(now = Date.now()) {
  const values = PropertiesService.getScriptProperties().getProperties();
  const mode = values.ENTRY_MODE;
  const ready = values.TEST_SHEET_ID && values.LIVE_SHEET_ID && values.TEST_SHEET_ID !== values.LIVE_SHEET_ID;
  if (!ready) return 'closed';
  if (mode === 'test') return 'test';
  if (mode === 'live' && now >= ENTRY_START && now < ENTRY_END_EXCLUSIVE) return 'live';
  return 'closed';
}

// The new public deployment serves the Worker API only.
function doPost(event) {
  const reply = result => ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
  try {
    const body = event?.postData?.contents;
    if (typeof body !== 'string' || body.length > 16000) return reply({ denied: true });
    const request = JSON.parse(body);
    const key = PropertiesService.getScriptProperties().getProperty('WORKER_SHARED_KEY');
    if (!key || key.length < 32 || typeof request.key !== 'string' || request.key.length !== key.length) {
      return reply({ denied: true });
    }
    let mismatch = 0;
    for (let i = 0; i < key.length; i++) mismatch |= key.charCodeAt(i) ^ request.key.charCodeAt(i);
    if (mismatch) return reply({ denied: true });
    if (request.action === 'status') return reply({ mode: status_() });
    if (request.action === 'submit') return reply(submitEntry_(request.entry));
    return reply({ denied: true });
  } catch {
    return reply({ retry: true, error: '保存結果を確認できませんでした。' });
  }
}

// Run from the editor to provision the two private spreadsheets and tabs.
function setupSheets_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const values = props.getProperties();
    if (values.TEST_SHEET_ID && values.TEST_SHEET_ID === values.LIVE_SHEET_ID) {
      throw Error('試験用と本番用に別々のスプレッドシートを指定してください。');
    }
    const books = [['TEST_SHEET_ID', '試験用'], ['LIVE_SHEET_ID', '本番用']].map(([key, label]) => {
      if (values[key]) return SpreadsheetApp.openById(values[key]);
      const book = SpreadsheetApp.create('ふろぐ Good Guy Cup 応募受付（' + label + '）');
      props.setProperty(key, book.getId());
      return book;
    });
    books.forEach(book => {
      const sheet = book.getSheetByName(TAB);
      if (sheet && sheet.getLastRow()) verifyHeader_(sheet);
    });
    books.forEach(book => {
      const sheet = book.getSheetByName(TAB) || book.insertSheet(TAB);
      if (!sheet.getLastRow()) {
        sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
        sheet.setFrozenRows(1);
      }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function verifyHeader_(sheet) {
  if (!sheet || JSON.stringify(sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS)) {
    throw Error('応募一覧の見出しが一致しません。');
  }
}

function requiredText_(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw Error(label + 'を確認してください。');
  }
  return value.trim();
}

function yesNo_(value, label) {
  if (typeof value !== 'boolean') throw Error(label + 'を選択してください。');
  return value;
}

function validate_(raw) {
  if (!raw || JSON.stringify(raw).length > 14000 ||
      typeof raw.id !== 'string' || !/^[a-f0-9]{32}$/.test(raw.id) ||
      !Object.prototype.hasOwnProperty.call(FORMATS, raw.format)) throw Error('応募形式を確認してください。');
  const roles = FORMATS[raw.format];
  if (!Array.isArray(raw.players) || raw.players.length !== roles.length) throw Error('選手人数を確認してください。');
  if (raw.agree !== true || raw.eligible !== true) throw Error('参加条件の確認と応募時の同意が必要です。');
  const players = roles.map((role, index) => {
    const player = raw.players[index] || {};
    const minor = yesNo_(player.minor, '選手の年齢区分');
    if (minor && player.guardian !== true) throw Error('未成年の選手には保護者の同意が必要です。');
    if (!PLATFORMS.includes(player.platform)) throw Error('対応機種を選択してください。');
    return {
      role,
      name: requiredText_(player.name, 80, '選手名'),
      gameId: requiredText_(player.gameId, 100, 'ゲーム内識別情報'),
      platform: player.platform,
      minor,
      guardian: minor ? true : null
    };
  });
  const updated = raw.version === 2;
  const club = raw.format === 'team' || raw.format === 'team4';
  const clip = roles[0].startsWith('チャッキー') && !(updated && raw.clip == null)
    ? yesNo_(raw.clip, 'クリップ提出可否') : null;
  let twitter = '';
  let teamName = '';
  if (updated) {
    twitter = requiredText_(raw.twitter, 16, '連絡用X（Twitter）ID').replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(twitter)) throw Error('連絡用X（Twitter）IDを確認してください。');
    teamName = club ? requiredText_(raw.teamName, 80, 'チーム名') : '';
  }
  if (clip && raw.clipConsent !== true) throw Error('提出クリップの選手紹介動画への利用同意が必要です。');
  const url = !updated && clip && raw.url ? requiredText_(raw.url, 1000, '共有URL') : '';
  if (url && !/^https?:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i.test(url)) throw Error('共有URLは http または https で入力してください。');
  return {
    format: raw.format,
    discord: updated ? '' : requiredText_(raw.discord, 100, '連絡用Discord'),
    early16: yesNo_(raw.early16, '16:00開始への対応可否'),
    early17: yesNo_(raw.early17, '17:00開始への対応可否'),
    clip, url, players, clipConsent: clip ? true : null,
    ...(updated ? { twitter, teamName } : {})
  };
}

function submitEntry_(raw) {
  if (!raw || !['test', 'live'].includes(raw.mode) || status_() !== raw.mode) {
    return { error: '受付状態が変わりました。ページを開き直してください。' };
  }
  let entry;
  try {
    entry = validate_(raw);
  } catch (error) {
    return { error: error.message };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { retry: true, error: '処理が混み合っています。同じ内容で再送してください。' };
  try {
    if (status_() !== raw.mode) return { error: '受付状態が変わりました。ページを開き直してください。' };
    const key = raw.mode === 'test' ? 'TEST_SHEET_ID' : 'LIVE_SHEET_ID';
    const sheet = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(key)).getSheetByName(TAB);
    verifyHeader_(sheet);
    const digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, JSON.stringify(entry), Utilities.Charset.UTF_8
    ));
    const lastRow = sheet.getLastRow();
    const match = lastRow > 1 && sheet.getRange(2, 1, lastRow - 1, 1)
      .createTextFinder(raw.id).matchEntireCell(true).findNext();
    if (match) {
      const saved = sheet.getRange(match.getRow(), 1, 1, HEADERS.length).getValues()[0];
      return saved[12] === digest ? { receipt: saved[1], mode: raw.mode }
        : { error: '同じ送信IDで異なる応募を受け付け済みです。ページを開き直してください。' };
    }
    const receipt = (raw.mode === 'test' ? 'TEST-' : 'GGC-') + Utilities.getUuid().toUpperCase();
    const row = [raw.id, receipt, new Date().toISOString(), raw.mode === 'test' ? '試験' : '本番',
      entry.format, entry.discord, entry.early16 ? '可' : '不可', entry.early17 ? '可' : '不可',
      entry.clip === null ? (entry.twitter && entry.players[0].role.startsWith('チャッキー') ? '未回答' : '対象外')
        : entry.clip ? '可' : '不可', entry.url,
      '参加条件確認・注意事項同意' + (entry.clipConsent ? '・クリップ利用同意' : ''),
      JSON.stringify(entry.players), digest];
    if (entry.twitter) {
      const headerRange = sheet.getRange(1, HEADERS.length + 1, 1, EXTRA_HEADERS.length);
      const current = headerRange.getValues()[0];
      if (current.every(value => value === '')) headerRange.setValues([EXTRA_HEADERS]);
      else if (JSON.stringify(current) !== JSON.stringify(EXTRA_HEADERS)) {
        throw Error('追加項目の見出しが一致しません。');
      }
      row.push('@' + entry.twitter, entry.teamName);
    }
    const range = sheet.getRange(lastRow + 1, 1, 1, row.length);
    range.setNumberFormat('@');
    range.setValues([row.map(value => /^[=+\-@']/.test(value) ? "'" + value : value)]);
    SpreadsheetApp.flush();
    return { receipt, mode: raw.mode };
  } catch (error) {
    return { retry: true, error: '保存を確認できませんでした。ページを閉じず、同じ内容で再送してください。' };
  } finally {
    lock.releaseLock();
  }
}
