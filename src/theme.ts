/**
 * 全站样式层：移植自个人刊物的 editorial.css 设计令牌。
 * 方向：纸白墨黑、衬线标题 + 无衬线正文 + 等宽元数据、无阴影、细线分隔、
 * Miku 青只用于编号/链接/指示器的小面积强调。
 */
export const THEME_CSS = `
:root{
  --bg:#f7f4ee; --bg-alt:#f0ece4; --surface:#fffdf9;
  --text:#1a1815; --text-secondary:#6b6459; --border:#ded6c8; --rule:#cfc5b4;
  --primary:#39c5bb; --primary-dark:#0e948c; --accent:#0b7c74;
  --radius:0; --radius-l:2px;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC","Noto Serif SC","SimSun",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Mono",Consolas,"Liberation Mono","Courier New",monospace;
  --ed-max:1120px; --ed-measure:640px; --nav-h:60px; --gutter:clamp(20px,5vw,56px);
  --font-body:clamp(15px,1.05vw,16.5px); --font-nav:clamp(12.5px,1vw,13.5px);
  --font-brand:clamp(17px,1.6vw,20px); --font-h1:clamp(30px,5.2vw,56px);
  --font-h2:clamp(20px,2.4vw,28px); --font-small:clamp(11.5px,1vw,12.5px);
  --speed:.22s; --ease:cubic-bezier(.22,.61,.36,1);
}
[data-theme="dark"]{
  --bg:#131211; --bg-alt:#191715; --surface:#1b1917;
  --text:#ece6dc; --text-secondary:#a09889; --border:#3b352d; --rule:#4a4238;
  --primary:#39c5bb; --primary-dark:#2aaea5; --accent:#5fd6cd;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{
  background:var(--bg); color:var(--text); font:var(--font-body)/1.75 var(--sans);
  -webkit-font-smoothing:antialiased; transition:background var(--speed) var(--ease),color var(--speed) var(--ease);
}
a{color:inherit;text-decoration:none}

/* ---- 顶栏：细线，不投影 ---- */
.ed-header{position:fixed;inset:0 0 auto;z-index:20;height:var(--nav-h);background:var(--bg);border-bottom:1px solid var(--border)}
.ed-header.scroll-down{background:var(--bg-alt)}
.ed-nav{max-width:var(--ed-max);height:100%;margin:0 auto;padding:0 var(--gutter);display:flex;align-items:center;gap:18px}
.ed-brand{font:600 var(--font-brand)/1 var(--serif);letter-spacing:.02em}
.ed-links-nav{margin-left:auto;display:flex;gap:20px}
.ed-links-nav a{font:var(--font-nav)/1 var(--mono);color:var(--text-secondary);letter-spacing:.04em;transition:color var(--speed) var(--ease)}
.ed-links-nav a:hover,.ed-links-nav a[aria-current="page"]{color:var(--accent)}
.ed-theme{border:1px solid var(--border);background:transparent;color:var(--text-secondary);font:var(--font-nav)/1 var(--mono);padding:7px 10px;border-radius:var(--radius-l);cursor:pointer}
.ed-theme:hover{border-color:var(--accent);color:var(--accent)}
.ed-body{padding-top:calc(var(--nav-h) + 26px)}

/* ---- 刊头 ---- */
.ed-wrap{max-width:var(--ed-max);margin:0 auto;padding:0 var(--gutter) 72px}
.ed-masthead{padding:26px 0 30px;border-bottom:2px solid var(--text)}
.ed-kicker{font:var(--font-small)/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.ed-masthead h1{margin:14px 0 0;font:400 var(--font-h1)/1.16 var(--serif);letter-spacing:-.01em}
.ed-masthead h1 em{font-style:normal;color:var(--accent);border-bottom:3px solid var(--primary);padding-bottom:.06em}
.ed-lead{margin-top:16px;max-width:var(--ed-measure);color:var(--text-secondary)}
.ed-facts{display:flex;flex-wrap:wrap;gap:26px;margin-top:20px;font:var(--font-small)/1 var(--mono);color:var(--text-secondary);letter-spacing:.05em}
.ed-facts b{display:block;font:400 22px/1.1 var(--serif);color:var(--text);margin-bottom:5px}

/* ---- 分节 + 目录行 ---- */
.ed-section{padding-top:44px}
.ed-section-head{display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--rule);padding-bottom:9px;margin-bottom:4px}
.ed-caption{font:var(--font-small)/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.ed-section-head h2{font:400 var(--font-h2)/1.2 var(--serif)}
.ed-index{list-style:none}
.ed-index li+li{border-top:1px solid var(--border)}
.ed-entry{display:flex;align-items:flex-start;gap:16px;padding:17px 4px;transition:background var(--speed) var(--ease)}
.ed-entry:hover{background:var(--bg-alt)}
.ed-no{flex:0 0 auto;font:var(--font-small)/1.7 var(--mono);color:var(--accent);letter-spacing:.06em;padding-top:3px}
.ed-thumb{flex:0 0 auto;width:64px;height:86px;background:var(--bg-alt);border:1px solid var(--border);object-fit:cover;display:block}
.ed-main{flex:1 1 auto;min-width:0}
.ed-title{display:block;font:400 clamp(16px,1.35vw,19px)/1.45 var(--serif);word-break:break-word}
.ed-sum{display:block;margin-top:4px;font:var(--font-small)/1.7 var(--mono);color:var(--text-secondary);word-break:break-word}
.ed-right{flex:0 0 auto;text-align:right;font:var(--font-small)/1.7 var(--mono);color:var(--text-secondary)}
.ed-arrow{color:var(--accent);margin-left:8px}

/* ---- 阅读页 ---- */
.rd-bar{position:sticky;top:var(--nav-h);z-index:10;display:flex;gap:8px;overflow-x:auto;padding:10px var(--gutter);background:var(--bg);border-bottom:1px solid var(--border);white-space:nowrap;scrollbar-width:thin}
.rd-bar a{flex:0 0 auto;border:1px solid var(--border);border-radius:var(--radius-l);padding:5px 11px;font:var(--font-small)/1 var(--mono);color:var(--text-secondary)}
.rd-bar a.on{border-color:var(--accent);color:var(--accent);background:var(--surface)}
.rd-main{max-width:760px;margin:0 auto;padding:18px 6px 64px}
.rd-main img{display:block;width:100%;height:auto;background:var(--bg-alt);border:1px solid var(--border);margin-bottom:3px}
.rd-note{margin-top:26px;text-align:center;font:var(--font-small)/1.7 var(--mono);color:var(--text-secondary)}
.ed-foot{border-top:1px solid var(--border);padding:20px var(--gutter);text-align:center;font:var(--font-small)/1.7 var(--mono);color:var(--text-secondary)}
@media (max-width:640px){
  .ed-thumb{width:48px;height:64px}
  .ed-right{display:none}
}
`.trim();

