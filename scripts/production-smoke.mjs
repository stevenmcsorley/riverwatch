import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['server/server.mjs'], {
  env: { ...process.env, PORT: '0', OPENROUTER_API_KEY: '', MET_OFFICE_API_KEY: '', MET_OFFICE_MAP_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Production server did not start')), 10_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', data => {
      const match = String(data).match(/listening on http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base);
  assert.equal(response.status, 200, 'The site root must serve the dashboard');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const html = await response.text();
  assert(html.includes('<title>RiverWatch'));
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
  assert(asset, 'Dashboard must reference its built JavaScript');
  const script = await fetch(base + asset);
  assert.equal(script.status, 200);
  assert(script.headers.get('cache-control').includes('immutable'));
  const health = await fetch(base + '/api/health');
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/nonexistent')).status, 404);
  console.log('Production dashboard, assets, health and cache headers passed');
} finally {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}
