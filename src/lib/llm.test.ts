import { describe, it, expect } from 'vitest';
import { extractJSON } from './llm.js';

describe('extractJSON', () => {
  it('parses a bare JSON object', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a bare JSON array', () => {
    expect(extractJSON('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips leading/trailing whitespace', () => {
    expect(extractJSON('  {"x": true}  ')).toEqual({ x: true });
  });

  it('extracts JSON from a ```json fenced block', () => {
    const text = 'Here is the result:\n```json\n{"ok":true}\n```\nDone.';
    expect(extractJSON(text)).toEqual({ ok: true });
  });

  it('extracts JSON from a plain ``` fenced block', () => {
    const text = '```\n[1,2]\n```';
    expect(extractJSON(text)).toEqual([1, 2]);
  });

  it('extracts JSON embedded in prose via bracket scanning', () => {
    const text = 'The answer is {"value": 42} as expected.';
    expect(extractJSON(text)).toEqual({ value: 42 });
  });

  it('extracts an array embedded in prose via bracket scanning', () => {
    const text = 'Result: [true, false]';
    expect(extractJSON(text)).toEqual([true, false]);
  });

  it('throws when no JSON is found', () => {
    expect(() => extractJSON('no json here')).toThrow('No JSON found');
  });

  it('throws when brackets found but content is not valid JSON', () => {
    expect(() => extractJSON('{ not valid json }')).toThrow();
  });
});
