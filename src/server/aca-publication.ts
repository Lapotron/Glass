import type {SiteConfig} from '../shared/contracts.js';
import {acaServiceFetch} from './aca-fetch.js';
/** Both publication adapters must verify the collector before changing R2 or public output. */
export async function verifyAcaPublication(site:SiteConfig,credentials:NodeJS.ProcessEnv,fetcher:typeof fetch=acaServiceFetch){
 const config=site.integrations.aca;if(!config.enabled)return;
 if(!credentials.ACA_REPORT_TOKEN)throw new Error('Save the private ACA report token before publishing version-2 collection.');
 const response=await fetcher(new URL('/v1/status',config.endpoint),{headers:{Authorization:'Bearer '+credentials.ACA_REPORT_TOKEN},redirect:'manual',signal:AbortSignal.timeout(15000)});
 const status=await response.json() as {protocol:number;capabilities?:string[];siteId:string;siteOrigin:string;historyMode?:string};
 if(!response.ok||status.protocol!==3||!status.capabilities?.includes('audience-v2')||status.siteId!==config.siteId||status.siteOrigin!==new URL(site.url).origin||(config.optionalHistory&&status.historyMode!=='optional-consent'))throw new Error('Deploy the matching ACA audience service before publishing these reader settings. Pages and R2 were not uploaded.');
}
