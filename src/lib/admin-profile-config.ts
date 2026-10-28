import { accountMode, accountConfigured } from './account-mode';
import { DEFAULT_PROFILE, validateProfileId, readContentProfile, exposedProfileSources, saveProfilePart, ContentProfileError } from './content-profiles';
import { readServerSources, saveServerSources } from './server-sources';
import { readRecommendations, saveRecommendations } from './server-recommendations';
function profile(req: Request) {
  const id=validateProfileId(new URL(req.url).searchParams.get('profileId')||DEFAULT_PROFILE);
  if(id!==DEFAULT_PROFILE&&(!accountMode()||!accountConfigured()))throw new ContentProfileError('请先开启并配置账号模式',409);
  return id;
}
export async function readAdminSources(req:Request){
  const id=profile(req);
  return id===DEFAULT_PROFILE?readServerSources():(await readContentProfile(id)).sources;
}
export async function writeAdminSources(req:Request,value:Parameters<typeof saveServerSources>[0],revision:string){const id=profile(req);return id===DEFAULT_PROFILE?saveServerSources(value,revision):saveProfilePart(id,'sources',value,revision);}
export async function readAdminRecommendations(req:Request){const id=profile(req);return id===DEFAULT_PROFILE?readRecommendations():(await readContentProfile(id)).recommendations;}
export async function writeAdminRecommendations(req:Request,value:unknown,revision:string){const id=profile(req);return id===DEFAULT_PROFILE?saveRecommendations(value,revision):saveProfilePart(id,'recommendations',value,revision);}

export async function readAdminEpisodeSources(req: Request) {
  return exposedProfileSources(await readContentProfile(profile(req)));
}
