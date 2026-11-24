'use strict';

const http = require('node:http');
const { randomBytes, randomUUID, randomInt } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createWishStore } = require('./wishes');

const port = Number(process.env.PORT || 3000);
const wishStore = createWishStore();

const contentTypes = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ttf: 'font/ttf'
};
const files = new Map();
for (const file of [
  'index.html', 'styles.css', 'config.js', 'app.js', 'match.js', 'motion.js', 'krathong3d.js',
  'vendor/gsap.min.js', 'vendor/ScrollTrigger.min.js', 'vendor/three.module.js',
  'favicon.svg', 'thai-sans.ttf', 'thai-sans-bold.ttf', 'thai-serif.ttf'
]) {
  files.set('/' + file, { body: readFileSync(join(__dirname, 'public', file)), type: contentTypes[file.split('.').pop()] });
}
files.set('/', files.get('/index.html'));

const sessions = new Map();
const queue = new Set();
const disconnectGrace = 12000;
const genders = new Set(['private', 'woman', 'man', 'nonbinary', 'other']);
const interests = new Set(['music', 'games', 'art', 'sports', 'movies', 'tech', 'food', 'travel']);
const limits = new Map();

function allowed(request, action, maximum, interval) {
  // TRUST_PROXY=1 is intended for a single trusted reverse proxy that appends its client IP.
  const forwarded = process.env.TRUST_PROXY === '1' ? request.headers['x-forwarded-for'] : '';
  const ip = String(forwarded || '').split(',').at(-1).trim() || request.socket.remoteAddress;
  const key = action + ':' + ip;
  const now = Date.now();
  const limit = limits.get(key);
  if (!limit || limit.until <= now) {
    limits.set(key, { count: 1, until: now + interval });
    return true;
  }
  return ++limit.count <= maximum;
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readBody(request, maxBytes = 4096) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw requestError(415, 'Expected application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw requestError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Return the same error for invalid JSON and unsupported JSON values.
  }
  throw requestError(400, 'Invalid JSON object');
}

function snapshot(session) {
  const match = session.match;
  const partner = match?.members.find(member => member !== session);
  return {
    status: session.status,
    matchId: match?.id || null,
    partner: partner?.profile || null,
    shared: partner ? session.profile.interests.filter(item => partner.profile.interests.includes(item)) : [],
    ready: Boolean(match?.ready.has(session)),
    partnerReady: Boolean(partner && match.ready.has(partner)),
    released: match?.ready.size === 2,
    messages: match ? match.messages.map(({ author, ...message }) => ({ ...message, own: author === session })) : []
  };
}

function send(session, message) {
  const stream = session.stream;
  if (!stream || stream.destroyed) return;
  if (stream.writableLength > 96_000) {
    stream.destroy();
    return;
  }
  stream.write('data: ' + JSON.stringify(message) + '\n\n');
}

function notify(session) {
  send(session, { type: 'match', ...snapshot(session) });
}

function leave(session) {
  queue.delete(session);
  const match = session.match;
  session.match = null;
  session.status = 'idle';
  session.profile = null;
  if (!match) return;
  const partner = match.members.find(member => member !== session);
  partner.match = null;
  partner.profile = null;
  partner.status = match.ready.size === 2 ? 'complete' : 'ended';
  notify(partner);
}

function pairWaitingUsers() {
  const available = [...queue].filter(session => session.stream && !session.stream.destroyed);
  while (available.length >= 2) {
    // Start with the longest-waiting user to keep the queue moving.
    const first = available.shift();
    let bestScore = -1;
    let candidates = [];
    for (const [index, candidate] of available.entries()) {
      const score = first.profile.interests.filter(item => candidate.profile.interests.includes(item)).length;
      if (score > bestScore) {
        bestScore = score;
        candidates = [];
      }
      if (score === bestScore) candidates.push(index);
    }
    if (bestScore === 0 && Date.now() - first.joinedAt < 8000) continue;
    const [second] = available.splice(candidates[randomInt(candidates.length)], 1);
    const match = { id: randomUUID(), members: [first, second], ready: new Set(), messages: [] };
    for (const member of match.members) {
      queue.delete(member);
      member.status = 'matched';
      member.match = match;
      notify(member);
    }
  }
}

function parseProfile(profile) {
  const nickname = typeof profile?.nickname === 'string' ? profile.nickname.trim() : '';
  if (!nickname || nickname.length > 24 || !genders.has(profile.gender) ||
      !Array.isArray(profile.interests) || !profile.interests.length || profile.interests.length > interests.size ||
      !profile.interests.every(item => interests.has(item))) {
    throw requestError(400, 'Invalid profile');
  }
  const instagram = typeof profile.instagram === 'string' ? profile.instagram.trim().replace(/^@/, '') : '';
  const photo = typeof profile.photo === 'string' ? profile.photo : '';
  if ((instagram && !/^[a-zA-Z0-9._]{1,30}$/.test(instagram)) ||
      (photo && (photo.length > 36000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(photo)))) {
    throw requestError(400, 'Invalid optional profile fields');
  }
  return { nickname, gender: profile.gender, interests: [...new Set(profile.interests)], instagram, photo };
}

