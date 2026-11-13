#!/usr/bin/env node
// Verifica in sola lettura di tutte le release pubblicate su GitHub.
//
// Controlla, per ogni tag v*:
//   - che il tag esista anche sul remoto e punti a un commit su main;
//   - che la release non sia una bozza o un prerelease;
//   - che siano presenti DMG, ZIP, i due blockmap e latest-mac.yml;
//   - per le release dalla 1.3.0, anche la firma Ed25519 dello ZIP;
//   - che latest-mac.yml dichiari la versione del tag e le dimensioni corrette;
//   - che DMG e ZIP siano raggiungibili (HTTP 200).
//
// Non modifica tag, release o file. Esce con codice 1 se trova errori.
//
// Uso:
//   npm run verify-releases
//   npm run verify-releases -- --skip-http
//   npm run verify-releases -- --tag v1.3.0 --strict --verify-signatures
//
// Con --verify-signatures scarica lo ZIP e verifica crittograficamente la
// firma rispetto alla chiave pubblica incorporata nell'app.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyDigestSignature } = require('../src/main/update-signature');

const REPO = 'IC3NBERG/Memo';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const skipHttp = process.argv.includes('--skip-http');
const verifySignatures = process.argv.includes('--verify-signatures');
const strict = process.argv.includes('--strict');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const onlyTag = argValue('--tag');

// Le release precedenti alla firma Ed25519 non possono avere `.sig`.
const SIGNATURE_MIN_VERSION = '1.2.0';

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  return match ? match.slice(1).map(Number) : null;
}

function versionGreaterThan(version, threshold) {
  const left = parseVersion(version);
  const right = parseVersion(threshold);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

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

    const shaMatch = line.match(/^\s*sha512:\s*(\S+)$/);
    if (shaMatch && current) {
      current.sha512 = shaMatch[1].trim().replace(/^['"]|['"]$/g, '');
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

async function sha512Url(url) {
  const res = await fetchWithRetry(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('corpo della risposta assente');
  const hash = crypto.createHash('sha512');
  for await (const chunk of Readable.fromWeb(res.body)) {
    hash.update(chunk);
  }
  return hash.digest('base64');
}

async function textUrl(url) {
  const res = await fetchWithRetry(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function main() {
  const tagsResult = tryRun('git', ['tag', '--list', 'v*', '--sort=v:refname']);
  if (!tagsResult.ok || !tagsResult.out) {
    console.error('Errore: nessun tag v* trovato nel repository.');
    process.exit(1);
  }
  let tags = tagsResult.out.split(/\r?\n/).filter(Boolean);
  if (onlyTag) {
    tags = tags.filter((tag) => tag === onlyTag);
    if (tags.length === 0) {
      console.error(`Errore: tag ${onlyTag} non trovato.`);
      process.exit(1);
    }
  }

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
    const needsSignature = versionGreaterThan(version, SIGNATURE_MIN_VERSION);
    const expectedAssets = needsSignature ? 6 : 5;

    if (strict && needsSignature) {
      const tagType = tryRun('git', ['cat-file', '-t', tag]);
      if (!tagType.ok || tagType.out !== 'tag') {
        problems.push('tag non annotato');
      }
    }

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
      '--json', 'isDraft,isPrerelease,assets,body',
    ]);

    if (!releaseResult.ok) {
      problems.push('release assente');
    } else {
      const release = JSON.parse(releaseResult.out);
      assets = release.assets || [];
      if (release.isDraft) problems.push('release in bozza');
      if (release.isPrerelease) problems.push('release prerelease');
      if (strict && needsSignature && !(release.body || '').trim()) {
        problems.push('note della release vuote');
      }

      const required = [
        ['-arm64.dmg', 'DMG'],
        ['-arm64-mac.zip', 'ZIP'],
        ['-arm64.dmg.blockmap', 'blockmap DMG'],
        ['-arm64-mac.zip.blockmap', 'blockmap ZIP'],
      ];
      if (needsSignature) required.push(['-arm64-mac.zip.sig', 'firma Ed25519']);

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

    if (needsSignature && verifySignatures) {
      const zipFile = manifest?.files.find((file) => /-arm64-mac\.zip$/.test(file.url));
      if (!zipFile) {
        problems.push('manifest senza ZIP per la verifica della firma');
      } else {
        const zipUrl = `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(zipFile.url)}`;
        try {
          const signature = await textUrl(`${zipUrl}.sig`);
          const digest = await sha512Url(zipUrl);
          if (zipFile.sha512 && digest !== zipFile.sha512) {
            problems.push('SHA-512 remoto diverso dal manifest');
          }
          if (!verifyDigestSignature(digest, signature)) {
            problems.push('firma Ed25519 non valida');
          } else {
            notes.push('firma Ed25519 valida');
          }
        } catch (err) {
          problems.push(`verifica firma fallita (${err.message})`);
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
      assets: `${assets.length}/${expectedAssets}`,
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
