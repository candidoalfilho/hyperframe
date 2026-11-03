// Testes do ci-plan.mjs sem rede: um servidor HTTP local faz o papel da API do
// GitHub (GITHUB_API_URL). Rodar da raiz do repo: node --test .github/scripts/ci-plan.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

const SCRIPT = new URL('./ci-plan.mjs', import.meta.url).pathname;
const REPO = 'dono/repo';
const TOKEN = 'token-de-teste-123';
const tmp = mkdtempSync(join(tmpdir(), 'ci-plan-'));

let handler = () => [404, {}];
let requests = [];
const server = createServer((req, res) => {
  requests.push({ url: req.url, auth: req.headers.authorization });
  const [status, body] = handler(new URL(req.url, 'http://x'));
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});
let apiUrl;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function run(event, payload, extraEnv = {}) {
  const eventPath = join(tmp, `${event}.json`);
  writeFileSync(eventPath, JSON.stringify(payload));
  requests = [];
  const env = {
    PATH: process.env.PATH,
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: REPO,
    GITHUB_API_URL: apiUrl,
    GITHUB_TOKEN: TOKEN,
    GITHUB_SHA: 'b'.repeat(40),
    ...extraEnv,
  };
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT], { env });
  assert.ok(!stdout.includes(TOKEN) && !stderr.includes(TOKEN), 'token vazou na saída');
  const jobs = JSON.parse(stdout).include.map((e) => `${e.task} ${e.workspace}`);
  return { jobs, stderr, requests };
}

const files = (n, dir) => Array.from({ length: n }, (_, i) => ({ filename: `${dir}/f${i}.ts`, status: 'modified' }));
const ALL = [
  'typecheck @hyperframe/desktop',
  'build @hyperframe/desktop',
  'typecheck @hyperframe/engine',
  'test @hyperframe/engine',
];
const DESKTOP = ALL.slice(0, 2);

test('PR: pagina os arquivos (250 em 3 páginas)', async () => {
  const all = files(250, 'apps/desktop/src');
  handler = (u) => {
    const page = Number(u.searchParams.get('page'));
    assert.equal(u.pathname, `/repos/${REPO}/pulls/7/files`);
    assert.equal(u.searchParams.get('per_page'), '100');
    return [200, all.slice((page - 1) * 100, page * 100)];
  };
  const r = await run('pull_request', { pull_request: { number: 7, changed_files: 250 } });
  assert.deepEqual(r.jobs, DESKTOP);
  assert.equal(r.requests.length, 3);
  assert.ok(r.requests.every((q) => q.auth === `Bearer ${TOKEN}`));
});

test('PR: 3000+ arquivos (limite da API) roda tudo', async () => {
  handler = () => [200, files(100, 'README-dir').map((f) => ({ ...f, filename: `${f.filename}.md` }))];
  const r = await run('pull_request', { pull_request: { number: 7, changed_files: 3500 } });
  assert.deepEqual(r.jobs, ALL);
  assert.equal(r.requests.length, 30);
  assert.match(r.stderr, /::warning::PR com 3500 arquivos, a API listou 3000/);
});

test('PR: API listou menos que changed_files roda tudo', async () => {
  handler = () => [200, files(20, 'apps/desktop')];
  const r = await run('pull_request', { pull_request: { number: 7, changed_files: 21 } });
  assert.deepEqual(r.jobs, ALL);
  assert.match(r.stderr, /::warning::/);
});

test('PR: só docs => matrix vazia', async () => {
  handler = () => [200, [{ filename: 'README.md' }, { filename: 'site/index.html' }]];
  const r = await run('pull_request', { pull_request: { number: 7, changed_files: 2 } });
  assert.deepEqual(r.jobs, []);
});

test('push: compare com rename conta o caminho antigo também', async () => {
  handler = (u) => {
    assert.equal(u.pathname, `/repos/${REPO}/compare/${'a'.repeat(40)}...${'c'.repeat(40)}`);
    return [200, { status: 'ahead', files: [{ filename: 'docs/x.md', previous_filename: 'apps/desktop/x.ts', status: 'renamed' }] }];
  };
  const r = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, DESKTOP);
});

test('push: só engine => engine + desktop (dependente)', async () => {
  handler = () => [200, { status: 'ahead', files: [{ filename: 'packages/engine/src/index.ts' }] }];
  const r = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, ALL);
});

test('push: compare com 300 arquivos (truncado) roda tudo', async () => {
  handler = () => [200, { status: 'ahead', files: files(300, 'apps/desktop') }];
  const r = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, ALL);
  assert.match(r.stderr, /::warning::compare com 300 arquivos/);
});

test('push: force-push (diverged) roda tudo', async () => {
  handler = () => [200, { status: 'diverged', files: [{ filename: 'README.md' }] }];
  const r = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, ALL);
});

test('push: 404 roda tudo sem nova tentativa', async () => {
  handler = () => [404, { message: 'Not Found' }];
  const r = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, ALL);
  assert.equal(r.requests.length, 1);
  assert.match(r.stderr, /::warning::HTTP 404/);
});

test('push: 5xx tenta de novo uma vez', async () => {
  let n = 0;
  handler = () => (n++ === 0 ? [502, {}] : [200, { status: 'ahead', files: [{ filename: 'apps/desktop/a.ts' }] }]);
  const ok = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(ok.jobs, DESKTOP);
  assert.equal(ok.requests.length, 2);

  handler = () => [503, {}];
  const fail = await run('push', { before: 'a'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(fail.jobs, ALL);
  assert.equal(fail.requests.length, 2);
});

test('push: before zerado roda tudo sem chamar a API', async () => {
  const r = await run('push', { before: '0'.repeat(40), after: 'c'.repeat(40) });
  assert.deepEqual(r.jobs, ALL);
  assert.equal(r.requests.length, 0);
});

test('workflow_dispatch roda tudo', async () => {
  const r = await run('workflow_dispatch', {});
  assert.deepEqual(r.jobs, ALL);
  assert.equal(r.requests.length, 0);
});

test('CHANGED_FILES tem prioridade sobre o evento', async () => {
  const r = await run('push', { before: 'a'.repeat(40) }, { CHANGED_FILES: 'apps/desktop/a.ts\nREADME.md\n' });
  assert.deepEqual(r.jobs, DESKTOP);
  assert.equal(r.requests.length, 0);
});
