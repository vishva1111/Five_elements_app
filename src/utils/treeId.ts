import { TreeRecord } from '../types';

// ─── Project tree ID helpers ───────────────────────────────────────────────────
// Every tree is identified in the UI by its project-scoped ID (e.g. "ARAV-001").
// These helpers are the single source of truth for:
//   • reading the ID (tree_id column, with the legacy ##META## notes fallback)
//   • building the next sequential ID for a project
// The database `id` (uuid) is never shown to the user.

// Records saved before the tree_id column existed keep their extra fields as a
// ##META## JSON blob inside notes.
export const TREE_META_PATTERN = /##META##({.*})/s;

export function parseTreeMeta(notes?: string | null): Record<string, any> {
  const match = (notes || '').match(TREE_META_PATTERN);
  if (!match) return {};
  try {
    return JSON.parse(match[1]) ?? {};
  } catch {
    return {};
  }
}

export function stripTreeMeta(notes?: string | null): string {
  return (notes || '').replace(/##META##{.*}/s, '').trim();
}

export function treeIdFromMeta(notes?: string | null): string {
  const value = parseTreeMeta(notes)?.tree_id;
  return typeof value === 'string' ? value.trim() : '';
}

// ─── Prefix / sequential ID ───────────────────────────────────────────────────
// ARAV-001, BERA-002, ... Prefix = first 4 uppercase letters of the project name
export function makeProjectPrefix(projectName?: string | null): string {
  const clean = (projectName || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  return clean.slice(0, 4).padEnd(4, 'X');
}

export function buildProjectTreeId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

// Highest numeric suffix already used by these trees → next free number.
// Only properly formatted "PREFIX-001" ids are counted, so legacy uuids
// ("9b831168...") can never push the sequence into the thousands.
// Using the max (instead of a row count) avoids handing out an ID twice when
// trees were deleted or when some rows never received an ID.
export function nextProjectSequence(
  trees?: Array<{ tree_id?: string | null } | null> | null,
  prefix?: string | null
): number {
  const wanted = (prefix || '').trim().toUpperCase();
  let max = 0;
  (trees ?? []).forEach((tree) => {
    const id = typeof tree?.tree_id === 'string' ? tree.tree_id.trim() : '';
    const match = id.match(/^([A-Za-z]{2,8})-(\d+)$/);
    if (!match) return;
    if (wanted && match[1].toUpperCase() !== wanted) return;
    const n = parseInt(match[2], 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

// ─── Resolve the ID used by the UI ────────────────────────────────────────────
// 1. tree_id column  2. ##META## notes (legacy)  3. '' (nothing assigned yet)
export function resolveTreeId(
  tree?: (Pick<TreeRecord, 'tree_id'> & { notes?: string | null }) | null
): string {
  if (!tree) return '';
  const direct = typeof tree.tree_id === 'string' ? tree.tree_id.trim() : '';
  if (direct) return direct;
  return treeIdFromMeta(tree.notes);
}

export const TREE_ID_PLACEHOLDER = '—';

export function displayTreeId(
  tree?: (Pick<TreeRecord, 'tree_id'> & { notes?: string | null }) | null,
  fallback: string = TREE_ID_PLACEHOLDER
): string {
  return resolveTreeId(tree) || fallback;
}

/** First 8 characters of a record id — the code shown beside the tree name. */
export function shortRecordCode(id?: string | null): string {
  const raw = String(id ?? '').trim();
  if (!raw || isAutoTreeId(raw)) return '';
  const hex = raw.replace(/[^A-Fa-f0-9]/g, '');
  if (hex.length !== 8 && hex.length !== 32) return '';
  return hex.slice(0, 8).toUpperCase();
}

/** Old generated ids such as TREE-1443 are not shown to the user. */
export function isAutoTreeId(id?: string | null): boolean {
  return /^TREE-\d+$/i.test(String(id ?? '').trim());
}

/**
 * "Saag (TREE-A38IN14)" → { name: "Saag", code: "TREE-A38IN14" }.
 * The code may contain a hyphen. A word in parentheses that is not an id stays in the name.
 */
export function splitLabeledTreeName(value?: string | null): { name: string; code: string } {
  const raw = String(value ?? '').trim();
  const match = raw.match(/\(([A-Za-z][A-Za-z0-9-]{0,40})\)\s*$/);
  const token = match?.[1]?.toUpperCase() ?? '';
  const code =
    token.includes('-') || /^[A-F0-9]{8}$/.test(token) || /^[A-Z]{2,8}-?\d+$/.test(token)
      ? token
      : '';
  if (!code || match?.index == null) return { name: raw, code: '' };
  const withoutCode = raw.slice(0, match.index).trim();
  const name = withoutCode.split(/\s+[—–-]\s+/).pop()?.trim() || withoutCode;
  return { name, code };
}

/**
 * ID for the card, capture page, and edit page.
 * A stored TREE-#### value is replaced by the code beside the tree name.
 */
export function uiTreeId(
  tree?: { id?: string | null; tree_id?: string | null; notes?: string | null } | null,
  fallback: string = TREE_ID_PLACEHOLDER
): string {
  const stored = resolveTreeId(tree);
  if (stored && !isAutoTreeId(stored)) return stored;
  return shortRecordCode(tree?.id) || fallback;
}

/** Create the record id and the 8-character code shown as the tree ID. */
export function createTreeIdentity(): { id: string; code: string } {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { id, code: hex.slice(0, 8).toUpperCase() };
}

// ─── Loose (fuzzy) matching ───────────────────────────────────────────────────
// Stored IDs may differ from the canonical form by spacing, separators or zero
// padding ("AHM E-028", "AHME 028", "AHME-28"), and older rows may keep the
// ID only inside ##META## notes. Strip everything that is not a letter or
// digit before comparing so every variant parses to the same prefix + number.
export function parseTreeIdLoose(
  id?: string | null
): { prefix: string; num: number } | null {
  if (!id) return null;
  const compact = String(id).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const match = compact.match(/^([A-Z]*)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1] ?? '', num: parseInt(match[2], 10) };
}

// Find a tree by prefix + number among candidates, tolerating any formatting of
// the stored ID (or an ID that only exists in ##META## notes). Same-prefix
// matches win; a different prefix (e.g. TREE-9078 while the project prefix is
// AHME) matches on the number alone as a fallback so every listed tree stays
// searchable.
export function findTreeByLooseId(
  trees: TreeRecord[] | null | undefined,
  searchPrefix: string,
  searchNumber: string | number
): TreeRecord | null {
  const wantPrefix = (searchPrefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = String(searchNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const wantNum = parseInt(digits, 10);

  let otherPrefix: TreeRecord | null = null;
  for (const tree of trees ?? []) {
    const parsed = parseTreeIdLoose(resolveTreeId(tree));
    if (!parsed || parsed.num !== wantNum) continue;
    if (parsed.prefix === wantPrefix) return tree;
    if (!otherPrefix) otherPrefix = tree;
  }
  return otherPrefix;
}
