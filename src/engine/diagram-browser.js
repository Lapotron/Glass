// Runs only in the isolated build renderer, never in the public asset graph.
globalThis.renderBlogDiagram = async ({ source, prefix, presentation }) => {
  const externalStyle = (value) =>
    [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].some(
      (match) => !match[2].trim().startsWith('#'),
    );
  const mermaid = globalThis.mermaid;
  const variants = {};
  for (const name of ['light', 'dark']) {
    const palette = presentation[name];
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      look: 'classic',
      fontFamily: presentation.fontFamily,
      themeVariables: {
        darkMode: name === 'dark',
        background: palette.surface,
        fontFamily: presentation.fontFamily,
        fontSize: presentation.fontSize + 'px',
        primaryColor: palette.surface,
        secondaryColor: name === 'dark' ? '#2d4945' : '#d7e8e2',
        tertiaryColor: name === 'dark' ? '#4a3f52' : '#e7dfee',
        primaryTextColor: palette.text,
        secondaryTextColor: palette.text,
        tertiaryTextColor: palette.text,
        textColor: palette.text,
        nodeTextColor: palette.text,
        primaryBorderColor: palette.secondary,
        secondaryBorderColor: palette.secondary,
        tertiaryBorderColor: palette.secondary,
        lineColor: palette.secondary,
        edgeLabelBackground: palette.surface,
        actorBkg: palette.surface,
        actorBorder: palette.secondary,
        actorTextColor: palette.text,
        actorLineColor: palette.secondary,
        signalColor: palette.secondary,
        signalTextColor: palette.text,
        labelBoxBkgColor: palette.surface,
        labelBoxBorderColor: palette.secondary,
        labelTextColor: palette.text,
        noteBkgColor: palette.surface,
        noteTextColor: palette.text,
        noteBorderColor: palette.secondary,
        activationBkgColor: palette.surface,
        activationBorderColor: palette.secondary,
        pieSectionTextColor: palette.text,
        pieTitleTextColor: palette.text,
        pieLegendTextColor: palette.text,
        radarCurveColors:
          name === 'dark' ? ['#92afd3', '#86b9aa', '#c09ab8'] : ['#5878a5', '#548479', '#9a7092'],
      },
      deterministicIds: true,
      deterministicIDSeed: prefix,
      maxTextSize: 50000,
      maxEdges: 500,
      legacyMathML: false,
      forceLegacyMathML: false,
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'suppressErrorRendering',
        'theme',
        'themeCSS',
        'themeVariables',
        'fontFamily',
        'look',
        'deterministicIds',
        'deterministicIDSeed',
        'maxTextSize',
        'maxEdges',
        'legacyMathML',
        'forceLegacyMathML',
      ],
    });
    const result = await mermaid.render(`${prefix}${name}`, source);
    const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    if (document.querySelector('parsererror')) throw new Error('Mermaid returned invalid SVG.');
    const svg = document.documentElement;
    if (name === 'light')
      variants.title = svg.querySelector(':scope > title')?.textContent?.trim() || '';
    svg.style.background = 'transparent';
    // XY charts paint a canvas rectangle in addition to the SVG background.
    // Clear only that semantic canvas, retaining bars, legends and other data marks.
    if (result.diagramType === 'xychart')
      svg
        .querySelectorAll(':scope > g.main > rect.background')
        .forEach((canvas) => canvas.setAttribute('fill', 'none'));
    svg.setAttribute('data-diagram-rendered', 'glass-2');
    svg.setAttribute('data-diagram-family', result.diagramType);
    // Annotate default structural boxes only. Custom classDef/default and inline paint remain authored.
    const customClasses = [
      ...source.matchAll(/^\s*classDef\s+([\w, -]+?)\s+(?=[\w-]+\s*:)/gm),
    ].flatMap((match) => match[1].split(/\s*,\s*/));
    const protectedShape = (element) => {
      if (element.style.fill || element.style.stroke || element.style.background) return true;
      for (let parent = element; parent && parent !== svg; parent = parent.parentElement)
        if (customClasses.some((className) => parent.classList.contains(className))) return true;
      return false;
    };
    const structural = new Set([
      'flowchart',
      'flowchart-v2',
      'flowchart-elk',
      'sequence',
      'class',
      'classDiagram',
      'classDiagram-v2',
      'er',
      'state',
      'stateDiagram',
      'stateDiagram-v2',
      'requirement',
      'block',
      'architecture',
      'kanban',
      'swimlane',
      'usecase',
    ]);
    for (const shape of structural.has(result.diagramType)
      ? svg.querySelectorAll(
          '.node > rect, .node > circle, .node > ellipse, .node > polygon, .node > path, ' +
            '.cluster > rect, rect.actor, rect.actor-top, rect.actor-bottom, rect.note, ' +
            'rect.activation0, rect.activation1, rect.activation2, .classGroup > rect, ' +
            '.class-group > rect, .statediagram-state > rect, .stateGroup > rect, .er.entityBox, .er.entityLabel',
        )
      : []) {
      if (!protectedShape(shape)) shape.setAttribute('data-diagram-surface', '');
    }
    const rgba = (hex, alpha) => {
      const parts = hex
        .replace('#', '')
        .match(/.{2}/g)
        .slice(0, 3)
        .map((part) => parseInt(part, 16));
      return `rgba(${parts.join(',')},${alpha})`;
    };
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      #${svg.id} { background:transparent!important; font-weight:400; }
      #${svg.id}[data-diagram-rendered] [data-diagram-surface] { fill:${rgba(palette.text, 0.045)}; stroke:${rgba(palette.secondary, 0.38)}; stroke-width:1px; }
      #${svg.id} .label, #${svg.id} .nodeLabel, #${svg.id} .edgeLabel, #${svg.id} .messageText, #${svg.id} .actor { font-weight:400; }
      #${svg.id} .cluster-label { font-weight:500; }
      #${svg.id} .edgeLabel rect, #${svg.id} .labelBkg { fill:${rgba(palette.surface, 0.12)}; }
      #${svg.id} .edgeLabel p { background-color:transparent; }
    `;
    svg.append(style);
    const allowed = new Set(
      'svg symbol g defs style path rect circle ellipse line polyline polygon text tspan textPath marker linearGradient radialGradient stop pattern clipPath mask title desc foreignObject a use image switch filter feBlend feColorMatrix feComposite feDropShadow feFlood feGaussianBlur feMerge feMergeNode feOffset div span p br b strong i em sub sup ul ol li table thead tbody tr td th math mrow mi mo mn ms mtext mspace mstyle msqrt mroot mfrac msub msup msubsup mover munder munderover mmultiscripts mprescripts none mtable mtr mlabeledtr mtd menclose mpadded mphantom semantics annotation annotation-xml'
        .split(' ')
        .map((tag) => tag.toLowerCase()),
    );
    const ids = new Map();
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (!allowed.has(element.localName.toLowerCase())) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        if (attribute.localName === 'href' && !attribute.value.startsWith('#'))
          throw new Error(
            'Diagrams must be self-contained; place external images in Markdown instead.',
          );
        if (externalStyle(attribute.value) || /(?:javascript:|@import)/i.test(attribute.value))
          throw new Error('External resources are not allowed in diagram styles.');
      }
      if (
        element.localName === 'style' &&
        (/@import|@font-face/i.test(element.textContent || '') ||
          externalStyle(element.textContent || ''))
      )
        throw new Error('External resources are not allowed in diagram styles.');
      if (element.id) ids.set(element.id, `${prefix}${name}-${ids.size}`);
    }
    const replaceReferences = (value) => {
      let text = value;
      for (const [old, next] of ids) {
        const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`#${escaped}(?=[\\s)"'.,:>+~{\\[]|$)`, 'g'), `#${next}`);
      }
      return text;
    };
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name === 'id') element.id = ids.get(attribute.value);
        else if (/^aria-(?:labelledby|describedby)$/.test(attribute.name))
          element.setAttribute(
            attribute.name,
            attribute.value
              .split(/\s+/)
              .map((id) => ids.get(id) || id)
              .join(' '),
          );
        else element.setAttribute(attribute.name, replaceReferences(attribute.value));
      }
      if (element.localName === 'style')
        element.textContent = replaceReferences(element.textContent || '');
    }
    svg.setAttribute('role', 'img');
    svg.setAttribute('focusable', 'false');
    if (!svg.hasAttribute('aria-label') && !svg.hasAttribute('aria-labelledby'))
      svg.setAttribute('aria-label', 'Diagram');
    variants[name] = svg.outerHTML;
  }
  return variants;
};
