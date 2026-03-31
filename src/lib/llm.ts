/**
 * LLM client. Two backends, resolved at construction time:
 *   - sdk  : Anthropic SDK (when ANTHROPIC_API_KEY is set)
 *   - cli  : `claude -p` subprocess (Claude Code / Pro)
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

const MODEL = process.env['ZYGOMORPHIC_MODEL'] ?? 'claude-sonnet-4-6';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;
const MAX_BUF = 16 * 1024 * 1024; // 16 MB

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

export function extractJSON(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]!.trim()); } catch { /* fall through */ } }
  const obj = t.indexOf('{'), arr = t.indexOf('[');
  const start = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  if (start !== -1) {
    const end = t[start] === '{' ? t.lastIndexOf('}') : t.lastIndexOf(']');
    if (end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ } }
  }
  throw new Error(`No JSON found in response: ${t.slice(0, 120)}`);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LLMClient {
  private mode: 'sdk' | 'cli';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;

  constructor() {
    this.mode = process.env['ANTHROPIC_API_KEY'] ? 'sdk' : 'cli';
    if (this.mode === 'sdk') {
      import('@anthropic-ai/sdk').then((m) => { this.sdk = new m.default(); }).catch(() => {
        this.mode = 'cli';
      });
    }
  }

  /** Send a prompt and get a text response. Retries on failure. */
  async call(prompt: string): Promise<string> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return this.mode === 'sdk' && this.sdk
          ? await this.callSDK(prompt)
          : await this.callCLI(prompt);
      } catch (e) {
        lastErr = e as Error;
        if (attempt < MAX_RETRIES - 1) await sleep(RETRY_BASE_MS * (attempt + 1));
      }
    }
    throw lastErr ?? new Error('LLM call failed after retries');
  }

  /** Send a prompt and get a JSON-parsed response. */
  async callJSON<T = unknown>(prompt: string): Promise<T> {
    const text = await this.call(prompt);
    return extractJSON(text) as T;
  }

  /** Streaming variant — yields text chunks as they arrive. */
  async *stream(prompt: string): AsyncGenerator<string> {
    if (this.mode === 'sdk' && this.sdk) {
      yield* this.streamSDK(prompt);
    } else {
      yield* this.streamCLI(prompt);
    }
  }

  private async *streamSDK(prompt: string): AsyncGenerator<string> {
    const stream = this.sdk.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });
    for await (const text of stream.textStream as AsyncIterable<string>) {
      yield text;
    }
  }

  private async *streamCLI(prompt: string): AsyncGenerator<string> {
    const proc = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrText = '';
    proc.stderr?.on('data', (d: Buffer) => { stderrText += d.toString(); });

    for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      yield chunk.toString('utf8');
    }

    await new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`claude exited ${code}${stderrText ? ': ' + stderrText.slice(0, 200) : ''}`));
      });
      proc.on('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        reject(e.code === 'ENOENT'
          ? new Error('claude CLI not found. Install Claude Code or set ANTHROPIC_API_KEY.')
          : err);
      });
    });
  }

  private async callSDK(prompt: string): Promise<string> {
    const msg = await this.sdk.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private async callCLI(prompt: string): Promise<string> {
    try {
      const { stdout } = await execFileP('claude', ['-p', '--dangerously-skip-permissions', prompt], {
        maxBuffer: MAX_BUF,
        timeout: 180_000,
      });
      return stdout;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'ENOENT') {
        throw new Error('claude CLI not found. Install Claude Code or set ANTHROPIC_API_KEY.');
      }
      throw new Error(err.message ?? String(e));
    }
  }
}
