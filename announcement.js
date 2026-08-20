/* ============================================================
   公告弹窗 —— 数据存在仓库的 announcement.json 里
   ------------------------------------------------------------
   行为：
   · 每个页面引入本文件；打开页面时自动找公告
   · 有公告 → 从顶部中间弹窗；只有点「×」才会关闭
   · 同一次浏览里同一条公告只弹一次（关浏览器重开、或发了
     新公告会再弹）；没发过公告（404）就什么都不发生
   ============================================================ */
(function () {
  var KEY = 'jd_ann_seen';

  function seenKey() {
    try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function markSeen(k) {
    try { sessionStorage.setItem(KEY, k); } catch (e) { /* 无痕模式等情况，忽略 */ }
  }

  /* 找 announcement.json：按所在页面位置挨个试 */
  function fetchAnn() {
    var list = [];
    if (/\/posts\//.test(location.pathname)) { list.push('../announcement.json'); }
    list.push('announcement.json');
    list.push('https://jxjbdn.github.io/announcement.json');
    var i = 0;
    function next() {
      if (i >= list.length) { return Promise.resolve(null); }
      var url = list[i++] + '?t=' + Date.now();
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) { throw new Error('no'); }
        return r.json();
      }).catch(function () { return next(); });
    }
    return next();
  }

  function build(ann) {
    var key = (ann.title || '') + '|' + (ann.updatedAt || '') + '|' + (ann.text || '').length;
    if (key === seenKey()) { return; }

    var pop = document.createElement('div');
    pop.className = 'ann-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '网站公告');

    var seal = document.createElement('div');
    seal.className = 'ann-seal';
    seal.textContent = '公';

    var body = document.createElement('div');
    body.className = 'ann-body';

    var head = document.createElement('div');
    head.className = 'ann-head';
    var t = document.createElement('span');
    t.className = 'ann-title';
    t.textContent = ann.title || '公告';
    head.appendChild(t);
    if (ann.updatedAt) {
      var tm = document.createElement('span');
      tm.className = 'ann-time';
      tm.textContent = ann.updatedAt;
      head.appendChild(tm);
    }

    var text = document.createElement('div');
    text.className = 'ann-text';
    String(ann.text || '').split(/\n+/).forEach(function (line) {
      line = line.trim();
      if (!line) { return; }
      var p = document.createElement('p');
      p.textContent = line;
      text.appendChild(p);
    });

    /* 只有这个按钮能关掉公告 */
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ann-close';
    close.title = '关闭公告';
    close.textContent = '×';
    close.addEventListener('click', function () {
      markSeen(key);
      pop.remove();
    });

    body.appendChild(head);
    body.appendChild(text);
    pop.appendChild(seal);
    pop.appendChild(body);
    pop.appendChild(close);
    document.body.appendChild(pop);
  }

  fetchAnn().then(function (ann) {
    if (ann && ann.text) { build(ann); }
  }).catch(function () { /* 静默失败，不影响页面 */ });
})();
