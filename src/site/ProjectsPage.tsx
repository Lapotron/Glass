import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import type { Project } from '../shared/projects.js';
import { projectStatusLabels } from '../shared/projects.js';
import { Icon } from '../shared/ui.js';
import { imageSet } from '../shared/utils.js';
export function ProjectsPage({ projects }: { projects: Project[] }) {
  return (
    <div className="projects-page">
      <header className="projects-intro">
        <span className="eyebrow">
          <Icon name="Code2" size={16} /> <UiText message={" Made with curiosity"}/></span>
        <h1 data-ui={"Projects"}>{t("Projects")}</h1>
        <p data-ui={"Software, experiments, and things I’m building."}>{t("Software, experiments, and things I’m building.")}</p>
      </header>
      {projects.length ? (
        <div className="projects-grid">
          {projects.map((project) => (
            <article
              className="project-card glass-panel"
              id={project.id}
              key={project.id}
              data-aca-item={`project:${project.id}`}
              data-aca-surface="projects"
            >
              {project.image && (
                <a className="project-image" href={project.image} data-view-image={project.image}>
                  <img
                    src={project.image}
                    srcSet={imageSet(project.image)}
                    sizes="(max-width: 640px) 100vw, 460px"
                    alt={project.imageAlt || project.title}
                    loading="lazy"
                  />
                </a>
              )}
              <div className="project-content">
                <span className="project-status" data-status={project.status}>
                  <i aria-hidden="true" />
                  <UiText message={projectStatusLabels[project.status]}/>
                </span>
                <h2>{project.title}</h2>
                <p>{project.description}</p>
                <ul className="project-technologies" aria-label={t("Technology stack")} data-ui-attrs={"{\"aria-label\":\"Technology stack\"}"} >
                  {project.technologies.map((tech) => (
                    <li key={tech}>{tech}</li>
                  ))}
                </ul>
                <div className="project-links">
                  {project.links.map((link, index) => (
                    <a
                      key={index}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link"
                    >
                      <Icon
                        name={/github\.com/.test(link.url) ? 'Github' : 'ArrowUpRight'}
                        size={15}
                      />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="projects-empty glass-panel">
          <Icon name="Code2" size={28} />
          <h2 data-ui={"Something is taking shape."}>{t("Something is taking shape.")}</h2>
          <p data-ui={"Projects will appear here when they’re ready to share."}>{t("Projects will appear here when they’re ready to share.")}</p>
        </div>
      )}
    </div>
  );
}
