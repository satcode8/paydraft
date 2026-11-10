const { Pool } = require('pg');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL || 'postgres://app@localhost:5433/paydraft?host=/tmp';
const needsSsl = /render\.com|railway|neon|supabase|amazonaws/.test(connectionString) && !/sslmode=disable/.test(connectionString);
const pool = new Pool({ connectionString, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0] || null;
const all = async (text, params) => (await q(text, params)).rows;

const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

async function migrate() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      mcp_token TEXT UNIQUE NOT NULL,
      business JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_id TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('invoice','quote')),
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_via TEXT NOT NULL DEFAULT 'app',
      source_quote_id INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, number)
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS documents_user_idx ON documents(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS events_doc_idx ON events(document_id, at DESC);
  `);
}

// ---------- users ----------
const users = {
  byEmail: (email) => one('SELECT * FROM users WHERE lower(email)=lower($1)', [email]),
  byId: (id) => one('SELECT * FROM users WHERE id=$1', [id]),
  byMcpToken: (t) => one('SELECT * FROM users WHERE mcp_token=$1', [t]),
  create: (email, name, passwordHash, business = {}) =>
    one('INSERT INTO users(email,name,password_hash,mcp_token,business) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [email.trim(), name.trim(), passwordHash, token(18), business]),
  setBusiness: (id, business) => one('UPDATE users SET business=$2 WHERE id=$1 RETURNING *', [id, business]),
  rotateToken: (id) => one('UPDATE users SET mcp_token=$2 WHERE id=$1 RETURNING *', [id, token(18)]),
};

const sessions = {
  create: async (userId) => { const t = token(32); await q('INSERT INTO sessions(token,user_id) VALUES($1,$2)', [t, userId]); return t; },
  user: (t) => one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1', [t]),
  destroy: (t) => q('DELETE FROM sessions WHERE token=$1', [t]),
};

// ---------- documents ----------
const PREFIX = { invoice: 'INV', quote: 'QUO' };

async function nextNumber(userId, kind) {
  const row = await one(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(number,'\\D','','g'),'')::int),0) AS n FROM documents WHERE user_id=$1 AND kind=$2`,
    [userId, kind]);
  return `${PREFIX[kind]}-${String(row.n + 1).padStart(4, '0')}`;
}

const documents = {
  async create(userId, kind, data, via, extra = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = await nextNumber(userId, kind);
      try {
        const doc = await one(
          `INSERT INTO documents(user_id,public_id,kind,number,status,data,created_via,source_quote_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [userId, token(9), kind, number, extra.status || 'draft', data, via, extra.source_quote_id || null]);
        return doc;
      } catch (e) { if (e.code !== '23505') throw e; }
    }
    throw new Error('Could not allocate a document number');
  },
  list: (userId) => all('SELECT * FROM documents WHERE user_id=$1 ORDER BY updated_at DESC', [userId]),
  get: (userId, id) => one('SELECT * FROM documents WHERE user_id=$1 AND id=$2', [userId, id]),
  byNumber: (userId, number) => one('SELECT * FROM documents WHERE user_id=$1 AND upper(number)=upper($2)', [userId, number]),
  byPublicId: (pid) => one('SELECT d.*, u.business, u.name AS owner_name, u.email AS owner_email FROM documents d JOIN users u ON u.id=d.user_id WHERE d.public_id=$1', [pid]),
  update: (userId, id, data) => one('UPDATE documents SET data=$3, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [userId, id, data]),
  setStatus: (id, status) => one('UPDATE documents SET status=$2, updated_at=now() WHERE id=$1 RETURNING *', [id, status]),
  remove: (userId, id) => q('DELETE FROM documents WHERE user_id=$1 AND id=$2', [userId, id]),
};

const events = {
  add: (documentId, source, action, detail = '') =>
    q('INSERT INTO events(document_id,source,action,detail) VALUES($1,$2,$3,$4)', [documentId, source, action, detail]),
  forDoc: (documentId) => all('SELECT * FROM events WHERE document_id=$1 ORDER BY at DESC, id DESC LIMIT 50', [documentId]),
  recentView: (documentId) => one(`SELECT 1 FROM events WHERE document_id=$1 AND action='viewed' AND at > now() - interval '30 minutes'`, [documentId]),
  recentForUser: (userId) => all(
    `SELECT e.*, d.number, d.kind, d.id AS doc_id FROM events e JOIN documents d ON d.id=e.document_id
     WHERE d.user_id=$1 ORDER BY e.at DESC, e.id DESC LIMIT 15`, [userId]),
};

module.exports = { pool, migrate, users, sessions, documents, events, token };
