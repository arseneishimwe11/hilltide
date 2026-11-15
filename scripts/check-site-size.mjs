#!/usr/bin/env node
// Fails if the built site breaks its size limits. Run after `npm run build`.
//
// Limits (CLAUDE.md): no file over 50 MB, and the whole site small enough to
// stay well under GitHub Pages limits. The total budget is tightened as real
// asset sizes become known.

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MB = 1024 * 1024;
export const MAX_FILE_BYTES = 50 * MB;
export const MAX_TOTAL_BYTES = 100 * MB;

/** Lists every file under a directory with its size in bytes. */
export function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push({ path, bytes: statSync(path).size });
  }
  return files;
}

/** Returns the size report and any limit violations for a list of files. */
export function checkSizes(files, limits = {}) {
  const maxFile = limits.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotal = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const problems = files
    .filter((file) => file.bytes > maxFile)
    .map((file) => `${file.path} is ${(file.bytes / MB).toFixed(1)} MB (limit ${maxFile / MB} MB)`);
  if (totalBytes > maxTotal) {
    problems.push(`site total is ${(totalBytes / MB).toFixed(1)} MB (limit ${maxTotal / MB} MB)`);
  }
  return { totalBytes, fileCount: files.length, problems };
}

function main() {
  const dist = resolve(process.argv[2] ?? "web/dist");
  const files = listFiles(dist).map((file) => ({ ...file, path: relative(dist, file.path) }));
  if (files.length === 0) {
    console.error(`No files found in ${dist}. Build the site first.`);
    process.exit(1);
  }
  const report = checkSizes(files);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  console.log(`Site: ${report.fileCount} files, ${(report.totalBytes / MB).toFixed(2)} MB total`);
  for (const file of largest) {
    console.log(`  ${(file.bytes / 1024).toFixed(1).padStart(10)} kB  ${file.path}`);
  }
  if (report.problems.length > 0) {
    for (const problem of report.problems) console.error(`Size limit broken: ${problem}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
