import { t } from '../shared/i18n.js';
import { UiText } from '../shared/UiText.js';
import { Icon } from '../shared/ui.js';

export type SpecimenContent = { reading: string; materials: string };
const sampleCode = '\n~~~ts title="reading-notes.ts" wrap\nconst attention = 1;\nconst curiosity = 1.5;\n\nexport function makeRoom(minutes: number) {\n  return minutes * attention * curiosity;\n}\n~~~\n';
export const readerSpecimenSources = {
  en: String.raw`<p class="reader-sample-metadata">A sample article · Typography preview</p>

## A little room for an idea

A good page makes it easy to stay with a thought. The words are the beginning; their **rhythm**, *emphasis*, and space make reading feel effortless.

### The shape of a sentence

A [useful link](/archive/) should remain easy to find. Inline code, such as <code>makeRoom(15)</code>, belongs comfortably to its sentence. So does a small equation: $e^{i\pi}+1=0$.

> Leave enough space for the next question.

There is room for more than one language: 留一点空白，让文字与思绪自在呼吸。 A reading surface should support every voice.[^type]

### Details that make a difference

1. Begin with a question worth asking.
2. Read slowly enough to notice a connection.
3. Keep a note for the next visit.

- [x] Clear text and quiet contrast
- [ ] A new idea to explore

| A reading detail | Setting | Purpose |
| :--- | ---: | :--- |
| Line height | 1.8 | A comfortable rhythm |
| Paragraph space | 1.2 | Room between ideas |
| Article width | 72 ch | A manageable line |

A display equation gets a little room of its own:

$$
\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}.
$$

### An idea, written in code
` + sampleCode + String.raw`
The frame, syntax colors, filename, and controls are the same ones used in published articles.

[^type]: This is sample text. Changing your appearance never edits the author's writing.
`,
  'zh-Hans': String.raw`<p class="reader-sample-metadata">示例文章 · 排版预览</p>

## 为一个想法留一点空间

好的页面，让人愿意陪一个想法多停留片刻。文字只是开始；恰当的**节奏**、*强调*与留白，让阅读更加从容。

### 句子的形状

[有用的链接](/archive/)应当清晰可辨。行内代码 <code>makeRoom(15)</code> 可以自然地融入句子，简短的公式也一样：$e^{i\pi}+1=0$。

> 留一点空白，让下一个问题有地方生长。

不同的语言也能共享舒适的阅读节奏：Clarity leaves room for curiosity。好的阅读界面，应当让每一种声音都能自在表达。[^type]

### 值得留心的细节

1. 从一个值得追问的问题开始。
2. 放慢阅读，留意想法之间的联系。
3. 记下一笔，留待下次重访。

- [x] 清晰的文字与柔和的对比
- [ ] 一个值得探索的新想法

| 阅读细节 | 设置 | 用途 |
| :--- | ---: | :--- |
| 行高 | 1.8 | 舒适的节奏 |
| 段落间距 | 1.2 | 想法之间的留白 |
| 文章宽度 | 72 ch | 易于阅读的行长 |

独立公式也需要恰当的空间：

$$
\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}.
$$

### 用代码写下一个想法
` + sampleCode + String.raw`
这里的边框、语法颜色、文件名和操作按钮，与正式文章使用相同的渲染方式。

[^type]: 这是示例文字。调整外观不会修改作者的文章。
`,
  'zh-Hant': String.raw`<p class="reader-sample-metadata">範例文章 · 排版預覽</p>

## 為一個想法留一點空間

好的頁面，讓人願意陪一個想法多停留片刻。文字只是開始；恰當的**節奏**、*強調*與留白，讓閱讀更加從容。

### 句子的形狀

[實用的連結](/archive/)應當清晰可辨。行內程式碼 <code>makeRoom(15)</code> 可以自然地融入句子，簡短的公式也一樣：$e^{i\pi}+1=0$。

> 留一點空白，讓下一個問題有地方生長。

不同的語言也能共享舒適的閱讀節奏：Clarity leaves room for curiosity。好的閱讀介面，應當讓每一種聲音都能自在表達。[^type]

### 值得留心的細節

1. 從一個值得追問的問題開始。
2. 放慢閱讀，留意想法之間的聯繫。
3. 記下一筆，留待下次重訪。

- [x] 清晰的文字與柔和的對比
- [ ] 一個值得探索的新想法

| 閱讀細節 | 設定 | 用途 |
| :--- | ---: | :--- |
| 行高 | 1.8 | 舒適的節奏 |
| 段落間距 | 1.2 | 想法之間的留白 |
| 文章寬度 | 72 ch | 易於閱讀的行長 |

獨立公式也需要恰當的空間：

$$
\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}.
$$

### 用程式碼寫下一個想法
` + sampleCode + String.raw`
這裡的邊框、語法顏色、檔案名稱和操作按鈕，與正式文章使用相同的呈現方式。

[^type]: 這是範例文字。調整外觀不會修改作者的文章。
`,
} as const;
export const readerSpecimenSource = readerSpecimenSources.en;
export const readerMaterialSources = {
  en: '### A calm reading surface.\n\nLight, color, and texture support the words without taking their place.\n' + sampleCode,
  'zh-Hans': '### 从容的阅读空间\n\n光线、色彩与质感衬托文字，让内容始终居于中心。\n' + sampleCode,
  'zh-Hant': '### 從容的閱讀空間\n\n光線、色彩與質感襯托文字，讓內容始終居於中心。\n' + sampleCode,
} as const;

