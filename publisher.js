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

  /* 删除：同时清掉两个页面标签栏、卡片 data-tags 和卡片上的标签胶囊 */
  removeTag: function (tag) {
    var self = this;
    return this.get('index.html').then(function (g) {
      var tags = self.readTagBar(g.text);
      if (tags.indexOf(tag) === -1) { throw new Error('找不到标签 ' + tag); }
      tags.splice(tags.indexOf(tag), 1);
      return Promise.all([self.get('index.html'), self.get('blog.html')]).then(function (fs) {
        return Promise.all(fs.map(function (f, idx) {
          var h = f.text;
          h = self.replaceTagBar(h, tags);
          h = h.replace(/data-tags="([^"]*)"/g, function (mm, csv) {
            var list = csv.split(',').filter(function (t) { return t !== tag; });
            return 'data-tags="' + list.join(',') + '"';
          });
          h = h.replace(new RegExp('<span class="chip chip-soft">#' + self._reEsc(tag) + '</span>\\s*', 'g'), '');
          return self.put(idx === 0 ? 'index.html' : 'blog.html', h, '移除标签：' + tag);
        }));
      });
    });
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
      data.file = 'post-' + (max + 1) + '.html';
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
        return { src: img.path, title: data.title, wroteAt: data.wroteAt, post: data.file };
      });

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
    var firstPara = (d.content.split(/\n\s*\n/)[0] || '').trim();
    var excerpt = d.subtitle || firstPara.slice(0, 60);
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

    var imgByMarker = {};
    (d.images || []).forEach(function (img) { imgByMarker[img.marker] = img; });

    var blocks = [];
    d.content.split(/\n\s*\n/).forEach(function (raw) {
      var b = raw.trim();
      if (!b) { return; }
      var m = b.match(/^\[(图\d+)\]$/);
      if (m && imgByMarker[m[1]]) {
        blocks.push('    <figure class="post-img"><img src="' + imgByMarker[m[1]].path +
          '" alt="' + JD.esc(d.title) + '" loading="lazy"></figure>');
      } else {
        var txt = JD.esc(b).replace(/\[图\d+\]/g, '');
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
  '<link rel="icon" type="image/png" href="favicon.png">',
  '<link rel="stylesheet" href="style.css">',
  '</head>',
  '<body>',
  '',
  '<header class="site-header">',
  '  <div class="header-inner">',
  '    <a class="brand" href="index.html">',
  '      <span class="brand-mark"><img src="logo.jpg" alt="就像戒不掉你"></span>',
  '      <span class="brand-name">就像戒不掉你</span>',
  '    </a>',
  '    <nav class="main-nav">',
  '      <a href="index.html" class="nav-link">首页</a>',
  '      <a href="blog.html" class="nav-link">日记</a>',
  '      <a href="photos.html" class="nav-link">相册</a>',
  '      <span class="nav-link nav-off">留言板<span class="mini-badge">未开放</span></span>',
  '      <a href="about.html" class="nav-link">关于作者</a>',
  '    </nav>',
  '    <div class="header-actions">',
  '      <span class="search-off" title="搜索 · 未开放">',
  '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
  '      </span>',
  '      <a href="edit.html" class="btn-upload">＋ 上传日记</a>',
  '    </div>',
  '  </div>',
  '</header>',
  '',
  '<main>',
  '  <article class="article">',
  '    <a class="back-link" href="blog.html">← 返回日记</a>',
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
  '      <a href="blog.html">← 返回日记列表</a>',
  '      <a href="photos.html">看看相册 →</a>',
  '    </div>',
  '  </article>',
  '</main>',
  '',
  '<footer class="site-footer">',
  '  <p>暂无备案号等信息<span class="dot">·</span>住在 GitHub Pages<span class="dot">·</span>始于 2026.08.18</p>',
  '</footer>',
  '',
  '</body>',
  '</html>'
].join('\n');
