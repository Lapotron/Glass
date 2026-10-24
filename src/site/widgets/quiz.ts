import { t } from '../../shared/i18n.js';
import type { QuizConfig } from '../../shared/interactives.js';
export function enhance(node: HTMLElement, config: QuizConfig) {
  const value = config as QuizConfig,
    inputs = [...node.querySelectorAll<HTMLInputElement>('input[type="radio"]')],
    check = node.querySelector<HTMLButtonElement>('[data-check-answer]')!,
    reset = node.querySelector<HTMLButtonElement>('[data-reset-quiz]')!,
    result = node.querySelector<HTMLElement>('.quiz-feedback')!,
    solution = node.querySelector<HTMLDetailsElement>('.quiz-solution')!;
  check.hidden = false;
  check.disabled = !inputs.some((input) => input.checked);
  reset.hidden = false;
  inputs.forEach((input) =>
    input.addEventListener('change', () => {
      check.disabled = false;
      result.textContent = '';
      delete result.dataset.state;
    }),
  );
  check.addEventListener('click', () => {
    const selected = inputs.find((input) => input.checked);
    if (!selected) return;
    const correct = Number(selected.value) === value.answer;
    result.dataset.state = correct ? 'correct' : 'incorrect';
    result.textContent = correct
      ? t("That’s right. Compare your reasoning with the explanation.")
      : t("Take another look. The explanation shows how the choices differ.");
    solution.open = true;
  });
  reset.addEventListener('click', () => {
    inputs.forEach((input) => (input.checked = false));
    check.disabled = true;
    result.textContent = '';
    delete result.dataset.state;
    solution.open = false;
  });
}
