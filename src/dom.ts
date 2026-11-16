/** 极简 DOM 构建辅助 */
type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v as string;
    else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v !== undefined && v !== null) {
      (el as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function field(label: string, input: HTMLElement): HTMLLabelElement {
  return h('label', { class: 'field' }, [h('span', {}, [label]), input]);
}

export function numInput(value: number, step = 1, onInput?: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'number', step: String(step), value: String(value) });
  if (onInput) {
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (!Number.isNaN(v)) onInput(v);
    });
  }
  return input;
}

export function toast(message: string, duration = 2200): void {
  const el = h('div', { class: 'toast' }, [message]);
  document.body.append(el);
  setTimeout(() => el.remove(), duration);
}

export function download(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/** 数值映射到蓝-红热力色,0=绿(无遮挡) -> 1=深红 */
export function heatColor(v: number): string {
  const x = Math.max(0, Math.min(1, v));
  if (x < 0.5) {
    const t = x / 0.5;
    const r = Math.round(34 + t * (250 - 34));
    const g = Math.round(197 - t * (197 - 200));
    const b = Math.round(94 - t * 94);
    return `rgb(${r},${g},${b})`;
  }
  const t = (x - 0.5) / 0.5;
  const r = Math.round(250);
  const g = Math.round(200 - t * 160);
  const b = Math.round(0);
  return `rgb(${r},${g},${b})`;
}
