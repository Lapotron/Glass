import { t } from '../shared/i18n.js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../shared/ui.js';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function EditorDivider({
  panes,
  controls,
  value,
  onChange,
  onDragging,
}: {
  panes: RefObject<HTMLDivElement | null>;
  controls: string;
  value: number;
  onChange: (value: number) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const [limits, setLimits] = useState({ min: 0.3, max: 0.7 });
  const latest = useRef(value),
    pointer = useRef<number | null>(null);
  latest.current = value;
  useEffect(() => {
    const parent = panes.current;
    if (!parent) return;
    const resize = () => {
      const width = parent.clientWidth - 10;
      if (width <= 0) return;
      const min = Math.min(0.5, 300 / width),
        max = 1 - min;
      setLimits({ min, max });
      onChange(clamp(latest.current, min, max));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    return () => {
      observer.disconnect();
      onDragging(false);
    };
  }, [panes, onChange, onDragging]);
  const move = (clientX: number) => {
    const rect = panes.current?.getBoundingClientRect();
    if (rect && rect.width > 10)
      onChange(clamp((clientX - rect.left - 5) / (rect.width - 10), limits.min, limits.max));
  };
  const stop = (element: HTMLDivElement) => {
    if (pointer.current !== null && element.hasPointerCapture(pointer.current))
      element.releasePointerCapture(pointer.current);
    pointer.current = null;
    onDragging(false);
  };
  const percent = Math.round(value * 100);
  return (
    <div
      className="editor-split-divider"
      role="separator"
      tabIndex={0}
      aria-label={t("Resize editor and preview")}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={Math.round(limits.min * 100)}
      aria-valuemax={Math.round(limits.max * 100)}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% editor, ${100 - percent}% preview`}
      title={t("Drag to resize · Arrow keys to adjust · Double-click to reset")}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || pointer.current !== null) return;
        event.preventDefault();
        event.currentTarget.focus();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragging(true);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointer.current) move(event.clientX);
      }}
      onPointerUp={(event) => stop(event.currentTarget)}
      onPointerCancel={(event) => stop(event.currentTarget)}
      onLostPointerCapture={() => {
        pointer.current = null;
        onDragging(false);
      }}
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        const next = {
          ArrowLeft: value - step,
          ArrowRight: value + step,
          Home: limits.min,
          End: limits.max,
          Enter: 0.5,
        }[event.key];
        if (next !== undefined) {
          event.preventDefault();
          onChange(clamp(next, limits.min, limits.max));
        } else if (event.key === 'Escape') stop(event.currentTarget);
      }}
     data-ui-attrs={"{\"aria-label\":\"Resize editor and preview\",\"title\":\"Drag to resize · Arrow keys to adjust · Double-click to reset\"}"} >
      <Icon name="GripVertical" size={12} />
    </div>
  );
}
