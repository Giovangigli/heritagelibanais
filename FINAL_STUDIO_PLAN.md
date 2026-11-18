# Final Studio plan

Updated 17 November 2026. This is the release checklist for `apps/online`. The social editing UI remains available.

The Studio v2 application is deployed privately at `https://heritage-libanais-studio.antoine-giovangigli.chatgpt.site` (Sites version 21). Its WordPress publication and Brevo delivery still need the checks below before Joseph's full demo.

## Website publication

- Implemented in v2: after review, **Valider et publier sur le site** creates a published WordPress Récit or Événement. The server uses the saved proposal, a server-only WordPress token, a deterministic slug, and a D1 publication record so a retry can find the existing post. Uploaded PNG, JPEG, and WebP images are sent from private R2 to WordPress with their credits; the first becomes the featured image. The Studio stores the WordPress post ID and URL.
- Implemented in v2: **Retirer du site** moves only the tracked post to WordPress Trash. **Restaurer sur le site** republishes a tracked trashed post. The Studio keeps its dossier and audit history.
- Owner-only check: the `/setup` page can publish clearly marked disposable Récit and Événement test posts without replacing the current dossier; each can be trashed and restored for the release check.
- Release gate: the owner creates a site-specific WordPress application password under Users → Profile and enters it once on the private Studio `/setup` page. An existing OAuth token or `WORDPRESS_ACCESS_TOKEN` Sites secret also remains supported. Then run disposable Récit and Événement publication tests plus Trash and restore verification on WordPress. Migration `0002_empty_victor_mancha.sql` is applied in the live Studio database. Never paste credentials into source or chat.
- Site theme: `wordpress-theme/heritage-libanais/` adds newly published Studio posts to the homepage and Récits/Événements listings alongside the existing curated cards. Version 1.0.23 was installed as the active WordPress theme on 17 November; the home, Récits, and Événements pages loaded after installation. Verify an actual Studio post appears in these lists during the publication test.
- Editorial gate: verify article formatting, images, credits, event dates, and mobile layout with Joseph before relying on automatic publishing for real content.

## Newsletter

- Implemented in v2: after publication, **Préparer la lettre** selects the new WordPress post in Mailing. The editor can change the subject, inbox preview text, and introduction, preview the resulting newsletter, then explicitly confirm scheduling in Brevo. The send request binds to the reviewed content hash, so changing the text requires a new preview.
- Event reminders: Mailing can select **Rappel avant l’événement** for a future event, edit the same fields, preview, and explicitly confirm. The server checks that every scheduled batch is before the event. Reminders currently go to confirmed newsletter subscribers; event registrants will be a separate audience once registration exists.
- Brevo key: the owner entered it once in the Studio form on 17 November. Its encrypted connection record is present in the live Studio database and is shared with authorized editors. The account check passes before storage; missing newsletter-list or sender setup is reported separately. Do not put the key in n8n or the repository.
- DNS: OVH (`dns103.ovh.net`, `ns103.ovh.net`) is authoritative. On 17 November all Brevo verification, DKIM, and DMARC records were recognized and Brevo domain authentication succeeded. Existing OVH MX, SPF, DKIM and website records were preserved.
- Brevo setup: the key is stored encrypted in the Studio; `heritage-libanais.fr` is verified and authenticated, and `contact@heritage-libanais.fr` is active. The Sites runtime has `BREVO_SENDER_EMAIL=contact@heritage-libanais.fr` and `BREVO_REPLY_TO=heritage.libanais@gmail.com`. List 3 has four contacts, of whom three currently pass the Studio consent filter. Release gate: preview and send an internal campaign, inspect actual delivery and unsubscribe behavior before a public mailing.
- Delivery gate: verify unsubscribe handling before a second batch, daily quota across multiple editions, partial-failure recovery, and actual delivery status. Do not treat “scheduled” as “delivered.”

## Event registration and confirmation: planned

- Add a registration form to each event page with name, email, optional attendee count, explicit privacy notice, capacity/waitlist rules, and duplicate registration handling. Store registrations in a private database with event ID and confirmation status. Keep registration consent separate from newsletter consent.
- After a successful registration, send a transactional confirmation email through Brevo with the event title, date/time and time zone, venue/address, registration reference, practical information, and a link to the event. Send once per registration ID; record Brevo message ID and delivery state. Show an on-page confirmation even if email delivery is delayed, and make retry safe.
- Add an owner view to export attendees and resend a confirmation, plus a cancellation path. For event edits or cancellation, prepare a separate reviewed message to affected registrants. Test registration, duplicate submission, capacity, email delivery, and cancellation before Joseph's demo.

## Social publishing: deferred

- Keep the existing carousel preview and editing controls.
- Still needed: render the approved carousel as downloadable portrait image files; verify text overflow and image crops on a phone; create a distinct Reel storyboard and rendered MP4/cover; package exact captions and media; validate image rights per destination.
- Direct Instagram publication is out of the current release. It requires Meta account permissions, a separate approval step, processing status, and duplicate-safe retries. Manual upload can be the first supported path once the finished assets exist.

## Joseph handover

- Studio v2 is deployed to the existing private Studio; complete the WordPress, theme, and mailing release gates before Joseph's end-to-end demo.
- Add Joseph to the Sites access policy and `STUDIO_EDITOR_EMAILS`, using his own sign-in. Test as his account on a fresh browser: create Récit and Événement, edit, validate, see each WordPress page, prepare an email, and move a test post to Trash.
- Keep connection administration with the owner. Confirm whether Joseph may schedule newsletters by setting `STUDIO_MAILING_EDITOR_EMAILS` only after the internal delivery test.

### Mailing invitations and automatic messages

- The Mailing picker groups published future events separately from stories. Invitations have their own template and continue through the editor’s preview and send confirmation.
- The automatic-message previews are samples. Verify the newsletter welcome against the existing confirmed signup flow. Connect unsubscribe confirmation only after a verified unsubscribe, with duplicate delivery protection.
- Use one Brevo list per WordPress event as the registration marker. Register from future event pages only and keep newsletter consent separate. Send a transactional confirmation with the actual event details after registration succeeds.
- Scope reminders to the selected event’s registrants and show that audience before confirmation. Add a private CSV download in Studio using the same registration data. Verify that a registrant for a different event never appears in the audience or download.
