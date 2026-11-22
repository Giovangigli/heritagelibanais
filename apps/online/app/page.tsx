import {redirect} from 'next/navigation';
import {requireChatGPTUser} from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() { await requireChatGPTUser('/'); redirect('/private-studio/studio.html?v=event-audiences'); }
