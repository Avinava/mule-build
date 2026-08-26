import { BuildMetrics } from '../types/index.js';

export type FailureCategory =
  | 'compilation'
  | 'test-failure'
  | 'dependency'
  | 'plugin'
  | 'network'
  | 'oom'
  | 'configuration'
  | 'unknown';

export interface MavenDiagnostic {
  category: FailureCategory;
  summary: string;
  relevantLines: string[];
  suggestions: string[];
}

export interface ParsedTestTotals {
  testsRun: number;
  failures: number;
  errors: number;
  skipped: number;
}

const MAX_RELEVANT_LINES = 30;

const PATTERNS: Record<FailureCategory, RegExp[]> = {
  compilation: [
    /\[ERROR\].*\.java:\[\d+,\d+\]/,
    /\[ERROR\] COMPILATION ERROR/,
    /Cannot coerce/,
    /cannot find symbol/,
    /incompatible types/,
    /method does not exist/,
  ],
  'test-failure': [
    /Tests run:.*Failures:\s*[1-9]/,
    /Tests run:.*Errors:\s*[1-9]/,
    /MUnit test.*failed/i,
    /There are test failures/,
    /\[ERROR\].*Test.*FAILED/,
  ],
  dependency: [
    /Could not resolve dependencies/,
    /Could not find artifact/,
    /Failed to collect dependencies/,
    /dependency.*not found/i,
    /Non-resolvable parent POM/,
  ],
  plugin: [
    /Failed to execute goal org\.apache\.maven/,
    /Failed to execute goal org\.mule/,
    /PluginResolutionException/,
    /Plugin.*not found/,
  ],
  network: [
    /Connection timed out/,
    /Could not transfer artifact/,
    /ConnectException/,
    /UnknownHostException/,
    /Connection refused/,
  ],
  oom: [/java\.lang\.OutOfMemoryError/, /GC overhead limit exceeded/, /Java heap space/],
  configuration: [
    /Non-parseable POM/,
    /Project build error/,
    /Invalid POM/,
    /Malformed POM/,
    /Missing required/,
  ],
  unknown: [],
};

const SUGGESTIONS: Record<FailureCategory, string[]> = {
  compilation: [
    'Check the file and line numbers in the errors above for syntax issues or undefined references',
    'Ensure all required dependencies are declared in pom.xml',
    'Verify DataWeave expressions have correct syntax and type coercions',
    'Run `mvn compile` standalone for focused compiler output',
  ],
  'test-failure': [
    'Review the failing test assertions — the expected vs actual values are shown above',
    'Run `mvn test` standalone to focus on test output',
    'Check if test resource files (mock payloads, configs) are present in src/test/resources',
  ],
  dependency: [
    'Check repository configuration in pom.xml (MuleSoft repos must be declared)',
    'Verify network connectivity to Maven Central and MuleSoft repositories',
    'Run `mvn dependency:resolve` to get detailed dependency resolution info',
    'Check if the artifact version exists — it may have been removed or renamed',
    'Ensure settings.xml has valid credentials for private repositories',
  ],
  plugin: [
    'Check that mule-maven-plugin version in pom.xml is compatible with your Mule version',
    'Verify the plugin is available in your configured repositories',
    'Run `mvn help:effective-pom` to see resolved plugin versions',
  ],
  network: [
    'Check your internet connection and proxy settings',
    'Verify Maven repository URLs are accessible',
    'Check if a VPN is required for private repository access',
    'Try again — this may be a transient network issue',
    'Review proxy settings in ~/.m2/settings.xml if behind a corporate proxy',
  ],
  oom: [
    'Increase Maven heap size: export MAVEN_OPTS="-Xmx1024m"',
    'Close other memory-intensive applications',
    'Check for infinite loops or recursive processing in DataWeave transforms',
    'Consider building with `-DlightweightPackage` to reduce memory usage',
  ],
  configuration: [
    'Validate pom.xml syntax — check for unclosed tags or invalid XML',
    'Ensure parent POM version and groupId are correct',
    'Run `mvn help:effective-pom` to debug POM inheritance issues',
    'Check that all required POM properties are defined',
  ],
  unknown: [
    'Review the build output above for [ERROR] lines',
    'Run `mvn clean package -X` for debug-level Maven output',
    'Check if the issue is environment-specific (Java version, Maven version)',
    'Run `system_check` to verify your build environment is properly configured',
  ],
};

function categorize(output: string): FailureCategory {
  for (const [category, patterns] of Object.entries(PATTERNS) as [FailureCategory, RegExp[]][]) {
    if (category === 'unknown') continue;
    for (const pattern of patterns) {
      if (pattern.test(output)) {
        return category;
      }
    }
  }
  return 'unknown';
}

