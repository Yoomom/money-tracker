import type { ReactNode } from 'react';

/** Tiny safe markdown: headings, bold/italic/code, bullet + numbered lists, tables, paragraphs. No HTML injection. */
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <strong key={i++}>{t.slice(2, -2)}</strong> : t.startsWith('`') ? <code key={i++}>{t.slice(1, -1)}</code> : <em key={i++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const nodes: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { nodes.push(<h4 key={k++}>{inline(h[2])}</h4>); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      nodes.push(
        <div key={k++} className="tablewrap"><table><thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, a) => <tr key={a}>{r.map((c, b) => <td key={b}>{inline(c)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)/.exec(l);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) { const m = /^\s*([-*•]|\d+[.)])\s+(.*)/.exec(lines[i]); if (!m) break; items.push(m[2]); i++; }
      const body = items.map((t, j) => <li key={j}>{inline(t)}</li>);
      nodes.push(ordered ? <ol key={k++}>{body}</ol> : <ul key={k++}>{body}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\|.*\|\s*$|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    nodes.push(<p key={k++}>{inline(para.join(' '))}</p>);
  }
  return <div className="md">{nodes}</div>;
}
