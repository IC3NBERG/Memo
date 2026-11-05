#!/usr/bin/env node
// Verifica in sola lettura di tutte le release pubblicate su GitHub.
//
// Controlla, per ogni tag v*:
//   - che il tag esista anche sul remoto e punti a un commit su main;
//   - che la release non sia una bozza o un prerelease;
//   - che siano presenti DMG, ZIP, i due blockmap e latest-mac.yml;
//   - che latest-mac.yml dichiari la versione del tag e le dimensioni corrette;
//   - che DMG e ZIP siano raggiungibili (HTTP 200).
//
// Non modifica tag, release o file. Esce con codice 1 se trova errori.
//
// Uso:
//   npm run verify-releases
//   npm run verify-releases -- --skip-http

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REPO = 'IC3NBERG/Memo';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const skipHttp = process.argv.includes('--skip-http');

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function tryRun(cmd, args) {
  try {
    return { ok: true, out: run(cmd, args) };
  } catch (err) {
    return { ok: false, out: '', err: err.stderr?.toString().trim() || err.message };
  }
}

function assetMatches(assets, suffix) {
  return assets.filter((asset) => asset.name.endsWith(suffix));
}

function parseManifest(text) {
  const lines = text.split(/\r?\n/);
  const files = [];
  let version = null;
  let current = null;

  for (const line of lines) {
    const versionMatch = line.match(/^version:\s*(.+)$/);
    if (versionMatch) {
      version = versionMatch[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    const urlMatch = line.match(/^\s*-\s*url:\s*(.+)$/);
    if (urlMatch) {
      current = { url: urlMatch[1].trim() };
      files.push(current);
      continue;
    }

    const sizeMatch = line.match(/^\s*size:\s*(\d+)$/);
    if (sizeMatch && current) {
      current.size = Number(sizeMatch[1]);
      current = null;
    }
  }

  return { version, files };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GitHub può rispondere 502/timeout in modo transitorio: riproviamo.
async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status >= 500 && attempt < attempts - 1) {
        await sleep(800);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) await sleep(800);
    }
  }

  throw lastError || new Error('richiesta fallita');
}

async function headStatus(url) {
  try {
    const res = await fetchWithRetry(url, { method: 'HEAD', redirect: 'follow' });
    return res.status;
  } catch (_) {
    return 0;
  }
}

