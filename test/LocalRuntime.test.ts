import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deployToLocal,
  getRuntimeStatus,
  startMuleRuntime,
  stopMuleRuntime,
} from '../src/engine/LocalRuntime.js';

const directories: string[] = [];

function fakeRuntime(): string {
  const root = mkdtempSync(join(tmpdir(), 'mule-build-runtime-'));
  directories.push(root);
  const home = join(root, 'mule-enterprise-standalone-4.10.2-ee');
  mkdirSync(join(home, 'bin'), { recursive: true });
  const executable = join(home, 'bin', 'mule');
  writeFileSync(
    executable,
    `#!/bin/sh
state="$(dirname "$0")/../.running"
case "$1" in
  start) touch "$state"; echo "started"; exit 0 ;;
  stop) rm -f "$state"; echo "stopped"; exit 0 ;;
  status) if [ -f "$state" ]; then echo "running"; exit 0; else echo "not running"; exit 1; fi ;;
  *) exit 2 ;;
esac
`
  );
  chmodSync(executable, 0o755);
  return home;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('LocalRuntime managed lifecycle', () => {
  it('starts, reports, and stops the actual selected runtime', async () => {
    const home = fakeRuntime();
    expect((await getRuntimeStatus(undefined, home)).data?.running).toBe(false);

    const started = await startMuleRuntime({ runtimeHome: home, timeoutMs: 1_000 });
    expect(started.success).toBe(true);
    expect((await getRuntimeStatus(undefined, home)).data?.running).toBe(true);

    const stopped = await stopMuleRuntime(undefined, home, 1_000);
    expect(stopped.success).toBe(true);
    expect((await getRuntimeStatus(undefined, home)).data?.running).toBe(false);
  });

  it('deploys a JAR and waits for its runtime anchor', async () => {
    const home = fakeRuntime();
    const source = join(directories[directories.length - 1], 'orders.jar');
    writeFileSync(source, 'jar');
    mkdirSync(join(home, 'apps'), { recursive: true });
    writeFileSync(join(home, 'apps', 'orders-anchor.txt'), 'deployed');

    const result = await deployToLocal(source, undefined, home, 1_000);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ deployed: true, running: true });
  });
});
