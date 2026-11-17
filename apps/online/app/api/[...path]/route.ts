import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {handleStudioRequest} from '../../../lib/studio-api.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request) {return handleStudioRequest(request,env,await getChatGPTUser());}
export {handle as GET,handle as POST,handle as PUT};
