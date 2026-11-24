(() => {
  const $ = selector => document.querySelector(selector);
  const card = $('#match-card');
  const indicator = $('#match-indicator');
  const heading = $('#match-state');
  const description = $('#match-description');
  const profileForm = $('#match-profile');
  const action = $('#match-action');
  const leave = $('#match-leave');
  const error = $('#match-error');
  const photoInput = $('#match-photo');
  const photoPreview = $('#photo-preview');
  const photoRemove = $('#photo-remove');
  const chat = $('#match-chat');
  const chatLog = $('#chat-log');
  const chatForm = $('#chat-form');
  const messageInput = $('#chat-message');
  const chatButton = chatForm.querySelector('button');
  const genderNames = { woman: 'หญิง', man: 'ชาย', nonbinary: 'นอนไบนารี', other: 'อื่น ๆ' };
  const interestNames = {
    music: 'เพลง', games: 'เกม', art: 'ศิลปะ', sports: 'กีฬา',
    movies: 'หนังและซีรีส์', tech: 'เทคโนโลยี', food: 'อาหาร', travel: 'ท่องเที่ยว'
  };
  const messages = {
    connecting: ['กำลังเชื่อมต่อ', 'กำลังเชื่อมต่อระบบจับคู่', 'เมื่อพร้อมแล้ว คุณจะเริ่มหาเพื่อนได้ที่นี่'],
    offline: ['โหมดเปิดไฟล์', 'ระบบจับคู่ต้องเปิดผ่านเซิร์ฟเวอร์', 'เปิดเว็บด้วย npm start หรือใช้ลิงก์เว็บที่โฮสต์เซิร์ฟเวอร์ไว้'],
    reconnecting: ['การเชื่อมต่อขาดช่วง', 'กำลังเชื่อมต่ออีกครั้ง', 'หากกลับมาได้ทัน คุณจะกลับไปยังคิวหรือคู่เดิม'],
    idle: ['ออนไลน์', 'หาเพื่อนลอยกระทง', 'ระบบจะมองหาคนที่ชอบอะไรตรงกันก่อน', 'เริ่มหาเพื่อน'],
    waiting: ['กำลังค้นหา', 'กระทงกำลังตามหาเพื่อน', 'ระบบหาคนที่ชอบคล้ายกันก่อน หากรอสักพักจะสุ่มจากคนที่อยู่ในคิว'],
    matched: ['จับคู่สำเร็จ', 'กระทงเจอเพื่อนแล้ว!', 'คุยกันได้เลย เมื่อพร้อมแล้วค่อยปล่อยกระทงคู่', 'พร้อมลอยกระทง'],
    partnerReady: ['จับคู่สำเร็จ', 'เพื่อนพร้อมแล้ว!', 'แตะปุ่มพร้อม แล้วกระทงทั้งสองใบจะลอยออกไปด้วยกัน', 'พร้อมลอยกระทง'],
    ready: ['จับคู่สำเร็จ', 'รอเพื่อนแตะพร้อม', 'เมื่อทั้งคู่กดพร้อม กระทงจะลอยพร้อมกัน'],
    released: ['ลอยกระทงสำเร็จ', 'กระทงสองใบออกเดินทางแล้ว', 'ขอให้คืนนี้เป็นคืนที่ดีของทั้งคู่', 'หาเพื่อนอีกครั้ง'],
    ended: ['ออนไลน์', 'เพื่อนออกจากการจับคู่แล้ว', 'คุณสามารถแก้โปรไฟล์แล้วกลับไปหาเพื่อนใหม่ได้', 'หาเพื่อนอีกครั้ง']
  };
  let token = '';
  let connected = false;
  let initial = true;
  let busy = false;
  let sending = false;
  let photo = '';
  let photoPending = false;
  let photoVersion = 0;
  let current = { status: 'idle', messages: [] };
  let connectionState = 'connecting';

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function fail(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function render() {
    let next = connectionState;
    if (connected) {
      next = current.status;
      if (current.status === 'complete' || current.released) next = 'released';
      else if (current.ready) next = 'ready';
      else if (current.partnerReady) next = 'partnerReady';
    }
    const [badge, title, copy, label] = messages[next];
    card.dataset.status = next;
    setText(indicator, badge);
    setText(heading, title);
    setText(description, copy);
    const showProfile = connected && ['idle', 'ended', 'complete'].includes(current.status);
    const showLeave = connected && ['waiting', 'matched'].includes(current.status);
    profileForm.hidden = !showProfile;
    action.hidden = !label || (current.released && Boolean(current.matchId) && !showProfile);
    action.disabled = busy || photoPending;
    if (label) setText(action, label);
    leave.hidden = !showLeave;
    leave.disabled = busy;
    setText(leave, current.status === 'waiting' ? 'ยกเลิกการค้นหา' : 'จบแชทและกลับไปค้นหา');
    chat.hidden = !current.matchId;
    messageInput.disabled = !connected;
    chatButton.disabled = !connected || sending;
    if (!current.partner) return;
    const { nickname, gender, instagram, photo: partnerPhoto } = current.partner;
    setText($('#chat-title'), [nickname, genderNames[gender]].filter(Boolean).join(' · '));
    const shared = current.shared.map(key => interestNames[key]);
    const partnerInterests = current.partner.interests.map(key => interestNames[key]);
    setText($('#chat-interests'), shared.length ? 'ชอบเหมือนกัน · ' + shared.join(' · ') : 'ความชอบ · ' + partnerInterests.join(' · '));
    const avatar = $('#chat-avatar');
    avatar.hidden = !partnerPhoto;
    if (partnerPhoto && avatar.getAttribute('src') !== partnerPhoto) avatar.src = partnerPhoto;
    if (!partnerPhoto) avatar.removeAttribute('src');
    const ig = $('#chat-ig');
    ig.hidden = !instagram;
    if (instagram) {
      ig.href = 'https://www.instagram.com/' + encodeURIComponent(instagram) + '/';
      setText(ig, '@' + instagram);
    } else {
      ig.removeAttribute('href');
      ig.textContent = '';
    }
  }

  function showMessage(message) {
    chatLog.querySelector('.chat-empty')?.remove();
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 64;
    const bubble = document.createElement('p');
    bubble.className = message.own ? 'chat-bubble is-own' : 'chat-bubble';
    bubble.setAttribute('aria-label', message.own ? 'คุณ: ' + message.text : 'เพื่อน: ' + message.text);
    bubble.textContent = message.text;
    chatLog.append(bubble);
    if (chatLog.children.length > 60) chatLog.firstElementChild.remove();
    if (message.own || atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderLog() {
    chatLog.replaceChildren();
    if (current.messages.length) {
      current.messages.forEach(showMessage);
      chatLog.scrollTop = chatLog.scrollHeight;
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = 'ส่งข้อความทักทายกันได้เลย ✦';
    chatLog.append(empty);
  }

  function receive(message) {
    if (message.type === 'river') document.dispatchEvent(new Event('krathong:river'));
    if (message.type === 'chat' && message.matchId === current.matchId) {
      current.messages.push(message.message);
      if (current.messages.length > 60) current.messages.shift();
      showMessage(message.message);
    }
    if (message.type !== 'match') return;
    const changedMatch = current.matchId !== message.matchId;
    const focusWasInActions = [action, leave].includes(document.activeElement);
    const changedLog = changedMatch || current.messages.at(-1)?.id !== message.messages.at(-1)?.id;
    current = message;
    if (changedMatch) {
      messageInput.value = '';
      if (!message.matchId) {
        $('#chat-avatar').removeAttribute('src');
        $('#chat-ig').removeAttribute('href');
        $('#chat-title').textContent = '';
        $('#chat-interests').textContent = '';
        $('#chat-ig').textContent = '';
      }
    }
    render();
    if (changedLog) renderLog();
    if (focusWasInActions && (action.hidden || leave.hidden)) {
      if (!action.hidden && !action.disabled) action.focus({ preventScroll: true });
      else if (!leave.hidden && !leave.disabled) leave.focus({ preventScroll: true });
    }
  }

  async function readEvents(response, onChunk) {
    let pending = '';
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      onChunk();
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (frame.startsWith('data: ')) receive(JSON.parse(frame.slice(6)));
      }
    }
  }

  function connectionLabel() {
    document.dispatchEvent(new CustomEvent('krathong:connection', { detail: { connected, offline: connectionState === 'offline' } }));
  }

  function useOfflineMode() {
    connectionState = 'offline';
    render();
    connectionLabel();
  }

  async function connect() {
    if (location.protocol === 'file:') {
      useOfflineMode();
      return;
    }
    let attempt = 0;
    while (true) {
      let watchdog;
      const stream = new AbortController();
      try {
        if (!token) {
          const response = await fetch('api/session', { method: 'POST', signal: AbortSignal.timeout(8000) });
          const type = response.headers.get('content-type') || '';
          if (initial && ([404, 405, 501].includes(response.status) || !type.includes('application/json'))) {
            useOfflineMode();
            return;
          }
          if (!response.ok) throw new Error('Session unavailable');
          ({ token } = await response.json());
        }
        watchdog = setTimeout(() => stream.abort(), 8000);
        const response = await fetch('api/events', { headers: { Authorization: 'Bearer ' + token }, signal: stream.signal });
        if (response.status === 401) token = '';
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Stream unavailable');
        initial = false;
        connected = true;
        attempt = 0;
        error.hidden = true;
        connectionLabel();
        const keepAlive = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => stream.abort(), 28000);
        };
        keepAlive();
        await readEvents(response, keepAlive);
      } catch {
        // Retain the token to recover the queue and partner on a brief disconnect.
      } finally {
        clearTimeout(watchdog);
        stream.abort();
      }
      connected = false;
      connectionState = 'reconnecting';
      render();
      connectionLabel();
      await new Promise(resolve => setTimeout(resolve, Math.min(12000, 1000 * 2 ** attempt++)));
    }
  }

  async function update(command) {
    if (!connected) throw new Error('Disconnected');
    const response = await fetch('api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Action unavailable');
  }

  async function changeMatch(command) {
    if (busy) return;
    busy = true;
    error.hidden = true;
    render();
    try {
      await update(command);
    } catch {
      fail('ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      busy = false;
      render();
    }
  }

  function showPhoto(image) {
    photo = image;
    photoPreview.hidden = !photo;
    if (photo) photoPreview.src = photo;
    else photoPreview.removeAttribute('src');
    photoRemove.hidden = !photo;
    setText($('#photo-label'), photo ? 'เปลี่ยนรูป' : '＋ เลือกรูป');
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    const version = ++photoVersion;
    photoPending = true;
    error.hidden = true;
    render();
    try {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Unsupported image');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const size = Math.min(bitmap.width, bitmap.height);
      canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#f3c6d9';
      context.fillRect(0, 0, 128, 128);
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128);
      bitmap.close();
      const image = canvas.toDataURL('image/jpeg', .78);
      if (image.length > 36000) throw new Error('Image too large');
      if (version === photoVersion) showPhoto(image);
    } catch {
      if (version === photoVersion) fail('เลือกรูป JPG, PNG, WebP หรือ AVIF ขนาดไม่เกิน 8 MB');
    } finally {
      if (version === photoVersion) {
        photoPending = false;
        photoInput.value = '';
        render();
      }
    }
  });
  photoRemove.addEventListener('click', () => {
    photoVersion++;
    photoPending = false;
    showPhoto('');
    render();
  });

  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || photoPending) return;
    const form = new FormData(profileForm);
    const nickname = form.get('nickname').trim();
    const instagram = form.get('instagram').trim().replace(/^@/, '');
    const interests = form.getAll('interests');
    if (!nickname) return fail('ใส่ชื่อเล่นก่อนเริ่มค้นหา');
    if (!interests.length) return fail('เลือกความชอบอย่างน้อย 1 ข้อ');
    if (instagram && !/^[a-zA-Z0-9._]{1,30}$/.test(instagram)) return fail('กรอกเฉพาะชื่อผู้ใช้ Instagram เช่น @krathong');
    changeMatch({ action: 'join', profile: { nickname, gender: form.get('gender'), interests, instagram, photo } });
  });
  action.addEventListener('click', event => {
    if (!profileForm.hidden) return;
    event.preventDefault();
    if (current.matchId) changeMatch({ action: 'release', matchId: current.matchId });
  });
  leave.addEventListener('click', () => changeMatch({ action: 'leave' }));
  chatForm.addEventListener('submit', async event => {
    event.preventDefault();
    const text = messageInput.value.trim();
    const matchId = current.matchId;
    if (!text || !matchId || sending) return;
    sending = true;
    error.hidden = true;
    render();
    try {
      await update({ action: 'chat', matchId, text });
      if (current.matchId === matchId && messageInput.value.trim() === text) messageInput.value = '';
    } catch {
      fail('ส่งข้อความไม่สำเร็จ กรุณารอสักครู่แล้วลองส่งอีกครั้ง');
    } finally {
      sending = false;
      render();
    }
  });
  document.addEventListener('DOMContentLoaded', connect, { once: true });
})();
