import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getXmlFiles,
  stripSecureFromContent,
  removeSecurePropertiesConfig,
} from '../src/engine/XmlProcessor.js';

// Test fixtures directory
const TEST_DIR = join(tmpdir(), 'mule-build-test-' + Date.now());

describe('XmlProcessor Backup/Restore', () => {
  beforeEach(() => {
    // Create test directory structure
    mkdirSync(join(TEST_DIR, 'src', 'main', 'mule'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'src', 'main', 'mule', 'impl'), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('getXmlFiles', () => {
    it('should find XML files recursively', () => {
      // Create test files
      writeFileSync(join(TEST_DIR, 'src', 'main', 'mule', 'global.xml'), '<mule/>');
      writeFileSync(join(TEST_DIR, 'src', 'main', 'mule', 'impl', 'flow.xml'), '<mule/>');
      writeFileSync(join(TEST_DIR, 'src', 'main', 'mule', 'readme.txt'), 'not xml');

      const files = getXmlFiles(join(TEST_DIR, 'src', 'main', 'mule'));

      expect(files.length).toBe(2);
      expect(files.some((f) => f.endsWith('global.xml'))).toBe(true);
      expect(files.some((f) => f.endsWith('flow.xml'))).toBe(true);
    });

    it('should return empty array for non-existent directory', () => {
      const files = getXmlFiles(join(TEST_DIR, 'nonexistent'));

      expect(files).toEqual([]);
    });
  });

  describe('stripSecureFromContent', () => {
    it('should strip ${secure::prop} format', () => {
      const content = 'password="${secure::db.password}"';
      const { result, count } = stripSecureFromContent(content);

      expect(result).toBe('password="${db.password}"');
      expect(count).toBe(1);
    });

    it("should strip Mule::p('secure::prop') format", () => {
      const content = "Mule::p('secure::api.key')";
      const { result, count } = stripSecureFromContent(content);

      expect(result).toBe("Mule::p('api.key')");
      expect(count).toBe(1);
    });

    it('should handle multiple occurrences', () => {
      const content = `
        consumerKey="\${secure::netsuite.consumerKey}"
        consumerSecret="\${secure::netsuite.consumerSecret}"
        tokenId="\${secure::netsuite.tokenId}"
      `;
      const { result, count } = stripSecureFromContent(content);

      expect(count).toBe(3);
      expect(result).not.toContain('secure::');
    });

    it('should preserve non-secure properties', () => {
      const content = 'host="${http.host}" port="${secure::http.port}"';
      const { result } = stripSecureFromContent(content);

      expect(result).toBe('host="${http.host}" port="${http.port}"');
    });
  });

  describe('removeSecurePropertiesConfig', () => {
    it('should remove secure-properties:config block', () => {
      const content = `
        <configuration-properties file="config.yaml" />
        <secure-properties:config name="secure-config" file="secure.yaml" key="\${key}">
          <secure-properties:encrypt algorithm="Blowfish"/>
        </secure-properties:config>
        <http:listener-config name="http-config" />
      `;
      const result = removeSecurePropertiesConfig(content);

      expect(result).not.toContain('secure-properties:config');
      expect(result).toContain('configuration-properties');
      expect(result).toContain('http:listener-config');
    });

    it('should handle content without secure-properties:config', () => {
      const content = '<mule><flow name="test"/></mule>';
      const result = removeSecurePropertiesConfig(content);

      expect(result).toBe(content);
    });
  });
});
