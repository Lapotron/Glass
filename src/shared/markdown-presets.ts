export const markdownPresets = [
  {
    type: 'alert',
    label: 'Alert',
    icon: 'AlertCircle' as const,
    value: '> [!TIP]\n> A useful detail, close to the explanation.\n',
  },
  {
    type: 'discussion',
    label: 'Discussion',
    icon: 'MessageCircle' as const,
    value:
      ':::discussion[An open question]{#SECTION_KEY comments="true"}\nWhat do you think? Add context or an alternative explanation here.\n:::\n',
  },
  {
    type: 'qa',
    label: 'Question & answer',
    icon: 'CircleHelp' as const,
    value:
      ':::question[Why does this work?]\nState the question in your own words.\n:::\n\n:::answer[An explanation]\nDevelop the answer with **Markdown** and $x^2$.\n:::\n',
  },
  {
    type: 'details',
    label: 'Disclosure',
    icon: 'ChevronDown' as const,
    value:
      ':::details[A closer look]\nExtra context, with **Markdown**, lists, and equations.\n:::\n',
  },
  {
    type: 'rich-tabs',
    label: 'Markdown tabs',
    icon: 'Columns2' as const,
    value:
      '::::tabs\n:::tab[Explanation]\nA little **context**.\n:::\n\n:::tab[Example]\nA worked example with $E=mc^2$.\n:::\n::::\n',
  },
  {
    type: 'steps',
    label: 'Steps',
    icon: 'ListTree' as const,
    value:
      ':::steps\n1. **Observe.** Start with a question.\n2. **Try.** Make a small experiment.\n3. **Reflect.** Describe what changed.\n:::\n',
  },
  {
    type: 'figure',
    label: 'Captioned image',
    icon: 'Image' as const,
    value:
      ':::figure[A moment, held in a frame.]\n![Describe this image](/media/coast-dawn.svg)\n:::\n',
  },
  {
    type: 'gallery',
    label: 'Image gallery',
    icon: 'Layers' as const,
    value:
      ':::gallery\n![Coast at dawn](/media/coast-dawn.svg)\n\n![Coast at dusk](/media/coast-dusk.svg)\n:::\n',
  },
  {
    type: 'link-card',
    label: 'Link card',
    icon: 'LinkIcon' as const,
    value:
      '::link-card[Explore the archive]{href="/archive/" description="Writing and experiments, collected over time."}\n',
  },
  {
    type: 'definitions',
    label: 'Definitions',
    icon: 'BookOpen' as const,
    value:
      'Refraction\n: The change in direction of light as it enters another material.\n\nReflection\n: Light returning from a surface.\n',
  },
  {
    type: 'inline-tools',
    label: 'Inline notation',
    icon: 'Code2' as const,
    value:
      ':mark[An important phrase], :kbd[⌘K], :abbr[SVG]{title="Scalable Vector Graphics"}, H:sub[2]O, and x:sup[2].\n',
  },
  {
    type: 'code-emphasis',
    label: 'Code emphasis',
    icon: 'Code2' as const,
    value:
      '```typescript title="A small experiment" {2}\nconst light = 1;\nconst refracted = light * 1.5;\n```\n',
  },
];
