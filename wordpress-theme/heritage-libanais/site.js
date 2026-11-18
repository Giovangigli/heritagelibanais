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

// Navigation des rails et des trois carrousels éditoriaux.
document.querySelectorAll('[data-carousel], .editorial-carousel').forEach((carousel) => {
  const track = carousel.querySelector('[data-carousel-track]');
  const slides = [...carousel.querySelectorAll('[data-slide]')];
  const editorial = carousel.classList.contains('editorial-carousel');
  const previous = carousel.querySelector('[data-carousel-prev]');
  const next = carousel.querySelector('[data-carousel-next]');
  const count = carousel.querySelector('[data-carousel-count]');
  const caption = carousel.querySelector('[data-carousel-caption]');
  if (!track || !slides.length || (!editorial && (!previous || !next || !count))) return;
  const allHomeStoriesVisible = carousel.id === 'explorer' && slides.length <= 3;
  let activeIndex = 0;
  // Place a second pair of controls next to the cards for discoverability.
  let sidePrevious, sideNext;
  if (editorial && slides.length > 1) {
    const frame = document.createElement('div');
    frame.className = 'editorial-track-frame';
    track.before(frame);
    frame.append(track);
    sidePrevious = document.createElement('button');
    sideNext = document.createElement('button');
    sidePrevious.type = sideNext.type = 'button';
    sidePrevious.className = 'card-side-arrow card-side-prev';
    sideNext.className = 'card-side-arrow card-side-next';
    sidePrevious.setAttribute('aria-label', 'Carte précédente');
    sideNext.setAttribute('aria-label', 'Carte suivante');
    sidePrevious.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 4-8 8 8 8"/></svg>';
    sideNext.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 4 8 8-8 8"/></svg>';
    frame.append(sidePrevious, sideNext);
    frame.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const bounds = frame.getBoundingClientRect();
      const edge = Math.min(120, bounds.width / 3);
      frame.classList.toggle('near-prev', event.clientX - bounds.left < edge);
      frame.classList.toggle('near-next', bounds.right - event.clientX < edge);
    });
    frame.addEventListener('pointerleave', () => frame.classList.remove('near-prev', 'near-next'));
  }
  const inset = () => parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;

  const update = (index) => {
    activeIndex = Math.max(0, Math.min(index, slides.length - 1));
    if (count) count.textContent = `${activeIndex + 1} / ${slides.length}`;
    carousel.querySelectorAll('.hl-card-nav [data-card-target]').forEach((button, buttonIndex) => button.setAttribute('aria-current', String(buttonIndex === activeIndex)));
    if (caption) caption.textContent = slides[activeIndex].dataset.carouselLabel || `${activeIndex + 1} / ${slides.length}`;
    if (previous) previous.disabled = activeIndex === 0;
    if (next) next.disabled = allHomeStoriesVisible || activeIndex === slides.length - 1;
    if (sidePrevious) sidePrevious.disabled = activeIndex === 0;
    if (sideNext) sideNext.disabled = activeIndex === slides.length - 1;

  };
  const show = (index) => {
    const target = Math.max(0, Math.min(index, slides.length - 1));
    const left = slides[target].getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft - inset();
    track.scrollTo({ left, behavior: 'instant' });
    update(target);
  };
  if (previous) previous.addEventListener('click', () => show(activeIndex - 1));
  if (next) next.addEventListener('click', () => show(activeIndex + 1));
  if (sidePrevious) sidePrevious.addEventListener('click', () => show(activeIndex - 1));
  if (sideNext) sideNext.addEventListener('click', () => show(activeIndex + 1));
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(activeIndex + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(activeIndex - 1); }
  });
  const syncFromScroll = () => {
    const position = track.scrollLeft;
    const closest = slides.reduce((best, slide, index) => {
      const distance = Math.abs(slide.offsetLeft - slides[0].offsetLeft - position);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity });
    update(closest.index);
  };
  let scrollFrame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(syncFromScroll);
  }, { passive: true });
  track.addEventListener('scrollend', syncFromScroll);
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
    track.scrollTo({ left, behavior: 'instant' });
    buttons.forEach((item) => item.setAttribute('aria-current', String(item === button)));
  };
  buttons.forEach((button) => button.addEventListener('click', () => select(button)));
  if (buttons[0]) buttons[0].setAttribute('aria-current', 'true');
});
