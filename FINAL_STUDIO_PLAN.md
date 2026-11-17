# Final Studio plan

Updated 17 November 2026. This is the release checklist for `apps/online`. The social export button and current social editing UI remain available.

The Studio v2 application is deployed privately at `https://heritage-libanais-studio.antoine-giovangigli.chatgpt.site` (Sites version 18). Its WordPress and Brevo production connections still need the checks below before Joseph's full demo.

## Website publication

- Implemented in v2: after review, **Valider et publier sur le site** creates a published WordPress Récit or Événement. The server uses the saved proposal, a server-only WordPress token, a deterministic slug, and a D1 publication record so a retry can find the existing post. Uploaded PNG, JPEG, and WebP images are sent from private R2 to WordPress with their credits; the first becomes the featured image. The Studio stores the WordPress post ID and URL.
- Implemented in v2: **Retirer du site** moves only the tracked post to WordPress Trash. It does not permanently delete it. The Studio keeps its dossier and audit history.
- Release gate: connect WordPress with an owner-entered OAuth token in the Studio (or configure `WORDPRESS_ACCESS_TOKEN` as a Sites secret), apply migration `0002_empty_victor_mancha.sql`, and run one approved test publication plus Trash and restore verification on WordPress. Never paste the token into source or chat.
- Site theme: `wordpress-theme/heritage-libanais/` adds newly published Studio posts to the homepage and Récits/Événements listings alongside the existing curated cards. Version 1.0.23 was installed as the active WordPress theme on 17 November; the home, Récits, and Événements pages loaded after installation. Verify an actual Studio post appears in these lists during the publication test.
- Editorial gate: verify article formatting, images, credits, event dates, and mobile layout with Joseph before relying on automatic publishing for real content.

## Newsletter

- Implemented in v2: after publication, **Préparer la lettre** selects the new WordPress post in Mailing. The editor can change the subject, inbox preview text, and introduction, preview the resulting newsletter, then explicitly confirm scheduling in Brevo. The send request binds to the reviewed content hash, so changing the text requires a new preview.
- Event reminders: Mailing can select **Rappel avant l’événement** for a future event, edit the same fields, preview, and explicitly confirm. The server checks that every scheduled batch is before the event. Reminders currently go to confirmed newsletter subscribers; event registrants will be a separate audience once registration exists.
- Brevo key: save it once in the Studio owner form. It is encrypted in the Studio database and shared with authorized editors. The account check must pass before storage; missing newsletter-list or sender setup is reported separately. The live database had no Brevo connection on 17 November, so the owner still needs to enter a valid key once. Do not put the key in n8n or the repository.
- Release gate: configure Brevo's production API key in Sites or the owner setup. Authenticate `heritage-libanais.fr` in Brevo and activate the new `contact@heritage-libanais.fr` sender (created on 17 November, currently inactive). The Sites runtime already has `BREVO_SENDER_EMAIL=contact@heritage-libanais.fr` and `BREVO_REPLY_TO=heritage.libanais@gmail.com`. Test preview and a campaign to internal recipients before enabling public sends. As checked on 17 November, the domain is not authenticated.
- Delivery gate: verify unsubscribe handling before a second batch, daily quota across multiple editions, partial-failure recovery, and actual delivery status. Do not treat “scheduled” as “delivered.”

## Event registration and confirmation: planned

- Add a registration form to each event page with name, email, optional attendee count, explicit privacy notice, capacity/waitlist rules, and duplicate registration handling. Store registrations in a private database with event ID and confirmation status. Keep registration consent separate from newsletter consent.
- After a successful registration, send a transactional confirmation email through Brevo with the event title, date/time and time zone, venue/address, registration reference, practical information, and a link to the event. Send once per registration ID; record Brevo message ID and delivery state. Show an on-page confirmation even if email delivery is delayed, and make retry safe.
- Add an owner view to export attendees and resend a confirmation, plus a cancellation path. For event edits or cancellation, prepare a separate reviewed message to affected registrants. Test registration, duplicate submission, capacity, email delivery, and cancellation before Joseph's demo.

## Social publishing: deferred

- Keep the existing carousel preview, editing controls, and **Télécharger le dossier de proposition** button.
- Still needed: render the approved carousel as downloadable portrait image files; verify text overflow and image crops on a phone; create a distinct Reel storyboard and rendered MP4/cover; package exact captions and media; validate image rights per destination.
- Direct Instagram publication is out of the current release. It requires Meta account permissions, a separate approval step, processing status, and duplicate-safe retries. Manual upload can be the first supported path once the finished assets exist.

## Joseph handover

- Studio v2 is deployed to the existing private Studio; complete the WordPress, theme, and mailing release gates before Joseph's end-to-end demo.
- Add Joseph to the Sites access policy and `STUDIO_EDITOR_EMAILS`, using his own sign-in. Test as his account on a fresh browser: create Récit and Événement, edit, validate, see each WordPress page, prepare an email, and move a test post to Trash.
- Keep connection administration with the owner. Confirm whether Joseph may schedule newsletters by setting `STUDIO_MAILING_EDITOR_EMAILS` only after the internal delivery test.