function connectEvents(session, response) {
  const oldStream = session.stream;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders();
  session.stream = response;
  session.expires = Infinity;
  oldStream?.end();
  response.on('close', () => {
    if (session.stream !== response) return;
    session.stream = null;
    session.expires = Date.now() + disconnectGrace;
  });
  notify(session);
  send(session, { type: 'river' });
}

function changeMatch(session, command) {
  switch (command.action) {
    case 'join': {
      if (session.match && session.match.ready.size < 2) throw requestError(409, 'Leave your current match first');
      const profile = parseProfile(command.profile);
      if (session.match) leave(session);
      session.profile = profile;
      if (session.status !== 'waiting') session.joinedAt = Date.now();
      session.status = 'waiting';
      queue.add(session);
      break;
    }
    case 'leave':
      leave(session);
      break;
    case 'release':
      if (!session.match || session.match.id !== command.matchId) throw requestError(409, 'No active match');
      session.match.ready.add(session);
      session.match.members.forEach(notify);
      return;
    case 'chat': {
      const match = session.match;
      if (!match || match.id !== command.matchId) throw requestError(409, 'No active match');
      const text = typeof command.text === 'string' ? command.text.trim() : '';
      if (!text || text.length > 300) throw requestError(400, 'Invalid message');
      const now = Date.now();
      if (now - (session.lastChat || 0) < 500) throw requestError(429, 'Slow down');
      session.lastChat = now;
      const message = { id: randomUUID(), text, author: session };
      match.messages.push(message);
      if (match.messages.length > 60) match.messages.shift();
      for (const member of match.members) {
        send(member, { type: 'chat', matchId: match.id, message: { id: message.id, text, own: member === session } });
      }
      return;
    }
    default:
      throw requestError(400, 'Unknown match action');
  }
  notify(session);
}

async function handle(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const method = request.method;

  if (method === 'GET' || method === 'HEAD') {
    const file = files.get(path);
    if (file) {
      response.writeHead(200, {
        'Content-Type': file.type,
        'Content-Length': file.body.length,
        'Cache-Control': path.startsWith('/vendor/')
          ? 'public, max-age=86400'
          : 'no-cache'
      });
      return response.end(method === 'HEAD' ? undefined : file.body);
    }
  }

  if (method === 'GET' && path === '/api/wishes') {
    return json(response, 200, await wishStore.list());
  }

  if (method === 'POST' && path === '/api/wishes') {
    if (!allowed(request, 'wish', 120, 60_000)) throw requestError(429, 'Try again later');
    const { id, name, wish, design } = await readBody(request);
    const alias = typeof name === 'string' ? name.trim() : '';
    const message = typeof wish === 'string' ? wish.trim() : '';
    if (typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
        alias.length > 30 || !message || message.length > 180 || !['gold', 'lotus'].includes(design)) {
      throw requestError(400, 'Invalid wish');
    }
    const displayName = alias || 'ไม่ระบุชื่อ';
    const { saved, inserted } = await wishStore.save({ id, name: displayName, wish: message, design });
    if (saved.name !== displayName || saved.wish !== message || saved.design !== design) {
      throw requestError(409, 'Wish ID already used');
    }
    if (inserted) for (const session of sessions.values()) send(session, { type: 'river' });
    return json(response, inserted ? 201 : 200, saved);
  }

  if (method === 'POST' && path === '/api/session') {
    if (!allowed(request, 'session', 240, 60_000) || sessions.size >= 2000) {
      throw requestError(429, 'Try again later');
    }
    const token = randomBytes(24).toString('base64url');
    sessions.set(token, { status: 'idle', match: null, stream: null, expires: Date.now() + disconnectGrace });
    return json(response, 201, { token });
  }

  if ((method === 'POST' && path === '/api/match') || (method === 'GET' && path === '/api/events')) {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1];
    const session = sessions.get(token);
    if (!session || session.expires <= Date.now()) throw requestError(401, 'Session expired');
    if (path === '/api/events') return connectEvents(session, response);
    if (!session.stream || session.stream.destroyed) throw requestError(409, 'Reconnect first');
    const command = await readBody(request, 48_000);
    if (!session.stream || session.stream.destroyed) throw requestError(409, 'Reconnect first');
    const { action } = command;
    const now = Date.now();
    if (action === 'join' && now - (session.lastJoin || 0) < 220) throw requestError(429, 'Try again later');
    changeMatch(session, command);
    if (action === 'join') session.lastJoin = now;
    return json(response, 200, { ok: true });
  }

  json(response, 404, { error: 'Not found' });
}

const server = http.createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  handle(request, response).catch(error => {
    if (!error.status) console.error(error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'Server error' });
    else response.end();
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

setInterval(pairWaitingUsers, 1400).unref();
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires > now) continue;
    leave(session);
    sessions.delete(token);
  }
  for (const [key, limit] of limits) if (limit.until <= now) limits.delete(key);
}, 1000).unref();
setInterval(() => {
  for (const session of sessions.values()) send(session, { type: 'ping' });
}, 10000).unref();

server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log('Krathong Live · http://localhost:' + server.address().port);
});
