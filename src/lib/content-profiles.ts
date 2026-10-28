import { createHash, randomUUID } from 'node:crypto';
import { getAccountAuth, getAccountSession } from './account-auth';
import { accountMode } from './account-mode';
import { readServerSources, normalizeServerSources, serverSourceMode, type ServerSources } from './server-sources';
import { readRecommendations } from './server-recommendations';
import { normalizeRecommendationConfig, type RecommendationConfig, type RecommendationSnapshot } from './recommendation-config';
import { sourceProtocolIdentity } from './source-config';
import type { SourceConfig } from './types';
export class ContentProfileError extends Error { constructor(message: string, public status = 400) { super(message); } }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface StoredProfile { id: string; name: string; sources: string; recommendations: string; createdAt: number; updatedAt: number; }
export interface ContentProfile { id: string; name: string; sources: ServerSources; recommendations: RecommendationSnapshot; revision: string; }
export const DEFAULT_PROFILE = 'default';
export function validateProfileId(value: string) {
  if (value !== DEFAULT_PROFILE && !/^[0-9a-f-]{36}$/.test(value)) throw new ContentProfileError('内容方案编号无效');
  return value;
}
export async function readContentProfile(id = DEFAULT_PROFILE): Promise<ContentProfile> {
  validateProfileId(id);
  if (id === DEFAULT_PROFILE) {
    const [sources, recommendations] = await Promise.all([readServerSources(), readRecommendations()]);
    return { id, name: '默认方案', sources, recommendations, revision: hash([id,sources.revision,recommendations.revision]) };
  }
  const { database } = await getAccountAuth();
  const row = database.prepare('SELECT * FROM content_profile WHERE id=?').get(id) as StoredProfile | undefined;
  if (!row) throw new ContentProfileError('内容方案不存在，请联系管理员', 404);
  const sources = normalizeServerSources(JSON.parse(row.sources)), home = normalizeRecommendationConfig(JSON.parse(row.recommendations));
  return { id, name: row.name, sources: { sources, revision: hash(sources) }, recommendations: { ...home, revision: hash(home) }, revision: hash([id,sources,home]) };
}
export async function saveProfilePart(id: string, part: 'sources' | 'recommendations', value: unknown, revision: string) {
  validateProfileId(id);
  if (id === DEFAULT_PROFILE) throw new ContentProfileError('默认方案请使用原有配置入口');
  const next = part === 'sources' ? normalizeServerSources(value) : normalizeRecommendationConfig(value);
  const { database } = await getAccountAuth();
  database.transaction(() => {
    const row = database.prepare(`SELECT ${part} AS value FROM content_profile WHERE id=?`).get(id) as { value: string } | undefined;
    if (!row) throw new ContentProfileError('内容方案不存在',404);
    if (hash(part === 'sources' ? normalizeServerSources(JSON.parse(row.value)) : normalizeRecommendationConfig(JSON.parse(row.value))) !== revision) throw new ContentProfileError('方案已更新，请重新加载后编辑',409);
    database.prepare(`UPDATE content_profile SET ${part}=?,updatedAt=? WHERE id=?`).run(JSON.stringify(next),Date.now(),id);
  }).immediate();
  return part === 'sources' ? { sources: next as SourceConfig[], revision: hash(next) } : { ...next as RecommendationConfig, revision: hash(next) };
}
export async function listContentProfiles(userId?: string) {
  const { database } = await getAccountAuth();
  const defaults = (database.prepare('SELECT COUNT(*) AS n FROM user WHERE id NOT IN(SELECT userId FROM account_content_profile)').get() as {n:number}).n;
  const rows = database.prepare(`SELECT p.id,p.name,p.createdAt,p.updatedAt,(SELECT COUNT(*) FROM account_content_profile a WHERE a.profileId=p.id) AS accounts FROM content_profile p ORDER BY p.createdAt,p.id`).all();
  const assigned = userId ? database.prepare('SELECT profileId FROM account_content_profile WHERE userId=?').get(userId) as {profileId:string}|undefined : undefined;
  return { profiles: [{id:DEFAULT_PROFILE,name:'默认方案',accounts:defaults},...rows as object[]], selected: assigned?.profileId ?? DEFAULT_PROFILE };
}
export async function mutateContentProfiles(body: Record<string,unknown>) {
  const { database } = await getAccountAuth();
  if (body.action === 'assign') {
    const id = typeof body.profileId === 'string' ? validateProfileId(body.profileId) : '';
    if (!id) throw new ContentProfileError('请选择内容方案');
    if (id !== DEFAULT_PROFILE && !database.prepare('SELECT id FROM content_profile WHERE id=?').get(id)) throw new ContentProfileError('内容方案不存在',404);
    if (!Array.isArray(body.userIds) || !body.userIds.length || body.userIds.length>100 || body.userIds.some(value=>typeof value!=='string'||value.length>128)) throw new ContentProfileError('请选择 1–100 个账号');
    database.transaction(() => {
      for (const userId of new Set(body.userIds as string[])) {
        if (!database.prepare('SELECT id FROM user WHERE id=?').get(userId)) throw new ContentProfileError('所选账号已变更，请刷新列表',404);
        if (id === DEFAULT_PROFILE) database.prepare('DELETE FROM account_content_profile WHERE userId=?').run(userId);
        else database.prepare('INSERT INTO account_content_profile VALUES(?,?) ON CONFLICT(userId) DO UPDATE SET profileId=excluded.profileId').run(userId,id);
      }
    }).immediate();
    return { success: true };
  }
  const name = typeof body.name==='string' ? body.name.trim() : '';
  if (!name || name.length>50) throw new ContentProfileError('方案名称需为 1–50 个字符');
  if (body.action === 'create') {
    const template = await readContentProfile(typeof body.copyFrom==='string' ? body.copyFrom : DEFAULT_PROFILE);
    const id=randomUUID(),now=Date.now();
    database.transaction(() => {
      if ((database.prepare('SELECT COUNT(*) AS n FROM content_profile').get() as {n:number}).n>=30) throw new ContentProfileError('最多创建 30 个自定义方案');
      database.prepare('INSERT INTO content_profile VALUES(?,?,?,?,?,?)').run(id,name,JSON.stringify(template.sources.sources),JSON.stringify({sources:template.recommendations.sources,defaultSource:template.recommendations.defaultSource}),now,now);
    }).immediate();
    return {id};
  }
  if (body.action === 'rename' && typeof body.profileId==='string' && body.profileId!==DEFAULT_PROFILE) {
    if (!database.prepare('UPDATE content_profile SET name=?,updatedAt=? WHERE id=?').run(name,Date.now(),validateProfileId(body.profileId)).changes) throw new ContentProfileError('方案不存在',404);
    return {success:true};
  }
  throw new ContentProfileError('操作无效');
}
export function exposedProfileSources(profile: ContentProfile): SourceConfig[] {
  if (profile.id===DEFAULT_PROFILE) return profile.sources.sources;
  return profile.sources.sources.map(source=>({...source,key:`cp_${hash([profile.id,source.key,source.url,source.detail??'',...sourceProtocolIdentity(source)]).slice(0,40)}`}));
}
export async function readViewerContent(req: Request): Promise<ContentProfile> {
  if (!accountMode() || !serverSourceMode()) return readContentProfile();
  const session=await getAccountSession(req.headers);
  if (!session) throw new ContentProfileError('请重新登录账号',401);
  const { database }=await getAccountAuth();
  const assigned=database.prepare('SELECT profileId FROM account_content_profile WHERE userId=?').get(session.user.id) as {profileId:string}|undefined;
  return readContentProfile(assigned?.profileId);
}
export async function readViewerSnapshot(req: Request) {
  const profile=await readViewerContent(req);
  return {
    sources:{sources:exposedProfileSources(profile),revision:accountMode()?profile.revision:profile.sources.revision},
    recommendations:accountMode()&&serverSourceMode()?{...profile.recommendations,revision:hash([profile.id,profile.recommendations.revision])}:profile.recommendations,
    profile:{id:profile.id,name:profile.name},
  };
}
export async function readViewerSources(req: Request): Promise<ServerSources> {
  if (!accountMode()) return readServerSources();
  const profile=await readViewerContent(req);
  return {sources:exposedProfileSources(profile),revision:profile.revision};
}
export async function readViewerRecommendations(req: Request): Promise<RecommendationSnapshot> {
  if (!accountMode() || !serverSourceMode()) return readRecommendations();
  const profile=await readViewerContent(req);
  return {...profile.recommendations,revision:hash([profile.id,profile.recommendations.revision])};
}
/** Legacy fixed-provider URLs cannot represent a custom scheme's editable feed mapping. */
export async function legacyRecommendationAllowed(req: Request) {
  return !accountMode() || !serverSourceMode() || (await readViewerContent(req)).id===DEFAULT_PROFILE;
}
