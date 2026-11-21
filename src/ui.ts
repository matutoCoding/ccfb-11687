/** 极简 DOM 构造工具 */

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'className') {
      node.className = String(v);
    } else if (k === 'value') {
      (node as HTMLInputElement).value = String(v);
    } else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function numField(
  label: string, value: number, unit: string,
  onChange: (v: number) => void,
  opts: { step?: number; min?: number; max?: number } = {},
): HTMLElement {
  const input = el('input', {
    type: 'number', value: String(value),
    step: String(opts.step ?? 0.1),
    ...(opts.min !== undefined ? { min: String(opts.min) } : {}),
    ...(opts.max !== undefined ? { max: String(opts.max) } : {}),
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
    else input.value = String(value);
  });
  return el('div', { className: 'field' }, [
    el('label', {}, [label]),
    input,
    el('span', { className: 'unit' }, [unit]),
  ]);
}

export function textField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = el('input', { type: 'text', value });
  input.addEventListener('change', () => onChange(input.value));
  return el('div', { className: 'field' }, [el('label', {}, [label]), input, el('span', { className: 'unit' }, [''])]);
}

export function fmtNum(x: number, digits = 2): string {
  return x.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function fmtPct(x: number, digits = 2): string {
  return (x * 100).toFixed(digits) + '%';
}
