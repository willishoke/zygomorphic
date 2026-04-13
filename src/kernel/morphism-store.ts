/**
 * morphism-store.ts — Persistence layer for morphism definitions.
 *
 * Markdown-as-truth + derived SQLite index, following the store.ts pattern.
 * Morphism files live in .zygomorphic/plan/{id}.md with frontmatter:
 *   id, domain, codomain, autonomy, status, factored_from, validator
 *
 * The dependency graph is derived: SQLite, rebuilt from morphism files.
 * Execution state is in-memory and ephemeral.
 * Factoring history is git log of morphism files.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { ArtifactType, Autonomy, ValidatorSpec } from './types.js';

// --- Morphism data ---

export type MorphismStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface MorphismData {
  id: string;
  domain: string;
  codomain: string;
  autonomy: Autonomy;
  status: MorphismStatus;
  factored_from: string | null;
  validator: ValidatorSpec;
  description: string;
  decision_log: string;
  created_at: string;
  updated_at: string;
}

// --- Frontmatter parsing ---

interface Frontmatter {
  [key: string]: string;
}

function parseMd(raw: string): { fm: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw.trim() };
  const fm: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fm, body: match[2].trim() };
}

function stringifyMd(fm: Frontmatter, body: string): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

// --- Body parsing ---

function parseBody(body: string): { description: string; decision_log: string } {
  const logIdx = body.indexOf('## Decision log');
  if (logIdx === -1) {
    return { description: body.trim(), decision_log: '' };
  }
  return {
    description: body.slice(0, logIdx).trim(),
    decision_log: body.slice(logIdx + '## Decision log'.length).trim(),
  };
}

function stringifyBody(description: string, decision_log: string): string {
  let body = description;
  if (decision_log) {
    body += '\n\n## Decision log\n' + decision_log;
  }
  return body;
}

// --- Store ---

const PLAN_DIR = 'plan';

export class MorphismStore {
  private db: Database.Database;

  constructor(readonly storeRoot: string) {
    this.planDir = path.join(storeRoot, PLAN_DIR);
    fs.mkdirSync(this.planDir, { recursive: true });
    this.db = new Database(path.join(storeRoot, '.morphisms.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private planDir: string;

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS morphisms (
        id              TEXT PRIMARY KEY,
        domain          TEXT NOT NULL,
        codomain        TEXT NOT NULL,
        autonomy        TEXT NOT NULL DEFAULT 'auto',
        status          TEXT NOT NULL DEFAULT 'pending',
        factored_from   TEXT,
        validator       TEXT NOT NULL,
        description     TEXT,
        decision_log    TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_morphisms_status ON morphisms(status);
      CREATE INDEX IF NOT EXISTS idx_morphisms_factored_from ON morphisms(factored_from);

      CREATE VIRTUAL TABLE IF NOT EXISTS morphisms_fts USING fts5(
        id, domain, codomain, description, decision_log,
        content='morphisms',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS morphisms_fts_insert
        AFTER INSERT ON morphisms BEGIN
          INSERT INTO morphisms_fts(rowid, id, domain, codomain, description, decision_log)
          VALUES (new.rowid, new.id, new.domain, new.codomain, new.description, new.decision_log);
        END;

      CREATE TRIGGER IF NOT EXISTS morphisms_fts_delete
        AFTER DELETE ON morphisms BEGIN
          INSERT INTO morphisms_fts(morphisms_fts, rowid, id, domain, codomain, description, decision_log)
          VALUES ('delete', old.rowid, old.id, old.domain, old.codomain, old.description, old.decision_log);
        END;

      CREATE TRIGGER IF NOT EXISTS morphisms_fts_update
        AFTER UPDATE ON morphisms BEGIN
          INSERT INTO morphisms_fts(morphisms_fts, rowid, id, domain, codomain, description, decision_log)
          VALUES ('delete', old.rowid, old.id, old.domain, old.codomain, old.description, old.decision_log);
          INSERT INTO morphisms_fts(rowid, id, domain, codomain, description, decision_log)
          VALUES (new.rowid, new.id, new.domain, new.codomain, new.description, new.decision_log);
        END;
    `);
  }

  // --- File I/O ---

  private mdPath(id: string): string {
    return path.join(this.planDir, `${id}.md`);
  }

  private readMorphismFile(id: string): MorphismData | null {
    const filePath = this.mdPath(id);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const { fm, body } = parseMd(raw);
    const { description, decision_log } = parseBody(body);

    let validator: ValidatorSpec = { kind: 'none' };
    try {
      if (fm['validator']) validator = JSON.parse(fm['validator']);
    } catch { /* default to none */ }

    return {
      id: fm['id'] || id,
      domain: fm['domain'] || '',
      codomain: fm['codomain'] || '',
      autonomy: (fm['autonomy'] as Autonomy) || 'auto',
      status: (fm['status'] as MorphismStatus) || 'pending',
      factored_from: fm['factored_from'] || null,
      validator,
      description,
      decision_log,
      created_at: fm['created_at'] || new Date().toISOString(),
      updated_at: fm['updated_at'] || new Date().toISOString(),
    };
  }

  private writeMorphismFile(data: MorphismData): void {
    const fm: Frontmatter = {
      id: data.id,
      domain: data.domain,
      codomain: data.codomain,
      autonomy: data.autonomy,
      status: data.status,
    };
    if (data.factored_from) fm['factored_from'] = data.factored_from;
    fm['validator'] = JSON.stringify(data.validator);
    fm['created_at'] = data.created_at;
    fm['updated_at'] = data.updated_at;

    const body = stringifyBody(data.description, data.decision_log);
    fs.writeFileSync(this.mdPath(data.id), stringifyMd(fm, body));
  }

  // --- Index ---

  /** Rebuild the SQLite index from all morphism files. */
  rebuildIndex(): void {
    const files = fs.existsSync(this.planDir)
      ? fs.readdirSync(this.planDir).filter(f => f.endsWith('.md'))
      : [];

    const upsert = this.db.prepare(`
      INSERT INTO morphisms (id, domain, codomain, autonomy, status, factored_from, validator, description, decision_log, created_at, updated_at)
      VALUES (@id, @domain, @codomain, @autonomy, @status, @factored_from, @validator, @description, @decision_log, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        domain        = excluded.domain,
        codomain      = excluded.codomain,
        autonomy      = excluded.autonomy,
        status        = excluded.status,
        factored_from = excluded.factored_from,
        validator     = excluded.validator,
        description   = excluded.description,
        decision_log  = excluded.decision_log,
        updated_at    = excluded.updated_at
    `);

    const currentIds = new Set(files.map(f => f.slice(0, -3)));
    const existing = this.db.prepare('SELECT id FROM morphisms').all() as { id: string }[];
    const deleteStmt = this.db.prepare('DELETE FROM morphisms WHERE id = ?');

    const rebuild = this.db.transaction(() => {
      for (const { id } of existing) {
        if (!currentIds.has(id)) deleteStmt.run(id);
      }
      for (const file of files) {
        const id = file.slice(0, -3);
        const data = this.readMorphismFile(id);
        if (!data) continue;
        upsert.run({
          ...data,
          factored_from: data.factored_from ?? null,
          validator: JSON.stringify(data.validator),
        });
      }
    });

    rebuild();
  }

  // --- Writes ---

  /** Save a morphism definition (creates file + updates index). */
  save(data: MorphismData): void {
    this.writeMorphismFile(data);
    this.db.prepare(`
      INSERT INTO morphisms (id, domain, codomain, autonomy, status, factored_from, validator, description, decision_log, created_at, updated_at)
      VALUES (@id, @domain, @codomain, @autonomy, @status, @factored_from, @validator, @description, @decision_log, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        domain        = excluded.domain,
        codomain      = excluded.codomain,
        autonomy      = excluded.autonomy,
        status        = excluded.status,
        factored_from = excluded.factored_from,
        validator     = excluded.validator,
        description   = excluded.description,
        decision_log  = excluded.decision_log,
        updated_at    = excluded.updated_at
    `).run({
      ...data,
      factored_from: data.factored_from ?? null,
      validator: JSON.stringify(data.validator),
    });
  }

  /** Update morphism status. */
  updateStatus(id: string, status: MorphismStatus): void {
    const existing = this.get(id);
    if (!existing) throw new Error(`Morphism '${id}' not found`);
    existing.status = status;
    existing.updated_at = new Date().toISOString();
    this.save(existing);
  }

  /** Add a decision log entry. */
  addDecision(id: string, entry: string): void {
    const existing = this.get(id);
    if (!existing) throw new Error(`Morphism '${id}' not found`);
    existing.decision_log = existing.decision_log
      ? existing.decision_log + '\n- ' + entry
      : '- ' + entry;
    existing.updated_at = new Date().toISOString();
    this.save(existing);
  }

  // --- Queries ---

  /** Get a morphism by id. */
  get(id: string): MorphismData | null {
    const row = this.db.prepare('SELECT * FROM morphisms WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      validator: JSON.parse(row.validator),
    };
  }

  /** List all morphisms. */
  all(): MorphismData[] {
    const rows = this.db.prepare('SELECT * FROM morphisms ORDER BY created_at').all() as any[];
    return rows.map(r => ({ ...r, validator: JSON.parse(r.validator) }));
  }

  /** List morphisms by status. */
  byStatus(status: MorphismStatus): MorphismData[] {
    const rows = this.db.prepare('SELECT * FROM morphisms WHERE status = ? ORDER BY created_at').all(status) as any[];
    return rows.map(r => ({ ...r, validator: JSON.parse(r.validator) }));
  }

  /** List morphisms factored from a given morphism. */
  children(factored_from: string): MorphismData[] {
    const rows = this.db.prepare('SELECT * FROM morphisms WHERE factored_from = ? ORDER BY created_at').all(factored_from) as any[];
    return rows.map(r => ({ ...r, validator: JSON.parse(r.validator) }));
  }

  /** Full-text search across morphisms. */
  search(query: string): MorphismData[] {
    const rows = this.db.prepare(`
      SELECT m.* FROM morphisms m
      JOIN morphisms_fts ON morphisms_fts.rowid = m.rowid
      WHERE morphisms_fts MATCH ?
      ORDER BY rank LIMIT 50
    `).all(query) as any[];
    return rows.map(r => ({ ...r, validator: JSON.parse(r.validator) }));
  }

  /** Get the frontier: morphisms that need factoring (none validator, pending status). */
  frontier(): MorphismData[] {
    const rows = this.db.prepare(
      `SELECT * FROM morphisms WHERE status = 'pending' AND validator LIKE '%"none"%' ORDER BY created_at`,
    ).all() as any[];
    return rows.map(r => ({ ...r, validator: JSON.parse(r.validator) }));
  }

  /** Delete a morphism. */
  delete(id: string): void {
    const filePath = this.mdPath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.db.prepare('DELETE FROM morphisms WHERE id = ?').run(id);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
