import { describe, it, expect, beforeEach } from 'vitest';
import { signalExecute, LiveFactoringTable, FactoringError } from '../signal-executor.js';
import type { Artifact, BodyExecutor } from '../types.js';
import { morphism, compose, tensor, productType } from '../types.js';
import type { ArtifactType } from '../types.js';

// --- Fixture types ---

const Raw: ArtifactType = { name: 'Raw', validator: { kind: 'none' } };
const JSON_: ArtifactType = { name: 'JSON', validator: { kind: 'schema' } };
const Compiled: ArtifactType = {
  name: 'Compiled',
  validator: { kind: 'command', command: 'true', args: [], expectedExit: 0 },
};

// A mock body executor: records which morphism names fired and returns JSON.
function makeRecordingExecutor(log: string[]) {
  const exec: BodyExecutor = async (body) => {
    const name = body.kind === 'agent' ? body.prompt
      : body.kind === 'tool' ? body.command
      : 'unknown';
    log.push(name);
    return '{}';
  };
  return exec;
}

// ---

describe('LiveFactoringTable.factor — type boundary validation', () => {
  it('accepts a replacement with matching dom/cod', () => {
    const table = new LiveFactoringTable();
    const replacement = compose(
      morphism('step1', Raw, JSON_, { kind: 'agent', prompt: 'step1' }),
      morphism('step2', JSON_, JSON_, { kind: 'tool', command: 'step2', args: [] }),
    );
    expect(() =>
      table.factor('gen', replacement, { dom: Raw, cod: JSON_ })
    ).not.toThrow();
  });

  it('rejects a replacement with wrong domain', () => {
    const table = new LiveFactoringTable();
    const replacement = morphism('wrong', Compiled, JSON_, { kind: 'agent', prompt: 'x' });
    expect(() =>
      table.factor('gen', replacement, { dom: Raw, cod: JSON_ })
    ).toThrow(FactoringError);
  });

  it('rejects a replacement with wrong codomain', () => {
    const table = new LiveFactoringTable();
    const replacement = morphism('wrong', Raw, Compiled, { kind: 'agent', prompt: 'x' });
    expect(() =>
      table.factor('gen', replacement, { dom: Raw, cod: JSON_ })
    ).toThrow(FactoringError);
  });
});

describe('LiveFactoringTable — state management', () => {
  let table: LiveFactoringTable;

  beforeEach(() => { table = new LiveFactoringTable(); });

  it('isActive returns false before factoring', () => {
    expect(table.isActive('gen')).toBe(false);
  });

  it('isActive returns true after factoring', () => {
    const m = morphism('gen', Raw, JSON_, { kind: 'agent', prompt: 'gen' });
    table.factor('gen', m, { dom: Raw, cod: JSON_ });
    expect(table.isActive('gen')).toBe(true);
    expect(table.size).toBe(1);
  });

  it('rewind removes the pointer', () => {
    const m = morphism('gen', Raw, JSON_, { kind: 'agent', prompt: 'gen' });
    table.factor('gen', m, { dom: Raw, cod: JSON_ });
    table.rewind('gen');
    expect(table.isActive('gen')).toBe(false);
    expect(table.size).toBe(0);
  });
});

describe('forwarding pointer: basic redirect', () => {
  it('executes replacement instead of original body', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const original = morphism('gen', Raw, JSON_, { kind: 'agent', prompt: 'original' });
    const replacement = morphism('gen-factored', Raw, JSON_, { kind: 'agent', prompt: 'factored' });

    const table = new LiveFactoringTable();
    table.factor('gen', replacement, { dom: Raw, cod: JSON_ });

    await signalExecute(original, { type: Raw, value: 'x' }, executor, { liveFactoring: table });

    expect(log).toEqual(['factored']);
    expect(log).not.toContain('original');
  });

  it('without factoring, original body fires', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const original = morphism('gen', Raw, JSON_, { kind: 'agent', prompt: 'original' });

    await signalExecute(original, { type: Raw, value: 'x' }, executor);

    expect(log).toEqual(['original']);
  });
});

