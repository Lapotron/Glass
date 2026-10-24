import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import { Button, Icon } from '../shared/ui.js';
import { t, uiNumber } from '../shared/i18n.js';
import earthDay from './assets/earth-day.webp';
import earthNight from './assets/earth-night.webp';
import earthRelief from './assets/earth-relief.webp';
import './audience-globe.css';
import outline from './assets/earth-outline.json';
const AudienceMap = lazy(() =>
  import('./AudienceMap.js').then((m) => ({ default: m.AudienceMap })),
);
export type AudiencePoint = {
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  city: string;
  views: number;
  qualified: number;
  active: number;
  visits: number;
};
type Point = AudiencePoint;
export function AudienceGlobe({
  rows,
  visits = false,
  countryFilter,
  onCountry,
}: {
  rows: Record<string, string | number | null>[];
  visits?: boolean;
  countryFilter?: string[];
  onCountry?: (country: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    instance = useRef<GlobeInstance | null>(null);
  const [mode, setMode] = useState<'osm' | 'earth' | 'map'>('osm'),
    [failure, setFailure] = useState(''),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState<Point | null>(null),
    [rotate, setRotate] = useState(false);
  const [mapReset, setMapReset] = useState(0),
    [mapFocus, setMapFocus] = useState<Point | null>(null);
  const [country, setCountry] = useState(''),
    [metric, setMetric] = useState('views');
  useEffect(() => {
    if (countryFilter) setCountry(countryFilter.length === 1 ? countryFilter[0] : '');
  }, [JSON.stringify(countryFilter)]);
  const points = useMemo(() => {
    const result = new Map<string, Point>();
    for (const row of rows) {
      if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') continue;
      const key = JSON.stringify([row.latitude, row.longitude, row.country, row.region, row.city]);
      const p = result.get(key) || {
        latitude: row.latitude,
        longitude: row.longitude,
        country: String(row.country || 'Unknown'),
        region: String(row.region || ''),
        city: String(row.city || ''),
        views: 0,
        qualified: 0,
        active: 0,
        visits: 0,
      };
      p.views += visits ? 1 : Number(row.views || 0);
      p.qualified += visits ? Number(Number(row.activeSeconds) >= 10) : Number(row.qualified || 0);
      p.active += visits ? Number(row.activeSeconds || 0) * 1000 : Number(row.activeMs || 0);
      p.visits++;
      result.set(key, p);
    }
    return [...result.values()];
  }, [rows, visits]);
  const filtered = useMemo(
    () => points.filter((p) => !country || p.country === country),
    [points, country],
  );
  const focused = useRef(false);
  const maximum = Math.max(
    1,
    ...filtered.map((p) => p[metric as 'views' | 'qualified' | 'active']),
  );
  const label = (point: Point) =>
    [point.city, point.region, point.country].filter(Boolean).join(', ');
  useEffect(() => {
    if (mode !== 'earth' || !container.current) return;
    let cancelled = false,
      observer: ResizeObserver | undefined,
      visibility: IntersectionObserver | undefined,
      themes: MutationObserver | undefined;
    const host = container.current;
    const ownedTextures: { dispose: () => void }[] = [];
    let onScreen = true;
    const active = () => {
      const globe = instance.current;
      if (!globe) return;
      if (document.hidden || !onScreen) globe.pauseAnimation();
      else globe.resumeAnimation();
    };
    setReady(false);
    setFailure('');
    void import('globe.gl')
      .then(async ({ default: Globe }) => {
        const { TextureLoader, MeshPhongMaterial, SRGBColorSpace } = await import('three');
        const loader = new TextureLoader();
        const textures = await Promise.all(
          [
            loader.loadAsync(earthDay),
            loader.loadAsync(earthNight),
            loader.loadAsync(earthRelief),
          ].map((promise) =>
            promise.then((texture) => {
              ownedTextures.push(texture);
              if (cancelled) texture.dispose();
              return texture;
            }),
          ),
        );
        if (cancelled) {
          textures.forEach((texture) => texture.dispose());
          return;
        }
        const [day, night, relief] = textures;
        day.colorSpace = night.colorSpace = SRGBColorSpace;
        const material = new MeshPhongMaterial({
          map: day,
          bumpMap: relief,
          bumpScale: 0.3,
          shininess: 8,
          specular: 0x244354,
          emissive: 0xffffff,
          emissiveIntensity: 0,
        });
        if (cancelled) return;
        const globe = new Globe(host, {
          rendererConfig: { antialias: true, alpha: true, powerPreference: 'low-power' },
          animateIn: !matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        instance.current = globe;
        globe
          .backgroundColor('rgba(0,0,0,0)')
          .height(Math.min(520, Math.max(330, host.clientWidth * 0.57)))
          .width(host.clientWidth)
          .globeMaterial(material)
          .showAtmosphere(true)
          .atmosphereColor('#9dbfe8')
          .atmosphereAltitude(0.075)
          .pointLat('latitude')
          .pointLng('longitude')
          .pointColor(() => '#b4eef0')
          .pointAltitude(0.008)
          .pointResolution(10)
          .ringLat('latitude')
          .ringLng('longitude')
          .ringMaxRadius(3.2)
          .ringPropagationSpeed(0.8)
          .ringRepeatPeriod(2000)
          .ringColor(() => (value: number) => `rgba(148,225,238,${(1 - value) * 0.6})`)
          .pointLabel((obj) => {
            const p = obj as Point;
            const node = document.createElement('div');
            node.className = 'aca-earth-tooltip';
            const strong = document.createElement('strong');
            strong.textContent = label(p);
            const detail = document.createElement('span');
            detail.textContent =
              uiNumber(p.views) +
              ' ' +
              t('Page views') +
              ' · ' +
              uiNumber(p.qualified) +
              ' ' +
              t('Qualified reads');
            node.append(strong, detail);
            return node;
          })
          .onPointClick((point) => setSelected(point as Point));
        globe.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        globe.controls().enablePan = false;
        globe.controls().enableDamping = true;
        globe.controls().dampingFactor = 0.08;
        globe.controls().addEventListener('start', () => {
          globe.controls().autoRotate = false;
          setRotate(false);
        });
        globe.controls().autoRotateSpeed = 0.28;
        globe.pointOfView({ lat: 22, lng: 0, altitude: 2.2 }, 0);
        const theme = () => {
          const dark = document.documentElement.dataset.theme === 'dark';
          material.map = dark ? night : day;
          material.emissiveMap = dark ? night : null;
          material.emissiveIntensity = dark ? 0.55 : 0;
          material.needsUpdate = true;
          globe.atmosphereColor(dark ? '#588eb8' : '#91bdd4');
          globe.lights().forEach((light) => {
            light.intensity = light.type === 'AmbientLight' ? (dark ? 2.2 : 2.7) : dark ? 1.8 : 2.3;
            if (light.type === 'DirectionalLight') light.position.set(-250, 160, 300);
          });
        };
        theme();
        themes = new MutationObserver(theme);
        themes.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        });
        observer = new ResizeObserver(() =>
          globe
            .width(host.clientWidth)
            .height(Math.min(520, Math.max(330, host.clientWidth * 0.57))),
        );
        observer.observe(host);
        visibility = new IntersectionObserver((entries) => {
          onScreen = entries[0].isIntersecting;
          if (onScreen && !document.hidden) globe.resumeAnimation();
          else globe.pauseAnimation();
        });
        visibility.observe(host);
        document.addEventListener('visibilitychange', active);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setFailure(
            t('3D rendering is unavailable. The map and exact-value table remain available.'),
          );
          setMode('map');
        }
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      visibility?.disconnect();
      themes?.disconnect();
      document.removeEventListener('visibilitychange', active);
      instance.current?._destructor();
      instance.current = null;
      ownedTextures.forEach((texture) => texture.dispose());
      host.replaceChildren();
    };
  }, [mode]);
  useEffect(() => {
    const globe = instance.current;
    if (!globe || !ready) return;
    if (!focused.current && filtered.length) {
      focused.current = true;
      globe.pointOfView(
        { lat: filtered[0].latitude, lng: filtered[0].longitude, altitude: 2.2 },
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
      );
    }
    globe
      .pointsData(filtered)
      .pointRadius(
        (obj) =>
          0.15 +
          Math.sqrt((obj as Point)[metric as 'views' | 'qualified' | 'active'] / maximum) * 0.8,
      );
  }, [filtered, ready, metric, maximum]);
  useEffect(() => {
    if (instance.current)
      instance.current.controls().autoRotate =
        rotate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, [rotate, ready]);
  useEffect(() => {
    instance.current?.ringsData(
      selected && !matchMedia('(prefers-reduced-motion: reduce)').matches ? [selected] : [],
    );
  }, [selected, ready]);
  const move = (lat: number, lng: number) => {
    const globe = instance.current;
    if (!globe) return;
    const current = globe.pointOfView();
    globe.pointOfView(
      { ...current, lat: Math.max(-80, Math.min(80, current.lat + lat)), lng: current.lng + lng },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
    );
  };
  return (
    <section className="aca-earth glass-panel" aria-label={t('Audience Earth')}>
      <div className="aca-section-head">
        <div>
          <span className="eyebrow">{t('Around the world')}</span>
          <h2>{t('Audience Earth')}</h2>
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={mode === 'osm'} onClick={() => setMode('osm')}>
            {t('OpenStreetMap')}
          </button>
          <button type="button" aria-pressed={mode === 'earth'} onClick={() => setMode('earth')}>
            {t('3D Earth')}
          </button>
          <button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>
            {t('Offline map')}
          </button>
        </div>
      </div>
      <div className="aca-earth-filters">
        <label>
          {t('Country')}
          <select
            aria-label={t('Country')}
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              onCountry?.(e.target.value);
            }}
          >
            <option value="">{t('All countries')}</option>
            {[...new Set(points.map((p) => p.country))].sort().map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          {t('Metric')}
          <select
            aria-label={t('Metric')}
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="views">{t('Page views')}</option>
            <option value="qualified">{t('Qualified reads')}</option>
            <option value="active">{t('Active reading')}</option>
          </select>
        </label>
        <span className="help">
          {uiNumber(filtered.length)} {t('approximate locations')}
        </span>
      </div>
      {failure && (
        <p role="status" className="help">
          {failure}
        </p>
      )}
      {mode === 'osm' ? (
        <Suspense fallback={<p role="status">{t('Loading map…')}</p>}>
          <AudienceMap
            points={filtered}
            metric={metric as 'views' | 'qualified' | 'active'}
            onSelect={setSelected}
            reset={mapReset}
            focus={mapFocus}
          />
        </Suspense>
      ) : mode === 'earth' ? (
        <div
          className="aca-earth-stage"
          ref={container}
          tabIndex={0}
          role="group"
          aria-label={t('Drag to rotate Earth. Arrow keys rotate; plus and minus zoom.')}
          onKeyDown={(event) => {
            const keys: Record<string, () => void> = {
              ArrowLeft: () => move(0, -15),
              ArrowRight: () => move(0, 15),
              ArrowUp: () => move(10, 0),
              ArrowDown: () => move(-10, 0),
              '+': () => {
                const g = instance.current;
                if (g)
                  g.pointOfView(
                    { ...g.pointOfView(), altitude: Math.max(0.8, g.pointOfView().altitude - 0.3) },
                    0,
                  );
              },
              '-': () => {
                const g = instance.current;
                if (g)
                  g.pointOfView(
                    { ...g.pointOfView(), altitude: Math.min(5, g.pointOfView().altitude + 0.3) },
                    0,
                  );
              },
            };
            if (keys[event.key]) {
              event.preventDefault();
              setRotate(false);
              keys[event.key]();
            }
          }}
        >
          <span className="aca-earth-loading" hidden={ready}>
            {t('Preparing Earth…')}
          </span>
        </div>
      ) : (
        <svg
          className="aca-earth-map"
          viewBox="0 0 720 360"
          role="group"
          aria-label={t('Approximate visit locations on a world coordinate map')}
        >
          <g fill="currentColor" opacity=".13">
            {outline.map((d, i) => (
              <path key={i} d={d || ''} />
            ))}
          </g>
          <rect
            x="1"
            y="1"
            width="718"
            height="358"
            rx="16"
            fill="none"
            stroke="currentColor"
            opacity=".15"
          />
          {Array.from({ length: 5 }, (_, i) => (
            <path key={'h' + i} d={`M0 ${(i + 1) * 60}H720`} stroke="currentColor" opacity=".1" />
          ))}
          {Array.from({ length: 11 }, (_, i) => (
            <path key={'v' + i} d={`M${(i + 1) * 60} 0V360`} stroke="currentColor" opacity=".1" />
          ))}
          {filtered.map((p, i) => (
            <circle
              key={i}
              cx={(p.longitude + 180) * 2}
              cy={(90 - p.latitude) * 2}
              r={3 + Math.sqrt(p[metric as 'views' | 'qualified' | 'active'] / maximum) * 10}
              fill="var(--accent)"
              opacity=".7"
              tabIndex={0}
              role="button"
              aria-label={label(p) + ' ' + p.views}
              onClick={() => setSelected(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(p);
              }}
            >
              <title>
                {label(p)} · {p.views}
              </title>
            </circle>
          ))}
        </svg>
      )}
      <div className="aca-earth-controls">
        <Button
          className="small"
          icon="RotateCcw"
          onClick={() => {
            setCountry('');
            onCountry?.('');
            setSelected(null);
            setMapReset((value) => value + 1);
            setMapFocus(null);
            instance.current?.pointOfView(
              { lat: 22, lng: 0, altitude: 2.2 },
              matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
            );
          }}
        >
          {t('Reset view')}
        </Button>
        {mode === 'earth' && (
          <Button className="small" onClick={() => setRotate((v) => !v)} aria-pressed={rotate}>
            {t(rotate ? 'Pause rotation' : 'Rotate Earth')}
          </Button>
        )}
        <span className="help">
          <Icon name="Info" size={13} /> {t('IP-derived estimates · not GPS')}
        </span>
      </div>
      {selected && (
        <div className="aca-earth-selection" role="status">
          <strong>{label(selected)}</strong>
          {onCountry && (
            <Button
              className="small"
              icon="SlidersHorizontal"
              onClick={() => onCountry(selected.country)}
            >
              {t('Filter by country')}
            </Button>
          )}
          <span>
            {uiNumber(selected.views)} {t('Page views')} · {uiNumber(selected.qualified)}{' '}
            {t('Qualified reads')} ·{' '}
            {uiNumber(selected.active / 60000, { maximumFractionDigits: 1 })} {t('min')}
          </span>
          <Button
            className="small"
            onClick={() => {
              setCountry(selected.country);
              setMapFocus({ ...selected });
              instance.current?.pointOfView(
                { lat: selected.latitude, lng: selected.longitude, altitude: 1.1 },
                matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
              );
            }}
          >
            {t('Explore location')}
          </Button>
        </div>
      )}
      {!filtered.length && (
        <p className="help">
          {t('No located observations yet. Earlier visits may not contain geography.')}
        </p>
      )}
      {mode === 'earth' && (
        <p className="aca-earth-credit">
          {t(
            'Earth imagery: NASA Blue Marble via three-globe. Locations show network estimates, not precise reader positions.',
          )}
        </p>
      )}
    </section>
  );
}
