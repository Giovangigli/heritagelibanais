const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
if (menuToggle && siteNav) {
  menuToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  siteNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      siteNav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Ouvrir le menu');
    }
  });
}

const filterGrid = document.querySelector('[data-filter-grid]');
if (filterGrid) {
  const filters = [...document.querySelectorAll('[data-filter]')];
  const cards = [...filterGrid.querySelectorAll('[data-theme]')];
  const empty = document.querySelector('[data-filter-empty]');
  const selectFilter = (value) => {
    let shown = 0;
    filters.forEach((filter) => filter.setAttribute('aria-pressed', String(filter.dataset.filter === value)));
    cards.forEach((card) => {
      const visible = value === 'all' || card.dataset.theme === value;
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    if (empty) empty.style.display = shown ? 'none' : 'block';
  };
  filters.forEach((filter) => filter.addEventListener('click', () => {
    selectFilter(filter.dataset.filter);
    history.replaceState(null, '', filter.dataset.filter === 'all' ? location.pathname : `#${filter.dataset.filter}`);
  }));
  const hash = location.hash.slice(1);
  if (filters.some((filter) => filter.dataset.filter === hash)) selectFilter(hash);
}

document.querySelectorAll('[data-preview-form]').forEach((previewForm) => {
  previewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const firstName = previewForm.querySelector('[name=prenom]');
    const lastName = previewForm.querySelector('[name=nom]');
    const email = previewForm.querySelector('[name=email]');
    const consent = previewForm.querySelector('[name=consent]');
    const feedback = previewForm.querySelector('[data-form-feedback]');
    [firstName, lastName, email].forEach((field) => field.removeAttribute('aria-invalid'));
    feedback.className = 'form-feedback';
    for (const [field, label] of [[firstName, 'prénom'], [lastName, 'nom']]) {
      if (!field.value.trim()) {
        field.setAttribute('aria-invalid', 'true');
        feedback.textContent = `Saisissez votre ${label}.`;
        feedback.classList.add('error');
        field.focus();
        return;
      }
    }
    if (!email.validity.valid) {
      email.setAttribute('aria-invalid', 'true');
      feedback.textContent = 'Saisissez une adresse e-mail valide.';
      feedback.classList.add('error');
      email.focus();
      return;
    }
    if (!consent.checked) {
      feedback.textContent = 'Cochez la case de consentement pour continuer.';
      feedback.classList.add('error');
      consent.focus();
      return;
    }
    feedback.textContent = 'Aperçu validé. Aucune donnée n’a été enregistrée.';
    feedback.classList.add('success');
  });
});

// Navigation des rails et des trois carrousels éditoriaux.
document.querySelectorAll('[data-carousel]').forEach((carousel) => {
  const track = carousel.querySelector('[data-carousel-track]');
  const slides = [...carousel.querySelectorAll('[data-slide]')];
  const previous = carousel.querySelector('[data-carousel-prev]');
  const next = carousel.querySelector('[data-carousel-next]');
  const count = carousel.querySelector('[data-carousel-count]');
  const caption = carousel.querySelector('[data-carousel-caption]');
  if (!track || !slides.length || !previous || !next || !count) return;
  let activeIndex = 0;
  const inset = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;

  const update = (index) => {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    count.textContent = `${activeIndex + 1} / ${slides.length}`;
    if (caption) caption.textContent = slides[activeIndex].dataset.carouselLabel || `${activeIndex + 1} / ${slides.length}`;
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === slides.length - 1;
    track.scrollTop = 0;
  };
  const show = (index) => {
    const target = Math.max(0, Math.min(index, slides.length - 1));
    const left = slides[target].getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft - inset();
    track.scrollTo({ left, behavior: 'auto' });
    update(target);
  };
  previous.addEventListener('click', () => show(activeIndex - 1));
  next.addEventListener('click', () => show(activeIndex + 1));
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(activeIndex + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(activeIndex - 1); }
  });
  let scrollFrame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const left = track.getBoundingClientRect().left + inset();
      const closest = slides.reduce((best, slide, index) => {
        const distance = Math.abs(slide.getBoundingClientRect().left - left);
        return distance < best.distance ? { index, distance } : best;
      }, { index: 0, distance: Infinity });
      update(closest.index);
    });
  }, { passive: true });
  update(0);
});

document.querySelectorAll('.hl-card-nav').forEach((navigation) => {
  const buttons = [...navigation.querySelectorAll('[data-card-target]')];
  const track = navigation.closest('.editorial-carousel')?.querySelector('[data-carousel-track]');
  if (!track) return;
  const select = (button) => {
    const slide = document.getElementById(button.dataset.cardTarget);
    if (!slide || !track.contains(slide)) return;
    const left = slide.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    track.scrollTo({ left, behavior: 'smooth' });
    buttons.forEach((item) => item.setAttribute('aria-current', String(item === button)));
  };
  buttons.forEach((button) => button.addEventListener('click', () => select(button)));
  if (buttons[0]) buttons[0].setAttribute('aria-current', 'true');
});
