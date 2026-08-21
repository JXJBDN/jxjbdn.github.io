/* ============================================================
   首屏书法 3D 剧场 —— 「戒不掉」模型（calligraphy.glb）
   水墨山水中悬浮的书法 + 墨点浮岚 + 鼠标视差
   渐进增强：WebGL / 模型加载失败 → 回退静态背景图
   ============================================================ */
(function () {
  'use strict';

  if (!window.THREE || !THREE.GLTFLoader) { return; }

  var stage = document.querySelector('.hero-stage');
  var canvas = document.getElementById('heroCanvas');
  if (!stage || !canvas) { return; }

  var REDUCED = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* WebGL 可用性检测 */
  var probe = document.createElement('canvas');
  var glCtx = probe.getContext('webgl') || probe.getContext('experimental-webgl');
  probe = null;
  if (!glCtx) { fallback(); return; }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) { fallback(); return; }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdad8cf, 7, 16);

  var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  var CAM_BASE = new THREE.Vector3(0, 0.1, 7.2);
  camera.position.copy(CAM_BASE);
  camera.lookAt(0, 0, 0);

  /* —— 灯光：右上暖主光（书法如金字浮于水墨）+ 青灰环境 —— */
  var keyLight = new THREE.DirectionalLight(0xfff3dd, 1.35);
  keyLight.position.set(3.2, 4.2, 4.5);
  scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0xe8c48a, 0.5);
  rimLight.position.set(-4, 1.5, -3);
  scene.add(rimLight);
  scene.add(new THREE.AmbientLight(0xe9e5da, 0.58));
  var fillLight = new THREE.DirectionalLight(0xf2f4f2, 0.2);
  fillLight.position.set(-2, -1, 3);
  scene.add(fillLight);

  /* —— 墨点浮岚：细墨点缓缓上浮，如淡墨在宣纸上晕开 —— */
  var DUST_N = REDUCED ? 70 : 150;
  var dustGeo = new THREE.BufferGeometry();
  var dustPos = new Float32Array(DUST_N * 3);
  var dustSeed = new Float32Array(DUST_N);
  for (var i = 0; i < DUST_N; i++) {
    var r = 1.6 + Math.random() * 3.4;
    var a = Math.random() * Math.PI * 2;
    dustPos[i * 3] = Math.cos(a) * r;
    dustPos[i * 3 + 1] = (Math.random() - 0.45) * 5.2;
    dustPos[i * 3 + 2] = Math.sin(a) * r * 0.55 - 0.6;
    dustSeed[i] = Math.random() * Math.PI * 2;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  var inkTex = makeInkTexture();
  var dustMat = new THREE.PointsMaterial({
    size: 0.085,
    map: inkTex,
    color: 0x43464d,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true
  });
  var dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  /* —— 淡墨晕斑：更大更柔的墨痕，横向缓移，做「氤氲」底味 —— */
  var WASH_N = REDUCED ? 14 : 30;
  var washGeo = new THREE.BufferGeometry();
  var washPos = new Float32Array(WASH_N * 3);
  var washSeed = new Float32Array(WASH_N);
  for (var w = 0; w < WASH_N; w++) {
    var wr = 0.6 + Math.random() * 3.6;
    var wa2 = Math.random() * Math.PI * 2;
    washPos[w * 3] = Math.cos(wa2) * wr;
    washPos[w * 3 + 1] = (Math.random() - 0.62) * 4.4;
    washPos[w * 3 + 2] = Math.sin(wa2) * wr * 0.5 - 1.1;
    washSeed[w] = Math.random() * Math.PI * 2;
  }
  washGeo.setAttribute('position', new THREE.BufferAttribute(washPos, 3));
  var washMat = new THREE.PointsMaterial({
    size: 0.52,
    map: inkTex,
    color: 0x5c6167,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true
  });
  var wash = new THREE.Points(washGeo, washMat);
  scene.add(wash);

  function makeInkTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(72, 75, 82, 0.9)');
    g.addColorStop(0.45, 'rgba(72, 75, 82, 0.38)');
    g.addColorStop(1, 'rgba(72, 75, 82, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /* —— 模型组：书法 + 假阴影 —— */
  var modelGroup = new THREE.Group();
  scene.add(modelGroup);
  var model = null;
  var pivot = null;
  var shadowMesh = null;
  var ready = false;

  var clock = new THREE.Clock();
  var mouse = { x: 0, y: 0 };
  var mouseTarget = { x: 0, y: 0 };
  var appear = 0;          /* 进场进度 0→1 */
  var scrollP = 0;         /* 滚动离场进度 0→1 */
  var running = true;
  var rafId = 0;

  var loader = new THREE.GLTFLoader();

  function onLoaded(gltf) {
    model = gltf.scene.children[0] || gltf.scene;

    /* 材质调教：生成模型常偏金属，调成纸石质感 */
    model.traverse(function (o) {
      if (o.isMesh && o.material) {
        o.material.metalness = 0.08;
        o.material.roughness = 0.62;
        if (o.material.map) { o.material.map.encoding = THREE.sRGBEncoding; }
      }
    });

    /* 包围盒：居中 + 适配画面（横幅书法板按宽高各自约束取小） */
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    var fit = Math.min(4.9 / size.x, 2.7 / size.y);
    model.scale.setScalar(fit);
    size.multiplyScalar(fit);

    /* 调试探针：浏览器控制台/自动化可读 */
    window.__hero3d = {
      ready: true,
      size: [size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2)],
      pos: modelGroup.position.toArray().map(function (v) { return +v.toFixed(2); }),
      camZ: camera.position.z
    };

    /* 假阴影：模型脚下的柔和椭圆 */
    var shadowTex = makeShadowTexture();
    shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x * fit * 1.5, size.z * fit * 1.5 + size.x * fit * 0.4),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.32, depthWrite: false })
    );
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -size.y * fit * 0.62 - 0.25;
    modelGroup.add(shadowMesh);

    /* 模型自带「立起」旋转（node 四元数），动画必须叠加而不能覆盖：
       包一层 pivot，摇曳/浮沉全部作用在 pivot 上 */
    pivot = new THREE.Group();
    pivot.add(model);
    modelGroup.add(pivot);

    modelGroup.scale.setScalar(0.72);
    modelGroup.position.y = -0.5;

    ready = true;
    stage.classList.add('is-ready');
    if (REDUCED) { renderStatic(); } else { loop(); }
  }

  function makeShadowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(66, 46, 20, 0.85)');
    g.addColorStop(0.55, 'rgba(66, 46, 20, 0.35)');
    g.addColorStop(1, 'rgba(66, 46, 20, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function loadModel() {
    if (location.protocol === 'file:') {
      /* 双击打开的本地页面：浏览器禁止 fetch 本地文件，
         模型改从 hero3d-embed.js（仅本地，不发布）取 */
      var s = document.createElement('script');
      s.src = 'hero3d-embed.js';
      s.onload = function () {
        var b64 = window.HERO3D_EMBED && window.HERO3D_EMBED.glb;
        if (!b64) { fallback(); return; }
        var bin = atob(b64);
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { buf[i] = bin.charCodeAt(i); }
        loader.parse(buf.buffer, '', onLoaded, fallback);
      };
      s.onerror = fallback;
      document.head.appendChild(s);
    } else {
      /* 弱网下大文件请求可能被瞬态中断，失败自动重试一次 */
      var retried = false;
      loader.load('calligraphy.glb', onLoaded, undefined, function () {
        if (!retried) {
          retried = true;
          setTimeout(function () {
            loader.load('calligraphy.glb', onLoaded, undefined, fallback);
          }, 700);
        } else {
          fallback();
        }
      });
    }
  }

  function fallback() {
    window.__hero3d = { ready: false, reason: 'fallback' };
    stage.classList.add('is-fallback');
    try { renderer.dispose(); } catch (e) { /* noop */ }
  }

  /* —— 尺寸自适应 —— */
  function resize() {
    var w = stage.clientWidth || window.innerWidth;
    var h = stage.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    /* 窄屏（手机竖屏）拉远相机，保证书法完整可见 */
    camera.position.z = CAM_BASE.z * (camera.aspect < 0.8 ? 1.45 : 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* —— 鼠标视差（触屏忽略） —— */
  if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('mousemove', function (e) {
      mouseTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  /* —— 滚动离场：书法下沉淡出，纸面内容接棒 —— */
  function readScroll() {
    var h = stage.clientHeight || 1;
    scrollP = Math.min(1, Math.max(0, window.scrollY / (h * 0.9)));
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();

  /* —— 离屏暂停 —— */
  var vis = new IntersectionObserver(function (entries) {
    running = entries[0].isIntersecting;
    if (running && ready && !REDUCED && !rafId) { loop(); }
  }, { rootMargin: '80px' });
  vis.observe(stage);

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function renderStatic() {
    appear = 1;
    modelGroup.scale.setScalar(1);
    modelGroup.position.y = 0;
    tick(0);
    renderer.render(scene, camera);
  }

  function tick(dt) {
    var t = clock.elapsedTime;

    /* 进场：飘近放大（每帧从进度绝对计算，避免增量累积） */
    if (appear < 1) {
      appear = Math.min(1, appear + dt / 1.7);
    }
    var e = easeOutCubic(appear);
    modelGroup.scale.setScalar(0.72 + 0.28 * e);
    var baseY = -0.5 + 0.5 * e;

    /* 书法：呼吸浮沉 + 缓慢摇曳（作用在 pivot 上，叠加于模型原始姿态） */
    if (pivot) {
      pivot.rotation.y = Math.sin(t * 0.22) * 0.13 + mouse.x * 0.08;
      pivot.rotation.x = Math.sin(t * 0.31) * 0.035 - mouse.y * 0.05;
      pivot.position.y = Math.sin(t * 0.5) * 0.09;
      if (shadowMesh) {
        shadowMesh.material.opacity = 0.32 - Math.sin(t * 0.5) * 0.07;
        var sc = 1 + Math.sin(t * 0.5) * 0.035;
        shadowMesh.scale.set(sc, sc, 1);
      }
    }

    /* 墨点：缓缓上浮 + 轻微横摆，如淡墨晕开；晕斑横向游走 */
    if (!REDUCED) {
      var pa = dustGeo.attributes.position;
      for (var i = 0; i < DUST_N; i++) {
        var y = pa.array[i * 3 + 1] + dt * 0.06;
        if (y > 2.9) { y = -2.5; }
        pa.array[i * 3 + 1] = y;
        pa.array[i * 3] += Math.sin(t * 0.5 + dustSeed[i]) * dt * 0.05;
      }
      pa.needsUpdate = true;
      dustMat.opacity = 0.34 + Math.sin(t * 0.7) * 0.08;
      var wp = washGeo.attributes.position;
      for (var j = 0; j < WASH_N; j++) {
        wp.array[j * 3] += Math.sin(t * 0.16 + washSeed[j]) * dt * 0.12;
        if (wp.array[j * 3] > 4.8) { wp.array[j * 3] = -4.8; }
        if (wp.array[j * 3] < -4.8) { wp.array[j * 3] = 4.8; }
      }
      wp.needsUpdate = true;
      washMat.opacity = 0.11 + Math.sin(t * 0.4) * 0.04;
    }

    /* 鼠标视差：相机缓动偏移（绝对赋值） */
    mouse.x += (mouseTarget.x - mouse.x) * 0.045;
    mouse.y += (mouseTarget.y - mouse.y) * 0.045;
    camera.position.x = CAM_BASE.x + mouse.x * 0.42;
    camera.position.y = CAM_BASE.y - mouse.y * 0.26 + scrollP * 0.35;

    /* 滚动离场：模型下沉（绝对赋值，不随帧数累积） */
    modelGroup.position.y = baseY - scrollP * 1.6;
    camera.lookAt(0, modelGroup.position.y * 0.55, 0);
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (!running) { rafId = 0; return; }
    tick(dt);
    renderer.render(scene, camera);
  }

  /* WebGL 上下文丢失（显存被回收等）→ 回退静态背景 */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    fallback();
  });

  loadModel();
})();
