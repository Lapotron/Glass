import type {AudienceClient} from '../shared/audience.js';
const size=(value:number):AudienceClient['viewport']=>value<600?'small':value<1000?'medium':value<1600?'large':'wide';
export function audienceClient():AudienceClient{
  const cores=navigator.hardwareConcurrency,memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
  return {viewport:size(innerWidth),screen:size(screen.width),density:devicePixelRatio<1.5?'1':devicePixelRatio<2.5?'2':'3+',orientation:innerWidth>innerHeight?'landscape':'portrait',theme:document.documentElement.dataset.theme==='dark'?'dark':'light',motion:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'normal',...(Number.isFinite(cores)&&cores>0?{cores:cores<=2?'1–2' as const:cores<=4?'3–4' as const:cores<=8?'5–8' as const:'9+' as const}:{}),...(typeof memory==='number'&&Number.isFinite(memory)&&memory>0?{memory:memory<=2?'≤2' as const:memory<=4?'4' as const:'8+' as const}:{})};
}
