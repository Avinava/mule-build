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

  it('parses the MUnit 3 run summary', () => {
    expect(
      parseTestMetrics(
        'MUnit Run Summary\n >> orders-test-suite.xml test result: Tests: 1, Errors: 0, Failures: 0, Skipped: 0',
        900
      )
    ).toEqual({ durationMs: 900, testsRun: 1, failures: 0, errors: 0, skipped: 0 });
  });

  it('prefers the MUnit aggregate when multiple suites ran', () => {
    expect(
      parseTestMetrics(
        [
          'first suite: Tests: 2, Errors: 0, Failures: 0, Skipped: 0',
          'second suite: Tests: 3, Errors: 1, Failures: 0, Skipped: 1',
          '> Tests: 5',
          '> Errors: 1',
          '> Failures: 0',
          '> Skipped: 1',
        ].join('\n'),
        1500
      )
    ).toEqual({ durationMs: 1500, testsRun: 5, failures: 0, errors: 1, skipped: 1 });
  });
});
