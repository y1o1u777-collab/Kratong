'use strict';

const { mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

function createWishStore() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_KEY?.trim();
  if (url || key) {
    if (!url || !key) throw new Error('Set both SUPABASE_URL and SUPABASE_KEY');
    return createSupabaseStore(url, key);
  }

  const { DatabaseSync } = require('node:sqlite');
  const path = process.env.KRATHONG_DB || join(__dirname, 'data', 'wishes.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wish TEXT NOT NULL,
      design TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wishes_recent ON wishes(created_at DESC);
  `);
  const list = database.prepare('SELECT * FROM wishes ORDER BY created_at DESC LIMIT 200');
  const insert = database.prepare('INSERT INTO wishes VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const find = database.prepare('SELECT * FROM wishes WHERE id = ?');
  return {
    async list() {
      return list.all();
    },
    async save(record) {
      const { id, name, wish, design } = record;
      const inserted = Boolean(insert.run(id, name, wish, design, new Date().toISOString()).changes);
      return { saved: find.get(id), inserted };
    }
  };
}

function createSupabaseStore(url, key) {
  const table = process.env.SUPABASE_TABLE || 'krathongs';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('Invalid SUPABASE_TABLE');
  const endpoint = new URL('/rest/v1/' + table, url);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid SUPABASE_URL');
  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const columns = 'id,name,wish,design,created_at';

  async function fetchRows(query, options = {}) {
    const target = new URL(endpoint);
    target.search = new URLSearchParams(query);
    const response = await fetch(target, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) throw new Error('Supabase wish request failed (' + response.status + ')');
    return response.json();
  }

  return {
    list() {
      return fetchRows({ select: columns, order: 'created_at.desc', limit: '200' });
    },
    async save(record) {
      const rows = await fetchRows({ on_conflict: 'id', select: columns }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(record)
      });
      if (rows.length) return { saved: rows[0], inserted: true };
      const [saved] = await fetchRows({ select: columns, id: 'eq.' + record.id, limit: '1' });
      if (!saved) throw new Error('Could not confirm wish in Supabase');
      return { saved, inserted: false };
    }
  };
}

module.exports = { createWishStore };
