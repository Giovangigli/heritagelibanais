import Image from 'next/image';
import {env} from 'cloudflare:workers';
import {requireChatGPTUser} from '../chatgpt-auth';
import {resolveStudioAccess} from '../../lib/studio-access.mjs';
import ConnectionForm from './connection-form';
import WordPressConnectionForm from './wordpress-connection-form';
export const dynamic='force-dynamic';
export default async function Setup(){
  const user=await requireChatGPTUser('/setup');
  const access=resolveStudioAccess(env,user);
  const hostingManaged=access?.role==='owner'&&Boolean(env.N8N_STUDIO_WEBHOOK_TOKEN);
  return <main className="setup-shell">
    <Image src="/dist/assets/signature-clair.svg" alt="Héritage Libanais" width={180} height={164} unoptimized/>
    <p className="eyebrow">STUDIO PRIVÉ</p>
    <h1>Connexions du Studio</h1>
    <h2>WordPress</h2>
    {access?.canManageConnections
      ? <WordPressConnectionForm/>
      : <p>La connexion WordPress est gérée par l’administration du Studio.</p>}
    <h2>Modèle de rédaction</h2>
    {!access?.canManageConnections
      ? <p>La connexion est gérée par l’administration du Studio.</p>
      : hostingManaged
        ? <p>Le jeton n8n est géré dans les réglages de l’hébergement.</p>
        : <><p>Enregistrez le jeton du workflow n8n de production. Le Studio le conserve chiffré côté serveur.</p><ConnectionForm/></>}
    <a href="/private-studio/studio.html">Revenir au Studio</a>
  </main>;
}
