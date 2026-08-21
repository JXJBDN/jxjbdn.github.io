/* ============================================================
   全站动效引擎 —— 滚动显现 + 顶栏状态 + 回到顶部 + 竹简卷轴
   ------------------------------------------------------------
   设计原则（渐进增强）：
   · JS 没加载时一切照常显示，绝不会有内容被藏起来
   · 系统开了「减少动态效果」时自动关闭全部动画
   · 动画结束后把类摘掉，不干扰卡片自己的悬停效果
   ============================================================ */
(function () {
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 回到顶部按钮（朱砂圆钮） ---------- */
  var topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.className = 'fx-top';
  topBtn.setAttribute('aria-label', '回到顶部');
  topBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  topBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  document.body.appendChild(topBtn);

  /* ---------- 顶栏滚动状态 + 按钮显隐 ---------- */
  var header = document.querySelector('.site-header');
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    if (header) { header.classList.toggle('scrolled', y > 24); }
    topBtn.classList.toggle('show', y > 560);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 文章页开场帷幕 ----------
     从竹简点进来时：标题先立在屏幕中央，帘幕升起后
     正文以标题为中心依次绽放（配 style.css 的 .jd-curtain） */
  var curtainHold = 0;
  (function () {
    var art = document.querySelector('.article');
    if (!art) { return; }
    var h1 = art.querySelector('h1');
    var flag = '';
    try {
      flag = sessionStorage.getItem('jd_open') || '';
      sessionStorage.removeItem('jd_open');
    } catch (e) { flag = ''; }
    if (!h1 || !flag || reduce) { return; }
    curtainHold = 700;
    h1.classList.add('jd-hold');
    var cur = document.createElement('div');
    cur.className = 'jd-curtain';
    var sp = document.createElement('span');
    sp.textContent = h1.textContent.trim();
    cur.appendChild(sp);
    document.body.appendChild(cur);
    setTimeout(function () { cur.classList.add('lift'); }, 640);
    setTimeout(function () {
      if (cur.parentNode) { cur.parentNode.removeChild(cur); }
    }, 1900);
  })();

  /* ---------- 竹简卷轴 ----------
     每片竹简取竹简大图里不同的一段竖条做底纹，循环取用；
     日记再多也只是往右接长。 */
  (function () {
    var strips = document.querySelectorAll('.bamboo-strip');
    if (!strips.length) { return; }

    var IMG_W = 370, IMG_H = 135;   /* bamboo.png 实际尺寸 */
    var START = 0.14;               /* 跳过图片左侧卷起的部分 */
    var N = 11;                     /* 图上可用切出的竹片数 */

    function paint() {
      var h = strips[0].offsetHeight;
      if (!h) { return; }
      var scale = h / IMG_H;
      var imgW = IMG_W * scale;
      Array.prototype.forEach.call(strips, function (s, i) {
        var w = s.offsetWidth || 78;
        var f = START + ((i % N) + 0.5) / N * (1 - START);
        s.style.backgroundPosition = Math.round(w / 2 - f * imgW) + 'px center';
      });
    }
    paint();
    var tm;
    window.addEventListener('resize', function () {
      clearTimeout(tm);
      tm = setTimeout(paint, 150);
    });

    /* 点开一片竹简：全页渐隐，标题浮到屏幕中央，再翻进日记 */
    Array.prototype.forEach.call(strips, function (s) {
      if (s.tagName !== 'A') { return; }
      var href = s.getAttribute('href') || '';
      if (href.indexOf('posts/') !== 0) { return; }
      s.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 ||
            e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
        e.preventDefault();
        var t = '';
        var titleEl = s.querySelector('.bs-title');
        if (titleEl) { t = String(titleEl.textContent || '').trim(); }
        try { sessionStorage.setItem('jd_open', t); } catch (err) {}
        document.body.classList.add('bs-open');
        var veil = document.createElement('div');
        veil.className = 'bs-veil';
        var b = document.createElement('b');
        b.textContent = t;
        var i = document.createElement('i');
        i.textContent = '展开此简 …';
        veil.appendChild(b);
        veil.appendChild(i);
        document.body.appendChild(veil);
        setTimeout(function () { location.href = href; }, 540);
      });
    });

    /* 悬停竹片：卷心金字逐字浮现（触屏无悬停，自动跳过） */
    var spirit = document.querySelector('.bs-spirit');
    if (spirit && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      var hideTm;
      Array.prototype.forEach.call(strips, function (s) {
        if (s.classList.contains('bs-dashed')) { return; }
        s.addEventListener('mouseenter', function () {
          clearTimeout(hideTm);
          var t = String((s.querySelector('.bs-title') || {}).textContent || '').trim();
          if (!t) { return; }
          var pop = s.querySelector('.bs-pop');
          var sub = pop && pop.querySelector('p') ? String(pop.querySelector('p').textContent || '').trim() : '';
          var em = pop && pop.querySelector('em') ? String(pop.querySelector('em').textContent || '').trim() : '展开此简 →';
          spirit.innerHTML = '';
          var b = document.createElement('b');
          Array.prototype.forEach.call(t, function (ch, i) {
            var sp = document.createElement('span');
            sp.textContent = ch;
            sp.style.setProperty('--i', i);
            b.appendChild(sp);
          });
          spirit.appendChild(b);
          var tail = 0.35 + Math.min(t.length, 14) * 0.085;
          if (sub) {
            var p = document.createElement('p');
            p.className = 'sp-sub';
            p.textContent = sub.length > 66 ? sub.slice(0, 66) + '…' : sub;
            p.style.animationDelay = tail + 's';
            spirit.appendChild(p);
          }
          var o = document.createElement('span');
          o.className = 'sp-open';
          o.textContent = em;
          o.style.animationDelay = (tail + 0.14) + 's';
          spirit.appendChild(o);
          spirit.classList.add('show');
        });
        s.addEventListener('mouseleave', function () {
          clearTimeout(hideTm);
          hideTm = setTimeout(function () { spirit.classList.remove('show'); }, 140);
        });
      });
    }
  })();

  if (reduce || !('IntersectionObserver' in window)) { return; }

  /* ---------- 滚动显现 ---------- */
  var SELECTOR =
    '.page-hero, .profile, .about-section, ' +
    '.link-card, .photo-card, .editor-hero, .paper, .setup-card, ' +
    '.tag-mgr-card, .cmt-box, .bamboo-strip, .bs-roll, .bz-head, .article > *';

  function cleanup(el) {
    el.classList.remove('fx-prep', 'fx-in');
    el.style.transitionDelay = '';
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) { return; }
      var el = en.target;
      el.classList.add('fx-in');
      var d = parseInt(el.getAttribute('data-fx-delay') || '0', 10);
      /* 显现动画播完再摘掉类和延迟，交还给元素自己的悬停样式 */
      setTimeout(function () { cleanup(el); }, d + 900);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

  function prep(el) {
    if (el.classList.contains('fx-prep')) { return; }
    el.classList.add('fx-prep');
    /* 同一层级排第几个，就晚多少毫秒进场；竹简长卷里的元素步长更大，
       呈现「卷轴依次展开」的节奏（最多错开 720ms） */
    var idx = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
    var step = (el.closest && el.closest('.bs-track')) ? 90 : 55;
    var d = Math.min(idx, 8) * step + (el.closest && el.closest('.article') ? curtainHold : 0);
    el.setAttribute('data-fx-delay', d);
    el.style.transitionDelay = d + 'ms';
    io.observe(el);
  }

  Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), prep);

  /* 相册 / 友链的卡片是 JS 后画出来的，盯住 DOM 变化接着收 */
  var mo = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) {
        if (n.nodeType !== 1) { return; }
        if (n.matches && n.matches(SELECTOR)) { prep(n); }
        if (n.querySelectorAll) {
          Array.prototype.forEach.call(n.querySelectorAll(SELECTOR), prep);
        }
      });
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  /* 保险丝：3.5 秒后无论如何全部显示，绝不留白 */
  setTimeout(function () {
    Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), function (el) {
      el.classList.add('fx-in');
      cleanup(el);
    });
  }, 3500);
})();
