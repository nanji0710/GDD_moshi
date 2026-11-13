'use strict';
// 游戏内 3D 视图：把 assets 里的 .glb 模型用 WebGL 渲染出来（拖拽旋转 / 滚轮缩放）。
window.ZT = window.ZT || {};
(function (Z) {
  const M4 = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, center, up) {
      let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
      ]);
    },
    normalMat3(m) { return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); }
  };

  const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
uniform mat4 uMVP, uModel; uniform mat3 uNrm;
varying vec3 vNor, vCol, vWorld;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorld = wp.xyz;
  vNor = normalize(uNrm * aNor);
  vCol = aCol;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
  const FS = `
precision highp float;
varying vec3 vNor, vCol, vWorld;
uniform vec3 uEye, uFog;
void main() {
  vec3 N = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  vec3 L1 = normalize(vec3(0.55, 0.82, 0.42));
  vec3 L2 = normalize(vec3(-0.6, 0.35, -0.5));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.5;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = vCol * (0.24 + 0.95 * d1 + 0.30 * d2);
  col += spec * vec3(1.0, 0.94, 0.82);
  col += fres * vec3(1.0, 0.72, 0.38) * 0.30;
  float dist = length(uEye - vWorld);
  vec2 fw = abs(fract(vWorld.xz * 0.5) - 0.5);
  float wLine = 0.012 + dist * 0.0016;
  float grid = smoothstep(0.5 - wLine, 0.5, max(fw.x, fw.y));
  float fog = smoothstep(60.0, 190.0, dist);
  col = mix(col, uFog, fog * 0.9);
  if (vWorld.y < 0.02) {
    vec3 gc = mix(vec3(0.05,0.06,0.07), vec3(0.11,0.12,0.14), grid);
    float sh = smoothstep(16.0, 0.0, length(vWorld.xz));
    col = mix(gc, vec3(0.02,0.02,0.03), sh * 0.55);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  const LABEL = { engine: '机车', passenger: '人员车厢', weapon: '武器车厢', cargo: '货柜', power: '动力车厢', armor: '装甲车厢', repair: '修理车厢', zombie: '丧尸', building: '废墟', tree: '枯树' };
  const DIST = { engine: 40, passenger: 38, weapon: 34, cargo: 38, power: 36, armor: 36, repair: 36, zombie: 6.5, building: 54, tree: 18 };
  const TY = { engine: 2.4, passenger: 2.6, weapon: 2.6, cargo: 2.8, power: 2.6, armor: 2.6, repair: 2.6, zombie: 1.1, building: 8.5, tree: 3.2 };

  const V3 = Z.View3D = {
    open: function () {
      if (this.root) return;
      const host = document.getElementById('ui') || document.body;
      const root = document.createElement('div');
      root.className = 'v3d';
      root.innerHTML = [
        '<canvas class="v3d-cv"></canvas>',
        '<div class="v3d-head"><b>3D 模型 · GLB 资产</b><span>由 assets/models/*.glb 加载渲染 · 拖拽旋转 · 滚轮缩放</span></div>',
        '<div class="v3d-bar"></div>',
        '<button class="v3d-close" title="关闭">✕</button>'
      ].join('');
      host.appendChild(root);
      this.root = root;
      this.cv = root.querySelector('.v3d-cv');
      this.bar = root.querySelector('.v3d-bar');
      root.querySelector('.v3d-close').onclick = () => this.close();

      const gl = this.cv.getContext('webgl', { antialias: true });
      if (!gl) { root.innerHTML = '<p style="padding:40px">这个浏览器不支持 WebGL。</p>'; return; }
      this.gl = gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;

      const A = {
        pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor'),
        col: gl.getAttribLocation(prog, 'aCol')
      };
      const U = {};
      for (const k of ['uMVP', 'uModel', 'uNrm', 'uEye', 'uFog']) U[k] = gl.getUniformLocation(prog, k);
      this.A = A; this.U = U;

      // 从内嵌 GLB 资产构建网格
      this.meshes = {};
      const names = (Z.GLB && Z.GLB.names) ? Z.GLB.names() : [];
      for (const name of names) {
        try {
          const m = Z.GLB.load(name);
          this.meshes[name] = this.upload(m);
        } catch (e) { if (window.console) console.warn('GLB 加载失败', name, e); }
      }
      // 地面
      this.ground = this.upload(this.groundMesh());

      const list = names.length ? names : ['loco'];
      list.forEach((n, i) => {
        const btn = document.createElement('button');
        btn.textContent = LABEL[n] || n;
        btn.onclick = () => {
          this.cur = n;
          this.cam.dist = DIST[n] || 30;
          this.cam.targetY = TY[n] || 2.2;
          this.markButtons();
        };
        this.bar.appendChild(btn);
        if (i === 0) this.cur = n;
      });
      this.markButtons();

      this.cam = { yaw: 0.7, pitch: 0.30, dist: DIST[this.cur] || 30, targetY: TY[this.cur] || 2.2 };
      this.auto = true;
      this.bindInput();
      this.resize();
      this.onResize = () => this.resize();
      window.addEventListener('resize', this.onResize);
      this.last = performance.now();
      this.loop = this.frame.bind(this);
      requestAnimationFrame(this.loop);
    },

    groundMesh: function () {
      const s = 250, y = -0.06;
      const pos = new Float32Array([-s, y, -s, s, y, -s, s, y, s, -s, y, s]);
      const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
      const col = new Float32Array([0.045, 0.055, 0.07, 0.045, 0.055, 0.07, 0.045, 0.055, 0.07, 0.045, 0.055, 0.07]);
      return { pos: pos, nor: nor, col: col, idx: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 };
    },

    upload: function (m) {
      const gl = this.gl;
      const buf = (data) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
      };
      const pb = buf(m.pos), nb = buf(m.nor), cb = buf(m.col);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      const is32 = m.idx instanceof Uint32Array;
      return { count: m.count, ib: ib, pb: pb, nb: nb, cb: cb,
        type: is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    },

    // 画之前必须重新绑定这套网格的顶点缓冲（WebGL 的 attrib 指针是全局状态）
    use: function (m) {
      const gl = this.gl, A = this.A;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb);
      gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb);
      gl.enableVertexAttribArray(A.nor); gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.cb);
      gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
    },

    markButtons: function () {
      const names = (Z.GLB && Z.GLB.names) ? Z.GLB.names() : [];
      [...this.bar.children].forEach((b, i) => b.classList.toggle('on', names[i] === this.cur));
    },

    bindInput: function () {
      let dragging = false, lx = 0, ly = 0;
      const cam = this.cam;
      this.cv.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; this.auto = false; });
      window.addEventListener('pointerup', () => { dragging = false; });
      window.addEventListener('pointermove', e => {
        if (!dragging || !this.cam) return;
        this.cam.yaw -= (e.clientX - lx) * 0.008;
        this.cam.pitch = Math.max(-0.15, Math.min(1.15, this.cam.pitch + (e.clientY - ly) * 0.006));
        lx = e.clientX; ly = e.clientY;
      });
      this.cv.addEventListener('wheel', e => {
        e.preventDefault();
        if (!this.cam) return;
        this.cam.dist = Math.max(2, Math.min(220, this.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      }, { passive: false });
      this.cv.addEventListener('dblclick', () => { this.auto = !this.auto; });
    },

    resize: function () {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.cv.clientWidth || window.innerWidth;
      const h = this.cv.clientHeight || window.innerHeight;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.gl.viewport(0, 0, this.cv.width, this.cv.height);
    },

    frame: function (now) {
      if (!this.root) return;
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (this.auto) this.cam.yaw += dt * 0.3;
      const gl = this.gl;
      gl.clearColor(0.043, 0.055, 0.07, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      const aspect = this.cv.width / Math.max(1, this.cv.height);
      const proj = M4.perspective(0.72, aspect, 0.1, 600);
      const cy = Math.cos(this.cam.pitch), sy = Math.sin(this.cam.pitch);
      const eye = [Math.sin(this.cam.yaw) * this.cam.dist * cy, this.cam.targetY + sy * this.cam.dist, Math.cos(this.cam.yaw) * this.cam.dist * cy];
      const view = M4.lookAt(eye, [0, this.cam.targetY, 0], [0, 1, 0]);
      const vp = M4.mul(proj, view);
      const model = M4.ident();
      gl.uniformMatrix4fv(this.U.uMVP, false, vp);
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.normalMat3(model));
      gl.uniform3fv(this.U.uEye, eye);
      gl.uniform3fv(this.U.uFog, [0.043, 0.055, 0.07]);

      if (this.ground) {
        this.use(this.ground);
        gl.drawElements(gl.TRIANGLES, this.ground.count, this.ground.type, 0);
      }
      const m = this.meshes[this.cur];
      if (m) {
        this.use(m);
        gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
      }
      requestAnimationFrame(this.loop);
    },

    close: function () {
      window.removeEventListener('resize', this.onResize);
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null; this.meshes = null; this.gl = null;
    }
  };
})(window.ZT);
