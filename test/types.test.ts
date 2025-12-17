import { describe, it, expect } from 'vitest';
import { ok, err } from '../src/types/index.js';

describe('Result Types', () => {
  describe('ok', () => {
    it('should create a successful result', () => {
      const result = ok('test data');

      expect(result.success).toBe(true);
      expect(result.data).toBe('test data');
      expect(result.error).toBeUndefined();
    });

    it('should work with complex types', () => {
      const data = { foo: 'bar', count: 42 };
      const result = ok(data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });
  });

  describe('err', () => {
    it('should create a failed result', () => {
      const error = new Error('Something went wrong');
      const result = err(error);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.data).toBeUndefined();
    });

    it('should work with custom error types', () => {
      const customError = { code: 'E001', message: 'Custom error' };
      const result = err(customError);

      expect(result.success).toBe(false);
      expect(result.error).toEqual(customError);
    });
  });
});