function extractRelevantLines(output: string, category: FailureCategory): string[] {
  const lines = output.split('\n');
  const relevant: string[] = [];

  const errorPatterns = [/^\[ERROR\]/, /BUILD FAILURE/, /COMPILATION ERROR/];
  if (category === 'test-failure') {
    errorPatterns.push(/Tests run:/, /FAILED/, /Failures:/, /at org\.mule/);
  }
  if (category === 'oom') {
    errorPatterns.push(/OutOfMemoryError/, /heap space/, /GC overhead/);
  }

  for (let i = 0; i < lines.length && relevant.length < MAX_RELEVANT_LINES; i++) {
    const line = lines[i];
    if (errorPatterns.some((p) => p.test(line))) {
      const contextStart = Math.max(0, i - 1);
      const contextEnd = Math.min(lines.length, i + 3);
      for (let j = contextStart; j < contextEnd && relevant.length < MAX_RELEVANT_LINES; j++) {
        const contextLine = lines[j].trim();
        if (contextLine && !relevant.includes(contextLine)) {
          relevant.push(contextLine);
        }
      }
    }
  }

  if (relevant.length === 0) {
    const buildFailureIdx = lines.findIndex((l) => l.includes('BUILD FAILURE'));
    if (buildFailureIdx !== -1) {
      const start = Math.max(0, buildFailureIdx - 2);
      const end = Math.min(lines.length, buildFailureIdx + 10);
      for (let i = start; i < end; i++) {
        const line = lines[i].trim();
        if (line) relevant.push(line);
      }
    }
  }

  if (relevant.length === 0) {
    const errorLines = lines.filter((l) => l.includes('[ERROR]')).slice(-10);
    relevant.push(...errorLines.map((l) => l.trim()));
  }

  return relevant;
}

function buildSummary(category: FailureCategory, output: string): string {
  switch (category) {
    case 'compilation': {
      const errorCount = (output.match(/\[ERROR\].*\.java:\[\d+/g) || []).length;
      return errorCount > 0
        ? `${errorCount} compilation error${errorCount > 1 ? 's' : ''}`
        : 'Compilation failed';
    }
    case 'test-failure': {
      const match = output.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/);
      if (match) {
        return `${match[2]} test failure${parseInt(match[2]) > 1 ? 's' : ''}, ${match[3]} error${parseInt(match[3]) > 1 ? 's' : ''} (${match[1]} tests run)`;
      }
      return 'Test failures detected';
    }
    case 'dependency': {
      const artMatch = output.match(/Could not find artifact ([^\s]+)/);
      if (artMatch) return `Missing dependency: ${artMatch[1]}`;
      return 'Dependency resolution failed';
    }
    case 'plugin': {
      const goalMatch = output.match(/Failed to execute goal ([^\s]+)/);
      if (goalMatch) return `Plugin execution failed: ${goalMatch[1]}`;
      return 'Maven plugin execution failed';
    }
    case 'network':
      return 'Network error during artifact download';
    case 'oom':
      return 'Out of memory — JVM heap exhausted during build';
    case 'configuration':
      return 'Invalid project configuration (pom.xml)';
    case 'unknown':
      return 'Build failed (see output below for details)';
  }
}

export function parseMavenFailure(output: string): MavenDiagnostic {
  const category = categorize(output);
  return {
    category,
    summary: buildSummary(category, output),
    relevantLines: extractRelevantLines(output, category),
    suggestions: SUGGESTIONS[category],
  };
}

export function parseMavenTestTotals(output: string): ParsedTestTotals | undefined {
  const lastCounter = (label: string): number | undefined => {
    const matches = [...output.matchAll(new RegExp(`>\\s*${label}:\\s*(\\d+)`, 'g'))];
    const value = matches.at(-1)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  const aggregate = {
    testsRun: lastCounter('Tests'),
    errors: lastCounter('Errors'),
    failures: lastCounter('Failures'),
    skipped: lastCounter('Skipped'),
  };
  if (Object.values(aggregate).every((value) => value !== undefined)) {
    return aggregate as ParsedTestTotals;
  }

  const munitMatches = [
    ...output.matchAll(
      /Tests:\s*(\d+),\s*Errors:\s*(\d+),\s*Failures:\s*(\d+),\s*Skipped:\s*(\d+)/g
    ),
  ];
  if (munitMatches.length > 0) {
    return munitMatches.reduce<ParsedTestTotals>(
      (totals, match) => ({
        testsRun: totals.testsRun + Number(match[1]),
        errors: totals.errors + Number(match[2]),
        failures: totals.failures + Number(match[3]),
        skipped: totals.skipped + Number(match[4]),
      }),
      { testsRun: 0, failures: 0, errors: 0, skipped: 0 }
    );
  }

  const mavenMatches = [
    ...output.matchAll(
      /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/g
    ),
  ];
  const summary = mavenMatches.at(-1);
  if (!summary) return undefined;
  return {
    testsRun: Number(summary[1]),
    failures: Number(summary[2]),
    errors: Number(summary[3]),
    skipped: Number(summary[4]),
  };
}

export function parseMavenSuccess(output: string, durationMs?: number): BuildMetrics {
  const metrics: BuildMetrics = {};

  if (durationMs !== undefined) {
    metrics.durationMs = durationMs;
  }

  const testTotals = parseMavenTestTotals(output);
  if (testTotals) {
    metrics.testsRun = testTotals.testsRun;
    metrics.testsFailed = testTotals.failures + testTotals.errors;
    metrics.testsSkipped = testTotals.skipped;
  }

  const warningLines = output.split('\n').filter((l) => l.includes('[WARNING]'));
  metrics.warningCount = warningLines.length;

  return metrics;
}
