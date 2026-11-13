#!/usr/bin/env node
/**
 * Fast CLI Importer for 3,500+ LeetCode Questions (Topic-Tagged, No Hints, No Company Tags)
 *
 * Usage:
 *   node scripts/import_leetcode.mjs --sync             # Fetch 4,000+ problems from open community mirror
 *   node scripts/import_leetcode.mjs --file dump.json   # Fast-import from a local JSON file (<1s)
 *   node scripts/import_leetcode.mjs --stats            # Print current DB problem/topic counts
 */

import fs from 'fs';
import path from 'path';
import { initDatabase } from '../backend/src/db/database.js';
import {
  importLeetCodeDataset,
  syncPublicLeetCodeBank,
  getLeetCodeTopics,
  ensureBuiltInLeetCodeSeeded
} from '../backend/src/services/leetcodeCatalogService.js';

initDatabase();
ensureBuiltInLeetCodeSeeded();

const args = process.argv.slice(2);
const fileFlagIdx = args.indexOf('--file');
const limitFlagIdx = args.indexOf('--limit');
const limit = limitFlagIdx >= 0 ? Number(args[limitFlagIdx + 1]) : 4500;

async function main() {
  if (args.includes('--stats')) {
    const info = getLeetCodeTopics();
    console.log(JSON.stringify({ total: info.total, difficulties: info.difficulties, topTopics: info.topics.slice(0, 15) }, null, 2));
    return;
  }

  if (fileFlagIdx >= 0) {
    const filePath = path.resolve(args[fileFlagIdx + 1] || '');
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.questions || raw.data?.problemsetQuestionListV2?.questions || []);
    const t0 = Date.now();
    const res = importLeetCodeDataset(list, path.basename(filePath));
    ensureBuiltInLeetCodeSeeded();
    console.log(`Imported ${res.imported} problems (${res.skipped} skipped) in ${Date.now() - t0}ms. Total in DB: ${res.total}`);
    return;
  }

  // Default: sync from open LeetCode mirror
  console.log('Syncing LeetCode problems catalog (strip hints & company tags)...');
  const t0 = Date.now();
  const res = await syncPublicLeetCodeBank({ source: args.includes('--metadata-only') ? 'metadata' : 'full', limit });
  console.log(`Synced ${res.imported} problems from ${res.sourceUrl} in ${Date.now() - t0}ms. Total in DB: ${res.total}`);
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
