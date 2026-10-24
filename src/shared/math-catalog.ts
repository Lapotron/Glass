/** The same allowlist drives TeX, Studio, validation and the portable authoring pack. */
export const mathExtensions = [
  'mathtools',
  'cancel',
  'boldsymbol',
  'amscd',
  'cases',
  'centernot',
  'extpfeil',
  'upgreek',
  'gensymb',
  'textcomp',
  'units',
  'mhchem',
  'physics',
] as const;
export type MathExtension = (typeof mathExtensions)[number];
export type MathSettings = { packages: MathExtension[] };
export const stemPackages: MathExtension[] = mathExtensions.filter((p) => p !== 'physics');
export function effectiveMathPackages(settings?: MathSettings) {
  const enabled = new Set(settings?.packages || []);
  return ['base', 'ams', 'newcommand', ...mathExtensions.filter((p) => enabled.has(p))];
}
export type MathCommand = {
  name: string;
  description: string;
  category: string;
  package?: MathExtension;
  arguments?: string[];
  optional?: string;
  example?: string;
  symbol?: string;
  aliases?: string;
};
const symbols = (category: string, rows: string): MathCommand[] =>
  rows.split('|').map((row) => {
    const [name, symbol, description, aliases] = row.split(';');
    return { name, symbol, description: description || name, aliases, category };
  });
const commands = (
  category: string,
  rows: [string, string, string[], string?][],
  pkg?: MathExtension,
): MathCommand[] =>
  rows.map(([name, description, args, example]) => ({
    name,
    description,
    arguments: args,
    example,
    category,
    package: pkg,
  }));
