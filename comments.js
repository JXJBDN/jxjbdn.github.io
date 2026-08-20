/* ============================================================
   评论区 —— 连接你的本地学习后端（backend-learn/server.js）
   ------------------------------------------------------------
   工作方式：
   · 每篇日记页引入这个文件，自动在文章底部生成评论区
   · 评论数据从后端的 /api/comments 拉取，发表走 /api/comment
   · 账号就是你后端里注册的用户（登录拿到 sid 通行证存在本机）
   · 后端没开机时，这里会安静地显示"评论区还在路上"
   以后后端部署到云上，把下面地址改成云地址，全员即可评论。
   ============================================================ */
var CMT_API = 'http://localhost:3456';

(function () {
  var anchor = document.querySelector('.article-footer-nav') || document.querySelector('.article');
  if (!anchor) { return; }
  var postFile = decodeURIComponent(location.pathname.split('/').pop()) || 'index.html';

  var who = null;
  try { who = JSON.parse(localStorage.getItem('jd_cmt_user') || 'null'); } catch (e) { who = null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function api(path, method, body, withSid) {
    var h = { 'Content-Type': 'application/json' };
    if (withSid && who && who.sid) { h['X-Session'] = who.sid; }
    return fetch(CMT_API + path, {
      method: method || 'GET',
      headers: h,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 界面骨架 ---------- */
  var box = document.createElement('section');
  box.className = 'cmt-box';
  box.innerHTML =
    '<div class="cmt-head">' +
    '  <span class="cmt-seal">评</span>' +
    '  <div class="cmt-headtxt"><h2 class="cmt-title">评论区</h2>' +
    '  <span class="cmt-sub">路过的人，留下两句话吧</span></div>' +
    '  <span class="cmt-count" id="cmtCount"></span>' +
    '</div>' +
    '<div class="cmt-list" id="cmtList"><span class="cmt-loading">评论加载中……</span></div>' +
    '<div class="cmt-form">' +
    '  <div class="cmt-userbar" id="cmtUserbar"></div>' +
    '  <div class="cmt-editor">' +
    '    <textarea id="cmtText" rows="3" maxlength="500" placeholder="说点什么……（500 字以内）"></textarea>' +
    '    <div class="cmt-actions"><span class="cmt-msg" id="cmtMsg"></span><span class="cmt-hint" id="cmtLen">0 / 500</span><button type="button" class="cmt-btn" id="cmtSend">发表评论</button></div>' +
    '  </div>' +
    '</div>' +
    '<p class="cmt-note">评论区连着站长的学习后端——后端开机时这里热闹，没开机时这里安静。</p>';
  anchor.parentNode.insertBefore(box, anchor);

  var list = box.querySelector('#cmtList');
  var count = box.querySelector('#cmtCount');
  var userbar = box.querySelector('#cmtUserbar');
  var msg = box.querySelector('#cmtMsg');
  var txt = box.querySelector('#cmtText');
  var lenHint = box.querySelector('#cmtLen');

  txt.addEventListener('input', function () {
    lenHint.textContent = txt.value.length + ' / 500';
  });

  /* ---------- 登录条：已登录显示身份，未登录显示迷你登录框 ---------- */
  function renderUserbar() {
    if (who && who.nick) {
      userbar.innerHTML =
        '<span class="cmt-avatar cmt-avatar-lg">' + esc(who.nick.charAt(0)) + '</span>' +
        '<div class="cmt-who"><b>' + esc(who.nick) + '</b><span class="cmt-hello">，来说两句</span></div>' +
        '<button type="button" class="cmt-logout" id="cmtLogout">退出</button>';
      userbar.querySelector('#cmtLogout').addEventListener('click', function () {
        api('/api/logout', 'POST', {}, true).catch(function () {});
        who = null;
        localStorage.removeItem('jd_cmt_user');
        renderUserbar();
      });
    } else {
      userbar.innerHTML =
        '<span class="cmt-hello cmt-login-tip">评论前先登录（账号在你后端注册，注册即自动登录）</span>' +
        '<div class="cmt-login-row">' +
        '<input type="text" id="cmtName" placeholder="用户名" autocomplete="username">' +
        '<input type="password" id="cmtPass" placeholder="密码" autocomplete="current-password">' +
        '<button type="button" class="cmt-btn cmt-btn-sm" id="cmtLogin">登录</button>' +
        '<button type="button" class="cmt-btn cmt-btn-ghost" id="cmtReg">注册</button>' +
        '</div>';
      userbar.querySelector('#cmtLogin').addEventListener('click', function () { doLogin(false); });
      userbar.querySelector('#cmtReg').addEventListener('click', function () { doLogin(true); });
    }
  }

  function doLogin(isReg) {
    var name = userbar.querySelector('#cmtName').value.trim();
    var pass = userbar.querySelector('#cmtPass').value;
    if (!name || !pass) { msg.textContent = '用户名和密码都要填'; return; }
    msg.textContent = isReg ? '正在注册……' : '正在登录……';

    var step = isReg
      ? api('/api/register', 'POST', { name: name, pass: pass }).then(function (j) {
          if (!j.ok) { throw new Error(j.msg); }
          msg.textContent = '注册成功，正在自动登录……';
          return api('/api/login', 'POST', { name: name, pass: pass });
        })
      : api('/api/login', 'POST', { name: name, pass: pass });

    step.then(function (j) {
      if (!j.ok) { throw new Error(j.msg); }
      who = { sid: j.sid, nick: j.user.nick, name: j.user.name };
      localStorage.setItem('jd_cmt_user', JSON.stringify(who));
      msg.textContent = '';
      renderUserbar();
    }).catch(function (e) {
      msg.textContent = e.message || '操作失败';
    });
  }

  /* ---------- 评论列表 ---------- */
  function renderList(items, offline) {
    list.innerHTML = '';
    if (offline) {
      list.innerHTML = '<p class="cmt-offline">评论区还在路上——站长的后端服务器现在没开机。</p>';
      count.textContent = '';
      return;
    }
    count.textContent = items.length ? items.length + ' 条' : '';
    if (!items.length) {
      list.innerHTML = '<p class="cmt-offline">还没有评论，坐个沙发？</p>';
      return;
    }
    items.forEach(function (c) {
      var item = document.createElement('div');
      item.className = 'cmt-item';
      item.innerHTML =
        '<span class="cmt-avatar">' + esc(String(c.nick || '友').charAt(0)) + '</span>' +
        '<div class="cmt-body"><div class="cmt-bubble">' +
        '<div class="cmt-head"><b>' + esc(c.nick) + '</b>' +
        '<span class="cmt-time">' + esc(c.created) + '</span></div>' +
        '<p class="cmt-text">' + esc(c.text).replace(/\n/g, '<br>') + '</p>' +
        '</div></div>';
      list.appendChild(item);
    });
  }

  function loadComments() {
    api('/api/comments?post=' + encodeURIComponent(postFile))
      .then(function (j) { renderList(j.comments || [], false); })
      .catch(function () { renderList([], true); });
  }

  /* ---------- 发表 ---------- */
  box.querySelector('#cmtSend').addEventListener('click', function () {
    var text = box.querySelector('#cmtText').value.trim();
    if (!who || !who.sid) { msg.textContent = '先在上方登录，才能发表评论'; return; }
    if (!text) { msg.textContent = '写点内容再发吧'; return; }
    msg.textContent = '正在发送……';
    api('/api/comment', 'POST', { post: postFile, text: text }, true).then(function (j) {
      if (!j.ok) { throw new Error(j.msg); }
      box.querySelector('#cmtText').value = '';
      msg.textContent = '';
      loadComments();
    }).catch(function (e) {
      msg.textContent = e.message || '发送失败（后端开机了吗？）';
    });
  });

  renderUserbar();
  loadComments();
})();
