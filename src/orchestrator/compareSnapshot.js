// Parallel-build-and-compare, build order items 2-3 (PLAN_PARALLEL_BUILD.md §4): a dispatch-time
// manifest of every file in a builder's workdir - path, mtime, sha256 - written before a
// multi-seat task starts so "changed since dispatch" and every diff can be computed by walking
// the current workdir and comparing against this manifest, never against a git commit
// (PLAN_PARALLEL_BUILD.md A1: builder workdirs aren't git repositories).
//
// Extended beyond item 2's original hash-only manifest (logged deviation, see DECISIONS.md): a
// hash alone can prove a file changed but can't show *what* changed - there's no "before" text
// to diff against. `.compare-snapshot.json` (the index: path/mtime/sha256, used for cheap
// changed/unchanged checks) is now paired with `.compare-snapshot/` (a directory holding a real
// copy of every tracked file's dispatch-time content, mirroring the workdir's own relative
// paths) - the actual diff baseline item 3's UI reads from.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { structuredPatch } from 'diff';

const SNAPSHOT_INDEX = '.compare-snapshot.json';
const SNAPSHOT_CONTENT_DIR = '.compare-snapshot';

function walk(dir, baseDir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // The snapshot index/content dir live at the workdir's own top level and are never part of
    // the manifest they describe.
    if (dir === baseDir && (entry.name === SNAPSHOT_INDEX || entry.name === SNAPSHOT_CONTENT_DIR)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
    } else if (entry.isFile()) {
      const stat = statSync(full);
      const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
      out[relative(baseDir, full)] = { mtimeMs: stat.mtimeMs, sha256: hash };
    }
  }
}

/**
 * Writes `<workdir>/.compare-snapshot.json` (the index) and `<workdir>/.compare-snapshot/`
 * (a real copy of every tracked file's current content). Not incremental and not
 * exclusion-aware - a workdir containing something large and generated (installed dependencies,
 * build output) will be slow to hash/copy; out of scope for this pass, named rather than
 * silently accepted (see DECISIONS.md).
 * @param {string} workdir - absolute path to a builder's working directory
 */
