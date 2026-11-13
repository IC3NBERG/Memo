#!/usr/bin/env node
// Gestione di versione, changelog e note di release.
//
// Comandi:
//   node scripts/release.mjs check --tag v1.3.0 [--strict]
//       Verifica che tag, package.json, package-lock.json e CHANGELOG siano
//       coerenti. Con --strict richiede anche il tag annotato e il commit su
//       origin/main.
//   node scripts/release.mjs notes --tag v1.3.0
//       Stampa le note della release (usate da GitHub Releases).
//   node scripts/release.mjs prepare patch|minor|major|x.y.z
//       Incrementa la versione, aggiorna package-lock e inserisce la sezione
//       nel CHANGELOG partendo dai commit convenzionali.
//   node scripts/release.mjs changelog [--write]
//       Rigenera il CHANGELOG da tutti i tag (o lo stampa).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(root, 'CHANGELOG.md');

export const CATEGORIES = Object.freeze([
  { key: 'feat', title: 'Novità' },
  { key: 'fix', title: 'Correzioni' },
  { key: 'perf', title: 'Prestazioni' },
  { key: 'refactor', title: 'Ristrutturazione' },
  { key: 'docs', title: 'Documentazione' },
  { key: 'test', title: 'Test' },
  { key: 'build', title: 'Build e distribuzione' },
  { key: 'ci', title: 'Build e distribuzione' },
  { key: 'chore', title: 'Manutenzione' },
]);

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
    return run(cmd, args);
  } catch (_) {
    return null;
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ''));
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Versione non valida: ${!left ? a : b}`);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export function bumpVersion(version, bump) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`Versione non valida: ${version}`);
  if (parseVersion(bump)) return bump;
  const [major, minor, patch] = parsed;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Incremento non valido: ${bump} (usa patch, minor, major o x.y.z)`);
}

export function readVersions() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return {
    package: pkg.version,
    lock: lock.version,
    lockRoot: lock.packages?.['']?.version,
  };
}

export function listTags() {
  const output = tryRun('git', ['tag', '--list', 'v*', '--sort=v:refname']);
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean);
}

export function latestTag() {
  const tags = listTags();
  return tags.length ? tags[tags.length - 1] : null;
}

export function previousTag(tag) {
  const tags = listTags();
  const index = tags.indexOf(tag);
  return index > 0 ? tags[index - 1] : null;
}

export function collectCommits(fromTag, to = 'HEAD') {
  const range = fromTag ? `${fromTag}..${to}` : to;
  const output = run('git', [
    'log', '--no-merges', '--format=%s%x1f%b%x1e', range,
  ]);
  if (!output) return [];
  return output.split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ''] = entry.split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    });
}

export function categorizeCommit(subject) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?!?:\s+(.+)$/.exec(subject);
  if (!match) return { category: 'chore', description: subject };
  const [, type, scope, description] = match;
  const category = CATEGORIES.some((item) => item.key === type) ? type : 'chore';
  return { category, scope, description };
}

function isReleaseCommit(subject) {
  return /^chore(?:\(release\))?:\s*v?\d+\.\d+\.\d+/i.test(subject);
}

