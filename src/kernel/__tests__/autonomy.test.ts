import { describe, it, expect } from 'vitest';
import {
  createGate, resolveGate, escalate,
  canProceed, requiresHuman,
} from '../autonomy.js';
import type { HumanFeedback } from '../autonomy.js';
import { factor, id2 } from '../rewrite.js';
import { morphism } from '../types.js';
import { TypeError } from '../type-check.js';
import type { ArtifactType } from '../types.js';

const Spec: ArtifactType = { name: 'Spec', validator: { kind: 'none' } };
const Code: ArtifactType = { name: 'Code', validator: { kind: 'schema' } };
const Tested: ArtifactType = {
  name: 'Tested',
  validator: { kind: 'command', command: 'npx', args: ['vitest', 'run'], expectedExit: 0 },
};
const Designed: ArtifactType = { name: 'Designed', validator: { kind: 'human', prompt: 'review' } };

const body = { kind: 'agent' as const, prompt: '' };

describe('approve gate', () => {
  const f = morphism('deliver', Spec, Tested, body);
  const h = morphism('write', Spec, Code, body);
  const g = morphism('test', Code, Tested, body);
  const proposed = factor(f, Code, h, g, 'approve');

  it('creates gate with pending feedback', () => {
    const gate = createGate(proposed, 'approve');
    expect(gate.feedback).toBeNull();
    expect(gate.autonomy).toBe('approve');
  });

  it('approved: returns the proposed rewrite', () => {
    const gate = createGate(proposed, 'approve');
    const result = resolveGate(gate, { decision: 'approved' });
    expect(result).toBe(proposed);
    expect(gate.feedback?.decision).toBe('approved');
  });

  it('rejected: returns null', () => {
    const gate = createGate(proposed, 'approve');
    const result = resolveGate(gate, { decision: 'rejected', reason: 'wrong split' });
    expect(result).toBeNull();
    expect(gate.feedback?.decision).toBe('rejected');
  });

  it('edited: returns modified rewrite after type-check', () => {
    const gate = createGate(proposed, 'approve');
    // An alternative factoring through Designed instead of Code
    const altH = morphism('design', Spec, Designed, body);
    const altG = morphism('implement', Designed, Tested, body);
    const modified = factor(f, Designed, altH, altG, 'approve');

    const result = resolveGate(gate, { decision: 'edited', modified });
    expect(result).toBe(modified);
  });

  it('edited: rejects ill-typed modified rewrite', () => {
    const gate = createGate(proposed, 'approve');
    // Bad modification: wrong boundaries
    const badH = morphism('bad', Code, Designed, body); // wrong domain
    const badG = morphism('test', Designed, Tested, body);
    const bad = factor(f, Designed, badH, badG, 'approve');

    expect(() => resolveGate(gate, { decision: 'edited', modified: bad }))
      .toThrow(TypeError);
  });

  it('restructured: returns alternative rewrite', () => {
    const gate = createGate(proposed, 'approve');
    // Human proposes identity (no factoring needed)
    const alternative = id2(f);

    const result = resolveGate(gate, { decision: 'restructured', alternative });
    expect(result).not.toBeNull();
    expect(result!.tag).toBe('id_2');
  });
});

describe('escalation', () => {
  it('auto escalates to approve after threshold', () => {
    expect(escalate('auto', 10, 5)).toBe('approve');
  });

  it('auto stays auto below threshold', () => {
    expect(escalate('auto', 3, 5)).toBe('auto');
  });

  it('approve does not escalate further', () => {
    expect(escalate('approve', 100, 5)).toBe('approve');
  });

  it('manual does not escalate', () => {
    expect(escalate('manual', 100, 5)).toBe('manual');
  });
});

describe('canProceed / requiresHuman', () => {
  it('auto can proceed without human', () => {
    expect(canProceed('auto')).toBe(true);
    expect(requiresHuman('auto')).toBe(false);
  });

  it('approve requires human', () => {
    expect(canProceed('approve')).toBe(false);
    expect(requiresHuman('approve')).toBe(true);
  });

  it('manual requires human', () => {
    expect(canProceed('manual')).toBe(false);
    expect(requiresHuman('manual')).toBe(true);
  });
});
