'use client';

import {useEffect,useState} from 'react';

type ConnectionStatus={connected:boolean;reason?:string;managed?:boolean};

export default function WordPressConnectionForm(){
  const [status,setStatus]=useState('Vérification de la connexion…');
  const [managed,setManaged]=useState(false);
  const [busy,setBusy]=useState(false);
  const [connected,setConnected]=useState(false);

  async function refresh(){
    try{
      const response=await fetch('/api/publication/status',{cache:'no-store'});
      const value=await response.json() as ConnectionStatus;
      if(!response.ok)throw new Error('La connexion WordPress est indisponible.');
      setManaged(Boolean(value.managed));setConnected(Boolean(value.connected));
      setStatus(value.connected?'WordPress est connecté. Le Studio peut publier les dossiers validés.':value.reason==='missing'?'WordPress attend sa première connexion.':'La connexion WordPress doit être vérifiée.');
    }catch{setStatus('La connexion WordPress est momentanément indisponible.');}
  }
  useEffect(()=>{
    void fetch('/api/publication/status',{cache:'no-store'})
      .then(async response=>{
        const value=await response.json() as ConnectionStatus;
        if(!response.ok)throw new Error('La connexion WordPress est indisponible.');
        setManaged(Boolean(value.managed));setConnected(Boolean(value.connected));
        setStatus(value.connected?'WordPress est connecté. Le Studio peut publier les dossiers validés.':value.reason==='missing'?'WordPress attend sa première connexion.':'La connexion WordPress doit être vérifiée.');
      })
      .catch(()=>setStatus('La connexion WordPress est momentanément indisponible.'));
  },[]);

  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    const form=event.currentTarget;
    const fields=new FormData(form);
    setBusy(true);setStatus('Vérification du compte WordPress…');
    try{
      const response=await fetch('/api/publication/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:String(fields.get('username')||'').trim(),password:String(fields.get('password')||'')})});
      const value=await response.json() as {error?:string};
      if(!response.ok)throw new Error(value.error||'WordPress a refusé la connexion.');
      form.reset();await refresh();
    }catch(error){setStatus(error instanceof Error?error.message:'Connexion indisponible.');}
    finally{setBusy(false);}
  }

  return <section aria-labelledby="wordpress-heading">
    <p id="wordpress-heading" role="status">{status}</p>
    {!managed&&<details open={!connected}>
      <summary>{connected?'Remplacer la connexion WordPress':'Ajouter la connexion WordPress'}</summary>
      <p>Dans <a href="https://heritage-libanais.fr/wp-admin/profile.php" target="_blank" rel="noopener noreferrer">WordPress → Utilisateurs → Profil</a>, créez un mot de passe d’application nommé « Studio Héritage Libanais ». Entrez ici votre identifiant WordPress et le mot de passe généré. Le Studio les conserve chiffrés côté serveur.</p>
      <form onSubmit={submit}>
        <label htmlFor="wp-username">Identifiant WordPress</label>
        <input id="wp-username" name="username" type="text" autoComplete="username" required maxLength={200}/>
        <label htmlFor="wp-password">Mot de passe d’application</label>
        <input id="wp-password" name="password" type="password" autoComplete="new-password" required minLength={16} maxLength={200}/>
        <button disabled={busy} type="submit">{busy?'Vérification…':'Vérifier et enregistrer'}</button>
      </form>
    </details>}
  </section>;
}
