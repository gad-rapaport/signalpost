/**
 * Server-side HTML with escaping by default. `html` is a tagged template: interpolated values are escaped
 * unless they are themselves `html` fragments (or arrays of them), so user-controlled text can never become
 * markup by accident.
 */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

type Value = Html | string | number | boolean | null | undefined | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Html(out);
}

/** Trusted markup, for constants only (never for request data). */
export function raw(markup: string): Html {
  return new Html(markup);
}
