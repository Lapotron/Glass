import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type { AudiencePoint } from './AudienceGlobe.js';
import { t, uiNumber } from '../shared/i18n.js';
import 'leaflet/dist/leaflet.css';
import './audience-map.css';

// One provider boundary; no prefetch, proxy, API key or offline tile downloads.
export const audienceTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export function AudienceMap({
  points,
  metric,
  onSelect,
  reset,
  focus,
}: {
  points: AudiencePoint[];
  metric: 'views' | 'qualified' | 'active';
  onSelect: (point: AudiencePoint) => void;
  reset: number;
  focus: AudiencePoint | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null);
  const current = useRef({ points, metric, onSelect });
  current.current = { points, metric, onSelect };
  const redraw = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false,
      resize: ResizeObserver | undefined;
    void import('leaflet')
      .then((L) => {
        if (cancelled || !host.current) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const view = L.map(host.current, {
          center: [22, 0],
          zoom: 2,
          minZoom: 1,
          maxZoom: 8,
          maxBounds: [
            [-85, -180],
            [85, 180],
          ],
          maxBoundsViscosity: 1,
          scrollWheelZoom: false,
          zoomAnimation: !reduced,
          fadeAnimation: !reduced,
          markerZoomAnimation: !reduced,
          inertia: !reduced,
        });
        map.current = view;
        const tiles = L.tileLayer(audienceTileUrl, {
          maxZoom: 8,
          noWrap: true,
          keepBuffer: 0,
          updateWhenIdle: true,
          updateWhenZooming: false,
          referrerPolicy: 'strict-origin-when-cross-origin',
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        }).addTo(view);
        tiles.on('tileerror', () =>
          setError(t('Map tiles could not load. Markers and the offline map remain available.')),
        );
        tiles.on('load', () => {
          if (host.current?.querySelector('.leaflet-tile-loaded')) setError('');
        });
        const markers = L.layerGroup().addTo(view);
        redraw.current = () => {
          markers.clearLayers();
          const { points: data, metric: key, onSelect: select } = current.current;
          // Fixed screen cells keep dense observations useful without thousands of DOM markers.
          const cells = new Map<string, AudiencePoint[]>();
          for (const point of data) {
            const pixel = view.project([point.latitude, point.longitude]);
            const cell = `${Math.floor(pixel.x / 44)},${Math.floor(pixel.y / 44)}`;
            const group = cells.get(cell) || [];
            group.push(point);
            cells.set(cell, group);
          }
          const maximum = Math.max(1, ...data.map((p) => p[key]));
          for (const group of cells.values()) {
            const point =
              group.length === 1
                ? group[0]
                : {
                    ...group[0],
                    latitude: group.reduce((n, p) => n + p.latitude, 0) / group.length,
                    longitude: group.reduce((n, p) => n + p.longitude, 0) / group.length,
                    views: group.reduce((n, p) => n + p.views, 0),
                    qualified: group.reduce((n, p) => n + p.qualified, 0),
                    active: group.reduce((n, p) => n + p.active, 0),
                    visits: group.reduce((n, p) => n + p.visits, 0),
                  };
            const name =
              group.length === 1
                ? [point.city, point.region, point.country].filter(Boolean).join(', ')
                : t('{count} approximate locations', { count: group.length });
            const value =
              key === 'active'
                ? uiNumber(point.active / 60000, { maximumFractionDigits: 1 }) + ' ' + t('min')
                : uiNumber(point[key]);
            const node = document.createElement('span');
            node.className = 'aca-map-marker-value';
            node.textContent = value;
            const size = Math.min(56, 28 + Math.sqrt(point[key] / maximum) * 18);
            const marker = L.marker([point.latitude, point.longitude], {
              icon: L.divIcon({
                html: node,
                className: 'aca-map-marker' + (group.length > 1 ? ' is-cluster' : ''),
                iconSize: [size, size],
              }),
              title: name + ' · ' + value,
              keyboard: true,
            }).addTo(markers);
            const element = marker.getElement();
            element?.setAttribute('aria-label', name + ' · ' + value);
            const tooltip = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = name;
            const detail = document.createElement('span');
            detail.textContent =
              uiNumber(point.views) +
              ' ' +
              t('Page views') +
              ' · ' +
              uiNumber(point.qualified) +
              ' ' +
              t('Qualified reads');
            tooltip.append(strong, detail);
            marker.bindTooltip(tooltip, { className: 'aca-map-tooltip', direction: 'top' });
            marker.on('click', () => {
              if (group.length > 1 && view.getZoom() < 8)
                view.fitBounds(L.latLngBounds(group.map((p) => [p.latitude, p.longitude])), {
                  maxZoom: Math.min(8, view.getZoom() + 2),
                  padding: [40, 40],
                  animate: !reduced,
                });
              else select(group[0]);
            });
          }
        };
        view.on('zoomend', () => redraw.current());
        redraw.current();
        resize = new ResizeObserver(() => view.invalidateSize({ pan: false }));
        resize.observe(host.current);
        const plus = host.current.querySelector('.leaflet-control-zoom-in');
        const minus = host.current.querySelector('.leaflet-control-zoom-out');
        plus?.setAttribute('aria-label', t('Zoom in'));
        minus?.setAttribute('aria-label', t('Zoom out'));
      })
      .catch(() =>
        setError(t('Map tiles could not load. Markers and the offline map remain available.')),
      );
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      redraw.current = () => {};
    };
  }, []);
  useEffect(() => redraw.current(), [points, metric]);
  useEffect(() => {
    map.current?.setView([22, 0], 2, { animate: false });
  }, [reset]);
  useEffect(() => {
    if (focus)
      map.current?.setView([focus.latitude, focus.longitude], 6, {
        animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
  }, [focus]);
  return (
    <div className="aca-osm">
      <div
        ref={host}
        className="aca-osm-stage"
        role="group"
        aria-label={t('Audience map. Drag to pan; use arrow keys and plus or minus to zoom.')}
      />
      {error && (
        <p className="help" role="status">
          {error}
        </p>
      )}
      <p className="aca-map-note">
        {t(
          'OpenStreetMap tiles load only in this private map view. Zoom is limited because audience locations are approximate.',
        )}{' '}
        <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">
          {t('Report a map issue')}
        </a>
      </p>
    </div>
  );
}
