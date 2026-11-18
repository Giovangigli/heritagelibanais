<?php
if (!defined('ABSPATH')) exit;
add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
});
add_action('wp_enqueue_scripts', function () {
    $uri = get_template_directory_uri();
    wp_enqueue_style('hl-design', $uri . '/design-system.css', [], '1.0.23');
    wp_enqueue_style('hl-stories', $uri . '/stories.css', ['hl-design'], '1.0.23');
    wp_enqueue_script('hl-site', $uri . '/site.js', [], '1.0.23', true);
});
// The three récit pages use the curated slider; events have no suggestions.
add_filter('jetpack_relatedposts_filter_options', function ($options) {
    if (is_single([17, 53, 55, 57, 91])) $options['enabled'] = false;
    return $options;
});

// Make the Publications page available when this theme is updated in place.
add_action('init', function () {
    if (get_page_by_path('publications')) return;
    wp_insert_post([
        'post_type' => 'page',
        'post_status' => 'publish',
        'post_name' => 'publications',
        'post_title' => 'Publications',
        'post_content' => '',
    ]);
});

require_once __DIR__ . '/studio-publications.php';
