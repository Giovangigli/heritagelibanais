# Héritage Libanais Studio

This repository holds the complete private Studio application:

- `apps/online`: editorial drafts and card editing, WordPress publishing, mailing, and Instagram work in progress.

See the app README for setup and hosting details. Local secrets belong in its ignored `.dev.vars` or environment variables; never commit credentials.

## Verification

With dependencies installed in `apps/online`, run `npm test`, `npm run lint`, and `npm run typecheck` from this directory.

See [FINAL_STUDIO_PLAN.md](FINAL_STUDIO_PLAN.md) for release gates and deferred social publishing work.

The WordPress theme and custom newsletter plugin live in the separate `Giovangigli/heritage-libanais-wordpress` repository. They deploy through WordPress separately from the private Studio.

## Recette locale d’une PR

Avec Node.js 24, depuis le checkout de la PR :

```sh
npm --prefix apps/online run install:ci
npm test
npm --prefix apps/online run dev -- --hostname 127.0.0.1
```

Ouvrir l’URL locale. Pour le rendu WordPress avec les styles du thème, lancer aussi la preview WordPress sur `127.0.0.1:48888`. Le profil portable propose une session locale pour ouvrir l’atelier. Pour la persistance des brouillons et images, appliquer les migrations à la base locale en suivant le [README de l’app](apps/online/README.md#local-d1-migrations). Utiliser un checkout de recette sans fichiers d’environnement de production. Les tests simulent les connexions et vérifient permissions, révisions, traitement des images et publication sans utiliser les services publics.

La CI de PR exécute les tests, lint, TypeScript et build. Le build est indépendant de la mise en ligne.
