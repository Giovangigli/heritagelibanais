# Publication Instagram du Studio

Le Studio publie les carrousels par l’Instagram API avec Instagram Login de Meta. Le compte cible doit être un compte professionnel (Business ou Creator) et autoriser `instagram_business_basic` et `instagram_business_content_publish` dans une application Meta Developer.

1. Dans Meta Developer, configurer Instagram API avec Instagram Login et faire autoriser le compte professionnel Héritage Libanais. Obtenir un **Instagram User access token** avec les deux autorisations ci-dessus. Une clé d’application ou un secret d’application seuls ne permettent pas de publier.
2. Dans le Studio privé, onglet **Instagram → Gérer la connexion Meta**, renseigner le nom exact du compte et le jeton. Le Studio vérifie que le jeton désigne ce compte avant de le chiffrer et de l’enregistrer. Ne pas placer le jeton dans GitHub ni dans une conversation.
3. Publier d’abord un Récit depuis l’atelier. Dans l’onglet Instagram, préparer les cartes JPEG, les relire, rédiger la légende et confirmer l’envoi. Le transfert stocke les JPEG dans la médiathèque publique WordPress pour que Meta puisse les récupérer. Le Studio crée les conteneurs du carrousel, puis le publie via `media_publish`.

L’accueil affiche l’état des connexions n8n, Brevo et Instagram. Si le jeton Meta expire ou perd une autorisation, l’administrateur doit le remplacer dans le Studio. Un envoi au résultat incertain est conservé « à vérifier » et ne doit pas être relancé avant contrôle du compte Instagram. L’API ne supprime pas les publications Instagram ; les JPEG déjà transférés restent dans WordPress même si l’envoi échoue.

Référence : [Meta, Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing).
