import { describe, expect, it } from 'vitest';
import { packageSummaryLines, releaseSummaryLines } from '../src/utils/cliOutput.js';

describe('CLI summaries', () => {
  it('shows verified identity separately from the display filename', () => {
    const sha256 = 'a'.repeat(64);
    expect(
      packageSummaryLines('target/display-label.jar', undefined, {
        groupId: 'dev.sample',
        artifactId: 'sample',
        version: '2.4.1',
        sha256,
      })
    ).toEqual([
      'Package built successfully',
      '  Artifact: target/display-label.jar',
      '  Maven coordinates: dev.sample:sample:2.4.1',
      `  SHA-256: ${sha256}`,
    ]);
  });

  it('shows package metrics when Maven reports them', () => {
    expect(
      packageSummaryLines('/workspace/target/orders-api.jar', {
        testsRun: 3,
        testsFailed: 0,
        testsSkipped: 1,
        durationMs: 1250,
        warningCount: 2,
      })
    ).toEqual([
      'Package built successfully',
      '  Artifact: /workspace/target/orders-api.jar',
      '  Tests: 3 run, 0 failed, 1 skipped',
      '  Duration: 1.3s',
      '  Maven warnings: 2',
    ]);
  });

  it('keeps the package summary concise when metrics are unavailable', () => {
    expect(packageSummaryLines('/workspace/target/orders-api.jar')).toEqual([
      'Package built successfully',
      '  Artifact: /workspace/target/orders-api.jar',
    ]);
  });

  it('labels a release dry run as a preview and states that nothing changed', () => {
    expect(
      releaseSummaryLines(
        {
          previousVersion: '1.2.3',
          newVersion: '1.2.4',
          tagName: 'v1.2.4',
          pushed: false,
          dryRun: true,
        },
        { tag: true, push: true }
      )
    ).toEqual([
      'Release preview: 1.2.3 -> 1.2.4',
      '  Tag: v1.2.4',
      '  Push: planned',
      '  No files, commits, tags, or remotes were changed.',
    ]);
  });

  it('reports completed releases separately from previews', () => {
    expect(
      releaseSummaryLines(
        { previousVersion: '1.2.3', newVersion: '1.2.4', pushed: false },
        { tag: false, push: false }
      )
    ).toEqual(['Released version 1.2.4', '  Push: skipped']);
  });
});
