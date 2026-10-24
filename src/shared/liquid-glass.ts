/* A DOM enhancement shared by static pages and React Studio. The optical layer never contains text.
 * Edge-displacement approach informed by rdev/liquid-glass-react; the rounded lens map is generated
 * here from each element's actual geometry. See docs/liquid-glass.md for research and browser limits. */
const NS = 'http://www.w3.org/2000/svg';
const surfaces = '.glass, .glass-panel, .liquid-lens, .studio-sidebar, dialog';
const optics = '.glass, .outline-card, .liquid-lens, .studio-sidebar, .profile-card, dialog';
const maps = new Map<string, string>();

export function lensPixels(width: number, height: number, radius: number, resolution = 640) {
  const ratio = Math.min(1, resolution / Math.max(width, height));
  const w = Math.max(2, Math.round(width * ratio));
  const h = Math.max(2, Math.round(height * ratio));
  const pixels = new Uint8ClampedArray(w * h * 4);
  // Fill neutral pixels in native words, then evaluate only the rounded edge band.
  const neutral = new Uint32Array(new Uint8Array([128, 128, 0, 255]).buffer)[0];
  new Uint32Array(pixels.buffer).fill(neutral);
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const band = Math.min(26, Math.min(width, height) * 0.36, r * 0.8 + 6);
  const inset = Math.max(r, band);
  const firstInterior = Math.max(0, Math.ceil((inset / width) * w - 0.5));
  const lastInterior = Math.min(w, Math.floor(((width - inset) / width) * w - 0.5) + 1);
  const xs = new Float64Array(w),
    qxs = new Float64Array(w),
    dxs = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    xs[x] = ((x + 0.5) / w) * width - width / 2;
    qxs[x] = Math.abs(xs[x]) - width / 2 + r;
    dxs[x] = Math.max(qxs[x], 0);
  }
  for (let y = 0; y < h; y++) {
    const py = ((y + 0.5) / h) * height - height / 2;
    const qy = Math.abs(py) - height / 2 + r,
      dy = Math.max(qy, 0);
    const skipInterior = Math.abs(py) <= height / 2 - inset && firstInterior < lastInterior;
    for (let x = 0; x < w; x++) {
      if (skipInterior && x === firstInterior) {
        x = lastInterior - 1;
        continue;
      }
      const px = xs[x],
        qx = qxs[x],
        dx = dxs[x];
      const length = Math.hypot(dx, dy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - r;
      const t = Math.max(0, -distance / band);
      const gain = distance <= 0 && t < 1 ? Math.pow(1 - t, 1.65) : 0;
      const nx = length > 0 ? dx / length : qx > qy ? 1 : 0;
      const ny = length > 0 ? dy / length : qy >= qx ? 1 : 0;
      const offset = (y * w + x) * 4;
      pixels[offset] = Math.round(128 + Math.sign(px) * nx * gain * 127);
      pixels[offset + 1] = Math.round(128 + Math.sign(py) * ny * gain * 127);
      pixels[offset + 2] = Math.round(gain * 255);
      pixels[offset + 3] = 255;
    }
  }
  return { width: w, height: h, pixels };
}

function displacementImage(width: number, height: number, radius: number) {
  const key = `${width}:${height}:${radius}`;
  const cached = maps.get(key);
  if (cached) return cached;
  const data = lensPixels(width, height, radius);
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.putImageData(new ImageData(data.pixels, data.width, data.height), 0, 0);
  const url = canvas.toDataURL('image/png');
  if (maps.size >= 48) maps.delete(maps.keys().next().value!);
  maps.set(key, url);
  return url;
}

