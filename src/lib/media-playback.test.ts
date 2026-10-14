import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signMediaURL, verifyMediaURL, signSession, SESSION_COOKIE } from './auth';
import { handleProxyRequest } from './proxy-handlers';
import { fetchWithSafeRedirects } from './fetch-utils';
import { POST } from '../app/api/playback/route';

vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) } }));
beforeEach(() => vi.stubEnv('PASSWORD', 'media-test-password'));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
const target = 'https://8.8.8.8/movie/master.m3u8';

it('binds credentials to target and expiration; rejects tampering, expiration and session tokens', () => {
  const expiry = Date.now() + 60000;
  const sig = signMediaURL(target, expiry);
  expect(verifyMediaURL(target, String(expiry), sig)).toBe(true);
  expect(verifyMediaURL(target + 'other', String(expiry), sig)).toBe(false);
  expect(verifyMediaURL(target, String(expiry + 1), sig)).toBe(false);
  expect(verifyMediaURL(target, String(Date.now() - 1), sig)).toBe(false);
  expect(verifyMediaURL(target, String(expiry), signSession().token)).toBe(false);
});

it('requires a session to issue a link and rejects private targets', async () => {
  const headers = { cookie: `${SESSION_COOKIE}=${signSession().token}` };
  expect((await POST(new Request('https://local.test/api/playback', { method: 'POST', body: JSON.stringify({url: target}) }))).status).toBe(401);
  expect((await POST(new Request('https://local.test/api/playback', { method: 'POST', headers, body: JSON.stringify({url: 'http://127.0.0.1/private'}) }))).status).toBe(400);
  const result = await POST(new Request('https://local.test/api/playback', { method: 'POST', headers, body: JSON.stringify({url: target}) }));
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('no-store');
  const link = new URL((await result.json()).path, 'https://local.test');
  expect(verifyMediaURL(target, link.searchParams.get('mediaExpires'), link.searchParams.get('mediaSignature'))).toBe(true);
});

it('allows cookie-free receiver playback and signs nested playlists, audio, keys, maps and segments with the original expiry', async () => {
  const expiry = Date.now() + 60000;
  const request = new Request(`https://local.test/api/proxy?url=${encodeURIComponent(target)}&mediaExpires=${expiry}&mediaSignature=${signMediaURL(target, expiry)}`);
  vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\nvariant.m3u8\nsegment.ts\n', { headers: {'content-type': 'application/vnd.apple.mpegurl'} }), finalUrl: target });
  const response = await handleProxyRequest(request, target);
  expect(response.status).toBe(200);
  const playlist = await response.text();
  const paths = playlist.match(/\/api\/proxy\?[^"\n]+/g)!;
  expect(paths).toHaveLength(5);
  for (const path of paths) {
    const url = new URL(path, 'https://local.test');
    const child = url.searchParams.get('url')!;
    expect(url.searchParams.get('mediaExpires')).toBe(String(expiry));
    expect(verifyMediaURL(child, String(expiry), url.searchParams.get('mediaSignature'))).toBe(true);
    vi.mocked(fetchWithSafeRedirects).mockResolvedValue({res: new Response('segment'), finalUrl: child});
    expect((await handleProxyRequest(new Request(url), child)).status).toBe(200);
    expect((await handleProxyRequest(new Request(url), 'https://8.8.8.8/other')).status).toBe(401);
  }
});
