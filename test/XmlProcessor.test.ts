import { describe, it, expect } from 'vitest';
import { stripSecureFromContent, findUnsecuredProperties } from '../src/engine/XmlProcessor.js';

describe('XmlProcessor', () => {
  describe('stripSecureFromContent', () => {
    it('should strip ${secure::prop} format', () => {
      const input = 'password="${secure::db.password}"';
      const { result, count } = stripSecureFromContent(input);

      expect(result).toBe('password="${db.password}"');
      expect(count).toBe(1);
    });

    it('should strip multiple secure properties', () => {
      const input = `
        user="\${secure::db.user}"
        password="\${secure::db.password}"
        token="\${secure::api.token}"
      `;
      const { result, count } = stripSecureFromContent(input);

      expect(result).toContain('${db.user}');
      expect(result).toContain('${db.password}');
      expect(result).toContain('${api.token}');
      expect(result).not.toContain('secure::');
      expect(count).toBe(3);
    });

    it("should strip Mule::p('secure::prop') DataWeave format", () => {
      const input = "apiKey: Mule::p('secure::api.key')";
      const { result, count } = stripSecureFromContent(input);

      expect(result).toBe("apiKey: Mule::p('api.key')");
      expect(count).toBe(1);
    });

    it('should handle mixed formats', () => {
      const input = `
        password="\${secure::db.password}"
        secret: Mule::p('secure::api.secret')
      `;
      const { result, count } = stripSecureFromContent(input);

      expect(result).toContain('${db.password}');
      expect(result).toContain("Mule::p('api.secret')");
      expect(count).toBe(2);
    });

    it('should not modify content without secure:: prefix', () => {
      const input = 'host="${db.host}" port="${db.port}"';
      const { result, count } = stripSecureFromContent(input);

      expect(result).toBe(input);
      expect(count).toBe(0);
    });

    it('should preserve XML structure and whitespace', () => {
      const input = `<?xml version="1.0"?>
<config>
    <!-- Comment -->
    <property value="\${secure::password}"/>
</config>`;

      const { result } = stripSecureFromContent(input);

      expect(result).toContain('<?xml version="1.0"?>');
      expect(result).toContain('<!-- Comment -->');
      expect(result).toContain('<property value="${password}"/>');
    });
  });

  describe('findUnsecuredProperties', () => {
    it('should find unsecured sensitive properties', () => {
      const content = `
        <config>
          <property value="\${db.password}"/>
          <property value="\${api.secret}"/>
          <property value="\${safe.prop}"/>
        </config>
      `;

      const violations = findUnsecuredProperties(content);

      expect(violations).toHaveLength(2);
      expect(violations[0].property).toBe('db.password');
      expect(violations[1].property).toBe('api.secret');
    });

    it('should not flag already secured properties', () => {
      const content = `
        <config>
          <property value="\${secure::db.password}"/>
          <property value="\${secure::api.secret}"/>
        </config>
      `;

      const violations = findUnsecuredProperties(content);

      expect(violations).toHaveLength(0);
    });

    it('should find unsecured DataWeave properties', () => {
      const content = `
        {
          password: Mule::p('db.password'),
          host: Mule::p('db.host')
        }
      `;

      const violations = findUnsecuredProperties(content);

      expect(violations).toHaveLength(1);
      expect(violations[0].property).toBe('db.password');
    });

    it('should use custom sensitive patterns', () => {
      const content = `
        <config>
          <property value="\${custom.credential}"/>
          <property value="\${my.apikey}"/>
        </config>
      `;

      const violations = findUnsecuredProperties(content, ['credential', 'apikey']);

      expect(violations).toHaveLength(2);
    });

    it('should report correct line numbers', () => {
      const content = `line1
line2
password="\${db.password}"
line4`;

      const violations = findUnsecuredProperties(content);

      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(3);
    });
  });
});
