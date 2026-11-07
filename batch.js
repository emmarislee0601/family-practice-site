// 匯入題庫測驗：JSON 匯入、引導／獨立作答、答錯先提示再想一次、逐題計時、離開紀錄、成績匯出。
// 所有資料存在這台裝置的瀏覽器（localStorage），ZOEY、PEGGY 分開記錄。
// 依賴 app.js 的全域變數：curriculum。
(function () {
  'use strict';

  const STORE_KEY = 'familyBatchV1';
  const STUDENTS = ['ZOEY', 'PEGGY'];
  const GRADE_CODE = { 5: 'G5', 6: 'G6', 7: 'J1', 8: 'J2', 9: 'J3' };
  const SUBJECT_KEYS = {
    elementary: ['chinese', 'english', 'math', 'science', 'social'],
    junior: ['chinese', 'english', 'math', 'science', 'history', 'geography', 'civics'],
  };
  const SUBJECT_NAME = {
    elementary: { chinese: '國語', english: '英文', math: '數學', science: '自然', social: '社會' },
    junior: {
      chinese: '國文', english: '英文', math: '數學', science: '自然',
      history: '歷史', geography: '地理', civics: '公民',
    },
  };
  const LEVELS = ['basic', 'application', 'reasoning', 'challenge'];
  const LEVEL_NAME = { basic: '基礎', application: '應用', reasoning: '推理', challenge: '挑戰' };
  const ZHUYIN = /[ㄅ-ㄯˊˇˋ˙]/;
  const $ = id => document.getElementById(id);

  // ---------- 資料存取 ----------
  function emptyStore() {
    return { banks: {}, rounds: {}, tutorLogs: {}, focusLogs: {} };
  }
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY)) || emptyStore();
      for (const k of ['banks', 'rounds', 'tutorLogs', 'focusLogs']) s[k] = s[k] || {};
      for (const st of STUDENTS) {
        s.rounds[st] = s.rounds[st] || {};
        s.tutorLogs[st] = s.tutorLogs[st] || [];
        s.focusLogs[st] = s.focusLogs[st] || [];
      }
      return s;
    } catch {
      return loadStoreFallback();
    }
  }
  function loadStoreFallback() {
    const s = emptyStore();
    for (const st of STUDENTS) {
      s.rounds[st] = {};
      s.tutorLogs[st] = [];
      s.focusLogs[st] = [];
    }
    return s;
  }
  let store = loadStore();
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      alert('瀏覽器儲存空間不足，這次的變更可能沒有存好。請到家長區「匯出完整備份」，再封存或刪除用不到的題庫。');
      return false;
    }
  }

  // ---------- 工具 ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function normalize(text) {
    return String(text ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  }
  function rational(text) {
    const value = normalize(text).replace(/−/g, '-');
    if (value.length > 60) return null;
    if (/^[+-]?\d+\s*\/\s*[+-]?\d+$/.test(value)) {
      const [a, b] = value.split('/').map(x => BigInt(x.trim()));
      return b === 0n ? null : [a, b];
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value)) return null;
    const sign = value.startsWith('-') ? -1n : 1n;
    const [whole, part = ''] = value.replace(/^[+-]/, '').split('.');
    return [sign * BigInt((whole || '0') + part), 10n ** BigInt(part.length)];
  }
  function sameNumber(a, b) {
    const x = rational(a);
    const y = rational(b);
    return Boolean(x && y && x[0] * y[1] === y[0] * x[1]);
  }
  // 判斷 raw 是否等於 expected／accepted 其中一個
  function matches(raw, expected, accepted, match) {
    if (!normalize(raw)) return false;
    return [expected, ...(accepted || [])].some(x => {
      if (match === 'number') return sameNumber(raw, x);
      const clean = v => (match === 'case-insensitive' ? normalize(v).toLowerCase() : normalize(v));
      return clean(raw) === clean(x);
    });
  }
  function gradeItem(q, raw) {
    return matches(raw, q.answer, q.type === 'fill' ? q.accepted : [], q.type === 'fill' ? q.match : 'text');
  }
  function feedbackFor(t, raw) {
    if (!t || !t.feedback || !normalize(raw)) return undefined;
    for (const [key, text] of Object.entries(t.feedback)) {
      if (normalize(key) === normalize(raw) || sameNumber(key, raw)) return text;
    }
    return undefined;
  }
  function hasHint(t) {
    return Boolean(t && (t.hint || t.ask || t.feedback));
  }
  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  async function sha(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function stamp(t) {
    const d = new Date(t);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function timeText(t) {
    return new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function stageOf(grade) {
    return grade <= 6 ? 'elementary' : 'junior';
  }
  function subjectName(bankMeta, subject) {
    return SUBJECT_NAME[stageOf(bankMeta.textbook.grade)][subject] || subject;
  }

  // ---------- SVG 圖片（白名單） ----------
  function validDiagram(d) {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.alt !== 'string' || !d.alt.trim() || d.alt.length > 800) return false;
    if (typeof d.svg !== 'string' || d.svg.length > 24000) return false;
    const svg = d.svg.trim();
    if (!/^<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>/.test(svg)) return false;
    if (!svg.endsWith('</svg>')) return false;
    if (/<!|<\?|\bon\w+\s*=|\b(?:href|src|style)\s*=|url\s*\(|javascript:|data:|https?:\/\//i.test(
      svg.replace('http://www.w3.org/2000/svg', ''))) return false;
    const allowed = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
      'path', 'text', 'tspan', 'title', 'desc']);
    const tags = svg.match(/<[^>]+>/g) || [];
    return tags.length > 0 && tags.every(tag => allowed.has((/^<\/?([a-zA-Z]+)/.exec(tag) || [])[1] || ''));
  }
  function imageHtml(d) {
    if (!validDiagram(d)) return '';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg);
    return `<figure class="bq-figure"><img src="${url}" alt="${esc(d.alt)}"><figcaption>${esc(d.alt)}</figcaption></figure>`;
  }

  // ---------- 題庫驗證 ----------
  function validatePackage(p) {
    const fail = m => {
      throw new Error(m);
    };
    if (!p || typeof p !== 'object') fail('檔案不是題庫 JSON。');
    if (![2, 3].includes(p.schemaVersion)) fail('schemaVersion 需為 3（舊版 2 也可以）。');
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(p.batchId || '')) fail('batchId 只能用英數字、- 和 _，60 字以內。');
    if (!Number.isSafeInteger(p.version) || p.version < 1 || p.version > 99999) fail('version 需為正整數。');
    if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120) fail('缺少題庫名稱 title（120 字以內）。');
    const tb = p.textbook || {};
    if (!GRADE_CODE[tb.grade]) fail('textbook.grade 需為 5～9（5、6＝國小五、六年級；7～9＝國中一～三年級）。');
    if (![1, 2].includes(tb.semester)) fail('textbook.semester 需為 1（上學期）或 2（下學期）。');
    if (tb.schoolYear !== undefined && (!Number.isInteger(tb.schoolYear) || tb.schoolYear < 110 || tb.schoolYear > 150))
      fail('textbook.schoolYear 需為民國學年度，例如 115。');
    const stage = stageOf(tb.grade);
    if (tb.stage !== undefined && tb.stage !== stage) fail(`textbook.stage 和年級不一致，應為 ${stage}。`);
    if (p.students !== undefined && (!Array.isArray(p.students) || !p.students.length ||
      p.students.some(s => !STUDENTS.includes(s)))) fail('students 只能填 ["ZOEY"]、["PEGGY"] 或兩個都填。');
    const allowedSubjects = SUBJECT_KEYS[stage];
    const keys = Object.keys(p.subjects || {});
    if (!keys.length) fail('subjects 裡沒有任何科目。');
    const bad = keys.filter(k => !allowedSubjects.includes(k));
    if (bad.length) fail(`${stage === 'elementary' ? '國小' : '國中'}科目鍵只能用：${allowedSubjects.join('、')}（錯誤：${bad.join('、')}）。`);
    const ids = new Set();
    for (const subject of keys) {
      const bank = p.subjects[subject];
      const name = SUBJECT_NAME[stage][subject];
      if (!bank || typeof bank.title !== 'string' || !bank.title.trim()) fail(`${name}缺少 title。`);
      if (!Array.isArray(bank.scope) || !bank.scope.length || bank.scope.length > 60 ||
        bank.scope.some(s => typeof s !== 'string' || !s.trim() || s.length > 150)) fail(`${name}的 scope（範圍章節代碼）不完整。`);
      const size = bank.roundSize === undefined ? 20 : bank.roundSize;
      if (!Number.isInteger(size) || size < 5 || size > 40) fail(`${name}的 roundSize 需為 5～40。`);
      if (!Array.isArray(bank.main) || !bank.main.length || bank.main.length > 100 || bank.main.length % size !== 0)
        fail(`${name}的 main 題數需為 roundSize（${size}）的倍數，最多 100 題。`);
      if (bank.reinforcement !== undefined && (!Array.isArray(bank.reinforcement) || bank.reinforcement.length))
        fail(`${name}的 reinforcement 請留空陣列 []。`);
      for (const q of bank.main) {
        if (!q || typeof q.id !== 'string' || !/^[\w-]{1,90}$/.test(q.id) || ids.has(q.id))
          fail(`題號 ${q && q.id} 重複或格式不正確（英數字、-、_，90 字以內）。`);
        ids.add(q.id);
        for (const key of ['chapterId', 'chapterName', 'concept', 'prompt', 'answer']) {
          if (typeof q[key] !== 'string' || !q[key].trim() || q[key].length > (key === 'prompt' ? 3500 : 300))
            fail(`${q.id}：缺少或過長的 ${key}。`);
        }
        if (!bank.scope.includes(q.chapterId)) fail(`${q.id}：chapterId 不在這科的 scope 裡。`);
        if (!LEVELS.includes(q.level)) fail(`${q.id}：level 只能是 basic／application／reasoning／challenge。`);
        if (!['choice', 'fill'].includes(q.type)) fail(`${q.id}：type 只能是 choice 或 fill。`);
        if (q.learningMode !== undefined && !['guided', 'independent'].includes(q.learningMode))
          fail(`${q.id}：learningMode 只能是 guided 或 independent。`);
        if (q.lesson !== undefined && (q.learningMode !== 'guided' || typeof q.lesson !== 'string' ||
          !q.lesson.trim() || q.lesson.length > 1500)) fail(`${q.id}：lesson 只能用在引導題，1500 字以內。`);
        if (q.purpose !== undefined && !['weakness', 'progress', 'review'].includes(q.purpose))
          fail(`${q.id}：purpose 只能是 weakness／progress／review。`);
        if (q.type === 'choice') {
          if (!Array.isArray(q.options) || q.options.length !== 4 ||
            q.options.some(x => typeof x !== 'string' || !x.trim() || x.length > 1000) ||
            new Set(q.options.map(normalize)).size !== 4 || !q.options.includes(q.answer))
            fail(`${q.id}：選擇題要剛好 4 個不同選項，answer 要和其中一個一字不差。`);
          if (q.match || (q.accepted && q.accepted.length)) fail(`${q.id}：選擇題不能加 match 或 accepted。`);
        } else {
          if (!['text', 'number', 'case-insensitive'].includes(q.match || '')) fail(`${q.id}：填空題要設定 match。`);
          if (q.match === 'case-insensitive' && subject !== 'english') fail(`${q.id}：只有英文可以用 case-insensitive。`);
          if (q.accepted !== undefined && (!Array.isArray(q.accepted) || q.accepted.length > 20 ||
            q.accepted.some(x => typeof x !== 'string' || !x.trim() || x.length > 300)))
            fail(`${q.id}：accepted 格式不正確（最多 20 個）。`);
          if (q.match === 'number' && [q.answer, ...(q.accepted || [])].some(x => !rational(x)))
            fail(`${q.id}：數字題的答案只能是純數字或分數。`);
        }
        if (q.image !== undefined && !validDiagram(q.image))
          fail(`${q.id}：圖片格式不正確（只能用白名單標籤的 SVG，不能有 style、href、url()）。`);
        const t = q.teaching;
        if (!t || ['principle', 'check', 'pitfall'].some(k => typeof t[k] !== 'string' || !t[k].trim() || t[k].length > 1500) ||
          !Array.isArray(t.steps) || !t.steps.length || t.steps.length > 12 ||
          t.steps.some(x => typeof x !== 'string' || !x.trim() || x.length > 1500))
          fail(`${q.id}：teaching 要有 principle、steps（1～12 步）、check、pitfall。`);
        if (['ask', 'rule', 'hint'].some(k => t[k] !== undefined && (typeof t[k] !== 'string' || !t[k].trim() || t[k].length > 600)))
          fail(`${q.id}：ask、rule、hint 需為 600 字以內文字。`);
        if (t.feedback !== undefined && (typeof t.feedback !== 'object' || t.feedback === null || Array.isArray(t.feedback) ||
          Object.keys(t.feedback).length > 24 ||
          Object.entries(t.feedback).some(([k, v]) => !k.trim() || k.length > 300 || typeof v !== 'string' || !v.trim() || v.length > 800)))
          fail(`${q.id}：feedback 要寫成 {"錯的答案": "回饋"}，最多 24 條。`);
        if (q.references !== undefined && (!Array.isArray(q.references) || q.references.length > 10 ||
          q.references.some(x => typeof x !== 'string' || x.length > 500))) fail(`${q.id}：references 格式不正確。`);
      }
    }
    if (new TextEncoder().encode(JSON.stringify(p)).length > 1500000) fail('整份題庫超過 1.5MB，請分科匯入。');
    return p;
  }

  async function importPackage(text) {
    let p;
    try {
      p = JSON.parse(text);
    } catch {
      throw new Error('不是正確的 JSON 格式，請確認檔案完整。');
    }
    validatePackage(p);
    const id = (await sha(`${p.batchId}|${p.version}`)).slice(0, 24);
    const digest = await sha(JSON.stringify(p));
    const existing = store.banks[id];
    if (existing) {
      if (existing.digest !== digest) throw new Error('同一個 batchId、同一個 version 已經匯入過不同的內容。要改內容請把 version 加 1。');
      return { bank: existing, duplicate: true };
    }
    const newIds = new Set(Object.values(p.subjects).flatMap(b => b.main.map(q => q.id)));
    for (const b of Object.values(store.banks)) {
      if (b.package.batchId === p.batchId) continue;
      for (const s of Object.values(b.package.subjects)) {
        const clash = s.main.find(q => newIds.has(q.id));
        if (clash) throw new Error(`題號 ${clash.id} 已經在「${b.package.title}」用過，題號跨題庫也不能重複。`);
      }
    }
    const bank = {
      id, digest, importedAt: Date.now(), archived: false,
      students: p.students || [...STUDENTS],
      package: p,
    };
    store.banks[id] = bank;
    if (!persist()) {
      delete store.banks[id];
      throw new Error('儲存空間不足，題庫沒有匯入。');
    }
    return { bank, duplicate: false };
  }

  // ---------- 回合 ----------
  function roundKey(bankId, subject, n) {
    return `${bankId}|${subject}|${n}`;
  }
  function roundSizeOf(sb) {
    return sb.roundSize || 20;
  }
  function roundItems(bank, subject, n) {
    const sb = bank.package.subjects[subject];
    const size = roundSizeOf(sb);
    return sb.main.slice((n - 1) * size, n * size);
  }
  function itemLookup(bank) {
    const m = new Map();
    for (const [subject, sb] of Object.entries(bank.package.subjects)) {
      for (const q of sb.main) m.set(q.id, { q, subject });
    }
    return m;
  }
  function getRound(student, key) {
    return store.rounds[student][key];
  }
  function roundScore(r) {
    const total = r.itemIds.length;
    const correct = r.itemIds.filter(id => r.results && r.results[id] && r.results[id].correct).length;
    return { total, correct };
  }

  // ---------- 畫面狀態 ----------
  let view = { mode: 'list' }; // list | quiz | review
  let ticker = null;
  let lastTick = 0;
  let hiddenAt = null;
  let tickCtx = null;

  function student() {
    return $('student').value;
  }
  function selectedGrade() {
    return $('grade').value;
  }

  function visibleBanks() {
    const g = selectedGrade();
    const st = student();
    return Object.values(store.banks)
      .filter(b => GRADE_CODE[b.package.textbook.grade] === g && b.students.includes(st))
      .sort((a, b) => b.importedAt - a.importedAt);
  }

  function render() {
    stopTicker();
    if ($('bqBanks')) renderParent();
    if (view.mode === 'quiz') return renderQuiz();
    if (view.mode === 'review') return renderReview();
    renderList();
  }

  function renderList() {
    const st = student();
    const g = selectedGrade();
    const banks = visibleBanks();
    const active = banks.filter(b => !b.archived);
    const archived = banks.filter(b => b.archived);
    $('bqTitle').textContent = `📦 匯入題庫測驗｜${st}・${curriculum[g].label}`;
    if (!banks.length) {
      $('bqBody').innerHTML = `<p class="muted">目前沒有${esc(curriculum[g].label)}、可以給 ${esc(st)} 做的匯入題庫。請到下方「家長區」匯入題庫 JSON。</p>`;
      return;
    }
    const block = b => {
      const subjects = Object.entries(b.package.subjects).map(([subject, sb]) => {
        const count = sb.main.length / roundSizeOf(sb);
        const buttons = [];
        for (let n = 1; n <= count; n++) {
          const key = roundKey(b.id, subject, n);
          const r = getRound(st, key);
          const prevDone = n === 1 || (getRound(st, roundKey(b.id, subject, n - 1)) || {}).status === 'submitted';
          let label;
          let action;
          if (r && r.status === 'submitted') {
            const s = roundScore(r);
            label = `第${n}輪 ✔ ${s.correct}/${s.total}｜看錯題`;
            action = 'review';
          } else if (r) {
            label = `第${n}輪｜繼續作答（${Object.values(r.replies).filter(x => normalize(x.raw)).length}/${r.itemIds.length}）`;
            action = 'quiz';
          } else {
            label = `第${n}輪｜開始（${roundSizeOf(sb)}題）`;
            action = 'quiz';
          }
          const disabled = !r && (!prevDone || b.archived);
          buttons.push(`<button class="${action === 'review' ? 'outline' : 'primary'} bq-round" data-bank="${b.id}" data-subject="${subject}" data-n="${n}" data-action="${action}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`);
        }
        return `<div class="bq-subject"><div><b>${esc(subjectName(b.package, subject))}</b> <span class="muted">${esc(sb.title)}</span></div><div class="bq-rounds">${buttons.join('')}</div></div>`;
      }).join('');
      return `<div class="bq-bank ${b.archived ? 'archived' : ''}"><div class="bq-bank-head"><b>${esc(b.package.title)}</b><span class="muted">匯入：${timeText(b.importedAt)}${b.archived ? '｜已封存' : ''}</span></div>${subjects}</div>`;
    };
    $('bqBody').innerHTML =
      active.map(block).join('') +
      (archived.length ? `<details class="bq-archived"><summary>已封存的題庫（${archived.length}）</summary>${archived.map(block).join('')}</details>` : '');
    document.querySelectorAll('.bq-round').forEach(btn => {
      btn.onclick = () => {
        const bank = store.banks[btn.dataset.bank];
        const n = Number(btn.dataset.n);
        if (btn.dataset.action === 'review') {
          view = { mode: 'review', bankId: bank.id, key: roundKey(bank.id, btn.dataset.subject, n), open: null };
        } else {
          startRound(bank, btn.dataset.subject, n);
          return;
        }
        render();
        $('bqSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }

  function startRound(bank, subject, n) {
    const st = student();
    const key = roundKey(bank.id, subject, n);
    let r = getRound(st, key);
    if (!r) {
      r = {
        key, bankId: bank.id, batchId: bank.package.batchId, version: bank.package.version,
        subject, number: n, itemIds: roundItems(bank, subject, n).map(q => q.id),
        replies: {}, guidedChecks: {}, status: 'active', seconds: 0,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      store.rounds[st][key] = r;
      persist();
    }
    const firstOpen = r.itemIds.findIndex(id => !normalize((r.replies[id] || {}).raw) && !r.guidedChecks[id]);
    view = { mode: 'quiz', bankId: bank.id, key, index: firstOpen < 0 ? 0 : firstOpen };
    render();
    $('bqSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 作答畫面 ----------
  function currentContext() {
    const bank = store.banks[view.bankId];
    const r = getRound(student(), view.key);
    if (!bank || !r) return null;
    const lookup = itemLookup(bank);
    const items = r.itemIds.map(id => lookup.get(id).q);
    return { bank, r, items };
  }

  function renderQuiz() {
    const ctx = currentContext();
    if (!ctx) {
      view = { mode: 'list' };
      return renderList();
    }
    const { bank, r, items } = ctx;
    if (r.status === 'submitted') {
      view = { mode: 'review', bankId: bank.id, key: r.key, open: null };
      return renderReview();
    }
    const i = Math.min(view.index, items.length - 1);
    const q = items[i];
    const reply = r.replies[q.id] || { raw: '', seconds: 0, updatedAt: 0 };
    const check = r.guidedChecks[q.id];
    const guided = q.learningMode === 'guided';
    const answeredCount = items.filter(x => normalize((r.replies[x.id] || {}).raw)).length;
    $('bqTitle').textContent = `📦 ${subjectName(bank.package, r.subject)}・第${r.number}輪｜${student()}`;
    const dots = items.map((x, k) => {
      const c = r.guidedChecks[x.id];
      const has = normalize((r.replies[x.id] || {}).raw);
      const cls = c ? (c.correct ? 'ok' : 'no') : has ? 'done' : '';
      return `<button class="bq-dot ${cls} ${k === i ? 'now' : ''}" data-k="${k}" aria-label="第${k + 1}題">${k + 1}</button>`;
    }).join('');
    let answerHtml;
    const locked = Boolean(check);
    if (q.type === 'choice') {
      answerHtml = `<div class="options">${q.options.map((o, k) => {
        const cls = locked ? (o === q.answer ? 'correct' : o === check.raw ? 'incorrect' : '') : '';
        return `<label class="option ${cls}"><input type="radio" name="bqAns" value="${k}" ${reply.raw === o ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${String.fromCharCode(65 + k)}. ${esc(o)}</span></label>`;
      }).join('')}</div>`;
    } else {
      answerHtml = `<label class="bq-fill">你的答案<input id="bqFill" value="${esc(reply.raw)}" maxlength="300" autocomplete="off" ${locked ? 'disabled' : ''} placeholder="${q.match === 'number' ? '只填數字（記得切換成英文輸入法）' : '在這裡輸入答案'}"></label>`;
    }
    $('bqBody').innerHTML = `
      <div class="quiz-top"><span class="pill">${esc(q.chapterName)}｜${guided ? '引導題' : '獨立作答'}｜${LEVEL_NAME[q.level]}</span><span class="q-number">第 ${i + 1} / ${items.length} 題・已作答 ${answeredCount}</span></div>
      <div class="bq-dots">${dots}</div>
      ${guided && q.lesson ? `<details class="bq-lesson" ${locked ? '' : 'open'}><summary>📖 先看小教學</summary><p>${esc(q.lesson)}</p></details>` : ''}
      <div class="question bq-prompt">${esc(q.prompt)}</div>
      ${imageHtml(q.image)}
      ${answerHtml}
      <div id="bqTutor"></div>
      <div class="quiz-actions">
        <button class="outline" id="bqBack">回題庫清單</button>
        <div class="bq-nav">
          <button class="outline" id="bqPrev" ${i === 0 ? 'disabled' : ''}>← 上一題</button>
          ${guided && !locked ? '<button class="primary" id="bqCheck">確認答案</button>' : ''}
          ${i < items.length - 1 ? '<button class="primary" id="bqNext">下一題 →</button>' : '<button class="primary" id="bqSubmit">交卷</button>'}
        </div>
      </div>
      <p class="muted bq-note">${guided ? '引導題：按「確認答案」馬上看對錯和講解。成績算第一次的答案。' : '獨立作答：交卷後才會看到對錯。'}每題只在畫面看得到時計時。</p>`;

    const setRaw = raw => {
      if (locked) return;
      const cur = r.replies[q.id] || { raw: '', seconds: 0, updatedAt: 0 };
      r.replies[q.id] = { ...cur, raw, updatedAt: Date.now() };
      r.updatedAt = Date.now();
      persist();
    };
    document.querySelectorAll('input[name="bqAns"]').forEach(inp => {
      inp.onchange = () => setRaw(q.options[Number(inp.value)]);
    });
    const fill = $('bqFill');
    if (fill) fill.oninput = () => setRaw(fill.value);
    document.querySelectorAll('.bq-dot').forEach(b => {
      b.onclick = () => {
        view.index = Number(b.dataset.k);
        render();
      };
    });
    $('bqBack').onclick = () => {
      view = { mode: 'list' };
      render();
    };
    $('bqPrev').onclick = () => {
      view.index = i - 1;
      render();
    };
    if ($('bqNext')) $('bqNext').onclick = () => {
      view.index = i + 1;
      render();
    };
    if ($('bqSubmit')) $('bqSubmit').onclick = () => submitRound(ctx);
    if ($('bqCheck')) $('bqCheck').onclick = () => {
      const raw = (r.replies[q.id] || {}).raw || '';
      if (!normalize(raw)) {
        alert('請先作答；真的不會可以填「不知道」。');
        return;
      }
      r.guidedChecks[q.id] = { raw, correct: gradeItem(q, raw), checkedAt: Date.now() };
      r.updatedAt = Date.now();
      persist();
      render();
    };
    if (check) {
      const already = store.tutorLogs[student()].some(l => l.roundKey === r.key && l.itemId === q.id);
      mountTutor($('bqTutor'), q, check.raw, check.correct, ev => logTutor(r, q, 'guided', check.raw, ev), already);
    }
    startTicker(r, q.id, Boolean(check && !check.correct));
  }

  function submitRound(ctx) {
    const { r, items } = ctx;
    const empty = items.filter(q => !normalize((r.replies[q.id] || {}).raw)).length;
    if (!confirm(empty ? `還有 ${empty} 題沒作答，沒作答算錯。確定要交卷嗎？` : '確定要交卷嗎？交卷後就不能改答案。')) return;
    r.results = {};
    for (const q of items) {
      const raw = r.guidedChecks[q.id] ? r.guidedChecks[q.id].raw : (r.replies[q.id] || {}).raw || '';
      r.results[q.id] = { correct: gradeItem(q, raw), expected: q.answer };
    }
    r.status = 'submitted';
    r.submittedAt = Date.now();
    r.updatedAt = Date.now();
    persist();
    view = { mode: 'review', bankId: r.bankId, key: r.key, open: null, justSubmitted: true };
    render();
  }

  // ---------- 交卷後檢討 ----------
  function renderReview() {
    const ctx = currentContext();
    if (!ctx) {
      view = { mode: 'list' };
      return renderList();
    }
    const { bank, r, items } = ctx;
    const s = roundScore(r);
    const logs = store.tutorLogs[student()].filter(l => l.roundKey === r.key);
    const wrong = items.filter(q => !r.results[q.id].correct);
    const pending = wrong.filter(q => hasHint(q.teaching) && !logs.some(l => l.itemId === q.id)).length;
    $('bqTitle').textContent = `📦 ${subjectName(bank.package, r.subject)}・第${r.number}輪 成績｜${student()}`;
    const rows = items.map((q, k) => {
      const ok = r.results[q.id].correct;
      const done = logs.find(l => l.itemId === q.id);
      const raw = firstRaw(r, q.id);
      return `<div class="bq-row ${ok ? 'ok' : 'no'}">
        <button class="bq-row-head" data-id="${q.id}"><span>${ok ? '✔' : '✘'} 第${k + 1}題</span><span class="bq-row-prompt">${esc(q.prompt.slice(0, 60))}${q.prompt.length > 60 ? '…' : ''}</span><span class="muted">${ok ? '' : done ? (done.outcome === 'retry-right' ? '🎉 自己想通' : '已看講解') : '待再想一次'}</span></button>
        ${view.open === q.id ? `<div class="bq-row-body"><div class="bq-prompt">${esc(q.prompt)}</div>${imageHtml(q.image)}${q.type === 'choice' ? `<ol class="bq-optlist" type="A">${q.options.map(o => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}<div id="bqTutor"></div></div>` : ''}
      </div>`;
    }).join('');
    $('bqBody').innerHTML = `
      <div class="finish bq-finish"><div class="score">${s.correct} / ${s.total}</div><p>${view.justSubmitted ? '交卷完成！' : ''}交卷時間：${timeText(r.submittedAt || r.updatedAt)}</p>
      ${pending ? `<p class="bq-remind">還有 <b>${pending}</b> 題錯題沒有「再想一次」，請點紅色的題目做完再離開。</p>` : wrong.length ? '<p class="bq-good">錯題都檢討過了，很棒！</p>' : '<p class="bq-good">全對，太厲害了！</p>'}</div>
      <div class="bq-list">${rows}</div>
      <div class="quiz-actions"><button class="outline" id="bqBack">回題庫清單</button></div>`;
    document.querySelectorAll('.bq-row-head').forEach(b => {
      b.onclick = () => {
        view.open = view.open === b.dataset.id ? null : b.dataset.id;
        view.justSubmitted = false;
        render();
      };
    });
    $('bqBack').onclick = () => {
      view = { mode: 'list' };
      render();
    };
    if (view.open) {
      const q = items.find(x => x.id === view.open);
      const raw = firstRaw(r, q.id);
      const ok = r.results[q.id].correct;
      const already = logs.find(l => l.itemId === q.id);
      mountTutor($('bqTutor'), q, raw, ok, ev => logTutor(r, q, 'round-review', raw, ev), Boolean(already));
    }
  }
  function firstRaw(r, id) {
    return r.guidedChecks[id] ? r.guidedChecks[id].raw : (r.replies[id] || {}).raw || '';
  }

  // ---------- 家教講解：答錯先提示、再想一次、完整講解 ----------
  function mountTutor(el, q, raw, correct, onLog, skipHint) {
    const t = q.teaching;
    const fb = correct ? undefined : feedbackFor(t, raw);
    const state = { stage: correct || !hasHint(t) || skipHint ? 'full' : 'hint', retry: '', result: null, retryRaw: '', msg: '' };
    const shownAt = Date.now();
    let logged = false;
    const draw = () => {
      let html = '<div class="tutor">';
      if (!correct) {
        html += `<div class="tutor-wrong"><p>你的答案：<b>${raw.trim() ? esc(raw) : '沒有作答'}</b></p>${fb ? `<p class="tutor-feedback">❌ ${esc(fb)}</p>` : raw.trim() ? '<p class="tutor-feedback">❌ 這個答案還不對。</p>' : ''}</div>`;
      } else {
        html += '<p class="tutor-good">✔ 答對了！</p>';
      }
      if (state.stage === 'hint') {
        html += '<section class="tutor-hint"><p class="tutor-lead">先別急著看答案，我們一起再想一次。</p>';
        if (t.ask) html += `<p><span class="tutor-tag">🔍 這題在問</span>${esc(t.ask)}</p>`;
        if (t.hint) html += `<p><span class="tutor-tag">💡 提示</span>${esc(t.hint)}</p>`;
        if (q.type === 'choice') {
          html += `<div class="tutor-options">${q.options.map((o, k) => `<button data-o="${k}" class="${state.retry === o ? 'selected' : ''}" ${o === raw ? 'disabled' : ''}>${String.fromCharCode(65 + k)}. ${esc(o)}${o === raw ? '（你第一次選的）' : ''}</button>`).join('')}</div>`;
        } else {
          html += `<label class="tutor-input">再算一次，你的新答案<input id="tutorRetry" value="${esc(state.retry)}" maxlength="300" autocomplete="off" placeholder="記得用英文輸入法打數字和負號"></label>`;
        }
        if (state.msg) html += `<p class="tutor-error">${esc(state.msg)}</p>`;
        html += '<div class="button-row"><button class="primary" id="tutorGo">再想一次</button></div><p class="muted">先自己再想一次，就會看到完整講解。這是練習，不會改變這題原本的成績。</p></section>';
      } else {
        html += '<section class="tutor-full">';
        if (state.result === 'right') html += '<p class="tutor-good">🎉 答對了！你自己想通了。下面再看一次完整的想法，把它記牢。</p>';
        if (state.result === 'wrong') {
          const rf = feedbackFor(t, state.retryRaw);
          html += `<p class="tutor-feedback">還是不對（你填了 ${esc(state.retryRaw)}）。${esc(rf || '沒關係，我們一步一步看。')}</p>`;
        }
        html += `<p class="tutor-answer">正確答案：<b>${esc(q.answer)}</b></p>`;
        if (t.ask) html += `<p><span class="tutor-tag">🔍 這題在問</span>${esc(t.ask)}</p>`;
        if (t.rule) html += `<p class="tutor-rule"><span class="tutor-tag">💡 一句話記住</span>${esc(t.rule)}</p>`;
        if (q.lesson && !correct) html += `<p class="lesson-card">${esc(q.lesson)}</p>`;
        html += `<h4>為什麼是這個答案</h4><p>${esc(t.principle)}</p><h4>✏️ 一步一步來</h4><ol>${t.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol><h4>✅ 怎麼檢查</h4><p>${esc(t.check)}</p><h4>⚠️ 容易錯的地方</h4><p>${esc(t.pitfall)}</p></section>`;
      }
      html += '</div>';
      el.innerHTML = html;
      el.querySelectorAll('[data-o]').forEach(b => {
        b.onclick = () => {
          state.retry = q.options[Number(b.dataset.o)];
          state.msg = '';
          draw();
        };
      });
      const inp = el.querySelector('#tutorRetry');
      if (inp) inp.oninput = () => {
        state.retry = inp.value;
        state.msg = '';
      };
      const go = el.querySelector('#tutorGo');
      if (go) go.onclick = () => {
        if (!normalize(state.retry)) {
          state.msg = '先選一個答案或填一個答案，再按「再想一次」。';
          return draw();
        }
        if (matches(state.retry, raw, [], q.type === 'fill' ? q.match : 'text')) {
          state.msg = '這是你第一次的答案喔。照著提示再算一次，換一個答案試試看。';
          return draw();
        }
        const ok = matches(state.retry, q.answer, q.type === 'fill' ? q.accepted : [], q.type === 'fill' ? q.match : 'text');
        state.retryRaw = state.retry;
        state.result = ok ? 'right' : 'wrong';
        state.stage = 'full';
        if (!logged) {
          logged = true;
          onLog({
            outcome: ok ? 'retry-right' : 'retry-wrong',
            retryRaw: state.retry.slice(0, 300),
            hintSeconds: Math.round((Date.now() - shownAt) / 1000),
            feedbackMatched: Boolean(fb),
          });
        }
        draw();
      };
    };
    draw();
  }

  function logTutor(r, q, source, raw, ev) {
    const st = student();
    if (store.tutorLogs[st].some(l => l.roundKey === r.key && l.itemId === q.id && l.source === source)) return;
    store.tutorLogs[st].push({
      id: uid(), roundKey: r.key, itemId: q.id, subject: r.subject, source,
      outcome: ev.outcome, firstRaw: raw, retryRaw: ev.retryRaw, hintSeconds: ev.hintSeconds,
      feedbackMatched: ev.feedbackMatched, at: Date.now(),
    });
    persist();
  }

  // ---------- 計時與離開紀錄 ----------
  function startTicker(r, itemId, afterWrong) {
    stopTicker();
    lastTick = Date.now();
    ticker = setInterval(() => {
      const now = Date.now();
      if (document.hidden) {
        lastTick = now;
        return;
      }
      const gap = now - lastTick;
      lastTick = now;
      if (gap > 5000) {
        logFocus(r, itemId, now - gap, now, 'sleep', afterWrong);
        return;
      }
      const cur = r.replies[itemId] || { raw: '', seconds: 0, updatedAt: 0 };
      r.replies[itemId] = { ...cur, seconds: Math.round((cur.seconds + gap / 1000) * 10) / 10 };
      r.seconds = Math.round(((r.seconds || 0) + gap / 1000) * 10) / 10;
      if (Math.round(now / 1000) % 5 === 0) persist();
    }, 1000);
    tickCtx = { round: r, itemId, afterWrong };
  }
  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      persist();
    }
    ticker = null;
    tickCtx = null;
  }
  function logFocus(r, itemId, leftAt, backAt, kind, afterWrong) {
    store.focusLogs[student()].push({
      id: uid(), roundKey: r.key, itemId, subject: r.subject, kind, leftAt, backAt,
      awaySeconds: Math.round((backAt - leftAt) / 1000), afterWrong, at: Date.now(),
    });
    persist();
  }
  document.addEventListener('visibilitychange', () => {
    if (!ticker || !tickCtx) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      persist();
    } else if (hiddenAt) {
      logFocus(tickCtx.round, tickCtx.itemId, hiddenAt, Date.now(), 'hidden', tickCtx.afterWrong);
      hiddenAt = null;
      lastTick = Date.now();
    }
  });
  window.addEventListener('beforeunload', () => persist());

  // ---------- 成績分析與匯出 ----------
  function analysis(bank, st) {
    const lookup = itemLookup(bank);
    const rounds = Object.values(store.rounds[st]).filter(r => r.bankId === bank.id);
    const tutorLogs = store.tutorLogs[st].filter(l => rounds.some(r => r.key === l.roundKey));
    const focusLogs = store.focusLogs[st].filter(l => rounds.some(r => r.key === l.roundKey));
    const firstLog = new Map();
    for (const l of [...tutorLogs].sort((a, b) => a.at - b.at)) {
      const k = `${l.roundKey}|${l.itemId}`;
      if (!firstLog.has(k)) firstLog.set(k, l);
    }
    const wrongItems = [];
    const summary = {};
    const pairs = new Map();
    const exportedRounds = [];
    for (const r of rounds) {
      const answers = r.itemIds.map((id, k) => {
        const { q } = lookup.get(id);
        const raw = firstRaw(r, id);
        const correct = r.results ? r.results[id].correct : r.guidedChecks[id] ? r.guidedChecks[id].correct : null;
        return {
          no: k + 1, itemId: id, chapterId: q.chapterId, concept: q.concept, type: q.type, level: q.level,
          purpose: q.purpose || null, learningMode: q.learningMode || 'independent',
          studentAnswer: raw, correctAnswer: q.answer, correct, seconds: Math.round((r.replies[id] || {}).seconds || 0),
        };
      });
      exportedRounds.push({
        roundKey: r.key, subject: r.subject, subjectName: subjectName(bank.package, r.subject), number: r.number,
        status: r.status === 'submitted' ? 'submitted' : 'in-progress',
        startedAt: r.createdAt, submittedAt: r.submittedAt || null,
        score: r.results ? roundScore(r) : null, answers,
      });
      if (r.status !== 'submitted') continue;
      for (const a of answers) {
        const { q } = lookup.get(a.itemId);
        const tag = (q.references || []).find(x => x.startsWith('診斷對:'));
        if (tag) {
          const [pid, kind] = tag.slice(4).split('-');
          const k = `${r.key}|${pid}`;
          const e = pairs.get(k) || { roundKey: r.key, subject: r.subject, pair: pid, ids: [] };
          if (kind === '課本') e.textbook = a.correct;
          if (kind === '白話') e.plain = a.correct;
          e.ids.push(a.itemId);
          pairs.set(k, e);
        }
        if (a.correct) continue;
        const log = firstLog.get(`${r.key}|${a.itemId}`);
        const outcome = log ? log.outcome : hasHint(q.teaching) ? 'not-opened' : 'no-hint';
        const misconception = feedbackFor(q.teaching, a.studentAnswer) || null;
        const flags = [];
        if (!a.studentAnswer.trim()) flags.push('未作答');
        const ime = q.match === 'number' && ZHUYIN.test(a.studentAnswer);
        if (ime) flags.push('疑似注音輸入法：答案含注音符號，可能其實會算');
        if (a.studentAnswer.trim() && a.seconds < 5) flags.push('作答少於5秒（只供參考，不能證明猜題）');
        wrongItems.push({
          roundKey: r.key, subject: r.subject, ...a, misconception, hintOutcome: outcome,
          retryRaw: log ? log.retryRaw : null, hintSeconds: log ? log.hintSeconds : null, flags,
        });
        const s = summary[r.subject] || (summary[r.subject] = {
          wrong: 0, misconceptionTagged: 0, inputMethodSuspect: 0, 'retry-right': 0, 'retry-wrong': 0, 'not-opened': 0, 'no-hint': 0,
        });
        s.wrong++;
        if (misconception) s.misconceptionTagged++;
        if (ime) s.inputMethodSuspect++;
        s[outcome]++;
      }
    }
    const verdict = {
      'false|true': '課本版錯、白話版對：可能看不懂題目文字。',
      'false|false': '兩題都錯：觀念或計算尚未掌握。',
      'true|true': '兩題都對：已能理解。',
      'true|false': '課本版對、白話版錯：可能粗心，需人工檢查題目。',
    };
    const minutes = x => Math.round((x / 60) * 10) / 10;
    const focusRounds = rounds.map(r => {
      const onSite = r.itemIds.reduce((sum, id) => sum + ((r.replies[id] || {}).seconds || 0), 0);
      const wall = Math.max(0, ((r.submittedAt || r.updatedAt) - r.createdAt) / 1000);
      const events = focusLogs.filter(l => l.roundKey === r.key).sort((a, b) => a.leftAt - b.leftAt).map(l => {
        const res = r.results && r.results[l.itemId];
        return {
          itemId: l.itemId, questionNo: r.itemIds.indexOf(l.itemId) + 1, kind: l.kind, leftAt: l.leftAt,
          awayMinutes: minutes(l.awaySeconds), afterWrong: l.afterWrong,
          itemFinallyWrong: res ? !res.correct : null, stuck: l.afterWrong || (res ? !res.correct : false),
        };
      });
      const away = events.reduce((sum, e) => sum + e.awayMinutes * 60, 0);
      const stuck = events.filter(e => e.stuck).length;
      return {
        roundKey: r.key, subject: r.subject, onSiteMinutes: minutes(onSite), wallMinutes: minutes(wall),
        awayCount: events.length, awayMinutes: minutes(away), untrackedMinutes: minutes(Math.max(0, wall - onSite - away)),
        longAways: events.filter(e => e.awayMinutes >= 5).length, stuckAways: stuck,
        pattern: !events.length ? '沒有離開紀錄：連續作答。'
          : stuck * 2 >= events.length ? '多半在答錯或卡題後離開：可能題目太難、提示不夠。'
            : '離開和答題對錯關係不大：比較像被其他事打斷。',
        events,
      };
    });
    return {
      rounds: exportedRounds, tutorLogs, focusLogs,
      tutorAnalysis: {
        legend: {
          'retry-right': '看提示後自己想通：多半是看不懂題目或一時粗心。',
          'retry-wrong': '看提示後仍答錯：觀念或步驟需要重新教。',
          'not-opened': '交卷後還沒打開這題做再想一次。',
          'no-hint': '這題沒有提示欄位，無法判斷。',
        },
        note: '成績一律以第一次答案計分；再想一次只是練習紀錄。',
        summary, wrongItems,
        diagnosticPairs: [...pairs.values()].map(x => ({
          ...x,
          verdict: x.textbook === undefined || x.plain === undefined ? '配對不完整' : verdict[`${x.textbook}|${x.plain}`],
        })),
      },
      focusAnalysis: {
        note: '在網站上＝畫面看得到且作答中的時間；離開＝切到別的App、分頁、縮小視窗或休眠。畫面開著但人在看別的裝置時無法分辨。',
        rounds: focusRounds,
      },
    };
  }

  function exportResults(bank, students) {
    const p = bank.package;
    const out = {
      exportType: 'family-practice-results',
      exportedAt: new Date().toISOString(),
      batch: { batchId: p.batchId, version: p.version, title: p.title, textbook: p.textbook },
      students: {},
    };
    for (const st of students) out.students[st] = analysis(bank, st);
    download(`成績-${students.join('-')}-${p.batchId}-v${p.version}-${stamp(Date.now())}.json`, out);
  }

  // ---------- 家長區 ----------
  function renderParent() {
    const list = Object.values(store.banks).sort((a, b) => b.importedAt - a.importedAt);
    $('bqBanks').innerHTML = list.length ? list.map(b => {
      const p = b.package;
      const grade = curriculum[GRADE_CODE[p.textbook.grade]].label;
      const counts = Object.entries(p.subjects).map(([s, sb]) => `${subjectName(p, s)} ${sb.main.length}題`).join('、');
      const used = STUDENTS.some(st => Object.values(store.rounds[st]).some(r => r.bankId === b.id));
      return `<div class="bq-pbank">
        <div><b>${esc(p.title)}</b>${b.archived ? ' <span class="muted">（已封存）</span>' : ''}<br><span class="muted">${esc(grade)}・${p.textbook.semester === 1 ? '上' : '下'}學期｜${esc(counts)}｜給 ${b.students.join('、')}｜${esc(p.batchId)} v${p.version}</span></div>
        <div class="bq-pbtns">
          ${STUDENTS.filter(st => b.students.includes(st)).map(st => `<button class="outline" data-exp="${b.id}" data-st="${st}">匯出 ${st} 成績</button>`).join('')}
          <button class="outline" data-arc="${b.id}">${b.archived ? '取消封存' : '封存'}</button>
          ${used ? '' : `<button class="ghost" data-del="${b.id}">刪除</button>`}
        </div></div>`;
    }).join('') : '<p class="muted">還沒有匯入任何題庫。</p>';
    document.querySelectorAll('[data-exp]').forEach(btn => {
      btn.onclick = () => exportResults(store.banks[btn.dataset.exp], [btn.dataset.st]);
    });
    document.querySelectorAll('[data-arc]').forEach(btn => {
      btn.onclick = () => {
        const b = store.banks[btn.dataset.arc];
        b.archived = !b.archived;
        persist();
        refresh();
      };
    });
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => {
        const b = store.banks[btn.dataset.del];
        if (!confirm(`確定刪除「${b.package.title}」？（還沒有人作答，才可以刪除）`)) return;
        delete store.banks[b.id];
        persist();
        refresh();
      };
    });
  }

  function refresh() {
    if (view.mode !== 'list') {
      const ctx = currentContext();
      if (!ctx) view = { mode: 'list' };
    }
    render();
    renderParent();
  }

  async function doImport(text) {
    const msg = $('bqImportMsg');
    msg.className = 'bq-msg';
    msg.textContent = '檢查中…';
    try {
      const { bank, duplicate } = await importPackage(text);
      msg.className = 'bq-msg ok';
      const g = GRADE_CODE[bank.package.textbook.grade];
      msg.textContent = duplicate
        ? `「${bank.package.title}」之前已經匯入過，內容相同，不用再匯入。`
        : `匯入成功：「${bank.package.title}」（${curriculum[g].label}，給 ${bank.students.join('、')}）。`;
      if ($('grade').value !== g) {
        $('grade').value = g;
        $('grade').dispatchEvent(new Event('change'));
      }
      $('bqPaste').value = '';
      refresh();
    } catch (e) {
      msg.className = 'bq-msg bad';
      msg.textContent = '無法匯入：' + e.message;
    }
  }

  function exportBackup() {
    download(`完整備份-${stamp(Date.now())}.json`, { exportType: 'family-practice-backup', exportedAt: new Date().toISOString(), batch: store, legacy: localStorage.getItem('familyPracticeV1') });
  }

  function importBackup(text) {
    let b;
    try {
      b = JSON.parse(text);
    } catch {
      return alert('備份檔不是正確的 JSON。');
    }
    if (!b || b.exportType !== 'family-practice-backup' || !b.batch) return alert('這不是本網站的完整備份檔。');
    let added = 0;
    for (const [id, bank] of Object.entries(b.batch.banks || {})) {
      if (!store.banks[id]) {
        store.banks[id] = bank;
        added++;
      }
    }
    for (const st of STUDENTS) {
      for (const [k, r] of Object.entries((b.batch.rounds || {})[st] || {})) {
        const cur = store.rounds[st][k];
        // 只補上沒有的紀錄，或用已交卷的紀錄取代未交卷的；不覆蓋已交卷紀錄
        if (!cur || (cur.status !== 'submitted' && r.status === 'submitted')) {
          store.rounds[st][k] = r;
          added++;
        }
      }
      for (const kind of ['tutorLogs', 'focusLogs']) {
        const have = new Set(store[kind][st].map(l => l.id));
        for (const l of (b.batch[kind] || {})[st] || []) {
          if (!have.has(l.id)) {
            store[kind][st].push(l);
            added++;
          }
        }
      }
    }
    if (persist()) alert(`備份已合併，新增 ${added} 筆資料。原本已有的紀錄都沒有被覆蓋。`);
    refresh();
  }

  function init() {
    $('bqImportBtn').onclick = () => {
      const text = $('bqPaste').value.trim();
      if (!text) return alert('請先選擇 JSON 檔，或把 JSON 內容貼在框裡。');
      doImport(text);
    };
    $('bqFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      doImport(await f.text());
      e.target.value = '';
    };
    $('bqBackup').onclick = exportBackup;
    $('bqRestore').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      importBackup(await f.text());
      e.target.value = '';
    };
    $('student').addEventListener('change', () => {
      view = { mode: 'list' };
      refresh();
    });
    $('grade').addEventListener('change', () => {
      view = { mode: 'list' };
      refresh();
    });
    refresh();
  }

  window.familyBatch = { validatePackage, gradeItem, matches, analysis, store: () => store };
  init();
})();
