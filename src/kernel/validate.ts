import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ValidatorSpec } from './types.js';

const execFileAsync = promisify(execFile);

export interface ValidationResult {
  passed: boolean;
  errors?: string[];
}

export async function validate(spec: ValidatorSpec, artifact: unknown): Promise<ValidationResult> {
  switch (spec.kind) {
    case 'llm_output':
      return { passed: true };

    case 'valid_json': {
      if (typeof artifact !== 'string') {
        return { passed: false, errors: ['Expected string artifact for JSON validation'] };
      }
      try {
        JSON.parse(artifact);
        return { passed: true };
      } catch (e) {
        return { passed: false, errors: [(e as Error).message] };
      }
    }

    case 'compiles': {
      if (typeof artifact !== 'string') {
        return { passed: false, errors: ['Expected file path string for compilation check'] };
      }
      try {
        const cmd = spec.language === 'typescript' ? 'tsc' : spec.language;
        const args = spec.language === 'typescript' ? ['--noEmit', artifact] : [artifact];
        await execFileAsync(cmd, args);
        return { passed: true };
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        return { passed: false, errors: [err.stderr || err.message || 'Compilation failed'] };
      }
    }

    case 'passes_tests': {
      try {
        await execFileAsync('npx', ['vitest', 'run', spec.suite]);
        return { passed: true };
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        return { passed: false, errors: [err.stderr || err.message || 'Tests failed'] };
      }
    }
  }
}
