// Parallel-build-and-compare, build order item 2 (PLAN_PARALLEL_BUILD.md §4): a dispatch-time
// manifest of every file in a builder's workdir - path, mtime, sha256 - written before a
// multi-seat task starts so "changed since dispatch" and every diff (item 3, not built yet) can
// be computed by walking the current workdir and comparing against this manifest, never against
// a git commit (PLAN_PARALLEL_BUILD.md A1: builder workdirs aren't git repositories).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SNAPSHOT_FILENAME = '.compare-snapshot.json';

function walk(dir, baseDir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // The manifest file itself is never part of the manifest it describes.
    if (entry.name === SNAPSHOT_FILENAME) continue;
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
 * Writes `<workdir>/.compare-snapshot.json`. Not incremental and not exclusion-aware - a workdir
 * containing something large and generated (installed dependencies, build output) will be slow
 * to hash; out of scope for this pass, named rather than silently accepted (see DECISIONS.md).
 * @param {string} workdir - absolute path to a builder's working directory
 */
export function writeCompareSnapshot(workdir) {
  // A seat's workdir is normally created lazily on its first real turn (claudeCodeSubprocess.js's
  // workdirFor()) - for a builder that has never run yet, this snapshot call can land first, so
  // it has to be able to create the directory itself rather than assume it already exists.
  mkdirSync(workdir, { recursive: true });
  const files = {};
  walk(workdir, workdir, files);
  const manifest = { takenAt: Date.now(), files };
  writeFileSync(join(workdir, SNAPSHOT_FILENAME), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readCompareSnapshot(workdir) {
  const p = join(workdir, SNAPSHOT_FILENAME);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
