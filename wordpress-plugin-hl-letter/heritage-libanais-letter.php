<?php
/*
Plugin Name: Héritage Libanais — La lettre
Description: Inscription confirmée à la lettre via Brevo.
Version: 0.4.2
Requires PHP: 7.4
*/
if (!defined('ABSPATH')) exit;

const HL_LETTER_LIST_ID = 3;
const HL_LETTER_DOI_TEMPLATE_ID = 3;
const HL_LETTER_WELCOME_TEMPLATE_ID = 5;
const HL_LETTER_CONSENT_VERSION = '2026-11-04-v1';

function hl_letter_api_key() {
    if (defined('HL_LETTER_BREVO_API_KEY')) return (string) constant('HL_LETTER_BREVO_API_KEY');
    return (string) get_option('hl_letter_api_key', '');
}

function hl_letter_ready() {
    return (bool) get_option('hl_letter_enabled', false)
        && hl_letter_api_key() !== ''
        && get_option('hl_letter_key_verified', '0') === '1';
}

function hl_letter_install() {
    global $wpdb;
    $table = $wpdb->prefix . 'hl_letter_consent';
    $charset = $wpdb->get_charset_collate();
    $sql = "CREATE TABLE $table (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        email_hash char(64) NOT NULL,
        consent_version varchar(32) NOT NULL,
        source varchar(190) NOT NULL,
        submitted_at datetime NOT NULL,
        brevo_status varchar(20) NOT NULL,
        PRIMARY KEY  (id),
        KEY email_hash (email_hash),
        KEY submitted_at (submitted_at)
    ) $charset;";
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
    update_option('hl_letter_db_version', '1', false);
    if (!wp_next_scheduled('hl_letter_cleanup')) wp_schedule_event(time() + DAY_IN_SECONDS, 'daily', 'hl_letter_cleanup');
}
register_activation_hook(__FILE__, 'hl_letter_install');
register_deactivation_hook(__FILE__, function () { wp_clear_scheduled_hook('hl_letter_cleanup'); });
add_action('init', function () {
    if (get_option('hl_letter_db_version') !== '1') hl_letter_install();
    if (!get_option('hl_letter_webhook_token')) add_option('hl_letter_webhook_token', bin2hex(random_bytes(32)), '', false);
});
add_action('hl_letter_cleanup', function () {
    global $wpdb;
    $table = $wpdb->prefix . 'hl_letter_consent';
    $before = gmdate('Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS);
    $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE submitted_at < %s", $before));
});

function hl_letter_audit($email, $status) {
    global $wpdb;
    $table = $wpdb->prefix . 'hl_letter_consent';
    $saved = $wpdb->insert($table, [
        'email_hash' => hash_hmac('sha256', strtolower($email), wp_salt('auth')),
        'consent_version' => HL_LETTER_CONSENT_VERSION,
        'source' => 'heritage-libanais.fr/la-lettre',
        'submitted_at' => gmdate('Y-m-d H:i:s'),
        'brevo_status' => $status
    ], ['%s', '%s', '%s', '%s', '%s']);
    return $saved ? (int) $wpdb->insert_id : 0;
}

function hl_letter_audit_status($id, $status) {
    global $wpdb;
    $wpdb->update($wpdb->prefix . 'hl_letter_consent', ['brevo_status' => $status], ['id' => $id], ['%s'], ['%d']);
}

function hl_letter_diagnostic($code) {
    update_option('hl_letter_last_diagnostic', [
        'code' => sanitize_key($code),
        'at' => gmdate('Y-m-d H:i:s') . ' UTC'
    ], false);
}

add_action('admin_menu', function () {
    add_options_page('La lettre', 'La lettre', 'manage_options', 'hl-letter', 'hl_letter_settings_page');
});

function hl_letter_settings_page() {
    if (!current_user_can('manage_options')) return;
    $enabled = (bool) get_option('hl_letter_enabled', false);
    $has_key = hl_letter_api_key() !== '';
    echo '<div class="wrap"><h1>La lettre · Brevo</h1>';
    echo '<p>Liste Brevo : ' . esc_html(HL_LETTER_LIST_ID) . ' · modèle de confirmation : ' . esc_html(HL_LETTER_DOI_TEMPLATE_ID) . '.</p>';
    echo '<p>Modèle de bienvenue : ' . esc_html(HL_LETTER_WELCOME_TEMPLATE_ID) . ' · rappel envoyé une seule fois après confirmation. L’évènement à venir est ajouté seulement si une date future vérifiable figure dans la publication.</p>';
    $webhook_id = (int) get_option('hl_letter_welcome_webhook_id', 0);
    echo '<p><strong>Bienvenue automatique :</strong> ' . ($webhook_id ? 'connecté à Brevo (webhook ' . esc_html($webhook_id) . ')' : 'à activer') . '.</p>';
    if (!$webhook_id && hl_letter_ready()) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('hl_letter_connect_welcome');
        echo '<input type="hidden" name="action" value="hl_letter_connect_welcome">';
        submit_button('Activer le bienvenue automatique', 'secondary');
        echo '</form>';
    }
    echo '<p>Utilisez une clé API v3 Brevo, pas la clé MCP « ChatGPT ». La clé reste côté serveur. Le formulaire public reste fermé tant que la clé n’est pas validée et que les inscriptions ne sont pas activées. Le journal local ne contient qu’une empreinte de l’adresse et s’efface après 90 jours.</p>';
    $diagnostic = get_option('hl_letter_last_diagnostic', []);
    if (is_array($diagnostic) && !empty($diagnostic['code'])) {
        $labels = [
            'api_key_valid' => 'Connexion à Brevo réussie',
            'api_key_changed_not_tested' => 'Nouvelle clé enregistrée ; test requis',
            'api_key_http_401' => 'Clé refusée par Brevo (401)',
            'brevo_http_401_unauthorized' => 'Inscription refusée par Brevo : clé non autorisée (401)'
        ];
        $code = (string) $diagnostic['code'];
        echo '<p><strong>Dernier test :</strong> ' . esc_html($labels[$code] ?? $code) . ' · ' . esc_html($diagnostic['at'] ?? '') . '.</p>';
    }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('hl_letter_settings');
    echo '<input type="hidden" name="action" value="hl_letter_settings">';
    echo '<p><label for="hl-letter-key">Clé API Brevo</label><br><input id="hl-letter-key" name="api_key" type="password" autocomplete="new-password" class="regular-text" placeholder="' . ($has_key ? 'Clé enregistrée · laisser vide pour conserver' : 'Clé non renseignée') . '"></p>';
    echo '<p><label><input type="checkbox" name="enabled" value="1"' . checked($enabled, true, false) . '> Ouvrir les inscriptions après vérification de la confidentialité, du domaine expéditeur et du modèle de confirmation</label></p>';
    submit_button('Enregistrer');
    echo '</form>';
    if ($has_key) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('hl_letter_test_connection');
        echo '<input type="hidden" name="action" value="hl_letter_test_connection">';
        submit_button('Tester la clé enregistrée', 'secondary');
        echo '</form>';
    }
    echo '</div>';
}