export const mathCommandCatalog: MathCommand[] = [
  ...symbols(
    'Greek',
    'alpha;α;Alpha;阿尔法|beta;β;Beta;贝塔|gamma;γ;Gamma;伽马|delta;δ;Delta;德尔塔|epsilon;ϵ;Epsilon|varepsilon;ε;Variant epsilon|zeta;ζ;Zeta|eta;η;Eta|theta;θ;Theta;西塔|vartheta;ϑ;Variant theta|iota;ι;Iota|kappa;κ;Kappa|lambda;λ;Lambda;波长|mu;μ;Mu;微|nu;ν;Nu;频率|xi;ξ;Xi|pi;π;Pi;圆周率|rho;ρ;Rho;密度|varrho;ϱ;Variant rho|sigma;σ;Sigma|tau;τ;Tau|upsilon;υ;Upsilon|phi;ϕ;Phi|varphi;φ;Variant phi|chi;χ;Chi|psi;ψ;Psi;波函数|omega;ω;Omega;角频率|Gamma;Γ;Capital gamma|Delta;Δ;Capital delta|Theta;Θ;Capital theta|Lambda;Λ;Capital lambda|Xi;Ξ;Capital xi|Pi;Π;Capital pi|Sigma;Σ;Capital sigma|Upsilon;Υ;Capital upsilon|Phi;Φ;Capital phi|Psi;Ψ;Capital psi|Omega;Ω;Capital omega',
  ),
  ...symbols(
    'Symbols',
    'infty;∞;Infinity;无限|partial;∂;Partial derivative;偏导|nabla;∇;Gradient;梯度|ell;ℓ;Script ell|hbar;ℏ;Reduced Planck constant;普朗克|imath;ı;Dotless i|jmath;ȷ;Dotless j|Re;ℜ;Real part|Im;ℑ;Imaginary part|emptyset;∅;Empty set|varnothing;∅;Empty set|forall;∀;For all;任意|exists;∃;There exists;存在|neg;¬;Negation|angle;∠;Angle|perp;⊥;Perpendicular|parallel;∥;Parallel|aleph;ℵ;Aleph|prime;′;Prime',
  ),
  ...symbols(
    'Relations',
    'le;≤;Less than or equal|ge;≥;Greater than or equal|leq;≤;Less than or equal|geq;≥;Greater than or equal|neq;≠;Not equal|approx;≈;Approximately equal|equiv;≡;Equivalent|sim;∼;Similar|simeq;≃;Similar or equal|cong;≅;Congruent|propto;∝;Proportional;正比|ll;≪;Much less|gg;≫;Much greater|in;∈;Element of|notin;∉;Not an element|subset;⊂;Subset|subseteq;⊆;Subset or equal|supset;⊃;Superset|supseteq;⊇;Superset or equal|to;→;Tends to|mapsto;↦;Maps to|rightarrow;→;Right arrow|leftarrow;←;Left arrow|leftrightarrow;↔;Both directions|Rightarrow;⇒;Implies|Leftarrow;⇐;Implied by|Leftrightarrow;⇔;If and only if|uparrow;↑;Up arrow|downarrow;↓;Down arrow',
  ),
  ...symbols(
    'Operators',
    'cdot;⋅;Dot product;点积|times;×;Cross product;叉积|div;÷;Division|pm;±;Plus or minus|mp;∓;Minus or plus|circ;∘;Composition|otimes;⊗;Tensor product|oplus;⊕;Direct sum|cup;∪;Union|cap;∩;Intersection|land;∧;Logical and|lor;∨;Logical or|setminus;∖;Set difference|ldots;…;Horizontal dots|cdots;⋯;Centered dots|vdots;⋮;Vertical dots|ddots;⋱;Diagonal dots',
  ),
  ...[
    'sin',
    'cos',
    'tan',
    'cot',
    'sec',
    'csc',
    'sinh',
    'cosh',
    'tanh',
    'arcsin',
    'arccos',
    'arctan',
    'log',
    'ln',
    'exp',
    'min',
    'max',
    'sup',
    'inf',
    'det',
    'dim',
    'ker',
    'gcd',
  ].map((name) => ({ name, description: `${name} operator`, category: 'Functions' })),
  ...commands('Structure', [
    ['frac', 'Fraction', ['numerator', 'denominator'], '\\frac{a}{b}'],
    ['dfrac', 'Display fraction', ['numerator', 'denominator']],
    ['tfrac', 'Text fraction', ['numerator', 'denominator']],
    ['sqrt', 'Square root', ['radicand'], '\\sqrt{x}'],
    ['binom', 'Binomial coefficient', ['n', 'k']],
    ['overset', 'Place above', ['annotation', 'expression']],
    ['underset', 'Place below', ['annotation', 'expression']],
    ['overbrace', 'Overbrace', ['expression']],
    ['underbrace', 'Underbrace', ['expression']],
    ['text', 'Text inside mathematics', ['text']],
    ['operatorname', 'Named operator', ['name']],
    ['substack', 'Multiline subscript', ['first \\\\ second']],
  ]),
  ...commands(
    'Typography',
    [
      'mathbf',
      'mathrm',
      'mathit',
      'mathsf',
      'mathtt',
      'mathcal',
      'mathbb',
      'mathfrak',
      'hat',
      'widehat',
      'bar',
      'overline',
      'underline',
      'vec',
      'dot',
      'ddot',
      'tilde',
      'widetilde',
    ].map((name) => [name, `${name} notation`, ['expression']]),
  ),
  ...commands(
    'Typography',
    [['boldsymbol', 'Bold mathematical symbol', ['expression']]],
    'boldsymbol',
  ),
  ...[
    'sum',
    'prod',
    'coprod',
    'int',
    'iint',
    'iiint',
    'oint',
    'bigcup',
    'bigcap',
    'lim',
    'limsup',
    'liminf',
  ].map((name) => ({
    name,
    description: `${name} with limits`,
    category: 'Calculus',
    example: `\\${name}_{a}^{b}`,
    arguments: undefined,
  })),
  ...commands('Macros', [
    ['newcommand', 'Define a document-local command', ['\\name', 'expression']],
    ['renewcommand', 'Redefine a document-local command', ['\\name', 'expression']],
    ['DeclareMathOperator', 'Declare a named mathematical operator', ['\\name', 'operator']],
  ]),
  ...commands(
    'Advanced mathematics',
    [
      ['prescript', 'Left superscript and subscript', ['sup', 'sub', 'expression']],
      ['mathclap', 'Centered overlapping expression', ['expression']],
      ['underbracket', 'Bracket underneath', ['expression']],
      ['overbracket', 'Bracket above', ['expression']],
      ['DeclarePairedDelimiter', 'Define paired delimiters', ['\\name', 'left', 'right']],
      ['coloneqq', 'Defined to equal', []],
      ['xleftrightarrow', 'Annotated two-way arrow', ['label']],
    ],
    'mathtools',
  ),
  ...commands(
    'Cancellation',
    [
      ['cancel', 'Cancel expression', ['expression']],
      ['bcancel', 'Backslash cancellation', ['expression']],
      ['xcancel', 'Cross out expression', ['expression']],
      ['cancelto', 'Cancel toward a value', ['value', 'expression']],
    ],
    'cancel',
  ),
  ...commands(
    'Physics',
    [
      ['dv', 'Ordinary derivative', ['f', 'x'], '\\dv{f}{x}'],
      ['pdv', 'Partial derivative', ['f', 'x'], '\\pdv{f}{x}'],
      ['fdv', 'Functional derivative', ['F', 'f']],
      ['dd', 'Differential', ['x']],
      ['qty', 'Automatically sized quantity', ['expression']],
      ['pqty', 'Parenthesized quantity', ['expression']],
      ['abs', 'Absolute value', ['x']],
      ['norm', 'Norm', ['v']],
      ['vb', 'Bold vector', ['v']],
      ['va', 'Arrow vector', ['v']],
      ['vu', 'Unit vector', ['v']],
      ['grad', 'Gradient', ['f']],
      ['div', 'Divergence', ['F']],
      ['curl', 'Curl', ['F']],
      ['laplacian', 'Laplacian', ['f']],
      ['bra', 'Dirac bra', ['\\psi']],
      ['ket', 'Dirac ket', ['\\psi']],
      ['braket', 'Inner product', ['\\phi', '\\psi']],
      ['ketbra', 'Outer product', ['\\psi', '\\phi']],
      ['expval', 'Expectation value', ['A']],
      ['comm', 'Commutator', ['A', 'B']],
      ['acomm', 'Anticommutator', ['A', 'B']],
      ['mel', 'Matrix element', ['\\phi', 'A', '\\psi']],
      ['mqty', 'Matrix quantity', ['a & b \\\\ c & d']],
      ['tr', 'Trace', []],
      ['Tr', 'Trace', []],
      ['divsymbol', 'Division symbol', []],
    ],
    'physics',
  ).map((item) =>
    item.name === 'dv' || item.name === 'pdv' ? { ...item, optional: 'order' } : item,
  ),
  ...commands(
    'Chemistry',
    [['ce', 'Chemical formula or reaction', ['H2O'], '\\ce{2H2 + O2 -> 2H2O}']],
    'mhchem',
  ),
  ...commands(
    'Units',
    [
      ['units', 'Physical units', ['m/s'], '\\units[3]{m/s}'],
      ['unitfrac', 'Unit ratio', ['m', 's']],
      ['nicefrac', 'Slanted fraction', ['a', 'b']],
    ],
    'units',
  ),
  ...['upalpha', 'upbeta', 'upgamma', 'updelta', 'uppi', 'upmu', 'upomega'].map((name) => ({
    name,
    description: 'Upright Greek symbol',
    category: 'Greek',
    package: 'upgreek' as const,
  })),
  ...['degree', 'celsius', 'ohm', 'micro'].map((name) => ({
    name,
    description: 'Scientific symbol',
    category: 'Units',
    package: 'gensymb' as const,
  })),
];
export const mathEnvironments = [
  'aligned',
  'alignedat',
  'gathered',
  'split',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'cases',
  'array',
  'align',
  'align*',
  'gather',
  'gather*',
  'equation',
  'equation*',
  'multline',
  'multline*',
];
export function mathCommandSource(command: MathCommand) {
  return (
    command.example ||
    `\\${command.name}${(command.arguments || []).map((arg) => `{${arg}}`).join('')}`
  );
}
