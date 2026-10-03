import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

export interface ArtifactCoordinates {
  groupId: string;
  artifactId: string;
  version: string;
}

/** Read embedded Maven identity without extracting files or trusting the JAR filename. */
export function inspectArtifact(
  bytes: Uint8Array,
  expectedArtifactId?: string
): {
  sha256: string;
  coordinates?: ArtifactCoordinates;
} {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const metadataPaths = new Set<string>();
  let metadataSize = 0;
  const entries = unzipSync(bytes, {
    filter(entry) {
      if (!/^META-INF\/maven\/[^/]+\/[^/]+\/pom\.properties$/.test(entry.name)) return false;
      if (metadataPaths.has(entry.name)) throw new Error('Artifact has duplicate Maven metadata');
      metadataPaths.add(entry.name);
      metadataSize += entry.originalSize;
      if (entry.originalSize > 65536 || metadataSize > 1048576)
        throw new Error('Artifact metadata exceeds the supported size');
      return true;
    },
  });
  const candidates: ArtifactCoordinates[] = [];
  for (const [name, content] of Object.entries(entries)) {
    const properties = Object.fromEntries(
      strFromU8(content)
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = /^\s*(groupId|artifactId|version)\s*[=:]\s*([^\s]+)\s*$/.exec(line);
          return match ? [[match[1], match[2]]] : [];
        })
    );
    const { groupId, artifactId, version } = properties;
    if (
      !groupId ||
      !artifactId ||
      !version ||
      [groupId, artifactId, version].some((value) => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value))
    ) {
      throw new Error('Artifact has missing, unresolved, or invalid Maven coordinates');
    }
    if (name !== `META-INF/maven/${groupId}/${artifactId}/pom.properties`) {
      throw new Error('Artifact metadata path does not match its Maven coordinates');
    }
    if (!expectedArtifactId || artifactId === expectedArtifactId)
      candidates.push({ groupId, artifactId, version });
  }
  if (candidates.length > 1) throw new Error('Artifact has ambiguous Maven coordinates');
  return { sha256, coordinates: candidates[0] };
}
