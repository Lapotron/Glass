import { t } from '../../shared/i18n.js';
import type { PlotConfig } from '../../shared/interactives.js';
import { plotPath } from '../../shared/interactive-geometry.js';
import { updateRange } from '../../shared/forms.js';
export function enhance(node: HTMLElement, config: PlotConfig) {
  const c = config as PlotConfig;
  const inputs = [...node.querySelectorAll<HTMLInputElement>('input[type=range]')];
  const update = () => {
    const amplitude = Number(inputs.find((i) => i.dataset.param === 'amplitude')!.value);
    const frequency = Number(inputs.find((i) => i.dataset.param === 'frequency')!.value);
    node.querySelector('.plot-curve')?.setAttribute('d', plotPath(c, amplitude, frequency));
    inputs.forEach((input) => {
      updateRange(input);
      input.parentElement!.querySelector('output')!.textContent = Number(input.value).toFixed(1);
    });
    node
      .querySelector('.plot-svg')
      ?.setAttribute(
        'aria-label',
        t("{value0} plot with amplitude {value1} and frequency {value2}", {value0: c.preset, value1: amplitude, value2: frequency}),
      );
  };
  inputs.forEach((input) => input.addEventListener('input', update));
  node.querySelector('[data-reset]')?.addEventListener('click', () => {
    inputs.forEach(
      (i) => (i.value = String(i.dataset.param === 'amplitude' ? c.amplitude : c.frequency)),
    );
    update();
  });

  node.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[disabled]').forEach((control) => {
    control.disabled = false;
  });
}
