import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { themeSchema } from '../theme-schema.js';
import { ThemeValidationError, type ThemeFile, type ValidationIssue } from '../ports.js';

/**
 * ajv wrapper with friendly errors: every issue carries the exact instance
 * path (`/tokens/--bg`) so a 422 tells the author precisely what to fix.
 */
export class ThemeValidator {
  private readonly validate: ValidateFunction;

  constructor() {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    this.validate = ajv.compile(themeSchema);
  }

  /** Returns the typed theme or throws ThemeValidationError with all issues. */
  parse(raw: string): ThemeFile {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new ThemeValidationError([
        { path: '', message: `not valid JSON: ${(error as Error).message}` },
      ]);
    }
    return this.check(data);
  }

  check(data: unknown): ThemeFile {
    if (!this.validate(data)) {
      const issues: ValidationIssue[] = (this.validate.errors ?? []).map((error) => ({
        path: error.instancePath || '(root)',
        message:
          error.keyword === 'additionalProperties'
            ? `unknown key ${String((error.params as { additionalProperty?: string }).additionalProperty)}`
            : (error.message ?? 'invalid'),
      }));
      throw new ThemeValidationError(issues);
    }
    return data as unknown as ThemeFile;
  }
}
