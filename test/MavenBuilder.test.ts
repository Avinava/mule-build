import { describe, it, expect } from 'vitest';
import { generateMavenArgs, getMavenArgsForEnvironment } from '../src/engine/MavenBuilder.js';

describe('MavenBuilder', () => {
  describe('generateMavenArgs', () => {
    it('should generate basic build args', () => {
      const args = generateMavenArgs({});

      expect(args).toContain('clean');
      expect(args).toContain('package');
      expect(args).toContain('-B');
    });

    it('should add profile when specified', () => {
      const args = generateMavenArgs({ profile: 'dev' });

      expect(args).toContain('-Pdev');
    });

    it('should add withSource flag', () => {
      const args = generateMavenArgs({ withSource: true });

      expect(args).toContain('-DattachMuleSources');
    });

    it('should add skipTests flag', () => {
      const args = generateMavenArgs({ skipTests: true });

      expect(args).toContain('-DskipMunitTests');
    });

    it('should add lightweight flag', () => {
      const args = generateMavenArgs({ lightweight: true });

      expect(args).toContain('-DlightweightPackage');
    });

    it('should add quiet flag', () => {
      const args = generateMavenArgs({ quiet: true });

      expect(args).toContain('-q');
    });

    it('should combine multiple options', () => {
      const args = generateMavenArgs({
        profile: 'prod',
        withSource: false,
        skipTests: true,
        quiet: true,
      });

      expect(args).toContain('-Pprod');
      expect(args).toContain('-DskipMunitTests');
      expect(args).toContain('-q');
      expect(args).not.toContain('-DattachMuleSources');
    });
  });

  describe('getMavenArgsForEnvironment', () => {
    it('should use prod profile for production', () => {
      const args = getMavenArgsForEnvironment('production');

      expect(args).toContain('-Pprod');
    });

    it('should allow profile override', () => {
      const args = getMavenArgsForEnvironment('production', { profile: 'custom' });

      expect(args).toContain('-Pcustom');
    });
  });
});
