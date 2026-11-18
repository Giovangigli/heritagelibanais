# Final Studio plan

Updated 18 November 2026. This is the release checklist for `apps/online`. The social editing UI remains available.

The Studio v2 application is deployed privately at `https://heritage-libanais-studio.antoine-giovangigli.chatgpt.site`. Its WordPress publication and Brevo delivery still need the checks below before Joseph's full demo.

## Website publication

- Implemented in v2: after review, **Valider et publier sur le site** creates a published WordPress Récit or Événement. The server uses the saved proposal, a server-only WordPress token, a deterministic slug, and a D1 publication record so a retry can find the existing post. Uploaded PNG, JPEG, and WebP images are sent from private R2 to WordPress with their credits; the first becomes the featured image. The Studio stores the WordPress post ID and URL.
- Implemented in v2: **Retirer du site** moves only the tracked post to WordPress Trash. **Restaurer sur le site** republishes a tracked trashed post. The Studio keeps its dossier and audit history.
- Owner-only check: the `/setup` page can publish clearly marked disposable Récit and Événement test posts without replacing the current dossier; each can be trashed and restored for the release check.
- Release gate: the owner creates a site-specific WordPress application password under Users → Profile and enters it once on the private Studio `/setup` page. An existing OAuth token or `WORDPRESS_ACCESS_TOKEN` Sites secret also remains supported. Then run disposable Récit and Événement publication tests plus Trash and restore verification on WordPress. Migration `0002_empty_victor_mancha.sql` is applied in the live Studio database. Never paste credentials into source or chat.
- Site theme: `wordpress-theme/heritage-libanais/` adds newly published Studio posts to the homepage and Récits/Événements listings alongside the existing curated cards. Version 1.0.23 was installed as the active WordPress theme on 17 November; the home, Récits, and Événements pages loaded after installation. Verify an actual Studio post appears in these lists during the publication test.
- Editorial gate: verify article formatting, images, credits, event dates, and mobile layout with Joseph before relying on automatic publishing for real content.

## Newsletter

- Implemented in v2: after publication, **Préparer la Newsletter** selects the new WordPress post in Mailing. The editor can change the subject, inbox preview text, and introduction, preview the resulting newsletter, then explicitly confirm scheduling in Brevo. The send request binds to the reviewed content hash, so changing the text requires a new preview.
- Event reminders: Mailing can select **Rappel avant l’événement** for a future event, edit the same fields, preview, and explicitly confirm. The server checks that every scheduled batch is before the event. The deployed version still uses the Newsletter audience for reminders. Do not use that reminder action for registrants. The GitHub branch scopes reminders to the selected event and blocks empty lists. Deploy it together with migration 0003.
- Brevo key: the owner entered it once in the Studio form on 17 November. Its encrypted connection record is present in the live Studio database and is shared with authorized editors. The account check passes before storage; missing newsletter-list or sender setup is reported separately. Do not put the key in n8n or the repository.
- DNS: OVH (`dns103.ovh.net`, `ns103.ovh.net`) is authoritative. On 17 November all Brevo verification, DKIM, and DMARC records were recognized and Brevo domain authentication succeeded. Existing OVH MX, SPF, DKIM and website records were preserved.
- Brevo setup: the key is stored encrypted in the Studio; `heritage-libanais.fr` is verified and authenticated, and `contact@heritage-libanais.fr` is active. The Sites runtime has `BREVO_SENDER_EMAIL=contact@heritage-libanais.fr` and `BREVO_REPLY_TO=heritage.libanais@gmail.com`. List 3 has four contacts, of whom three currently pass the Studio consent filter. Release gate: preview and send an internal campaign, inspect actual delivery and unsubscribe behavior before a public mailing.
- Delivery gate: verify unsubscribe handling before a second batch, daily quota across multiple editions, partial-failure recovery, and actual delivery status. Do not treat “scheduled” as “delivered.”

## Event registration, confirmation, reminders and CSV

