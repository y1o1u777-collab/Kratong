(() => {
  'use strict';

  const CONFIG = window.KRATHONG_CONFIG || {};
  const STORAGE_KEY = CONFIG.LOCAL_STORAGE_KEY || 'krathong-wishes-v2';
  const MAX_WISH = Number(CONFIG.MAX_WISH_LENGTH) || 180;
  const MAX_LOCAL_RECORDS = 200;
  const MAX_RENDERED = 16;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    wishes: loadLocal(),
    backend: '',
    cloudWishes: [],
    refreshing: false,
    refreshAgain: false,
    modalTrigger: null,
    syncing: new Map(),
    cloudReady: false,
    currentView: 'home',
    lastCreated: null,
    reduceMotion: motionPreference.matches,
    gallery3dFailed: false
  };

  function loadLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isValidStoredWish).slice(0, MAX_LOCAL_RECORDS) : [];
    } catch (error) {
      console.warn('Krathong: local data could not be read.', error);
      return [];
    }
  }

  function isValidStoredWish(item) {
    return item && typeof item === 'object' && typeof item.wish === 'string' && typeof item.id === 'string';
  }

  function persistLocal() {
    try {
      state.wishes = state.wishes.slice(0, MAX_LOCAL_RECORDS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.wishes));
      return true;
    } catch (error) {
      console.error('Krathong: local save failed.', error);
      toast('พื้นที่จัดเก็บของเบราว์เซอร์เต็มหรือไม่พร้อมใช้งาน กรุณาสำรองข้อมูลก่อนปิดหน้าเว็บ', 'error', 6000);
      return false;
    }
  }

  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function safeText(value, max = 180) {
    return String(value ?? '').trim().slice(0, max);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'เพิ่งสร้าง';
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function toast(message, type = 'info', duration = 3600) {
    const region = $('#toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast${type === 'error' ? ' error' : ''}`;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(7px)';
      window.setTimeout(() => item.remove(), 260);
    }, duration);
  }

  function setConnection(online, label) {
    const pill = $('#connection-status');
    if (!pill) return;
    pill.classList.toggle('is-online', Boolean(online));
    const text = $('span', pill);
    if (text) text.textContent = label || (online ? 'เชื่อมต่อคลาวด์แล้ว' : 'โหมดออฟไลน์');
  }

  function supabaseUrl(query) {
    const base = safeText(CONFIG.SUPABASE_URL, 300);
    if (!base || !CONFIG.SUPABASE_ANON_KEY) return '';
    const url = new URL('/rest/v1/' + encodeURIComponent(CONFIG.SUPABASE_TABLE || 'krathongs'), base);
    url.search = new URLSearchParams(query);
    return url.href;
  }

  function cloudRequest(target, method = 'GET', data) {
    const staticSupabase = target === 'supabase';
    const headers = {};
    let url = 'api/wishes';
    if (staticSupabase) {
      const query = { select: 'id,name,wish,design,created_at' };
      if (method === 'POST') {
        query.on_conflict = 'id';
        headers.Prefer = 'resolution=ignore-duplicates,return=representation';
      } else if (data) {
        query.id = 'eq.' + data.id;
      } else {
        query.order = 'created_at.desc';
        query.limit = String(MAX_LOCAL_RECORDS);
      }
      url = supabaseUrl(query);
      headers.apikey = CONFIG.SUPABASE_ANON_KEY;
      if (headers.apikey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + headers.apikey;
    }
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method, headers, signal: AbortSignal.timeout(9000), cache: 'no-store',
      body: method === 'POST' ? JSON.stringify(data) : undefined
    }).then(response => {
      if (!response.ok) throw new Error('Wish service returned ' + response.status);
      return response.json();
    });
  }

  function visibleWishes() {
    const results = new Map(state.cloudWishes.map(item => [item.id, item]));
    for (const item of state.wishes) if (!results.has(item.id)) results.set(item.id, item);
    return [...results.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function renderWishStatus() {
    $('#share-control').hidden = !state.cloudReady;
    if (!state.cloudReady) $('#wish-share').checked = false;
  }

  async function refreshFromCloud() {
    const target = state.backend;
    if (!target) return;
    if (state.refreshing) {
      state.refreshAgain = true;
      return;
    }
    state.refreshing = true;
    try {
      const data = await cloudRequest(target);
      state.cloudWishes = data.filter(isValidStoredWish);
      state.cloudReady = true;
      if (target === 'supabase') setConnection(true, 'เชื่อมต่อคลาวด์');
      renderWishStatus();
      renderCounts();
      if (state.currentView === 'gallery') renderGallery();
      for (const pending of state.wishes.filter(item => item.pending === true && item.target === target).slice(0, 10)) {
        await saveToCloud(pending);
      }
    } catch (error) {
      console.warn('Krathong: gallery service unavailable.', error);
      state.cloudReady = false;
      renderWishStatus();
      if (target === 'supabase') setConnection(false, 'ใช้ข้อมูลในเครื่อง');
    } finally {
      state.refreshing = false;
      if (state.refreshAgain) {
        state.refreshAgain = false;
        refreshFromCloud();
      }
    }
  }

  function saveToCloud(item) {
    if (state.syncing.has(item.id)) return state.syncing.get(item.id);
    const sync = (async () => {
      try {
        const { id, name, wish, design } = item;
        const result = await cloudRequest(item.target, 'POST', { id, name, wish, design });
        let saved = Array.isArray(result) ? result[0] : result;
        if (!saved && item.target === 'supabase') [saved] = await cloudRequest('supabase', 'GET', { id });
        if (!isValidStoredWish(saved) || saved.id !== id || saved.wish !== wish || saved.name !== name || saved.design !== design) {
          throw new Error('Could not confirm matching wish');
        }
        state.wishes = state.wishes.map(record => record.id === id ? { ...saved, source: 'cloud' } : record);
        persistLocal();
        return true;
      } catch (error) {
        console.warn('Krathong: wish remains queued in this browser.', error);
        return false;
      } finally {
        state.syncing.delete(item.id);
      }
    })();
    state.syncing.set(item.id, sync);
    return sync;
  }

  function switchView(view, updateUrl = true, focus = true) {
    const next = view === 'gallery' || view === 'match' ? view : 'home';
    const gallery = next === 'gallery';
    state.currentView = next;
    $('#home-view').hidden = gallery;
    $('#gallery-view').hidden = !gallery;
    $('#home-view').classList.toggle('is-visible', !gallery);
    $('#gallery-view').classList.toggle('is-visible', gallery);
    $$('.nav-link').forEach(button => {
      const selected = button.dataset.view === next;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    if (updateUrl && location.hash !== '#' + next) history.pushState(null, '', '#' + next);
    if (gallery) {
      renderGallery();
      if (state.backend) refreshFromCloud();
    }
    if (focus) $({ home: '#hero-title', gallery: '#gallery-title', match: '#match-title' }[next]).focus({ preventScroll: true });
    const behavior = state.reduceMotion || motionPreference.matches || !updateUrl ? 'auto' : 'smooth';
    if (next === 'match') $('#match-section').scrollIntoView({ behavior, block: 'start' });
    else window.scrollTo({ top: 0, behavior });
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    state.modalTrigger = document.activeElement;
    modal.hidden = false;
    setModalState(true);
    if (id === 'create-modal') {
      const design = $('input[name="design"]:checked')?.value || 'gold';
      window.Krathong3D?.showPreview?.('create', design);
    } else if (id === 'detail-modal') {
      window.Krathong3D?.showPreview?.('detail', modal.dataset.design || 'gold');
    }
    const focusTarget = $('input:not([type="radio"]), textarea', modal) || $('button', modal);
    // preventScroll keeps mobile browsers from panning the visual viewport.
    focusTarget?.focus({ preventScroll: true });
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    setModalState(false);
    window.Krathong3D?.hidePreview?.();
    state.modalTrigger?.focus({ preventScroll: true });
  }

  function setModalState(open) {
    document.body.classList.toggle('modal-open', open);
    for (const part of ['main', '.topbar', '.footer']) $(part).inert = open;
  }

  function galleryLimit() {
    return window.innerWidth < 620 ? 12 : MAX_RENDERED;
  }

  function renderCounts() {
    const count = Math.min(visibleWishes().length, galleryLimit());
    $('#gallery-count').firstChild.textContent = count + ' ';
  }

  function seededNumber(text, offset = 0) {
    let hash = 2166136261 ^ offset;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0) / 4294967295;
  }

  function createFloatingKrathong(item, index, layout) {
    const boat = document.createElement('button');
    boat.type = 'button';
    boat.className = `floating-krathong${item.design === 'lotus' ? ' design-lotus' : ''}`;
    boat.setAttribute('aria-label', `เปิดคำอธิษฐานของ ${item.name || 'ผู้ร่วมลอยกระทง'}`);
    const { columns, rows } = layout;
    const column = index % columns;
    const row = Math.floor(index / columns);
    let x;
    if (columns === 1) x = 50;
    else if (columns === 2) x = 34 + column * 32;
    else x = 18 + column * (64 / (columns - 1));
    x += (seededNumber(item.id, 1) - .5) * 2.5;
    const y = (rows === 1 ? 62 : 48 + row * (30 / (rows - 1))) + (seededNumber(item.id, 2) - .5) * 2;
    const delay = -seededNumber(item.id, 3) * 9;
    const duration = 7 + seededNumber(item.id, 4) * 5;
    boat.style.left = `${x}%`;
    boat.style.top = `${y}%`;
    boat.style.animationDelay = `${delay}s`;
    boat.style.setProperty('--float-duration', `${duration}s`);
    const hull = document.createElement('span'); hull.className = 'mini-boat';
    boat.append(hull);
    for (let i = 0; i < 6; i++) { const petal = document.createElement('span'); petal.className = 'mini-petal'; boat.append(petal); }
    const candle = document.createElement('span'); candle.className = 'mini-candle'; boat.append(candle);
    boat.addEventListener('click', () => openWish(item));
    return boat;
  }

  function renderGallery() {
    const collection = $('#floating-collection');
    const empty = $('#gallery-empty');
    if (!collection || !empty) return;
    const visible = visibleWishes().slice(0, galleryLimit());
    empty.classList.toggle('is-hidden', visible.length > 0);
    renderCounts();

    if (window.Krathong3D?.available && !state.gallery3dFailed) {
      document.dispatchEvent(new CustomEvent('krathong:gallery', {
        detail: { wishes: visible.map(item => ({ id: item.id, name: item.name, design: item.design })) }
      }));
      return;
    }

    // CSS fallback when WebGL is unavailable.
    const focused = collection.contains(document.activeElement) ? document.activeElement.dataset.wishId : '';
    collection.replaceChildren();
    const columns = visible.length <= 2 ? Math.max(1, visible.length) : (window.innerWidth < 620 ? 3 : 6);
    const rows = Math.max(1, Math.ceil(visible.length / columns));
    visible.forEach((item, index) => {
      const boat = createFloatingKrathong(item, index, { columns, rows });
      boat.dataset.wishId = item.id;
      collection.append(boat);
      if (focused === item.id) boat.focus({ preventScroll: true });
    });
  }

  function openWish(item) {
    $('#detail-title').textContent = item.name ? `คำอธิษฐานของ ${item.name}` : 'คำอธิษฐาน';
    $('#detail-wish').textContent = item.wish;
    $('#detail-author').textContent = item.name || 'ผู้ร่วมลอยกระทง';
    $('#detail-date').textContent = formatDate(item.created_at);
    $('#detail-modal').dataset.design = item.design === 'lotus' ? 'lotus' : 'gold';
    $('#detail-visual').classList.toggle('is-pink', item.design === 'lotus');
    openModal('detail-modal');
  }

  function updateWishCounter() {
    const input = $('#wish-text');
    $('#wish-counter').textContent = `${input.value.length}/${MAX_WISH}`;
  }

  function showLaunch(design = 'gold', wish = '', name = '') {
    const overlay = $('#launch-overlay');
    const raft = $('#launch-raft');
    const finish = $('#launch-finish');
    const canUse3D = Boolean(window.Krathong3D?.available);
    overlay.hidden = false;
    overlay.classList.toggle('is-3d', canUse3D);
    setModalState(true);
    finish.focus({ preventScroll: true });
    if (canUse3D) {
      // The WebGL scene lowers the candles, lights them and releases the krathong.
      raft.hidden = true;
      document.dispatchEvent(new CustomEvent('krathong:launch', { detail: { design, wish, name } }));
      return;
    }
    // CSS fallback for browsers without WebGL or when opened as a plain file.
    raft.hidden = state.reduceMotion || motionPreference.matches;
    raft.classList.remove('is-leaving');
    void raft.offsetWidth;
    raft.classList.add('is-leaving');
  }

  async function handleCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const wishText = safeText($('#wish-text').value, MAX_WISH);
    if (!wishText) { $('#wish-text').focus(); toast('เขียนคำอธิษฐานก่อนปล่อยกระทงนะ'); return; }
    if (wishText.length > MAX_WISH) { toast(`คำอธิษฐานยาวได้ไม่เกิน ${MAX_WISH} ตัวอักษร`, 'error'); return; }

    const button = $('#launch-button');
    button.disabled = true;
    button.querySelector('span').textContent = 'กำลังจุดแสง...';
    const target = state.cloudReady && $('#wish-share').checked ? state.backend : '';
    const localWish = {
      id: makeId(), name: safeText($('#wish-name').value, 30) || 'ไม่ระบุชื่อ',
      wish: wishText, design: $('input[name="design"]:checked').value === 'lotus' ? 'lotus' : 'gold',
      created_at: new Date().toISOString(), pending: Boolean(target), target, source: 'local'
    };
    state.wishes.unshift(localWish);
    persistLocal();
    state.lastCreated = localWish;
    closeModal('create-modal');
    showLaunch(localWish.design, localWish.wish, localWish.name);
    renderCounts();

    form.reset();
    updateWishCounter();
    $$('.design-option').forEach(option => option.classList.toggle('is-selected', $('input', option).checked));
    if (target && !await saveToCloud(localWish)) {
      toast('เก็บกระทงไว้ในเครื่องแล้ว ระบบจะลองเผยแพร่อีกครั้งเมื่อเชื่อมต่อได้', 'error', 5000);
    }
    if (target === 'supabase') refreshFromCloud();
    button.disabled = false;
    button.querySelector('span').textContent = 'จุดแสงและปล่อยกระทง';
  }

  function finishLaunch() {
    const overlay = $('#launch-overlay');
    overlay.hidden = true;
    overlay.classList.remove('is-3d', 'is-done');
    setModalState(false);
    document.dispatchEvent(new CustomEvent('krathong:launchend'));
    switchView('gallery');
    if (state.lastCreated) toast('กระทงของคุณกำลังลอยไปกับสายน้ำ ✦', 'info', 4200);
  }

  function bindEvents() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('a[href="#home"]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      switchView('home');
    }));
    window.addEventListener('popstate', () => switchView(location.hash.slice(1), false));
    window.addEventListener('online', refreshFromCloud);
    document.addEventListener('krathong:river', refreshFromCloud);
    document.addEventListener('krathong:galleryfailed', () => {
      state.gallery3dFailed = true;
      renderGallery();
    });
    document.addEventListener('krathong:selectwish', event => {
      const item = visibleWishes().find(wish => wish.id === event.detail?.id);
      if (item) openWish(item);
    });
    document.addEventListener('krathong:launchfailed', () => {
      const overlay = $('#launch-overlay');
      const raft = $('#launch-raft');
      if (!overlay || !raft) return;
      overlay.classList.remove('is-3d');
      raft.hidden = state.reduceMotion || motionPreference.matches;
      raft.classList.remove('is-leaving');
      void raft.offsetWidth;
      raft.classList.add('is-leaving');
    });
    document.addEventListener('krathong:connection', ({ detail }) => {
      if (detail.connected) {
        state.backend = 'node';
        setConnection(true, 'ออนไลน์');
        refreshFromCloud();
      } else if (detail.offline && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
        state.backend = 'supabase';
        refreshFromCloud();
      } else {
        state.cloudReady = false;
        renderWishStatus();
        setConnection(false, detail.offline ? 'โหมดออฟไลน์' : 'กำลังเชื่อมต่อ');
      }
    });
    $('#start-create').addEventListener('click', () => openModal('create-modal'));
    $('#gallery-create').addEventListener('click', () => openModal('create-modal'));
    $('#empty-create').addEventListener('click', () => openModal('create-modal'));
    $('#krathong-form').addEventListener('submit', handleCreate);
    $('#launch-finish').addEventListener('click', finishLaunch);
    $('#wish-text').addEventListener('input', updateWishCounter);

    $$('input[name="design"]').forEach(input => input.addEventListener('change', () => {
      $$('.design-option').forEach(option => option.classList.toggle('is-selected', $('input', option).checked));
      const design = $('input[name="design"]:checked')?.value;
      if (design) window.Krathong3D?.setPreviewDesign?.(design);
    }));
    $$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModal(backdrop.id);
    }));
    document.addEventListener('keydown', event => {
      const active = $('.modal-backdrop:not([hidden]), .launch-overlay:not([hidden])');
      if (!active) return;
      if (event.key === 'Escape') {
        if (active.id === 'launch-overlay') finishLaunch();
        else closeModal(active.id);
      }
      if (event.key !== 'Tab') return;
      const targets = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled])', active)
        .filter(item => !item.closest('[hidden]') && (item.type !== 'radio' || item.checked));
      if (!targets.length) return;
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    $('#motion-toggle').addEventListener('click', () => {
      state.reduceMotion = !state.reduceMotion;
      applyMotion();
      toast(state.reduceMotion ? 'ลดการเคลื่อนไหวแล้ว' : 'เปิดเอฟเฟกต์เคลื่อนไหวแล้ว');
    });
    motionPreference.addEventListener('change', event => {
      state.reduceMotion = event.matches;
      applyMotion();
    });
  }

  function applyMotion() {
    document.body.classList.toggle('reduce-motion', state.reduceMotion);
    $('#motion-toggle').classList.toggle('is-on', state.reduceMotion);
    // An operating-system preference also applies via CSS.
    $('#motion-toggle').setAttribute('aria-pressed', String(state.reduceMotion || motionPreference.matches));
    document.dispatchEvent(new Event('krathong:motion'));
  }

  function init() {
    applyMotion();
    updateWishCounter();
    renderCounts();
    bindEvents();
    switchView(location.hash.slice(1), false, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