export function formatEntries(commits) {
  const grouped = new Map(CATEGORIES.map((item) => [item.key, []]));
  const seen = new Set();

  for (const commit of commits) {
    if (isReleaseCommit(commit.subject)) continue;
    const { category, scope, description } = categorizeCommit(commit.subject);
    const label = description.charAt(0).toUpperCase() + description.slice(1);
    const line = scope ? `- **${scope}:** ${label}` : `- ${label}`;
    if (seen.has(line)) continue;
    seen.add(line);
    grouped.get(category).push(line);
  }

  const titles = new Map(CATEGORIES.map((item) => [item.key, item.title]));
  const order = [];
  for (const item of CATEGORIES) {
    if (!titles.has(item.key) || order.includes(item.title)) continue;
    order.push(item.title);
  }

  const sections = [];
  for (const title of order) {
    const lines = [];
    for (const item of CATEGORIES) {
      if (item.title === title) lines.push(...grouped.get(item.key));
    }
    if (lines.length) sections.push(`### ${title}\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function sectionForVersion(version, { date = today(), fromTag = null, to = 'HEAD' } = {}) {
  const notes = formatEntries(collectCommits(fromTag, to));
  return `## [${version}] - ${date}\n\n${notes || 'Nessuna modifica registrata.'}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

const CHANGELOG_HEADER = `# Changelog

Tutte le modifiche rilevanti di Crunch. Il formato segue
[Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e il versioning
[Semantic Versioning](https://semver.org/lang/it/).
`;

export function buildChangelog() {
  const tags = listTags();
  const sections = [];
  let previous = null;

  for (const tag of tags) {
    const version = tag.replace(/^v/, '');
    const date = tryRun('git', ['log', '-1', '--format=%cs', tag]) || today();
    sections.push(sectionForVersion(version, { date, fromTag: previous, to: tag }));
    previous = tag;
  }

  const unreleased = formatEntries(collectCommits(previous));
  if (unreleased) {
    sections.push(`## [Non rilasciato]\n\n${unreleased}`);
  }

  return `${CHANGELOG_HEADER}\n${sections.join('\n\n')}\n`;
}

export function changelogSection(version) {
  if (!fs.existsSync(CHANGELOG)) return null;
  const text = fs.readFileSync(CHANGELOG, 'utf8');
  const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*$`, 'm');
  const match = heading.exec(text);
  if (!match) return null;
  const next = text.indexOf('\n## [', match.index + match[0].length);
  return text.slice(match.index, next === -1 ? text.length : next).trim();
}

export function checkRelease(tag, { strict = false, requireTag = true } = {}) {
  const problems = [];
  const warnings = [];
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    return { ok: false, problems: [`Tag non valido: ${tag || '(assente)'}`], warnings };
  }

  const version = tag.replace(/^v/, '');
  const versions = readVersions();
  if (versions.package !== version) {
    problems.push(`package.json ${versions.package} ≠ tag ${version}`);
  }
  if (versions.lock !== version) {
    problems.push(`package-lock.json ${versions.lock} ≠ tag ${version}`);
  }
  if (versions.lockRoot !== version) {
    problems.push(`package-lock.json packages[""] ${versions.lockRoot} ≠ tag ${version}`);
  }
  if (!changelogSection(version)) {
    problems.push(`CHANGELOG.md senza sezione [${version}]`);
  }

  if (requireTag) {
    const tagType = tryRun('git', ['cat-file', '-t', `refs/tags/${tag}`])
      || tryRun('git', ['cat-file', '-t', tag]);
    if (!tagType) {
      problems.push(`tag ${tag} assente`);
    } else if (tagType !== 'tag') {
      warnings.push(`tag ${tag} non annotato (tipo: ${tagType})`);
    }
  }

  if (strict && requireTag) {
    const main = tryRun('git', ['rev-parse', '--verify', 'origin/main']);
    if (main && tryRun('git', ['merge-base', '--is-ancestor', tag, 'origin/main']) === null) {
      problems.push(`tag ${tag} non punta a un commit di origin/main`);
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

function insertSection(section) {
  const base = fs.existsSync(CHANGELOG) ? fs.readFileSync(CHANGELOG, 'utf8') : `${CHANGELOG_HEADER}\n`;
  const marker = /^## \[/m.exec(base);
  if (!marker) return `${base.trimEnd()}\n\n${section}\n`;
  return `${base.slice(0, marker.index)}${section}\n\n${base.slice(marker.index)}`;
}

function writeVersions(version) {
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  pkg.version = version;
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function commandCheck() {
  const tag = argValue('--tag');
  const strict = process.argv.includes('--strict');
  const result = checkRelease(tag, { strict });
  for (const warning of result.warnings) console.warn(`Avviso: ${warning}`);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`Errore: ${problem}`);
    process.exit(1);
  }
  console.log(`Versione e changelog coerenti per ${tag}.`);
}

function commandNotes() {
  const tag = argValue('--tag');
  if (!tag) {
    console.error('Errore: --tag richiesto.');
    process.exit(1);
  }
  const version = tag.replace(/^v/, '');
  const existing = changelogSection(version);
  if (existing) {
    const body = existing.replace(/^## \[[^\]]+\](?: - \d{4}-\d{2}-\d{2})?\n*/, '').trim();
    console.log(body);
    return;
  }
  const from = previousTag(tag) || latestTag();
  console.log(formatEntries(collectCommits(from)) || 'Manutenzione e miglioramenti interni.');
}

function commandPrepare() {
  const bump = process.argv[3];
  if (!bump) {
    console.error('Uso: node scripts/release.mjs prepare patch|minor|major|x.y.z');
    process.exit(1);
  }
  const versions = readVersions();
  const newVersion = bumpVersion(versions.package, bump);
  const last = latestTag();
  if (last && compareVersions(newVersion, last.replace(/^v/, '')) <= 0) {
    console.error(`Errore: ${newVersion} deve essere successiva all'ultimo tag ${last}.`);
    process.exit(1);
  }

  writeVersions(newVersion);
  const section = `## [${newVersion}] - ${today()}\n\n${formatEntries(collectCommits(last)) || 'Manutenzione e miglioramenti interni.'}`;
  fs.writeFileSync(CHANGELOG, insertSection(section));
  console.log(`Versione aggiornata a ${newVersion}.`);
  console.log('Prossimi passi:');
  console.log(`  1. verificare CHANGELOG.md e package.json/package-lock.json`);
  console.log(`  2. git add package.json package-lock.json CHANGELOG.md`);
  console.log(`  3. git commit -m "chore(release): v${newVersion}"`);
  console.log(`  4. git tag -a v${newVersion} -m "Crunch v${newVersion}" && git push origin main v${newVersion}`);
}

function commandChangelog() {
  const text = buildChangelog();
  if (process.argv.includes('--write')) {
    fs.writeFileSync(CHANGELOG, text);
    console.log('CHANGELOG.md rigenerato.');
  } else {
    process.stdout.write(text);
  }
}

function main() {
  const command = process.argv[2];
  if (command === 'check') commandCheck();
  else if (command === 'notes') commandNotes();
  else if (command === 'prepare') commandPrepare();
  else if (command === 'changelog') commandChangelog();
  else {
    console.error('Uso: node scripts/release.mjs check|notes|prepare|changelog [opzioni]');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
