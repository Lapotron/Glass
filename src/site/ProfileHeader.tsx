import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { SiteConfig } from '../shared/contracts.js';
import { Icon, socialIconFor } from '../shared/ui.js';
import { ContactLink } from './ContactLink.js';
import { imageSet } from '../shared/utils.js';

export function ProfileHeader({
  profile,
  links,
  compact = false,
  visibility,
  eyebrow = 'About',
  titleAnchor,
  sourceRange,
}: {
  profile: SiteConfig['profile'];
  links: SiteConfig['profile']['links'];
  compact?: boolean;
  visibility?: SiteConfig['home']['profile'];
  eyebrow?: string;
  titleAnchor?: string;
  sourceRange?: [number, number];
}) {
  const affiliations = profile.affiliations.filter((item) => item.name || item.description);
  return (
    <header className={`about-profile${compact ? ' home-profile' : ''}`}>
      {(visibility?.showPortrait ?? true) && profile.portrait && (
        <img
          className="about-portrait"
          src={profile.portrait}
          srcSet={imageSet(profile.portrait)}
          sizes="(max-width: 600px) 96px, 128px"
          alt={profile.name}
          decoding="async"
          width={128}
          height={128}
        />
      )}
      <div className="about-introduction">
        <span className="eyebrow">
          <Icon name={compact ? 'Sparkles' : 'UserRound'} size={14} />
          {eyebrow}
        </span>
        <h1
          id={titleAnchor}
          data-source-start={sourceRange?.[0]}
          data-source-end={sourceRange?.[1]}
        >
          {profile.name}
        </h1>
        <p className="about-headline">{profile.headline}</p>
        <div className="about-details">
          {(visibility?.showRole ?? true) && profile.role && (
            <span>
              <Icon name="PenLine" size={14} />
              {profile.role}
            </span>
          )}
          {(visibility?.showLocation ?? true) && profile.location && (
            <span>
              <Icon name="MapPin" size={14} />
              {profile.location}
            </span>
          )}
        </div>
        {(visibility?.showAffiliations ?? true) && affiliations.length > 0 && (
          <ul className="about-affiliations" aria-label={t("Affiliations")} data-ui-attrs={"{\"aria-label\":\"Affiliations\"}"} >
            {affiliations.map((item, index) => (
              <li key={index}>
                <Icon name="Layers" size={14} />
                <div>
                  {item.name && <strong>{item.name}</strong>}
                  {item.description && <span>{item.description}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {(visibility?.showLinks ?? true) && links.length > 0 && (
          <nav className="about-links" aria-label={t("Find me elsewhere")} data-ui-attrs={"{\"aria-label\":\"Find me elsewhere\"}"} >
            {links.map((link, index) => (
              <ContactLink
                key={index}
                label={link.label}
                href={link.href}
                protect={profile.protectEmailLinks}
                className="button secondary small"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name={socialIconFor(link.href)} size={16} />
                {link.label}
                <Icon name="ArrowUpRight" size={12} />
              </ContactLink>
            ))}
          </nav>
        )}
        {compact && (
          <a className="text-link home-about-link" href="/about/">
            <UiText message={"About me"}/><Icon name="ArrowUpRight" size={14} />
          </a>
        )}
      </div>
    </header>
  );
}
