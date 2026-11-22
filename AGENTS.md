# Héritage Libanais Studio — instructions de travail

Le Studio est dans `apps/online/`. Le site WordPress est géré séparément. La mémoire commune de référence est dans le dépôt privé WordPress indiqué par le README. Les agents autorisés consultent son `AGENTS.md` et ses six documents `docs/{architecture,design-system,roadmap,project-status,decisions,deployment}.md` une fois au début de la session, sur main à jour. Si l'accès est absent, signaler cette limite ; ne pas deviner les décisions ni recopier la mémoire privée dans ce dépôt.

- Début : vérifier l'état Git, remote, références distantes, PR et travaux concurrents ; synchroniser sans écraser les modifications locales. Créer une branche dédiée issue de la base appropriée pour les changements ; aucune branche nécessaire pour une lecture seule.
- Pendant : respecter le périmètre, préserver le travail existant et suivre les README, scripts et tests du dépôt. Valider explicitement toute action de publication réelle. Ne jamais committer secrets, jetons, identifiants d'accès, données privées, exports, fichiers d'environnement ou conversations brutes.
- Fin : tester, vérifier la diff, commit/push des seuls changements demandés et PR vers main si nécessaire. Actualiser les décisions et l'état significatif dans la mémoire privée par PR liée si nécessaire. Merge et déploiement sont distincts ; vérifier la source réellement servie, ne déployer que sur autorisation.

Références du code : README.md, apps/online/README.md, FINAL_STUDIO_PLAN.md (historique) et INSTAGRAM_SETUP.md.
