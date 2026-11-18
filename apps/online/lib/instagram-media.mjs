// Studio export targets. Meta's supported limits are verified separately with the app.
export const INSTAGRAM_EXPORT = Object.freeze({
  carousel: Object.freeze({ width: 1080, height: 1350, type: 'image/jpeg', maxBytes: 8_000_000 }),
  reel: Object.freeze({ width: 1080, height: 1920, type: 'video/mp4' }),
});

export function instagramMediaIssues(kind, assets) {
  const target = INSTAGRAM_EXPORT[kind];
  if (kind !== 'carousel' && kind !== 'reel') return ['Format Instagram inconnu.'];
  if (!Array.isArray(assets)) return ['Ajoutez les médias à publier.'];
  if (kind === 'carousel' && (assets.length < 2 || assets.length > 10)) {
    return ['Le carrousel doit contenir de 2 à 10 cartes.'];
  }
  if (kind === 'reel' && assets.length !== 1) return ['Sélectionnez une vidéo pour le Reel.'];

  return assets.flatMap((asset, index) => {
    const label = kind === 'carousel' ? `Carte ${index + 1}` : 'Reel';
    const issues = [];
    if (asset?.type !== target.type || asset.width !== target.width || asset.height !== target.height) {
      issues.push(`${label} : utilisez le format ${target.type} en ${target.width} × ${target.height}.`);
    }
    if (!Number.isSafeInteger(asset?.bytes) || asset.bytes <= 0 || (target.maxBytes && asset.bytes > target.maxBytes)) {
      issues.push(`${label} : taille de fichier invalide.`);
    }
    return issues;
  });
}
