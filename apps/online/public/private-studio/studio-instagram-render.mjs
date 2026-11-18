const WIDTH = 1080;
const HEIGHT = 1350;
const EDGES = ['Top', 'Right', 'Bottom', 'Left'];

function localBox(rect, origin) {
  return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
}

function paintBox(context, box, style) {
  const { x, y, width, height } = box;
  context.fillStyle = style.backgroundColor;
  context.fillRect(x, y, width, height);
  for (const [index, edge] of EDGES.entries()) {
    const thickness = parseFloat(style['border' + edge + 'Width']);
    if (!thickness || style['border' + edge + 'Style'] === 'none') continue;
    const vertical = index % 2 === 0;
    context.fillStyle = style['border' + edge + 'Color'];
    context.fillRect(
      edge === 'Right' ? x + width - thickness : x,
      edge === 'Bottom' ? y + height - thickness : y,
      vertical ? width : thickness,
      vertical ? thickness : height,
    );
  }
}

function paintDecoration(context, frame, pseudo) {
  const style = getComputedStyle(frame, pseudo);
  if (style.content === 'none' || style.content === 'normal') return;
  const top = parseFloat(style.top);
  const right = parseFloat(style.right);
  const bottom = parseFloat(style.bottom);
  const left = parseFloat(style.left);
  const width = Number.isFinite(left + right) ? WIDTH - left - right : parseFloat(style.width);
  const height = Number.isFinite(top + bottom) ? HEIGHT - top - bottom : parseFloat(style.height);
  paintBox(context, {
    x: Number.isFinite(left) ? left : WIDTH - right - width,
    y: Number.isFinite(top) ? top : HEIGHT - bottom - height,
    width,
    height,
  }, style);
}

function paintImage(context, image, box, style) {
  const { x, y, width, height } = box;
  if (width <= 0 || height <= 0) throw new Error('Un visuel ne tient plus dans cette carte.');
  const fit = style.objectFit === 'cover' ? Math.max : Math.min;
  const scale = fit(width / image.naturalWidth, height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, x + (width - renderedWidth) / 2, y + (height - renderedHeight) / 2, renderedWidth, renderedHeight);
  context.restore();
}

// Read line breaks from the browser's layout, including wrapped words and authored newlines.
function textLines(node) {
  const range = document.createRange();
  const lines = [];
  let offset = 0;
  for (const char of node.data) {
    range.setStart(node, offset);
    offset += char.length;
    range.setEnd(node, offset);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height || char === '\n' || char === '\r') continue;
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.top - rect.top) < 1) {
      previous.text += char;
      previous.left = Math.min(previous.left, rect.left);
      previous.right = Math.max(previous.right, rect.right);
    } else {
      lines.push({ text: char, left: rect.left, right: rect.right, top: rect.top, height: rect.height });
    }
  }
  return lines;
}

function paintText(context, node, style, origin) {
  if (!node.data.trim()) return;
  context.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ');
  context.fillStyle = style.color;
  context.direction = style.direction;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const supportsSpacing = 'letterSpacing' in context;
  if (supportsSpacing) context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  const metrics = context.measureText('Mg');
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  for (const line of textLines(node)) {
    const text = style.textTransform === 'uppercase' ? line.text.toLocaleUpperCase('fr') : line.text;
    const x = line.left - origin.left;
    const y = line.top - origin.top + (line.height + ascent - descent) / 2;
    if (supportsSpacing) context.fillText(text, x, y);
    else context.fillText(text, x, y, line.right - line.left);
  }
}

function paintElement(context, element, style, origin) {
  if (style.display === 'none' || style.visibility === 'hidden') return;
  const box = localBox(element.getBoundingClientRect(), origin);
  paintBox(context, box, style);
  if (element instanceof HTMLImageElement) {
    paintImage(context, element, box, style);
    return;
  }
  const children = [...element.childNodes].map(node => {
    const childStyle = node.nodeType === Node.ELEMENT_NODE ? getComputedStyle(node) : style;
    return { node, style: childStyle, z: node.nodeType === Node.ELEMENT_NODE ? Number(childStyle.zIndex) || 0 : 0 };
  }).sort((a, b) => a.z - b.z);
  for (const child of children) {
    if (child.node.nodeType === Node.ELEMENT_NODE) paintElement(context, child.node, child.style, origin);
    else if (child.node.nodeType === Node.TEXT_NODE) paintText(context, child.node, style, origin);
  }
}

function checkFit(frame) {
  const copy = frame.querySelector('.slide-copy');
  const gallery = frame.querySelector('.slide-gallery');
  const story = frame.classList.contains('story-template');
  if (!story && gallery) {
    const style = getComputedStyle(frame);
    const room = HEIGHT - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.gap) - copy.scrollHeight;
    gallery.style.height = Math.max(160, Math.min(420, room)) + 'px';
  }
  const dense = story
    ? copy.scrollHeight > copy.clientHeight + 2
    : frame.scrollHeight > HEIGHT + 2 || [copy, gallery].some(element => element && element.offsetTop + element.offsetHeight > HEIGHT - 71);
  if (dense) throw new Error('Cette carte est trop chargée. Répartissez son texte sur une autre carte.');
}

/** Rasterize a Studio card rendered at its full size, keeping images and fonts in the browser. */
export async function renderInstagramJpeg(renderCard) {
  const stage = document.createElement('div');
  stage.className = 'slide-stage';
  stage.setAttribute('aria-hidden', 'true');
  Object.assign(stage.style, { position: 'fixed', top: '0', left: '-10000px', width: WIDTH + 'px', height: HEIGHT + 'px' });
  const frame = document.createElement('div');
  stage.append(frame);
  document.body.append(stage);
  const canvas = document.createElement('canvas');
  try {
    renderCard(frame);
    if (frame.querySelector('.slide-missing-photo, .template-empty-box')) {
      throw new Error('Ajoutez ou rattachez les images de cette carte avant l’export.');
    }
    const images = [...frame.querySelectorAll('img')];
    // Trigger the browser's layout and font requests before waiting for their completion.
    frame.getBoundingClientRect();
    await Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => {
      throw new Error('Un visuel de cette carte ne peut pas être chargé. Remplacez-le avant l’export.');
    }))]);
    checkFit(frame);
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('La création de fichiers JPEG est indisponible dans ce navigateur.');
    context.imageSmoothingQuality = 'high';
    paintElement(context, frame, getComputedStyle(frame), frame.getBoundingClientRect());
    paintDecoration(context, frame, '::before');
    paintDecoration(context, frame, '::after');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (blob?.type !== 'image/jpeg') throw new Error('Le fichier JPEG n’a pas pu être créé.');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    stage.remove();
  }
}
