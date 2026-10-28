import { guardAccountAdminRequest } from '@/lib/account-admin-guard';
import { ContentProfileError, listContentProfiles, mutateContentProfiles } from '@/lib/content-profiles';
import { serverSourceMode } from '@/lib/server-sources';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
async function handle(req:Request){
  const denied=guardAccountAdminRequest(req);if(denied)return denied;
  if(!serverSourceMode())return Response.json({error:'请先开启服务器源管理模式'},{status:409,headers});
  try{
    if(req.method==='GET')return Response.json(await listContentProfiles(new URL(req.url).searchParams.get('userId')||undefined),{headers});
    const raw=await req.text();if(raw.length>32768)throw new ContentProfileError('请求过大',413);
    let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{throw new ContentProfileError('请求格式无效');}
    return Response.json(await mutateContentProfiles(body),{headers});
  }catch(e){return Response.json({error:e instanceof ContentProfileError?e.message:'内容方案操作失败'},{status:e instanceof ContentProfileError?e.status:500,headers});}
}
export const GET=handle;export const POST=handle;
