/**
 * Class File Reader
 *
 * Reads the parts of a JVM class file that compatibility checks need: the
 * class-file major version and the enum values of runtime-visible class
 * annotations. Parses the constant pool and attribute tables; no string matching.
 */

export interface ClassFileInfo {
  majorVersion: number;
  /** Lowest Java feature version that can load this class (major 52 = Java 8). */
  javaFeatureVersion: number;
  /** Class annotations by descriptor, each with its element values flattened to strings. */
  annotations: Map<string, Record<string, string[]>>;
}

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  u1(): number {
    if (this.offset + 1 > this.bytes.length) throw new Error('Truncated class file');
    return this.bytes[this.offset++];
  }
  u2(): number {
    return (this.u1() << 8) | this.u1();
  }
  u4(): number {
    return ((this.u2() << 16) | this.u2()) >>> 0;
  }
  skip(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error('Truncated class file');
    this.offset += length;
  }
  slice(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('Truncated class file');
    const view = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return view;
  }
}

/** Decode the JVM's modified UTF-8 (sufficient for identifiers and descriptors). */
function decodeModifiedUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0)
      out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else {
      const b = bytes[i++];
      const c = bytes[i++];
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    }
  }
  return out;
}

type Utf8Pool = (string | undefined)[];

function readConstantPool(reader: Reader): Utf8Pool {
  const count = reader.u2();
  const pool: Utf8Pool = new Array(count);
  for (let index = 1; index < count; index++) {
    const tag = reader.u1();
    switch (tag) {
      case 1: // Utf8
        pool[index] = decodeModifiedUtf8(reader.slice(reader.u2()));
        break;
      case 3: // Integer
      case 4: // Float
      case 9: // Fieldref
      case 10: // Methodref
      case 11: // InterfaceMethodref
      case 12: // NameAndType
      case 17: // Dynamic
      case 18: // InvokeDynamic
        reader.skip(4);
        break;
      case 5: // Long
      case 6: // Double
        reader.skip(8);
        index++; // eight-byte constants take two slots
        break;
      case 7: // Class
      case 8: // String
      case 16: // MethodType
      case 19: // Module
      case 20: // Package
        reader.skip(2);
        break;
      case 15: // MethodHandle
        reader.skip(3);
        break;
      default:
        throw new Error(`Unsupported constant pool tag ${tag}`);
    }
  }
  return pool;
}

function skipAttributes(reader: Reader): void {
  const count = reader.u2();
  for (let i = 0; i < count; i++) {
    reader.u2();
    reader.skip(reader.u4());
  }
}

function readElementValue(reader: Reader, pool: Utf8Pool): string[] {
  const tag = String.fromCharCode(reader.u1());
  switch (tag) {
    case 'e': {
      reader.u2(); // enum type descriptor
      return [pool[reader.u2()] ?? ''];
    }
    case 's':
      return [pool[reader.u2()] ?? ''];
    case 'c':
      return [pool[reader.u2()] ?? ''];
    case '@':
      readAnnotation(reader, pool);
      return [];
    case '[': {
      const values: string[] = [];
      const count = reader.u2();
      for (let i = 0; i < count; i++) values.push(...readElementValue(reader, pool));
      return values;
    }
    default: // primitive constants: B C D F I J S Z
      reader.u2();
      return [];
  }
}

function readAnnotation(reader: Reader, pool: Utf8Pool): [string, Record<string, string[]>] {
  const type = pool[reader.u2()] ?? '';
  const elements: Record<string, string[]> = {};
  const pairs = reader.u2();
  for (let i = 0; i < pairs; i++) {
    const name = pool[reader.u2()] ?? '';
    elements[name] = readElementValue(reader, pool);
  }
  return [type, elements];
}

/** Parse a class file. Throws on malformed input. */
export function readClassFile(bytes: Uint8Array): ClassFileInfo {
  const reader = new Reader(bytes);
  if (reader.u4() !== 0xcafebabe) throw new Error('Not a class file');
  reader.u2(); // minor
  const majorVersion = reader.u2();
  const pool = readConstantPool(reader);
  reader.skip(6); // access flags, this class, super class
  reader.skip(reader.u2() * 2); // interfaces
  for (let table = 0; table < 2; table++) {
    // fields, then methods
    const count = reader.u2();
    for (let i = 0; i < count; i++) {
      reader.skip(6);
      skipAttributes(reader);
    }
  }

  const annotations = new Map<string, Record<string, string[]>>();
  const attributeCount = reader.u2();
  for (let i = 0; i < attributeCount; i++) {
    const name = pool[reader.u2()];
    const length = reader.u4();
    if (name !== 'RuntimeVisibleAnnotations' && name !== 'RuntimeInvisibleAnnotations') {
      reader.skip(length);
      continue;
    }
    const end = reader.offset + length;
    const count = reader.u2();
    for (let j = 0; j < count; j++) {
      const [type, elements] = readAnnotation(reader, pool);
      annotations.set(type, elements);
    }
    reader.offset = end;
  }

  return { majorVersion, javaFeatureVersion: majorVersion - 44, annotations };
}
