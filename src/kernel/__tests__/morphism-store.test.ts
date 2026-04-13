import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MorphismStore } from '../morphism-store.js';
import type { MorphismData } from '../morphism-store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

let store: MorphismStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyg-test-'));
  store = new MorphismStore(tmpDir);
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMorphism(overrides: Partial<MorphismData> = {}): MorphismData {
  const now = new Date().toISOString();
  return {
    id: 'test_morph',
    domain: 'Spec',
    codomain: 'Code',
    autonomy: 'auto',
    status: 'pending',
    factored_from: null,
    validator: { kind: 'schema' },
    description: 'Write the implementation.',
    decision_log: '',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('MorphismStore — basic CRUD', () => {
  it('saves and retrieves a morphism', () => {
    const data = makeMorphism();
    store.save(data);

    const retrieved = store.get('test_morph');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('test_morph');
    expect(retrieved!.domain).toBe('Spec');
    expect(retrieved!.codomain).toBe('Code');
    expect(retrieved!.validator.kind).toBe('schema');
  });

  it('writes markdown file to plan directory', () => {
    store.save(makeMorphism());
    const filePath = path.join(tmpDir, 'plan', 'test_morph.md');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('id: test_morph');
    expect(content).toContain('domain: Spec');
    expect(content).toContain('Write the implementation.');
  });

  it('updates an existing morphism', () => {
    store.save(makeMorphism());
    store.save(makeMorphism({ description: 'Updated description.' }));

    const retrieved = store.get('test_morph');
    expect(retrieved!.description).toBe('Updated description.');
  });

  it('deletes a morphism', () => {
    store.save(makeMorphism());
    store.delete('test_morph');

    expect(store.get('test_morph')).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'plan', 'test_morph.md'))).toBe(false);
  });

  it('lists all morphisms', () => {
    store.save(makeMorphism({ id: 'a' }));
    store.save(makeMorphism({ id: 'b' }));
    store.save(makeMorphism({ id: 'c' }));

    const all = store.all();
    expect(all).toHaveLength(3);
    expect(all.map(m => m.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('MorphismStore — status management', () => {
  it('updates status', () => {
    store.save(makeMorphism());
    store.updateStatus('test_morph', 'in_progress');

    expect(store.get('test_morph')!.status).toBe('in_progress');
  });

  it('queries by status', () => {
    store.save(makeMorphism({ id: 'a', status: 'pending' }));
    store.save(makeMorphism({ id: 'b', status: 'in_progress' }));
    store.save(makeMorphism({ id: 'c', status: 'pending' }));

    const pending = store.byStatus('pending');
    expect(pending).toHaveLength(2);
    expect(pending.map(m => m.id).sort()).toEqual(['a', 'c']);
  });

  it('throws on update of nonexistent morphism', () => {
    expect(() => store.updateStatus('nope', 'completed')).toThrow(/not found/);
  });
});

describe('MorphismStore — factoring tree', () => {
  it('tracks factored_from relationships', () => {
    store.save(makeMorphism({ id: 'parent', domain: 'Spec', codomain: 'Tested' }));
    store.save(makeMorphism({ id: 'child1', factored_from: 'parent', domain: 'Spec', codomain: 'Code' }));
    store.save(makeMorphism({ id: 'child2', factored_from: 'parent', domain: 'Code', codomain: 'Tested' }));

    const children = store.children('parent');
    expect(children).toHaveLength(2);
    expect(children.map(m => m.id).sort()).toEqual(['child1', 'child2']);
  });
});

describe('MorphismStore — decision log', () => {
  it('appends decision entries', () => {
    store.save(makeMorphism());
    store.addDecision('test_morph', 'JWT over sessions (stateless)');
    store.addDecision('test_morph', 'httpOnly cookies (compliance)');

    const m = store.get('test_morph')!;
    expect(m.decision_log).toContain('JWT over sessions');
    expect(m.decision_log).toContain('httpOnly cookies');
  });
});

describe('MorphismStore — frontier', () => {
  it('finds morphisms needing factoring (none validator)', () => {
    store.save(makeMorphism({ id: 'factored', validator: { kind: 'schema' } }));
    store.save(makeMorphism({ id: 'needs_factoring', validator: { kind: 'none' }, status: 'pending' }));
    store.save(makeMorphism({ id: 'done', validator: { kind: 'none' }, status: 'completed' }));

    const frontier = store.frontier();
    expect(frontier).toHaveLength(1);
    expect(frontier[0].id).toBe('needs_factoring');
  });
});

describe('MorphismStore — search', () => {
  it('full-text search finds morphisms', () => {
    store.save(makeMorphism({ id: 'auth', description: 'Implement JWT authentication middleware' }));
    store.save(makeMorphism({ id: 'db', description: 'Set up database schema' }));

    const results = store.search('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('auth');
  });
});

describe('MorphismStore — rebuildIndex', () => {
  it('rebuilds index from markdown files', () => {
    // Save some morphisms
    store.save(makeMorphism({ id: 'persist1' }));
    store.save(makeMorphism({ id: 'persist2' }));

    // Close and reopen with fresh DB
    store.close();
    // Delete the DB but keep markdown files
    const dbPath = path.join(tmpDir, '.morphisms.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    // Also remove WAL/SHM files
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

    store = new MorphismStore(tmpDir);
    expect(store.all()).toHaveLength(0); // Fresh DB, no index

    store.rebuildIndex();
    expect(store.all()).toHaveLength(2);
    expect(store.get('persist1')).not.toBeNull();
    expect(store.get('persist2')).not.toBeNull();
  });

  it('removes orphaned index entries', () => {
    store.save(makeMorphism({ id: 'keep' }));
    store.save(makeMorphism({ id: 'remove' }));

    // Delete the file for 'remove' but keep its index entry
    fs.unlinkSync(path.join(tmpDir, 'plan', 'remove.md'));

    store.rebuildIndex();
    expect(store.all()).toHaveLength(1);
    expect(store.get('keep')).not.toBeNull();
    expect(store.get('remove')).toBeNull();
  });
});

describe('MorphismStore — validator roundtrip', () => {
  it('preserves complex validators through save/load', () => {
    const complexValidator = {
      kind: 'tensor' as const,
      checks: [
        { kind: 'command' as const, command: 'tsc', args: ['--noEmit'], expectedExit: 0 },
        { kind: 'command' as const, command: 'jest', args: ['--testPathPattern', 'auth'], expectedExit: 0 },
      ],
    };

    store.save(makeMorphism({ id: 'complex', validator: complexValidator }));
    const retrieved = store.get('complex')!;

    expect(retrieved.validator.kind).toBe('tensor');
    expect((retrieved.validator as any).checks).toHaveLength(2);
    expect((retrieved.validator as any).checks[0].command).toBe('tsc');
  });
});
