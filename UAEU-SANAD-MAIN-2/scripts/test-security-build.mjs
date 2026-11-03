// Browser regression against the built shell and the actual generated IIS CSP.
// All API/third-party calls are stubbed; no live identity or university systems.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../dist/client');
const config = await readFile(resolve(root, 'web.config'), 'utf8');
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const headerMap = xml => Object.fromEntries([...xml.matchAll(/<add name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const baseHeaders = headerMap(config);
const surveyHeaders = { ...baseHeaders, ...headerMap(await readFile(resolve(root, 'survey/web.config'), 'utf8')) };
assert(!baseHeaders['Content-Security-Policy'].match(/script-src [^;]*'unsafe-inline'/));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path === '/mock-idp') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>Mock identity provider</h1>'); return; }
    const file = path.startsWith('/assets/') ? resolve(root, '.' + path) : resolve(root, 'index.html');
    assert(file.startsWith(root + '\\') || file.startsWith(root + '/'));
    res.writeHead(200, { ...(path.startsWith('/survey') ? surveyHeaders : baseHeaders), 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
const externalOrigin = process.env.SANADI_BROWSER_ORIGIN;
if (externalOrigin && !['localhost', '127.0.0.1'].includes(new URL(externalOrigin).hostname))
  throw new Error('Browser regression may only target a local test server');
if (!externalOrigin) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = externalOrigin || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  const context = await browser.newContext();
  let ssoChallenge = '';
  let surveyOpened = false;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/mock-idp')
      return route.fulfill({ contentType: 'text/html', body: '<h1>Mock identity provider</h1>' });
    if (url.origin === origin) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-sanadi-sso-flow-id,authorization' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/api/v1/auth/sso/authorize') {
      ssoChallenge = url.searchParams.get('challenge');
      return route.fulfill({ json: { authorizationUrl: origin + '/mock-idp' }, headers });
    }
    if (url.pathname === '/api/survey/open') return route.fulfill({ json: {
      caseNumber: 'TEST-1', serviceType: 'Test survey', scriptUrl: 'https://www.uaeu.ac.ae/mock-pulse.js',
      fullSequenceCode: 'sequence', webLinkingId: 'link', language: 'en',
    }, headers });
    if (url.href === 'https://www.uaeu.ac.ae/mock-pulse.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.CustomerPulse={}; window.wsMyAppModel={initSurveySSB(){window.__surveyOpened=true;}};' });
    if (url.hostname === 'code.jquery.com') return route.fulfill({ contentType: 'text/javascript', body: 'window.jQuery={};' });
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.pathname.endsWith('/sso/trace')) return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 401, json: { code: 'unauthorized' }, headers });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Start with Sanadi', exact: true }).first().waitFor();
  assert.deepEqual(errors, [], 'Bootstrap/hydration errors');

  // A dynamically injected inline script must not execute under the published CSP.
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__unsafeInlineRan=true;';
    document.body.appendChild(script);
  });
  assert.equal(await page.evaluate(() => window.__unsafeInlineRan), undefined);
  // wasm-unsafe-eval remains scoped to WebAssembly, preserving the voice engine.
  assert.equal(await page.evaluate(async () => {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return true;
  }), true);
  await page.getByRole('button', { name: 'Start with Sanadi', exact: true }).first().click();
  await page.waitForURL(origin + '/mock-idp');
  assert.match(ssoChallenge, /^[A-Za-z0-9_-]{43}$/);

  // Direct SSO callback bootstrap and the protected-route redirect still run.
  await page.goto(origin + '/auth/callback?ssoTicket=synthetic-invalid');
  await page.waitForURL(url => url.origin === origin && url.pathname.replace(/\/$/, '') === '/auth/callback' && !url.search);
  await page.getByRole('heading', { name: 'Unable to continue with SSO' }).waitFor();
  await page.goto(origin + '/admin');
  await page.waitForURL(origin + '/mock-idp');

  await page.goto(origin + '/survey?data=synthetic');
  await page.waitForFunction(() => window.__surveyOpened === true);
  surveyOpened = await page.evaluate(() => window.__surveyOpened === true);
  assert(surveyOpened, 'Survey loader allowed only on survey page');
  assert.deepEqual(errors, [], 'No runtime JS errors');
  console.log('PASS: production CSP hydration, injected-script blocking, WASM, SSO start/callback, protected-route redirect, survey loader');
  await context.close();
} finally {
  await browser.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
