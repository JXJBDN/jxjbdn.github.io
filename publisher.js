/* ============================================================
   网站发布器 —— 把 GitHub 仓库当作后端
   数据流：浏览器 → fetch() → api.github.com（后端服务器）
         → 验证 Bearer 令牌 → 写入 git 仓库（数据库）
         → GitHub Pages 自动重新构建（部署）
   ============================================================ */

var JD = {
  owner: localStorage.getItem('jd_owner') || 'jxjbdn',
  repo: localStorage.getItem('jd_repo') || 'jxjbdn.github.io',
  token: localStorage.getItem('jd_token') || '',

  configured: function () { return !!this.token; },

  save: function (owner, repo, token) {
    this.owner = owner; this.repo = repo; this.token = token;
    localStorage.setItem('jd_owner', owner);
    localStorage.setItem('jd_repo', repo);
    localStorage.setItem('jd_token', token);
  },

  clear: function () {
    localStorage.removeItem('jd_token');
    this.token = '';
  },

  _url: function (path) {
    return 'https://api.github.com/repos/' + this.owner + '/' + this.repo + '/contents/' + encodeURI(path);
  },

  _headers: function (extra) {
    var h = { 'Authorization': 'Bearer ' + this.token, 'Accept': 'application/vnd.github+json' };
    if (extra) { for (var k in extra) { h[k] = extra[k]; } }
    return h;
  },

  /* GET：读仓库里的文件（拿内容和版本号 sha） */
  get: function (path) {
    var self = this;
    return fetch(this._url(path) + '?t=' + Date.now(), { headers: this._headers(), cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) { var e = new Error('文件不存在'); e.notFound = true; throw e; }
        if (r.status === 401) { throw new Error('令牌无效或已过期，请到编辑页重新设置'); }
        if (!r.ok) { throw new Error('读取 ' + path + ' 失败（' + r.status + '）'); }
        return r.json();
      })
      .then(function (j) {
        var bin = atob(j.content.replace(/\n/g, ''));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
        return { sha: j.sha, text: new TextDecoder('utf-8').decode(bytes) };
      });
  },

  _textToB64: function (text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  },

  /* PUT：提交文件回仓库。isB64 时 content 传 dataURL（用于图片） */
  put: function (path, content, message, isB64) {
    var self = this;
    return this.get(path).then(function (g) { return g.sha; })
      .catch(function (e) { if (e.notFound) { return null; } throw e; })
      .then(function (sha) {
        var b64 = isB64 ? content.split(',')[1] : self._textToB64(content);
        var body = { message: message, content: b64, branch: 'main' };
        if (sha) { body.sha = sha; }
        return fetch(self._url(path), {
          method: 'PUT',
          headers: self._headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body)
        }).then(function (r) {
          if (!r.ok) {
            return r.json().then(function (j) {
              throw new Error('提交 ' + path + ' 失败：' + (j.message || r.status));
            });
          }
          return r.json();
        });
      });
  },

  /* ---------- 标签 ---------- */

  /* 从首页标签栏同步现有标签 */
  fetchTags: function () {
    return this.get('index.html').then(function (g) {
      return JD.readTagBar(g.text);
    });
  },

  readTagBar: function (html) {
    var bar = html.match(/<div class="tag-bar">[\s\S]*?<\/div>/);
    var tags = [];
    if (bar) {
      var re = /data-filter="([^"]+)"/g, m;
      while ((m = re.exec(bar[0]))) {
        if (m[1] !== '全部') { tags.push(m[1]); }
      }
    }
    return tags;
  },

  buildTagBar: function (tags) {
    var lines = ['<div class="tag-bar">',
      '      <button class="tag active" data-filter="全部">全部</button>'];
    tags.forEach(function (t) {
      lines.push('      <button class="tag" data-filter="' + t + '">' + t + '</button>');
    });
    lines.push('      <button class="tag tag-add" id="addTagBtn" type="button" title="新增分类标签">＋</button>');
    lines.push('    </div>');
    return lines.join('\n');
  },

  replaceTagBar: function (html, tags) {
    return html.replace(/<div class="tag-bar">[\s\S]*?<\/div>/, this.buildTagBar(tags));
  },

  /* 「＋」按钮：往首页和日记页的标签栏末尾插入新标签 */
  addTag: function (rawName) {
    var self = this;
    var name = String(rawName || '').trim().replace(/[<>"'\\]/g, '');
    if (!name) { return Promise.reject(new Error('标签名不能为空')); }
    return this.get('index.html').then(function (g) {
      var tags = self.readTagBar(g.text);
      if (tags.indexOf(name) > -1) { throw new Error('这个标签已经存在啦'); }
      tags.push(name);
      return self._writeTagBars(tags, '新增标签：' + name);
    }).then(function () { return name; });
  },

  /* 排序：dir = -1 上移一位，+1 下移一位 */
  moveTag: function (tag, dir) {
    var self = this;
    return this.get('index.html').then(function (g) {
      var tags = self.readTagBar(g.text);
      var i = tags.indexOf(tag);
      if (i === -1) { throw new Error('找不到标签 ' + tag); }
      var j = i + dir;
      if (j < 0 || j >= tags.length) { throw new Error('已经在最边上啦'); }
      tags.splice(j, 0, tags.splice(i, 1)[0]);
      return self._writeTagBars(tags, '调整标签顺序：' + tag);
    });
  },

  /* 删除：清掉两个页面标签栏和卡片引用；一个标签不剩的卡片自动落入「待定」 */
  removeTag: function (tag) {
    var self = this;
    if (tag === '待定') { return Promise.reject(new Error('「待定」是兜底标签，不能删除')); }
    return this.get('index.html').then(function (g) {
      var tags = self.readTagBar(g.text);
      if (tags.indexOf(tag) === -1) { throw new Error('找不到标签 ' + tag); }
      tags.splice(tags.indexOf(tag), 1);
      return Promise.all([self.get('index.html'), self.get('blog.html')]).then(function (fs) {
        return Promise.all(fs.map(function (f, idx) {
          var h = self._stripTag(f.text, tag, tags);
          return self.put(idx === 0 ? 'index.html' : 'blog.html', h, '移除标签：' + tag);
        }));
      });
    });
  },

  /* 从一个页面里移除标签：标签栏、卡片 data-tags、卡片胶囊；空卡片 → 待定 */
  _stripTag: function (html, tag, barTags) {
    var self = this;
    var needPending = false;

    html = html.replace(/(<a class="card-item[^"]*"[^>]*data-tags=")([^"]*)("[^>]*>)/g, function (m, pre, csv, post) {
      if (csv.indexOf(tag) === -1) { return m; }
      var list = csv.split(',').filter(function (t) { return t && t !== tag; });
      if (!list.length) { list = ['待定']; needPending = true; }
      return pre + list.join(',') + post;
    });

    html = html.replace(new RegExp('<span class="chip chip-soft">#' + self._reEsc(tag) + '</span>\\s*', 'g'), '');

    /* 落入待定的卡片补回一枚 #待定 胶囊 */
    html = html.replace(/(<a class="card-item[^"]*"[^>]*data-tags="待定"[^>]*>\s*<div class="card-head">\s*<span class="date-stamp">[^<]*<\/span>)\s*/g,
      '$1\n          <span class="chip chip-soft">#待定</span>\n        ');

    var newBar = barTags.slice();
    if (needPending && newBar.indexOf('待定') === -1) { newBar.push('待定'); }
    return this.replaceTagBar(html, newBar);
  },

  _writeTagBars: function (tags, msg) {
    var self = this;
    return Promise.all([this.get('index.html'), this.get('blog.html')]).then(function (fs) {
      return Promise.all([
        self.put('index.html', self.replaceTagBar(fs[0].text, tags), msg),
        self.put('blog.html', self.replaceTagBar(fs[1].text, tags), msg)
      ]);
    });
  },

  _reEsc: function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /* ---------- 日记管理 ---------- */

  /* 列出所有日记卡片（从日记页解析） */
  listPosts: function () {
    return this.get('blog.html').then(function (g) {
      var posts = [];
      var re = /<a class="card-item[^"]*"([^>]*)>([\s\S]*?)<\/a>/g, m;
      while ((m = re.exec(g.text))) {
        var href = (m[1].match(/href="([^"]+)"/) || [])[1];
        var tagsCsv = (m[1].match(/data-tags="([^"]*)"/) || [])[1] || '';
        var title = ((m[2].match(/<h3 class="card-title">([^<]*)<\/h3>/) || [])[1] || '').trim();
        var date = ((m[2].match(/<span class="date-stamp">([^<]*)<\/span>/) || [])[1] || '').trim();
        if (href && /\.html$/.test(href) && title) {
          posts.push({ file: href, title: title, date: date, tags: tagsCsv.split(',').filter(Boolean) });
        }
      }
      return posts;
    });
  },

  /* 修改一篇日记的标签：同步首页卡片、日记页卡片、文章页胶囊 */
  updatePostTags: function (file, rawTags) {
    var self = this;
    var tags = (rawTags || []).map(function (t) {
      return String(t).trim().replace(/[<>"'\\]/g, '');
    }).filter(Boolean);
    if (!tags.length) { return Promise.reject(new Error('至少保留一个标签')); }

    return Promise.all([this.get('index.html'), this.get('blog.html')]).then(function (fs) {
      var updated = fs.map(function (f) {
        var h = self._setCardTags(f.text, file, tags);
        if (h === null) { throw new Error('页面里找不到 ' + file + ' 的卡片'); }
        tags.forEach(function (t) { h = self.ensureTag(h, t); });
        return h;
      });
      return Promise.all([
        self.put('index.html', updated[0], '更新日记标签：' + file),
        self.put('blog.html', updated[1], '更新日记标签：' + file)
      ]);
    }).then(function () {
      return self.get(file).catch(function (e) {
        if (e.notFound) { return null; }
        throw e;
      });
    }).then(function (pf) {
      if (!pf) { return null; }
      var chips = tags.map(function (t) {
        return '<span class="chip chip-soft">#' + JD.esc(t) + '</span>';
      }).join('\n      ');
      var page = pf.text.replace(/<div class="article-meta">[\s\S]*?<\/div>/, function (mm) {
        var date = ((mm.match(/<span class="date-stamp">([^<]*)<\/span>/) || [])[1] || '').trim();
        return '<div class="article-meta">\n      <span class="date-stamp">' + date + '</span>\n      ' +
          chips + '\n    </div>';
      });
      if (page === pf.text) { return null; }
      return self.put(file, page, '更新日记标签：' + file);
    });
  },

  /* 替换某张卡片的 data-tags 和胶囊（找不到卡片返回 null） */
  _setCardTags: function (html, file, tags) {
    var re = new RegExp('(<a class="card-item[^"]*"[^>]*href="' + this._reEsc(file) + '"[^>]*>)([\\s\\S]*?)(</a>)');
    var m = html.match(re);
    if (!m) { return null; }
    var head = m[1].replace(/data-tags="[^"]*"/, 'data-tags="' + tags.join(',') + '"');
    var chip = '<span class="chip chip-soft">#' + JD.esc(tags[0]) + '</span>';
    var body;
    if (m[2].indexOf('chip chip-soft') > -1) {
      body = m[2].replace(/<span class="chip chip-soft">#[^<]*<\/span>/, chip);
    } else {
      body = m[2].replace(/(<div class="card-head">\s*<span class="date-stamp">[^<]*<\/span>)/,
        '$1\n          ' + chip);
    }
    if (head === m[1] && m[1].indexOf('data-tags') === -1) { return null; }
    return html.replace(re, head + body + m[3]);
  },

  /* ---------- 相册 ---------- */

  /* newItems: [{src, title, wroteAt, post}] 新照片插到最前 */
  updateGallery: function (newItems) {
    var self = this;
    return this.get('gallery.json').catch(function (e) {
      if (e.notFound) { return { sha: null, text: '{\n  "items": []\n}' }; }
      throw e;
    }).then(function (g) {
      var obj;
      try { obj = JSON.parse(g.text); } catch (err) { obj = {}; }
      if (!Array.isArray(obj.items)) { obj.items = []; }
      newItems.forEach(function (it) { obj.items.unshift(it); });
      return self.put('gallery.json', JSON.stringify(obj, null, 2) + '\n', '相册更新：+' + newItems.length + ' 张');
    });
  },

  /* ---------- 友链 ---------- */

  /* links.json 不存在（还没加过友链）就当空列表 */
  fetchLinks: function () {
    return this.get('links.json').then(function (g) {
      var obj; try { obj = JSON.parse(g.text); } catch (e) { obj = {}; }
      return Array.isArray(obj.items) ? obj.items : [];
    }).catch(function (e) {
      if (e.notFound) { return []; }
      throw e;
    });
  },

  addLink: function (raw) {
    var self = this;
    var name = String(raw.name || '').trim().replace(/[<>"\\]/g, '');
    var url = String(raw.url || '').trim();
    var desc = String(raw.desc || '').trim().replace(/[<>"\\]/g, '');
    if (!name || !url) { return Promise.reject(new Error('昵称和网址都要填')); }
    if (!/^https?:\/\//.test(url)) { url = 'https://' + url; }
    return this.fetchLinks().then(function (items) {
      if (items.some(function (it) { return it.url === url; })) {
        throw new Error('这个网址已经加过啦');
      }
      items.unshift({ name: name, url: url, desc: desc });
      return self.put('links.json', JSON.stringify({ items: items }, null, 2) + '\n', '友链新增：' + name);
    });
  },

  removeLink: function (url) {
    var self = this;
    return this.fetchLinks().then(function (items) {
      var left = items.filter(function (it) { return it.url !== url; });
      if (left.length === items.length) { throw new Error('没有找到这条友链'); }
      return self.put('links.json', JSON.stringify({ items: left }, null, 2) + '\n', '友链移除');
    });
  },

  /* ---------- 发布日记 ---------- */

  publishPost: function (data) {
    var self = this;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var now = new Date();
    data.date = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate());
    data.time = pad(now.getHours()) + ':' + pad(now.getMinutes());
    data.wroteAt = data.date + ' ' + data.time;

    var blogText = '';

    return this.get('blog.html').then(function (g) {
      blogText = g.text;
      var re = /post-(\d+)\.html/g, m, max = 1;
      while ((m = re.exec(blogText))) { max = Math.max(max, parseInt(m[1], 10)); }
      data.file = 'posts/post-' + (max + 1) + '.html';
      return self.get('index.html');
    }).then(function (g) {
      var newIndex = g.text;
      var newBlog = blogText;

      data.tags.forEach(function (t) {
        newIndex = self.ensureTag(newIndex, t);
        newBlog = self.ensureTag(newBlog, t);
      });

      var card = self.buildCard(data);
      newIndex = newIndex.replace('<section class="cards">',
        '<section class="cards">\n\n      ' + card + '\n');
      newBlog = newBlog.replace('<section class="cards">',
        '<section class="cards">\n\n      ' + card + '\n');

      newBlog = newBlog.replace(/目前共 (\d+) 篇/, function (s, num) {
        return '目前共 ' + (parseInt(num, 10) + 1) + ' 篇';
      });

      var galleryOps = (data.images || []).map(function (img) {
        return { src: img.path, type: 'image', title: data.title, wroteAt: data.wroteAt, post: data.file };
      }).concat((data.videos || []).map(function (v) {
        return { src: v.path, type: 'video', title: data.title, wroteAt: data.wroteAt, post: data.file };
      }));

      return self.put(data.file, self.buildPostPage(data), '新增日记：' + data.title)
        .then(function () { return self.put('index.html', newIndex, '首页更新：' + data.title); })
        .then(function () { return self.put('blog.html', newBlog, '日记页更新：' + data.title); })
        .then(function () {
          if (!galleryOps.length) { return null; }
          return self.updateGallery(galleryOps);
        });
    }).then(function () { return data; });
  },

  ensureTag: function (html, tag) {
    if (html.indexOf('data-filter="' + tag + '"') > -1) { return html; }
    var anchor = '<button class="tag tag-add"';
    if (html.indexOf(anchor) === -1) { return html; }
    return html.replace(anchor,
      '<button class="tag" data-filter="' + tag + '">' + tag + '</button>\n      ' + anchor);
  },

  esc: function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  buildCard: function (d) {
    var firstPara = (d.content.split(/\n\s*\n/)[0] || '').trim().replace(/\[(图|视频)\d+\]/g, '');
    var excerpt = d.subtitle || firstPara.slice(0, 60) || '一篇新日记';
    return '<a class="card-item" data-tags="' + d.tags.join(',') + '" href="' + d.file + '">\n' +
      '        <div class="card-head">\n' +
      '          <span class="date-stamp">' + d.date + ' ' + d.time + '</span>\n' +
      '          <span class="chip chip-soft">#' + this.esc(d.tags[0]) + '</span>\n' +
      '        </div>\n' +
      '        <h3 class="card-title">' + this.esc(d.title) + '</h3>\n' +
      '        <p class="card-excerpt">' + this.esc(excerpt) + '</p>\n' +
      '        <span class="read-more">阅读全文 →</span>\n' +
      '      </a>';
  },

  buildPostPage: function (d) {
    var chips = d.tags.map(function (t) {
      return '<span class="chip chip-soft">#' + JD.esc(t) + '</span>';
    }).join('\n    ');

    var mediaByMarker = {};
    (d.images || []).forEach(function (img) { mediaByMarker[img.marker] = { path: img.path, kind: 'image' }; });
    (d.videos || []).forEach(function (v) { mediaByMarker[v.marker] = { path: v.path, kind: 'video' }; });

    var blocks = [];
    d.content.split(/\n\s*\n/).forEach(function (raw) {
      var b = raw.trim();
      if (!b) { return; }
      var m = b.match(/^\[(图|视频)\d+\]$/);
      if (m && mediaByMarker[m[0].slice(1, -1)]) {
        var md = mediaByMarker[m[0].slice(1, -1)];
        if (md.kind === 'video') {
          blocks.push('    <figure class="post-video"><video src="../' + md.path +
            '" controls preload="metadata" playsinline></video></figure>');
        } else {
          blocks.push('    <figure class="post-img"><img src="../' + md.path +
            '" alt="' + JD.esc(d.title) + '" loading="lazy"></figure>');
        }
      } else {
        var txt = JD.esc(b).replace(/\[(图|视频)\d+\]/g, '');
        if (txt) { blocks.push('    <p class="body-text">' + txt + '</p>'); }
      }
    });
    var paras = blocks.join('\n\n');

    var lead = d.subtitle ? '\n    <p class="lead">' + this.esc(d.subtitle) + '</p>' : '';

    return POST_TEMPLATE
      .replace(/\{TITLE\}/g, this.esc(d.title))
      .replace(/\{DATE\}/g, d.date + ' ' + d.time)
      .replace(/\{CHIPS\}/g, chips)
      .replace(/\{LEAD\}/g, lead)
      .replace(/\{PARAGRAPHS\}/g, paras)
      .replace(/\{WROTEAT\}/g, d.wroteAt);
  }
};

/* 新文章页模板：与现有 post-1.html 同款结构 */
var POST_TEMPLATE = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<title>{TITLE} · 就像戒不掉你</title>',
  '<link rel="icon" type="image/png" href="../favicon.png">',
  '<link rel="stylesheet" href="../style.css">',
  '</head>',
  '<body>',
  '',
  '<header class="site-header">',
  '  <div class="header-inner">',
  '    <a class="brand" href="../index.html">',
  '      <span class="brand-mark"><img src="../logo.jpg" alt="就像戒不掉你"></span>',
  '      <span class="brand-name">就像戒不掉你</span>',
  '    </a>',
  '    <nav class="main-nav">',
  '      <a href="../index.html" class="nav-link">首页</a>',
  '      <a href="../blog.html" class="nav-link">日记</a>',
  '      <a href="../photos.html" class="nav-link">相册</a>',
  '      <span class="nav-link nav-off">留言板<span class="mini-badge">未开放</span></span>',
  '      <a href="../links.html" class="nav-link">友链</a>',
  '      <a href="../about.html" class="nav-link">关于作者</a>',
  '    </nav>',
  '    <div class="header-actions">',
  '      <span class="search-off" title="搜索 · 未开放">',
  '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
  '      </span>',
  '      <a href="../edit.html" class="btn-upload">＋ 上传日记</a>',
  '    </div>',
  '  </div>',
  '</header>',
  '',
  '<main>',
  '  <article class="article">',
  '    <a class="back-link" href="../blog.html">← 返回日记</a>',
  '    <div class="article-meta">',
  '      <span class="date-stamp">{DATE}</span>',
  '      {CHIPS}',
  '    </div>',
  '    <h1>{TITLE}</h1>{LEAD}',
  '',
  '{PARAGRAPHS}',
  '',
  '    <p class="end-mark">· 完 ·</p>',
  '    <p class="post-time">写于 {WROTEAT}</p>',
  '    <div class="article-footer-nav">',
  '      <a href="../blog.html">← 返回日记列表</a>',
  '      <a href="../photos.html">看看相册 →</a>',
  '    </div>',
  '  </article>',
  '</main>',
  '',
  '<footer class="site-footer">',
  '  <p>暂无备案号等信息<span class="dot">·</span>住在 GitHub Pages<span class="dot">·</span>始于 2026.08.18</p>',
  '</footer>',
  '',
  '<script src="../comments.js"></script>',
  '',
  '</body>',
  '</html>'
].join('\n');
