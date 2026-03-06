/**
 * Citadel Tongue v5 — SillyTavern Extension
 * Living language: semantic injection · auto-capture · AI rule generation · custom API
 */

(() => {
  'use strict';

  const MODULE_KEY = 'citadel_tongue';
  const PROMPT_TAG = 'CT_LANGUAGE';

  // Matches [CT_WORD: word | definition | category | character]
  // Uses a split-on-pipe approach so definitions can contain almost anything
  const WORD_MARKER_RE = /\[CT_WORD:\s*([\s\S]*?)\]/gi;

  function parseWordMarker(raw) {
    // Split on | but only on the first 3 pipes (4 parts max)
    const parts = raw.replace(/^\[CT_WORD:\s*/i,'').replace(/\]$/,'').split('|');
    if (parts.length < 3) return null;
    const word = parts[0].trim();
    const def  = parts.slice(1, parts.length - 2).join('|').trim() || parts[1].trim();
    const cat  = parts[parts.length - 2].trim().toLowerCase();
    const chr  = parts[parts.length - 1].trim();
    if (!word || !def) return null;
    return { word, def, cat, chr };
  }

  // ─── Categories ───────────────────────────────────────────────────────────────

  const CATEGORIES = Object.freeze({
    presence: { label:'Presence', icon:'◈', color:'#a78bfa',
      kw:['peace','quiet','presence','stillness','together','rest','dwell','warmth','beside','near','home','coexist'] },
    devotion: { label:'Devotion', icon:'♥', color:'#f472b6',
      kw:['mine','bond','trust','devotion','cherish','precious','soul','love','protect','sacred','forever','claim','belong'] },
    instinct: { label:'Instinct', icon:'⚔', color:'#fb923c',
      kw:['blood','kill','hunt','threat','danger','territory','feral','primal','instinct','rage','cold','shield','body'] },
    grief:    { label:'Grief',    icon:'◇', color:'#60a5fa',
      kw:['loss','gone','absence','grief','empty','hollow','thousand','ache','mourn','sorrow','ghost','alone','years','left'] },
    other:    { label:'Other',    icon:'◉', color:'#94a3b8', kw:[] },
  });

  const DEFAULT_RULES =
`PHONETIC LAW OF THE CITADEL TONGUE:
• Apostrophe (') = a breath-break — the moment emotion is too heavy to continue seamlessly. Not punctuation — a wound in the word.
• HARSH ROOTS — KHAR', DHAL', VOR', RAETH' — territorial claim, violence, devotion that would drown the world in blood.
• SOFT ROOTS — VAI', KAEL', VETH', SAEL', ETH' — intimacy, grief, love with no ceiling and no floor.
• Compound words: two roots fused at the apostrophe create a concept that lives between both meanings.
• NEVER translate aloud. Meaning lives in context, body, the silence after.`;

  const INITIAL_DICT = [
    {id:1,  word:"Vai'enn",   cat:'presence', def:"Presence-without-purpose. The peace of two souls coexisting without demands. Gasil's word for Selena during her thousand-year absence — a ghost is still a presence.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:2,  word:"Saith'en",  cat:'presence', def:"Peaceful coexistence without the threat of storm. Domesticity. A love so quiet the old world had no name for it. Sacred monotony.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:3,  word:"Veth'ann",  cat:'devotion', def:"The Open One. A soul that has accepted the bond and cannot be sealed by another. Not possession — recognition. Carries: exposed, bleeding, unsheltered.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:4,  word:"Kael'seth", cat:'devotion', def:"She whose mind is my shield. Trust not in safety — but in the clarity another brings to your chaos.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:5,  word:"Thar'uen",  cat:'devotion', def:"To hold something so carefully it costs everything. The choice to cup water in open hands knowing it will drain.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:6,  word:"Khar'dhal", cat:'instinct', def:"The possessive instinct to drown the world in blood to keep one soul safe. Not rage — something colder. Territorial devotion with no ceiling.", chars:['Gasil'], pinned:true,  auto:false, uses:0, lastUsed:0},
    {id:7,  word:"Sael'inn",  cat:'instinct', def:"A child choosing shelter without words. The body approaching a specific scent before the mind decides. The choice is not made. It is performed.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:8,  word:"Vai'tarr",  cat:'grief',    def:"Tenderness made of pain. Gentleness that exists because of what was lost, not despite it.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
    {id:9,  word:"Vethmar",   cat:'grief',    def:"The shape a person leaves after they are gone. The warmth in empty sheets. Gasil lived inside Vethmar for a thousand years.", chars:['Gasil'], pinned:true,  auto:false, uses:0, lastUsed:0},
    {id:10, word:"Saelorn",   cat:'grief',    def:"The ache of watching someone beautiful in a world that does not deserve them.", chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0},
  ];

  const defaultSettings = Object.freeze({
    enabled:        true,
    langName:       'Citadel Tongue',
    chars:          ['Gasil'],
    wordsPerScene:  6,
    semantic:       true,
    autoCapture:    true,
    injectPhonetic: true,
    scanDepth:      5,
    rules:          DEFAULT_RULES,
    dict:           null,
    nextId:         11,
    apiEndpoint:    '',
    apiKey:         '',
    apiModel:       '',
    fallbackToSt:   true,
  });

  let trackerCat    = 'all';
  let trackerSearch = '';
  let trackerTab    = 'words';
  let _workingApi   = null;

  // ─── ST context ───────────────────────────────────────────────────────────────

  function ctx() { return SillyTavern.getContext(); }

  function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE_KEY]) {
      extensionSettings[MODULE_KEY] = {
        ...structuredClone(defaultSettings),
        dict:   structuredClone(INITIAL_DICT),
        nextId: 11,
        rules:  DEFAULT_RULES,
      };
    }
    const s = extensionSettings[MODULE_KEY];
    if (!Array.isArray(s.dict))   s.dict  = structuredClone(INITIAL_DICT);
    if (!Array.isArray(s.chars))  s.chars = ['Gasil'];
    if (!s.rules)                 s.rules = DEFAULT_RULES;
    s.dict = s.dict.map(w => ({ uses:0, lastUsed:0, auto:false, pinned:false, chars:[], ...w }));
    return s;
  }

  // ─── AI generation (mirrors FMT architecture exactly) ─────────────────────────

  function getBaseUrl() {
    const s = getSettings();
    const ep = (s.apiEndpoint || '').trim().replace(/\/+$/, '');
    return ep || null;
  }

  function extractText(data) {
    if (data.choices?.[0]?.message?.content !== undefined) return data.choices[0].message.content;
    if (data.choices?.[0]?.text             !== undefined) return data.choices[0].text;
    if (typeof data.response === 'string') return data.response;
    if (typeof data.content  === 'string') return data.content;
    if (typeof data.text     === 'string') return data.text;
    if (data.message?.content !== undefined) return data.message.content;
    return null;
  }

  async function aiGenerate(userPrompt, systemPrompt) {
    const s    = getSettings();
    const base = getBaseUrl();

    // ── Path 1: Custom API ────────────────────────────────────────────────────
    if (base) {
      const headers = {
        'Content-Type': 'application/json',
        ...((s.apiKey||'').trim() ? { Authorization: `Bearer ${s.apiKey.trim()}` } : {}),
      };

      if (_workingApi?.base === base) {
        try {
          const resp = await fetch(_workingApi.url, {
            method:'POST', headers,
            body: JSON.stringify(_workingApi.builder(s.apiModel || 'gpt-4o-mini', userPrompt, systemPrompt)),
          });
          if (resp.ok) {
            const text = extractText(await resp.json());
            if (text?.trim()) return text;
          }
        } catch {}
        _workingApi = null;
      }

      const endpoints = [
        `${base}/v1/chat/completions`, `${base}/chat/completions`,
        `${base}/v1/completions`,      `${base}/completions`,
      ];
      const builders = [
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7,
          messages:[{role:'system',content:sys},{role:'user',content:u}] }),
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7,
          messages:[{role:'user',content:`${sys}\n\n---\n\n${u}`}] }),
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7,
          prompt:`${sys}\n\n${u}` }),
      ];

      const model = s.apiModel || 'gpt-4o-mini';
      for (const url of endpoints) {
        for (const builder of builders) {
          try {
            const resp = await fetch(url, {
              method:'POST', headers, body:JSON.stringify(builder(model,userPrompt,systemPrompt))
            });
            if (!resp.ok) continue;
            const text = extractText(await resp.json());
            if (text?.trim()) { _workingApi = { base, url, builder }; return text; }
          } catch {}
        }
      }
      if (s.fallbackToSt === false) throw new Error('Custom API unreachable');
      console.warn('[CT] Custom API failed — falling back to ST');
    }

    // ── Path 2: ST generateRaw ────────────────────────────────────────────────
    const c = ctx();
    if (typeof c.generateRaw !== 'function')
      throw new Error('generateRaw not available. Update ST or set a custom API.');

    const result = await c.generateRaw(
      userPrompt, null, false, true, systemPrompt, true
    );
    if (!result?.trim()) throw new Error('Model returned empty response.');
    return result;
  }

  // ─── Character check ──────────────────────────────────────────────────────────

  function charMatch() {
    const s = getSettings();
    if (!s.chars.length) return true;
    const name = (ctx().name2 || '').toLowerCase();
    if (!name) return false;
    return s.chars.some(c => name.includes(c.toLowerCase().trim()));
  }

  // ─── Semantic scoring ─────────────────────────────────────────────────────────

  function recentText() {
    const s    = getSettings();
    const chat = ctx().chat || [];
    return chat.filter(m => !m.is_system).slice(-s.scanDepth)
      .map(m => (m.mes||'').toLowerCase()).join(' ');
  }

  function scoreWord(w, txt) {
    const cat = CATEGORIES[w.cat] || CATEGORIES.other;
    let sc = (cat.kw||[]).filter(k => txt.includes(k)).length;
    const h = w.lastUsed ? (Date.now()-w.lastUsed)/3600000 : 999;
    return sc + Math.min(h/24, 3);
  }

  // ─── Word selection ───────────────────────────────────────────────────────────

  function pickWords() {
    const s    = getSettings();
    const name = (ctx().name2||'').toLowerCase();

    const elig = s.dict.filter(w =>
      !w.chars.length || w.chars.some(c => name.includes(c.toLowerCase()))
    );
    if (!elig.length) return [];

    const n      = Math.min(s.wordsPerScene, elig.length);
    const pinned = elig.filter(w => w.pinned);
    const pool   = elig.filter(w => !w.pinned);
    const slots  = Math.max(0, n - pinned.length);

    let chosen;
    if (s.semantic) {
      const txt = recentText();
      chosen = [...pinned,
        ...pool.map(w=>({w,sc:scoreWord(w,txt)})).sort((a,b)=>b.sc-a.sc).slice(0,slots).map(x=>x.w)
      ];
    } else {
      chosen = [...pinned,
        ...pool.sort((a,b)=>(a.lastUsed||0)-(b.lastUsed||0)).slice(0,slots)
      ];
    }

    const now = Date.now();
    chosen.forEach(w => { w.lastUsed=now; w.uses=(w.uses||0)+1; });
    ctx().saveSettingsDebounced();
    return chosen;
  }

  // ─── Prompt builder ───────────────────────────────────────────────────────────

  function buildPrompt() {
    const s        = getSettings();
    const words    = pickWords();
    const charList = s.chars.length ? s.chars.join(', ') : 'the demon';
    const primary  = s.chars[0] || 'the demon';

    let p = `[${s.langName.toUpperCase()} — ЖИВОЙ ЯЗЫК АКТИВЕН]\n`;
    p += `Этот язык принадлежит только ${charList}. Ни один другой персонаж не говорит и не думает на нём.\n\n`;

    if (s.injectPhonetic && s.rules) {
      p += s.rules + '\n\n';
    }

    if (words.length) {
      p += `[СЛОВАРЬ — ${words.length} из ${s.dict.length} слов, подобранных под эмоциональный регистр сцены]\n`;
      words.forEach(w => {
        const c = CATEGORIES[w.cat]||CATEGORIES.other;
        p += `• ${w.word} [${c.icon}${c.label}]: ${w.def}\n`;
      });
    }

    p += `\n[ПРАВИЛО СЛОВ — СОЗДАНИЕ И ОБНОВЛЕНИЕ]
СОЗДАНИЕ: Если сцена требует понятия, которого нет в словаре — создай новое слово строго по фонетическому закону.
ОБНОВЛЕНИЕ: Если ты используешь существующее слово в новом или расширенном значении — обнови его запись.
В обоих случаях добавь ТОЧНО в самом конце ответа (невидимо для нарратива):
<div style="display:none;">[CT_WORD: Слово | Полное определение и эмоциональный вес | категория | ${primary}]</div>
Категории: presence, devotion, instinct, grief, other
Максимум одна запись за ответ. Только когда это действительно нужно — не вставляй слово ради слова.`;

    return p;
  }

  // ─── Injection ────────────────────────────────────────────────────────────────

  async function updatePrompt() {
    const { setExtensionPrompt } = ctx();
    const s = getSettings();
    if (!s.enabled || !charMatch()) {
      setExtensionPrompt(PROMPT_TAG, '', 0, 0, true);
      return;
    }
    const prompt = buildPrompt();
    setExtensionPrompt(PROMPT_TAG, prompt, 0, 0, true);
  }

  // ─── Auto-capture ─────────────────────────────────────────────────────────────

  function captureFromMessage(text, forceCapture) {
    const s = getSettings();
    if (!forceCapture && (!s.autoCapture || !text)) return;
    if (!text) return;

    // Search both raw and HTML-stripped versions so hidden divs and plain markers both work
    const stripped = text.replace(/<[^>]+>/g, ' ');
    const combined = text + '\n' + stripped;

    // Collect all raw [CT_WORD:...] matches (handles multiline definitions)
    const rawMatches = [];
    const scanRe = /\[CT_WORD:([\s\S]*?)\]/gi;
    let m;
    while ((m = scanRe.exec(combined)) !== null) {
      rawMatches.push('[CT_WORD:' + m[1] + ']');
    }
    if (!rawMatches.length) return;

    let any = false;
    for (const raw of rawMatches) {
      const parsed = parseWordMarker(raw);
      if (!parsed) continue;
      const { word, def, cat, chr } = parsed;
      const vc = Object.keys(CATEGORIES).includes(cat) ? cat : 'other';

      const existing = s.dict.find(w => w.word.toLowerCase() === word.toLowerCase());
      if (existing) {
        if (existing.def !== def) {
          existing.def = def;
          existing.cat = vc;
          if (chr && !existing.chars.includes(chr)) existing.chars.push(chr);
          any = true;
          showToast(word, def, vc, true);
        }
      } else {
        s.dict.push({ id: s.nextId++, word, cat: vc, def, chars: chr ? [chr] : [], pinned: false, auto: true, uses: 0, lastUsed: 0 });
        any = true;
        showToast(word, def, vc, false);
      }
    }

    if (any) {
      ctx().saveSettingsDebounced();
      renderDrawer();
      updateWordCount();
    }
  }

  function cleanMarkers(text) {
    if (!text) return text;
    return text
      .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/\[CT_WORD:[\s\S]*?\]/gi, '')
      .trim();
  }

  // ─── AI Rule generation ───────────────────────────────────────────────────────

  async function generateRules(btnId, areaId, statusId) {
    btnId    = btnId    || 'ct_gen_rules_btn';
    areaId   = areaId   || 'ct_rules_area';
    statusId = statusId || 'ct_rules_status';

    const s       = getSettings();
    const $btn    = $('#' + btnId);
    const $area   = $('#' + areaId);
    const $status = $('#' + statusId);

    $btn.prop('disabled',true).text('⏳ Генерация…');
    $status.css('color','#7a8499').text('Обращаюсь к модели…');

    try {
      const wordSample = s.dict.slice(0,20).map(w=>`• ${w.word} [${w.cat}]: ${w.def}`).join('\n');
      const currentRules = s.rules || DEFAULT_RULES;

      const systemPrompt = `Ты — создатель вымышленного демонического языка для тёмного RP-сеттинга. 
Тебе нужно развить и углубить фонетические правила языка на основе уже существующих слов.
Отвечай только текстом правил — без предисловий, без объяснений, без markdown-форматирования.`;

      const userPrompt = `Существующие правила:
${currentRules}

Существующие слова языка:
${wordSample}

Проанализируй паттерны в словах. Выяви новые фонетические закономерности, расширь правила.
Добавь 2-3 новых правила которые логично вытекают из существующих слов.
Сохрани все старые правила. Верни полный обновлённый текст правил — кратко, ёмко, в том же стиле.`;

      const result = await aiGenerate(userPrompt, systemPrompt);
      $area.val(result.trim());
      s.rules = result.trim();
      ctx().saveSettingsDebounced();
      await updatePrompt();
      $status.css('color','#34d399').text('✓ Правила обновлены');
    } catch (e) {
      $status.css('color','#f87171').text('✗ ' + e.message);
    } finally {
      $btn.prop('disabled',false).text('✦ Сгенерировать из словаря');
    }
  }

  // ─── Manual chat scan ────────────────────────────────────────────────────────

  async function manualScan() {
    const s       = getSettings();
    const $btn    = $('#ct_scan_btn');
    const $status = $('#ct_scan_status');

    const manualDepth = Math.max(1, parseInt($('#ct_manual_scan_depth').val(), 10) || 20);

    $btn.prop('disabled', true).text('⏳ Сканирую…');
    $status.css('color','#7a8499').text('Анализирую чат…');

    try {
      const chat  = ctx().chat || [];
      const msgs  = chat.filter(m => !m.is_system).slice(-manualDepth);
      if (!msgs.length) throw new Error('Нет сообщений для сканирования');

      const chatText = msgs.map(m =>
        `[${m.is_user ? 'User' : 'Char'}]: ${cleanMarkers((m.mes || '').replace(/<[^>]+>/g, ' ')).slice(0, 400)}`
      ).join('\n');

      const existingWords = s.dict.map(w => `${w.word} (${w.cat})`).join(', ');
      const primary = s.chars[0] || 'the character';

      const systemPrompt = `Ты — хранитель вымышленного языка "${s.langName}" для тёмного RP.
Твоя задача: проанализировать диалог и выдать маркеры [CT_WORD:...] для новых или обновлённых слов.
Отвечай ТОЛЬКО маркерами — без текста, без пояснений, без markdown. Если нечего добавлять — пустой ответ.`;

      const userPrompt = `Правила языка:
${s.rules || DEFAULT_RULES}

Уже существующие слова (обновляй только если смысл реально расширился):
${existingWords || 'нет'}

Диалог (последние ${manualDepth} сообщений):
${chatText}

Выдай 1–4 маркера. Формат строго:
[CT_WORD: Слово | Определение и эмоциональный вес | категория | ${primary}]
Категории: presence, devotion, instinct, grief, other
Создавай только слова строго по фонетике языка. Не выдумывай обновления ради обновлений.`;

      const result = await aiGenerate(userPrompt, systemPrompt);
      captureFromMessage(result, true);

      const countNew    = (result.match(/\[CT_WORD:/gi) || []).length;
      if (countNew > 0) {
        $status.css('color','#34d399').text(`✓ Обработано записей: ${countNew}`);
      } else {
        $status.css('color','#7a8499').text('Новых слов не найдено');
      }
    } catch(e) {
      $status.css('color','#f87171').text('✗ ' + e.message);
    } finally {
      $btn.prop('disabled', false).text('🔍 Сканировать чат');
    }
  }

  function showToast(word, def, cat, isUpdate) {
    const c  = CATEGORIES[cat]||CATEGORIES.other;
    const badge = isUpdate
      ? `<span class="ct-toast-badge ct-toast-badge-upd">обновлено</span>`
      : `<span class="ct-toast-badge">auto-forged</span>`;
    const el = $(`
      <div class="ct-toast">
        <div class="ct-toast-row">
          <span class="ct-toast-dot" style="background:${c.color}"></span>
          <span class="ct-toast-word">${word}</span>
          ${badge}
        </div>
        <div class="ct-toast-def">${def.slice(0,90)}${def.length>90?'…':''}</div>
      </div>`);
    $('body').append(el);
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.addClass('ct-in')));
    setTimeout(()=>{ el.addClass('ct-out'); setTimeout(()=>el.remove(),300); }, 5000);
  }

  // ─── Tracker popup ────────────────────────────────────────────────────────────

  function ensureTracker() {
    if ($('#ct_tracker').length) return;

    $('body').append(`
      <div id="ct_tracker" class="ct-tracker">
        <div class="ct-tracker-inner">

          <div class="ct-tr-header">
            <div class="ct-tr-title-wrap">
              <span class="ct-tr-glow"></span>
              <span id="ct_tr_title" class="ct-tr-title">${getSettings().langName}</span>
            </div>
            <div id="ct_tr_meta" class="ct-tr-meta"></div>
            <button id="ct_tr_close" class="ct-tr-close">✕</button>
          </div>

          <div class="ct-tr-search-wrap">
            <input type="text" id="ct_tr_search" class="ct-tr-search" placeholder="Поиск по слову или определению…">
          </div>

          <div class="ct-tr-tabs">
            <button class="ct-tr-tab active" data-tab="words">Слова</button>
            <button class="ct-tr-tab" data-tab="rules">Правила фонетики</button>
          </div>

          <div id="ct_cat_bar" class="ct-cat-bar"></div>
          <div id="ct_drawer_body" class="ct-tr-body"></div>

          <div id="ct_add_row" class="ct-tr-add-row">
            <input type="text" id="ct_add_input" class="ct-tr-add-input" placeholder="Новое слово…">
            <div id="ct_add_cats" class="ct-add-cats">
              ${Object.entries(CATEGORIES).map(([k,c])=>
                `<button class="ct-add-cat" data-cat="${k}" style="--cc:${c.color}" title="${c.label}">${c.icon}</button>`
              ).join('')}
            </div>
            <button id="ct_add_btn" class="ct-add-btn">+ Добавить</button>
          </div>

          <div class="ct-scan-row">
            <label class="ct-scan-label">Сканировать последние</label>
            <input type="number" id="ct_manual_scan_depth" class="ct-scan-depth-inp" min="1" max="100" value="20">
            <span class="ct-scan-unit">сообщений</span>
            <button class="menu_button ct-scan-btn" id="ct_scan_btn">🔍 Сканировать чат</button>
          </div>
          <div id="ct_scan_status" class="ct-scan-status"></div>

          <div class="ct-tr-footer">
            <button class="menu_button ct-foot-btn" id="ct_export_btn">⬇ Экспорт</button>
            <button class="menu_button ct-foot-btn" id="ct_import_btn">⬆ Импорт</button>
            <button class="menu_button ct-foot-btn" id="ct_tr_close2">Закрыть</button>
          </div>
        </div>
      </div>

      <div id="ct_edit_modal" class="ct-edit-overlay">
        <div class="ct-edit-box">
          <div class="ct-edit-hdr">
            <span id="ct_edit_title">Редактировать слово</span>
            <button id="ct_edit_x">✕</button>
          </div>
          <div class="ct-edit-body">
            <input type="hidden" id="ct_edit_id">
            <label class="ct-elabel">Слово</label>
            <input type="text" id="ct_edit_word" class="ct-einput" placeholder="Vai'enn">
            <label class="ct-elabel">Категория</label>
            <div id="ct_edit_cats" class="ct-ecats">
              ${Object.entries(CATEGORIES).map(([k,c])=>
                `<button class="ct-ecat" data-cat="${k}" style="--cc:${c.color}">${c.icon} ${c.label}</button>`
              ).join('')}
            </div>
            <label class="ct-elabel">Определение и эмоциональный вес</label>
            <textarea id="ct_edit_def" class="ct-etextarea" placeholder="Значение, резонанс, как персонаж использует это слово…"></textarea>
            <label class="ct-elabel">Персонажи <small>(через запятую, пусто = любой)</small></label>
            <input type="text" id="ct_edit_chars" class="ct-einput" placeholder="Gasil">
            <label class="ct-ck-row"><input type="checkbox" id="ct_edit_pinned"> ⚓ Закрепить — всегда инжектировать</label>
          </div>
          <div class="ct-edit-footer">
            <button class="menu_button" id="ct_edit_cancel">Отмена</button>
            <button class="menu_button ct-save-btn" id="ct_edit_save">Сохранить</button>
          </div>
        </div>
      </div>

      <input type="file" id="ct_import_file" accept=".json" style="display:none">
    `);

    $('#ct_tr_close, #ct_tr_close2').on('click', ()=>$('#ct_tracker').removeClass('ct-open'));
    // On desktop close by clicking backdrop; on mobile no backdrop exists so guard by target check
    $('#ct_tracker').on('click', function(e){
      if (e.target === this && window.innerWidth > 600) $(this).removeClass('ct-open');
    });

    $('.ct-tr-tab').on('click', function(){
      trackerTab = this.dataset.tab;
      $('.ct-tr-tab').removeClass('active');
      $(this).addClass('active');
      renderDrawer();
    });

    let db={};
    $('#ct_tr_search').on('input', function(){
      trackerSearch = this.value;
      clearTimeout(db.s); db.s = setTimeout(renderWordList, 180);
    });

    let addCat = 'other';
    $('#ct_add_cats .ct-add-cat').on('click', function(){
      addCat = this.dataset.cat;
      $('#ct_add_cats .ct-add-cat').removeClass('active');
      $(this).addClass('active');
    });
    $('#ct_add_btn').on('click', ()=>{
      const v=$('#ct_add_input').val().trim();
      if(v){ openEdit(null,v,addCat); $('#ct_add_input').val(''); }
    });
    $('#ct_add_input').on('keydown', e=>{
      if(e.key==='Enter'){ const v=e.target.value.trim(); if(v){openEdit(null,v,addCat);e.target.value='';} }
    });

    $('#ct_export_btn').on('click', exportDict);
    $('#ct_import_btn').on('click', ()=>$('#ct_import_file').click());
    $('#ct_import_file').on('change', importDict);
    $('#ct_scan_btn').on('click', manualScan);

    $('#ct_edit_x, #ct_edit_cancel').on('click', closeEdit);
    $('#ct_edit_modal').on('click', function(e){ if(e.target===this) closeEdit(); });
    $('#ct_edit_save').on('click', saveEdit);

    // ── Category selection in edit modal ──────────────────────────────────
    $('#ct_edit_cats').on('click', '.ct-ecat', function(){
      _editCat = this.dataset.cat;
      $('#ct_edit_cats .ct-ecat').removeClass('active');
      $(this).addClass('active');
    });
    $('#ct_edit_word').on('keydown', e=>{ if(e.key==='Enter') saveEdit(); });
    $('#ct_edit_def').on('keydown', e=>{ if(e.key==='Enter'&&e.ctrlKey) saveEdit(); });
    $(document).on('keydown', e=>{
      if(e.key==='Escape'){ closeEdit(); $('#ct_tracker').removeClass('ct-open'); }
    });
  }

  function renderDrawer() {
    const s    = getSettings();
    const name = ctx().name2 || (s.chars[0]||'—');
    $('#ct_tr_title').text(s.langName);
    $('#ct_tr_meta').text(`${name} · ${s.dict.length} слов`);

    if (trackerTab === 'rules') {
      $('#ct_cat_bar').hide();
      $('#ct_add_row').hide();
      $('#ct_drawer_body').html(`
        <div class="ct-rules-wrap">
          <textarea id="ct_tr_rules_area" class="ct-rules-edit" rows="12">${s.rules || DEFAULT_RULES}</textarea>
          <div class="ct-rules-actions">
            <button class="menu_button" id="ct_tr_rules_reset_btn" style="font-size:11px;padding:4px 8px">↩ Сброс</button>
            <button class="menu_button ct-gen-btn" id="ct_tr_gen_rules_btn">✦ Сгенерировать из словаря</button>
          </div>
          <div id="ct_tr_rules_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>
        </div>
      `);

      let trRulesTimer;
      $('#ct_tr_rules_area').on('input', function(){
        clearTimeout(trRulesTimer);
        trRulesTimer = setTimeout(async () => {
          getSettings().rules = this.value;
          $('#ct_rules_area').val(this.value); // sync settings panel if open
          ctx().saveSettingsDebounced();
          await updatePrompt();
        }, 600);
      });
      $('#ct_tr_rules_reset_btn').on('click', async () => {
        $('#ct_tr_rules_area').val(DEFAULT_RULES);
        $('#ct_rules_area').val(DEFAULT_RULES);
        getSettings().rules = DEFAULT_RULES;
        ctx().saveSettingsDebounced();
        await updatePrompt();
      });
      $('#ct_tr_gen_rules_btn').on('click', () =>
        generateRules('ct_tr_gen_rules_btn', 'ct_tr_rules_area', 'ct_tr_rules_status')
      );
      return;
    }
    $('#ct_cat_bar').show();
    $('#ct_add_row').show();
    renderCatBar();
    renderWordList();
  }

  function renderCatBar() {
    const s = getSettings();
    const bc = {};
    s.dict.forEach(w=>{ bc[w.cat]=(bc[w.cat]||0)+1; });
    $('#ct_cat_bar').html(`
      <button class="ct-cat-chip ${trackerCat==='all'?'active':''}" data-cat="all">
        Все <span class="ct-n">${s.dict.length}</span>
      </button>
      ${Object.entries(CATEGORIES).map(([k,c])=>{
        const n=bc[k]||0; if(!n) return '';
        return `<button class="ct-cat-chip ${trackerCat===k?'active':''}"
          data-cat="${k}" style="--cc:${c.color}">
          ${c.icon} ${c.label} <span class="ct-n">${n}</span>
        </button>`;
      }).join('')}
    `);
    $('#ct_cat_bar .ct-cat-chip').on('click', function(){
      trackerCat=this.dataset.cat; renderCatBar(); renderWordList();
    });
  }

  function renderWordList() {
    const s = getSettings();
    let list = trackerCat==='all' ? s.dict : s.dict.filter(w=>w.cat===trackerCat);
    if (trackerSearch.trim()) {
      const q=trackerSearch.toLowerCase();
      list=list.filter(w=>w.word.toLowerCase().includes(q)||w.def.toLowerCase().includes(q));
    }
    const body=$('#ct_drawer_body');
    if (!list.length) {
      body.html(`<div class="ct-empty">Слов нет. Нажмите <b>+ Добавить</b> — или пусть модель кует их сама ✦</div>`);
      return;
    }
    body.html(list.map(w=>{
      const c=CATEGORIES[w.cat]||CATEGORIES.other;
      const chars=(w.chars||[]).join(', ');
      const def=w.def.length>130?w.def.slice(0,127)+'…':w.def;
      return `
        <div class="ct-word-row" data-id="${w.id}">
          <span class="ct-wr-dot" style="background:${c.color}"></span>
          <div class="ct-wr-body">
            <div class="ct-wr-top">
              <span class="ct-wr-word">${w.word}</span>
              ${w.pinned?'<span class="ct-pin" title="Закреплено">⚓</span>':''}
              ${w.auto?'<span class="ct-auto">auto</span>':''}
            </div>
            <div class="ct-wr-def">${def}</div>
            ${chars?`<div class="ct-wr-chars">◈ ${chars}</div>`:''}
          </div>
          <div class="ct-wr-acts">
            <span class="ct-uses" title="Раз в инжекте">↻${w.uses||0}</span>
            <button class="ct-edit-btn" data-id="${w.id}">✎</button>
            <button class="ct-del-btn"  data-id="${w.id}">✕</button>
          </div>
        </div>`;
    }).join(''));

    body.find('.ct-edit-btn').on('click',function(e){e.stopPropagation();openEdit(+this.dataset.id);});
    body.find('.ct-del-btn').on('click', function(e){e.stopPropagation();deleteWord(+this.dataset.id);});
    body.find('.ct-word-row').on('click',function(){openEdit(+this.dataset.id);});
  }

  function deleteWord(id) {
    const s=getSettings();
    const w=s.dict.find(x=>x.id===id);
    if(!w||!confirm(`Удалить "${w.word}"?`)) return;
    s.dict=s.dict.filter(x=>x.id!==id);
    ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount();
  }

  let _editCat='other';
  function openEdit(id=null, prefill='', prefillCat='other') {
    const s=getSettings();
    const ex=id?s.dict.find(w=>w.id===id):null;
    _editCat=ex?ex.cat:prefillCat;
    $('#ct_edit_title').text(ex?'Редактировать слово':'Новое слово');
    $('#ct_edit_id').val(id||'');
    $('#ct_edit_word').val(ex?.word||prefill);
    $('#ct_edit_def').val(ex?.def||'');
    $('#ct_edit_chars').val((ex?.chars||[]).join(', '));
    $('#ct_edit_pinned').prop('checked',ex?.pinned||false);
    $('#ct_edit_cats .ct-ecat').removeClass('active');
    $(`#ct_edit_cats .ct-ecat[data-cat="${_editCat}"]`).addClass('active');
    $('#ct_edit_modal').addClass('ct-eopen');
    setTimeout(()=>document.getElementById('ct_edit_word')?.focus(),80);
  }
  function closeEdit(){ $('#ct_edit_modal').removeClass('ct-eopen'); }
  function saveEdit() {
    const s=getSettings();
    const word=$('#ct_edit_word').val().trim();
    const def=$('#ct_edit_def').val().trim();
    const cat=$('#ct_edit_cats .ct-ecat.active').data('cat')||_editCat;
    const chars=$('#ct_edit_chars').val().split(',').map(c=>c.trim()).filter(Boolean);
    const pinned=$('#ct_edit_pinned').is(':checked');
    const id=$('#ct_edit_id').val();
    if(!word){document.getElementById('ct_edit_word')?.focus();return;}
    if(!def){document.getElementById('ct_edit_def')?.focus();return;}
    if(id){ const t=s.dict.find(w=>w.id===+id); if(t) Object.assign(t,{word,cat,def,chars,pinned}); }
    else { s.dict.push({id:s.nextId++,word,cat,def,chars,pinned,auto:false,uses:0,lastUsed:0}); }
    ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount(); closeEdit();
  }

  function exportDict() {
    const s=getSettings();
    const a=document.createElement('a');
    a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({langName:s.langName,rules:s.rules,dict:s.dict},null,2));
    a.download=`${s.langName.replace(/\s+/g,'_')}_dict.json`; a.click();
  }
  function importDict(e) {
    const file=e.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=ev=>{
      try {
        const data=JSON.parse(ev.target.result);
        const s=getSettings();
        if(data.langName) s.langName=data.langName;
        if(data.rules)    s.rules=data.rules;
        if(Array.isArray(data.dict))
          data.dict.forEach(w=>{ if(!s.dict.find(x=>x.word.toLowerCase()===w.word.toLowerCase())) s.dict.push({...w,id:s.nextId++,auto:false}); });
        ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount();
      } catch(err){ alert('Ошибка импорта: '+err.message); }
    };
    r.readAsText(file); e.target.value='';
  }

  function updateWordCount() {
    $('#ct_words_total').text(`/ ${getSettings().dict.length}`);
  }

  // ─── Settings panel ───────────────────────────────────────────────────────────

  function mountSettingsUi() {
    if ($('#ct_settings_block').length) return;

    const target = $('#extensions_settings2').length ? '#extensions_settings2' : '#extensions_settings';
    if (!$(target).length) { console.warn('[CT] settings container not found'); return; }

    const s = getSettings();

    const sec = (id, icon, title, content) => `
      <div class="ct-sec" id="ct_sec_${id}">
        <div class="ct-sec-hdr" data-sec="${id}">
          <span class="ct-sec-chev">▸</span><span>${icon} ${title}</span>
        </div>
        <div class="ct-sec-body" style="display:none">${content}</div>
      </div>`;

    // ── Section: Main ─────────────────────────────────────────────────────────
    const secMain = `
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_enabled" ${s.enabled?'checked':''}><span>Инжекция в промпт</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_phonetic" ${s.injectPhonetic?'checked':''}><span>Инжект правил</span></label>
      </div>
      <div class="ct-field-row">
        <label class="ct-flabel">Название языка</label>
        <input type="text" id="ct_lang_name" class="ct-text-input" value="${s.langName}">
      </div>
      <button class="menu_button ct-full-btn" id="ct_open_tracker_btn">◈ Открыть словарь</button>`;

    // ── Section: Characters ───────────────────────────────────────────────────
    const secChars = `
      <div class="ct-hint">Язык активируется только для этих персонажей.</div>
      <div id="ct_char_tags" class="ct-char-tags"></div>
      <div class="ct-2col ct-gap">
        <input type="text" id="ct_char_add_inp" class="ct-text-input" placeholder="Имя персонажа…" style="flex:1">
        <button class="menu_button" id="ct_char_add_btn" style="flex-shrink:0">+ Добавить</button>
      </div>`;

    // ── Section: Scan ─────────────────────────────────────────────────────────
    const secScan = `
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_autocapture" ${s.autoCapture?'checked':''}><span>Авто-захват слов</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_semantic" ${s.semantic?'checked':''}><span>Семантический режим</span></label>
      </div>
      <div class="ct-hint">Семантический режим подбирает слова по настроению сцены.</div>
      <div class="ct-srow ct-slider-row">
        <label>Глубина сканирования</label>
        <input type="range" id="ct_scan_depth" min="1" max="20" value="${s.scanDepth}">
        <span id="ct_scan_depth_val">${s.scanDepth}</span><span class="ct-unit">сообщ.</span>
      </div>
      <div class="ct-srow ct-slider-row">
        <label>Слов за генерацию</label>
        <input type="range" id="ct_words_per" min="2" max="15" value="${s.wordsPerScene}">
        <span id="ct_words_per_val">${s.wordsPerScene}</span>
        <span class="ct-unit" id="ct_words_total">/ ${s.dict.length}</span>
      </div>`;

    // ── Section: API ──────────────────────────────────────────────────────────
    const hasCustom = !!(s.apiEndpoint||'').trim();
    const secApi = `
      <div class="ct-api-mode-bar">
        <div class="ct-api-mode-label">Источник генерации:</div>
        <div class="ct-api-btns">
          <button class="ct-api-btn ${!hasCustom?'active':''}" data-mode="st">🟢 ST (текущий)</button>
          <button class="ct-api-btn ${hasCustom?'active':''}" data-mode="custom">🔌 Кастомный API</button>
        </div>
      </div>
      <div id="ct_mode_st" ${hasCustom?'style="display:none"':''}>
        <div class="ct-api-info">
          ✅ Citadel Tongue использует модель подключённую в SillyTavern.<br>
          Никаких дополнительных настроек не нужно — всё работает из коробки.
        </div>
      </div>
      <div id="ct_mode_custom" ${!hasCustom?'style="display:none"':''}>
        <div class="ct-hint">Отдельный API для генерации правил и авто-захвата.</div>
        <label class="ct-ck ct-gap"><input type="checkbox" id="ct_fallback_st" ${s.fallbackToSt!==false?'checked':''}><span>Fallback на ST если недоступен</span></label>
        <input type="text" id="ct_api_endpoint" class="ct-text-input ct-gap" placeholder="https://api.openai.com или http://localhost:1234" value="${s.apiEndpoint||''}">
        <div class="ct-2col ct-gap" style="gap:5px">
          <input type="password" id="ct_api_key" class="ct-text-input" placeholder="API Key (необязателен)" value="${s.apiKey||''}" style="flex:1;margin:0">
          <button class="menu_button" id="ct_api_key_eye" style="padding:4px 8px;flex-shrink:0">👁</button>
        </div>
        <input type="text" id="ct_api_model" class="ct-text-input ct-gap" placeholder="Модель: gpt-4o-mini, llama3 и т.д." value="${s.apiModel||''}">
        <div class="ct-2col ct-gap" style="gap:5px">
          <button class="menu_button" id="ct_api_test_btn" style="flex:1;font-size:11px;padding:5px 8px">🔌 Тест соединения</button>
        </div>
        <div id="ct_api_status" style="font-size:10px;min-height:14px;margin-top:5px"></div>
      </div>`;

    $(target).append(`
      <div id="ct_settings_block" class="ct-main-block">
        <div class="ct-main-hdr" id="ct_main_hdr">
          <span class="ct-main-gem">◈</span>
          <span class="ct-main-title" id="ct_main_title">${s.langName}</span>
          <span class="ct-main-chev" id="ct_main_chev">▸</span>
        </div>
        <div class="ct-main-body" id="ct_main_body" style="display:none">
          ${sec('main',  '⚙', 'Основное',          secMain)}
          ${sec('chars', '♥', 'Персонажи',         secChars)}
          ${sec('scan',  '✦', 'Сканирование',       secScan)}
          ${sec('api',   '🔌','API',                secApi)}
        </div>
      </div>
    `);

    // Main toggle
    $('#ct_main_hdr').on('click', function(){
      const body=$('#ct_main_body'), chev=$('#ct_main_chev');
      body.slideToggle(180);
      chev.text(body.is(':visible')?'▾':'▸');
    });

    // Section toggles
    $('.ct-sec-hdr').on('click', function(){
      const body=$(this).next('.ct-sec-body'), chev=$(this).find('.ct-sec-chev');
      body.slideToggle(150);
      chev.text(body.is(':visible')?'▾':'▸');
    });

    // ── Bind controls ─────────────────────────────────────────────────────────
    $('#ct_enabled').on('change', async function(){ getSettings().enabled=this.checked; ctx().saveSettingsDebounced(); await updatePrompt(); });
    $('#ct_phonetic').on('change', async function(){ getSettings().injectPhonetic=this.checked; ctx().saveSettingsDebounced(); await updatePrompt(); });
    $('#ct_autocapture').on('change', function(){ getSettings().autoCapture=this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_semantic').on('change', function(){ getSettings().semantic=this.checked; ctx().saveSettingsDebounced(); });

    let db={};
    const deb=(k,fn,t=350)=>{ clearTimeout(db[k]); db[k]=setTimeout(fn,t); };

    $('#ct_lang_name').on('input', function(){
      deb('ln',async()=>{
        const v=this.value.trim()||'Citadel Tongue';
        getSettings().langName=v; ctx().saveSettingsDebounced();
        $('#ct_main_title,#ct_tr_title').text(v);
        await updatePrompt();
      });
    });
    $('#ct_scan_depth').on('input',function(){ getSettings().scanDepth=+this.value; $('#ct_scan_depth_val').text(this.value); ctx().saveSettingsDebounced(); });
    $('#ct_words_per').on('input', function(){ getSettings().wordsPerScene=+this.value; $('#ct_words_per_val').text(this.value); ctx().saveSettingsDebounced(); });

    // Chars
    renderCharTags();
    $('#ct_char_add_btn').on('click', addChar);
    $('#ct_char_add_inp').on('keydown', e=>{ if(e.key==='Enter') addChar(); });

    // Tracker open
    $('#ct_open_tracker_btn').on('click', ()=>{ $('#ct_tracker').addClass('ct-open'); renderDrawer(); });

    // API section
    $('.ct-api-btn').on('click', function(){
      const mode=this.dataset.mode;
      $('.ct-api-btn').removeClass('active'); $(this).addClass('active');
      if(mode==='st'){
        $('#ct_mode_st').show(); $('#ct_mode_custom').hide();
        getSettings().apiEndpoint=''; $('#ct_api_endpoint').val('');
        ctx().saveSettingsDebounced(); _workingApi=null;
      } else {
        $('#ct_mode_st').hide(); $('#ct_mode_custom').show();
      }
    });

    deb('ap',()=>{}, 0); // noop to init db
    $('#ct_api_endpoint').on('input',function(){ deb('ep',()=>{ getSettings().apiEndpoint=this.value.trim(); ctx().saveSettingsDebounced(); _workingApi=null; }); });
    $('#ct_api_key').on('input',function(){ deb('ak',()=>{ getSettings().apiKey=this.value; ctx().saveSettingsDebounced(); }); });
    $('#ct_api_model').on('input',function(){ deb('am',()=>{ getSettings().apiModel=this.value.trim(); ctx().saveSettingsDebounced(); _workingApi=null; }); });
    $('#ct_fallback_st').on('change',function(){ getSettings().fallbackToSt=this.checked; ctx().saveSettingsDebounced(); });

    $('#ct_api_key_eye').on('click', function(){
      const f=$('#ct_api_key');
      f.attr('type', f.attr('type')==='password'?'text':'password');
    });

    $('#ct_api_test_btn').on('click', async()=>{
      const $s=$('#ct_api_status');
      $s.css('color','#7a8499').text('Тестирую…');
      try {
        const res = await aiGenerate('Say only: OK', 'You are a test. Reply with exactly one word: OK');
        $s.css('color','#34d399').text(`✅ Работает: "${res.trim().slice(0,40)}"`);
      } catch(e) {
        $s.css('color','#f87171').text('✗ '+e.message);
      }
    });
  }

  function renderCharTags() {
    const s=getSettings(); const el=$('#ct_char_tags'); el.empty();
    (s.chars||[]).forEach(c=>{
      el.append(`<span class="ct-char-tag">${c}<button class="ct-tag-x" data-c="${c}">✕</button></span>`);
    });
    el.find('.ct-tag-x').on('click', function(){
      const s=getSettings(); s.chars=s.chars.filter(x=>x!==this.dataset.c);
      ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt();
    });
  }

  function addChar() {
    const v=$('#ct_char_add_inp').val().trim(); if(!v) return;
    const s=getSettings();
    if(!s.chars.includes(v)){ s.chars.push(v); ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt(); }
    $('#ct_char_add_inp').val('');
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  // Track last cleaned message index to avoid double-processing
  const _cleanedMsgs = new Set();

  function processChatMessage(idx) {
    const msg = (ctx().chat || [])[idx];
    if (!msg || msg.is_user) return;
    captureFromMessage(msg.mes || '');
    if (msg.mes && /\[CT_WORD:/i.test(msg.mes)) {
      if (!_cleanedMsgs.has(idx)) {
        _cleanedMsgs.add(idx);
        msg.mes = cleanMarkers(msg.mes);
      }
      // Always clean the DOM element (covers re-renders after swipe)
      const el = document.querySelector(`[mesid="${idx}"] .mes_text`);
      if (el) el.innerHTML = cleanMarkers(el.innerHTML);
    }
  }

  function wireChatEvents() {
    const { eventSource, event_types } = ctx();

    eventSource.on(event_types.APP_READY, async () => {
      ensureTracker();
      mountSettingsUi();
      await updatePrompt();
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
      _cleanedMsgs.clear();
      await updatePrompt();
      if ($('#ct_tracker').hasClass('ct-open')) renderDrawer();
    });

    // Primary capture: fires when message is fully received (non-streaming or end of stream)
    eventSource.on(event_types.MESSAGE_RECEIVED, async (idx) => {
      processChatMessage(idx);
      await updatePrompt();
    });

    // Capture on swipe / manual edit / regeneration
    eventSource.on(event_types.MESSAGE_UPDATED, async (idx) => {
      _cleanedMsgs.delete(idx); // allow re-clean after swipe
      processChatMessage(idx);
      await updatePrompt();
    });

    // Fallback: GENERATION_ENDED fires reliably at end of streaming
    // Use the last non-user message index as target
    if (event_types.GENERATION_ENDED) {
      eventSource.on(event_types.GENERATION_ENDED, async () => {
        const chat = ctx().chat || [];
        const lastIdx = chat.length - 1;
        if (lastIdx >= 0 && !chat[lastIdx].is_user) {
          processChatMessage(lastIdx);
        }
        await updatePrompt();
      });
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  jQuery(()=>{
    try { wireChatEvents(); console.log('[Citadel Tongue v5] ✦ loaded'); }
    catch(e){ console.error('[Citadel Tongue] init failed', e); }
  });

})();
