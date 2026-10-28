import { ContentProfileError } from '@/lib/content-profiles';
import { readAdminEpisodeSources } from '@/lib/admin-profile-config';
import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { serverSourceMode } from '@/lib/server-sources';
import { getSourceAdapter } from '@/lib/source-adapters';
import { DetailLoadError, loadVideoDetail } from '@/lib/video-detail';
import { clearImportedEpisodeTitles, enrichEpisodeTitles, EpisodeRevisionConflict, mergeEpisodeTitles, readEpisodeSnapshot, saveImportedEpisodeTitles, saveManualEpisodeTitles } from '@/lib/episode-metadata';
import { importEpisodeMetadata, searchEpisodeMetadata, sourceEpisodeOrderIsRegular, type EpisodeProvider } from '@/lib/episode-providers';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const bad = (message: string): never => { throw new DetailLoadError(400, message); };
function inputText(value: unknown, name: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return bad(`${name}无效`);
  return value.trim();
}
function check(req: Request) {
  return guardAdminRequest(req) || (!serverSourceMode() ? reply({ error: '未开启服务器源管理模式' }, 409) : null);
}
async function sourceFor(req: Request, value: unknown) { const key=inputText(value,'源编号'); const sources=await readAdminEpisodeSources(req); const found=sources.find(source=>source.key===key); if(!found)bad('点播源不存在'); return found!; }
function filmId(value: unknown) { const id = inputText(value, '影片编号'); if (!/^[\w-]+$/.test(id)) bad('影片编号无效'); return id; }
function providerFor(value: unknown): EpisodeProvider { if (value !== 'bangumi' && value !== 'tvmaze') return bad('资料提供方无效'); return value; }
function revisionFor(value: unknown): string { const revision = inputText(value, '版本'); if (!/^[a-f0-9]{64}$/.test(revision)) bad('版本无效'); return revision; }
function failed(error: unknown) {
  return reply({ error: error instanceof Error ? error.message : '分集资料操作失败' }, error instanceof EpisodeRevisionConflict ? 409 : error instanceof DetailLoadError || error instanceof ContentProfileError ? error.status : 502);
}

export async function GET(req: Request) {
  const guarded = check(req); if (guarded) return guarded;
  try {
    const params = new URL(req.url).searchParams;
    if (params.get('action') === 'sources') return reply({ sources: await readAdminEpisodeSources(req) });
    const source = await sourceFor(req, params.get('sourceKey'));
    const id = filmId(params.get('id'));
    const raw = await loadVideoDetail(source, id, req.signal);
    await enrichEpisodeTitles(source, id, raw);
    const snapshot = await readEpisodeSnapshot(source, id, raw);
    return reply({ ...snapshot, raw, detail: mergeEpisodeTitles(raw, snapshot) });
  } catch (error) { return failed(error); }
}

export async function POST(req: Request) {
  const guarded = check(req); if (guarded) return guarded;
  let fields: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('请求格式无效');
    fields = value as Record<string, unknown>;
  } catch { return reply({ error: '请求格式无效' }, 400); }
  try {
    if (fields.action === 'lookup') {
      const provider = providerFor(fields.provider);
      return reply({ candidates: await searchEpisodeMetadata(provider, inputText(fields.query, '片名'), req.signal) });
    }
    const source = await sourceFor(req, fields.sourceKey);
    if (fields.action === 'search') {
      const page = await getSourceAdapter(source).searchPage(source, inputText(fields.query, '片名'), 1, { timeoutMs: 10000, signal: req.signal });
      return reply({ list: page.list.slice(0, 30) });
    }
    const id = filmId(fields.vodId);
    const raw = await loadVideoDetail(source, id, req.signal);
    if (fields.action === 'import') {
      const provider = providerFor(fields.provider);
      const subjectId = Number(fields.subjectId); const season = Number(fields.season ?? 1);
      if (!Number.isSafeInteger(subjectId) || subjectId < 1 || !Number.isSafeInteger(season) || season < 1 || season > 100) bad('节目或季数无效');
      if (!sourceEpisodeOrderIsRegular(raw)) bad('播放源集序含特别篇或非标准编号，不能自动对应；请手动填写');
      const imported = await importEpisodeMetadata(provider, subjectId, season, raw.episodes.length, req.signal);
      await saveImportedEpisodeTitles(source, id, raw, imported, revisionFor(fields.revision));
    } else if (fields.action === 'save') {
      if (!Array.isArray(fields.manualTitles) || fields.manualTitles.length !== raw.episodes.length || fields.manualTitles.some((title) => typeof title !== 'string' || title.length > 300) || typeof fields.autoDisabled !== 'boolean') bad('手动标题或自动补充设置无效');
      await saveManualEpisodeTitles(source, id, raw, fields.manualTitles, revisionFor(fields.revision), fields.autoDisabled as boolean);
    } else if (fields.action === 'clear-import') {
      await clearImportedEpisodeTitles(source, id, raw, revisionFor(fields.revision));
    } else bad('操作无效');
    const snapshot = await readEpisodeSnapshot(source, id, raw);
    return reply({ ...snapshot, raw, detail: mergeEpisodeTitles(raw, snapshot) });
  } catch (error) { return failed(error); }
}
