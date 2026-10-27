/**
 * Build Info Marker
 *
 * Every JAR that mule-build packages carries META-INF/mule-build/build-info.json,
 * so a deployer can tell from the JAR alone whether secure properties were
 * stripped. The entry is appended to the Maven-built ZIP without rewriting the
 * existing entries, so their bytes, compression, and order are preserved.
 */

import { crc32 } from 'node:zlib';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import type { BuildInfo } from '../types/index.js';

export type { BuildInfo };

/** Path of the marker inside the packaged JAR. */
export const BUILD_INFO_PATH = 'META-INF/mule-build/build-info.json';

export function createBuildInfo(stripped: boolean, toolVersion: string): BuildInfo {
  return {
    schemaVersion: 1,
    tool: 'mule-build',
    toolVersion,
    stripped,
    productionDeployable: !stripped,
  };
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** DOS date for 1980-01-01, so the marker entry does not depend on the build clock. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_FLAG = 0x0800;

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (
      view.getUint32(offset, true) === EOCD_SIGNATURE &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      return offset;
    }
  }
  throw new Error('Built JAR is not a readable ZIP archive');
}

/**
 * Return a copy of `jar` with the build-info marker appended. Fails if the JAR
 * already has an entry at the marker path, since project resources must not be
 * able to supply or spoof it.
 */
export function addBuildInfo(jar: Uint8Array, info: BuildInfo): Uint8Array {
  const view = new DataView(jar.buffer, jar.byteOffset, jar.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR_SIGNATURE) {
    throw new Error('Built JAR uses ZIP64, which the build-info marker does not support');
  }
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    throw new Error('Built JAR is a multi-disk ZIP archive');
  }
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset + centralSize > eocd) throw new Error('Built JAR has a corrupt ZIP directory');

  const decoder = new TextDecoder();
  let cursor = centralOffset;
  for (let index = 0; index < entries; index++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Built JAR has a corrupt ZIP directory');
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = decoder.decode(jar.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === BUILD_INFO_PATH) {
      throw new Error(
        `${BUILD_INFO_PATH} is reserved for mule-build; remove it from the project resources`
      );
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  const name = strToU8(BUILD_INFO_PATH);
  const data = strToU8(`${JSON.stringify(info, null, 2)}\n`);
  const checksum = crc32(data);

  const local = new Uint8Array(30 + name.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, LOCAL_SIGNATURE, true);
  localView.setUint16(4, 10, true); // version needed: stored
  localView.setUint16(6, UTF8_FLAG, true);
  localView.setUint16(8, 0, true); // method: stored
  localView.setUint16(10, 0, true);
  localView.setUint16(12, DOS_DATE, true);
  localView.setUint32(14, checksum, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, name.length, true);
  localView.setUint16(28, 0, true);
  local.set(name, 30);

  const central = new Uint8Array(46 + name.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, CENTRAL_SIGNATURE, true);
  centralView.setUint16(4, 20, true); // version made by
  centralView.setUint16(6, 10, true);
  centralView.setUint16(8, UTF8_FLAG, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint16(12, 0, true);
  centralView.setUint16(14, DOS_DATE, true);
  centralView.setUint32(16, checksum, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, name.length, true);
  centralView.setUint32(42, centralOffset, true); // local header offset
  central.set(name, 46);

  const newCentralOffset = centralOffset + local.length + data.length;
  const newCentralSize = centralSize + central.length;
  if (entries + 1 >= 0xffff || newCentralOffset + newCentralSize >= 0xffffffff) {
    throw new Error('Built JAR is too large for the build-info marker without ZIP64');
  }

  // Copy explicitly: Buffer#slice returns a view of the input.
  const trailer = new Uint8Array(jar.subarray(eocd));
  const trailerView = new DataView(trailer.buffer, trailer.byteOffset, trailer.byteLength);
  trailerView.setUint16(8, entries + 1, true);
  trailerView.setUint16(10, entries + 1, true);
  trailerView.setUint32(12, newCentralSize, true);
  trailerView.setUint32(16, newCentralOffset, true);

  const parts = [
    jar.subarray(0, centralOffset),
    local,
    data,
    jar.subarray(centralOffset, centralOffset + centralSize),
    central,
    trailer,
  ];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Read the build-info marker, or undefined when the JAR has none or it is invalid. */
export function readBuildInfo(jar: Uint8Array): BuildInfo | undefined {
  const entries = unzipSync(jar, {
    filter: (entry) => entry.name === BUILD_INFO_PATH && entry.originalSize <= 65536,
  });
  const content = entries[BUILD_INFO_PATH];
  if (!content) return undefined;
  try {
    const value = JSON.parse(strFromU8(content)) as Partial<BuildInfo>;
    if (
      value.schemaVersion !== 1 ||
      value.tool !== 'mule-build' ||
      typeof value.toolVersion !== 'string' ||
      typeof value.stripped !== 'boolean' ||
      value.productionDeployable !== !value.stripped
    ) {
      return undefined;
    }
    return value as BuildInfo;
  } catch {
    return undefined;
  }
}
