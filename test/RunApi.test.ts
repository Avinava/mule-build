import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocal } from '../src/api/run.js';
import { packageProject } from '../src/api/package.js';
import { createBuildInfo } from '../src/engine/BuildInfo.js';
import { ok } from '../src/types/index.js';

const runtime = { path: '/opt/mule', version: '4.6.0', source: 'option' as const };

vi.mock('../src/config/SystemChecker.js', () => ({ canBuild: vi.fn(async () => ok(undefined)) }));
vi.mock('../src/api/package.js', () => ({ packageProject: vi.fn() }));
vi.mock('../src/engine/LocalRuntime.js', () => ({
  getRuntimeStatus: vi.fn(async () =>
    ok({ runtime, running: true, debugPortInUse: false, message: 'running' })
  ),
  startMuleRuntime: vi.fn(),
  stopMuleRuntime: vi.fn(),
  deployToLocal: vi.fn(async (jarPath: string) =>
    ok({
      deployed: true,
      jarPath,
      message: 'Deployed sample',
      runtime,
      running: true,
      debug: false,
    })
  ),
}));

function packaged(stripped: boolean) {
  const buildInfo = createBuildInfo(stripped, '3.2.0');
  return ok({
    jarPath: '/tmp/sample.jar',
    artifact: { groupId: 'dev.sample', artifactId: 'sample', version: '1.0.0', sha256: 'a' },
    stripped,
    productionDeployable: buildInfo.productionDeployable,
    buildInfo,
    deploymentInfo: {
      packageName: 'sample.jar',
      version: '1.0.0',
      buildDate: '2026-01-01T00:00:00.000Z',
      builtBy: 'sample',
      machine: 'sample',
      configChanges: [],
    },
  });
}

describe('runLocal', () => {
  beforeEach(() => vi.mocked(packageProject).mockReset());

  it('returns the build-info flags of a stripped local deployment', async () => {
    vi.mocked(packageProject).mockResolvedValue(packaged(true));
    const result = await runLocal({ cwd: '/tmp/sample', stripSecure: true });
    expect(packageProject).toHaveBeenCalledWith(expect.objectContaining({ stripSecure: true }));
    expect(result.data).toMatchObject({
      deployed: true,
      stripped: true,
      productionDeployable: false,
      buildInfo: { schemaVersion: 1, tool: 'mule-build', stripped: true },
    });
  });

  it('returns productionDeployable=true for a normal local deployment', async () => {
    vi.mocked(packageProject).mockResolvedValue(packaged(false));
    const result = await runLocal({ cwd: '/tmp/sample' });
    expect(result.data).toMatchObject({ stripped: false, productionDeployable: true });
  });
});
