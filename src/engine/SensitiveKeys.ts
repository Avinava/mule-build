/**
 * Sensitive Keys
 *
 * Classifies configuration keys and XML attribute names that hold secrets, and
 * values that are resolved at runtime rather than written as literals.
 *
 * The classification mirrors @sfdxy/mule-lint (src/core/SensitiveKeys.ts) so both
 * tools agree on what a secret is. test/fixtures/sensitive-key-vectors.json holds
 * the shared cases; update it whenever either list changes.
 */

/**
 * Key-name endings that indicate a secret. Matching is anchored to the final
 * dot-separated segment, so `sample.password` matches and `password.policy.url`
 * does not.
 */
const SECRET_KEY_ENDINGS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'tokenid',
  'tokenkey',
  'apikey',
  'api-key',
  'api_key',
  'accesskey',
  'access-key',
  'access_key',
  'privatekey',
  'private-key',
  'private_key',
  'credential',
  'credentials',
  'consumerkey',
  'consumer-key',
  'consumer_key',
];

/**
 * Values resolved at runtime: `${...}` placeholders (including secure::),
 * `#[...]` DataWeave expressions, and `![...]` encrypted secure-property values.
 */
const PLACEHOLDER_PATTERNS = [/\$\{[^}]*\}/, /#\[[\s\S]*\]/, /^!\[[\s\S]*\]$/];

/** XML attributes that are secrets only on a specific element. */
const ELEMENT_SECRET_ATTRIBUTES: Record<string, string[]> = {
  'secure-properties:config': ['key'],
};

function lastSegment(key: string): string {
  return (key.toLowerCase().split('.').at(-1) ?? '').trim();
}

/** Whether a dot-separated key name implies that it holds a secret. */
export function isSensitiveKey(key: string, additionalEndings: string[] = []): boolean {
  const segment = lastSegment(key);
  if (!segment) return false;
  const endings = [...SECRET_KEY_ENDINGS, ...additionalEndings.map((e) => e.toLowerCase())];
  return endings.some((ending) => segment === ending || segment.endsWith(ending));
}

/** Whether an XML attribute on the given element holds a secret. */
export function isSensitiveAttribute(
  elementName: string,
  attributeName: string,
  additionalEndings: string[] = []
): boolean {
  if (attributeName.includes(':')) return false; // namespaced metadata such as doc:name
  if (ELEMENT_SECRET_ATTRIBUTES[elementName]?.includes(attributeName)) return true;
  return isSensitiveKey(attributeName, additionalEndings);
}

/** Whether a value resolves at runtime instead of being a literal. */
export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/** Whether a value is a secure-properties encrypted literal (`![...]`). */
export function isEncryptedValue(value: string): boolean {
  return /^!\[[\s\S]*\]$/.test(value.trim());
}

/** Whether a key/value pair from a configuration file is a plaintext secret. */
export function isPlaintextSecret(
  key: string,
  value: unknown,
  additionalEndings: string[] = []
): boolean {
  if (!isSensitiveKey(key, additionalEndings)) return false;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value).trim();
  return text.length > 0 && !isPlaceholderValue(text);
}

/**
 * Whether an XML attribute value is a hardcoded literal. Booleans and numbers are
 * treated as flags (for example `useToken="true"`), matching mule-lint.
 */
export function isLiteralAttributeValue(value: string): boolean {
  const text = value.trim();
  if (!text || text === 'true' || text === 'false' || !Number.isNaN(Number(text))) return false;
  return !isPlaceholderValue(text);
}

/** Describe a secret without revealing it. */
export function redact(value: string): string {
  return `<redacted, ${value.length} chars>`;
}

/** The default endings, exposed for documentation and parity tests. */
export function getSecretKeyEndings(): readonly string[] {
  return SECRET_KEY_ENDINGS;
}