add_action('admin_post_hl_letter_settings', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('hl_letter_settings')) wp_die('Accès refusé.');
    $key = isset($_POST['api_key']) ? trim((string) wp_unslash($_POST['api_key'])) : '';
    if ($key !== '') {
        update_option('hl_letter_api_key', $key, false);
        update_option('hl_letter_key_verified', '0', false);
        hl_letter_diagnostic('api_key_changed_not_tested');
    }
    update_option('hl_letter_enabled', $key === '' && isset($_POST['enabled']) ? '1' : '0', false);
    wp_safe_redirect(admin_url('options-general.php?page=hl-letter&updated=1'));
    exit;
});

add_action('admin_post_hl_letter_test_connection', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('hl_letter_test_connection')) wp_die('Accès refusé.');
    if (hl_letter_api_key() === '') {
        update_option('hl_letter_key_verified', '0', false);
        hl_letter_diagnostic('api_key_missing');
    } else {
        $response = wp_remote_get('https://api.brevo.com/v3/account', [
            'timeout' => 12,
            'headers' => ['api-key' => hl_letter_api_key(), 'Accept' => 'application/json']
        ]);
        if (is_wp_error($response)) {
            update_option('hl_letter_key_verified', '0', false);
            hl_letter_diagnostic('api_key_transport_' . $response->get_error_code());
        } else {
            $code = wp_remote_retrieve_response_code($response);
            update_option('hl_letter_key_verified', $code === 200 ? '1' : '0', false);
            hl_letter_diagnostic($code === 200 ? 'api_key_valid' : 'api_key_http_' . $code);
        }
    }
    wp_safe_redirect(admin_url('options-general.php?page=hl-letter&tested=1'));
    exit;
});