- Add a native WordPress form to future Studio event pages without external booking. The 28 November conference keeps HelloAsso. Add the form with name, email, optional attendee count, explicit privacy notice, capacity/waitlist rules, and duplicate registration handling. Store registrations in a private database with event ID and confirmation status. Keep registration consent separate from newsletter consent.
- After a successful registration, send a transactional confirmation email through Brevo with the event title, date/time and time zone, venue/address, registration reference, practical information, and a link to the event. Send once per registration ID; record Brevo message ID and delivery state. Show an on-page confirmation even if email delivery is delayed, and make retry safe.
- Add an owner view to export attendees and resend a confirmation, plus a cancellation path. For event edits or cancellation, prepare a separate reviewed message to affected registrants. Test registration, duplicate submission, capacity, email delivery, and cancellation before Joseph's demo.

## Instagram carousels and Reel WIP

The branch includes an Instagram tab that selects a published Récit. The editor will review its carousel and publish it from there once rendering and Meta Login are connected. Reel video remains WIP. Work on this in parallel with event registration and Newsletter delivery. Use the supplied Instagram technical reference as design input and verify version-specific limits and scopes against [Meta’s official publishing guide](https://developers.facebook.com/docs/instagram-platform/content-publishing/) and the connected app before enabling publishing.

1. **Prepare media.** Render the approved carousel as ordered 1080 × 1350 JPEGs and check crops, overflow, credits and rights. Start with 2–10 slides, the Studio’s current editorial limit. Reel storyboard, video rendering and covers are a later milestone.
2. **Connect Meta.** Verify the professional account, configure Instagram Login in the Meta app and verify the publishing scope for that app. Pin a supported API version, keep tokens on the server and provide a reconnect flow. Check whether Joseph's use requires additional app access or review.
3. **Review and publish.** Show the final assets, caption and destination account in a separate Instagram confirmation. Provide Meta fetchable URLs for the reviewed assets only. Create the ordered carousel containers, check processing status, publish when ready, and record the media ID and permalink. Reconcile ambiguous responses before retrying to avoid duplicate posts.
4. **Release check.** Verify one carousel with the authorized test account. Check that crop, order, caption, cover, processing and retry behavior match the preview. Keep manual upload available when assets are ready. Schedule publishing only after immediate publication passes.

## Joseph handover

- Studio v2 is deployed to the existing private Studio; complete the WordPress, theme, and mailing release gates before Joseph's end-to-end demo.
- Add Joseph to the Sites access policy and `STUDIO_EDITOR_EMAILS`, using his own sign-in. Test as his account on a fresh browser: create Récit and Événement, edit, validate, see each WordPress page, prepare an email, and move a test post to Trash.
- Keep connection administration with the owner. Confirm whether Joseph may schedule newsletters by setting `STUDIO_MAILING_EDITOR_EMAILS` only after the internal delivery test.

## Release order

1. **WordPress and Newsletter** — Recheck publication from the current Studio preview. Verify the Brevo signup confirmation and welcome with one internal address. Connect unsubscribe confirmation to a verified unsubscribe and test duplicate protection. Invitations use the Newsletter audience and continue through explicit preview and send confirmation.
2. **Registrations** — Apply migration 0003. Connect the native WordPress form and the transactional confirmation. Synchronize addresses to Brevo without adding them to the Newsletter list. Verify CSV access, duplicate submissions, and audience separation using two events. Enable reminder delivery only after these checks.
3. **Instagram**, in parallel — Build carousel rendering for a published Récit and connect the professional account. Verify one reviewed carousel through publication and permalink. Keep Reel marked WIP.
4. **Joseph's demo** — Walk through the live Studio with his editor account and verify each enabled action with test content.

### Registration acceptance test

- Publish a clearly labeled “TEST STUDIO — Inscription à un événement” with a future date and native registration enabled. Use an internal test address to submit the form, check that the confirmation arrives with the correct date and venue, and repeat with that address to verify deduplication. Check the private CSV and reminder preview, then move the test event to WordPress Trash.
