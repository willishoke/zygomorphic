/**
 * validate.ts — Execute validators against artifacts.
 *
 * Validator kinds map to the architecture's bootstrap kernel:
 *   command  — shell exec with expected exit code
 *   schema   — JSON parse + optional JSON Schema validation
 *   tensor   — run all checks in parallel, all must pass
 *   sequence — run checks sequentially, stop on first failure
 *   human    — requires human judgment (cannot auto-validate)
 *   none     — unvalidatable (must factor before execution)
 */

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
    case 'none':
      return { passed: false, errors: ['Unvalidatable type \u2014 must factor'] };

    case 'human':
      return { passed: false, errors: [`Requires human review: ${spec.prompt}`] };

    case 'schema': {
      if (typeof artifact !== 'string') {
        return { passed: false, errors: ['Expected string artifact for JSON validation'] };
      }
      try {
        JSON.parse(artifact);
        // TODO: validate against spec.schema (JSON Schema) when present
        return { passed: true };
      } catch (e) {
        return { passed: false, errors: [(e as Error).message] };
      }
    }

    case 'command': {
      try {
        await execFileAsync(spec.command, spec.args);
        return { passed: true };
      } catch (e) {
        const err = e as { code?: number; stderr?: string; message?: string };
        if (err.code !== undefined && err.code === spec.expectedExit) {
          return { passed: true };
        }
        return { passed: false, errors: [err.stderr || err.message || 'Command failed'] };
      }
    }

    case 'tensor': {
      if (spec.checks.length === 0) return { passed: true };
      const results = await Promise.all(
        spec.checks.map(check => validate(check, artifact)),
      );
      const errors = results.flatMap(r => r.errors ?? []);
      return errors.length === 0
        ? { passed: true }
        : { passed: false, errors };
    }

    case 'sequence': {
      for (const step of spec.steps) {
        const result = await validate(step, artifact);
        if (!result.passed) return result;
      }
      return { passed: true };
    }
  }
}
