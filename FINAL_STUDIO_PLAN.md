# Final Studio plan

Updated 17 November 2026. This is the release checklist for `apps/online`. The social export button and current social editing UI remain available.

## Website publication

- Implemented in v2: after review, **Valider et publier sur le site** creates a published WordPress Récit or Événement. The server uses the saved proposal, a server-only WordPress token, a deterministic slug, and a D1 publication record so a retry can find the existing post. Uploaded PNG, JPEG, and WebP images are sent from private R2 to WordPress with their credits; the first becomes the featured image. The Studio stores the WordPress post ID and URL.
- Implemented in v2: **Retirer du site** moves only the tracked post to WordPress Trash. It does not permanently delete it. The Studio keeps its dossier and audit history.
- Release gate: connect WordPress with an owner-entered OAuth token in the Studio (or configure `WORDPRESS_ACCESS_TOKEN` as a Sites secret), apply migration `0002_empty_victor_mancha.sql`, and run one approved test publication plus Trash and restore verification on WordPress. Never paste the token into source or chat.
- Site-theme gate: `wordpress-theme/heritage-libanais/` now adds newly published Studio posts to the homepage and Récits/Événements listings alongside the existing curated cards. Deploy and visually verify that theme. Until then, new posts are reachable by direct URL but do not appear in those lists.
- Editorial gate: verify article formatting, images, credits, event dates, and mobile layout with Joseph before relying on automatic publishing for real content.

## Newsletter

- Implemented in v2: after publication, **Préparer la lettre** selects the new WordPress post in Mailing. The editor can change the subject, inbox preview text, and introduction, preview the resulting newsletter, then explicitly confirm scheduling in Brevo. The send request binds to the reviewed content hash, so changing the text requires a new preview.
- Release gate: configure Brevo's production API key in Sites or the owner setup. Authenticate `heritage-libanais.fr` in Brevo, activate `contact@heritage-libanais.fr` as sender, and set `BREVO_SENDER_EMAIL=contact@heritage-libanais.fr` and `BREVO_REPLY_TO=heritage.libanais@gmail.com` in Sites. Test preview and a campaign to internal recipients before enabling public sends. As checked on 17 November, the domain is not authenticated and no sender is active.
- Delivery gate: verify unsubscribe handling before a second batch, daily quota across multiple editions, partial-failure recovery, and actual delivery status. Do not treat “scheduled” as “delivered.”

## Social publishing: deferred

- Keep the existing carousel preview, editing controls, and **Télécharger le dossier de proposition** button.
- Still needed: render the approved carousel as downloadable portrait image files; verify text overflow and image crops on a phone; create a distinct Reel storyboard and rendered MP4/cover; package exact captions and media; validate image rights per destination.
- Direct Instagram publication is out of the current release. It requires Meta account permissions, a separate approval step, processing status, and duplicate-safe retries. Manual upload can be the first supported path once the finished assets exist.

## Joseph handover

- Publish v2 to the existing private Studio after the release gates pass.
- Add Joseph to the Sites access policy and `STUDIO_EDITOR_EMAILS`, using his own sign-in. Test as his account on a fresh browser: create Récit and Événement, edit, validate, see each WordPress page, prepare an email, and move a test post to Trash.
- Keep connection administration with the owner. Confirm whether Joseph may schedule newsletters by setting `STUDIO_MAILING_EDITOR_EMAILS` only after the internal delivery test.
