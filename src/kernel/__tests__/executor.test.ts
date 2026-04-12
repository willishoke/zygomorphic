import { describe, it, expect } from 'vitest';
import { buildGraph, execute } from '../executor.js';
import type { Artifact, BodyExecutor } from '../executor.js';
import { morphism, compose, id } from '../types.js';
import type { ArtifactType } from '../types.js';
import { inferType } from '../type-check.js';

const RawText: ArtifactType = { name: 'RawText', validator: { kind: 'llm_output' } };
const ValidJSON: ArtifactType = { name: 'ValidJSON', validator: { kind: 'valid_json' } };

// A mock executor that transforms values based on body kind
const mockExecutor: BodyExecutor = async (body, input) => {
  switch (body.kind) {
    case 'agent':
      return JSON.stringify({ prompt: body.prompt, received: input.value });
    case 'tool':
      return JSON.stringify({ tool: body.command, input: input.value });
    case 'human':
      return JSON.stringify({ human: body.description, input: input.value });
  }
};

describe('buildGraph', () => {
  it('flattens a single morphism into one node', () => {
    const m = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'hello' });
    const nodes = buildGraph(m);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].term.name).toBe('gen');
    expect(nodes[0].downstream).toBeNull();
  });

  it('flattens composed morphisms into a wired sequence', () => {
    const f = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const g = morphism('transform', ValidJSON, ValidJSON, { kind: 'tool', command: 'jq', args: ['.'] });
    const nodes = buildGraph(compose(f, g));
    expect(nodes).toHaveLength(2);
    expect(nodes[0].downstream).toBe(nodes[1]);
    expect(nodes[1].downstream).toBeNull();
  });

  it('flattens deeply nested compositions', () => {
    const f = morphism('a', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const g = morphism('b', ValidJSON, ValidJSON, { kind: 'tool', command: 'y', args: [] });
    const h = morphism('c', ValidJSON, ValidJSON, { kind: 'tool', command: 'z', args: [] });
    const nodes = buildGraph(compose(compose(f, g), h));
    expect(nodes).toHaveLength(3);
    expect(nodes[0].downstream).toBe(nodes[1]);
    expect(nodes[1].downstream).toBe(nodes[2]);
  });

  it('handles identity (produces empty graph)', () => {
    const nodes = buildGraph(id(RawText));
    expect(nodes).toHaveLength(0);
  });
});

describe('execute', () => {
  it('executes a single morphism pipeline', async () => {
    const m = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'hello' });
    const graph = buildGraph(m);
    const input: Artifact = { type: RawText, value: 'start' };

    const result = await execute(graph, input, mockExecutor);
    expect(result.type).toBe(ValidJSON);
    const parsed = JSON.parse(result.value as string);
    expect(parsed.prompt).toBe('hello');
    expect(parsed.received).toBe('start');
  });

  it('cascades through a two-morphism pipeline', async () => {
    const f = morphism('gen', RawText, ValidJSON, { kind: 'agent', prompt: 'step1' });
    const g = morphism('transform', ValidJSON, ValidJSON, { kind: 'tool', command: 'jq', args: [] });
    const graph = buildGraph(compose(f, g));
    const input: Artifact = { type: RawText, value: 'origin' };

    const result = await execute(graph, input, mockExecutor);
    expect(result.type).toBe(ValidJSON);
    // Second node received the output of the first
    const parsed = JSON.parse(result.value as string);
    expect(parsed.tool).toBe('jq');
  });

  it('passes through identity', async () => {
    const graph = buildGraph(id(RawText));
    const input: Artifact = { type: RawText, value: 'passthrough' };

    const result = await execute(graph, input, mockExecutor);
    expect(result.value).toBe('passthrough');
  });

  it('throws on validation failure', async () => {
    const m = morphism('bad', RawText, ValidJSON, { kind: 'agent', prompt: 'x' });
    const graph = buildGraph(m);
    const input: Artifact = { type: RawText, value: 'start' };

    // Executor that produces invalid JSON
    const badExecutor: BodyExecutor = async () => 'not valid json {{{';

    await expect(execute(graph, input, badExecutor)).rejects.toThrow(/Validation failed/);
  });
});
