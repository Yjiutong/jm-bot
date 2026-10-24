import { doc, header } from './theme';

export function esc(text: string): string {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export interface ShelfEntry {
  album_id: string;
  title: string;
  author: string;
  href: string;
  cover: string;
}

export function renderHome(dailyHref: string, count: number, hours: number): string {
  const body = `${header('禁漫试读', 'home')}
<div class="ed-body"><main class="ed-wrap">
  <section class="ed-masthead">
    <p class="ed-kicker">JM Reader · 临时书架</p>
    <h1><span>今天更新的</span><em>${count} 本</em><span>在这里。</span></h1>
    <p class="ed-lead">在 QQ 群里 @机器人 发一个禁漫 JM 号，机器人回一条临时阅读链接；也可以直接发「今日更新」拿到当天最新书架。链接约 ${hours} 小时后失效，第二天书架自动清空。</p>
    <div class="ed-facts">
      <div><b>${count}</b><span>今日更新</span></div>
      <div><b>${hours}h</b><span>链接有效期</span></div>
      <div><b>R2</b><span>当天缓存</span></div>
    </div>
  </section>
  <section class="ed-section">
    <div class="ed-section-head"><span class="ed-caption">Shelf</span><h2>今日更新书架</h2></div>
    <ul class="ed-index"><li>
      <a class="ed-entry" href="${dailyHref}">
        <span class="ed-no">01</span>
        <span class="ed-main">
          <span class="ed-title">打开今日更新书架</span>
          <span class="ed-sum">按更新时间倒序，点封面行进入对应漫画的在线阅读页。</span>
        </span>
        <span class="ed-right">${count} 本<span class="ed-arrow">→</span></span>
      </a>
    </li></ul>
  </section>
</main>
<footer class="ed-foot">仅供个人技术研究与学习使用 · 内容版权归原作者与源站所有</footer>
</div>`;
  return doc('禁漫试读', body);
}

export interface ShelfTab {
  label: string;
  date: string;
  href: string;
  current: boolean;
}

export function renderShelf(date: string, entries: ShelfEntry[], hours: number, tabs: ShelfTab[]): string {
  const current = tabs.find((tab) => tab.current);
  const rows = entries
    .map(
      (item, i) => `<li>
      <a class="ed-entry" href="${item.href}">
        <span class="ed-no">${String(i + 1).padStart(2, '0')}</span>
        <img class="ed-thumb" src="${item.cover}" loading="lazy" decoding="async" alt="">
        <span class="ed-main">
          <span class="ed-title">${esc(item.title || item.album_id)}</span>
          <span class="ed-sum">${esc(item.author || 'N/A')} · ${item.album_id}</span>
        </span>
        <span class="ed-right">阅读<span class="ed-arrow">→</span></span>
      </a>
    </li>`,
    )
    .join('\n');

  const body = `${header('禁漫试读', 'daily')}
<div class="ed-body"><main class="ed-wrap">
  <section class="ed-masthead">
    <p class="ed-kicker">Daily Shelf · ${esc(date)}</p>
    <h1><span>${esc(current?.label ?? '今日更新')}</span><em>${entries.length} 本</em></h1>
    <p class="ed-lead">按源站更新时间倒序。书架每天重建一次，历史书架保留 ${tabs.length} 天（由 R2 生命周期规则清除）；单本阅读链接约 ${hours} 小时后失效。</p>
    <div class="ed-facts">
${tabs.map((tab) => `      <div><b><a href="${tab.href}"${tab.current ? ' style="color:var(--accent)"' : ''}>${esc(tab.label)}</a></b><span>${esc(tab.date)}</span></div>`).join('\n')}
    </div>
  </section>
  <section class="ed-section">
    <div class="ed-section-head"><span class="ed-caption">Index</span><h2>书架</h2></div>
    <ul class="ed-index">
${rows}
    </ul>
  </section>
</main>
<footer class="ed-foot">© 玖桐 · 托管于 Cloudflare Workers + R2</footer>
</div>`;
  return doc(`${current?.label ?? '更新书架'} · ${date}`, body);
}
