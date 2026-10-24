import { useEffect, useRef, useMemo, useState, type MutableRefObject } from 'react';
import { EditorView } from '@codemirror/view';
import type { SourceAnalysis } from './source-analysis.js';
import { sourceMatches } from './source-search.js';
const noMarkers: { line: number; end: number; color: string }[] = [];

export function SourceMinimap({
  viewRef,
  source,
  analysis,
  tick,
  controls,
  markers = noMarkers,
  label = 'Document minimap',
}: {
  viewRef: MutableRefObject<EditorView | null>;
  source: string;
  analysis: SourceAnalysis;
  tick: number;
  controls: string;
  markers?: { line: number; end: number; color: string }[];
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    rail = useRef<HTMLDivElement>(null),
    dragOffset = useRef(0);
  const [bounds, setBounds] = useState({ top: 0, height: 1, line: 1, extent: 1, cursor: 0 });
  const lengths = useMemo(() => source.split('\n').map((line) => line.trim().length), [source]);
  const latest = useRef({ lengths, analysis, markers });
  latest.current = { lengths, analysis, markers };
  const paintRequest = useRef<((base?: boolean) => void) | null>(null);
  useEffect(() => {
    const host = rail.current!,
      drawing = canvas.current!;
    let observedView: EditorView | null = null;
    let frame = 0,
      dirty = true;
    let matches: ReturnType<typeof sourceMatches> | undefined;
    const paint = () => {
      frame = 0;
      const view = viewRef.current;
      if (!view || !host.clientHeight) return;
      // The child effect can run before the parent creates CodeMirror. Attach
      // once the view exists, so scrolling inside its buffered viewport repaints too.
      if (observedView !== view) {
        if (observedView) {
          observer.unobserve(observedView.scrollDOM);
          observedView.scrollDOM.removeEventListener('scroll', scroll);
        }
        observedView = view;
        observer.observe(view.scrollDOM);
        view.scrollDOM.addEventListener('scroll', scroll, { passive: true });
      }
      const { lengths, analysis, markers } = latest.current;
      const width = host.clientWidth,
        height = host.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const found = sourceMatches(view);
      if (matches !== found) {
        matches = found;
        dirty = true;
      }
      if (
        drawing.width !== Math.round(width * ratio) ||
        drawing.height !== Math.round(height * ratio)
      )
        dirty = true;
      const unit = Math.min(3, height / lengths.length),
        extent = (unit * lengths.length) / height;
      if (dirty) {
        drawing.width = Math.round(width * ratio);
        drawing.height = Math.round(height * ratio);
        const context = drawing.getContext('2d');
        if (!context) return;
        context.scale(ratio, ratio);
        const style = getComputedStyle(host);
        context.fillStyle = style.getPropertyValue('--faint');
        context.globalAlpha = 0.35;
        lengths.forEach((length, line) => {
          if (length)
            context.fillRect(
              7,
              line * unit,
              Math.min(width - 16, Math.max(2, length * 0.6)),
              Math.max(0.5, Math.min(2, unit - 0.3)),
            );
        });
        context.globalAlpha = 0.85;
        context.fillStyle = style.getPropertyValue('--accent-text');
        analysis.headings.forEach((heading) =>
          context.fillRect(3, (heading.line - 1) * unit, width - 10, 2),
        );
        found.forEach((match) =>
          context.fillRect(width - 7, (view.state.doc.lineAt(match.from).number - 1) * unit, 3, 2),
        );
        context.fillStyle = style.getPropertyValue('--danger');
        analysis.diagnostics.forEach((problem) =>
          context.fillRect(width - 4, (problem.line - 1) * unit, 3, 3),
        );
        markers.forEach((marker) => {
          context.fillStyle = style.getPropertyValue(marker.color);
          context.fillRect(
            0,
            (marker.line - 1) * unit,
            4,
            Math.max(3, (Math.max(marker.line, marker.end) - marker.line + 1) * unit),
          );
        });
        dirty = false;
        drawing.dataset.paints = String(Number(drawing.dataset.paints || 0) + 1);
      }
      const viewport = view.scrollDOM.getBoundingClientRect();
      const projectedLine = (height: number) => {
        const block = view.lineBlockAtHeight(Math.max(0, height));
        const first = view.state.doc.lineAt(block.from).number - 1;
        const span = view.state.doc.lineAt(block.to).number - first;
        return Math.min(
          lengths.length,
          first + Math.max(0, Math.min(1, (height - block.top) / Math.max(1, block.height))) * span,
        );
      };
      const first = projectedLine(viewport.top - view.documentTop),
        last = projectedLine(viewport.bottom - view.documentTop);
      const windowHeight = Math.min(
        1,
        Math.max(8 / height, ((last - first) / lengths.length) * extent),
      );
      const next = {
        top: Math.max(0, Math.min(extent - windowHeight, (first / lengths.length) * extent)),
        height: windowHeight,
        line: Math.min(lengths.length, Math.floor(first) + 1),
        extent,
        cursor:
          ((view.state.doc.lineAt(view.state.selection.main.head).number - 1) * unit) / height,
      };
      setBounds((previous) =>
        Object.keys(next).every(
          (key) => next[key as keyof typeof next] === previous[key as keyof typeof next],
        )
          ? previous
          : next,
      );
    };
    const schedule = (base = false) => {
      dirty ||= base;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paintRequest.current = schedule;
    const redraw = () => schedule(true),
      scroll = () => schedule();
    const observer = new ResizeObserver(redraw),
      theme = new MutationObserver(redraw);
    observer.observe(host);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'data-background'],
    });
    schedule(true);
    return () => {
      paintRequest.current = null;
      observer.disconnect();
      theme.disconnect();
      cancelAnimationFrame(frame);
      observedView?.scrollDOM.removeEventListener('scroll', scroll);
    };
  }, [viewRef]);
  useEffect(() => {
    paintRequest.current?.(true);
  }, [lengths, analysis, markers]);
  useEffect(() => {
    paintRequest.current?.();
  }, [tick]);
  const go = (line: number) => {
    const view = viewRef.current;
    if (!view) return;
    const target = Math.max(1, Math.min(view.state.doc.lines, line));
    const sourceLine = view.state.doc.line(Math.floor(target));
    const position = sourceLine.from + Math.floor((target % 1) * sourceLine.length);
    // Let CodeMirror own the scroll request so a pending caret scroll from an edit
    // cannot override minimap navigation in its next measurement pass.
    view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 0 }) });
  };
  const atPointer = (y: number) => {
    const rect = rail.current!.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(
        1 - bounds.height / bounds.extent,
        (y - rect.top - dragOffset.current) / (rect.height * bounds.extent),
      ),
    );
    go(1 + fraction * lengths.length);
  };
  return (
    <div
      ref={rail}
      className="source-minimap"
      role="slider"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={lengths.length}
      aria-valuenow={bounds.line}
      aria-valuetext={`Line ${bounds.line} of ${lengths.length}`}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect(),
          relative = event.clientY - rect.top;
        const top = bounds.top * rect.height,
          height = bounds.height * rect.height;
        dragOffset.current =
          relative >= top && relative <= top + height ? relative - top : height / 2;
        atPointer(event.clientY);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) atPointer(event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        const step = ['PageUp', 'PageDown'].includes(event.key)
          ? Math.max(1, Math.round((lengths.length * bounds.height) / bounds.extent))
          : 1;
        if (['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault();
          go(
            event.key === 'Home'
              ? 1
              : event.key === 'End'
                ? lengths.length
                : bounds.line + (['ArrowUp', 'PageUp'].includes(event.key) ? -step : step),
          );
        }
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <span
        className="source-minimap-cursor"
        aria-hidden="true"
        style={{ top: `${bounds.cursor * 100}%` }}
      />
      <span
        className="source-minimap-window"
        style={{
          top: `${Math.min(bounds.top, 1 - bounds.height) * 100}%`,
          height: `${bounds.height * 100}%`,
        }}
      />
    </div>
  );
}
