import type { BuildMetrics, ReleaseResult } from '../types/index.js';

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

export function packageSummaryLines(jarPath: string, metrics?: BuildMetrics): string[] {
  const lines = ['Package built successfully', `  Artifact: ${jarPath}`];
  if (metrics?.testsRun !== undefined) {
    lines.push(
      `  Tests: ${metrics.testsRun} run, ${metrics.testsFailed ?? 0} failed, ${metrics.testsSkipped ?? 0} skipped`
    );
  }
  if (metrics?.durationMs !== undefined) {
    lines.push(`  Duration: ${formatDuration(metrics.durationMs)}`);
  }
  if (metrics?.warningCount !== undefined) {
    lines.push(`  Maven warnings: ${metrics.warningCount}`);
  }
  return lines;
}

export function releaseSummaryLines(
  result: ReleaseResult,
  planned: { tag: boolean; push: boolean }
): string[] {
  if (result.dryRun) {
    const lines = [`Release preview: ${result.previousVersion} -> ${result.newVersion}`];
    lines.push(`  Tag: ${planned.tag ? (result.tagName ?? `v${result.newVersion}`) : 'skipped'}`);
    lines.push(`  Push: ${planned.push ? 'planned' : 'skipped'}`);
    lines.push('  No files, commits, tags, or remotes were changed.');
    return lines;
  }

  const lines = [`Released version ${result.newVersion}`];
  if (result.tagName) lines.push(`  Tag: ${result.tagName}`);
  lines.push(`  Push: ${result.pushed ? 'completed' : 'skipped'}`);
  return lines;
}
