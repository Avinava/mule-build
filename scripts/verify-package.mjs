import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'mule-build-package-'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    );
  }
  return result.stdout.trim();
}

try {
  const packOutput = run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    scratch,
  ]);
  const packed = JSON.parse(packOutput)[0];
  const filenames = new Set(packed.files.map((file) => file.path));
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/api/index.js',
    'dist/bin/mule-build.js',
    'CHANGELOG.md',
    'LICENSE',
    'docs/design.md',
    'docs/best-practices.md',
    'docs/folder-structure.md',
  ]) {
    if (!filenames.has(required)) throw new Error(`Packed artifact is missing ${required}`);
  }

  run('npm', ['init', '-y'], scratch);
  const tarball = join(scratch, packed.filename);
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    scratch
  );

  const importedVersion = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const m = await import('@sfdxy/mule-build'); if (typeof m.packageProject !== 'function' || typeof m.systemCheck !== 'function') process.exit(2); console.log('ok')",
    ],
    scratch
  );
  if (importedVersion !== 'ok') throw new Error('Installed package import did not expose v2 APIs');

  const cli = join(scratch, 'node_modules', '.bin', 'mule-build');
  const cliVersion = run(cli, ['--version'], scratch);
  if (cliVersion !== packageJson.version) {
    throw new Error(`CLI version ${cliVersion} does not match package ${packageJson.version}`);
  }

  const mcpCheck = join(scratch, 'mcp-check.mjs');
  writeFileSync(
    mcpCheck,
    `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const transport = new StdioClientTransport({ command: ${JSON.stringify(cli)}, args: ['mcp'], cwd: ${JSON.stringify(scratch)}, stderr: 'pipe' });
const client = new Client({ name: 'packed-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (!tools.tools.some((tool) => tool.name === 'run_build')) throw new Error('run_build missing');
  const resource = await client.readResource({ uri: 'mule-build://docs/design' });
  if (!('text' in resource.contents[0]) || !resource.contents[0].text.includes('# Design')) throw new Error('packaged docs unreadable');
} finally {
  await client.close();
}
`
  );
  run(process.execPath, [mcpCheck], scratch);
  console.log(`Verified ${packed.filename}: import, CLI ${cliVersion}, MCP, and docs`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
