/* ============================================================
   分类书架：按标签把日记一格一格归好
   数据直接读页面上已有的竹简卡（标题/日期/标签/摘要），
   再异步取每篇文章的导语与首段充实封面、数一数配图；
   日记或标签增减后，书架在下次打开页面时自动重排。
   ============================================================ */
(function () {
  var host = document.getElementById('tagShelf');
  if (!host) { return; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* "2026.09.15 18:17" / "2026.08.18" → 可比较的数字 */
  function dateKey(s) {
    var m = String(s).match(/(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
    if (!m) { return 0; }
    return +(m[1] + m[2] + m[3] + (m[4] || '00') + (m[5] || '00'));
  }

  function cut(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '……' : s;
  }

  /* ---- 1. 从竹简卡收集日记 ---- */
  var posts = [];
  Array.prototype.forEach.call(
    document.querySelectorAll('.bamboo-strip:not(.bs-dashed)'),
    function (s) {
      var href = s.getAttribute('href');
      if (!href) { return; }
      var tags = (s.dataset.tags || '').split(',')
        .map(function (t) { return t.trim(); }).filter(Boolean);
      posts.push({
        href: href,
        date: (s.querySelector('.date-stamp') || {}).textContent || '',
        title: (s.querySelector('.bs-title') || {}).textContent || '',
        excerpt: (s.querySelector('.bs-pop p') || {}).textContent || '',
        tags: tags.length ? tags : ['未打标签'],
        key: 0
      });
    }
  );
  if (!posts.length) { return; }

  /* ---- 2. 按标签分组：组按组内最新一篇排序，组内按日期倒序 ---- */
  var groups = {}, latest = {};
  posts.forEach(function (p) {
    p.key = dateKey(p.date);
    p.tags.forEach(function (t) {
      (groups[t] = groups[t] || []).push(p);
      if (!latest[t] || p.key > latest[t]) { latest[t] = p.key; }
    });
  });
  var names = Object.keys(groups).sort(function (a, b) { return latest[b] - latest[a]; });
  names.forEach(function (t) {
    groups[t].sort(function (a, b) { return b.key - a.key; });
  });

  /* ---- 3. 画书架（摘要先用竹简卡自带的，兜底可见） ---- */
  host.innerHTML = names.map(function (t) {
    var cards = groups[t].map(function (p) {
      var chips = p.tags.map(function (x) {
        return '<span class="chip chip-soft">#' + esc(x) + '</span>';
      }).join('');
      return '<a class="shelf-card" data-file="' + esc(p.href) + '" href="' + esc(p.href) + '">' +
        '<span class="shelf-top"><span class="date-stamp">' + esc(p.date) + '</span></span>' +
        '<b class="shelf-ctitle">' + esc(p.title) + '</b>' +
        '<p class="shelf-excerpt">' + esc(p.excerpt || '点开看看这一篇 ·') + '</p>' +
        '<span class="shelf-foot">' + chips + '<em>展开此篇 →</em></span>' +
        '</a>';
    }).join('');
    return '<div class="shelf-group">' +
      '<div class="shelf-ghead"><b class="shelf-gtag">#' + esc(t) + '</b>' +
      '<span class="shelf-gcount">' + groups[t].length + ' 篇</span><i></i></div>' +
      '<div class="shelf-grid">' + cards + '</div></div>';
  }).join('');

  /* ---- 4. 异步取文章页：导语单独一行小字，摘要换正文首段，数一数配图 ---- */
  posts.forEach(function (p) {
    fetch(p.href).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var lead = doc.querySelector('.lead');
      var first = doc.querySelector('.body-text');
      var leadTxt = lead ? lead.textContent.replace(/\s+/g, ' ').trim() : '';
      var firstTxt = first ? first.textContent.replace(/\s+/g, ' ').trim() : '';
      var card = host.querySelector('.shelf-card[data-file="' + p.href + '"]');
      if (!card) { return; }
      var ex = card.querySelector('.shelf-excerpt');
      if (leadTxt && leadTxt !== firstTxt && ex) {
        var ld = document.createElement('p');
        ld.className = 'shelf-lead';
        ld.textContent = '『 ' + leadTxt + ' 』';
        ex.parentNode.insertBefore(ld, ex);
      }
      if (firstTxt && ex) { ex.textContent = cut(firstTxt, 92); }
      var imgs = doc.querySelectorAll('figure.post-img').length;
      var vids = doc.querySelectorAll('figure.post-video').length;
      if (imgs || vids) {
        var bits = [];
        if (imgs) { bits.push(imgs + ' 图'); }
        if (vids) { bits.push(vids + ' 视频'); }
        var b = document.createElement('span');
        b.className = 'shelf-media';
        b.textContent = bits.join(' · ');
        card.querySelector('.shelf-top').appendChild(b);
      }
    }).catch(function () { /* 取不到就保留竹简卡摘要 */ });
  });
})();
