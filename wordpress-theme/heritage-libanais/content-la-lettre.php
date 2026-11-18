<section class="letter-hero container">
  <div>
    <p class="eyebrow">Newsletter</p>
    <h1 class="display">Un lien à garder, <em>une histoire à recevoir.</em></h1>
    <p class="lede">Les nouveaux récits, les rencontres à venir et quelques découvertes choisies avec soin, directement dans votre boîte mail.</p>
  </div>
  <div class="letter-card">
    <?php if (function_exists('hl_letter_ready') && hl_letter_ready()) : ?>
      <h2>Recevoir la newsletter</h2>
      <?php echo do_shortcode('[hl_letter_form]'); ?>
    <?php else : ?>
      <h2>Les inscriptions ouvriront bientôt</h2>
      <p>Nous préparons la première édition de la newsletter Héritage Libanais. Revenez sur cette page pour vous inscrire lorsqu'elle sera disponible.</p>
      <a class="button secondary" href="<?php echo esc_url(home_url('/recits/')); ?>">Découvrir les récits <span class="arrow" aria-hidden="true">↗</span></a>
    <?php endif; ?>
  </div>
</section>
<section id="confidentialite" class="container">
  <div class="newsletter-strip">
    <div><p class="eyebrow">Respect de vos données</p><h2 class="section-title">Une newsletter <em>en toute clarté.</em></h2></div>
    <div>
      <?php if (function_exists('hl_letter_ready') && hl_letter_ready()) : ?>
        <p>Héritage Libanais utilise votre nom, votre prénom et votre adresse e-mail, avec votre accord, pour vous envoyer sa newsletter.</p>
        <p>Pour toute question concernant vos données, écrivez à <a href="mailto:heritage.libanais@gmail.com">heritage.libanais@gmail.com</a>.</p>
      <?php else : ?>
        <p>Lorsque les inscriptions ouvriront, le formulaire indiquera les usages de vos données et proposera une désinscription simple.</p>
      <?php endif; ?>
    </div>
  </div>
</section>
