<?php
if (!defined('ABSPATH')) exit;

function hl_studio_posts($type, $limit = 12) {
    $posts = get_posts([
        'post_type' => 'post',
        'post_status' => 'publish',
        'posts_per_page' => 200,
        'orderby' => 'date',
        'order' => 'DESC',
    ]);
    $marker = $type === 'evenement' ? 'event-hero' : 'editorial-carousel';
    $selected = [];
    foreach ($posts as $post) {
        if (strpos($post->post_name, 'studio-') !== 0) continue;
        if (strpos($post->post_content, $marker) === false) continue;
        $selected[] = $post;
        if (count($selected) >= $limit) break;
    }
    return $selected;
}

function hl_studio_cards($type, $limit = 12) {
    foreach (hl_studio_posts($type, $limit) as $post) {
        $url = get_permalink($post);
        $title = get_the_title($post);
        $image = get_the_post_thumbnail_url($post, 'large');
        if (!$image) $image = get_template_directory_uri() . '/assets/identity-landscape.svg';
        if ($type === 'evenement') {
            $event_date = get_the_date('j F Y', $post);
            if (preg_match('/<time\b[^>]*datetime=["\']([^"\']+)["\']/i', $post->post_content, $match)) {
                $timestamp = strtotime($match[1]);
                if ($timestamp) $event_date = date_i18n('j F Y', $timestamp);
            }
            echo '<a class="event-card event-card-with-image" href="' . esc_url($url) . '">';
            echo '<img src="' . esc_url($image) . '" alt="" loading="lazy">';
            echo '<span class="event-date">' . esc_html($event_date) . '</span>';
            echo '<div><p class="meta">Événement</p><h3>' . esc_html($title) . '</h3><p>' . esc_html(get_the_excerpt($post)) . '</p></div>';
            echo '<span class="arrow" aria-hidden="true">↗</span></a>';
        } else {
            echo '<article class="story-card"><a href="' . esc_url($url) . '" aria-label="Voir le récit ' . esc_attr($title) . '">';
            echo '<div class="media-panel"><img class="art carousel-cover" src="' . esc_url($image) . '" alt="" loading="lazy"></div></a>';
            echo '<h3><a href="' . esc_url($url) . '">' . esc_html($title) . '</a></h3>';
            echo '<a class="text-link" href="' . esc_url($url) . '">Voir le récit <span class="arrow" aria-hidden="true">↗</span></a></article>';
        }
    }
}
