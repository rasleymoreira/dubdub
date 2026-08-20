/*
 * Construcao de DOM sem concatenar HTML.
 *
 * A versao anterior montava a interface com template string e um escapeHtml
 * manual chamado em cada interpolacao. Isso funciona ate alguem esquecer uma
 * chamada, e boa parte do texto vem de fora: titulo de aula lido da pagina da
 * Udemy, nome de voz vindo da API do provedor, mensagem de erro do servidor.
 *
 * Usando textContent e nos do DOM, o escape deixa de ser disciplina e passa a
 * ser propriedade da construcao: nao ha caminho em que um texto vire markup.
 */

type Attributes = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }

  node.append(...children);
  return node;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export interface SelectOption {
  readonly code: string;
  readonly label: string;
}

export function fillSelect(
  select: HTMLSelectElement,
  options: readonly SelectOption[],
  selected: string
): void {
  select.replaceChildren(
    ...options.map((option) => {
      const node = el('option', { value: option.code }, [option.label]);
      node.selected = String(option.code) === String(selected);
      return node;
    })
  );
}

export function fillDatalist(list: HTMLDataListElement, values: readonly string[]): void {
  list.replaceChildren(...values.map((value) => el('option', { value })));
}

/** Busca obrigatoria: um id ausente e erro de programacao, nao de runtime. */
export function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento ausente no popup: ${id}`);
  return node as T;
}

export function find<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
