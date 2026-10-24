import { t } from '../shared/i18n.js';
import {
  layoutMindmap,
  mapNodes,
  mindmapOutline,
  renderMindmapSvg,
  validateMindmap,
  type MindmapDocument,
} from '../shared/mindmap.js';

export function enhanceMindmap(node: HTMLElement) {
  const stage = node.querySelector<HTMLElement>('.mindmap-stage[data-map-document]');
  if (!stage || stage.dataset.mapReady) return;
  const document: MindmapDocument = JSON.parse(stage.dataset.mapDocument!);
  validateMindmap(document);
  const canvas = stage.querySelector<HTMLElement>('.mindmap-canvas')!,
    transform = stage.querySelector<HTMLElement>('.mindmap-transform')!;
  const status = stage.querySelector<HTMLElement>('[data-map-status]')!,
    zoom = stage.querySelector<HTMLElement>('[data-map-zoom]')!,
    search = stage.querySelector<HTMLInputElement>('.mindmap-search input')!,
    matchStatus = stage.querySelector<HTMLElement>('[data-map-matches]')!;
  const namespace = stage.dataset.mapNamespace!,
    all = mapNodes(document.root),
    byId = new Map(all.map((n) => [n.id, n])),
    parents = new Map<string, string>();
  all.forEach((n) => n.children.forEach((child) => parents.set(child.id, n.id)));
  // Retain the complete authored drawing even after branches are collapsed on screen.
  const printMap = window.document.createElement('div');
  printMap.className = 'mindmap-print-map';
  printMap.innerHTML = transform.innerHTML.replaceAll(namespace, `${namespace}-print`);
  printMap.querySelectorAll('[data-map-node]').forEach((item) => {
    for (const attribute of [
      'data-map-node',
      'role',
      'aria-level',
      'aria-expanded',
      'aria-label',
      'tabindex',
    ])
      item.removeAttribute(attribute);
  });
  printMap.querySelectorAll('[data-map-toggle]').forEach((item) => item.remove());
  printMap.querySelectorAll('svg').forEach((drawing) => drawing.setAttribute('role', 'img'));
  stage.append(printMap);

  let collapsed = new Set<string>(),
    selected = document.root.id,
    matches: string[] = [],
    matchIndex = -1;
  let geometry = layoutMindmap(document),
    scale = 1,
    x = 0,
    y = 0,
    autoFit = true,
    exploring = false,
    moved = false;
  let expanded: HTMLDialogElement | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    x: number;
    y: number;
    distance: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  } | null = null;
  const button = (action: string) =>
    stage.querySelector<HTMLButtonElement>(`[data-map-action="${action}"]`)!;
  const theme = () => (window.document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const paint = () => {
    const margin = 64,
      width = geometry.width * scale,
      height = geometry.height * scale;
    x =
      width < canvas.clientWidth
        ? (canvas.clientWidth - width) / 2
        : Math.max(canvas.clientWidth - width - margin, Math.min(margin, x));
    y =
      height < canvas.clientHeight
        ? (canvas.clientHeight - height) / 2
        : Math.max(canvas.clientHeight - height - margin, Math.min(margin, y));
    transform.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    zoom.textContent = t("{value0}%", {value0: Math.round(scale * 100)});
    canvas.setAttribute('aria-activedescendant', `${namespace}-${theme()}-${selected}`);
  };
  const fit = () => {
    autoFit = true;
    scale = Math.min(
      1,
      (canvas.clientWidth / geometry.width) * 0.92,
      (canvas.clientHeight / geometry.height) * 0.92,
    );
    x = (canvas.clientWidth - geometry.width * scale) / 2;
    y = (canvas.clientHeight - geometry.height * scale) / 2;
    paint();
  };
  const center = () => {
    const position = geometry.positions.find((p) => p.node.id === selected);
    if (position) {
      x = canvas.clientWidth / 2 - (position.x - geometry.x) * scale;
      y = canvas.clientHeight / 2 - (position.y - geometry.y) * scale;
    }
    paint();
  };
  const draw = (refit = false) => {
    geometry = layoutMindmap(document, collapsed);
    for (const variant of ['light', 'dark'] as const)
      transform.querySelector<HTMLElement>(`[data-diagram-variant="${variant}"]`)!.innerHTML =
        renderMindmapSvg(document, variant, namespace, collapsed, selected, new Set(matches));
    stage
      .querySelectorAll<HTMLButtonElement>('[data-map-layout]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.mapLayout === document.layout)),
      );
    status.textContent = t("{value0} of {value1} nodes · {value2}", {value0: geometry.positions.length, value1: all.length, value2: byId.get(selected)?.label || document.title});
    matchStatus.textContent = search.value
      ? matches.length
        ? t("{value0} / {value1}", {value0: matchIndex + 1, value1: matches.length})
        : t("No matches")
      : '';
    button('previous-match').disabled = button('next-match').disabled = !matches.length;
    if (refit || autoFit) fit();
    else center();
  };
  const reveal = (id: string) => {
    let parent = parents.get(id);
    while (parent) {
      collapsed.delete(parent);
      parent = parents.get(parent);
    }
    selected = id;
    autoFit = false;
    draw();
  };
  const toggle = (id: string) => {
    if (!byId.get(id)?.children.length) return;
    selected = id;
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    draw();
  };
  const setExplore = (value: boolean) => {
    exploring = value;
    stage.dataset.mapExploring = String(value);
    button('explore').setAttribute('aria-pressed', String(value));
    status.textContent = value
      ? t("Explore enabled. Drag or pinch to navigate; Escape exits Explore.")
      : t("Page scrolling enabled. Select Explore to use touch gestures.");
  };
  const zoomAt = (next: number, px = canvas.clientWidth / 2, py = canvas.clientHeight / 2) => {
    next = Math.max(0.025, Math.min(4, next));
    autoFit = false;
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
    paint();
  };
  const selectMatch = (direction: number) => {
    if (!matches.length) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    reveal(matches[matchIndex]);
  };
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob),
      anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportImage = async (format: 'svg' | 'png') => {
    const serialized = renderMindmapSvg(document, theme(), 'export', collapsed);
    const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml'),
      svg = parsed.documentElement;
    const background = window.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(geometry.x));
    background.setAttribute('y', String(geometry.y));
    background.setAttribute('width', String(geometry.width));
    background.setAttribute('height', String(geometry.height));
    background.setAttribute(
      'fill',
      getComputedStyle(window.document.documentElement).backgroundColor,
    );
    svg.prepend(background);
    svg
      .querySelectorAll('text')
      .forEach((text) => text.setAttribute('fill', getComputedStyle(stage).color));
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    if (format === 'svg') {
      download(blob, 'mindmap.svg');
      return;
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const output = window.document.createElement('canvas'),
        ratio = Math.min(2, 4096 / Math.max(geometry.width, geometry.height));
      output.width = Math.max(1, Math.round(geometry.width * ratio));
      output.height = Math.max(1, Math.round(geometry.height * ratio));
      const context = output.getContext('2d');
      if (!context) throw new Error(t("Image export is unavailable."));
      context.drawImage(image, 0, 0, output.width, output.height);
      const png = await new Promise<Blob>((resolve, reject) =>
        output.toBlob(
          (value) => (value ? resolve(value) : reject(new Error(t("Could not create the PNG.")))),
          'image/png',
        ),
      );
      download(png, 'mindmap.png');
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const expand = () => {
    if (expanded) {
      expanded.close();
      return;
    }
    // Safari does not focus buttons on a pointer click, so capture the actual
    // expansion trigger rather than whichever element was focused before it.
    const opener = button('expand'),
      placeholder = window.document.createElement('div');
    placeholder.style.height = `${stage.getBoundingClientRect().height}px`;
    placeholder.className = 'mindmap-print-placeholder';
    const paper = printMap.cloneNode(true) as HTMLElement;
    paper.innerHTML = paper.innerHTML.replaceAll(
      `${namespace}-print`,
      `${namespace}-expanded-print`,
    );
    placeholder.append(paper);

    stage.replaceWith(placeholder);
    const dialog = window.document.createElement('dialog'),
      header = window.document.createElement('header'),
      title = window.document.createElement('h2'),
      close = window.document.createElement('button');
    dialog.className = 'mindmap-dialog glass-panel';
    dialog.setAttribute('aria-label', document.title);
    title.textContent = document.title;
    close.type = 'button';
    close.className = 'button secondary small';
    close.textContent = t("Close");
    close.setAttribute('aria-label', t("Close expanded mindmap"));
    header.append(title, close);
    dialog.append(header, stage);
    window.document.body.append(dialog);
    expanded = dialog;
    const wasExploring = exploring;
    setExplore(true);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => event.stopPropagation());
    dialog.addEventListener(
      'close',
      () => {
        placeholder.replaceWith(stage);
        expanded = null;
        dialog.remove();
        setExplore(wasExploring);
        fit();
        opener?.focus({ preventScroll: true });
      },
      { once: true },
    );
    dialog.showModal();
    fit();
  };
  const action = async (name: string) => {
    if (name === 'in') zoomAt(scale * 1.25);
    else if (name === 'out') zoomAt(scale / 1.25);
    else if (name === 'reset') fit();
    else if (name === 'actual') zoomAt(1);
    else if (name === 'explore') setExplore(!exploring);
    else if (name === 'expand') expand();
    else if (name === 'collapse-all') {
      collapsed = new Set(
        all.filter((n) => n !== document.root && n.children.length).map((n) => n.id),
      );
      selected = document.root.id;
      draw(true);
    } else if (name === 'expand-all') {
      collapsed.clear();
      draw(true);
    } else if (name === 'previous-match') selectMatch(-1);
    else if (name === 'next-match') selectMatch(1);
    else if (name === 'copy') {
      await navigator.clipboard.writeText(mindmapOutline(document.root));
      status.textContent = t("Markdown outline copied.");
    } else if (name === 'export-svg' || name === 'export-png') {
      await exportImage(name === 'export-svg' ? 'svg' : 'png');
      status.textContent = t("Mindmap downloaded.");
    }
  };
  stage.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.disabled = false;
    b.addEventListener('click', () => {
      if (b.dataset.mapLayout) {
        document.layout = b.dataset.mapLayout as 'map' | 'tree';
        draw();
      } else
        void action(b.dataset.mapAction!).catch((error) => {
          status.textContent = t("{value0} The map and text outline are still available.", {value0: (error as Error).message});
        });
    });
  });
  search.disabled = false;
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase();
    matches = query
      ? all.filter((n) => n.label.toLocaleLowerCase().includes(query)).map((n) => n.id)
      : [];
    matchIndex = matches.length ? 0 : -1;
    if (matches.length) reveal(matches[0]);
    else draw();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectMatch(event.shiftKey ? -1 : 1);
    }
  });
  const depth = stage.querySelector<HTMLSelectElement>('[data-map-depth]')!;
  depth.disabled = false;
  depth.addEventListener('change', () => {
    collapsed.clear();
    if (depth.value !== 'all') {
      const walk = (n: typeof document.root, level: number) => {
        if (level >= Number(depth.value) && n.children.length) collapsed.add(n.id);
        n.children.forEach((child) => walk(child, level + 1));
      };
      walk(document.root, 0);
    }
    selected = document.root.id;
    draw(true);
  });
  canvas.addEventListener('click', (event) => {
    if (moved) return;
    const target = (event.target as Element).closest<SVGElement>(
      '[data-map-toggle], [data-map-node]',
    );
    if (!target) return;
    const id = target.dataset.mapToggle || target.dataset.mapNode!;
    if (target.dataset.mapToggle) toggle(id);
    else {
      selected = id;
      draw();
    }
    canvas.focus();
  });
  canvas.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      search.focus();
      return;
    }
    const visible = all.filter((n) => geometry.positions.some((p) => p.node.id === n.id)),
      index = visible.findIndex((n) => n.id === selected),
      current = byId.get(selected)!;
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        ' ',
        'Enter',
        '+',
        '=',
        '-',
        '0',
        '1',
        'Escape',
      ].includes(event.key)
    ) {
      if (event.key === 'Escape') {
        if (exploring && !expanded) {
          event.preventDefault();
          setExplore(false);
        }
        return;
      }
      event.preventDefault();
      if (event.key === '+' || event.key === '=') zoomAt(scale * 1.25);
      else if (event.key === '-') zoomAt(scale / 1.25);
      else if (event.key === '0') fit();
      else if (event.key === '1') zoomAt(1);
      else if (event.key === ' ' || event.key === 'Enter') toggle(selected);
      else if (event.key === 'ArrowRight') {
        if (collapsed.has(selected)) toggle(selected);
        else if (current.children.length) reveal(current.children[0].id);
      } else if (event.key === 'ArrowLeft') {
        if (current.children.length && !collapsed.has(selected)) toggle(selected);
        else if (parents.has(selected)) reveal(parents.get(selected)!);
      } else
        reveal(
          visible[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? visible.length - 1
                : Math.max(
                    0,
                    Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  )
          ].id,
        );
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(
        scale * Math.exp(-event.deltaY * 0.006),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    { passive: false },
  );
  const startGesture = () => {
    const values = [...pointers.values()],
      first = values[0];
    gesture = first
      ? {
          x: values.length > 1 ? (first.x + values[1].x) / 2 : first.x,
          y: values.length > 1 ? (first.y + values[1].y) / 2 : first.y,
          distance:
            values.length > 1 ? Math.hypot(first.x - values[1].x, first.y - values[1].y) : 0,
          scale,
          offsetX: x,
          offsetY: y,
        }
      : null;
  };
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.pointerType === 'touch' && !exploring) || event.button > 0) return;
    moved = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...pointers.values()],
      px = values.length > 1 ? (values[0].x + values[1].x) / 2 : values[0].x,
      py = values.length > 1 ? (values[0].y + values[1].y) / 2 : values[0].y;
    if (Math.hypot(px - gesture.x, py - gesture.y) > 3 || values.length > 1) moved = true;
    if (!moved) return;
    if (!canvas.hasPointerCapture(event.pointerId)) canvas.setPointerCapture(event.pointerId);
    autoFit = false;
    const next =
      values.length > 1 && gesture.distance
        ? Math.max(
            0.025,
            Math.min(
              4,
              (gesture.scale * Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)) /
                gesture.distance,
            ),
          )
        : gesture.scale;
    const rect = canvas.getBoundingClientRect(),
      ratio = next / gesture.scale;
    x = px - rect.left - (gesture.x - rect.left - gesture.offsetX) * ratio;
    y = py - rect.top - (gesture.y - rect.top - gesture.offsetY) * ratio;
    scale = next;
    paint();
  });
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    startGesture();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', (event) => {
    // Touch can transfer implicit capture from an SVG node to the canvas.
    // Ignore that child's bubbling event while the canvas owns the gesture.
    if (event.target !== canvas) return;
    pointers.delete(event.pointerId);
    startGesture();
  });
  const resize = new ResizeObserver(() => {
    if (!stage.isConnected) {
      resize.disconnect();
      appearance.disconnect();
      return;
    }
    if (autoFit) fit();
    else center();
  });
  resize.observe(canvas);
  const appearance = new MutationObserver(() => {
    if (!stage.isConnected) {
      appearance.disconnect();
      resize.disconnect();
      return;
    }
    paint();
  });
  appearance.observe(window.document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  stage.dataset.mapReady = 'true';
  draw(true);
}