async function main() {
  const tagsResult = tryRun('git', ['tag', '--list', 'v*', '--sort=v:refname']);
  if (!tagsResult.ok || !tagsResult.out) {
    console.error('Errore: nessun tag v* trovato nel repository.');
    process.exit(1);
  }
  const tags = tagsResult.out.split(/\r?\n/).filter(Boolean);

  const runsResult = tryRun('gh', [
    'run', 'list', '--workflow=release.yml', '--limit', '100',
    '--json', 'headBranch,conclusion',
  ]);
  const ciByTag = new Map();
  if (runsResult.ok) {
    for (const run of JSON.parse(runsResult.out)) {
      if (!ciByTag.has(run.headBranch)) ciByTag.set(run.headBranch, []);
      ciByTag.get(run.headBranch).push(run.conclusion);
    }
  }

  const remoteTagsResult = tryRun('git', ['ls-remote', '--tags', 'origin']);
  const remoteTags = new Set(
    (remoteTagsResult.ok ? remoteTagsResult.out : '')
      .split(/\r?\n/)
      .map((line) => line.split('\t')[1] || '')
      .filter(Boolean)
      .map((ref) => ref.replace(/\^\{\}$/, '')),
  );

  const baseRef = tryRun('git', ['rev-parse', '--verify', 'origin/main']).ok
    ? 'origin/main'
    : 'HEAD';

  const rows = [];
  let errors = 0;
  let warnings = 0;

  for (const tag of tags) {
    const version = tag.replace(/^v/, '');
    const problems = [];
    const notes = [];

    const commitResult = tryRun('git', ['rev-list', '-n1', tag]);
    const commit = commitResult.ok ? commitResult.out : '';
    const shortCommit = commit ? commit.slice(0, 7) : '?';

    if (!commit) {
      problems.push('tag senza commit');
    } else if (!tryRun('git', ['merge-base', '--is-ancestor', commit, baseRef]).ok) {
      problems.push(`commit non su ${baseRef}`);
    }

    if (!remoteTags.has(`refs/tags/${tag}`)) {
      problems.push('tag non pushato');
    }

    let assets = [];
    const releaseResult = tryRun('gh', [
      'release', 'view', tag,
      '--json', 'isDraft,isPrerelease,assets',
    ]);

    if (!releaseResult.ok) {
      problems.push('release assente');
    } else {
      const release = JSON.parse(releaseResult.out);
      assets = release.assets || [];
      if (release.isDraft) problems.push('release in bozza');
      if (release.isPrerelease) problems.push('release prerelease');

      const required = [
        ['-arm64.dmg', 'DMG'],
        ['-arm64-mac.zip', 'ZIP'],
        ['-arm64.dmg.blockmap', 'blockmap DMG'],
        ['-arm64-mac.zip.blockmap', 'blockmap ZIP'],
      ];

      for (const [suffix, label] of required) {
        const matches = assetMatches(assets, suffix);
        if (matches.length === 0) problems.push(`${label} assente`);
        if (matches.length > 1) problems.push(`${label} duplicato`);
      }

      if (!assets.some((asset) => asset.name === 'latest-mac.yml')) {
        problems.push('latest-mac.yml assente');
      }
    }

    const manifestUrl = `https://github.com/${REPO}/releases/download/${tag}/latest-mac.yml`;
    let manifest = null;
    try {
      const res = await fetchWithRetry(manifestUrl, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = parseManifest(await res.text());
    } catch (err) {
      problems.push(`manifest non scaricabile (${err.message})`);
    }

    if (manifest) {
      if (manifest.version !== version) {
        problems.push(`manifest ${manifest.version || '?'} ≠ tag ${version}`);
      }

      const byName = new Map(assets.map((asset) => [asset.name, asset.size]));
      for (const file of manifest.files) {
        if (!byName.has(file.url)) {
          problems.push(`manifest cita ${file.url} ma l'asset manca`);
          continue;
        }
        if (byName.get(file.url) !== file.size) {
          problems.push(`dimensione ${file.url} non coerente`);
        }
      }
    }

    if (!skipHttp) {
      for (const asset of assets) {
        if (!/\.(dmg|zip)$/.test(asset.name)) continue;
        const url = `https://github.com/${REPO}/releases/download/${tag}/${asset.name}`;
        const status = await headStatus(url);
        if (status !== 200) {
          problems.push(`${asset.name} HTTP ${status || 'errore'}`);
        }
      }
    }

    const ci = ciByTag.get(tag) || [];
    const ciLabel = ci.length === 0
      ? 'assente'
      : (ci.includes('success') ? 'ok' : ci[ci.length - 1]);

    if (ci.length > 0 && !ci.includes('success')) {
      notes.push('CI senza run riuscito (release comunque verificata)');
      warnings += 1;
    }

    if (problems.length) errors += 1;

    rows.push({
      tag,
      commit: shortCommit,
      ci: ciLabel,
      assets: `${assets.length}/5`,
      result: problems.length ? `ERRORE: ${problems.join('; ')}` : 'ok',
      notes,
    });
  }

  const widths = {
    tag: Math.max(4, ...rows.map((row) => row.tag.length)),
    commit: Math.max(6, ...rows.map((row) => row.commit.length)),
    ci: Math.max(2, ...rows.map((row) => row.ci.length)),
    assets: 5,
  };

  console.log(
    `${'TAG'.padEnd(widths.tag)}  ${'COMMIT'.padEnd(widths.commit)}  ` +
    `${'CI'.padEnd(widths.ci)}  ${'ASSET'.padEnd(widths.assets)}  ESITO`,
  );
  console.log('-'.repeat(widths.tag + widths.commit + widths.ci + widths.assets + 20));

  for (const row of rows) {
    console.log(
      `${row.tag.padEnd(widths.tag)}  ${row.commit.padEnd(widths.commit)}  ` +
      `${row.ci.padEnd(widths.ci)}  ${row.assets.padEnd(widths.assets)}  ${row.result}`,
    );
    for (const note of row.notes) {
      console.log(`${' '.repeat(widths.tag + widths.commit + widths.ci + widths.assets + 8)}nota: ${note}`);
    }
  }

  console.log('');
  console.log(
    `Release verificate: ${rows.length} — errori: ${errors} — avvisi: ${warnings}` +
    `${skipHttp ? ' — controllo HTTP saltato' : ''}`,
  );

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Errore imprevisto:', err.message);
  process.exit(1);
});
