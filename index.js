/**
 * Citadel Tongue v8.0
 *
 * COMPLETE REWRITE — major changes from v7:
 *
 * SECURITY:
 *  • All HTML output is sanitized via escapeHtml — no XSS vectors
 *  • API key storage warning shown to users
 *
 * BUG FIXES:
 *  • parseWordMarker — robust handling of | in definitions
 *  • Undo is now a stack (depth 10), not a single array
 *  • updatePrompt is debounced — no race conditions from parallel events
 *  • Toast queue — toasts stack vertically instead of overlapping
 *  • Scoring uses tokenized word boundaries — no false substring matches
 *  • captureFromMessage deduplication — no double-scan from HTML stripping
 *
 * NEW ARCHITECTURE:
 *  • Custom categories — add, edit, delete your own emotional registers
 *  • Separate prompt / rules / grammar — three independent injection blocks
 *  • Language evolution engine — auto-generates new words after N messages
 *  • Grammar rules — dedicated section alongside phonetic rules
 *  • Word history — tracks definition changes over time
 *  • Word relationships — root, compound, related, antonym
 *  • Contextual examples — auto-captured from chat usage
 *  • Stats tab — category distribution, growth, most used
 *  • Token budget — estimates prompt size with visual warning
 *  • Bulk operations — delete all auto-words, clear by category
 *  • Enhanced prompt engineering — character actively uses & develops language
 *  • Normalized scoring — temporal decay properly weighted against keyword hits
 */