function svgElement(name: string, attrs: Record<string, string | number>) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}
function opticalFilter(
  id: string,
  width: number,
  height: number,
  radius: number,
  strength: number,
) {
  const filter = svgElement('filter', {
    id,
    x: '-30%',
    y: '-30%',
    width: '160%',
    height: '160%',
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(
    svgElement('feImage', {
      href: displacementImage(width, height, radius),
      x: 0,
      y: 0,
      width,
      height,
      preserveAspectRatio: 'none',
      result: 'lens',
    }),
  );
  const channels = ['R', 'G', 'B'];
  channels.forEach((_, index) => {
    filter.append(
      svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'lens',
        scale: (24 + strength * 32) * (1 + index * 0.035),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: `shift-${index}`,
      }),
    );
    const matrix = Array.from({ length: 20 }, (_, i) => (i === index * 6 || i === 18 ? 1 : 0)).join(
      ' ',
    );
    filter.append(
      svgElement('feColorMatrix', {
        in: `shift-${index}`,
        type: 'matrix',
        values: matrix,
        result: `channel-${index}`,
      }),
    );
  });
  filter.append(
    svgElement('feBlend', { in: 'channel-0', in2: 'channel-1', mode: 'screen', result: 'rg' }),
    svgElement('feBlend', { in: 'rg', in2: 'channel-2', mode: 'screen' }),
  );
  return filter;
}

