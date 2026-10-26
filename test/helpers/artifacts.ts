import { strToU8, zipSync } from 'fflate';

/** Build a minimal class file with an optional @JavaVersionSupport annotation. */
export function classFile(majorVersion: number, javaVersions?: string[]): Uint8Array {
  const pool: string[] = [];
  const utf8 = (value: string) => {
    pool.push(value);
    return pool.length; // constant pool indexes start at 1
  };
  const bytes: number[] = [];
  const u1 = (value: number) => bytes.push(value & 0xff);
  const u2 = (value: number) => {
    u1(value >> 8);
    u1(value);
  };
  const u4 = (value: number) => {
    u2(value >>> 16);
    u2(value);
  };

  const body: number[] = [];
  const b1 = (value: number) => body.push(value & 0xff);
  const b2 = (value: number) => {
    b1(value >> 8);
    b1(value);
  };
  // access flags, this_class, super_class, interfaces, fields, methods
  b2(0x21);
  b2(0);
  b2(0);
  b2(0);
  b2(0);
  b2(0);
  if (javaVersions) {
    const annotation: number[] = [];
    const a1 = (value: number) => annotation.push(value & 0xff);
    const a2 = (value: number) => {
      a1(value >> 8);
      a1(value);
    };
    a2(1);
    a2(utf8('Lorg/mule/sdk/api/annotation/JavaVersionSupport;'));
    a2(1);
    a2(utf8('value'));
    a1('['.charCodeAt(0));
    a2(javaVersions.length);
    const enumType = utf8('Lorg/mule/sdk/api/meta/JavaVersion;');
    for (const version of javaVersions) {
      a1('e'.charCodeAt(0));
      a2(enumType);
      a2(utf8(`JAVA_${version}`));
    }
    b2(1);
    b2(utf8('RuntimeVisibleAnnotations'));
    b2(annotation.length >>> 16);
    b2(annotation.length);
    body.push(...annotation);
  } else {
    b2(0);
  }

  u4(0xcafebabe);
  u2(0);
  u2(majorVersion);
  u2(pool.length + 1);
  for (const value of pool) {
    u1(1);
    const encoded = strToU8(value);
    u2(encoded.length);
    bytes.push(...encoded);
  }
  bytes.push(...body);
  return new Uint8Array(bytes);
}

const EXTENSION_TYPE = 'dev.sample.connector.internal.SampleConnector';

/** Build a mule-plugin JAR with the given descriptor facts. */
export function pluginJar(options: {
  minMuleVersion?: string;
  majorVersion?: number;
  javaVersions?: string[];
}): Uint8Array {
  const descriptor = {
    extensionModelLoaderDescriptor: { id: 'java', attributes: { type: EXTENSION_TYPE } },
    name: 'Sample',
    ...(options.minMuleVersion ? { minMuleVersion: options.minMuleVersion } : {}),
  };
  return zipSync({
    'META-INF/mule-artifact/mule-artifact.json': strToU8(JSON.stringify(descriptor)),
    [`${EXTENSION_TYPE.replace(/\./g, '/')}.class`]: classFile(
      options.majorVersion ?? 52,
      options.javaVersions
    ),
  });
}

/** Build a packaged application JAR bundling the given plugins. */
export function applicationJar(
  descriptor: Record<string, unknown>,
  plugins: { groupId: string; artifactId: string; version: string; jar: Uint8Array }[]
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'META-INF/mule-artifact/mule-artifact.json': strToU8(JSON.stringify(descriptor)),
  };
  for (const plugin of plugins) {
    const path = `repository/${plugin.groupId.split('.').join('/')}/${plugin.artifactId}/${plugin.version}`;
    entries[`${path}/${plugin.artifactId}-${plugin.version}-mule-plugin.jar`] = plugin.jar;
  }
  return zipSync(entries);
}