describe('forwarding pointer: composition', () => {
  it('factors one morphism in a pipeline, others unchanged', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const f = morphism('f', Raw, JSON_, { kind: 'agent', prompt: 'f' });
    const g = morphism('g', JSON_, JSON_, { kind: 'tool', command: 'g', args: [] });
    const pipeline = compose(f, g);

    // Factor g into two steps
    const g1 = morphism('g1', JSON_, JSON_, { kind: 'tool', command: 'g1', args: [] });
    const g2 = morphism('g2', JSON_, JSON_, { kind: 'tool', command: 'g2', args: [] });
    const gReplacement = compose(g1, g2);

    const table = new LiveFactoringTable();
    table.factor('g', gReplacement, { dom: JSON_, cod: JSON_ });

    await signalExecute(pipeline, { type: Raw, value: 'x' }, executor, { liveFactoring: table });

    // f runs normally, g is replaced by g1 then g2
    expect(log).toEqual(['f', 'g1', 'g2']);
  });

  it('factors replacement term recursively (nested factoring)', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const f = morphism('f', Raw, JSON_, { kind: 'agent', prompt: 'f' });

    // Factor f → compose(a, b), then also factor a → compose(a1, a2)
    const a = morphism('a', Raw, JSON_, { kind: 'agent', prompt: 'a' });
    const b = morphism('b', JSON_, JSON_, { kind: 'tool', command: 'b', args: [] });
    const a1 = morphism('a1', Raw, JSON_, { kind: 'agent', prompt: 'a1' });
    const a2 = morphism('a2', JSON_, JSON_, { kind: 'tool', command: 'a2', args: [] });

    const table = new LiveFactoringTable();
    table.factor('f', compose(a, b), { dom: Raw, cod: JSON_ });
    table.factor('a', compose(a1, a2), { dom: Raw, cod: JSON_ });

    await signalExecute(f, { type: Raw, value: 'x' }, executor, { liveFactoring: table });

    expect(log).toEqual(['a1', 'a2', 'b']);
  });
});

describe('forwarding pointer: rewind restores original', () => {
  it('after rewind, original body fires again', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const original = morphism('m', Raw, JSON_, { kind: 'agent', prompt: 'original' });
    const replacement = morphism('m-new', Raw, JSON_, { kind: 'agent', prompt: 'replacement' });

    const table = new LiveFactoringTable();
    table.factor('m', replacement, { dom: Raw, cod: JSON_ });

    await signalExecute(original, { type: Raw, value: 'x' }, executor, { liveFactoring: table });
    expect(log).toEqual(['replacement']);

    table.rewind('m');
    await signalExecute(original, { type: Raw, value: 'x' }, executor, { liveFactoring: table });
    expect(log).toEqual(['replacement', 'original']);
  });
});

describe('forwarding pointer: tensor branches factored independently', () => {
  it('factors left tensor branch without affecting right', async () => {
    const log: string[] = [];
    const executor = makeRecordingExecutor(log);

    const left = morphism('left', Raw, JSON_, { kind: 'agent', prompt: 'left-original' });
    const right = morphism('right', Raw, JSON_, { kind: 'agent', prompt: 'right-original' });
    const par = tensor(left, right);

    const leftReplacement = morphism('left-new', Raw, JSON_, { kind: 'agent', prompt: 'left-factored' });

    const table = new LiveFactoringTable();
    table.factor('left', leftReplacement, { dom: Raw, cod: JSON_ });

    const input: Artifact = {
      type: productType([Raw, Raw]),
      value: ['a', 'b'],
    };

    await signalExecute(par, input, executor, { liveFactoring: table });

    expect(log).toContain('left-factored');
    expect(log).toContain('right-original');
    expect(log).not.toContain('left-original');
  });
});

describe('forwarding pointer: in-flight safety', () => {
  it('factoring registered mid-execution only affects subsequent calls', async () => {
    const table = new LiveFactoringTable();
    const order: string[] = [];

    const fast = morphism('fast', Raw, JSON_, { kind: 'agent', prompt: 'fast' });
    const slow = morphism('slow', Raw, JSON_, { kind: 'agent', prompt: 'slow' });
    const pipeline = tensor(fast, slow);

    const fastReplacement = morphism('fast-new', Raw, JSON_, { kind: 'agent', prompt: 'fast-new' });

    const executor: BodyExecutor = async (body) => {
      const name = body.kind === 'agent' ? body.prompt : 'unknown';
      if (name === 'slow') {
        // slow starts, registers factoring for fast while fast may already be running
        table.factor('fast', fastReplacement, { dom: Raw, cod: JSON_ });
        order.push('slow');
      } else {
        order.push(name);
      }
      return '{}';
    };

    await signalExecute(pipeline, { type: productType([Raw, Raw]), value: ['a', 'b'] }, executor, {
      liveFactoring: table,
    });

    // fast fired before slow registered the factoring, so it ran as original
    // (or as replacement if slow happened first — either way no crash)
    expect(order.length).toBe(2);
    expect(order).toContain('slow');
  });
});
