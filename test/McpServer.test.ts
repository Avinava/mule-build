import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MuleBuildMcpServer } from '../src/mcp/index.js';

describe('Mule Build MCP protocol', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;

  beforeEach(async () => {
    const server = new MuleBuildMcpServer();
    const pair = InMemoryTransport.createLinkedPair();
    clientTransport = pair[0];
    client = new Client({ name: 'mule-build-test', version: '1.0.0' });
    await server.connect(pair[1]);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  it('negotiates and lists the complete stable tool contract', async () => {
    const response = await client.listTools();
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'check_runtime_status',
        'enforce_security',
        'get_project_config',
        'release_version',
        'run_app',
        'run_build',
        'stop_runtime',
        'strip_secure',
        'system_check',
      ].sort()
    );
    for (const tool of response.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  it('returns structured content from a real tool call', async () => {
    const response = await client.callTool({
      name: 'get_project_config',
      arguments: { cwd: process.cwd() },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      success: true,
      message: 'Project configuration loaded',
    });
  });

  it('lists and reads every packaged documentation resource', async () => {
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri).sort()).toEqual(
      [
        'mule-build://docs/best-practices',
        'mule-build://docs/design',
        'mule-build://docs/folder-structure',
      ].sort()
    );
    for (const resource of resources.resources) {
      const response = await client.readResource({ uri: resource.uri });
      expect(response.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
      expect('text' in response.contents[0] && response.contents[0].text.length).toBeGreaterThan(
        20
      );
    }
  });

  it('exposes guided prompts', async () => {
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual(
      ['quick-start', 'release-checklist', 'security-audit'].sort()
    );
  });
});
