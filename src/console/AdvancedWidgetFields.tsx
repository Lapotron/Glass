import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { QuizConfig, TabsConfig } from '../shared/interactives.js';
import { Button, Icon } from '../shared/ui.js';
import { Field } from './components.js';
export function AdvancedWidgetFields({
  config,
  onChange,
}: {
  config: QuizConfig | TabsConfig;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (config.type === 'quiz')
    return (
      <>
        <Field label={t("Question")}>
          <textarea
            rows={3}
            value={config.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
          />
        </Field>
        <div className="choice-editor">
          {config.choices.map((choice, index) => (
            <div key={index}>
              <Field label={t("Choice {value0}", {value0: index + 1})}>
                <input
                  value={choice}
                  onChange={(event) =>
                    onChange({
                      choices: config.choices.map((old, i) =>
                        i === index ? event.target.value : old,
                      ),
                    })
                  }
                />
              </Field>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Remove choice {value0}", {value0: index + 1})}
                disabled={config.choices.length <= 2}
                onClick={() =>
                  onChange({
                    choices: config.choices.filter((_, i) => i !== index),
                    answer:
                      config.answer === index
                        ? 0
                        : config.answer > index
                          ? config.answer - 1
                          : config.answer,
                  })
                }
              >
                <Icon name="X" size={15} />
              </button>
            </div>
          ))}
        </div>
        <Button
          className="small"
          icon="Plus"
          disabled={config.choices.length >= 8}
          onClick={() => onChange({ choices: [...config.choices, 'Another choice'] })}
        >
          <UiText message={"Add choice"}/></Button>
        <Field label={t("Correct answer")}>
          <select
            value={config.answer}
            onChange={(event) => onChange({ answer: Number(event.target.value) })}
          >
            {config.choices.map((choice, index) => (
              <option value={index} key={index}>
                {index + 1}. {choice}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Explanation")}>
          <textarea
            rows={3}
            value={config.explanation}
            onChange={(event) => onChange({ explanation: event.target.value })}
          />
        </Field>
      </>
    );
  return (
    <>
      <div className="tab-editor">
        {config.tabs.map((tab, index) => (
          <fieldset key={index}>
            <legend><UiText message={"View "}/>{index + 1}</legend>
            <Field label={t("Tab {value0} label", {value0: index + 1})}>
              <input
                value={tab.label}
                onChange={(event) =>
                  onChange({
                    tabs: config.tabs.map((old, i) =>
                      i === index ? { ...old, label: event.target.value } : old,
                    ),
                  })
                }
              />
            </Field>
            <Field label={t("Tab {value0} text", {value0: index + 1})}>
              <textarea
                rows={4}
                value={tab.body}
                onChange={(event) =>
                  onChange({
                    tabs: config.tabs.map((old, i) =>
                      i === index ? { ...old, body: event.target.value } : old,
                    ),
                  })
                }
              />
            </Field>
            <Button
              className="small"
              variant="ghost"
              icon="X"
              disabled={config.tabs.length <= 2}
              onClick={() =>
                onChange({
                  tabs: config.tabs.filter((_, i) => i !== index),
                  active:
                    config.active === index
                      ? 0
                      : config.active > index
                        ? config.active - 1
                        : config.active,
                })
              }
            >
              <UiText message={"Remove view"}/></Button>
          </fieldset>
        ))}
      </div>
      <Button
        className="small"
        icon="Plus"
        disabled={config.tabs.length >= 6}
        onClick={() =>
          onChange({
            tabs: [
              ...config.tabs,
              { label: 'Another view', body: 'Explain another part of the idea.' },
            ],
          })
        }
      >
        <UiText message={"Add view"}/></Button>
      <Field label={t("Starting view")}>
        <select
          value={config.active}
          onChange={(event) => onChange({ active: Number(event.target.value) })}
        >
          {config.tabs.map((tab, index) => (
            <option value={index} key={index}>
              {tab.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