/** 昼夜主题：与博客共用 localStorage 的 theme 键。 */
export const THEME_SCRIPT = `
(function(){
  var root=document.documentElement;
  function apply(t){root.setAttribute('data-theme',t||localStorage.getItem('theme')||'light');}
  apply();
  var btn=document.getElementById('themeBtn');
  if(btn)btn.addEventListener('click',function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    localStorage.setItem('theme',next);apply(next);
  });
  window.addEventListener('scroll',function(){
    var h=document.getElementById('headerBar');
    if(h)h.classList.toggle('scroll-down',window.scrollY>60);
  },{passive:true});
})();
`.trim();

export function header(title: string, current: 'home' | 'daily' | 'read'): string {
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="ed-header" id="headerBar"><div class="ed-nav">
<a class="ed-brand" href="/">${title}</a>
<nav class="ed-links-nav" aria-label="主导航">${link('/', '首页', 'home')}${link('/daily', '今日更新', 'daily')}</nav>
<button class="ed-theme" id="themeBtn" type="button" aria-label="切换昼夜模式">昼/夜</button>
</div></header>`;
}

export function doc(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f7f4ee">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>${THEME_CSS}</style>
</head>
<body>
${body}
<script>${THEME_SCRIPT}</script>
</body>
</html>`;
}
