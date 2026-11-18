import Image from 'next/image';
import {requireChatGPTUser} from '../chatgpt-auth';
import ConnectionForm from './connection-form';
export const dynamic='force-dynamic';
export default async function Setup(){
  await requireChatGPTUser('/setup');
  return <main className="setup-shell"><Image src="/dist/assets/logo.svg" alt="Héritage Libanais" width={180} height={60} unoptimized/><p className="eyebrow">STUDIO PRIVÉ</p><h1>Connecter le modèle</h1><p>Utilisez le même jeton n8n que pour le Studio local. Il sera conservé chiffré dans votre espace privé pour les prochaines sessions.</p><p>La connexion OpenAI et le modèle GPT‑5.4 sont déjà configurés dans n8n.</p><ConnectionForm/><a href="/private-studio/studio.html">Revenir au Studio</a></main>;
}
