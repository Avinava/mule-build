import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli.js';
import { packageSummaryLines, releaseSummaryLines } from '../src/utils/cliOutput.js';

describe('CLI release options', () => {
  it('offers prerelease bumps and an explicit version instead of a required bump', () => {
    const release = createProgram().commands.find((command) => command.name() === 'release')!;
    const options = Object.fromEntries(release.options.map((option) => [option.long, option]));
    expect(Object.keys(options)).toEqual(
      expect.arrayContaining(['--bump', '--preid', '--version', '--dry-run'])
    );
    expect(options['--bump'].mandatory).toBe(false);
    expect(options['--bump'].description).toContain('prerelease');
  });

  it('passes --version after a command to the command, not the tool version flag', async () => {
    const program = createProgram();
    const release = program.commands.find((command) => command.name() === 'release')!;
    let received: unknown;
    release.action((options) => {
      received = options.version;
    });
    await program.parseAsync(['node', 'mule-build', 'release', '--version', '1.4.3', '--dry-run']);
    expect(received).toBe('1.4.3');
  });
});

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