(() => {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     §1  MODULE CONSTANTS
     ═══════════════════════════════════════════════════════════════════════════ */

  const MODULE_KEY  = 'citadel_tongue';
  const PROMPT_TAG  = 'CT_LANGUAGE';
  const RULES_TAG   = 'CT_RULES';
  const GRAMMAR_TAG = 'CT_GRAMMAR';
  const EXT_PROMPT_TYPES = Object.freeze({ IN_PROMPT:0, IN_CHAT:1, BEFORE_PROMPT:2 });

  /* ═══════════════════════════════════════════════════════════════════════════
     §2  UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Escape HTML entities — prevents XSS in all rendered output */
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(s)));
    return d.innerHTML;
  }

  /** Escape special characters for use in RegExp */
  function escRx(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Rough token estimate (~3.5 chars per token for mixed EN/RU) */
  function estimateTokens(text) { return text ? Math.ceil(text.length / 3.5) : 0; }

  /** Debounce helper */
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /** Tokenize text into a Set of lowercase words (handles EN + RU + unicode) */
  function tokenize(text) {
    if (!text) return new Set();
    return new Set(text.toLowerCase().split(/[\s.,!?;:"""''`()\[\]{}<>—–\-\/\\…·•|#@&^~+=]+/).filter(w => w.length > 1));
  }

  /** Check if keyword appears as a whole word in token set (single words) or as substring with boundaries (multi-word) */
  function kwMatch(keyword, tokenSet, fullText) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) return false;
    if (!kw.includes(' ')) return tokenSet.has(kw);
    return fullText.includes(kw);
  }

  /** Generate unique ID */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ═══════════════════════════════════════════════════════════════════════════
     §3  DEFAULT CATEGORIES (user-customizable starting point)
     ═══════════════════════════════════════════════════════════════════════════ */

  const DEFAULT_CATEGORIES = {
    presence: {
      label:'Presence', icon:'◈', color:'#a78bfa', custom:false,
      kw:['peace','quiet','presence','stillness','together','rest','dwell','warmth','beside','near','home','coexist','silence','still',
          'тишина','покой','вместе','рядом','дом','молчание','тихо','присутствие','теплота','близко','уют','спокойно']
    },
    devotion: {
      label:'Devotion', icon:'♥', color:'#f472b6', custom:false,
      kw:['mine','bond','trust','devotion','cherish','precious','soul','love','protect','sacred','forever','claim','belong','oath','swear',
          'моя','моё','мой','доверие','преданность','душа','любовь','защита','навсегда','принадлежать','клятва','связь','беречь','дорогой','клянусь']
    },
    instinct: {
      label:'Instinct', icon:'⚔', color:'#fb923c', custom:false,
      kw:['blood','kill','hunt','threat','danger','territory','feral','primal','instinct','rage','cold','shield','body','weapon','fight','protect',
          'кровь','убить','убью','охота','угроза','опасность','инстинкт','ярость','тело','защитить','бой','территория','зверь','холодно','оружие']
    },
    grief: {
      label:'Grief', icon:'◇', color:'#60a5fa', custom:false,
      kw:['loss','gone','absence','grief','empty','hollow','thousand','ache','mourn','sorrow','ghost','alone','years','left','remember','forget','past',
          'потеря','ушёл','ушла','отсутствие','пустота','скорбь','боль','тоска','тысяча','лет','один','одна','помнить','забыть','прошлое','пропал','пропала']
    },
    other: {
      label:'Other', icon:'◉', color:'#94a3b8', custom:false, kw:[]
    },
  };

  /* ═══════════════════════════════════════════════════════════════════════════
     §4  DEFAULT RULES, GRAMMAR, INITIAL DICTIONARY
     ═══════════════════════════════════════════════════════════════════════════ */

  const DEFAULT_RULES =
`PHONETIC LAW OF THE CITADEL TONGUE:
• Apostrophe (') = a breath-break — the moment emotion is too heavy to continue seamlessly. Not punctuation — a wound in the word.
• HARSH ROOTS — KHAR', DHAL', VOR', RAETH' — territorial claim, violence, devotion that would drown the world in blood.
• SOFT ROOTS — VAI', KAEL', VETH', SAEL', ETH' — intimacy, grief, love with no ceiling and no floor.
• Compound words: two roots fused at the apostrophe exist between both meanings.
• NEVER translate aloud. Meaning lives in context, body, the silence after.`;

  const DEFAULT_GRAMMAR =
`GRAMMAR PATTERNS:
• Suffix '-enn' / '-ann' — abstract state of being (Vai'enn = the state of presence)
• Suffix '-eth' — active process, ongoing (Sael'eth = the act of grieving)
• Suffix '-ar' / '-or' — agent, the one who does (Veth'ar = the one who is open)
• Prefix 'Khar-' — intensifier, territorial weight
• Double vowel — elongated emotion, emphasis (Sael → Saael = deeper grief)
• Word order: emotion-first, object-last. The feeling leads, the subject follows.`;

  const INITIAL_DICT = [
    {id:1,  word:"Vai'enn",   cat:'presence', def:"Presence-without-purpose. The peace of two souls coexisting without demands.",                chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:2,  word:"Saith'en",  cat:'presence', def:"Peaceful coexistence without the threat of storm. Domesticity. Sacred monotony.",              chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:3,  word:"Veth'ann",  cat:'devotion', def:"The Open One. A soul that has accepted the bond and cannot be sealed by another.",             chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:4,  word:"Kael'seth", cat:'devotion', def:"She whose mind is my shield. Trust not in safety — but in the clarity another brings.",       chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:5,  word:"Thar'uen",  cat:'devotion', def:"To hold something so carefully it costs everything. Open hands knowing water will drain.",    chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:6,  word:"Khar'dhal", cat:'instinct', def:"The possessive instinct to drown the world in blood to keep one soul safe. Not rage — colder.",chars:['Gasil'], pinned:true,  auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:7,  word:"Sael'inn",  cat:'instinct', def:"A child choosing shelter without words. The body approaching a scent before the mind decides.",chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:8,  word:"Vai'tarr",  cat:'grief',    def:"Tenderness made of pain. Gentleness that exists because of what was lost.",                    chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:9,  word:"Vethmar",   cat:'grief',    def:"The shape a person leaves after they are gone. The warmth in empty sheets.",                   chars:['Gasil'], pinned:true,  auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
    {id:10, word:"Saelorn",   cat:'grief',    def:"The ache of watching someone beautiful in a world that does not deserve them.",                 chars:['Gasil'], pinned:false, auto:false, uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:''},
  ];

  const defaultSettings = Object.freeze({
    enabled:          true,
    langName:         'Citadel Tongue',
    chars:            ['Gasil'],
    wordsPerScene:    4,
    semantic:         true,
    autoCapture:      true,
    injectPhonetic:   true,
    injectGrammar:    true,
    compactPrompt:    false,
    scanDepth:        5,
    rules:            DEFAULT_RULES,
    grammarRules:     DEFAULT_GRAMMAR,
    dict:             null,
    nextId:           11,
    categories:       null,
    nextCatId:        1,
    apiEndpoint:      '',
    apiKey:           '',
    apiModel:         '',
    fallbackToSt:     true,
    injectionType:    EXT_PROMPT_TYPES.IN_CHAT,
    injectionDepth:   1,
    separateRules:    true,
    rulesDepth:       4,
    tokenBudget:      600,
    evolutionEnabled: true,
    evolutionInterval:25,
    evolutionCounter: 0,
    evolutionAutoRules:false,
  });


  /* ═══════════════════════════════════════════════════════════════════════════
     §5  STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let trackerCat       = 'all';
  let trackerSearch    = '';
  let trackerTab       = 'words';
  let trackerSort      = 'alpha';
  let _workingApi      = null;
  let _lastInjected    = [];
  let _undoStack       = [];          // stack of arrays of word IDs (max 10)
  const _sessionNewIds = new Set();
  let _settingsReady   = false;
  let _toastQueue      = [];
  let _toastActive     = 0;
  let _updatePromptTimer = null;
  let _evolving        = false;

  /* ═══════════════════════════════════════════════════════════════════════════
     §6  CONTEXT & SETTINGS
     ═══════════════════════════════════════════════════════════════════════════ */

  function ctx() { return SillyTavern.getContext(); }

  function getCategories(s) {
    return s.categories || DEFAULT_CATEGORIES;
  }

  function getSettings() {
    const { extensionSettings } = ctx();

    if (!extensionSettings[MODULE_KEY]) {
      _settingsReady = false;
      extensionSettings[MODULE_KEY] = {
        ...structuredClone(defaultSettings),
        dict:       structuredClone(INITIAL_DICT),
        categories: structuredClone(DEFAULT_CATEGORIES),
        nextId:     11,
        rules:      DEFAULT_RULES,
        grammarRules: DEFAULT_GRAMMAR,
      };
    }

    const s = extensionSettings[MODULE_KEY];

    if (!_settingsReady) {
      // Migration from v7 or incomplete settings
      if (!Array.isArray(s.dict))    s.dict         = structuredClone(INITIAL_DICT);
      if (!Array.isArray(s.chars))   s.chars        = ['Gasil'];
      if (!s.rules)                  s.rules        = DEFAULT_RULES;
      if (!s.categories)             s.categories   = structuredClone(DEFAULT_CATEGORIES);
      if (!s.grammarRules && s.grammarRules !== '')  s.grammarRules = DEFAULT_GRAMMAR;
      if (s.injectionType   === undefined) s.injectionType   = EXT_PROMPT_TYPES.IN_CHAT;
      if (s.injectionDepth  === undefined) s.injectionDepth  = 1;
      if (s.compactPrompt   === undefined) s.compactPrompt   = false;
      if (s.separateRules   === undefined) s.separateRules   = true;
      if (s.rulesDepth      === undefined) s.rulesDepth      = 4;
      if (s.tokenBudget     === undefined) s.tokenBudget     = 600;
      if (s.injectGrammar   === undefined) s.injectGrammar   = true;
      if (s.evolutionEnabled  === undefined) s.evolutionEnabled  = true;
      if (s.evolutionInterval === undefined) s.evolutionInterval = 15;
      if (s.evolutionCounter  === undefined) s.evolutionCounter  = 0;
      if (s.evolutionAutoRules=== undefined) s.evolutionAutoRules= false;
      if (s.nextCatId       === undefined) s.nextCatId       = 1;

      // Ensure 'other' category always exists
      if (!s.categories.other) {
        s.categories.other = { label:'Other', icon:'◉', color:'#94a3b8', custom:false, kw:[] };
      }

      // Migrate words — add new fields
      s.dict = s.dict.map(w => ({
        uses:0, lastUsed:0, auto:false, pinned:false, chars:[], disabled:false,
        triggers:[], relations:[], history:[], examples:[], createdAt:0, notes:'',
        ...w
      }));

      _settingsReady = true;
    }

    return s;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §7  AI GENERATION
     ═══════════════════════════════════════════════════════════════════════════ */

  function getBaseUrl() {
    return (getSettings().apiEndpoint || '').trim().replace(/\/+$/, '') || null;
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

    if (base) {
      const headers = {
        'Content-Type': 'application/json',
        ...((s.apiKey || '').trim() ? { Authorization: `Bearer ${s.apiKey.trim()}` } : {}),
      };

      if (_workingApi?.base === base) {
        try {
          const resp = await fetch(_workingApi.url, {
            method: 'POST', headers,
            body: JSON.stringify(_workingApi.builder(s.apiModel || 'gpt-4o-mini', userPrompt, systemPrompt)),
          });
          if (resp.ok) { const t = extractText(await resp.json()); if (t?.trim()) return t; }
        } catch {}
        _workingApi = null;
      }

      const endpoints = [
        `${base}/v1/chat/completions`, `${base}/chat/completions`,
        `${base}/v1/completions`,      `${base}/completions`,
      ];
      const builders = [
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7, messages:[{role:'system',content:sys},{role:'user',content:u}] }),
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7, messages:[{role:'user',content:`${sys}\n\n---\n\n${u}`}] }),
        (m,u,sys) => ({ model:m, max_tokens:1200, temperature:0.7, prompt:`${sys}\n\n${u}` }),
      ];
      const model = s.apiModel || 'gpt-4o-mini';

      for (const url of endpoints) {
        for (const builder of builders) {
          try {
            const resp = await fetch(url, { method:'POST', headers, body:JSON.stringify(builder(model,userPrompt,systemPrompt)) });
            if (!resp.ok) continue;
            const t = extractText(await resp.json());
            if (t?.trim()) { _workingApi = {base, url, builder}; return t; }
          } catch {}
        }
      }

      if (s.fallbackToSt === false) throw new Error('Custom API unreachable');
      console.warn('[CT] Custom API failed — falling back to ST');
    }

    const c = ctx();
    if (typeof c.generateRaw !== 'function')
      throw new Error('generateRaw not available. Update ST or configure a custom API.');
    const result = await c.generateRaw(userPrompt, null, false, true, systemPrompt, true);
    if (!result?.trim()) throw new Error('Model returned empty response.');
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §8  CHARACTER CHECK
     ═══════════════════════════════════════════════════════════════════════════ */

  function charMatch() {
    const s = getSettings();
    if (!s.chars.length) return true;
    const name = (ctx().name2 || '').toLowerCase();
    if (!name) return true;
    return s.chars.some(c => name.includes(c.toLowerCase().trim()));
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §9  SEMANTIC SCORING
     ═══════════════════════════════════════════════════════════════════════════ */

  function recentText() {
    const s = getSettings();
    return (ctx().chat || []).filter(m => !m.is_system).slice(-s.scanDepth)
      .map(m => (m.mes || '').toLowerCase()).join(' ');
  }

  /**
   * Score a word against recent text. Pure function — no side effects.
   * Uses tokenized matching for precise keyword detection.
   * Score is normalized: keyword component [0..1] * 10 + temporal [0..3] + bonuses
   */
  function scoreWord(w, txt, tokens) {
    const s   = getSettings();
    const cats = getCategories(s);
    const cat  = cats[w.cat] || cats.other || { kw:[] };
    const kwList = cat.kw || [];

    // Keyword hits — normalized by total keyword count
    const kwHits = kwList.length
      ? kwList.filter(k => kwMatch(k, tokens, txt)).length / kwList.length
      : 0;

    // Trigger hits (custom boost keywords) — each hit = 0.15 bonus
    const trigHits = (w.triggers || []).filter(t => t && kwMatch(t, tokens, txt)).length * 0.15;

    // Self-mention bonus
    const selfHit = tokens.has(w.word.toLowerCase()) ? 0.3 : 0;

    // Temporal decay — words not used recently get a small boost (encourages rotation)
    const hoursAgo = w.lastUsed ? (Date.now() - w.lastUsed) / 3600000 : 999;
    const temporal = Math.min(hoursAgo / 24, 0.3);

    // Usage frequency penalty — extremely used words get slight penalty for variety
    const usePenalty = w.uses > 20 ? 0.1 : 0;

    return (kwHits * 10) + trigHits + selfHit + temporal - usePenalty;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §10  WORD SELECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Select words for the current scene.
   * dryRun=true  → no mutation (safe for preview/sort)
   * cachedTxt    → pre-computed recentText()
   */
  function pickWords(dryRun, cachedTxt) {
    dryRun    = dryRun === true;
    cachedTxt = cachedTxt != null ? cachedTxt : recentText();
    const tokens = tokenize(cachedTxt);

    const s    = getSettings();
    const name = (ctx().name2 || '').toLowerCase();

    const elig = s.dict.filter(w =>
      !w.disabled && (!w.chars.length || w.chars.some(c => name.includes(c.toLowerCase())))
    );
    if (!elig.length) return [];

    // Dynamic word count based on emotional intensity
    let n = s.wordsPerScene;
    if (s.semantic && elig.length > 2) {
      const avg = elig.reduce((sum, w) => sum + scoreWord(w, cachedTxt, tokens), 0) / elig.length;
      if (avg > 4)        n = Math.min(n + 3, elig.length);
      else if (avg > 2.5) n = Math.min(n + 1, elig.length);
      else if (avg < 0.5) n = Math.max(n - 1, 2);
    }
    n = Math.min(n, elig.length);

    const pinned = elig.filter(w => w.pinned);
    const pool   = elig.filter(w => !w.pinned);
    const slots  = Math.max(0, n - pinned.length);

    let chosen;
    if (s.semantic) {
      chosen = [
        ...pinned,
        ...pool.map(w => ({ w, sc: scoreWord(w, cachedTxt, tokens) }))
               .sort((a, b) => b.sc - a.sc)
               .slice(0, slots)
               .map(x => x.w),
      ];
    } else {
      chosen = [
        ...pinned,
        ...pool.slice().sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0)).slice(0, slots),
      ];
    }

    if (!dryRun) {
      const now = Date.now();
      chosen.forEach(w => { w.lastUsed = now; w.uses = (w.uses || 0) + 1; });
      _lastInjected = chosen.map(w => w.id);
      ctx().saveSettingsDebounced();
    }

    return chosen;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §11  PROMPT BUILDER (separated: main prompt, rules, grammar)
     ═══════════════════════════════════════════════════════════════════════════ */

  function buildMainPrompt(preview) {
    preview = preview === true;
    const s       = getSettings();
    const cats    = getCategories(s);
    const txt     = recentText();
    const tokens  = tokenize(txt);
    const words   = pickWords(preview, txt);
    const primary = s.chars[0] || 'the character';

    if (!words.length && !s.injectPhonetic) return '';

    // ── Compact format ──────────────────────────────────────────────────
    if (s.compactPrompt) {
      let p = `[CT: ${s.langName.toUpperCase()}] ${primary} knows a private language. These words MAY surface rarely — only at emotional peaks. Most responses should contain NO words from this language.\n`;
      if (words.length)
        p += `Available: ${words.map(w => `${w.word} (${w.def.split('.')[0]})`).join(' | ')}\n`;
      p += `When used: weave into prose naturally, follow with a brief inner echo of meaning. Never on a separate line. Never as a label.\n`;
      p += `Forge: [CT_WORD: Word | Definition | category | ${primary}]`;
      return p;
    }

    // ── Full format ─────────────────────────────────────────────────────
    let p = `[PRIVATE LANGUAGE — ${s.langName.toUpperCase()}]\n`;
    p += `${primary} carries a private language inside them. These are not decorations or flourishes — they are words too heavy for common speech.\n\n`;

    p += `[CRITICAL — FREQUENCY]\n`;
    p += `Most responses should contain ZERO words from this language. Silence is the default.\n`;
    p += `A word surfaces only when emotion becomes unbearable — when common language physically cannot hold what ${primary} feels.\n`;
    p += `If a word appears in every response, it loses all meaning. Rarity is what gives these words power.\n`;
    p += `Think of it as: the word escapes. ${primary} does not choose to say it. It breaks through.\n\n`;

    if (words.length) {
      p += `[AVAILABLE VOCABULARY — ${words.length} words ${primary} carries]\n`;

      words.forEach(w => {
        const sc = scoreWord(w, txt, tokens);
        const c  = cats[w.cat] || cats.other;
        const res = sc >= 5 ? ' ★' : '';
        p += `  ${c.icon} ${w.word}${res} — ${w.def}\n`;
      });

      const best   = [...words].sort((a, b) => scoreWord(b, txt, tokens) - scoreWord(a, txt, tokens))[0];
      const second = words.length > 1 ? [...words].sort((a, b) => scoreWord(b, txt, tokens) - scoreWord(a, txt, tokens))[1] : null;

      p += `\n[HOW WORDS SURFACE — examples of CORRECT usage]\n`;
      p += `The word must be woven INTO the prose — inside a sentence, inside a thought, inside an action. Never alone on a line. Never as a header or label.\n`;
      p += `After the word, ${primary}'s inner voice echoes its meaning — a brief, poetic self-translation woven into the narration. Not a dictionary definition. A felt meaning.\n\n`;

      p += `  ✓ GOOD: His hand stopped on her shoulder, and something cracked open in his chest — "${best.word}," barely a breath, the way you name something precious that might disappear if you speak too loudly. The knowing that she was here. That this was enough.\n`;
      if (second) {
        p += `  ✓ GOOD: He caught himself thinking "${second.word}" before he could stop it — that ache again, the one shaped like her absence, filling every room she wasn't in.\n`;
      }
      p += `  ✓ GOOD: She said something simple, and the word rose in him unbidden — ${best.word} — and with it, the whole weight of what he could never explain to her in any human language.\n`;
      p += `  ✓ GOOD (no word at all): He watched her sleep. Said nothing. Felt everything. [← this is ALSO correct. Most responses look like this.]\n\n`;

      p += `  ✗ WRONG: ${best.word}.\n    Длинный абзац про эмоцию.\n    [word alone on a line, used as a section header]\n`;
      p += `  ✗ WRONG: He said "${best.word}", which means ${best.def.split('.')[0].toLowerCase()}.\n    [explicit translation / dictionary definition]\n`;
      p += `  ✗ WRONG: Using a word in EVERY response. [cheapens the language]\n`;
      p += `  ✗ WRONG: "${best.word}." Followed by a paragraph explaining the emotion.\n    [word as a standalone dramatic beat — this is the pattern to AVOID]\n`;
    }

    p += `\n[SELF-TRANSLATION PATTERN]\n`;
    p += `When a word does surface, ${primary}'s inner voice echoes its meaning — not as a translation, but as a felt resonance:\n`;
    p += `  Pattern: "...word..." followed by inner narration that SHOWS the meaning through sensation, memory, or image.\n`;
    p += `  The reader understands the word through context and emotional echo, never through explanation.\n`;
    p += `  The echo should feel like ${primary}'s own thought — brief, visceral, personal.\n`;

    p += `\n[WORD CREATION — rare, organic]\n`;
    p += `Very rarely, when an emotion has no name in any language ${primary} knows, a new word might form.\n`;
    p += `This should happen at most once every 10–15 messages. Not every scene needs a new word.\n`;
    p += `If it happens, add hidden at the very end:\n`;
    p += `<div style="display:none;">[CT_WORD: Word | Full definition | category | ${primary}]</div>\n`;
    p += `Categories: ${Object.entries(cats).map(([k,c]) => `${k} (${c.label})`).join(', ')}`;

    return p;
  }

  function buildRulesPrompt() {
    const s = getSettings();
    if (!s.injectPhonetic || !s.rules) return '';
    return `[PHONETIC LAW — ${s.langName.toUpperCase()}]\n${s.rules}`;
  }

  function buildGrammarPrompt() {
    const s = getSettings();
    if (!s.injectGrammar || !s.grammarRules) return '';
    return `[GRAMMAR — ${s.langName.toUpperCase()}]\n${s.grammarRules}`;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §12  INJECTION & STATUS
     ═══════════════════════════════════════════════════════════════════════════ */

  function _doUpdatePrompt() {
    const { setExtensionPrompt } = ctx();
    const s = getSettings();

    if (!s.enabled || !charMatch()) {
      setExtensionPrompt(PROMPT_TAG,  '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
      setExtensionPrompt(RULES_TAG,   '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
      setExtensionPrompt(GRAMMAR_TAG, '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
      updateStatusIndicator(false, []);
      return;
    }

    const mainPrompt    = buildMainPrompt(false);
    const rulesPrompt   = buildRulesPrompt();
    const grammarPrompt = buildGrammarPrompt();

    // Main prompt: inject at user-configured position
    setExtensionPrompt(PROMPT_TAG, mainPrompt, s.injectionType, s.injectionDepth, true);

    // Rules & grammar: separate or embedded
    if (s.separateRules) {
      const rulesDepth = Math.min(s.rulesDepth, 15);
      setExtensionPrompt(RULES_TAG,   rulesPrompt,   EXT_PROMPT_TYPES.IN_CHAT, rulesDepth, true);
      setExtensionPrompt(GRAMMAR_TAG, grammarPrompt,  EXT_PROMPT_TYPES.IN_CHAT, rulesDepth + 1, true);
    } else {
      // Embed rules in main prompt — clear separate injections
      setExtensionPrompt(RULES_TAG,   '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
      setExtensionPrompt(GRAMMAR_TAG, '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
    }

    const injWords = s.dict.filter(w => _lastInjected.includes(w.id));
    updateStatusIndicator(true, injWords);

    // Update token display
    const totalTokens = estimateTokens(mainPrompt) + estimateTokens(rulesPrompt) + estimateTokens(grammarPrompt);
    updateTokenDisplay(totalTokens, s.tokenBudget);

    if ($('#ct_tracker').hasClass('ct-open')) _renderLastInjectedBanner(injWords);
  }

  /** Debounced updatePrompt — prevents race conditions from multiple events */
  function updatePrompt() {
    clearTimeout(_updatePromptTimer);
    _updatePromptTimer = setTimeout(_doUpdatePrompt, 80);
  }

  function updateStatusIndicator(active, injWords) {
    const $badge = $('#ct_status_badge');
    if (!$badge.length) return;

    if (active) {
      const name = ctx().name2 || getSettings().chars[0] || '—';
      const n    = (injWords || []).length;
      const cats = getCategories(getSettings());
      const catCounts = {};
      (injWords || []).forEach(w => { catCounts[w.cat] = (catCounts[w.cat] || 0) + 1; });
      const top = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
      const reg = top ? (cats[top[0]]?.label || top[0]) : '';
      $badge.css({ background:'rgba(52,211,153,0.12)', color:'#34d399', borderColor:'rgba(52,211,153,0.25)' })
        .text(`◈ ${esc(name)} · ${n}w${reg ? ' · ' + reg : ''}`);
    } else {
      $badge.css({ background:'rgba(100,116,139,0.1)', color:'#475569', borderColor:'rgba(100,116,139,0.15)' })
        .text('✕ inactive');
    }
  }

  function updateTokenDisplay(current, budget) {
    const $el = $('#ct_token_display');
    if (!$el.length) return;
    const pct = budget > 0 ? (current / budget) : 0;
    const color = pct > 1 ? '#f87171' : pct > 0.8 ? '#fbbf24' : '#34d399';
    $el.css('color', color).text(`~${current}/${budget} tokens`);
  }

  function _renderLastInjectedBanner(injWords) {
    const $el = $('#ct_last_injected');
    if (!$el.length) return;
    if (!injWords || !injWords.length) { $el.hide(); return; }
    const cats = getCategories(getSettings());
    const html = injWords.map(w => {
      const c = cats[w.cat] || cats.other;
      return `<span class="ct-inj-word" style="color:${esc(c.color)}">${esc(w.word)}</span>`;
    }).join('');
    $el.html(`<span class="ct-inj-lbl">↑ injected:</span> ${html}`).show();
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §13  WORD MARKER PARSING & CAPTURE
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Robust parser: [CT_WORD: Word | Definition... | category | character]
   * Handles | in definitions by fixing first and last two pipe-segments.
   */
  function parseWordMarker(raw) {
    const inner = raw.replace(/^\[CT_WORD:\s*/i, '').replace(/\]$/, '').trim();
    const parts = inner.split('|').map(p => p.trim());
    if (parts.length < 3) return null;

    const word = parts[0];
    const chr  = parts[parts.length - 1];
    const cat  = parts[parts.length - 2].toLowerCase();
    // Everything between first and last two parts is the definition
    const def  = parts.slice(1, parts.length - 2).join('|').trim() || parts[1] || '';

    if (!word || !def) return null;
    return { word, def, cat, chr };
  }

  /**
   * Capture words from model output.
   * Deduplicates by scanning only the raw text (not text + stripped-HTML copy).
   */
  function captureFromMessage(text, forceCapture) {
    const s = getSettings();
    if (!forceCapture && (!s.autoCapture || !text)) return;
    if (!text) return;

    const scanRe     = /\[CT_WORD:([\s\S]*?)\]/gi;
    const rawMatches = [];
    let m;
    while ((m = scanRe.exec(text)) !== null) rawMatches.push('[CT_WORD:' + m[1] + ']');
    if (!rawMatches.length) return;

    // Deduplicate by word text
    const seen = new Set();
    const uniqueMatches = rawMatches.filter(raw => {
      const p = parseWordMarker(raw);
      if (!p) return false;
      const key = p.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!uniqueMatches.length) return;

    const capturedIds = [];
    let any = false;
    const cats = getCategories(s);

    for (const raw of uniqueMatches) {
      const parsed = parseWordMarker(raw);
      if (!parsed) continue;
      const { word, def, cat, chr } = parsed;
      const vc = cats[cat] ? cat : 'other';
      const existing = s.dict.find(w => w.word.toLowerCase() === word.toLowerCase());

      if (existing) {
        if (existing.def !== def) {
          // Track history before updating
          if (!existing.history) existing.history = [];
          existing.history.push({ def: existing.def, date: Date.now() });
          if (existing.history.length > 20) existing.history = existing.history.slice(-20);

          existing.def = def;
          existing.cat = vc;
          if (chr && !existing.chars.includes(chr)) existing.chars.push(chr);
          any = true;
          queueToast(word, def, vc, true);
        }
      } else {
        const newId = s.nextId++;
        s.dict.push({
          id:newId, word, cat:vc, def, chars:chr?[chr]:[], pinned:false, auto:true,
          uses:0, lastUsed:0, disabled:false, triggers:[], relations:[], history:[],
          examples:[], createdAt:Date.now(), notes:''
        });
        capturedIds.push(newId);
        _sessionNewIds.add(newId);
        any = true;
        queueToast(word, def, vc, false);
      }
    }

    if (capturedIds.length) {
      _undoStack.push(capturedIds);
      if (_undoStack.length > 10) _undoStack.shift();
    }

    if (any) {
      ctx().saveSettingsDebounced();
      renderDrawer();
      updateWordCount();
      _updateUndoBtn();
    }
  }

  /**
   * Capture contextual usage examples when a word appears in chat text.
   */
  function captureExamples(text) {
    if (!text) return;
    const s = getSettings();
    const sentences = text.replace(/<[^>]+>/g, ' ').split(/[.!?…]+/).filter(s => s.trim().length > 10);

    s.dict.forEach(w => {
      if (w.disabled) return;
      const wLower = w.word.toLowerCase();
      sentences.forEach(sent => {
        if (sent.toLowerCase().includes(wLower)) {
          if (!w.examples) w.examples = [];
          const trimmed = sent.trim().slice(0, 150);
          if (!w.examples.includes(trimmed) && w.examples.length < 5) {
            w.examples.push(trimmed);
          }
        }
      });
    });
  }

  function cleanMarkers(text) {
    if (!text) return text;
    return text
      .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/\[CT_WORD:[\s\S]*?\]/gi, '')
      .trim();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §14  UNDO STACK
     ═══════════════════════════════════════════════════════════════════════════ */

  function undoLastCapture() {
    if (!_undoStack.length) return;
    const ids = _undoStack.pop();
    const s = getSettings();
    s.dict = s.dict.filter(w => !ids.includes(w.id));
    ids.forEach(id => _sessionNewIds.delete(id));
    ctx().saveSettingsDebounced();
    renderDrawer();
    updateWordCount();
    _updateUndoBtn();
  }

  function _updateUndoBtn() {
    const $btn = $('#ct_undo_btn');
    if (!$btn.length) return;
    if (_undoStack.length) {
      const lastCount = _undoStack[_undoStack.length - 1].length;
      $btn.show().text(`↩ Undo (${lastCount})`).attr('title', `Undo stack: ${_undoStack.length} levels`);
    } else {
      $btn.hide();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §15  LANGUAGE EVOLUTION ENGINE
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Auto-evolve: after every N messages, analyze chat and generate new words.
   * Runs asynchronously in background, non-blocking.
   */
  async function tryEvolve() {
    const s = getSettings();
    if (!s.evolutionEnabled || _evolving) return;
    s.evolutionCounter = (s.evolutionCounter || 0) + 1;

    if (s.evolutionCounter < s.evolutionInterval) return;
    s.evolutionCounter = 0;
    ctx().saveSettingsDebounced();

    _evolving = true;
    try {
      await evolveLanguage();
    } catch (e) {
      console.warn('[CT] Evolution failed:', e.message);
    } finally {
      _evolving = false;
    }
  }

  async function evolveLanguage() {
    const s = getSettings();
    const cats = getCategories(s);
    const chat = ctx().chat || [];
    const msgs = chat.filter(m => !m.is_system).slice(-20);
    if (msgs.length < 5) return;

    const chatText = msgs.map(m =>
      `[${m.is_user ? 'User' : 'Char'}]: ${cleanMarkers((m.mes || '').replace(/<[^>]+>/g, ' ')).slice(0, 300)}`
    ).join('\n');

    const existing = s.dict.map(w => `${w.word} [${w.cat}]: ${w.def.slice(0,80)}`).join('\n');
    const primary  = s.chars[0] || 'the character';
    const catList  = Object.entries(cats).map(([k, c]) => `${k} (${c.label})`).join(', ');

    let evolvePrompt = `You are the evolution engine for "${s.langName}", a private language that surfaces RARELY in emotional peaks.

PHONETIC LAW:
${s.rules || DEFAULT_RULES}

GRAMMAR:
${s.grammarRules || DEFAULT_GRAMMAR}

EXISTING VOCABULARY (${s.dict.length} words):
${existing}

RECENT DIALOGUE (last ${msgs.length} messages):
${chatText}

TASK — Analyze the emotional landscape. If there is a genuine conceptual gap — a feeling or state that NONE of the existing words can express — forge 1 new word. Maximum 2.

RULES:
1. Follow the phonetic law and grammar patterns strictly.
2. The bar for a new word is HIGH. Most analyses should result in ZERO new words.
3. A new word must name something the existing vocabulary genuinely cannot express.
4. Words must feel organic to this language.
5. If the dialogue is calm, routine, or already well-covered — output NOTHING.

OUTPUT FORMAT (only if truly needed):
[CT_WORD: Word | Full definition with emotional weight | category | ${primary}]
Categories: ${catList}

Output ONLY [CT_WORD:...] markers. No explanations. Empty response if nothing to add.`;

    let rulesUpdate = '';
    if (s.evolutionAutoRules) {
      evolvePrompt += `\n\nADDITIONALLY: If you see patterns in the existing words that suggest a new phonetic or grammar rule, add it after the word markers as:
[CT_RULE: rule text]
[CT_GRAMMAR: grammar pattern]
Maximum one of each. Only if genuinely emerging from the vocabulary.`;
    }

    const result = await aiGenerate(evolvePrompt,
      `You are the keeper and evolver of a living constructed language for dark/emotional RP. You generate only structured markers. Never explain. Never converse.`
    );

    if (!result?.trim()) return;

    // Capture new words
    captureFromMessage(result, true);

    // Capture rule updates
    if (s.evolutionAutoRules) {
      const ruleMatch = result.match(/\[CT_RULE:\s*([\s\S]*?)\]/i);
      if (ruleMatch && ruleMatch[1].trim()) {
        s.rules = (s.rules || '') + '\n• ' + ruleMatch[1].trim();
        ctx().saveSettingsDebounced();
      }
      const gramMatch = result.match(/\[CT_GRAMMAR:\s*([\s\S]*?)\]/i);
      if (gramMatch && gramMatch[1].trim()) {
        s.grammarRules = (s.grammarRules || '') + '\n• ' + gramMatch[1].trim();
        ctx().saveSettingsDebounced();
      }
    }

    const n = (result.match(/\[CT_WORD:/gi) || []).length;
    if (n > 0) {
      console.log(`[CT] Evolution: forged ${n} new word(s)`);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §16  RULE GENERATION & MANUAL SCAN
     ═══════════════════════════════════════════════════════════════════════════ */

  async function generateRules(btnId, areaId, statusId, mode) {
    mode = mode || 'phonetic';
    const s    = getSettings();
    const $btn = $('#' + (btnId || 'ct_gen_rules_btn'));
    const $area = $('#' + (areaId || 'ct_rules_area'));
    const $st  = $('#' + (statusId || 'ct_rules_status'));

    $btn.prop('disabled', true).text('⏳ Generating…');
    $st.css('color', '#7a8499').text('Contacting model…');

    try {
      const sample = s.dict.slice(0, 25).map(w => `• ${w.word} [${w.cat}]: ${w.def}`).join('\n');
      const current = mode === 'grammar' ? (s.grammarRules || DEFAULT_GRAMMAR) : (s.rules || DEFAULT_RULES);

      const prompt = mode === 'grammar'
        ? `Existing grammar patterns:\n${current}\n\nExisting words:\n${sample}\n\nAnalyze morphological patterns. Add 2–3 new grammar rules that emerge logically from the word structure. Keep all old rules. Return the full updated grammar text — concise, same style.`
        : `Existing phonetic rules:\n${current}\n\nExisting words:\n${sample}\n\nAnalyze phonetic patterns. Add 2–3 new phonetic rules that emerge logically from the words. Keep all old rules. Return the full updated rule text — concise, same style.`;

      const result = await aiGenerate(prompt,
        `You create ${mode} rules for a fictional language used in RP. Reply with rule text only — no preamble, no markdown.`
      );
      $area.val(result.trim());
      if (mode === 'grammar') s.grammarRules = result.trim();
      else s.rules = result.trim();
      ctx().saveSettingsDebounced();
      updatePrompt();
      $st.css('color', '#34d399').text('✓ Rules updated');
    } catch (e) {
      $st.css('color', '#f87171').text('✗ ' + e.message);
    } finally {
      $btn.prop('disabled', false).text('✦ Generate');
    }
  }

  async function manualScan() {
    const s    = getSettings();
    const cats = getCategories(s);
    const $btn = $('#ct_scan_btn'), $st = $('#ct_scan_status');
    const depth = Math.max(1, parseInt($('#ct_manual_scan_depth').val(), 10) || 20);

    $btn.prop('disabled', true).text('⏳ Scanning…');
    $st.css('color', '#7a8499').text('Analyzing chat…');

    try {
      const chat = ctx().chat || [];
      const msgs = chat.filter(m => !m.is_system).slice(-depth);
      if (!msgs.length) throw new Error('No messages to scan');

      const chatText = msgs.map(m =>
        `[${m.is_user ? 'User' : 'Char'}]: ${cleanMarkers((m.mes || '').replace(/<[^>]+>/g, ' ')).slice(0, 400)}`
      ).join('\n');
      const existing = s.dict.map(w => `${w.word} (${w.cat})`).join(', ');
      const primary  = s.chars[0] || 'the character';
      const catList  = Object.entries(cats).map(([k, c]) => `${k} (${c.label})`).join(', ');

      const result = await aiGenerate(
        `Phonetic rules:\n${s.rules || DEFAULT_RULES}\n\nGrammar:\n${s.grammarRules || DEFAULT_GRAMMAR}\n\nExisting words:\n${existing || 'none'}\n\nDialogue (last ${depth} messages):\n${chatText}\n\nAnalyze this dialogue for genuine emotional gaps — feelings or states that NO existing word covers.\nOnly forge words for concepts that are truly missing. The bar is high.\nOutput 0–3 markers. Format exactly:\n[CT_WORD: Word | Definition and emotional weight | category | ${primary}]\nCategories: ${catList}\nFollow the phonetic law and grammar strictly. Output NOTHING if the vocabulary already covers what's needed.`,
        `You are the keeper of the language "${s.langName}" for RP. You forge new words only when genuinely needed — never for the sake of growth. Analyze dialogue and output [CT_WORD:...] markers only. No text, no explanations. Empty response if nothing to add.`
      );

      captureFromMessage(result, true);
      const n = (result.match(/\[CT_WORD:/gi) || []).length;
      $st.css('color', n ? '#34d399' : '#7a8499').text(n ? `✓ Forged: ${n}` : 'Nothing new found');
    } catch (e) {
      $st.css('color', '#f87171').text('✗ ' + e.message);
    } finally {
      $btn.prop('disabled', false).text('🔍 Scan chat');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §17  TOAST SYSTEM (stacking queue)
     ═══════════════════════════════════════════════════════════════════════════ */

  const MAX_VISIBLE_TOASTS = 3;

  function queueToast(word, def, cat, isUpdate) {
    _toastQueue.push({ word, def, cat, isUpdate });
    _processToastQueue();
  }

  function _processToastQueue() {
    while (_toastQueue.length && _toastActive < MAX_VISIBLE_TOASTS) {
      const item = _toastQueue.shift();
      _showToast(item.word, item.def, item.cat, item.isUpdate);
    }
  }

  function _showToast(word, def, cat, isUpdate) {
    const cats = getCategories(getSettings());
    const c = cats[cat] || cats.other;
    const offset = _toastActive * 68;
    _toastActive++;

    const el = $(`
      <div class="ct-toast" style="bottom:${24 + offset}px">
        <div class="ct-toast-row">
          <span class="ct-toast-dot" style="background:${esc(c.color)}"></span>
          <span class="ct-toast-word">${esc(word)}</span>
          <span class="ct-toast-badge${isUpdate ? ' ct-toast-upd' : ''}">${isUpdate ? 'updated' : 'forged'}</span>
        </div>
        <div class="ct-toast-def">${esc(def.slice(0, 90))}${def.length > 90 ? '…' : ''}</div>
      </div>`);
    $('body').append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.addClass('ct-in')));
    setTimeout(() => {
      el.addClass('ct-out');
      setTimeout(() => {
        el.remove();
        _toastActive = Math.max(0, _toastActive - 1);
        _processToastQueue();
      }, 300);
    }, 4500);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §18  EXPORT / IMPORT
     ═══════════════════════════════════════════════════════════════════════════ */

  function exportDict() {
    const s = getSettings();
    const data = {
      langName:     s.langName,
      rules:        s.rules,
      grammarRules: s.grammarRules,
      categories:   s.categories,
      dict:         s.dict,
      version:      '8.0.0',
    };
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    a.download = `${s.langName.replace(/\s+/g, '_')}_dict.json`;
    a.click();
  }

  function importDict(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        const s = getSettings();
        if (data.langName) s.langName = data.langName;
        if (data.rules) s.rules = data.rules;
        if (data.grammarRules) s.grammarRules = data.grammarRules;
        if (data.categories) {
          Object.entries(data.categories).forEach(([k, c]) => {
            if (!s.categories[k]) s.categories[k] = c;
          });
        }
        if (Array.isArray(data.dict)) {
          data.dict.forEach(w => {
            if (!s.dict.find(x => x.word.toLowerCase() === w.word.toLowerCase())) {
              s.dict.push({
                disabled:false, triggers:[], relations:[], history:[], examples:[],
                createdAt:Date.now(), notes:'', ...w, id:s.nextId++, auto:false
              });
            }
          });
        }
        ctx().saveSettingsDebounced();
        renderDrawer();
        updateWordCount();
      } catch (err) { alert('Import error: ' + err.message); }
    };
    r.readAsText(file);
    e.target.value = '';
  }

  function updateWordCount() {
    $('#ct_words_total').text(`/ ${getSettings().dict.length}`);
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §19  WORD CRUD
     ═══════════════════════════════════════════════════════════════════════════ */

  function deleteWord(id) {
    const s = getSettings(), w = s.dict.find(x => x.id === id);
    if (!w || !confirm(`Delete "${w.word}"?`)) return;
    s.dict = s.dict.filter(x => x.id !== id);
    ctx().saveSettingsDebounced();
    renderDrawer();
    updateWordCount();
  }

  function toggleDisableWord(id) {
    const s = getSettings(), w = s.dict.find(x => x.id === id);
    if (!w) return;
    w.disabled = !w.disabled;
    ctx().saveSettingsDebounced();
    renderDrawer();
    updatePrompt();
  }

  function bulkDeleteAuto() {
    const s = getSettings();
    const count = s.dict.filter(w => w.auto).length;
    if (!count || !confirm(`Delete all ${count} auto-captured words?`)) return;
    s.dict = s.dict.filter(w => !w.auto);
    ctx().saveSettingsDebounced();
    renderDrawer();
    updateWordCount();
  }

  function bulkDeleteCategory(catKey) {
    const s = getSettings();
    const cats = getCategories(s);
    const catLabel = cats[catKey]?.label || catKey;
    const count = s.dict.filter(w => w.cat === catKey).length;
    if (!count || !confirm(`Delete all ${count} words in category "${catLabel}"?`)) return;
    s.dict = s.dict.filter(w => w.cat !== catKey);
    ctx().saveSettingsDebounced();
    renderDrawer();
    updateWordCount();
  }

  let _editCat = 'other';

  function openEdit(id, prefill, prefillCat) {
    prefill    = prefill || '';
    prefillCat = prefillCat || 'other';
    const s  = getSettings();
    const cats = getCategories(s);
    const ex = id ? s.dict.find(w => w.id === id) : null;
    _editCat = ex ? ex.cat : prefillCat;

    $('#ct_edit_title').text(ex ? 'Edit word' : 'New word');
    $('#ct_edit_id').val(id || '');
    $('#ct_edit_word').val(ex ? ex.word : prefill);
    $('#ct_edit_def').val(ex ? ex.def : '');
    $('#ct_edit_triggers').val(((ex ? ex.triggers : null) || []).join(', '));
    $('#ct_edit_chars').val(((ex ? ex.chars : null) || []).join(', '));
    $('#ct_edit_relations').val(((ex ? ex.relations : null) || []).map(r => `${r.type}:${r.targetId}`).join(', '));
    $('#ct_edit_notes').val((ex ? ex.notes : '') || '');
    $('#ct_edit_pinned').prop('checked', ex ? !!ex.pinned : false);

    // Render category buttons dynamically
    _renderEditCats(cats);
    $(`#ct_edit_cats .ct-ecat[data-cat="${_editCat}"]`).addClass('active');

    // Show history if available
    const $history = $('#ct_edit_history');
    if ($history.length) {
      if (ex && ex.history && ex.history.length) {
        $history.html(
          `<div class="ct-elabel" style="margin-top:10px">History (${ex.history.length})</div>` +
          ex.history.slice(-5).reverse().map(h =>
            `<div class="ct-history-item"><span class="ct-history-date">${new Date(h.date).toLocaleDateString()}</span> ${esc(h.def.slice(0,80))}</div>`
          ).join('')
        ).show();
      } else {
        $history.hide();
      }
    }

    // Show examples if available
    const $examples = $('#ct_edit_examples');
    if ($examples.length) {
      if (ex && ex.examples && ex.examples.length) {
        $examples.html(
          `<div class="ct-elabel" style="margin-top:10px">Usage examples</div>` +
          ex.examples.slice(0, 3).map(e =>
            `<div class="ct-example-item">"${esc(e.slice(0,100))}"</div>`
          ).join('')
        ).show();
      } else {
        $examples.hide();
      }
    }

    $('#ct_edit_modal').addClass('ct-eopen');
    setTimeout(() => {
      const el = document.getElementById('ct_edit_word');
      if (el) el.focus();
    }, 80);
  }

  function _renderEditCats(cats) {
    const $container = $('#ct_edit_cats');
    $container.html(
      Object.entries(cats).map(([k, c]) =>
        `<button class="ct-ecat" data-cat="${esc(k)}" style="--cc:${esc(c.color)}">${esc(c.icon)} ${esc(c.label)}</button>`
      ).join('')
    );
    $container.off('click', '.ct-ecat').on('click', '.ct-ecat', function () {
      _editCat = this.dataset.cat;
      $container.find('.ct-ecat').removeClass('active');
      $(this).addClass('active');
    });
  }

  function closeEdit() { $('#ct_edit_modal').removeClass('ct-eopen'); }

  function saveEdit() {
    const s        = getSettings();
    const word     = $('#ct_edit_word').val().trim();
    const def      = $('#ct_edit_def').val().trim();
    const cat      = $('#ct_edit_cats .ct-ecat.active').data('cat') || _editCat;
    const chars    = $('#ct_edit_chars').val().split(',').map(c => c.trim()).filter(Boolean);
    const triggers = $('#ct_edit_triggers').val().split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const notes    = $('#ct_edit_notes').val().trim();
    const pinned   = $('#ct_edit_pinned').is(':checked');
    const id       = $('#ct_edit_id').val();

    // Parse relations: "root:5, compound:3"
    const relStr   = ($('#ct_edit_relations').val() || '').trim();
    const relations = relStr ? relStr.split(',').map(r => {
      const [type, tid] = r.trim().split(':');
      return type && tid ? { type: type.trim(), targetId: parseInt(tid) } : null;
    }).filter(Boolean) : [];

    if (!word) { document.getElementById('ct_edit_word')?.focus(); return; }
    if (!def)  { document.getElementById('ct_edit_def')?.focus();  return; }

    if (id) {
      const t = s.dict.find(w => w.id === +id);
      if (t) {
        // Track definition change in history
        if (t.def !== def) {
          if (!t.history) t.history = [];
          t.history.push({ def: t.def, date: Date.now() });
        }
        Object.assign(t, { word, cat, def, chars, triggers, pinned, notes, relations });
      }
    } else {
      s.dict.push({
        id:s.nextId++, word, cat, def, chars, triggers, pinned, auto:false,
        uses:0, lastUsed:0, disabled:false, relations, history:[], examples:[],
        createdAt:Date.now(), notes
      });
    }

    ctx().saveSettingsDebounced();
    renderDrawer();
    updateWordCount();
    closeEdit();
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §20  CATEGORY CRUD
     ═══════════════════════════════════════════════════════════════════════════ */

  function openCategoryEditor() {
    const s = getSettings();
    const cats = getCategories(s);
    _renderCategoryList(cats);
    $('#ct_cat_editor').addClass('ct-eopen');
  }

  function closeCategoryEditor() { $('#ct_cat_editor').removeClass('ct-eopen'); }

  function _renderCategoryList(cats) {
    const $body = $('#ct_cat_editor_body');
    $body.html(Object.entries(cats).map(([k, c]) => `
      <div class="ct-cated-row" data-cat="${esc(k)}">
        <span class="ct-cated-dot" style="background:${esc(c.color)}"></span>
        <span class="ct-cated-icon">${esc(c.icon)}</span>
        <span class="ct-cated-label">${esc(c.label)}</span>
        <span class="ct-cated-kw">${(c.kw || []).length} kw</span>
        <button class="ct-cated-edit" data-cat="${esc(k)}" title="Edit">✎</button>
        ${c.custom || k !== 'other' ? `<button class="ct-cated-del" data-cat="${esc(k)}" title="Delete">✕</button>` : ''}
      </div>
    `).join(''));

    $body.find('.ct-cated-edit').off('click').on('click', function (e) {
      e.stopPropagation();
      openCategoryEditForm(this.dataset.cat);
    });
    $body.find('.ct-cated-del').off('click').on('click', function (e) {
      e.stopPropagation();
      deleteCategory(this.dataset.cat);
    });
  }

  function openCategoryEditForm(catKey) {
    const s = getSettings();
    const cats = getCategories(s);
    const isNew = !catKey;
    const c = isNew ? { label:'', icon:'★', color:'#a78bfa', kw:[], custom:true } : cats[catKey];
    if (!c) return;

    $('#ct_catedit_key').val(catKey || '');
    $('#ct_catedit_label').val(c.label);
    $('#ct_catedit_icon').val(c.icon);
    $('#ct_catedit_color').val(c.color);
    $('#ct_catedit_kw').val((c.kw || []).join(', '));
    $('#ct_catedit_title').text(isNew ? 'New category' : `Edit: ${c.label}`);
    $('#ct_catedit_form').show();
  }

  function saveCategoryEdit() {
    const s    = getSettings();
    const key  = $('#ct_catedit_key').val().trim();
    const label = $('#ct_catedit_label').val().trim();
    const icon  = $('#ct_catedit_icon').val().trim() || '◉';
    const color = $('#ct_catedit_color').val().trim() || '#94a3b8';
    const kw    = $('#ct_catedit_kw').val().split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

    if (!label) return;

    const catKey = key || label.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!s.categories) s.categories = structuredClone(DEFAULT_CATEGORIES);

    const existing = s.categories[catKey];
    s.categories[catKey] = {
      label, icon, color, kw,
      custom: existing ? existing.custom : true,
    };

    ctx().saveSettingsDebounced();
    _renderCategoryList(getCategories(s));
    $('#ct_catedit_form').hide();
    renderDrawer();
    updatePrompt();
  }

  function deleteCategory(catKey) {
    const s = getSettings();
    const cats = getCategories(s);
    if (catKey === 'other') return;
    const label = cats[catKey]?.label || catKey;
    const wordCount = s.dict.filter(w => w.cat === catKey).length;
    if (!confirm(`Delete category "${label}"? ${wordCount} words will be moved to "Other".`)) return;

    // Move words to 'other'
    s.dict.forEach(w => { if (w.cat === catKey) w.cat = 'other'; });
    delete s.categories[catKey];

    ctx().saveSettingsDebounced();
    _renderCategoryList(getCategories(s));
    renderDrawer();
    updatePrompt();
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §21  SETTINGS PANEL UI
     ═══════════════════════════════════════════════════════════════════════════ */

  function mountSettingsUi() {
    if ($('#ct_settings_block').length) return;
    const target = $('#extensions_settings2').length ? '#extensions_settings2' : '#extensions_settings';
    if (!$(target).length) { console.warn('[CT] settings container not found'); return; }

    const s   = getSettings();
    const sec = (id, icon, title, content) => `
      <div class="ct-sec" id="ct_sec_${id}">
        <div class="ct-sec-hdr"><span class="ct-sec-chev">▸</span><span>${icon} ${title}</span></div>
        <div class="ct-sec-body" style="display:none">${content}</div>
      </div>`;

    const secMain = `
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_enabled" ${s.enabled ? 'checked' : ''}><span>Inject into prompt</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_phonetic" ${s.injectPhonetic ? 'checked' : ''}><span>Phonetic rules</span></label>
      </div>
      <div class="ct-2col" style="margin-top:5px">
        <label class="ct-ck"><input type="checkbox" id="ct_grammar_toggle" ${s.injectGrammar ? 'checked' : ''}><span>Grammar rules</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_compact" ${s.compactPrompt ? 'checked' : ''}><span>Compact prompt</span></label>
      </div>
      <div class="ct-field-row" style="margin-top:8px">
        <label class="ct-flabel">Language name</label>
        <input type="text" id="ct_lang_name" class="ct-text-input" value="${esc(s.langName)}">
      </div>
      <div class="ct-2col" style="margin-top:8px;gap:6px">
        <button class="menu_button" id="ct_open_tracker_btn" style="flex:1">◈ Open dictionary</button>
        <button class="menu_button" id="ct_preview_btn" style="flex:1;font-size:11px">👁 Preview</button>
      </div>
      <div id="ct_token_display" class="ct-token-display" style="margin-top:6px;font-size:10px;text-align:right">—</div>`;

    const secChars = `
      <div class="ct-hint">Language activates only for these characters. Empty = always active.</div>
      <div id="ct_char_tags" class="ct-char-tags"></div>
      <div class="ct-2col ct-gap">
        <input type="text" id="ct_char_add_inp" class="ct-text-input" placeholder="Character name…" style="flex:1">
        <button class="menu_button" id="ct_char_add_btn" style="flex-shrink:0">+ Add</button>
      </div>`;

    const secScan = `
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_autocapture" ${s.autoCapture ? 'checked' : ''}><span>Auto-capture words</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_semantic" ${s.semantic ? 'checked' : ''}><span>Semantic selection</span></label>
      </div>
      <div class="ct-hint" style="margin-top:5px">Semantic picks words by emotional register. Intense scenes get extra words automatically.</div>
      <div class="ct-srow ct-slider-row">
        <label>Scan depth</label>
        <input type="range" id="ct_scan_depth" min="1" max="20" value="${s.scanDepth}">
        <span id="ct_scan_depth_val">${s.scanDepth}</span><span class="ct-unit">msg</span>
      </div>
      <div class="ct-srow ct-slider-row">
        <label>Words/scene</label>
        <input type="range" id="ct_words_per" min="2" max="15" value="${s.wordsPerScene}">
        <span id="ct_words_per_val">${s.wordsPerScene}</span>
        <span class="ct-unit" id="ct_words_total">/ ${s.dict.length}</span>
      </div>
      <div class="ct-srow ct-slider-row">
        <label>Token budget</label>
        <input type="range" id="ct_token_budget" min="200" max="2000" step="50" value="${s.tokenBudget}">
        <span id="ct_token_budget_val">${s.tokenBudget}</span><span class="ct-unit">tok</span>
      </div>`;

    const secInject = `
      <div class="ct-hint"><b>In Chat @ depth 1</b> puts the vocabulary block right before the last message.</div>
      <div class="ct-field-row" style="margin-top:6px">
        <label class="ct-flabel">Vocabulary position</label>
        <select id="ct_inject_type" class="ct-text-input" style="padding:4px 8px">
          <option value="0" ${s.injectionType === 0 ? 'selected' : ''}>Before System Prompt</option>
          <option value="1" ${s.injectionType === 1 ? 'selected' : ''}>In Chat (recommended)</option>
          <option value="2" ${s.injectionType === 2 ? 'selected' : ''}>Author's Note position</option>
        </select>
      </div>
      <div class="ct-srow ct-slider-row" id="ct_depth_row" ${s.injectionType === 0 ? 'style="opacity:.4;pointer-events:none"' : ''}>
        <label>Depth</label>
        <input type="range" id="ct_inject_depth" min="0" max="15" value="${s.injectionDepth}">
        <span id="ct_inject_depth_val">${s.injectionDepth}</span>
        <span class="ct-unit">from end</span>
      </div>
      <div style="margin-top:8px">
        <label class="ct-ck"><input type="checkbox" id="ct_separate_rules" ${s.separateRules ? 'checked' : ''}><span>Rules as separate injection</span></label>
      </div>
      <div class="ct-srow ct-slider-row" id="ct_rules_depth_row" ${!s.separateRules ? 'style="opacity:.4;pointer-events:none"' : ''}>
        <label>Rules depth</label>
        <input type="range" id="ct_rules_depth" min="1" max="15" value="${s.rulesDepth}">
        <span id="ct_rules_depth_val">${s.rulesDepth}</span>
        <span class="ct-unit">from end</span>
      </div>
      <div class="ct-hint" style="margin-top:5px">Separate rules injection places phonetic law + grammar deeper in context, saving attention near the last message for vocabulary.</div>`;

    const secEvolution = `
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_evo_enabled" ${s.evolutionEnabled ? 'checked' : ''}><span>Auto-evolve language</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_evo_rules" ${s.evolutionAutoRules ? 'checked' : ''}><span>Also evolve rules</span></label>
      </div>
      <div class="ct-srow ct-slider-row">
        <label>Every</label>
        <input type="range" id="ct_evo_interval" min="5" max="50" value="${s.evolutionInterval}">
        <span id="ct_evo_interval_val">${s.evolutionInterval}</span><span class="ct-unit">messages</span>
      </div>
      <div class="ct-hint" style="margin-top:5px">Evolution engine analyzes recent dialogue and forges new words when emotional gaps exist. Counter: ${s.evolutionCounter}/${s.evolutionInterval}</div>
      <button class="menu_button ct-gap" id="ct_evo_now_btn" style="width:100%;font-size:11px">✦ Evolve now</button>
      <div id="ct_evo_status" style="font-size:10px;min-height:14px;margin-top:4px"></div>`;

    const secRules = `
      <div class="ct-hint">Phonetic law and grammar injected with prompts. Edit manually or generate from dictionary.</div>
      <label class="ct-flabel" style="margin-top:6px">Phonetic rules</label>
      <textarea id="ct_rules_area" class="ct-rules-edit" rows="6">${esc(s.rules || DEFAULT_RULES)}</textarea>
      <div class="ct-rules-actions">
        <button class="menu_button" id="ct_rules_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
        <button class="menu_button ct-gen-btn" id="ct_gen_rules_btn">✦ Generate</button>
      </div>
      <div id="ct_rules_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>
      <label class="ct-flabel" style="margin-top:10px">Grammar patterns</label>
      <textarea id="ct_grammar_area" class="ct-rules-edit" rows="5">${esc(s.grammarRules || DEFAULT_GRAMMAR)}</textarea>
      <div class="ct-rules-actions">
        <button class="menu_button" id="ct_grammar_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
        <button class="menu_button ct-gen-btn" id="ct_gen_grammar_btn">✦ Generate</button>
      </div>
      <div id="ct_grammar_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>`;

    const secCategories = `
      <div class="ct-hint">Manage emotional categories. Default categories can be edited; new ones can be created.</div>
      <button class="menu_button ct-gap" id="ct_open_cat_editor_btn" style="width:100%;font-size:11px">◈ Manage categories</button>`;

    const hasCustom = !!(s.apiEndpoint || '').trim();
    const secApi = `
      <div class="ct-api-mode-bar">
        <div class="ct-api-mode-label">Generation source</div>
        <div class="ct-api-btns">
          <button class="ct-api-btn ${!hasCustom ? 'active' : ''}" data-mode="st">🟢 ST (current)</button>
          <button class="ct-api-btn ${hasCustom ? 'active' : ''}" data-mode="custom">🔌 Custom API</button>
        </div>
      </div>
      <div id="ct_mode_st" ${hasCustom ? 'style="display:none"' : ''}>
        <div class="ct-api-info">✅ Uses the model currently connected in SillyTavern.</div>
      </div>
      <div id="ct_mode_custom" ${!hasCustom ? 'style="display:none"' : ''}>
        <div class="ct-hint">Separate API for rule generation, manual scan, and evolution.</div>
        <div class="ct-hint ct-api-warn" style="color:#fbbf24">⚠ API key is stored in plain text in extension settings. Do not use sensitive keys.</div>
        <label class="ct-ck ct-gap"><input type="checkbox" id="ct_fallback_st" ${s.fallbackToSt !== false ? 'checked' : ''}><span>Fallback to ST if unreachable</span></label>
        <input type="text" id="ct_api_endpoint" class="ct-text-input ct-gap" placeholder="https://api.openai.com or http://localhost:1234" value="${esc(s.apiEndpoint || '')}">
        <div class="ct-2col ct-gap" style="gap:5px">
          <input type="password" id="ct_api_key" class="ct-text-input" placeholder="API Key (optional)" value="${esc(s.apiKey || '')}" style="flex:1;margin:0">
          <button class="menu_button" id="ct_api_key_eye" style="padding:4px 8px;flex-shrink:0">👁</button>
        </div>
        <input type="text" id="ct_api_model" class="ct-text-input ct-gap" placeholder="Model: gpt-4o-mini, llama3, etc." value="${esc(s.apiModel || '')}">
        <button class="menu_button ct-gap" id="ct_api_test_btn" style="width:100%;font-size:11px;padding:5px 8px">🔌 Test</button>
        <div id="ct_api_status" style="font-size:10px;min-height:14px;margin-top:4px"></div>
      </div>`;

    $(target).append(`
      <div id="ct_settings_block" class="ct-main-block">
        <div class="ct-main-hdr" id="ct_main_hdr">
          <span class="ct-main-gem">◈</span>
          <span class="ct-main-title" id="ct_main_title">${esc(s.langName)}</span>
          <span id="ct_status_badge" class="ct-status-badge">✕ inactive</span>
          <span class="ct-main-chev" id="ct_main_chev">▸</span>
        </div>
        <div class="ct-main-body" id="ct_main_body" style="display:none">
          ${sec('main',   '⚙', 'Basic',          secMain)}
          ${sec('chars',  '♥', 'Characters',     secChars)}
          ${sec('scan',   '✦', 'Scan & scoring', secScan)}
          ${sec('inject', '◈', 'Injection',      secInject)}
          ${sec('evo',    '⟳', 'Evolution',      secEvolution)}
          ${sec('rules',  '◇', 'Language rules', secRules)}
          ${sec('cats',   '◉', 'Categories',     secCategories)}
          ${sec('api',    '🔌','API',            secApi)}
        </div>
      </div>
    `);

    // ── Accordion ──────────────────────────────────────────────────
    $('#ct_main_hdr').on('click', function () {
      const body = $('#ct_main_body'), chev = $('#ct_main_chev');
      body.slideToggle(180);
      chev.text(body.is(':visible') ? '▾' : '▸');
    });
    $('.ct-sec-hdr').on('click', function () {
      const body = $(this).next('.ct-sec-body'), chev = $(this).find('.ct-sec-chev');
      body.slideToggle(150);
      chev.text(body.is(':visible') ? '▾' : '▸');
    });

    // ── Basic toggles ──────────────────────────────────────────────
    $('#ct_enabled').on('change', function () { getSettings().enabled = this.checked; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_phonetic').on('change', function () { getSettings().injectPhonetic = this.checked; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_grammar_toggle').on('change', function () { getSettings().injectGrammar = this.checked; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_compact').on('change', function () { getSettings().compactPrompt = this.checked; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_autocapture').on('change', function () { getSettings().autoCapture = this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_semantic').on('change', function () { getSettings().semantic = this.checked; ctx().saveSettingsDebounced(); });

    // ── Debounced text inputs ──────────────────────────────────────
    let db = {};
    const deb = (k, fn, t=350) => { clearTimeout(db[k]); db[k] = setTimeout(fn, t); };

    $('#ct_lang_name').on('input', function () {
      deb('ln', () => {
        const v = this.value.trim() || 'Citadel Tongue';
        getSettings().langName = v;
        ctx().saveSettingsDebounced();
        $('#ct_main_title,#ct_tr_title').text(v);
        updatePrompt();
      });
    });

    // ── Sliders ────────────────────────────────────────────────────
    $('#ct_scan_depth').on('input', function () { getSettings().scanDepth = +this.value; $('#ct_scan_depth_val').text(this.value); ctx().saveSettingsDebounced(); });
    $('#ct_words_per').on('input', function () { getSettings().wordsPerScene = +this.value; $('#ct_words_per_val').text(this.value); ctx().saveSettingsDebounced(); });
    $('#ct_token_budget').on('input', function () { getSettings().tokenBudget = +this.value; $('#ct_token_budget_val').text(this.value); ctx().saveSettingsDebounced(); });

    // ── Injection ──────────────────────────────────────────────────
    const typeHints = { '0':'Before system prompt', '1':'★ Right before the last message', '2':"Author's Note position" };
    $('#ct_inject_type').on('change', function () {
      const t = +this.value;
      getSettings().injectionType = t;
      ctx().saveSettingsDebounced();
      $('#ct_depth_row').css({ opacity:t===0?.4:1, pointerEvents:t===0?'none':'auto' });
      updatePrompt();
    });
    $('#ct_inject_depth').on('input', function () {
      getSettings().injectionDepth = +this.value;
      $('#ct_inject_depth_val').text(this.value);
      ctx().saveSettingsDebounced();
      updatePrompt();
    });
    $('#ct_separate_rules').on('change', function () {
      getSettings().separateRules = this.checked;
      ctx().saveSettingsDebounced();
      $('#ct_rules_depth_row').css({ opacity:this.checked?1:.4, pointerEvents:this.checked?'auto':'none' });
      updatePrompt();
    });
    $('#ct_rules_depth').on('input', function () {
      getSettings().rulesDepth = +this.value;
      $('#ct_rules_depth_val').text(this.value);
      ctx().saveSettingsDebounced();
      updatePrompt();
    });

    // ── Evolution ──────────────────────────────────────────────────
    $('#ct_evo_enabled').on('change', function () { getSettings().evolutionEnabled = this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_evo_rules').on('change', function () { getSettings().evolutionAutoRules = this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_evo_interval').on('input', function () {
      getSettings().evolutionInterval = +this.value;
      $('#ct_evo_interval_val').text(this.value);
      ctx().saveSettingsDebounced();
    });
    $('#ct_evo_now_btn').on('click', async () => {
      const $st = $('#ct_evo_status');
      const $btn = $('#ct_evo_now_btn');
      $btn.prop('disabled', true).text('⏳ Evolving…');
      $st.css('color', '#7a8499').text('Analyzing dialogue…');
      try {
        await evolveLanguage();
        $st.css('color', '#34d399').text('✓ Evolution complete');
      } catch (e) {
        $st.css('color', '#f87171').text('✗ ' + e.message);
      } finally {
        $btn.prop('disabled', false).text('✦ Evolve now');
      }
    });

    // ── Rules ──────────────────────────────────────────────────────
    let rt, gt;
    $('#ct_rules_area').on('input', function () { clearTimeout(rt); rt = setTimeout(() => { getSettings().rules = this.value; ctx().saveSettingsDebounced(); updatePrompt(); }, 600); });
    $('#ct_rules_reset_btn').on('click', () => { $('#ct_rules_area').val(DEFAULT_RULES); getSettings().rules = DEFAULT_RULES; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_gen_rules_btn').on('click', () => generateRules('ct_gen_rules_btn', 'ct_rules_area', 'ct_rules_status', 'phonetic'));

    $('#ct_grammar_area').on('input', function () { clearTimeout(gt); gt = setTimeout(() => { getSettings().grammarRules = this.value; ctx().saveSettingsDebounced(); updatePrompt(); }, 600); });
    $('#ct_grammar_reset_btn').on('click', () => { $('#ct_grammar_area').val(DEFAULT_GRAMMAR); getSettings().grammarRules = DEFAULT_GRAMMAR; ctx().saveSettingsDebounced(); updatePrompt(); });
    $('#ct_gen_grammar_btn').on('click', () => generateRules('ct_gen_grammar_btn', 'ct_grammar_area', 'ct_grammar_status', 'grammar'));

    // ── Categories ─────────────────────────────────────────────────
    $('#ct_open_cat_editor_btn').on('click', openCategoryEditor);

    // ── Characters ─────────────────────────────────────────────────
    renderCharTags();
    $('#ct_char_add_btn').on('click', addChar);
    $('#ct_char_add_inp').on('keydown', e => { if (e.key === 'Enter') addChar(); });

    // ── Preview ────────────────────────────────────────────────────
    $('#ct_open_tracker_btn').on('click', () => { $('#ct_tracker').addClass('ct-open'); renderDrawer(); });
    $('#ct_preview_btn').on('click', () => {
      const main = buildMainPrompt(true);
      const rules = buildRulesPrompt();
      const grammar = buildGrammarPrompt();
      const total = [main, rules, grammar].filter(Boolean).join('\n\n──────────────────\n\n');
      const tokens = estimateTokens(total);
      $('#ct_preview_text').text(total || '[Prompt is empty]');
      $('#ct_preview_tokens').text(`~${tokens} tokens`);
      $('#ct_preview_modal').addClass('ct-eopen');
    });

    // ── API ────────────────────────────────────────────────────────
    $('.ct-api-btn').on('click', function () {
      const mode = this.dataset.mode;
      $('.ct-api-btn').removeClass('active');
      $(this).addClass('active');
      if (mode === 'st') {
        $('#ct_mode_st').show(); $('#ct_mode_custom').hide();
        getSettings().apiEndpoint = ''; $('#ct_api_endpoint').val('');
        ctx().saveSettingsDebounced(); _workingApi = null;
      } else {
        $('#ct_mode_st').hide(); $('#ct_mode_custom').show();
      }
    });
    $('#ct_api_endpoint').on('input', function () { deb('ep', () => { getSettings().apiEndpoint = this.value.trim(); ctx().saveSettingsDebounced(); _workingApi = null; }); });
    $('#ct_api_key').on('input', function () { deb('ak', () => { getSettings().apiKey = this.value; ctx().saveSettingsDebounced(); }); });
    $('#ct_api_model').on('input', function () { deb('am', () => { getSettings().apiModel = this.value.trim(); ctx().saveSettingsDebounced(); _workingApi = null; }); });
    $('#ct_fallback_st').on('change', function () { getSettings().fallbackToSt = this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_api_key_eye').on('click', function () { const f = $('#ct_api_key'); f.attr('type', f.attr('type') === 'password' ? 'text' : 'password'); });
    $('#ct_api_test_btn').on('click', async () => {
      const $st = $('#ct_api_status');
      $st.css('color', '#7a8499').text('Testing…');
      try {
        const r = await aiGenerate('Say only: OK', 'Reply with exactly one word: OK');
        $st.css('color', '#34d399').text(`✅ "${r.trim().slice(0, 40)}"`);
      } catch (e) {
        $st.css('color', '#f87171').text('✗ ' + e.message);
      }
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §22  CHARACTER TAGS
     ═══════════════════════════════════════════════════════════════════════════ */

  function renderCharTags() {
    const s = getSettings(), el = $('#ct_char_tags');
    el.empty();
    (s.chars || []).forEach(c => {
      el.append(`<span class="ct-char-tag">${esc(c)}<button class="ct-tag-x" data-c="${esc(c)}">✕</button></span>`);
    });
    el.find('.ct-tag-x').on('click', function () {
      const s = getSettings();
      s.chars = s.chars.filter(x => x !== this.dataset.c);
      ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt();
    });
  }

  function addChar() {
    const v = $('#ct_char_add_inp').val().trim();
    if (!v) return;
    const s = getSettings();
    if (!s.chars.includes(v)) {
      s.chars.push(v);
      ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt();
    }
    $('#ct_char_add_inp').val('');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §23  TRACKER POPUP — HTML SKELETON
     ═══════════════════════════════════════════════════════════════════════════ */

  function ensureTracker() {
    if ($('#ct_tracker').length) return;
    const s = getSettings();
    const cats = getCategories(s);

    $('body').append(`
      <div id="ct_tracker" class="ct-tracker">
        <div class="ct-tracker-inner">
          <div class="ct-tr-header">
            <div class="ct-tr-title-wrap">
              <span class="ct-tr-glow"></span>
              <span id="ct_tr_title" class="ct-tr-title">${esc(s.langName)}</span>
            </div>
            <div id="ct_tr_meta" class="ct-tr-meta"></div>
            <button id="ct_tr_close" class="ct-tr-close">✕</button>
          </div>
          <div class="ct-tr-search-wrap">
            <input type="text" id="ct_tr_search" class="ct-tr-search" placeholder="Search word or definition…" value="${esc(trackerSearch)}">
          </div>
          <div class="ct-tr-toolbar">
            <div class="ct-tr-tabs">
              <button class="ct-tr-tab ${trackerTab==='words'?'active':''}" data-tab="words">Words</button>
              <button class="ct-tr-tab ${trackerTab==='rules'?'active':''}" data-tab="rules">Rules</button>
              <button class="ct-tr-tab ${trackerTab==='stats'?'active':''}" data-tab="stats">Stats</button>
            </div>
            <select id="ct_tr_sort" class="ct-tr-sort" title="Sort order">
              <option value="alpha"  ${trackerSort==='alpha' ?'selected':''}>A–Z</option>
              <option value="score"  ${trackerSort==='score' ?'selected':''}>By scene</option>
              <option value="uses"   ${trackerSort==='uses'  ?'selected':''}>By uses</option>
              <option value="recent" ${trackerSort==='recent'?'selected':''}>Recent</option>
            </select>
          </div>
          <div id="ct_cat_bar" class="ct-cat-bar"></div>
          <div id="ct_last_injected" class="ct-last-injected" style="display:none"></div>
          <div id="ct_drawer_body" class="ct-tr-body"></div>
          <div id="ct_add_row" class="ct-tr-add-row">
            <input type="text" id="ct_add_input" class="ct-tr-add-input" placeholder="New word…">
            <div id="ct_add_cats" class="ct-add-cats"></div>
            <button id="ct_add_btn" class="ct-add-btn">+ Add</button>
          </div>
          <div class="ct-scan-row">
            <label class="ct-scan-label">Scan last</label>
            <input type="number" id="ct_manual_scan_depth" class="ct-scan-depth-inp" min="1" max="100" value="20">
            <span class="ct-scan-unit">msg</span>
            <button class="menu_button ct-scan-btn" id="ct_scan_btn">🔍 Scan chat</button>
          </div>
          <div id="ct_scan_status" class="ct-scan-status"></div>
          <div class="ct-tr-footer">
            <button class="menu_button ct-foot-btn" id="ct_export_btn">⬇ Export</button>
            <button class="menu_button ct-foot-btn" id="ct_import_btn">⬆ Import</button>
            <button class="menu_button ct-foot-btn ct-undo-btn" id="ct_undo_btn" style="display:none">↩ Undo</button>
            <div class="ct-bulk-drop">
              <button class="menu_button ct-foot-btn" id="ct_bulk_btn">⋯</button>
              <div class="ct-bulk-menu" id="ct_bulk_menu" style="display:none">
                <button class="ct-bulk-item" id="ct_bulk_del_auto">Delete all auto</button>
                <button class="ct-bulk-item" id="ct_bulk_del_cat">Delete by category…</button>
              </div>
            </div>
            <button class="menu_button ct-foot-btn" id="ct_tr_close2">Close</button>
          </div>
        </div>
      </div>

      <div id="ct_edit_modal" class="ct-edit-overlay">
        <div class="ct-edit-box">
          <div class="ct-edit-hdr">
            <span id="ct_edit_title">Edit word</span>
            <button id="ct_edit_x">✕</button>
          </div>
          <div class="ct-edit-body">
            <input type="hidden" id="ct_edit_id">
            <label class="ct-elabel">Word</label>
            <input type="text" id="ct_edit_word" class="ct-einput" placeholder="Vai'enn">
            <label class="ct-elabel">Category</label>
            <div id="ct_edit_cats" class="ct-ecats"></div>
            <label class="ct-elabel">Definition & emotional weight</label>
            <textarea id="ct_edit_def" class="ct-etextarea" placeholder="Meaning, resonance, how the character uses this word…"></textarea>
            <label class="ct-elabel">Resonance triggers <small>(comma-separated — boost score when found)</small></label>
            <input type="text" id="ct_edit_triggers" class="ct-einput" placeholder="кровь, угроза, blood, kill…">
            <label class="ct-elabel">Characters <small>(comma-separated, empty = any)</small></label>
            <input type="text" id="ct_edit_chars" class="ct-einput" placeholder="Gasil">
            <label class="ct-elabel">Relations <small>(type:wordId — root:5, compound:3)</small></label>
            <input type="text" id="ct_edit_relations" class="ct-einput" placeholder="root:1, compound:6">
            <label class="ct-elabel">Notes</label>
            <input type="text" id="ct_edit_notes" class="ct-einput" placeholder="Personal notes…">
            <label class="ct-ck-row"><input type="checkbox" id="ct_edit_pinned"> ⚓ Pin — always inject</label>
            <div id="ct_edit_history"></div>
            <div id="ct_edit_examples"></div>
          </div>
          <div class="ct-edit-footer">
            <button class="menu_button" id="ct_edit_cancel">Cancel</button>
            <button class="menu_button ct-save-btn" id="ct_edit_save">Save</button>
          </div>
        </div>
      </div>

      <div id="ct_cat_editor" class="ct-edit-overlay">
        <div class="ct-edit-box" style="max-width:440px">
          <div class="ct-edit-hdr">
            <span>Manage categories</span>
            <button id="ct_cat_editor_x">✕</button>
          </div>
          <div class="ct-edit-body">
            <div id="ct_cat_editor_body"></div>
            <button class="menu_button ct-gap" id="ct_cat_add_btn" style="width:100%">+ New category</button>
            <div id="ct_catedit_form" style="display:none;margin-top:10px;padding:10px;border:1px solid rgba(120,80,200,0.2);border-radius:8px">
              <div id="ct_catedit_title" class="ct-elabel" style="font-size:12px;color:#c4b5fd;font-weight:700">New category</div>
              <input type="hidden" id="ct_catedit_key">
              <label class="ct-elabel">Label</label>
              <input type="text" id="ct_catedit_label" class="ct-einput" placeholder="Desire">
              <div class="ct-2col ct-gap" style="gap:6px">
                <div style="flex:1">
                  <label class="ct-elabel">Icon</label>
                  <input type="text" id="ct_catedit_icon" class="ct-einput" placeholder="★" maxlength="2">
                </div>
                <div style="flex:1">
                  <label class="ct-elabel">Color</label>
                  <input type="color" id="ct_catedit_color" class="ct-einput" value="#a78bfa" style="padding:2px;height:30px">
                </div>
              </div>
              <label class="ct-elabel">Keywords <small>(comma-separated)</small></label>
              <textarea id="ct_catedit_kw" class="ct-etextarea" rows="3" placeholder="desire, want, need, crave, желание, жажда…"></textarea>
              <div class="ct-2col ct-gap" style="gap:6px;justify-content:flex-end">
                <button class="menu_button" id="ct_catedit_cancel">Cancel</button>
                <button class="menu_button ct-save-btn" id="ct_catedit_save">Save</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="ct_preview_modal" class="ct-edit-overlay">
        <div class="ct-edit-box" style="max-width:600px">
          <div class="ct-edit-hdr">
            <span>Injected prompt</span>
            <span id="ct_preview_tokens" style="font-size:10px;color:#7a8499;margin-left:auto;margin-right:10px"></span>
            <button id="ct_preview_x">✕</button>
          </div>
          <div class="ct-edit-body">
            <pre id="ct_preview_text" style="font-size:11px;color:#6a7a98;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow-y:auto;margin:0;font-family:inherit;line-height:1.6"></pre>
          </div>
        </div>
      </div>

      <input type="file" id="ct_import_file" accept=".json" style="display:none">
    `);

    // ── Tracker event wiring ──────────────────────────────────────
    $('#ct_tr_close,#ct_tr_close2').on('click', () => $('#ct_tracker').removeClass('ct-open'));
    $('#ct_tracker').on('click', function (e) { if (e.target === this) $(this).removeClass('ct-open'); });

    $('.ct-tr-tab').on('click', function () {
      trackerTab = this.dataset.tab;
      $('.ct-tr-tab').removeClass('active'); $(this).addClass('active');
      renderDrawer();
    });

    $('#ct_tr_sort').on('change', function () { trackerSort = this.value; renderWordList(); });

    let dbs = {};
    $('#ct_tr_search').on('input', function () {
      trackerSearch = this.value;
      clearTimeout(dbs.s);
      dbs.s = setTimeout(renderWordList, 180);
    });

    // Add word row — render category buttons dynamically
    _renderAddCats();
    let addCat = 'other';
    $(document).on('click', '#ct_add_cats .ct-add-cat', function () {
      addCat = this.dataset.cat;
      $('#ct_add_cats .ct-add-cat').removeClass('active');
      $(this).addClass('active');
    });
    $('#ct_add_btn').on('click', () => {
      const v = $('#ct_add_input').val().trim();
      if (v) { openEdit(null, v, addCat); $('#ct_add_input').val(''); }
    });
    $('#ct_add_input').on('keydown', e => {
      if (e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v) { openEdit(null, v, addCat); e.target.value = ''; }
      }
    });

    $('#ct_export_btn').on('click', exportDict);
    $('#ct_import_btn').on('click', () => $('#ct_import_file').click());
    $('#ct_import_file').on('change', importDict);
    $('#ct_scan_btn').on('click', manualScan);
    $('#ct_undo_btn').on('click', undoLastCapture);

    // Bulk actions
    $('#ct_bulk_btn').on('click', () => { $('#ct_bulk_menu').toggle(); });
    $(document).on('click', e => { if (!$(e.target).closest('.ct-bulk-drop').length) $('#ct_bulk_menu').hide(); });
    $('#ct_bulk_del_auto').on('click', () => { bulkDeleteAuto(); $('#ct_bulk_menu').hide(); });
    $('#ct_bulk_del_cat').on('click', () => {
      const s = getSettings();
      const cats = getCategories(s);
      const catKeys = Object.entries(cats).filter(([k]) => s.dict.some(w => w.cat === k)).map(([k, c]) => `${k} (${c.label})`);
      const choice = prompt(`Enter category key to delete all words:\n${catKeys.join('\n')}`);
      if (choice) { bulkDeleteCategory(choice.split('(')[0].trim()); }
      $('#ct_bulk_menu').hide();
    });

    // Edit modal
    $('#ct_edit_x,#ct_edit_cancel').on('click', closeEdit);
    $('#ct_edit_modal').on('click', function (e) { if (e.target === this) closeEdit(); });
    $('#ct_edit_save').on('click', saveEdit);
    $('#ct_edit_word').on('keydown', e => { if (e.key === 'Enter') saveEdit(); });
    $('#ct_edit_def').on('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) saveEdit(); });

    // Category editor
    $('#ct_cat_editor_x').on('click', closeCategoryEditor);
    $('#ct_cat_editor').on('click', function (e) { if (e.target === this) closeCategoryEditor(); });
    $('#ct_cat_add_btn').on('click', () => openCategoryEditForm(null));
    $('#ct_catedit_cancel').on('click', () => $('#ct_catedit_form').hide());
    $('#ct_catedit_save').on('click', saveCategoryEdit);

    // Preview modal
    $('#ct_preview_x').on('click', () => $('#ct_preview_modal').removeClass('ct-eopen'));
    $('#ct_preview_modal').on('click', function (e) { if (e.target === this) $(this).removeClass('ct-eopen'); });

    // Escape: close topmost layer
    $(document).on('keydown', e => {
      if (e.key !== 'Escape') return;
      if ($('#ct_cat_editor').hasClass('ct-eopen'))   { closeCategoryEditor(); return; }
      if ($('#ct_edit_modal').hasClass('ct-eopen'))    { closeEdit(); return; }
      if ($('#ct_preview_modal').hasClass('ct-eopen')) { $('#ct_preview_modal').removeClass('ct-eopen'); return; }
      if ($('#ct_tracker').hasClass('ct-open'))        { $('#ct_tracker').removeClass('ct-open'); }
    });
  }

  function _renderAddCats() {
    const cats = getCategories(getSettings());
    $('#ct_add_cats').html(
      Object.entries(cats).map(([k, c]) =>
        `<button class="ct-add-cat" data-cat="${esc(k)}" style="--cc:${esc(c.color)}" title="${esc(c.label)}">${esc(c.icon)}</button>`
      ).join('')
    );
  }


  /* ═══════════════════════════════════════════════════════════════════════════
     §24  TRACKER RENDERING
     ═══════════════════════════════════════════════════════════════════════════ */

  function renderDrawer() {
    const s = getSettings();
    const cats = getCategories(s);
    $('#ct_tr_title').text(s.langName);
    $('#ct_tr_meta').text(`${ctx().name2 || s.chars[0] || '—'} · ${s.dict.length} words`);

    // ── Stats tab ────────────────────────────────────────────────
    if (trackerTab === 'stats') {
      $('#ct_cat_bar,#ct_add_row,#ct_last_injected').hide();
      renderStatsTab();
      return;
    }

    // ── Rules tab ────────────────────────────────────────────────
    if (trackerTab === 'rules') {
      $('#ct_cat_bar,#ct_add_row,#ct_last_injected').hide();
      $('#ct_drawer_body').html(`
        <div class="ct-rules-wrap">
          <label class="ct-flabel" style="padding:0 4px">Phonetic rules</label>
          <textarea id="ct_tr_rules_area" class="ct-rules-edit" rows="8">${esc(s.rules || DEFAULT_RULES)}</textarea>
          <div class="ct-rules-actions">
            <button class="menu_button" id="ct_tr_rules_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
            <button class="menu_button ct-gen-btn" id="ct_tr_gen_rules_btn">✦ Generate</button>
          </div>
          <div id="ct_tr_rules_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>

          <label class="ct-flabel" style="padding:0 4px;margin-top:12px">Grammar patterns</label>
          <textarea id="ct_tr_grammar_area" class="ct-rules-edit" rows="6">${esc(s.grammarRules || DEFAULT_GRAMMAR)}</textarea>
          <div class="ct-rules-actions">
            <button class="menu_button" id="ct_tr_grammar_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
            <button class="menu_button ct-gen-btn" id="ct_tr_gen_grammar_btn">✦ Generate</button>
          </div>
          <div id="ct_tr_grammar_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>
        </div>
      `);
      let rt2, gt2;
      $('#ct_tr_rules_area').on('input', function () {
        clearTimeout(rt2); rt2 = setTimeout(() => {
          getSettings().rules = this.value; $('#ct_rules_area').val(this.value);
          ctx().saveSettingsDebounced(); updatePrompt();
        }, 600);
      });
      $('#ct_tr_rules_reset_btn').on('click', () => {
        const v = DEFAULT_RULES;
        $('#ct_tr_rules_area,#ct_rules_area').val(v);
        getSettings().rules = v; ctx().saveSettingsDebounced(); updatePrompt();
      });
      $('#ct_tr_gen_rules_btn').on('click', () => generateRules('ct_tr_gen_rules_btn', 'ct_tr_rules_area', 'ct_tr_rules_status', 'phonetic'));

      $('#ct_tr_grammar_area').on('input', function () {
        clearTimeout(gt2); gt2 = setTimeout(() => {
          getSettings().grammarRules = this.value; $('#ct_grammar_area').val(this.value);
          ctx().saveSettingsDebounced(); updatePrompt();
        }, 600);
      });
      $('#ct_tr_grammar_reset_btn').on('click', () => {
        const v = DEFAULT_GRAMMAR;
        $('#ct_tr_grammar_area,#ct_grammar_area').val(v);
        getSettings().grammarRules = v; ctx().saveSettingsDebounced(); updatePrompt();
      });
      $('#ct_tr_gen_grammar_btn').on('click', () => generateRules('ct_tr_gen_grammar_btn', 'ct_tr_grammar_area', 'ct_tr_grammar_status', 'grammar'));
      return;
    }

    // ── Words tab ────────────────────────────────────────────────
    $('#ct_cat_bar,#ct_add_row').show();
    if (_lastInjected.length) _renderLastInjectedBanner(s.dict.filter(w => _lastInjected.includes(w.id)));
    renderCatBar();
    renderWordList();
  }

  function renderCatBar() {
    const s = getSettings(), cats = getCategories(s), bc = {};
    s.dict.forEach(w => { bc[w.cat] = (bc[w.cat] || 0) + 1; });
    $('#ct_cat_bar').html(`
      <button class="ct-cat-chip ${trackerCat === 'all' ? 'active' : ''}" data-cat="all">All <span class="ct-n">${s.dict.length}</span></button>
      ${Object.entries(cats).map(([k, c]) => {
        const n = bc[k] || 0;
        if (!n) return '';
        return `<button class="ct-cat-chip ${trackerCat === k ? 'active' : ''}" data-cat="${esc(k)}" style="--cc:${esc(c.color)}">${esc(c.icon)} ${esc(c.label)} <span class="ct-n">${n}</span></button>`;
      }).join('')}
    `);
    $('#ct_cat_bar .ct-cat-chip').on('click', function () {
      trackerCat = this.dataset.cat;
      renderCatBar(); renderWordList();
    });
  }

  function renderWordList() {
    const s     = getSettings();
    const cats  = getCategories(s);
    const txt   = recentText();
    const tokens = tokenize(txt);

    let list = trackerCat === 'all' ? s.dict : s.dict.filter(w => w.cat === trackerCat);
    if (trackerSearch.trim()) {
      const q = trackerSearch.toLowerCase();
      list = list.filter(w => w.word.toLowerCase().includes(q) || w.def.toLowerCase().includes(q));
    }

    if      (trackerSort === 'alpha')  list = list.slice().sort((a, b) => a.word.localeCompare(b.word));
    else if (trackerSort === 'score')  list = list.slice().sort((a, b) => scoreWord(b, txt, tokens) - scoreWord(a, txt, tokens));
    else if (trackerSort === 'uses')   list = list.slice().sort((a, b) => (b.uses || 0) - (a.uses || 0));
    else if (trackerSort === 'recent') list = list.slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));

    const body = $('#ct_drawer_body');
    if (!list.length) {
      body.html(`<div class="ct-empty">No words yet. Click <b>+ Add</b> or let the model forge them ✦</div>`);
      return;
    }

    body.html(list.map(w => {
      const c     = cats[w.cat] || cats.other;
      const def   = w.def.length > 130 ? w.def.slice(0, 127) + '…' : w.def;
      const chars = (w.chars || []).join(', ');
      const isNew = _sessionNewIds.has(w.id);
      const sc    = scoreWord(w, txt, tokens);
      const scBar = Math.min(Math.round(sc * 10), 100);
      return `<div class="ct-word-row${w.disabled ? ' ct-disabled-row' : ''}" data-id="${w.id}">
        <span class="ct-wr-dot" style="background:${esc(c.color)}"></span>
        <div class="ct-wr-body">
          <div class="ct-wr-top">
            <span class="ct-wr-word">${esc(w.word)}</span>
            ${w.pinned   ? '<span class="ct-pin">⚓</span>' : ''}
            ${w.auto     ? '<span class="ct-auto">auto</span>' : ''}
            ${isNew      ? '<span class="ct-new">✦ new</span>' : ''}
            ${w.disabled ? '<span class="ct-auto" style="color:#888">paused</span>' : ''}
            <span class="ct-score-bar" title="Score: ${sc.toFixed(1)}"><span class="ct-score-fill" style="width:${scBar}%;background:${esc(c.color)}"></span></span>
          </div>
          <div class="ct-wr-def">${esc(def)}</div>
          ${chars ? `<div class="ct-wr-chars">◈ ${esc(chars)}</div>` : ''}
          ${(w.relations||[]).length ? `<div class="ct-wr-chars" style="color:rgba(167,139,250,0.5)">↔ ${w.relations.map(r=>`${r.type}→#${r.targetId}`).join(', ')}</div>` : ''}
        </div>
        <div class="ct-wr-acts">
          <span class="ct-uses" title="Times injected">↻${w.uses || 0}</span>
          <button class="ct-dis-btn" data-id="${w.id}" title="${w.disabled ? 'Enable' : 'Pause'}">${w.disabled ? '▶' : '⏸'}</button>
          <button class="ct-edit-btn" data-id="${w.id}" title="Edit">✎</button>
          <button class="ct-del-btn" data-id="${w.id}" title="Delete">✕</button>
        </div>
      </div>`;
    }).join(''));

    body.find('.ct-edit-btn').on('click', function (e) { e.stopPropagation(); openEdit(+this.dataset.id); });
    body.find('.ct-del-btn').on('click', function (e) { e.stopPropagation(); deleteWord(+this.dataset.id); });
    body.find('.ct-dis-btn').on('click', function (e) { e.stopPropagation(); toggleDisableWord(+this.dataset.id); });
    body.find('.ct-word-row').on('click', function () { openEdit(+this.dataset.id); });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §25  STATS TAB
     ═══════════════════════════════════════════════════════════════════════════ */

  function renderStatsTab() {
    const s = getSettings();
    const cats = getCategories(s);
    const dict = s.dict;

    // Category distribution
    const catCounts = {};
    dict.forEach(w => { catCounts[w.cat] = (catCounts[w.cat] || 0) + 1; });

    // Most used
    const topUsed = [...dict].sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 5);

    // Recently created
    const recentWords = [...dict].filter(w => w.createdAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

    // Auto vs manual
    const autoCount   = dict.filter(w => w.auto).length;
    const manualCount = dict.length - autoCount;

    // Words with history
    const evolvedCount = dict.filter(w => w.history && w.history.length > 0).length;

    const body = $('#ct_drawer_body');
    body.html(`
      <div class="ct-stats-wrap">
        <div class="ct-stats-section">
          <div class="ct-stats-title">Overview</div>
          <div class="ct-stats-grid">
            <div class="ct-stat-card">
              <div class="ct-stat-num">${dict.length}</div>
              <div class="ct-stat-label">Total words</div>
            </div>
            <div class="ct-stat-card">
              <div class="ct-stat-num">${Object.keys(cats).filter(k => catCounts[k]).length}</div>
              <div class="ct-stat-label">Active categories</div>
            </div>
            <div class="ct-stat-card">
              <div class="ct-stat-num">${autoCount} / ${manualCount}</div>
              <div class="ct-stat-label">Auto / Manual</div>
            </div>
            <div class="ct-stat-card">
              <div class="ct-stat-num">${evolvedCount}</div>
              <div class="ct-stat-label">Evolved words</div>
            </div>
          </div>
        </div>

        <div class="ct-stats-section">
          <div class="ct-stats-title">Category distribution</div>
          ${Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([k, n]) => {
            const c = cats[k] || cats.other;
            const pct = dict.length ? Math.round(n / dict.length * 100) : 0;
            return `<div class="ct-stat-bar-row">
              <span class="ct-stat-bar-label" style="color:${esc(c.color)}">${esc(c.icon)} ${esc(c.label)}</span>
              <div class="ct-stat-bar"><div class="ct-stat-bar-fill" style="width:${pct}%;background:${esc(c.color)}"></div></div>
              <span class="ct-stat-bar-num">${n}</span>
            </div>`;
          }).join('')}
        </div>

        <div class="ct-stats-section">
          <div class="ct-stats-title">Most used</div>
          ${topUsed.map(w => {
            const c = cats[w.cat] || cats.other;
            return `<div class="ct-stat-word-row">
              <span style="color:${esc(c.color)}">${esc(c.icon)}</span>
              <span class="ct-wr-word" style="font-size:12px">${esc(w.word)}</span>
              <span class="ct-uses">↻${w.uses || 0}</span>
            </div>`;
          }).join('') || '<div class="ct-hint">No usage data yet</div>'}
        </div>

        <div class="ct-stats-section">
          <div class="ct-stats-title">Recently forged</div>
          ${recentWords.map(w => {
            const c = cats[w.cat] || cats.other;
            const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '—';
            return `<div class="ct-stat-word-row">
              <span style="color:${esc(c.color)}">${esc(c.icon)}</span>
              <span class="ct-wr-word" style="font-size:12px">${esc(w.word)}</span>
              <span class="ct-uses">${date}</span>
            </div>`;
          }).join('') || '<div class="ct-hint">No dated words</div>'}
        </div>
      </div>
    `);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §26  CHAT MESSAGE PROCESSING
     ═══════════════════════════════════════════════════════════════════════════ */

  const _cleanedMsgs = new Set();

  function processChatMessage(idx) {
    const msg = (ctx().chat || [])[idx];
    if (!msg || msg.is_user) return;
    const text = msg.mes || '';

    captureFromMessage(text);
    captureExamples(text);

    if (text && /\[CT_WORD:/i.test(text)) {
      if (!_cleanedMsgs.has(idx)) {
        _cleanedMsgs.add(idx);
        msg.mes = cleanMarkers(text);
      }
      const el = document.querySelector(`[mesid="${idx}"] .mes_text`);
      if (el) el.innerHTML = cleanMarkers(el.innerHTML);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §27  EVENTS
     ═══════════════════════════════════════════════════════════════════════════ */

  function wireChatEvents() {
    const { eventSource, event_types } = ctx();

    eventSource.on(event_types.APP_READY, () => {
      ensureTracker();
      mountSettingsUi();
      updatePrompt();
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
      _cleanedMsgs.clear();
      updatePrompt();
      if ($('#ct_tracker').hasClass('ct-open')) renderDrawer();
    });

    eventSource.on(event_types.MESSAGE_SENT, () => {
      updatePrompt();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, (idx) => {
      processChatMessage(idx);
      updatePrompt();
      tryEvolve();
    });

    eventSource.on(event_types.MESSAGE_UPDATED, (idx) => {
      _cleanedMsgs.delete(idx);
      processChatMessage(idx);
      updatePrompt();
    });

    if (event_types.GENERATION_ENDED) {
      eventSource.on(event_types.GENERATION_ENDED, () => {
        const chat = ctx().chat || [], last = chat.length - 1;
        if (last >= 0 && !chat[last].is_user) processChatMessage(last);
        updatePrompt();
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     §28  BOOT
     ═══════════════════════════════════════════════════════════════════════════ */

  jQuery(() => {
    try {
      wireChatEvents();
      console.log('[Citadel Tongue v8] ✦ loaded');
    } catch (e) {
      console.error('[Citadel Tongue] init failed', e);
    }
  });

})();
