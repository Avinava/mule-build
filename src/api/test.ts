import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canTest } from '../config/SystemChecker.js';
import { mavenTest } from '../engine/MavenBuilder.js';
import { Result, TestMetrics, TestOptions, TestResult, err, ok } from '../types/index.js';
import { parseMavenTestTotals } from '../engine/MavenOutputParser.js';

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) files.push(...collectFiles(path));
    else if (stats.isFile()) files.push(path);
  }
  return files;
}

export function parseTestMetrics(output: string, durationMs: number): TestMetrics {
  const totals = parseMavenTestTotals(output);
  return {
    durationMs,
    testsRun: totals?.testsRun ?? 0,
    failures: totals?.failures ?? 0,
    errors: totals?.errors ?? 0,
    skipped: totals?.skipped ?? 0,
  };
}

function parseApplicationCoverage(output: string, coverageReports: string[]): number | undefined {
  const outputMatch = output.match(/Application Coverage:\s*(\d+(?:\.\d+)?)%/i);
  if (outputMatch?.[1]) return Number(outputMatch[1]);
  for (const report of coverageReports) {
    if (!/\.(?:html?|json|xml|txt)$/i.test(report)) continue;
    try {
      const text = readFileSync(report, 'utf-8');
      const match = text.match(/Application Coverage[^0-9]*(\d+(?:\.\d+)?)%/i);
      if (match?.[1]) return Number(match[1]);
    } catch {
      // Report discovery is best-effort and must not invalidate a successful test run.
    }
  }
  return undefined;
}

export async function testProject(options: TestOptions = {}): Promise<Result<TestResult>> {
  const cwd = options.cwd ?? process.cwd();
  const suite = options.suite?.trim();
  const test = options.test?.trim();
  const tags = options.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  if (test && !suite) return err(new Error('A test name requires a suite name'));
  if (tags.length > 0 && (suite || test)) {
    return err(new Error('Use tags or suite/test selection, not both'));
  }

  const readiness = await canTest(cwd);
  if (!readiness.success) return err(readiness.error ?? new Error('Test requirements not met'));
  const run = await mavenTest({
    cwd,
    clean: options.clean ?? false,
    profile: options.profile,
    suite,
    test,
    tags,
  });
  if (!run.success || !run.data) {
    return err(run.error ?? new Error('MUnit test execution failed'));
  }

  const targetFiles = collectFiles(join(cwd, 'target'));
  const reportPaths = targetFiles
    .filter(
      (path) =>
        /(?:surefire-reports|munit-reports)/i.test(path) && /\.(?:xml|txt|html?|json)$/i.test(path)
    )
    .sort();
  const coverageReportPaths = targetFiles
    .filter(
      (path) => /(?:coverage|site[/\\]munit)/i.test(path) && /\.(?:xml|txt|html?|json)$/i.test(path)
    )
    .sort();
  const applicationCoverage = parseApplicationCoverage(run.data.output, coverageReportPaths);

  return ok({
    metrics: parseTestMetrics(run.data.output, run.data.durationMs),
    reportPaths,
    coverageReportPaths,
    ...(applicationCoverage === undefined ? {} : { applicationCoverage }),
  });
}