export function writeCompareSnapshot(workdir) {
  // A seat's workdir is normally created lazily on its first real turn (claudeCodeSubprocess.js's
  // workdirFor()) - for a builder that has never run yet, this snapshot call can land first, so
  // it has to be able to create the directory itself rather than assume it already exists.
  mkdirSync(workdir, { recursive: true });
  const files = {};
  walk(workdir, workdir, files);

  const contentDir = join(workdir, SNAPSHOT_CONTENT_DIR);
  for (const relPath of Object.keys(files)) {
    const dest = join(contentDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(workdir, relPath), dest);
  }

  const manifest = { takenAt: Date.now(), files };
  writeFileSync(join(workdir, SNAPSHOT_INDEX), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readCompareSnapshot(workdir) {
  const p = join(workdir, SNAPSHOT_INDEX);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The current state of every file in the workdir, walked fresh (never from the manifest) - used
 * to detect files added since dispatch that the manifest never knew about.
 */
function currentFiles(workdir) {
  const files = {};
  if (existsSync(workdir)) walk(workdir, workdir, files);
  return files;
}

/**
 * Backlog item 8: the artifact drawer's file list, independent of comparison-run history - unlike
 * changedSinceSnapshot (which needs a dispatch-time snapshot to exist at all and only every shows
 * "since dispatch" deltas), this just lists what's actually in the workdir right now. Every
 * builder task creates real files whether or not it was ever part of a multi-seat comparison run,
 * and the drawer's whole point is inspecting those, not only a comparison's diffs.
 * @param {string} workdir
 */
export function listWorkdirFiles(workdir) {
  return Object.keys(currentFiles(workdir)).sort();
}

/** A single file's current hash in a workdir, or null if it doesn't exist there. Used to compute
 * the "same"/"differs" cross-builder badge (PLAN_PARALLEL_BUILD.md §4) - never from the
 * manifest, always the file as it stands right now. */
export function currentFileHash(workdir, relPath) {
  const full = join(workdir, relPath);
  if (!existsSync(full)) return null;
  return createHash('sha256').update(readFileSync(full)).digest('hex');
}

/**
 * "Changed since dispatch" for one builder: added, modified, or deleted relative to its own
 * snapshot. A file with an unchanged sha256 is not listed at all - PLAN_PARALLEL_BUILD.md §4
 * scopes the file tree to changed files only.
 * @param {string} workdir
 * @returns {{ takenAt: number, changes: Array<{path: string, status: 'added'|'modified'|'deleted'}> } | null}
 *   null if no snapshot was ever taken for this workdir (not a comparison run).
 */
export function changedSinceSnapshot(workdir) {
  const snapshot = readCompareSnapshot(workdir);
  if (!snapshot) return null;
  const now = currentFiles(workdir);
  const changes = [];
  for (const path of Object.keys(now)) {
    const before = snapshot.files[path];
    if (!before) changes.push({ path, status: 'added' });
    else if (before.sha256 !== now[path].sha256) changes.push({ path, status: 'modified' });
  }
  for (const path of Object.keys(snapshot.files)) {
    if (!now[path]) changes.push({ path, status: 'deleted' });
  }
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { takenAt: snapshot.takenAt, changes };
}

/**
 * A unified-diff-shaped structured patch (per the `diff` package's `structuredPatch`) between a
 * workdir's dispatch-time snapshot content and its current content, for one file. Never reads
 * git - PLAN_PARALLEL_BUILD.md A1. Returns null for a file with no snapshot copy (added since
 * dispatch, or the workdir was never snapshotted) - the caller renders that as "new file" from
 * current content alone.
 * @param {string} workdir
 * @param {string} relPath - relative path within the workdir
 */
export function diffAgainstSnapshot(workdir, relPath) {
  const snapshotFile = join(workdir, SNAPSHOT_CONTENT_DIR, relPath);
  const currentFile = join(workdir, relPath);
  const before = existsSync(snapshotFile) ? readFileSync(snapshotFile, 'utf8') : null;
  const after = existsSync(currentFile) ? readFileSync(currentFile, 'utf8') : null;
  if (before === null && after === null) return null;
  return structuredPatch(relPath, relPath, before ?? '', after ?? '', '', '', { context: 3 });
}

// Backlog item 8 (relay run 2026-09-10T23-20-49-005Z, "build-seat artifact inspector + context
// forwarder"): standard binary-detection heuristic (a null byte anywhere in the first 8000
// bytes - the same window `git diff` itself uses to decide "Binary files differ" rather than
// printing one) - read as a raw Buffer first, never decoded as UTF-8 before this check, so a
// real binary file can never be mis-detected as text by virtue of Node's own lossy decode.
const BINARY_SNIFF_BYTES = 8000;

function looksBinary(buffer) {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Read one file from a builder's workdir for the artifact inspector: binary-detected first, then
 * (if text) returned as a plain string with a rough token-count estimate (chars/4 - a standard
 * approximation, not a real tokenizer count; no tokenizer library exists in this codebase and
 * this item's own build-speed score doesn't justify adding one for an estimate used only to
 * decide whether to warn, not to bill anything). Never diffed against the snapshot - this reads
 * *current* content, the same "what does this file actually say right now" a vibecoder forwarding
 * a build's output to advisor for diagnosis wants, not what changed.
 * @param {string} workdir
 * @param {string} relPath
 */
export function inspectArtifact(workdir, relPath) {
  const fullPath = join(workdir, relPath);
  if (!existsSync(fullPath)) return null;
  const buffer = readFileSync(fullPath);
  if (looksBinary(buffer)) {
    return { binary: true, content: null, estimatedTokens: null };
  }
  const content = buffer.toString('utf8');
  return { binary: false, content, estimatedTokens: Math.ceil(content.length / 4) };
}
