import { describe, expect, it } from 'vitest';
import { testProject } from '../src/api/test.js';
import { parseTestMetrics } from '../src/api/test.js';

describe('testProject', () => {
  it('rejects a test without a suite before invoking Maven', async () => {
    const result = await testProject({ test: 'one-test' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('requires a suite');
  });

  it('rejects tags combined with suite selection before invoking Maven', async () => {
    const result = await testProject({ suite: 'suite', tags: ['smoke'] });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('not both');
  });

  it('parses the final Maven test summary with separate failures and errors', () => {
    expect(
      parseTestMetrics(
        'Tests run: 2, Failures: 0, Errors: 0, Skipped: 0\nTests run: 7, Failures: 1, Errors: 2, Skipped: 3',
        1200
      )
    ).toEqual({ durationMs: 1200, testsRun: 7, failures: 1, errors: 2, skipped: 3 });
  });
});
