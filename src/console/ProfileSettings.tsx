import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { SiteConfig } from '../shared/contracts.js';
import { Button, Icon, socialIconFor } from '../shared/ui.js';
import { Field, ToggleField } from './components.js';

export function ProfileSettings({
  value,
  onChange,
  onPickPortrait,
}: {
  value: SiteConfig['profile'];
  onChange: (profile: SiteConfig['profile']) => void;
  onPickPortrait: () => void;
}) {
  const profile = (patch: Partial<SiteConfig['profile']>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="settings-card-heading">
        <Icon name="Circle" />
        <h2 data-ui={"The person behind the notebook"}>{t("The person behind the notebook")}</h2>
      </div>
      <div className="profile-editor-photo">
        {value.portrait ? (
          <img src={value.portrait} alt={t("Profile preview")}  data-ui-attrs={"{\"alt\":\"Profile preview\"}"} />
        ) : (
          <span className="profile-photo-placeholder">
            <Icon name="UserRound" size={28} />
          </span>
        )}
        <div>
          <Button className="small" icon="Image" onClick={() => onPickPortrait()}>
            <UiText message={"Choose portrait"}/></Button>
          <p className="help" data-ui={"Choose a portrait from your media library."}>{t("Choose a portrait from your media library.")}</p>
          {value.portrait && (
            <Button className="small" icon="X" onClick={() => profile({ portrait: '' })}>
              <UiText message={"Remove portrait"}/></Button>
          )}
        </div>
      </div>
      <div className="field-row">
        <Field label={t("Your name")}>
          <input value={value.name} onChange={(e) => profile({ name: e.target.value })} />
        </Field>
        <Field label={t("Role or short introduction")}>
          <input value={value.role} onChange={(e) => profile({ role: e.target.value })} />
        </Field>
      </div>
      <Field label={t("Profile headline")} help={t("Line breaks are preserved.")}>
        <textarea
          rows={2}
          value={value.headline}
          onChange={(e) => profile({ headline: e.target.value })}
        />
      </Field>
      <Field label={t("Location")}>
        <input value={value.location} onChange={(e) => profile({ location: e.target.value })} />
      </Field>
      <div className="divider" />
      <h3 className="form-section-title" data-ui={"Find me elsewhere"}>{t("Find me elsewhere")}</h3>
      <Field
        label={t("Contact email")}
        help={t("Shown in About and the footer. Existing email links are supported too.")}
      >
        <input
          type="email"
          value={value.email}
          placeholder={t("you@example.com")}
          onChange={(event) => profile({ email: event.target.value })}
         data-ui-attrs={"{\"placeholder\":\"you@example.com\"}"} />
      </Field>
      <ToggleField
        label={t("Protect email links")}
        help={t("Readers click to reveal contact and article email links. Ordinary prose and code examples remain unchanged.")}
        checked={value.protectEmailLinks}
        onChange={(protectEmailLinks) => profile({ protectEmailLinks })}
      />
      {value.links.map((link, index) => (
        <div key={index} className="repeat-row profile-link-row">
          <Icon name={socialIconFor(link.href)} size={17} />
          <input
            aria-label={t("Link {value0} label", {value0: index + 1})}
            placeholder={t("Label")}
            value={link.label}
            onChange={(e) =>
              profile({
                links: value.links.map((v, i) =>
                  i === index ? { ...v, label: e.target.value } : v,
                ),
              })
            }
           data-ui-attrs={"{\"placeholder\":\"Label\"}"} />
          <input
            aria-label={t("Link {value0} URL", {value0: index + 1})}
            placeholder="https://…"
            value={link.href}
            onChange={(e) =>
              profile({
                links: value.links.map((v, i) =>
                  i === index ? { ...v, href: e.target.value } : v,
                ),
              })
            }
          />
          <button
            className="icon-button"
            aria-label={t("Remove {value0}", {value0: link.label || 'link'})}
            onClick={() => profile({ links: value.links.filter((_, i) => i !== index) })}
          >
            <Icon name="X" size={15} />
          </button>
        </div>
      ))}
      <Button
        className="small"
        icon="Plus"
        disabled={value.links.length >= 12}
        onClick={() =>
          profile({
            links: [...value.links, { label: '', href: '' }],
          })
        }
      >
        <UiText message={"Add link"}/></Button>
      <div className="divider" />
      <h3 className="form-section-title" data-ui={"Affiliations"}>{t("Affiliations")}</h3>
      {value.affiliations.map((item, index) => (
        <div className="repeat-row" key={index}>
          <input
            aria-label={t("Affiliation {value0} name", {value0: index + 1})}
            placeholder={t("Organization")}
            value={item.name}
            onChange={(e) =>
              profile({
                affiliations: value.affiliations.map((v, i) =>
                  i === index ? { ...v, name: e.target.value } : v,
                ),
              })
            }
           data-ui-attrs={"{\"placeholder\":\"Organization\"}"} />
          <input
            aria-label={t("Affiliation {value0} description", {value0: index + 1})}
            placeholder={t("Role or description")}
            value={item.description}
            onChange={(e) =>
              profile({
                affiliations: value.affiliations.map((v, i) =>
                  i === index ? { ...v, description: e.target.value } : v,
                ),
              })
            }
           data-ui-attrs={"{\"placeholder\":\"Role or description\"}"} />
          <button
            className="icon-button"
            aria-label={t("Remove affiliation")}
            onClick={() =>
              profile({
                affiliations: value.affiliations.filter((_, i) => i !== index),
              })
            }
           data-ui-attrs={"{\"aria-label\":\"Remove affiliation\"}"} >
            <Icon name="X" size={15} />
          </button>
        </div>
      ))}
      <Button
        className="small"
        icon="Plus"
        disabled={value.affiliations.length >= 8}
        onClick={() =>
          profile({
            affiliations: [...value.affiliations, { name: '', description: '' }],
          })
        }
      >
        <UiText message={"Add affiliation"}/></Button>
    </>
  );
}