add_shortcode('hl_letter_form', function () {
    if (!hl_letter_ready()) return '';
    $status = isset($_GET['hl_letter']) ? sanitize_key((string) wp_unslash($_GET['hl_letter'])) : '';
    $notice = [
        'verify' => 'Vérifiez votre boîte mail : un lien de confirmation vous attend.',
        'confirmed' => 'Votre adresse est confirmée. Merci de votre inscription à la lettre.',
        'invalid' => 'Vérifiez votre nom, votre prénom, votre adresse et la case de consentement.',
        'busy' => 'Veuillez patienter quelques instants avant de réessayer.',
        'error' => 'L’inscription est momentanément indisponible. Réessayez plus tard.'
    ];
    ob_start();
    if (isset($notice[$status])) echo '<p class="letter-form-status" role="status">' . esc_html($notice[$status]) . '</p>';
    ?>
    <form class="hl-letter-form" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
      <input type="hidden" name="action" value="hl_letter_signup">
      <?php wp_nonce_field('hl_letter_signup'); ?>
      <label for="hl-letter-last-name">Nom <span aria-hidden="true">*</span></label>
      <input id="hl-letter-last-name" name="last_name" type="text" autocomplete="family-name" maxlength="80" required>
      <label for="hl-letter-name">Prénom <span aria-hidden="true">*</span></label>
      <input id="hl-letter-name" name="first_name" type="text" autocomplete="given-name" maxlength="80" required>
      <label for="hl-letter-email">Adresse e-mail <span aria-hidden="true">*</span></label>
      <input id="hl-letter-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required>
      <div class="hl-letter-trap" aria-hidden="true"><label for="hl-letter-website">Site web</label><input id="hl-letter-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <label class="hl-letter-consent"><input name="consent" type="checkbox" value="1" required> J’accepte de recevoir par e-mail la lettre Héritage Libanais, avec ses récits et annonces de rencontres. Je peux me désinscrire à tout moment.</label>
      <p class="hl-letter-privacy">Pour en savoir plus sur l’utilisation de vos données, consultez <a href="<?php echo esc_url(home_url('/la-lettre/#confidentialite')); ?>">les informations de confidentialité</a>.</p>
      <button class="button" type="submit">Recevoir la lettre <span aria-hidden="true">↗</span></button>
    </form>
    <?php
    return ob_get_clean();
});

function hl_letter_redirect($status) {
    wp_safe_redirect(add_query_arg('hl_letter', $status, home_url('/la-lettre/')), 303);
    exit;
}

