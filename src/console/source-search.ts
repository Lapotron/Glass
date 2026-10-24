import { t } from '../shared/i18n.js';
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view';
import {
  search,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
  selectMatches,
} from '@codemirror/search';

const matchCache = new WeakMap<
  EditorView,
  {
    doc: EditorView['state']['doc'];
    query: SearchQuery;
    limit: number;
    matches: { from: number; to: number }[];
  }
>();
export function sourceMatches(view: EditorView, limit = 2000) {
  const query = getSearchQuery(view.state),
    matches: { from: number; to: number }[] = [];
  const cached = matchCache.get(view);
  if (cached?.doc === view.state.doc && cached.limit === limit && cached.query.eq(query))
    return cached.matches;
  if (query.valid && query.search) {
    const cursor = query.getCursor(view.state);
    for (let item = cursor.next(); !item.done && matches.length < limit; item = cursor.next())
      matches.push(item.value);
  }
  matchCache.set(view, { doc: view.state.doc, query, limit, matches });
  return matches;
}
function sourceSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-search source-search';
  dom.setAttribute('role', 'search');
  dom.setAttribute('aria-label', t("Find in Markdown"));
  const fields = document.createElement('div');
  fields.className = 'source-search-fields';
  const controls = document.createElement('div');
  controls.className = 'source-search-options';
  const status = document.createElement('span');
  status.className = 'source-search-count';
  status.setAttribute('role', 'status');
  const input = (name: string, placeholder: string) => {
    const field = document.createElement('input');
    field.type = 'text';
    field.name = name;
    field.placeholder = placeholder;
    field.setAttribute('aria-label', placeholder);
    field.autocomplete = 'off';
    return field;
  };
  const find = input('search', 'Find in Markdown'),
    replace = input('replace', 'Replace with');
  find.setAttribute('main-field', 'true');
  const check = (name: string, label: string) => {
    const wrapper = document.createElement('label'),
      field = document.createElement('input');
    field.type = 'checkbox';
    field.name = name;
    field.setAttribute('aria-label', label);
    wrapper.append(field, document.createTextNode(label));
    controls.append(wrapper);
    return field;
  };
  const matchCase = check('case', 'Match case'),
    word = check('word', 'Whole word'),
    regex = check('regex', 'Regex'),
    selection = check('selection', 'In selection');
  const initial = view.state.selection.main;
  let scope = { from: initial.from, to: initial.to };
  selection.disabled = initial.empty;
  const button = (label: string, action: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'text-link';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  };
  const refresh = () => {
    const query = getSearchQuery(view.state),
      matches = sourceMatches(view),
      selected = view.state.selection.main;
    const index = matches.findIndex((m) => m.from === selected.from && m.to === selected.to);
    status.textContent = !query.search
      ? t("Type to find")
      : !query.valid
        ? t("Invalid regular expression")
        : matches.length
          ? t("{value0} of {value1}{value2}", {value0: index < 0 ? '—' : index + 1, value1: matches.length, value2: matches.length === 2000 ? '+' : ''})
          : t("No matches");
    find.setAttribute('aria-invalid', String(!!query.search && !query.valid));
    for (const action of [next, previous, all, replaceOne, replaceEvery])
      action.disabled = !query.valid || !matches.length;
  };
  const commit = () => {
    const query = new SearchQuery({
      search: find.value,
      replace: replace.value,
      caseSensitive: matchCase.checked,
      wholeWord: word.checked,
      regexp: regex.checked,
      test: selection.checked
        ? (_match, _state, from, to) => from >= scope.from && to <= scope.to
        : undefined,
    });
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    refresh();
  };
  const previous = button('Previous match', () => findPrevious(view));
  const next = button('Next match', () => findNext(view));
  const all = button('Select matches', () => {
    selectMatches(view);
    view.focus();
  });
  const replaceOne = button('Replace', () => replaceNext(view));
  const replaceEvery = button('Replace all', () => replaceAll(view));
  const close = button('Close find', () => {
    closeSearchPanel(view);
    view.focus();
  });
  close.classList.add('source-search-close');
  fields.append(find, previous, next, replace, replaceOne, replaceEvery);
  controls.append(all, status, close);
  dom.append(fields, controls);
  const sync = () => {
    const query = getSearchQuery(view.state);
    find.value = query.search;
    replace.value = query.replace;
    matchCase.checked = query.caseSensitive;
    word.checked = query.wholeWord;
    regex.checked = query.regexp;
  };
  sync();
  refresh();
  dom.addEventListener('input', commit);
  dom.addEventListener('change', commit);
  dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(view);
      view.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === replace) replaceNext(view);
      else (event.shiftKey ? findPrevious : findNext)(view);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      find.focus();
      find.select();
    }
  });
  return {
    dom,
    top: true,
    mount: () => {
      find.select();
    },
    update: (update: ViewUpdate) => {
      if (update.docChanged)
        scope = { from: update.changes.mapPos(scope.from), to: update.changes.mapPos(scope.to, 1) };
      if (update.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) sync();
      refresh();
    },
  };
}
export const sourceSearch = search({ top: true, createPanel: sourceSearchPanel });
