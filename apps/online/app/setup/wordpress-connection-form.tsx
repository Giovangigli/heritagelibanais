'use client';

import {useEffect,useState} from 'react';

type ConnectionStatus={connected:boolean;reason?:string;managed?:boolean};
type TestPost={post_id:number;title:string;url:string;type:string;status:string};

export default function WordPressConnectionForm({canTest}:{canTest:boolean}){
  const [status,setStatus]=useState('Vérification de la connexion…');
  const [managed,setManaged]=useState(false);
  const [busy,setBusy]=useState(false);
  const [connected,setConnected]=useState(false);
  const [tests,setTests]=useState<TestPost[]>([]);
  const [testMessage,setTestMessage]=useState('');

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
    void fetch('/api/publication/list',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)return;
        const value=await response.json() as {posts?:TestPost[]};
        setTests((value.posts||[]).filter(post=>post.title.startsWith('TEST STUDIO — ')));
      })
      .catch(()=>setTestMessage('La liste des publications de test est momentanément indisponible.'));
  },[]);

  async function refreshTests(){
    const response=await fetch('/api/publication/list',{cache:'no-store'});
    if(!response.ok)throw new Error('La liste des tests est indisponible.');
    const value=await response.json() as {posts?:TestPost[]};
    setTests((value.posts||[]).filter(post=>post.title.startsWith('TEST STUDIO — ')));
  }

  async function testPublication(type:'recit'|'evenement'){
    if(busy)return;setBusy(true);setTestMessage('Publication du test sur WordPress…');
    try{
      const response=await fetch('/api/publication/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type})});
      const value=await response.json() as {error?:string};
      if(!response.ok)throw new Error(value.error||'La publication de test a échoué.');
      await refreshTests();setTestMessage('Test publié. Vérifiez sa page et sa présence dans les listes, puis placez-le dans la corbeille.');
    }catch(error){setTestMessage(error instanceof Error?error.message:'Test indisponible.');}
    finally{setBusy(false);}
  }

  async function trashTest(postId:number){
    if(busy)return;setBusy(true);setTestMessage('Mise à la corbeille sur WordPress…');
    try{
      const response=await fetch('/api/publication/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postId,revision:0})});
      const value=await response.json() as {error?:string};
      if(!response.ok)throw new Error(value.error||'La mise à la corbeille a échoué.');
      await refreshTests();setTestMessage('Publication de test placée dans la corbeille WordPress.');
    }catch(error){setTestMessage(error instanceof Error?error.message:'Mise à la corbeille indisponible.');}
    finally{setBusy(false);}
  }

  async function restoreTest(postId:number){
    if(busy)return;setBusy(true);setTestMessage('Restauration sur WordPress…');
    try{
      const response=await fetch('/api/publication/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postId,revision:0})});
      const value=await response.json() as {error?:string};
      if(!response.ok)throw new Error(value.error||'La restauration a échoué.');
      await refreshTests();setTestMessage('Test restauré. Vérifiez sa page, puis replacez-le dans la corbeille.');
    }catch(error){setTestMessage(error instanceof Error?error.message:'Restauration indisponible.');}
    finally{setBusy(false);}
  }

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
    {connected&&canTest&&<details>
      <summary>Vérifier la publication sur le site</summary>
      <p>Ces boutons publient des articles clairement marqués « TEST STUDIO » sur le site public. Vérifiez chaque page avant de la placer dans la corbeille. Votre dossier actuel reste intact.</p>
      <button disabled={busy} type="button" onClick={()=>void testPublication('recit')}>Publier un Récit de test</button>{' '}
      <button disabled={busy} type="button" onClick={()=>void testPublication('evenement')}>Publier un Événement de test</button>
      <p role="status">{testMessage}</p>
      <ul>{tests.map(post=><li key={post.post_id}><a href={post.url} target="_blank" rel="noopener noreferrer">{post.title}</a> · {post.status==='publish'?'En ligne':'Dans la corbeille'} {post.status==='publish'?<button disabled={busy} type="button" onClick={()=>void trashTest(post.post_id)}>Mettre à la corbeille</button>:<button disabled={busy} type="button" onClick={()=>void restoreTest(post.post_id)}>Restaurer</button>}</li>)}</ul>
    </details>}
  </section>;
}
