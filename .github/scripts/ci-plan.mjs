#!/usr/bin/env node
// Planejamento do CI: descobre os workspaces do monorepo, vê quais mudaram
// (mais os dependentes deles) e gera a matrix de jobs do workflow ci.yml.
//
// Os arquivos alterados vêm da API REST do GitHub (o checkout do job é raso,
// sem histórico). Só usa módulos nativos do Node (24+: fetch, fs.globSync,
// path.matchesGlob). Uso local:
//   node .github/scripts/ci-plan.mjs --all
//   git diff --name-only origin/main...HEAD | node .github/scripts/ci-plan.mjs --files -
//   CHANGED_FILES=$'a.ts\nb.ts' node .github/scripts/ci-plan.mjs
// Sem lista, lê o evento do Actions (GITHUB_EVENT_NAME/GITHUB_EVENT_PATH,
// GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_TOKEN). Apontar GITHUB_API_URL para
// um servidor local permite testar paginação e truncamento sem rede.
//
// Saída: a matrix em JSON no stdout e um resumo no stderr. No Actions também
// escreve `matrix` e `empty` em $GITHUB_OUTPUT e o resumo em $GITHUB_STEP_SUMMARY.

import { appendFileSync, globSync, readFileSync } from 'node:fs';
import { matchesGlob, posix } from 'node:path';
import { parseArgs } from 'node:util';

// Scripts npm que viram job, nesta ordem. Só entram os que o workspace define.
// O `build` roda como está no package.json (é o mesmo comando do release),
// mesmo que ele repita o typecheck — custa alguns segundos e evita casos especiais.
const TASKS = ['typecheck', 'test', 'build'];

// Arquivos que não afetam nenhum job: documentação e o site estático.
// Qualquer outro arquivo fora dos workspaces (package.json/lockfile da raiz,
// tsconfig.base.json, workflows, .nvmrc...) é tratado como compartilhado e roda tudo.
const IGNORED = ['**/*.md', 'LICENSE', 'site/**', 'design/**'];

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const ZERO_SHA = /^0+$/;

// limites documentados da API: PR files lista no máximo 3000 arquivos,
// compare no máximo 300
const PR_FILES_MAX = 3000;
const COMPARE_FILES_MAX = 300;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const log = (msg) => process.stderr.write(`${msg}\n`);

class ApiError extends Error {}

// GET na API com uma nova tentativa em erro de rede ou 5xx
async function api(path) {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status} em ${path}`;
      if (res.status < 500) break;
    } catch (err) {
      last = `${err.name}: ${err.message} em ${path}`;
    }
  }
  throw new ApiError(last);
}

const namesOf = (files) => files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));

async function prFiles(repo, pr) {
  const files = [];
  for (let page = 1; page <= PR_FILES_MAX / 100; page++) {
    const batch = await api(`/repos/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`);
    files.push(...batch);
    if (batch.length < 100) break;
  }
  const expected = pr.changed_files;
  if (files.length >= PR_FILES_MAX || (Number.isInteger(expected) && files.length < expected)) {
    return { files: null, warn: `PR com ${expected ?? '?'} arquivos, a API listou ${files.length}` };
  }
  return { files: namesOf(files) };
}

async function pushFiles(repo, before, after) {
  // per_page=1: a lista de arquivos vem inteira na primeira página; só os commits paginam
  const cmp = await api(`/repos/${repo}/compare/${before}...${after}?per_page=1`);
  // diverged/behind = force-push: o compare seria contra o merge-base, não contra o before
  if (cmp.status !== 'ahead' && cmp.status !== 'identical') {
    return { files: null, warn: `compare ${before}...${after} com status "${cmp.status}"` };
  }
  const files = cmp.files ?? [];
  if (files.length >= COMPARE_FILES_MAX) {
    return { files: null, warn: `compare com ${files.length} arquivos (limite da API é ${COMPARE_FILES_MAX})` };
  }
  return { files: namesOf(files) };
}

function discoverWorkspaces() {
  const root = readJson('package.json');
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? []);
  const files = globSync(patterns.map((p) => posix.join(p, 'package.json')), {
    exclude: (f) => f.split(/[\\/]/).includes('node_modules'),
  });
  const workspaces = [];
  for (const file of new Set(files.map((f) => f.split('\\').join('/')))) {
    const pkg = readJson(file);
    if (!pkg.name) {
      log(`aviso: ${file} não tem "name"; ignorado`);
      continue;
    }
    const deps = new Set(DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})));
    workspaces.push({ name: pkg.name, path: posix.dirname(file), scripts: pkg.scripts ?? {}, deps });
  }
  return workspaces.sort((a, b) => a.path.localeCompare(b.path));
}

// Lista de arquivos alterados, ou null quando não dá para saber (=> roda tudo).
async function changedFiles(opts) {
  if (opts.all) return { files: null, reason: '--all' };
  const fromList = (text, reason) => ({ files: text.split('\n').map((l) => l.trim()).filter(Boolean), reason });
  if (opts.files) return fromList(readFileSync(opts.files === '-' ? 0 : opts.files, 'utf8'), `lista ${opts.files}`);
  if (process.env.CHANGED_FILES !== undefined) return fromList(process.env.CHANGED_FILES, 'CHANGED_FILES');

  const event = process.env.GITHUB_EVENT_NAME;
  const payload = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH) : {};
  const repo = process.env.GITHUB_REPOSITORY;
  let result;
  try {
    if (!repo) throw new ApiError('GITHUB_REPOSITORY não definido');
    if (event === 'pull_request' && payload.pull_request?.number) {
      result = await prFiles(repo, payload.pull_request);
      result.reason = `API: arquivos do PR #${payload.pull_request.number}`;
    } else if (event === 'push') {
      const { before, after = process.env.GITHUB_SHA } = payload;
      if (!before || ZERO_SHA.test(before)) return { files: null, reason: 'push sem commit base' };
      result = await pushFiles(repo, before, after);
      result.reason = `API: compare ${before.slice(0, 12)}...${String(after).slice(0, 12)}`;
    } else {
      return { files: null, reason: `evento ${event ?? 'desconhecido'}` };
    }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    result = { files: null, warn: err.message, reason: 'API falhou' };
  }
  if (result.warn) log(`::warning::${result.warn}; rodando todos os workspaces`);
  return result;
}

