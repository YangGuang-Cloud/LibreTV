import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {getAccountAuth} from './account-auth';
import {generateLicenses} from './account-licenses';
import {readContentProfile,saveProfilePart,mutateContentProfiles,listContentProfiles,readViewerContent,readViewerRecommendations} from './content-profiles';
import {resolveServerSources} from './server-sources';
import {POST as register} from '@/app/api/account/register/route';
import {POST as login} from '@/app/api/auth/route';
import {GET as config} from '@/app/api/server/config/route';
import {GET as status} from '@/app/api/status/route';
import {GET as feed} from '@/app/api/recommendations/feed/route';
import {POST as search} from '@/app/api/search/route';
import {GET as detail} from '@/app/api/detail/route';
import {GET as legacyHome} from '@/app/api/douban/route';
import {GET as listAdmin,POST as mutateAdmin} from '@/app/api/admin/content-profiles/route';
import {GET as getAdminSources,PUT as putAdminSources} from '@/app/api/admin/sources/route';
import {GET as getAdminEpisodes,POST as postAdminEpisodes} from '@/app/api/admin/episodes/route';
import {POST as probe} from '@/app/api/source/test/route';
import {fetchUpstream} from './fetch-utils';
import {loadRecommendationFeed} from './recommendation-feed';
import {ADMIN_SESSION_COOKIE,signAdminSession} from './admin-auth';
vi.mock('./fetch-utils',async original=>{const actual=await original<typeof import('./fetch-utils')>();return{...actual,fetchUpstream:vi.fn(async()=>new Response(JSON.stringify({list:[]}))),getCache:vi.fn(()=>undefined),setCache:vi.fn()};});
vi.mock('./recommendation-feed',()=>({loadRecommendationFeed:vi.fn(async()=>[{id:'1',title:'方案推荐',cover:'https://8.8.8.8/cover.jpg',rating:''}])}));
const base='http://localhost:8080';let directory:string,adminCookie:string,cookieA:string,cookieB:string,userA:string,userB:string,profileId:string;
const request=(url:string,method='GET',body?:unknown,cookie?:string)=>new Request(base+url,{method,headers:{Origin:base,'Content-Type':'application/json','X-Luna-Device-ID':'11111111-1111-4111-8111-111111111111',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const content=()=>request('/api/server/config','GET',undefined,cookieA);
beforeAll(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'luna-profiles-'));
 vi.stubEnv('AUTH_MODE','account');vi.stubEnv('SOURCE_MODE','server');vi.stubEnv('SERVER_DATA_DIR',directory);vi.stubEnv('BETTER_AUTH_URL',base);vi.stubEnv('BETTER_AUTH_SECRET','profile-test-secret-at-least-32-characters');vi.stubEnv('ADMIN_PASSWORD','admin-pass');
 vi.stubEnv('DEFAULT_SOURCES',JSON.stringify([{name:'默认点播',url:'https://8.8.8.8/vod'}]));adminCookie=`${ADMIN_SESSION_COOKIE}=${signAdminSession().token}`;
 const {database}=await getAccountAuth();
 for(const name of ['ProfileUserA','ProfileUserB']){
  const [code]=generateLicenses(database,{count:1,days:30,redeemBefore:null});expect((await register(request('/api/account/register','POST',{username:name,password:'123456',code:code.code}))).status).toBe(200);
  const response=await login(request('/api/auth','POST',{username:name,password:'123456'}));expect(response.status).toBe(200);
  const cookie=cookies(response);const state=await(await status(request('/api/status','GET',undefined,cookie))).json();
  if(name.endsWith('A')){cookieA=cookie;userA=state.user.id;}else{cookieB=cookie;userB=state.user.id;}
 }
});
afterAll(async()=>{(await getAccountAuth()).database.close();delete(globalThis as typeof globalThis &{lunaAccounts?:unknown}).lunaAccounts;vi.unstubAllEnvs();await fs.rm(directory,{recursive:true,force:true});});
it('原账号默认方案保持现有内容，只有独立管理员能管理方案',async()=>{
 const value=await(await config(content())).json();expect(value.sources[0]).toMatchObject({key:'env_0',name:'默认点播'});
 expect((await listAdmin(request('/api/admin/content-profiles'))).status).toBe(401);expect((await listAdmin(request('/api/admin/content-profiles','GET',undefined,cookieA))).status).toBe(401);
 const list=await(await listAdmin(request('/api/admin/content-profiles','GET',undefined,adminCookie))).json();expect(list.profiles[0]).toMatchObject({id:'default',accounts:2});
});
it('可复制独立方案，修改不影响默认方案，旧版本写入冲突被拒绝',async()=>{
 const created=await mutateContentProfiles({action:'create',name:'方案 A',copyFrom:'default'});profileId=(created as {id:string}).id;
 const initial=await readContentProfile(profileId);expect(initial.sources.sources[0].name).toBe('默认点播');
 await saveProfilePart(profileId,'sources',[{key:'custom',name:'独立点播',url:'https://1.1.1.1/vod'}],initial.sources.revision);
 await expect(saveProfilePart(profileId,'sources',[],initial.sources.revision)).rejects.toMatchObject({status:409});
 const changed=await readContentProfile(profileId);expect(changed.sources.sources[0].name).toBe('独立点播');expect((await readContentProfile()).sources.sources[0].name).toBe('默认点播');
 const home={sources:[{id:'privatehome',name:'专属首页',enabled:true,feeds:[{id:'first',name:'精选',url:'https://1.1.1.1/home',mapping:{listPath:'items',idPath:'id',titlePath:'title',coverPath:'cover',ratingPath:'rating'}}]}],defaultSource:'privatehome'};
 await saveProfilePart(profileId,'recommendations',home,changed.recommendations.revision);
});
it('分配方案后原 Cookie 直接取得新首页和点播源，另一个账号保持默认',async()=>{
 const before=await(await config(content())).json();
 const response=await mutateAdmin(request('/api/admin/content-profiles','POST',{action:'assign',profileId,userIds:[userA]},adminCookie));expect(response.status).toBe(200);
 const current=await(await config(content())).json();expect(current.revision).not.toBe(before.revision);expect(current.sources[0].name).toBe('独立点播');expect(current.sources[0].key).toMatch(/^cp_/);expect(current.recommendations.defaultSource).toBe('privatehome');expect(JSON.stringify(current)).not.toContain('1.1.1.1');
 const other=await(await config(request('/api/server/config','GET',undefined,cookieB))).json();expect(other.sources[0].key).toBe('env_0');
 const website=await(await status(request('/api/status','GET',undefined,cookieA))).json();expect(website.contentRevision).toBe(current.revision);expect(website.defaultSources[0].key).toBe(current.sources[0].key);
});
it('猜测别人的源编号或传入源 URL 不能绕过搜索和详情权限，拒绝前不请求上游',async()=>{
 vi.mocked(fetchUpstream).mockClear();
 await expect(resolveServerSources(['env_0'],content())).rejects.toThrow();
 expect((await search(request('/api/search','POST',{wd:'测试',sourceKeys:['env_0'],sources:[{key:'env_0',name:'伪造',url:'https://8.8.8.8/vod'}]},cookieA))).status).toBe(400);
 expect((await detail(request('/api/detail?id=1&sourceKey=env_0','GET',undefined,cookieA))).status).toBe(400);
 expect(fetchUpstream).not.toHaveBeenCalled();
 const own=await(await config(content())).json();expect((await resolveServerSources([own.sources[0].key],content()))[0].url).toBe('https://1.1.1.1/vod');
 expect((await search(request('/api/search','POST',{wd:'方案测试',sourceKeys:[own.sources[0].key]},cookieA))).status).toBe(200);
 expect(fetchUpstream).toHaveBeenCalledWith(expect.stringContaining('https://1.1.1.1/vod?'),expect.anything());
});
it('分集资料只显示当前方案来源，并拒绝跨方案搜索',async()=>{
 const endpoint=`/api/admin/episodes?profileId=${profileId}`;
 expect((await getAdminEpisodes(request(`${endpoint}&action=sources`,'GET',undefined,cookieA))).status).toBe(401);
 const own=await(await config(content())).json();
 const sources=await(await getAdminEpisodes(request(`${endpoint}&action=sources`,'GET',undefined,adminCookie))).json();
 expect(sources.sources).toHaveLength(1);expect(sources.sources[0].key).toBe(own.sources[0].key);
 const defaults=await(await getAdminEpisodes(request('/api/admin/episodes?action=sources','GET',undefined,adminCookie))).json();
 expect(defaults.sources[0].key).toBe('env_0');
 vi.mocked(fetchUpstream).mockClear();
 expect((await postAdminEpisodes(request(endpoint,'POST',{action:'search',sourceKey:'env_0',query:'测试'},adminCookie))).status).toBe(400);
 expect((await postAdminEpisodes(request('/api/admin/episodes','POST',{action:'search',sourceKey:own.sources[0].key,query:'测试'},adminCookie))).status).toBe(400);
 expect(fetchUpstream).not.toHaveBeenCalled();
 expect((await postAdminEpisodes(request(endpoint,'POST',{action:'search',sourceKey:own.sources[0].key,query:'测试'},adminCookie))).status).toBe(200);
 expect(fetchUpstream).toHaveBeenCalledWith(expect.stringContaining('https://1.1.1.1/vod?'),expect.anything());
});
it('源检测按账号方案选择服务端适配器，客户端类型与地址不能覆盖配置',async()=>{
 const own=await(await config(content())).json();vi.mocked(fetchUpstream).mockClear();
 expect((await probe(request('/api/source/test','POST',{sourceKey:'env_0',url:'https://8.8.8.8/vod'},cookieA))).status).toBe(400);
 expect(fetchUpstream).not.toHaveBeenCalled();
 const response=await probe(request('/api/source/test','POST',{sourceKey:own.sources[0].key,url:'http://127.0.0.1',adapter:'unknown'},cookieA));
 expect(await response.json()).toMatchObject({ok:true});
 expect(fetchUpstream).toHaveBeenCalledWith(expect.stringContaining('https://1.1.1.1/vod?'),expect.anything());
});
it('首页只能读取本方案来源，旧版固定来源地址不能绕过自定义方案',async()=>{
 vi.mocked(loadRecommendationFeed).mockClear();
 expect((await feed(request('/api/recommendations/feed?source=douban&feed=movie_0','GET',undefined,cookieA))).status).toBe(404);
 expect(loadRecommendationFeed).not.toHaveBeenCalled();
 expect((await legacyHome(request('/api/douban','GET',undefined,cookieA))).status).toBe(403);
 expect((await feed(request('/api/recommendations/feed?source=privatehome&feed=first','GET',undefined,cookieA))).status).toBe(200);
});
it('方案编辑和再次切换热更新版本，不清空个人数据；批量分配遇到无效账号整体回滚',async()=>{
 const {database}=await getAccountAuth();database.prepare("INSERT INTO user_sync_data(userId,collection,key,value,deleted,deletedAt,version,updatedAt,mutationId) VALUES(?,'search','保留记录',?,0,NULL,1,?,?)").run(userA,JSON.stringify({text:'保留记录',timestamp:Date.now()}),Date.now(),'profile-keep');
 const before=await(await config(content())).json();const profile=await readContentProfile(profileId);
 await saveProfilePart(profileId,'sources',[{key:'custom',name:'点播更新',url:'https://1.1.1.1/vod2'}],profile.sources.revision);
 const after=await(await config(content())).json();expect(after.revision).not.toBe(before.revision);expect(after.sources[0].key).not.toBe(before.sources[0].key);
 await expect(mutateContentProfiles({action:'assign',profileId,userIds:[userB,'missing']})).rejects.toThrow();expect((await readViewerContent(request('/x','GET',undefined,cookieB))).id).toBe('default');
 await mutateContentProfiles({action:'assign',profileId:'default',userIds:[userA]});expect((await(await config(content())).json()).sources[0].key).toBe('env_0');
 expect(database.prepare("SELECT key FROM user_sync_data WHERE userId=? AND key='保留记录'").get(userA)).toBeTruthy();
});
it('独立方案的管理员编辑入口不泄露给普通账号，未知方案不退回默认源',async()=>{
 expect((await getAdminSources(request(`/api/admin/sources?profileId=${profileId}`,'GET',undefined,cookieA))).status).toBe(401);
 const current=await(await getAdminSources(request(`/api/admin/sources?profileId=${profileId}`,'GET',undefined,adminCookie))).json();expect(current.sources[0].key).toBe('custom');
 expect((await getAdminSources(request('/api/admin/sources?profileId=bad','GET',undefined,adminCookie))).status).toBe(400);
 expect((await putAdminSources(request(`/api/admin/sources?profileId=${profileId}`,'PUT',{sources:[],revision:current.revision},adminCookie))).status).toBe(200);
 expect((await readContentProfile(profileId)).sources.sources).toEqual([]);
 expect((await readContentProfile()).sources.sources).toHaveLength(1);
 expect((await listContentProfiles(userA)).selected).toBe('default');
 expect((await readViewerRecommendations(content())).sources.length).toBeGreaterThan(0);
});

it('方案损坏时不偷偷回退到默认数据，其他账号不受影响',async()=>{
 const {database}=await getAccountAuth();await mutateContentProfiles({action:'assign',profileId,userIds:[userA]});
 const original=database.prepare('SELECT sources FROM content_profile WHERE id=?').get(profileId) as {sources:string};
 database.prepare('UPDATE content_profile SET sources=? WHERE id=?').run('{broken',profileId);
 try {expect((await config(content())).status).toBe(500);expect((await config(request('/api/server/config','GET',undefined,cookieB))).status).toBe(200);}
 finally {database.prepare('UPDATE content_profile SET sources=? WHERE id=?').run(original.sources,profileId);await mutateContentProfiles({action:'assign',profileId:'default',userIds:[userA]});}
});