function hl_letter_signup() {
    if (!hl_letter_ready()) hl_letter_redirect('error');
    if (!isset($_POST['_wpnonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['_wpnonce'])), 'hl_letter_signup')) hl_letter_redirect('invalid');
    if (!empty($_POST['website'])) hl_letter_redirect('verify');
    $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
    $name = isset($_POST['first_name']) ? sanitize_text_field(wp_unslash($_POST['first_name'])) : '';
    $last_name = isset($_POST['last_name']) ? sanitize_text_field(wp_unslash($_POST['last_name'])) : '';
    if (!is_email($email) || strlen($email) > 254 || $name === '' || $last_name === '' || empty($_POST['consent']) || strlen($name) > 160 || strlen($last_name) > 160) hl_letter_redirect('invalid');
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    $rate_key = 'hl_letter_rate_' . hash_hmac('sha256', $ip . '|' . strtolower($email), wp_salt());
    $ip_key = 'hl_letter_ip_' . hash_hmac('sha256', $ip, wp_salt());
    $ip_count = (int) get_transient($ip_key);
    if (get_transient($rate_key) || $ip_count >= 5) hl_letter_redirect('busy');
    set_transient($rate_key, '1', MINUTE_IN_SECONDS);
    set_transient($ip_key, $ip_count + 1, HOUR_IN_SECONDS);
    $audit_id = hl_letter_audit($email, 'pending');
    if (!$audit_id) {
        hl_letter_diagnostic('audit_write_failed');
        hl_letter_redirect('error');
    }
    $attributes = [
        'HL_SIGNUP_SOURCE' => 'heritage-libanais.fr/la-lettre',
        'HL_CONSENT_VERSION' => HL_LETTER_CONSENT_VERSION,
        'HL_CONSENT_AT' => gmdate('c')
    ];
    $attributes['FIRSTNAME'] = $name;
    $attributes['LASTNAME'] = $last_name;
    $response = wp_remote_post('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', [
        'timeout' => 12,
        'headers' => ['api-key' => hl_letter_api_key(), 'Content-Type' => 'application/json', 'Accept' => 'application/json'],
        'body' => wp_json_encode([
            'email' => $email,
            'attributes' => $attributes,
            'includeListIds' => [HL_LETTER_LIST_ID],
            'templateId' => HL_LETTER_DOI_TEMPLATE_ID,
            'redirectionUrl' => home_url('/la-lettre/?hl_letter=confirmed')
        ])
    ]);
    if (is_wp_error($response)) {
        hl_letter_audit_status($audit_id, 'failed');
        hl_letter_diagnostic('transport_' . $response->get_error_code());
        hl_letter_redirect('error');
    }
    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 201 && $code !== 204) {
        hl_letter_audit_status($audit_id, 'failed');
        $body = json_decode(wp_remote_retrieve_body($response), true);
        $brevo_code = is_array($body) && isset($body['code']) && is_scalar($body['code']) ? (string) $body['code'] : 'unknown';
        hl_letter_diagnostic('brevo_http_' . $code . '_' . $brevo_code);
        hl_letter_redirect('error');
    }
    hl_letter_audit_status($audit_id, 'doi_requested');
    hl_letter_diagnostic('brevo_http_' . $code . '_ok');
    hl_letter_redirect('verify');
}
add_action('admin_post_nopriv_hl_letter_signup', 'hl_letter_signup');
add_action('admin_post_hl_letter_signup', 'hl_letter_signup');

function hl_letter_raster_image_url($value) {
    $url = esc_url_raw((string) $value, ['https']);
    $path = wp_parse_url($url, PHP_URL_PATH);
    return $path && preg_match('/\.(png|jpe?g|gif|webp)$/i', $path) ? $url : '';
}

function hl_letter_story_image($post) {
    $thumbnail_id = get_post_thumbnail_id($post);
    $thumbnail = $thumbnail_id ? hl_letter_raster_image_url(wp_get_attachment_image_url($thumbnail_id, 'large')) : '';
    if ($thumbnail !== '') return [$thumbnail, (string) get_post_meta($thumbnail_id, '_wp_attachment_image_alt', true)];
    if (class_exists('WP_HTML_Tag_Processor')) {
        $tags = new WP_HTML_Tag_Processor((string) $post->post_content);
        while ($tags->next_tag('IMG')) {
            $classes = (string) $tags->get_attribute('class');
            if (preg_match('/\b(logo|new-cover-mark)\b/i', $classes) || $tags->get_attribute('aria-hidden') === 'true') continue;
            $url = hl_letter_raster_image_url($tags->get_attribute('src'));
            if ($url !== '') return [$url, (string) $tags->get_attribute('alt')];
        }
    }
    return ['', ''];
}

function hl_letter_latest_story_and_event() {
    $posts = get_posts(['post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => 100, 'orderby' => 'date', 'order' => 'DESC']);
    $story = null; $event = null; $event_time = PHP_INT_MAX;
    foreach ($posts as $post) {
        $html = (string) $post->post_content;
        if ($story === null && strpos($html, 'editorial-carousel') !== false) {
            list($image, $alt) = hl_letter_story_image($post);
            $story = ['title' => get_the_title($post), 'url' => get_permalink($post), 'image' => $image, 'alt' => $alt];
        }
        if (strpos($html, 'event-hero') === false) continue;
        $date = (string) get_post_meta($post->ID, 'hl_event_start', true);
        if ($date === '' && preg_match("~<time\\b[^>]*datetime=[\"']([^\"']+)[\"']~i", $html, $matches)) $date = $matches[1];
        $timestamp = $date !== '' ? strtotime($date) : false;
        if ($timestamp === false || $timestamp <= time() || $timestamp >= $event_time) continue;
        $event_time = $timestamp;
        $event = ['title' => get_the_title($post), 'url' => get_permalink($post), 'date' => wp_date('j F Y', $timestamp, wp_timezone()) . ' à ' . wp_date('H:i', $timestamp, wp_timezone())];
    }
    return [$story, $event];
}

function hl_letter_welcome_webhook(WP_REST_Request $request) {
    $secret = (string) get_option('hl_letter_webhook_token', '');
    $auth = (string) $request->get_header('x-hl-letter-webhook');
    if ($secret === '' || !hash_equals($secret, $auth)) return new WP_REST_Response(['error' => 'unauthorized'], 401);
    if (!hl_letter_ready()) return new WP_REST_Response(['error' => 'newsletter_unavailable'], 503);
    $payload = $request->get_json_params();
    if (!is_array($payload) || ($payload['event'] ?? '') !== 'list_addition' || !in_array(HL_LETTER_LIST_ID, array_map('intval', (array) ($payload['list_id'] ?? [])), true)) return new WP_REST_Response(['ok' => true, 'ignored' => true], 200);
    $email = sanitize_email((string) ($payload['email'] ?? ''));
    if (!is_email($email)) return new WP_REST_Response(['error' => 'invalid_email'], 400);
    $email_hash = hash_hmac('sha256', strtolower($email), wp_salt('auth'));
    global $wpdb;
    $table = $wpdb->prefix . 'hl_letter_consent';
    $started = (string) get_option('hl_letter_welcome_started_at', '');
    if ($started === '') return new WP_REST_Response(['ok' => true, 'ignored' => true], 200);
    $recent = $wpdb->get_var($wpdb->prepare("SELECT id FROM $table WHERE email_hash = %s AND brevo_status = 'doi_requested' AND submitted_at >= %s ORDER BY id DESC LIMIT 1", $email_hash, $started));
    if (!$recent) return new WP_REST_Response(['ok' => true, 'ignored' => true], 200);
    $contact_response = wp_remote_get('https://api.brevo.com/v3/contacts/' . rawurlencode($email), ['timeout' => 12, 'headers' => ['api-key' => hl_letter_api_key(), 'Accept' => 'application/json']]);
    if (is_wp_error($contact_response) || wp_remote_retrieve_response_code($contact_response) !== 200) return new WP_REST_Response(['error' => 'contact_check_failed'], 503);
    $contact = json_decode(wp_remote_retrieve_body($contact_response), true);
    if (!is_array($contact) || !in_array(HL_LETTER_LIST_ID, (array) ($contact['listIds'] ?? []), true) || !empty($contact['emailBlacklisted']) || in_array(HL_LETTER_LIST_ID, (array) ($contact['listUnsubscribed'] ?? []), true) || ($contact['attributes']['HL_SIGNUP_SOURCE'] ?? '') !== 'heritage-libanais.fr/la-lettre') return new WP_REST_Response(['ok' => true, 'ignored' => true], 200);
    list($story, $event) = hl_letter_latest_story_and_event();
    if (!$story || !wp_http_validate_url($story['url'])) return new WP_REST_Response(['error' => 'story_unavailable'], 503);
    $marker = 'hl_letter_welcome_' . $email_hash;
    if (!add_option($marker, ['status' => 'processing', 'at' => gmdate('c')], '', false)) return new WP_REST_Response(['ok' => true, 'already_processed' => true], 200);
    $params = [
        'STORY_TITLE' => $story['title'], 'STORY_URL' => $story['url'],
        'STORY_IMAGE_URL' => $story['image'], 'STORY_IMAGE_ALT' => $story['alt'],
        'EVENT_TITLE' => $event['title'] ?? '', 'EVENT_DATE' => $event['date'] ?? '', 'EVENT_URL' => $event['url'] ?? ''
    ];
    $send = wp_remote_post('https://api.brevo.com/v3/smtp/email', [
        'timeout' => 15,
        'headers' => ['api-key' => hl_letter_api_key(), 'Content-Type' => 'application/json', 'Accept' => 'application/json'],
        'body' => wp_json_encode(['to' => [['email' => $email]], 'templateId' => HL_LETTER_WELCOME_TEMPLATE_ID, 'params' => $params])
    ]);
    $status = !is_wp_error($send) ? wp_remote_retrieve_response_code($send) : 0;
    if ($status === 201) {
        update_option($marker, ['status' => 'sent', 'at' => gmdate('c')], false);
        hl_letter_diagnostic('welcome_sent');
        return new WP_REST_Response(['ok' => true], 200);
    }
    // An ambiguous network failure must not cause a duplicate welcome on webhook retry.
    update_option($marker, ['status' => 'uncertain', 'at' => gmdate('c'), 'http' => $status], false);
    hl_letter_diagnostic('welcome_uncertain_' . $status);
    return new WP_REST_Response(['error' => 'send_uncertain'], 503);
}
add_action('rest_api_init', function () {
    register_rest_route('hl-letter/v1', '/brevo-list-addition', [
        'methods' => 'POST', 'callback' => 'hl_letter_welcome_webhook', 'permission_callback' => '__return_true'
    ]);
});

add_action('admin_post_hl_letter_connect_welcome', function () {
    if (!current_user_can('manage_options') || !check_admin_referer('hl_letter_connect_welcome')) wp_die('Accès refusé.');
    $secret = (string) get_option('hl_letter_webhook_token', '');
    if (hl_letter_ready() && $secret !== '' && !get_option('hl_letter_welcome_webhook_id')) {
        $url = rest_url('hl-letter/v1/brevo-list-addition');
        $headers = ['api-key' => hl_letter_api_key(), 'Content-Type' => 'application/json', 'Accept' => 'application/json'];
        $existing = wp_remote_get('https://api.brevo.com/v3/webhooks?type=marketing', ['timeout' => 12, 'headers' => $headers]);
        $webhooks = is_wp_error($existing) ? [] : (json_decode(wp_remote_retrieve_body($existing), true)['webhooks'] ?? []);
        $id = 0;
        foreach ($webhooks as $webhook) {
            if (($webhook['url'] ?? '') !== $url || !in_array('listAddition', (array) ($webhook['events'] ?? []), true)) continue;
            foreach ((array) ($webhook['headers'] ?? []) as $header) {
                if (strtolower($header['key'] ?? '') === 'x-hl-letter-webhook' && hash_equals($secret, (string) ($header['value'] ?? ''))) $id = (int) $webhook['id'];
            }
        }
        if (!$id) {
            $response = wp_remote_post('https://api.brevo.com/v3/webhooks', [
                'timeout' => 15, 'headers' => $headers,
                'body' => wp_json_encode(['url' => $url, 'description' => 'Héritage Libanais · Bienvenue après confirmation', 'type' => 'marketing', 'events' => ['listAddition'], 'batched' => false, 'headers' => [['key' => 'X-HL-Letter-Webhook', 'value' => $secret]]])
            ]);
            if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 201) $id = (int) (json_decode(wp_remote_retrieve_body($response), true)['id'] ?? 0);
        }
        if ($id) {
            update_option('hl_letter_welcome_started_at', gmdate('Y-m-d H:i:s'), false);
            update_option('hl_letter_welcome_webhook_id', $id, false);
        }
        hl_letter_diagnostic($id ? 'welcome_connected' : 'welcome_connection_failed');
    }
    wp_safe_redirect(admin_url('options-general.php?page=hl-letter'));
    exit;
});