function plan(workspaces, files) {
  const selected = new Set();
  const why = new Map();
  const shared = [];

  if (files === null) {
    workspaces.forEach((w) => selected.add(w.name));
  } else {
    for (const file of files) {
      if (IGNORED.some((g) => matchesGlob(file, g))) continue;
      const owner = workspaces
        .filter((w) => file.startsWith(`${w.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (owner) {
        if (!selected.has(owner.name)) why.set(owner.name, `alterado (${file})`);
        selected.add(owner.name);
      } else {
        shared.push(file);
      }
    }
    if (shared.length) workspaces.forEach((w) => selected.add(w.name));
  }

  // fecha transitivamente sobre os dependentes (B depende de A => A mudou, B roda)
  const queue = [...selected];
  while (queue.length) {
    const changed = queue.shift();
    for (const w of workspaces) {
      if (!selected.has(w.name) && w.deps.has(changed)) {
        selected.add(w.name);
        why.set(w.name, `depende de ${changed}`);
        queue.push(w.name);
      }
    }
  }

  const include = [];
  for (const w of workspaces) {
    if (!selected.has(w.name)) continue;
    for (const task of TASKS) {
      if (typeof w.scripts[task] === 'string') include.push({ workspace: w.name, path: w.path, task });
    }
  }
  return { include, why, shared };
}

const { values: opts } = parseArgs({
  options: {
    all: { type: 'boolean' },
    files: { type: 'string' },
  },
});

const workspaces = discoverWorkspaces();
const { files, reason } = await changedFiles(opts);
const { include, why, shared } = plan(workspaces, files);

const lines = [`origem: ${reason}${files ? ` (${files.length} arquivo(s))` : ' => todos'}`];
lines.push(`workspaces: ${workspaces.map((w) => `${w.name} (${w.path})`).join(', ') || 'nenhum'}`);
if (shared.length) lines.push(`arquivos compartilhados => todos: ${shared.slice(0, 10).join(', ')}${shared.length > 10 ? ', ...' : ''}`);
if (!shared.length) for (const [name, r] of why) lines.push(`  ${name}: ${r}`);
lines.push(include.length ? `jobs: ${include.map((e) => `${e.task} ${e.workspace}`).join(', ')}` : 'jobs: nenhum');
log(lines.join('\n'));

const matrix = JSON.stringify({ include });
process.stdout.write(`${JSON.stringify({ include }, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\nempty=${include.length === 0}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Plano do CI\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
}
