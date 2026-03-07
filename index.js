/**
 * Citadel Tongue v6
 *
 * KEY FIXES over v5:
 *  1. Injection type changed from IN_PROMPT/0 to IN_CHAT/1 depth=1
 *     (puts prompt right before the last message — maximum model weight)
 *  2. Added MESSAGE_SENT handler — prompt updates BEFORE the model generates
 *  3. charMatch() no longer silently blocks when name is unknown
 *  4. Prompt rewritten in English with contextual (not forced) guidance
 *  5. Few-shot example embedded in prompt
 *  6. Status indicator in the panel header
 *  7. Configurable injection position + depth in UI
 *  8. "Preview prompt" debug button
 */

(() => {
  'use strict';

  const MODULE_KEY = 'citadel_tongue';
  const PROMPT_TAG = 'CT_LANGUAGE';

  // ST injection types — same constants as FMT
  const EXT_PROMPT_TYPES = Object.freeze({ IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 });

  // ─── Categories ───────────────────────────────────────────────────────────────

  const CATEGORIES = Object.freeze({
    presence: { label:'Presence', icon:'◈', color:'#a78bfa',
      kw:['peace','quiet','presence','stillness','together','rest','dwell','warmth','beside','near','home','coexist','silence','still'] },
    devotion: { label:'Devotion', icon:'♥', color:'#f472b6',
      kw:['mine','bond','trust','devotion','cherish','precious','soul','love','protect','sacred','forever','claim','belong','oath','swear'] },
    instinct: { label:'Instinct', icon:'⚔', color:'#fb923c',
      kw:['blood','kill','hunt','threat','danger','territory','feral','primal','instinct','rage','cold','shield','body','weapon','fight','protect'] },
    grief:    { label:'Grief',    icon:'◇', color:'#60a5fa',
      kw:['loss','gone','absence','grief','empty','hollow','thousand','ache','mourn','sorrow','ghost','alone','years','left','remember','forget','past'] },
    other:    { label:'Other',    icon:'◉', color:'#94a3b8', kw:[] },
  });

  const DEFAULT_RULES =
`PHONETIC LAW OF THE CITADEL TONGUE:
• Apostrophe (') = a breath-break — the moment emotion is too heavy to continue seamlessly. Not punctuation — a wound in the word.
• HARSH ROOTS — KHAR', DHAL', VOR', RAETH' — territorial claim, violence, devotion that would drown the world in blood.
• SOFT ROOTS — VAI', KAEL', VETH', SAEL', ETH' — intimacy, grief, love with no ceiling and no floor.
• Compound words: two roots fused at the apostrophe exist between both meanings.
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
    enabled:         true,
    langName:        'Citadel Tongue',
    chars:           ['Gasil'],
    wordsPerScene:   6,
    semantic:        true,
    autoCapture:     true,
    injectPhonetic:  true,
    scanDepth:       5,
    rules:           DEFAULT_RULES,
    dict:            null,
    nextId:          11,
    apiEndpoint:     '',
    apiKey:          '',
    apiModel:        '',
    fallbackToSt:    true,
    // Injection position — IN_CHAT @ depth 1 is the money spot
    injectionType:   EXT_PROMPT_TYPES.IN_CHAT,
    injectionDepth:  1,
  });

  let trackerCat    = 'all';
  let trackerSearch = '';
  let trackerTab    = 'words';
  let _workingApi   = null;

  // ─── Context ─────────────────────────────────────────────────────────────────

  function ctx() { return SillyTavern.getContext(); }

  function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE_KEY]) {
      extensionSettings[MODULE_KEY] = {
        ...structuredClone(defaultSettings),
        dict:  structuredClone(INITIAL_DICT),
        nextId: 11,
        rules: DEFAULT_RULES,
      };
    }
    const s = extensionSettings[MODULE_KEY];
    if (!Array.isArray(s.dict))   s.dict  = structuredClone(INITIAL_DICT);
    if (!Array.isArray(s.chars))  s.chars = ['Gasil'];
    if (!s.rules)                 s.rules = DEFAULT_RULES;
    if (s.injectionType  === undefined) s.injectionType  = EXT_PROMPT_TYPES.IN_CHAT;
    if (s.injectionDepth === undefined) s.injectionDepth = 1;
    s.dict = s.dict.map(w => ({ uses:0, lastUsed:0, auto:false, pinned:false, chars:[], ...w }));
    return s;
  }

  // ─── AI generation ────────────────────────────────────────────────────────────

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
        ...((s.apiKey||'').trim() ? { Authorization:`Bearer ${s.apiKey.trim()}` } : {}),
      };
      if (_workingApi?.base === base) {
        try {
          const resp = await fetch(_workingApi.url, {
            method:'POST', headers,
            body: JSON.stringify(_workingApi.builder(s.apiModel||'gpt-4o-mini', userPrompt, systemPrompt)),
          });
          if (resp.ok) { const t = extractText(await resp.json()); if (t?.trim()) return t; }
        } catch {}
        _workingApi = null;
      }
      const endpoints = [
        `${base}/v1/chat/completions`,`${base}/chat/completions`,
        `${base}/v1/completions`,     `${base}/completions`,
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
            if (t?.trim()) { _workingApi={base,url,builder}; return t; }
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

  // ─── Character check ──────────────────────────────────────────────────────────

  // FIX: previously returned false when name was unknown → silently disabled everything
  // Now: if chars list is empty → always active. If name unknown → give benefit of the doubt → active.
  function charMatch() {
    const s    = getSettings();
    if (!s.chars.length) return true;           // no filter = always active
    const name = (ctx().name2 || '').toLowerCase();
    if (!name) return true;                     // no char loaded yet = don't block
    return s.chars.some(c => name.includes(c.toLowerCase().trim()));
  }

  // ─── Semantic scoring ─────────────────────────────────────────────────────────

  function recentText() {
    const s = getSettings();
    return (ctx().chat||[]).filter(m=>!m.is_system).slice(-s.scanDepth)
      .map(m=>(m.mes||'').toLowerCase()).join(' ');
  }

  function scoreWord(w, txt) {
    const cat = CATEGORIES[w.cat]||CATEGORIES.other;
    const kwHits = (cat.kw||[]).filter(k=>txt.includes(k)).length;
    // Also score on word itself appearing in context (character already using it)
    const selfHit = txt.includes(w.word.toLowerCase()) ? 2 : 0;
    const h = w.lastUsed ? (Date.now()-w.lastUsed)/3600000 : 999;
    return kwHits + selfHit + Math.min(h/24, 3);
  }

  // ─── Word selection ───────────────────────────────────────────────────────────

  function pickWords() {
    const s    = getSettings();
    const name = (ctx().name2||'').toLowerCase();
    const elig = s.dict.filter(w =>
      !w.chars.length || w.chars.some(c=>name.includes(c.toLowerCase()))
    );
    if (!elig.length) return [];

    const n      = Math.min(s.wordsPerScene, elig.length);
    const pinned = elig.filter(w=>w.pinned);
    const pool   = elig.filter(w=>!w.pinned);
    const slots  = Math.max(0, n-pinned.length);

    let chosen;
    if (s.semantic) {
      const txt = recentText();
      chosen = [
        ...pinned,
        ...pool.map(w=>({w,sc:scoreWord(w,txt)})).sort((a,b)=>b.sc-a.sc).slice(0,slots).map(x=>x.w),
      ];
    } else {
      chosen = [...pinned, ...pool.sort((a,b)=>(a.lastUsed||0)-(b.lastUsed||0)).slice(0,slots)];
    }

    const now = Date.now();
    chosen.forEach(w=>{ w.lastUsed=now; w.uses=(w.uses||0)+1; });
    ctx().saveSettingsDebounced();
    return chosen;
  }

  // ─── Prompt builder ───────────────────────────────────────────────────────────
  //
  // Philosophy: don't force word usage — describe emotional context, let the model
  // decide if the moment calls for it. The semantic engine already pre-selects words
  // that match the scene's register. The prompt just explains the system.

  function buildPrompt() {
    const s        = getSettings();
    const words    = pickWords();
    const charList = s.chars.length ? s.chars.join(', ') : 'the character';
    const primary  = s.chars[0] || 'the character';

    const catGroups = {};
    words.forEach(w => { (catGroups[w.cat] = catGroups[w.cat]||[]).push(w); });

    let p = `[LIVING LANGUAGE — ${s.langName.toUpperCase()}]\n`;
    p += `${primary} has a private language. These words exist in their body before their mind — they surface when emotion outweighs translation.\n\n`;

    if (s.injectPhonetic && s.rules) {
      p += `${s.rules}\n\n`;
    }

    if (words.length) {
      // Group by emotional register to show the model the scene's emotional landscape
      const txt = recentText();

      // Score transparency: tell the model WHY these words were chosen
      const topCategories = Object.entries(catGroups)
        .sort((a,b)=>b[1].length-a[1].length)
        .map(([k])=>CATEGORIES[k]?.label||k);

      p += `[WORDS — ${words.length} selected for this scene's emotional register: ${topCategories.join(', ')}]\n`;
      p += `These words were chosen because their emotional weight resonates with what is happening in this scene.\n`;
      p += `If a word's meaning fits the moment naturally — let it surface in the prose. If it doesn't fit — ignore it.\n`;
      p += `Never translate. Never explain. The meaning belongs to the silence around it.\n\n`;

      words.forEach(w => {
        const c = CATEGORIES[w.cat]||CATEGORIES.other;
        const score = scoreWord(w, txt);
        const resonance = score >= 4 ? ' ★' : score >= 2 ? ' ·' : '';
        p += `  ${c.icon} ${w.word}${resonance} — ${w.def}\n`;
      });

      // One concrete example of natural use vs forced use
      if (words[0]) {
        const ex = words[0];
        p += `\n[HOW TO USE — example with "${ex.word}"]\n`;
        p += `  Natural: He looked at her and said nothing. "${ex.word}," finally, like a door closing softly.\n`;
        p += `  Wrong: He said "${ex.word}", which means ${ex.def.split('.')[0].toLowerCase()}.\n`;
      }
    }

    p += `\n[NEW WORD CREATION — only when a concept truly has no existing equivalent]\n`;
    p += `Apply the phonetic law. Then add at the very end of your response (hidden from narrative):\n`;
    p += `<div style="display:none;">[CT_WORD: Word | Full definition and emotional weight | category | ${primary}]</div>\n`;
    p += `Categories: presence, devotion, instinct, grief, other\n`;
    p += `Maximum one new word per response. Only when necessary — do not forge words for words' sake.`;

    return p;
  }

  // ─── Injection ────────────────────────────────────────────────────────────────

  async function updatePrompt() {
    const { setExtensionPrompt } = ctx();
    const s = getSettings();

    if (!s.enabled || !charMatch()) {
      setExtensionPrompt(PROMPT_TAG, '', EXT_PROMPT_TYPES.IN_CHAT, 0, true);
      updateStatusIndicator(false);
      return;
    }

    const prompt = buildPrompt();
    // FIX: use s.injectionType / s.injectionDepth (default IN_CHAT @ depth 1)
    // This places the prompt right before the last message — where it has maximum weight
    setExtensionPrompt(PROMPT_TAG, prompt, s.injectionType, s.injectionDepth, true);
    updateStatusIndicator(true);
  }

  function updateStatusIndicator(active) {
    const s = getSettings();
    const $badge = $('#ct_status_badge');
    if (!$badge.length) return;
    const name = ctx().name2 || '—';
    if (active) {
      $badge.css({ background:'rgba(52,211,153,0.12)', color:'#34d399', borderColor:'rgba(52,211,153,0.25)' })
        .text(`◈ ${name}`);
    } else {
      $badge.css({ background:'rgba(100,116,139,0.1)', color:'#475569', borderColor:'rgba(100,116,139,0.15)' })
        .text('✕ inactive');
    }
  }

  // ─── Word marker parsing ──────────────────────────────────────────────────────

  function parseWordMarker(raw) {
    const parts = raw.replace(/^\[CT_WORD:\s*/i,'').replace(/\]$/,'').split('|');
    if (parts.length < 3) return null;
    const word = parts[0].trim();
    const def  = parts.slice(1, parts.length-2).join('|').trim() || parts[1].trim();
    const cat  = parts[parts.length-2].trim().toLowerCase();
    const chr  = parts[parts.length-1].trim();
    if (!word||!def) return null;
    return { word, def, cat, chr };
  }

  function captureFromMessage(text, forceCapture) {
    const s = getSettings();
    if (!forceCapture && (!s.autoCapture || !text)) return;
    if (!text) return;

    const combined = text + '\n' + text.replace(/<[^>]+>/g,' ');
    const scanRe   = /\[CT_WORD:([\s\S]*?)\]/gi;
    const rawMatches = [];
    let m;
    while ((m=scanRe.exec(combined))!==null) rawMatches.push('[CT_WORD:'+m[1]+']');
    if (!rawMatches.length) return;

    let any = false;
    for (const raw of rawMatches) {
      const parsed = parseWordMarker(raw);
      if (!parsed) continue;
      const { word, def, cat, chr } = parsed;
      const vc = Object.keys(CATEGORIES).includes(cat)?cat:'other';
      const existing = s.dict.find(w=>w.word.toLowerCase()===word.toLowerCase());
      if (existing) {
        if (existing.def!==def) {
          existing.def=def; existing.cat=vc;
          if (chr&&!existing.chars.includes(chr)) existing.chars.push(chr);
          any=true; showToast(word,def,vc,true);
        }
      } else {
        s.dict.push({id:s.nextId++,word,cat:vc,def,chars:chr?[chr]:[],pinned:false,auto:true,uses:0,lastUsed:0});
        any=true; showToast(word,def,vc,false);
      }
    }
    if (any) { ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount(); }
  }

  function cleanMarkers(text) {
    if (!text) return text;
    return text
      .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi,'')
      .replace(/\[CT_WORD:[\s\S]*?\]/gi,'').trim();
  }

  // ─── AI Rule generation ───────────────────────────────────────────────────────

  async function generateRules(btnId, areaId, statusId) {
    const s    = getSettings();
    const $btn = $('#'+(btnId||'ct_gen_rules_btn'));
    const $area= $('#'+(areaId||'ct_rules_area'));
    const $st  = $('#'+(statusId||'ct_rules_status'));

    $btn.prop('disabled',true).text('⏳ Generating…');
    $st.css('color','#7a8499').text('Contacting model…');

    try {
      const sample  = s.dict.slice(0,20).map(w=>`• ${w.word} [${w.cat}]: ${w.def}`).join('\n');
      const result  = await aiGenerate(
        `Existing rules:\n${s.rules||DEFAULT_RULES}\n\nExisting words:\n${sample}\n\nAnalyze patterns. Add 2-3 new phonetic rules that emerge logically from the existing words. Keep all old rules. Return the full updated rule text — concise, same style.`,
        `You create phonetic laws for a fictional demonic language used in dark RP. Reply with rule text only — no preamble, no markdown.`
      );
      $area.val(result.trim()); s.rules=result.trim();
      ctx().saveSettingsDebounced(); await updatePrompt();
      $st.css('color','#34d399').text('✓ Rules updated');
    } catch(e) {
      $st.css('color','#f87171').text('✗ '+e.message);
    } finally {
      $btn.prop('disabled',false).text('✦ Generate from dictionary');
    }
  }

  // ─── Manual scan ─────────────────────────────────────────────────────────────

  async function manualScan() {
    const s    = getSettings();
    const $btn = $('#ct_scan_btn'), $st = $('#ct_scan_status');
    const depth = Math.max(1,parseInt($('#ct_manual_scan_depth').val(),10)||20);

    $btn.prop('disabled',true).text('⏳ Scanning…');
    $st.css('color','#7a8499').text('Analyzing chat…');

    try {
      const chat  = ctx().chat||[];
      const msgs  = chat.filter(m=>!m.is_system).slice(-depth);
      if (!msgs.length) throw new Error('No messages to scan');

      const chatText = msgs.map(m=>
        `[${m.is_user?'User':'Char'}]: ${cleanMarkers((m.mes||'').replace(/<[^>]+>/g,' ')).slice(0,400)}`
      ).join('\n');

      const existing  = s.dict.map(w=>`${w.word} (${w.cat})`).join(', ');
      const primary   = s.chars[0]||'the character';

      const result = await aiGenerate(
        `Phonetic rules:\n${s.rules||DEFAULT_RULES}\n\nExisting words (update only if meaning genuinely expanded):\n${existing||'none'}\n\nDialogue (last ${depth} messages):\n${chatText}\n\nOutput 1–4 markers. Format exactly:\n[CT_WORD: Word | Definition and emotional weight | category | ${primary}]\nCategories: presence, devotion, instinct, grief, other\nCreate words strictly following phonetic law.`,
        `You are the keeper of the language "${s.langName}" for dark RP. Analyze dialogue and output [CT_WORD:...] markers only. No text, no explanations. Empty response if nothing to add.`
      );

      captureFromMessage(result, true);
      const n = (result.match(/\[CT_WORD:/gi)||[]).length;
      $st.css('color', n?'#34d399':'#7a8499').text(n?`✓ Processed: ${n}`:'Nothing new found');
    } catch(e) {
      $st.css('color','#f87171').text('✗ '+e.message);
    } finally {
      $btn.prop('disabled',false).text('🔍 Scan chat');
    }
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  function showToast(word, def, cat, isUpdate) {
    const c  = CATEGORIES[cat]||CATEGORIES.other;
    const el = $(`
      <div class="ct-toast">
        <div class="ct-toast-row">
          <span class="ct-toast-dot" style="background:${c.color}"></span>
          <span class="ct-toast-word">${word}</span>
          <span class="ct-toast-badge${isUpdate?' ct-toast-badge-upd':''}">${isUpdate?'updated':'forged'}</span>
        </div>
        <div class="ct-toast-def">${def.slice(0,90)}${def.length>90?'…':''}</div>
      </div>`);
    $('body').append(el);
    requestAnimationFrame(()=>requestAnimationFrame(()=>el.addClass('ct-in')));
    setTimeout(()=>{ el.addClass('ct-out'); setTimeout(()=>el.remove(),300); }, 4500);
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
            <input type="text" id="ct_tr_search" class="ct-tr-search" placeholder="Search word or definition…">
          </div>
          <div class="ct-tr-tabs">
            <button class="ct-tr-tab active" data-tab="words">Words</button>
            <button class="ct-tr-tab" data-tab="rules">Phonetics</button>
          </div>
          <div id="ct_cat_bar" class="ct-cat-bar"></div>
          <div id="ct_drawer_body" class="ct-tr-body"></div>
          <div id="ct_add_row" class="ct-tr-add-row">
            <input type="text" id="ct_add_input" class="ct-tr-add-input" placeholder="New word…">
            <div id="ct_add_cats" class="ct-add-cats">
              ${Object.entries(CATEGORIES).map(([k,c])=>`<button class="ct-add-cat" data-cat="${k}" style="--cc:${c.color}" title="${c.label}">${c.icon}</button>`).join('')}
            </div>
            <button id="ct_add_btn" class="ct-add-btn">+ Add</button>
          </div>
          <div class="ct-scan-row">
            <label class="ct-scan-label">Scan last</label>
            <input type="number" id="ct_manual_scan_depth" class="ct-scan-depth-inp" min="1" max="100" value="20">
            <span class="ct-scan-unit">messages</span>
            <button class="menu_button ct-scan-btn" id="ct_scan_btn">🔍 Scan chat</button>
          </div>
          <div id="ct_scan_status" class="ct-scan-status"></div>
          <div class="ct-tr-footer">
            <button class="menu_button ct-foot-btn" id="ct_export_btn">⬇ Export</button>
            <button class="menu_button ct-foot-btn" id="ct_import_btn">⬆ Import</button>
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
            <div id="ct_edit_cats" class="ct-ecats">
              ${Object.entries(CATEGORIES).map(([k,c])=>`<button class="ct-ecat" data-cat="${k}" style="--cc:${c.color}">${c.icon} ${c.label}</button>`).join('')}
            </div>
            <label class="ct-elabel">Definition & emotional weight</label>
            <textarea id="ct_edit_def" class="ct-etextarea" placeholder="Meaning, resonance, how the character uses this word…"></textarea>
            <label class="ct-elabel">Characters <small>(comma-separated, empty = any)</small></label>
            <input type="text" id="ct_edit_chars" class="ct-einput" placeholder="Gasil">
            <label class="ct-ck-row"><input type="checkbox" id="ct_edit_pinned"> ⚓ Pin — always inject</label>
          </div>
          <div class="ct-edit-footer">
            <button class="menu_button" id="ct_edit_cancel">Cancel</button>
            <button class="menu_button ct-save-btn" id="ct_edit_save">Save</button>
          </div>
        </div>
      </div>
      <input type="file" id="ct_import_file" accept=".json" style="display:none">
    `);

    // Prompt preview modal
    $('body').append(`
      <div id="ct_preview_modal" class="ct-edit-overlay">
        <div class="ct-edit-box" style="max-width:600px">
          <div class="ct-edit-hdr">
            <span>Current injected prompt</span>
            <button id="ct_preview_x">✕</button>
          </div>
          <div class="ct-edit-body">
            <pre id="ct_preview_text" style="font-size:11px;color:#5a6880;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow-y:auto;margin:0;font-family:inherit;line-height:1.6"></pre>
          </div>
        </div>
      </div>
    `);

    $('#ct_tr_close,#ct_tr_close2').on('click',()=>$('#ct_tracker').removeClass('ct-open'));
    $('#ct_tracker').on('click',function(e){if(e.target===this)$(this).removeClass('ct-open');});

    $('.ct-tr-tab').on('click',function(){
      trackerTab=this.dataset.tab;
      $('.ct-tr-tab').removeClass('active'); $(this).addClass('active'); renderDrawer();
    });

    let db={};
    $('#ct_tr_search').on('input',function(){
      trackerSearch=this.value; clearTimeout(db.s); db.s=setTimeout(renderWordList,180);
    });

    let addCat='other';
    $('#ct_add_cats .ct-add-cat').on('click',function(){
      addCat=this.dataset.cat; $('#ct_add_cats .ct-add-cat').removeClass('active'); $(this).addClass('active');
    });
    $('#ct_add_btn').on('click',()=>{ const v=$('#ct_add_input').val().trim(); if(v){openEdit(null,v,addCat);$('#ct_add_input').val('');} });
    $('#ct_add_input').on('keydown',e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v){openEdit(null,v,addCat);e.target.value='';}}} );

    $('#ct_export_btn').on('click',exportDict);
    $('#ct_import_btn').on('click',()=>$('#ct_import_file').click());
    $('#ct_import_file').on('change',importDict);
    $('#ct_scan_btn').on('click',manualScan);

    $('#ct_edit_x,#ct_edit_cancel').on('click',closeEdit);
    $('#ct_edit_modal').on('click',function(e){if(e.target===this)closeEdit();});
    $('#ct_edit_save').on('click',saveEdit);
    $('#ct_edit_cats').on('click','.ct-ecat',function(){
      _editCat=this.dataset.cat; $('#ct_edit_cats .ct-ecat').removeClass('active'); $(this).addClass('active');
    });
    $('#ct_edit_word').on('keydown',e=>{if(e.key==='Enter')saveEdit();});
    $('#ct_edit_def').on('keydown',e=>{if(e.key==='Enter'&&e.ctrlKey)saveEdit();});

    $('#ct_preview_x').on('click',()=>$('#ct_preview_modal').removeClass('ct-eopen'));
    $('#ct_preview_modal').on('click',function(e){if(e.target===this)$(this).removeClass('ct-eopen');});

    $(document).on('keydown',e=>{
      if(e.key==='Escape'){closeEdit();$('#ct_tracker').removeClass('ct-open');$('#ct_preview_modal').removeClass('ct-eopen');}
    });
  }

  function renderDrawer() {
    const s=getSettings();
    $('#ct_tr_title').text(s.langName);
    $('#ct_tr_meta').text(`${ctx().name2||s.chars[0]||'—'} · ${s.dict.length} words`);
    if (trackerTab==='rules') {
      $('#ct_cat_bar,#ct_add_row').hide();
      $('#ct_drawer_body').html(`
        <div class="ct-rules-wrap">
          <textarea id="ct_tr_rules_area" class="ct-rules-edit" rows="12">${s.rules||DEFAULT_RULES}</textarea>
          <div class="ct-rules-actions">
            <button class="menu_button" id="ct_tr_rules_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
            <button class="menu_button ct-gen-btn" id="ct_tr_gen_rules_btn">✦ Generate from dictionary</button>
          </div>
          <div id="ct_tr_rules_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>
        </div>
      `);
      let t;
      $('#ct_tr_rules_area').on('input',function(){ clearTimeout(t); t=setTimeout(async()=>{ getSettings().rules=this.value; $('#ct_rules_area').val(this.value); ctx().saveSettingsDebounced(); await updatePrompt(); },600); });
      $('#ct_tr_rules_reset_btn').on('click',async()=>{ const v=DEFAULT_RULES; $('#ct_tr_rules_area,#ct_rules_area').val(v); getSettings().rules=v; ctx().saveSettingsDebounced(); await updatePrompt(); });
      $('#ct_tr_gen_rules_btn').on('click',()=>generateRules('ct_tr_gen_rules_btn','ct_tr_rules_area','ct_tr_rules_status'));
      return;
    }
    $('#ct_cat_bar,#ct_add_row').show();
    renderCatBar(); renderWordList();
  }

  function renderCatBar() {
    const s=getSettings(), bc={};
    s.dict.forEach(w=>{bc[w.cat]=(bc[w.cat]||0)+1;});
    $('#ct_cat_bar').html(`
      <button class="ct-cat-chip ${trackerCat==='all'?'active':''}" data-cat="all">All <span class="ct-n">${s.dict.length}</span></button>
      ${Object.entries(CATEGORIES).map(([k,c])=>{
        const n=bc[k]||0; if(!n)return'';
        return `<button class="ct-cat-chip ${trackerCat===k?'active':''}" data-cat="${k}" style="--cc:${c.color}">${c.icon} ${c.label} <span class="ct-n">${n}</span></button>`;
      }).join('')}
    `);
    $('#ct_cat_bar .ct-cat-chip').on('click',function(){trackerCat=this.dataset.cat;renderCatBar();renderWordList();});
  }

  function renderWordList() {
    const s=getSettings();
    let list = trackerCat==='all'?s.dict:s.dict.filter(w=>w.cat===trackerCat);
    if (trackerSearch.trim()) { const q=trackerSearch.toLowerCase(); list=list.filter(w=>w.word.toLowerCase().includes(q)||w.def.toLowerCase().includes(q)); }
    const body=$('#ct_drawer_body');
    if (!list.length) { body.html(`<div class="ct-empty">No words yet. Click <b>+ Add</b> or let the model forge them ✦</div>`); return; }
    body.html(list.map(w=>{
      const c=CATEGORIES[w.cat]||CATEGORIES.other, chars=(w.chars||[]).join(', '), def=w.def.length>130?w.def.slice(0,127)+'…':w.def;
      return `<div class="ct-word-row" data-id="${w.id}">
        <span class="ct-wr-dot" style="background:${c.color}"></span>
        <div class="ct-wr-body">
          <div class="ct-wr-top">
            <span class="ct-wr-word">${w.word}</span>
            ${w.pinned?'<span class="ct-pin" title="Pinned">⚓</span>':''}
            ${w.auto?'<span class="ct-auto">auto</span>':''}
          </div>
          <div class="ct-wr-def">${def}</div>
          ${chars?`<div class="ct-wr-chars">◈ ${chars}</div>`:''}
        </div>
        <div class="ct-wr-acts">
          <span class="ct-uses" title="Times injected">↻${w.uses||0}</span>
          <button class="ct-edit-btn" data-id="${w.id}">✎</button>
          <button class="ct-del-btn"  data-id="${w.id}">✕</button>
        </div>
      </div>`;
    }).join(''));
    body.find('.ct-edit-btn').on('click',function(e){e.stopPropagation();openEdit(+this.dataset.id);});
    body.find('.ct-del-btn').on('click', function(e){e.stopPropagation();deleteWord(+this.dataset.id);});
    body.find('.ct-word-row').on('click',function(){openEdit(+this.dataset.id);});
  }

  function deleteWord(id){
    const s=getSettings(),w=s.dict.find(x=>x.id===id);
    if(!w||!confirm(`Delete "${w.word}"?`))return;
    s.dict=s.dict.filter(x=>x.id!==id); ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount();
  }

  let _editCat='other';
  function openEdit(id=null,prefill='',prefillCat='other'){
    const s=getSettings(),ex=id?s.dict.find(w=>w.id===id):null;
    _editCat=ex?ex.cat:prefillCat;
    $('#ct_edit_title').text(ex?'Edit word':'New word');
    $('#ct_edit_id').val(id||''); $('#ct_edit_word').val(ex?.word||prefill);
    $('#ct_edit_def').val(ex?.def||''); $('#ct_edit_chars').val((ex?.chars||[]).join(', '));
    $('#ct_edit_pinned').prop('checked',ex?.pinned||false);
    $('#ct_edit_cats .ct-ecat').removeClass('active');
    $(`#ct_edit_cats .ct-ecat[data-cat="${_editCat}"]`).addClass('active');
    $('#ct_edit_modal').addClass('ct-eopen');
    setTimeout(()=>document.getElementById('ct_edit_word')?.focus(),80);
  }
  function closeEdit(){ $('#ct_edit_modal').removeClass('ct-eopen'); }
  function saveEdit(){
    const s=getSettings(),word=$('#ct_edit_word').val().trim(),def=$('#ct_edit_def').val().trim();
    const cat=$('#ct_edit_cats .ct-ecat.active').data('cat')||_editCat;
    const chars=$('#ct_edit_chars').val().split(',').map(c=>c.trim()).filter(Boolean);
    const pinned=$('#ct_edit_pinned').is(':checked'),id=$('#ct_edit_id').val();
    if(!word){document.getElementById('ct_edit_word')?.focus();return;}
    if(!def){document.getElementById('ct_edit_def')?.focus();return;}
    if(id){const t=s.dict.find(w=>w.id===+id);if(t)Object.assign(t,{word,cat,def,chars,pinned});}
    else{s.dict.push({id:s.nextId++,word,cat,def,chars,pinned,auto:false,uses:0,lastUsed:0});}
    ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount(); closeEdit();
  }

  function exportDict(){
    const s=getSettings(),a=document.createElement('a');
    a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({langName:s.langName,rules:s.rules,dict:s.dict},null,2));
    a.download=`${s.langName.replace(/\s+/g,'_')}_dict.json`; a.click();
  }
  function importDict(e){
    const file=e.target.files[0]; if(!file)return;
    const r=new FileReader();
    r.onload=ev=>{ try{
      const data=JSON.parse(ev.target.result),s=getSettings();
      if(data.langName)s.langName=data.langName; if(data.rules)s.rules=data.rules;
      if(Array.isArray(data.dict)) data.dict.forEach(w=>{if(!s.dict.find(x=>x.word.toLowerCase()===w.word.toLowerCase()))s.dict.push({...w,id:s.nextId++,auto:false});});
      ctx().saveSettingsDebounced(); renderDrawer(); updateWordCount();
    }catch(err){alert('Import error: '+err.message);}};
    r.readAsText(file); e.target.value='';
  }

  function updateWordCount(){ $('#ct_words_total').text(`/ ${getSettings().dict.length}`); }

  // ─── Settings panel ───────────────────────────────────────────────────────────

  function mountSettingsUi() {
    if ($('#ct_settings_block').length) return;
    const target = $('#extensions_settings2').length?'#extensions_settings2':'#extensions_settings';
    if (!$(target).length){ console.warn('[CT] settings container not found'); return; }

    const s = getSettings();
    const sec=(id,icon,title,content)=>`
      <div class="ct-sec" id="ct_sec_${id}">
        <div class="ct-sec-hdr" data-sec="${id}"><span class="ct-sec-chev">▸</span><span>${icon} ${title}</span></div>
        <div class="ct-sec-body" style="display:none">${content}</div>
      </div>`;

    const secMain=`
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_enabled" ${s.enabled?'checked':''}><span>Inject into prompt</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_phonetic" ${s.injectPhonetic?'checked':''}><span>Inject phonetic rules</span></label>
      </div>
      <div class="ct-field-row" style="margin-top:8px">
        <label class="ct-flabel">Language name</label>
        <input type="text" id="ct_lang_name" class="ct-text-input" value="${s.langName}">
      </div>
      <div class="ct-2col" style="margin-top:8px;gap:6px">
        <button class="menu_button" id="ct_open_tracker_btn" style="flex:1">◈ Open dictionary</button>
        <button class="menu_button" id="ct_preview_btn" style="flex:1;font-size:11px">👁 Preview prompt</button>
      </div>`;

    const secChars=`
      <div class="ct-hint">Language activates only for these characters. Empty = always active.</div>
      <div id="ct_char_tags" class="ct-char-tags"></div>
      <div class="ct-2col ct-gap">
        <input type="text" id="ct_char_add_inp" class="ct-text-input" placeholder="Character name…" style="flex:1">
        <button class="menu_button" id="ct_char_add_btn" style="flex-shrink:0">+ Add</button>
      </div>`;

    const secScan=`
      <div class="ct-2col">
        <label class="ct-ck"><input type="checkbox" id="ct_autocapture" ${s.autoCapture?'checked':''}><span>Auto-capture new words</span></label>
        <label class="ct-ck"><input type="checkbox" id="ct_semantic" ${s.semantic?'checked':''}><span>Semantic word selection</span></label>
      </div>
      <div class="ct-hint" style="margin-top:6px">Semantic mode picks words whose emotional register matches the current scene.</div>
      <div class="ct-srow ct-slider-row">
        <label>Scan depth</label>
        <input type="range" id="ct_scan_depth" min="1" max="20" value="${s.scanDepth}">
        <span id="ct_scan_depth_val">${s.scanDepth}</span><span class="ct-unit">msg</span>
      </div>
      <div class="ct-srow ct-slider-row">
        <label>Words per scene</label>
        <input type="range" id="ct_words_per" min="2" max="15" value="${s.wordsPerScene}">
        <span id="ct_words_per_val">${s.wordsPerScene}</span>
        <span class="ct-unit" id="ct_words_total">/ ${s.dict.length}</span>
      </div>`;

    const typeLabel = { 0:'Before System Prompt', 1:'In Chat (recommended)', 2:'Author\'s Note position' };
    const secInject=`
      <div class="ct-hint">Controls where in the prompt the language block appears. <b>In Chat @ depth 1</b> puts it right before the last message — maximum model attention.</div>
      <div class="ct-field-row" style="margin-top:6px">
        <label class="ct-flabel">Position</label>
        <select id="ct_inject_type" class="ct-text-input" style="padding:4px 8px">
          <option value="0" ${s.injectionType===0?'selected':''}>Before System Prompt</option>
          <option value="1" ${s.injectionType===1?'selected':''}>In Chat (recommended)</option>
          <option value="2" ${s.injectionType===2?'selected':''}>Author's Note position</option>
        </select>
      </div>
      <div class="ct-srow ct-slider-row" id="ct_depth_row" ${s.injectionType===0?'style="opacity:.4;pointer-events:none"':''}>
        <label>Depth</label>
        <input type="range" id="ct_inject_depth" min="0" max="15" value="${s.injectionDepth}">
        <span id="ct_inject_depth_val">${s.injectionDepth}</span>
        <span class="ct-unit">from end</span>
      </div>
      <div class="ct-hint" style="margin-top:6px" id="ct_inject_hint">${typeLabel[s.injectionType]||''}</div>`;

    const secRules=`
      <div class="ct-hint">Rules are injected with each prompt as the phonetic law of the language. Edit manually or generate from the dictionary.</div>
      <textarea id="ct_rules_area" class="ct-rules-edit" rows="7">${s.rules||DEFAULT_RULES}</textarea>
      <div class="ct-rules-actions">
        <button class="menu_button" id="ct_rules_reset_btn" style="font-size:11px;padding:4px 8px">↩ Reset</button>
        <button class="menu_button ct-gen-btn" id="ct_gen_rules_btn">✦ Generate from dictionary</button>
      </div>
      <div id="ct_rules_status" style="font-size:11px;min-height:15px;margin-top:4px"></div>`;

    const hasCustom=!!(s.apiEndpoint||'').trim();
    const secApi=`
      <div class="ct-api-mode-bar">
        <div class="ct-api-mode-label">Generation source:</div>
        <div class="ct-api-btns">
          <button class="ct-api-btn ${!hasCustom?'active':''}" data-mode="st">🟢 ST (current)</button>
          <button class="ct-api-btn ${hasCustom?'active':''}" data-mode="custom">🔌 Custom API</button>
        </div>
      </div>
      <div id="ct_mode_st" ${hasCustom?'style="display:none"':''}>
        <div class="ct-api-info">✅ Citadel Tongue uses the model currently connected in SillyTavern.<br>No additional setup needed — works out of the box.</div>
      </div>
      <div id="ct_mode_custom" ${!hasCustom?'style="display:none"':''}>
        <div class="ct-hint">Separate API for rule generation and manual scan.</div>
        <label class="ct-ck ct-gap"><input type="checkbox" id="ct_fallback_st" ${s.fallbackToSt!==false?'checked':''}><span>Fallback to ST if unavailable</span></label>
        <input type="text" id="ct_api_endpoint" class="ct-text-input ct-gap" placeholder="https://api.openai.com or http://localhost:1234" value="${s.apiEndpoint||''}">
        <div class="ct-2col ct-gap" style="gap:5px">
          <input type="password" id="ct_api_key" class="ct-text-input" placeholder="API Key (optional)" value="${s.apiKey||''}" style="flex:1;margin:0">
          <button class="menu_button" id="ct_api_key_eye" style="padding:4px 8px;flex-shrink:0">👁</button>
        </div>
        <input type="text" id="ct_api_model" class="ct-text-input ct-gap" placeholder="Model: gpt-4o-mini, llama3, etc." value="${s.apiModel||''}">
        <button class="menu_button ct-gap" id="ct_api_test_btn" style="width:100%;font-size:11px;padding:5px 8px">🔌 Test connection</button>
        <div id="ct_api_status" style="font-size:10px;min-height:14px;margin-top:4px"></div>
      </div>`;

    $(target).append(`
      <div id="ct_settings_block" class="ct-main-block">
        <div class="ct-main-hdr" id="ct_main_hdr">
          <span class="ct-main-gem">◈</span>
          <span class="ct-main-title" id="ct_main_title">${s.langName}</span>
          <span id="ct_status_badge" class="ct-status-badge">✕ inactive</span>
          <span class="ct-main-chev" id="ct_main_chev">▸</span>
        </div>
        <div class="ct-main-body" id="ct_main_body" style="display:none">
          ${sec('main',   '⚙',  'Basic',           secMain)}
          ${sec('chars',  '♥',  'Characters',      secChars)}
          ${sec('scan',   '✦',  'Scan',            secScan)}
          ${sec('inject', '◈',  'Injection',       secInject)}
          ${sec('rules',  '◇',  'Language rules',  secRules)}
          ${sec('api',    '🔌', 'API',             secApi)}
        </div>
      </div>
    `);

    // Toggles
    $('#ct_main_hdr').on('click',function(){
      const body=$('#ct_main_body'),chev=$('#ct_main_chev');
      body.slideToggle(180); chev.text(body.is(':visible')?'▾':'▸');
    });
    $('.ct-sec-hdr').on('click',function(){
      const body=$(this).next('.ct-sec-body'),chev=$(this).find('.ct-sec-chev');
      body.slideToggle(150); chev.text(body.is(':visible')?'▾':'▸');
    });

    // Controls
    $('#ct_enabled').on('change', async function(){ getSettings().enabled=this.checked; ctx().saveSettingsDebounced(); await updatePrompt(); });
    $('#ct_phonetic').on('change', async function(){ getSettings().injectPhonetic=this.checked; ctx().saveSettingsDebounced(); await updatePrompt(); });
    $('#ct_autocapture').on('change', function(){ getSettings().autoCapture=this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_semantic').on('change', function(){ getSettings().semantic=this.checked; ctx().saveSettingsDebounced(); });

    let db={};
    const deb=(k,fn,t=350)=>{clearTimeout(db[k]);db[k]=setTimeout(fn,t);};

    $('#ct_lang_name').on('input',function(){ deb('ln',async()=>{ const v=this.value.trim()||'Citadel Tongue'; getSettings().langName=v; ctx().saveSettingsDebounced(); $('#ct_main_title,#ct_tr_title').text(v); await updatePrompt(); }); });
    $('#ct_scan_depth').on('input',function(){ getSettings().scanDepth=+this.value; $('#ct_scan_depth_val').text(this.value); ctx().saveSettingsDebounced(); });
    $('#ct_words_per').on('input',function(){ getSettings().wordsPerScene=+this.value; $('#ct_words_per_val').text(this.value); ctx().saveSettingsDebounced(); });

    // Injection position
    const typeHints={ '0':'Least effective — far from the end of context', '1':'★ Recommended — right before the last message', '2':'Same as Author\'s Note' };
    $('#ct_inject_type').on('change',async function(){
      const t=+this.value; getSettings().injectionType=t; ctx().saveSettingsDebounced();
      $('#ct_depth_row').css({opacity:t===0?.4:1, pointerEvents:t===0?'none':'auto'});
      $('#ct_inject_hint').text(typeHints[t]||'');
      await updatePrompt();
    });
    $('#ct_inject_depth').on('input',async function(){
      getSettings().injectionDepth=+this.value; $('#ct_inject_depth_val').text(this.value); ctx().saveSettingsDebounced(); await updatePrompt();
    });

    // Rules
    let rt;
    $('#ct_rules_area').on('input',function(){ clearTimeout(rt); rt=setTimeout(async()=>{ getSettings().rules=this.value; ctx().saveSettingsDebounced(); await updatePrompt(); },600); });
    $('#ct_rules_reset_btn').on('click',async()=>{ $('#ct_rules_area').val(DEFAULT_RULES); getSettings().rules=DEFAULT_RULES; ctx().saveSettingsDebounced(); await updatePrompt(); });
    $('#ct_gen_rules_btn').on('click',()=>generateRules());

    renderCharTags();
    $('#ct_char_add_btn').on('click',addChar);
    $('#ct_char_add_inp').on('keydown',e=>{if(e.key==='Enter')addChar();});

    $('#ct_open_tracker_btn').on('click',()=>{ $('#ct_tracker').addClass('ct-open'); renderDrawer(); });

    // Preview prompt
    $('#ct_preview_btn').on('click',()=>{
      const p=buildPrompt();
      $('#ct_preview_text').text(p||'[Prompt is empty — language may be inactive for current character]');
      $('#ct_preview_modal').addClass('ct-eopen');
    });

    // API
    $('.ct-api-btn').on('click',function(){
      const mode=this.dataset.mode; $('.ct-api-btn').removeClass('active'); $(this).addClass('active');
      if(mode==='st'){ $('#ct_mode_st').show(); $('#ct_mode_custom').hide(); getSettings().apiEndpoint=''; $('#ct_api_endpoint').val(''); ctx().saveSettingsDebounced(); _workingApi=null; }
      else{ $('#ct_mode_st').hide(); $('#ct_mode_custom').show(); }
    });
    $('#ct_api_endpoint').on('input',function(){ deb('ep',()=>{ getSettings().apiEndpoint=this.value.trim(); ctx().saveSettingsDebounced(); _workingApi=null; }); });
    $('#ct_api_key').on('input',function(){ deb('ak',()=>{ getSettings().apiKey=this.value; ctx().saveSettingsDebounced(); }); });
    $('#ct_api_model').on('input',function(){ deb('am',()=>{ getSettings().apiModel=this.value.trim(); ctx().saveSettingsDebounced(); _workingApi=null; }); });
    $('#ct_fallback_st').on('change',function(){ getSettings().fallbackToSt=this.checked; ctx().saveSettingsDebounced(); });
    $('#ct_api_key_eye').on('click',function(){ const f=$('#ct_api_key'); f.attr('type',f.attr('type')==='password'?'text':'password'); });
    $('#ct_api_test_btn').on('click',async()=>{
      const $st=$('#ct_api_status'); $st.css('color','#7a8499').text('Testing…');
      try{ const r=await aiGenerate('Say only: OK','Reply with exactly one word: OK'); $st.css('color','#34d399').text(`✅ Works: "${r.trim().slice(0,40)}"`); }
      catch(e){ $st.css('color','#f87171').text('✗ '+e.message); }
    });
  }

  function renderCharTags(){
    const s=getSettings(),el=$('#ct_char_tags'); el.empty();
    (s.chars||[]).forEach(c=>{ el.append(`<span class="ct-char-tag">${c}<button class="ct-tag-x" data-c="${c}">✕</button></span>`); });
    el.find('.ct-tag-x').on('click',function(){
      const s=getSettings(); s.chars=s.chars.filter(x=>x!==this.dataset.c);
      ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt();
    });
  }
  function addChar(){
    const v=$('#ct_char_add_inp').val().trim(); if(!v)return;
    const s=getSettings();
    if(!s.chars.includes(v)){ s.chars.push(v); ctx().saveSettingsDebounced(); renderCharTags(); updatePrompt(); }
    $('#ct_char_add_inp').val('');
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  const _cleanedMsgs = new Set();

  function processChatMessage(idx){
    const msg=(ctx().chat||[])[idx];
    if(!msg||msg.is_user)return;
    captureFromMessage(msg.mes||'');
    if(msg.mes&&/\[CT_WORD:/i.test(msg.mes)){
      if(!_cleanedMsgs.has(idx)){ _cleanedMsgs.add(idx); msg.mes=cleanMarkers(msg.mes); }
      const el=document.querySelector(`[mesid="${idx}"] .mes_text`);
      if(el) el.innerHTML=cleanMarkers(el.innerHTML);
    }
  }

  function wireChatEvents(){
    const { eventSource, event_types } = ctx();

    eventSource.on(event_types.APP_READY, async()=>{
      ensureTracker(); mountSettingsUi(); await updatePrompt();
    });

    eventSource.on(event_types.CHAT_CHANGED, async()=>{
      _cleanedMsgs.clear(); await updatePrompt();
      if($('#ct_tracker').hasClass('ct-open')) renderDrawer();
    });

    // KEY FIX: update prompt BEFORE the model generates (same as FMT)
    eventSource.on(event_types.MESSAGE_SENT, async()=>{
      await updatePrompt();
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async(idx)=>{
      processChatMessage(idx);
      await updatePrompt();
    });

    eventSource.on(event_types.MESSAGE_UPDATED, async(idx)=>{
      _cleanedMsgs.delete(idx); processChatMessage(idx); await updatePrompt();
    });

    if (event_types.GENERATION_ENDED){
      eventSource.on(event_types.GENERATION_ENDED, async()=>{
        const chat=ctx().chat||[], last=chat.length-1;
        if(last>=0&&!chat[last].is_user) processChatMessage(last);
        await updatePrompt();
      });
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  jQuery(()=>{
    try{ wireChatEvents(); console.log('[Citadel Tongue v6] ✦ loaded'); }
    catch(e){ console.error('[Citadel Tongue] init failed',e); }
  });

})();