export function ReaderSpecimen({ readingHtml, materialsHtml, translations = {} }: { readingHtml: string; materialsHtml: string; translations?: Partial<Record<'en'|'zh-Hans'|'zh-Hant',SpecimenContent>> }) {
  return (
    <aside
      className="reader-specimen"
      aria-label={t("Live appearance preview")}
      data-reader-specimen
      data-specimen-language="en"
      data-expanded="false"
     data-ui-attrs={"{\"aria-label\":\"Live appearance preview\"}"} >
      <div className="reader-preview-heading">
        <div className="reader-preview-label">
          <Icon name="Eye" size={15} />
          <UiText message={"Live preview"}/></div>
        <button
          type="button"
          className="text-link reader-preview-expand"
          data-preview-expand
          aria-expanded="false"
          aria-controls="reader-preview-scenes"
          disabled
        >
          <Icon name="Expand" size={14} />
          <span data-ui={"Expand preview"}>{t("Expand preview")}</span>
        </button>
      </div>
      <div className="reader-preview-tabs" role="tablist" aria-label={t("Appearance preview scenes")} data-ui-attrs={"{\"aria-label\":\"Appearance preview scenes\"}"} >
        {(
          [
            ['reading', 'BookOpen', 'Reading'],
            ['controls', 'SlidersHorizontal', 'Controls'],
            ['materials', 'Layers', 'Materials'],
          ] as const
        ).map(([key, icon, title]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`reader-preview-tab-${key}`}
            aria-controls={`reader-preview-${key}`}
            aria-selected={key === 'reading'}
            tabIndex={key === 'reading' ? 0 : -1}
            data-preview-tab={key}
            disabled
          >
            <Icon name={icon} size={14} />
            <span><UiText message={title}/></span>
          </button>
        ))}
      </div>
      <div id="reader-preview-scenes" className="reader-preview-scenes">
        <section
          id="reader-preview-reading"
          role="tabpanel"
          aria-labelledby="reader-preview-tab-reading"
          data-preview-panel="reading"
          className="reader-preview-surface reading-material reader-reading-frame"
          data-liquid="surface"
        >
          <div
            className="article-body prose reading-surface glass-panel"
            tabIndex={0}
            role="region"
            aria-label={t("Typography preview")}
            data-preview-scroll
            dangerouslySetInnerHTML={{ __html: readingHtml }}
           data-ui-attrs={"{\"aria-label\":\"Typography preview\"}"} />
        </section>
        <section
          id="reader-preview-controls"
          role="tabpanel"
          aria-labelledby="reader-preview-tab-controls"
          data-preview-panel="controls"
          className="reader-preview-surface glass-panel"
          hidden
        >
          <div
            className="reader-demo-controls reader-scene-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Controls preview")}
            data-preview-scroll
           data-ui-attrs={"{\"aria-label\":\"Controls preview\"}"} >
            <header className="reader-demo-heading">
              <span className="reader-demo-icon">
                <Icon name="SlidersHorizontal" size={18} />
              </span>
              <div>
                <h3 data-ui={"Comfort in every detail."}>{t("Comfort in every detail.")}</h3>
                <p className="help" data-ui={"Try a few details. Your saved settings stay as they are."}>{t("Try a few details. Your saved settings stay as they are.")}</p>
              </div>
            </header>
            <div className="reader-demo-pair">
              <label className="reader-demo-field">
                <span data-ui={"Your name"}>{t("Your name")}</span>
                <input
                  type="text"
                  placeholder={t("A readable placeholder")}
                  aria-label={t("Preview field")}
                 data-ui-attrs={"{\"placeholder\":\"A readable placeholder\",\"aria-label\":\"Preview field\"}"} />
              </label>
              <label className="reader-demo-field">
                <span data-ui={"A preferred view"}>{t("A preferred view")}</span>
                <select aria-label={t("Demo view")} data-ui-attrs={"{\"aria-label\":\"Demo view\"}"} >
                  <option data-ui={"Quiet and spacious"}>{t("Quiet and spacious")}</option>
                  <option data-ui={"Compact and focused"}>{t("Compact and focused")}</option>
                </select>
              </label>
            </div>
            <label className="reader-demo-field">
              <span data-ui={"Find an idea"}>{t("Find an idea")}</span>
              <span className="search-field">
                <Icon name="Search" size={16} />
                <input type="search" placeholder={t("Search the notebook…")} aria-label={t("Demo search")}  data-ui-attrs={"{\"placeholder\":\"Search the notebook…\",\"aria-label\":\"Demo search\"}"} />
              </span>
            </label>
            <label className="reader-demo-field">
              <span>
                <UiText message={"A little more light"}/><output data-demo-range-output>50%</output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={50}
                aria-label={t("Demo light")}
                data-demo-range
               data-ui-attrs={"{\"aria-label\":\"Demo light\"}"} />
            </label>
            <div className="reader-demo-pair reader-demo-options">
              <fieldset className="reader-demo-checks">
                <legend data-ui={"Keep the details"}>{t("Keep the details")}</legend>
                <label>
                  <input type="checkbox" defaultChecked />
                  <UiText message={"Keep a place in the story"}/></label>
                <label>
                  <input type="checkbox" /><UiText message={"A little room to explore"}/></label>
              </fieldset>
              <fieldset className="reader-demo-radios">
                <legend data-ui={"Reading rhythm"}>{t("Reading rhythm")}</legend>
                <label>
                  <input type="radio" name="demo-rhythm" defaultChecked />
                  <UiText message={"Unhurried"}/></label>
                <label>
                  <input type="radio" name="demo-rhythm" />
                  <UiText message={"Focused"}/></label>
              </fieldset>
            </div>
            <label className="reader-toggle reader-demo-toggle">
              <span>
                <strong data-ui={"A quiet reminder"}>{t("A quiet reminder")}</strong>
                <small data-ui={"A native switch with a glass thumb."}>{t("A native switch with a glass thumb.")}</small>
              </span>
              <input type="checkbox" role="switch" aria-label={t("Demo reminder")}  data-ui-attrs={"{\"aria-label\":\"Demo reminder\"}"} />
            </label>
            <label className="reader-demo-field">
              <span data-ui={"Example validation"}>{t("Example validation")}</span>
              <input
                type="email"
                defaultValue="hello"
                aria-invalid="true"
                aria-describedby="reader-demo-error"
              />
              <small id="reader-demo-error" className="reader-demo-error" data-ui={"Please enter a complete email address."}>
                {t("Please enter a complete email address.")}</small>
            </label>
            <footer className="reader-demo-footer">
              <div className="reader-demo-actions">
                <button type="button" className="button primary small" data-demo-save>
                  <Icon name="Check" size={14} />
                  <UiText message={"Try a button"}/></button>
                <button type="button" className="button secondary small" data-ui={"Secondary"}>
                  {t("Secondary")}</button>
                <button type="button" className="text-link" disabled data-ui={"Unavailable"}>
                  {t("Unavailable")}</button>
              </div>
              <p className="help" role="status" data-demo-status data-ui={"Focus, press, and hover to see the details."}>
                {t("Focus, press, and hover to see the details.")}</p>
            </footer>
          </div>
        </section>
        <section
          id="reader-preview-materials"
          role="tabpanel"
          aria-labelledby="reader-preview-tab-materials"
          data-preview-panel="materials"
          hidden
        >
          <div className="reader-materials reader-scene-scroll" data-preview-scroll>
            <div className="reader-specimen-tools glass">
              <span>
                <Icon name="BookOpen" size={16} />
                <UiText message={"Your notebook"}/></span>
              <button
                type="button"
                className="icon-button"
                aria-label={t("Save demo note")}
                aria-pressed="false"
                data-demo-bookmark
               data-ui-attrs={"{\"aria-label\":\"Save demo note\"}"} >
                <Icon name="Sparkles" size={17} />
              </button>
            </div>
            <a className="reader-demo-card glass-panel" href="/archive/">
              <span className="chip" data-ui={"A thought worth keeping"}>{t("A thought worth keeping")}</span>
              <strong data-ui={"Something new to discover."}>{t("Something new to discover.")}</strong>
              <span>
                <UiText message={"Open the archive"}/><Icon name="ArrowUpRight" size={15} />
              </span>
            </a>
            <div className="article-body prose reading-surface glass-panel reader-material-reading" data-material-content dangerouslySetInnerHTML={{__html: materialsHtml}}/>
          </div>
        </section>
      </div>
      {Object.entries(translations).map(([locale, content]) => <template key={locale} data-specimen-locale={locale} dangerouslySetInnerHTML={{__html: `<div data-specimen-reading>${content.reading}</div><div data-specimen-materials>${content.materials}</div>`}}/>)}
    </aside>
  );
}
