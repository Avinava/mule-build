/**
 * Maven version ordering
 *
 * A port of Maven's ComparableVersion, so versions are ordered the way Maven,
 * the Mule Maven plugin, and Exchange order them. Unlike semantic versioning,
 * an unknown qualifier sorts after its release (1.4.2 < 1.4.2-hotfix.1), while
 * alpha, beta, milestone, rc, and SNAPSHOT sort before it.
 */

type Item = IntItem | StringItem | ListItem;

const QUALIFIERS = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const ALIASES: Record<string, string> = { ga: '', final: '', release: '', cr: 'rc' };
const RELEASE_INDEX = String(QUALIFIERS.indexOf(''));

class IntItem {
  constructor(readonly value: bigint) {}
  isNull(): boolean {
    return this.value === 0n;
  }
  compare(other: Item | undefined): number {
    if (other === undefined) return this.value === 0n ? 0 : 1;
    if (other instanceof IntItem)
      return this.value === other.value ? 0 : this.value < other.value ? -1 : 1;
    return 1; // a number is newer than a qualifier or a sublist
  }
}

function comparableQualifier(value: string): string {
  const index = QUALIFIERS.indexOf(value);
  return index === -1 ? `${QUALIFIERS.length}-${value}` : String(index);
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

class StringItem {
  readonly value: string;
  constructor(value: string, followedByDigit: boolean) {
    let normalized = value;
    if (followedByDigit && value.length === 1) {
      normalized =
        value === 'a' ? 'alpha' : value === 'b' ? 'beta' : value === 'm' ? 'milestone' : value;
    }
    this.value = ALIASES[normalized] ?? normalized;
  }
  isNull(): boolean {
    return comparableQualifier(this.value) === RELEASE_INDEX;
  }
  compare(other: Item | undefined): number {
    if (other === undefined) return compareStrings(comparableQualifier(this.value), RELEASE_INDEX);
    if (other instanceof IntItem) return -1;
    if (other instanceof StringItem) {
      return compareStrings(comparableQualifier(this.value), comparableQualifier(other.value));
    }
    return -1;
  }
}

class ListItem {
  readonly items: Item[] = [];
  isNull(): boolean {
    return this.items.length === 0;
  }
  normalize(): void {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item.isNull()) this.items.splice(index, 1);
      else if (!(item instanceof ListItem)) break;
    }
  }
  compare(other: Item | undefined): number {
    if (other === undefined) return this.items.length === 0 ? 0 : this.items[0].compare(undefined);
    if (other instanceof IntItem) return -1;
    if (other instanceof StringItem) return 1;
    const length = Math.max(this.items.length, other.items.length);
    for (let index = 0; index < length; index++) {
      const left = this.items[index];
      const right = other.items[index];
      const result =
        left === undefined
          ? right === undefined
            ? 0
            : -right.compare(undefined)
          : left.compare(right);
      if (result !== 0) return result;
    }
    return 0;
  }
}

function parseItem(isDigit: boolean, text: string, followedByDigit = false): Item {
  return isDigit ? new IntItem(BigInt(text)) : new StringItem(text, followedByDigit);
}

function parse(version: string): ListItem {
  const value = version.toLowerCase();
  const root = new ListItem();
  let list = root;
  const stack: ListItem[] = [root];
  let isDigit = false;
  let start = 0;
  const open = () => {
    const sublist = new ListItem();
    list.items.push(sublist);
    list = sublist;
    stack.push(sublist);
  };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '.' || char === '-') {
      list.items.push(
        index === start ? new IntItem(0n) : parseItem(isDigit, value.slice(start, index))
      );
      start = index + 1;
      if (char === '-') open();
    } else if (char >= '0' && char <= '9') {
      if (!isDigit && index > start) {
        list.items.push(new StringItem(value.slice(start, index), true));
        start = index;
        open();
      }
      isDigit = true;
    } else {
      if (isDigit && index > start) {
        list.items.push(parseItem(true, value.slice(start, index)));
        start = index;
        open();
      }
      isDigit = false;
    }
  }
  if (value.length > start) list.items.push(parseItem(isDigit, value.slice(start)));
  while (stack.length > 0) stack.pop()!.normalize();
  return root;
}

/** Compare two versions with Maven ordering: negative, zero, or positive. */
export function compareMavenVersions(left: string, right: string): number {
  return parse(left).compare(parse(right));
}