export function startLiquidGlass() {
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const increasedContrast = matchMedia('(prefers-contrast: more)');
  // WebKit and Firefox accept some URL-filter syntax without rendering a refractive backdrop.
  const refractive =
    /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent) && CSS.supports('filter', 'url("#lens")');
  const svg = svgElement('svg', {
    'aria-hidden': 'true',
    focusable: 'false',
    width: 0,
    height: 0,
    'data-liquid-definitions': '',
  });
  Object.assign(svg.style, { position: 'fixed', width: '0', height: '0', pointerEvents: 'none' });
  const defs = svgElement('defs', {});
  svg.append(defs);
  document.body.append(svg);
  const tracked = new Map<
    HTMLElement,
    { visible: boolean; key: string; filter: Element | null; id: string }
  >();
  const pending = new Set<HTMLElement>();
  let sequence = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const solid = () =>
    root.dataset.reduceTransparency === 'true' ||
    reducedTransparency.matches ||
    increasedContrast.matches;
  function flush() {
    timer = undefined;
    root.dataset.glassRenderer = solid() ? 'solid' : refractive ? 'svg' : 'css';
    const rootStyles = getComputedStyle(root);
    const strength = parseFloat(rootStyles.getPropertyValue('--glass-strength')) || 0;
    const requestedBlur = parseFloat(rootStyles.getPropertyValue('--glass-blur'));
    const blur = Number.isFinite(requestedBlur) ? requestedBlur : 11;
    const saturation = rootStyles.getPropertyValue('--glass-saturation').trim() || '150%';
    for (const host of pending) {
      const state = tracked.get(host);
      if (!state || !state.visible || !host.isConnected) continue;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const width = Math.round(rect.width),
        height = Math.round(rect.height);
      const styles = getComputedStyle(host);
      const measuredRadius = parseFloat(styles.borderTopLeftRadius);
      const radius = Math.round(
        Math.min(
          Number.isFinite(measuredRadius) ? Math.max(0, measuredRadius) : 24,
          width / 2,
          height / 2,
        ),
      );
      host.style.setProperty('--liquid-radius', `${radius}px`);
      const key = `${width}:${height}:${radius}:${strength}:${blur}:${saturation}:${solid()}`;
      if (state.key === key) continue;
      state.key = key;
      state.filter?.remove();
      state.filter = null;
      if (refractive && !solid() && strength > 0) {
        state.filter = opticalFilter(state.id, width, height, radius, strength);
        defs.append(state.filter);
        host.style.setProperty(
          '--liquid-refraction',
          `url("#${state.id}") blur(${(blur * 0.65).toFixed(2)}px) saturate(${saturation})`,
        );
      } else
        host.style.setProperty(
          '--liquid-refraction',
          `blur(${(blur * 0.65).toFixed(2)}px) saturate(${saturation})`,
        );
    }
    pending.clear();
  }
  function queue(host: HTMLElement) {
    pending.add(host);
    timer ??= setTimeout(flush, 70);
  }
  const visibility = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        const host = entry.target as HTMLElement,
          state = tracked.get(host);
        if (state) {
          state.visible = entry.isIntersecting;
          if (state.visible) queue(host);
        }
      }),
    { rootMargin: '120px' },
  );
  const resize = new ResizeObserver((entries) =>
    entries.forEach((entry) => queue(entry.target as HTMLElement)),
  );
  function register(host: HTMLElement) {
    if (host.hasAttribute('data-liquid') || host.matches('.media-viewer')) return;
    // WebKit needs host blur for top-layer surfaces; pseudo-element blur lets prose bleed through.
    const topLayer = host.matches('dialog,[popover]');
    const nested = topLayer || host.hasAttribute('data-liquid-floating') ? null : host.parentElement?.closest('[data-liquid="optic"]');
    const optical = host.matches(optics) && !nested && !(topLayer && !refractive);
    host.dataset.liquid = nested ? 'inset' : optical ? 'optic' : 'surface';
    if (!optical) return;
    tracked.set(host, {
      visible: false,
      key: '',
      filter: null,
      id: `glass-lens-${++sequence}`,
    });
    visibility.observe(host);
    resize.observe(host);
  }
  function scan(scope: Element) {
    if (scope.matches(surfaces)) register(scope as HTMLElement);
    scope.querySelectorAll<HTMLElement>(surfaces).forEach(register);
  }
  scan(document.body);
  const mutations = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) if (node instanceof HTMLElement) scan(node);
    for (const [host, state] of tracked)
      if (!host.isConnected) {
        visibility.unobserve(host);
        resize.unobserve(host);
        state.filter?.remove();
        tracked.delete(host);
        pending.delete(host);
      }
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  const preferences = () => {
    for (const host of tracked.keys()) queue(host);
  };
  const themeObserver = new MutationObserver(preferences);
  themeObserver.observe(root, {
    attributes: true,
    attributeFilter: ['style', 'data-reduce-transparency'],
  });
  reducedTransparency.addEventListener('change', preferences);
  increasedContrast.addEventListener('change', preferences);
  let hovered: HTMLElement | null = null,
    pointerFrame = 0;
  const pointer = (event: PointerEvent) => {
    if (
      reducedMotion.matches ||
      root.dataset.reduceMotion === 'true' ||
      event.pointerType === 'touch'
    )
      return;
    const host = (event.target as Element).closest<HTMLElement>(
      '[data-liquid="optic"], [data-liquid="surface"]',
    );
    if (!host || pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      if (hovered && hovered !== host) hovered.removeAttribute('data-liquid-hover');
      hovered = host;
      const rect = host.getBoundingClientRect();
      host.style.setProperty(
        '--light-x',
        `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(1)}%`,
      );
      host.style.setProperty(
        '--light-y',
        `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(1)}%`,
      );
      host.style.setProperty(
        '--light-angle',
        `${(110 + ((event.clientX - rect.left) / rect.width) * 120).toFixed(0)}deg`,
      );
      host.dataset.liquidHover = 'true';
      pointerFrame = 0;
    });
  };
  document.addEventListener('pointermove', pointer, { passive: true });
  preferences();
  return () => {
    mutations.disconnect();
    themeObserver.disconnect();
    visibility.disconnect();
    resize.disconnect();
    reducedTransparency.removeEventListener('change', preferences);
    increasedContrast.removeEventListener('change', preferences);
    document.removeEventListener('pointermove', pointer);
    if (timer) clearTimeout(timer);
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    for (const host of tracked.keys()) {
      host.removeAttribute('data-liquid');
      host.style.removeProperty('--liquid-refraction');
    }
    svg.remove();
  };
}
