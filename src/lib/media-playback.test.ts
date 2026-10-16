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

it('issues an opted-in native ad-filter link and rejects invalid filter values', async () => {
  const headers = { cookie: `${SESSION_COOKIE}=${signSession().token}` };
  const request = (adFilter: unknown) => new Request('https://local.test/api/playback', { method: 'POST', headers, body: JSON.stringify({ url: target, adFilter }) });
  expect((await POST(request('true'))).status).toBe(400);
  const data = await (await POST(request(true))).json();
  expect(data.adFilter).toBe(true);
  const link = new URL(data.path, 'https://local.test');
  expect(link.searchParams.get('adFilter')).toBe('1');
  expect(verifyMediaURL(target, link.searchParams.get('mediaExpires'), link.searchParams.get('mediaSignature'))).toBe(true);
  const disabled = await (await POST(request(false))).json();
  expect(disabled.adFilter).toBe(false);
  expect(new URL(disabled.path, 'https://local.test').searchParams.has('adFilter')).toBe(false);
});

it('keeps native filtering on nested playlists and preserves signed receiver playback', async () => {
  const expiry = Date.now() + 60000;
  const signed = (url: string, filter: boolean) => `https://local.test/api/proxy?url=${encodeURIComponent(url)}&mediaExpires=${expiry}&mediaSignature=${signMediaURL(url, expiry)}${filter ? '&adFilter=1' : ''}`;
  vi.mocked(fetchWithSafeRedirects).mockResolvedValue({ res: new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant.m3u8', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }), finalUrl: target });
  const master = await (await handleProxyRequest(new Request(signed(target, true)), target)).text();
  const childPath = master.split('\n').find((line) => line.startsWith('/api/proxy'))!;
  const child = new URL(childPath, 'https://local.test');
  expect(child.searchParams.get('adFilter')).toBe('1');
  const childTarget = child.searchParams.get('url')!;
  expect(verifyMediaURL(childTarget, child.searchParams.get('mediaExpires'), child.searchParams.get('mediaSignature'))).toBe(true);
  const playlist = '#EXTM3U\n#EXTINF:10,\nreal-a.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:3,\n/video/adjump/time/ad.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\nreal-b.ts\n#EXT-X-ENDLIST';
  const upstream = () => ({ res: new Response(playlist, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }), finalUrl: childTarget });
  vi.mocked(fetchWithSafeRedirects).mockResolvedValue(upstream());
  const filtered = await (await handleProxyRequest(new Request(child), childTarget)).text();
  expect(filtered).not.toContain('adjump');
  expect(filtered).toContain('real-a.ts'); expect(filtered).toContain('real-b.ts');
  for (const path of filtered.match(/\/api\/proxy\?[^"\n]+/g)!) {
    const segment = new URL(path, 'https://local.test');
    expect(segment.searchParams.get('adFilter')).toBe('1');
    expect(verifyMediaURL(segment.searchParams.get('url')!, String(expiry), segment.searchParams.get('mediaSignature'))).toBe(true);
  }
  vi.mocked(fetchWithSafeRedirects).mockResolvedValue(upstream());
  const unfiltered = await (await handleProxyRequest(new Request(signed(childTarget, false)), childTarget)).text();
  expect(unfiltered).toContain('adjump');
  expect((await handleProxyRequest(new Request(`https://local.test/api/proxy?adFilter=1`), childTarget)).status).toBe(401);
});
