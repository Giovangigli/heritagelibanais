import type {Metadata} from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Studio — Héritage Libanais',description:'Récits et évènements : composition avec le modèle, édition et versions.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="fr"><body>{children}</body></html>; }
