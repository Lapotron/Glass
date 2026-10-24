# Pseudocode and code projects

Glass supports `pseudocode` fences, with `pseudo` and `algorithm` aliases. Pseudocode is authored data and is never executed. No full algorithm2e or algorithmicx LaTeX parser is implied.

````markdown
:::algorithm[Find the largest value]{#alg-maximum}
```pseudocode title="Maximum"
INPUT values
REQUIRE values is not empty
best ← values[0]
FOR each $x$ in values DO
  IF $x > best$ THEN
    best ← x
  END IF
END FOR
RETURN best
```
:::

See :ref[alg-maximum].
````

## Presentation

`style="algorithm"` is the default. It uses a dedicated academic serif family (Charter, Iowan Old Style, Palatino/Songti, then Georgia), a 95% reading scale, restrained control-word weights, accent-colored routine names, quieter labels/comments, source indentation and tabular line numbers. Operators and inline math use build-time MathJax SVG. An enclosing `:::algorithm` owns academic numbering and its explicit label; a fence does not create a second algorithm counter. Keep its `title` to a short useful caption or filename.

`style="code"` uses a conventional monospace code presentation and preserves `$...$` literally. Both styles share the compact filename toolbar, wrapping, exact source copying/download, line links, and paper styles. Use `showLineNumbers=false` to omit numbers or `wrap` to request initial wrapping. Published line numbers also follow the article code-line preference.

ASCII arrows and comparisons receive compact inline MathJax SVG in both presentations: `->` → `→`, `<-` → `←`, `<->` → `↔`, `=>` → `⇒`, `<=>` → `⇔`, `<=` → `≤`, `>=` → `≥`, and `!=`/`<>` → `≠`. Arithmetic, assignment and set/logical operators use the same mathematical family. Fixed compiler-owned TeX renders operators in an isolated document, without inheriting authored macro redefinitions. Repeated operators compile once per fence and reuse self-contained SVG (no shared font IDs or browser MathJax runtime). Strings, comments and math retain their own literal/TeX rules. This is a display transformation; Markdown and the copy/download payload stay exact. Source completion offers the corresponding symbol after a typed ASCII operator. To normalize authored notation deliberately, run **Beautify pseudocode operators** in the command palette; it changes only operators in the active fence, preserves literals and undoes in one step.

The recognized vocabulary includes `PROCEDURE`, `FUNCTION`, `ALGORITHM`, `INPUT`, `OUTPUT`, `REQUIRE`, `ENSURE`, `IF`, `THEN`, `ELSE`, `ELSEIF`, `END`, `FOR`, `EACH`, `IN`, `TO`, `DOWNTO`, `DO`, `WHILE`, `REPEAT`, `UNTIL`, `RETURN`, `YIELD`, `BREAK`, `CONTINUE`, `AND`, `OR`, `NOT`, and constants. Keywords are case-insensitive. Use spaces for indentation, `←`, `<-`, or `:=` for assignments, and `//` or `#` for comments. Quoted strings stay literal. Glass highlights this notation without trying to infer or execute an algorithm's meaning.

A block is limited to 2,000 lines and 64 KiB. Unknown styles and invalid embedded math fail validation. Split/Preview, static articles and printing use the production renderer. Source edit keeps pseudocode as highlighted text, including literal `$...$`, without inline rendered widgets or MathJax requests for its equations.

## Source editing

Type any alias after a backtick or tilde fence to complete its language, including an unfinished header at the end of a file. Metadata completion includes `title`, `style="algorithm|code"`, `wrap` and line-number settings. A complete header for an empty fence also offers **Quicksort scaffold**, preserving the existing alias, title, metadata and closing marker. An occupied fence is never replaced by this action.

Inside a pseudocode fence, completion offers case-insensitive keywords, assignment/comparison operators, common notation such as `length` and `SWAP`, and local procedure/function names, parameters and assigned variables. Strings, comments, math source and other fences are excluded. These built-ins describe notation; they do not establish an execution environment. Automatic suggestions follow **Suggest while typing**; explicit suggestions use the configured **Complete at cursor** shortcut.

Accept the procedure, function, if/else, for/foreach, while/repeat, assignment, swap or Quicksort snippets to insert a complete pattern. Tab and Shift+Tab traverse linked fields. Insertions respect configured indentation, retain source-owned line numbers and undo in one step. Matching END statements are inserted only by accepted snippets; ordinary Enter and typing do not scaffold blocks.

The active fence has cached, bounded local-symbol and block indexes. Subtle source indentation guides and token-only matching emphasize recognized nested blocks. Complete blocks fold through the normal gutter/commands. **Jump to matching pseudocode block** in the command palette moves between recognized opening/closing tokens. Comments, strings and math cannot create fake blocks; unfamiliar notation remains editable without semantic diagnostics. Oversized fences retain basic highlighting and keyword/snippet suggestions while bounded indexing is unavailable.

`/algorithm`, directive completion and Insert component share the same numbered Quicksort example, with a fresh `#alg-quicksort-…` label at insertion. It uses zero-based indexing and inclusive bounds, a `lo < hi` guard, Lomuto partition and `QUICKSORT(A, 0, length(A) - 1)`. Empty and single-element arrays need no special call-site case. The in-fence `quicksort` snippet inserts only its body, without another fence or directive. Ready-to-paste source patterns are in the [generated reference](markdown-reference.md#pseudocode-source-snippets); the capability catalog and portable authoring pack use the same shared examples.

Existing version-1 editor preferences retain their key and all unrelated settings. A legacy `componentPreviews.pseudocode` value is ignored and the corresponding toggle is removed. The private component-preview API still accepts the legacy pseudocode kind for older clients; current source edit never schedules it.

## JS/TS language intelligence

All recognized fenced languages receive syntax highlighting loaded on demand. JS/TS additionally use a private, lazy TypeScript language-service worker with ES2022/browser declarations. Snippets are never executed. External package declarations are not downloaded; imports outside the article remain unresolved unless the author supplies a virtual declaration file.

Blocks are independent by default. To share definitions and relative imports, explicitly use the same `project` and distinct relative filenames in `title`:

````markdown
```typescript title="geometry.ts" project="example"
export const square = (x: number) => x * x;
```

```typescript title="main.ts" project="example"
import { square } from './geometry';
const area = square(3);
```
````

Titles used as virtual files must be relative JS/TS filenames without traversal. A repeated filename in one project produces a diagnostic. `check="off"` disables diagnostics for intentionally incomplete examples without removing syntax highlighting. The language service provides completion, hover, argument hints, definition/reference navigation, rename, and available TypeScript fixes. F12 goes to definitions, Shift+F12 finds references, F2 renames, and Cmd/Ctrl+. shows code actions. The same commands appear in the palette.

Rename/fix operations can edit multiple fences in one article, but cannot write a real project file, an external package, or another article. They reject edits made after their captured source and preserve one-step undo. A stopped language worker leaves the source, syntax highlighting, saving, and Markdown assistance available. Use Retry language intelligence in the palette or diagnostic action to reconnect without remounting the source.

On large documents, diagnostics follow the active viewport and keep results already checked. Use **Check all JS/TS code blocks** in the editor palette for a complete pass. Standard-library syntax trees are shared between virtual projects; only a bounded set of semantic services remains active.
