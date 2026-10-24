export type ArticleCitation = {
  id: string;
  title: string;
  site: string;
  url: string;
  author?: string;
  publishedAt?: string;
  updatedAt?: string;
};
export function articleCitations(article: ArticleCitation) {
  const clean = (s: string) =>
    [...s]
      .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
      .join('')
      .replace(/ +/g, ' ')
      .trim();
  const bib = (s: string) => clean(s).replace(/[\\{}%&#_$]/g, '\\$&');
  const year = article.publishedAt?.slice(0, 4),
    date = article.updatedAt || article.publishedAt;
  const key = `entry-${article.id.replace(/[^a-z\d_-]/gi, '-')}`;
  return {
    plain: `${article.author ? clean(article.author) + '. ' : ''}${year ? `(${year}). ` : ''}${clean(article.title)}. ${clean(article.site)}. ${article.url}`,
    bibtex: `@online{${key},\n  title = {${bib(article.title)}},${article.author ? `\n  author = {${bib(article.author)}},` : ''}\n  organization = {${bib(article.site)}},${date ? `\n  date = {${date}},` : ''}\n  url = {${bib(article.url)}}\n}`,
    ris: `TY  - ELEC\nTI  - ${clean(article.title)}${article.author ? `\nAU  - ${clean(article.author)}` : ''}\nT2  - ${clean(article.site)}${year ? `\nPY  - ${year}` : ''}${article.publishedAt ? `\nDA  - ${article.publishedAt.replaceAll('-', '/')}` : ''}\nUR  - ${article.url}\nER  -`,
  };
}
