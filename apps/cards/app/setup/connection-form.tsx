'use client';

import { useState } from 'react';

function errorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') {
    return value.error;
  }
  return 'Connexion indisponible.';
}

export default function ConnectionForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setMessage('Vérification de la connexion à n8n…');
    const form = event.currentTarget;

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: new FormData(form).get('token') }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(result));
      form.reset();
      // The studio is a standalone HTML page served from public/.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/private-studio/studio.html');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connexion indisponible.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="token">Jeton du Studio n8n</label>
      <input id="token" name="token" type="password" autoComplete="off" required minLength={16} maxLength={256} />
      <button disabled={busy} type="submit">{busy ? 'Connexion en cours…' : 'Connecter et ouvrir le Studio'}</button>
      <p role="status">{message}</p>
    </form>
  );
}
