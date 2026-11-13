'use strict';
// 3D 世界渲染器：地面 + 道砟轨道 + 列车（GLB 模型）。相机追车。
// 与 2D 渲染器互斥：开启后隐藏 #map，改用 #map3d。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U;

  // ---------- 矩阵 ----------
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
    trans(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
    scale(x, y, z) { return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]); },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    nrm(m) { return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); }
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
  vec3 L1 = normalize(vec3(0.55, 0.85, 0.40));
  vec3 L2 = normalize(vec3(-0.6, 0.30, -0.5));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 40.0) * 0.35;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = vCol * (0.26 + 0.95 * d1 + 0.28 * d2);
  col += spec * vec3(1.0, 0.94, 0.82);
  col += fres * vec3(1.0, 0.72, 0.38) * 0.22;
  float dist = length(uEye - vWorld);
  float fog = smoothstep(180.0, 520.0, dist);
  col = mix(col, uFog, fog);
  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function buf(gl, data) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  const W3 = Z.World3D = {
    on: false,
    ready: false,

    init: function () {
      if (this.ready) return true;
      const cv = document.getElementById('map3d');
      if (!cv) return false;
      this.cv = cv;
      const gl = cv.getContext('webgl', { antialias: true });
      if (!gl) return false;
      this.gl = gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;
      const A = {
        pos: gl.getAttribLocation(prog, 'aPos'),
        nor: gl.getAttribLocation(prog, 'aNor'),
        col: gl.getAttribLocation(prog, 'aCol')
      };
      const Uu = {};
      for (const k of ['uMVP', 'uModel', 'uNrm', 'uEye', 'uFog']) Uu[k] = gl.getUniformLocation(prog, k);
      this.A = A; this.U = Uu;

      // GLB 模型
      this.mesh = {};
      for (const name of (Z.GLB ? Z.GLB.names() : [])) {
        try { this.mesh[name] = this.upload(Z.GLB.load(name)); }
        catch (e) { /* 单个模型失败不影响整体 */ }
      }
      this.ground = this.upload(this.groundMesh());
      this.track = null; this.trackFor = -1;
      this.ready = true;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      return true;
    },

    upload: function (m) {
      const gl = this.gl;
      const pb = buf(gl, m.pos), nb = buf(gl, m.nor), cb = buf(gl, m.col);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      return {
        count: m.count, ib: ib, pb: pb, nb: nb, cb: cb,
        type: (m.idx instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      };
    },

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

    groundMesh: function () {
      const s = 900, y = -0.02;
      const pos = new Float32Array([-s, y, -s, s, y, -s, s, y, s, -s, y, s]);
      const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
      const c = [0.28, 0.26, 0.19];
      const col = new Float32Array([].concat(c, c, c, c));
      return { pos: pos, nor: nor, col: col, idx: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 };
    },

    // 按里程生成一段轨道（道砟 + 两根钢轨 + 枕木）
    buildTrack: function (centerS) {
      const gl = this.gl, path = Z.World.path;
      const s0 = Math.max(0, centerS - 420), s1 = Math.min(path.len, centerS + 420);
      const step = 3;
      const pos = [], nor = [], col = [], idx = [];
      const railC = [0.62, 0.64, 0.66], ballastC = [0.32, 0.28, 0.22];
      const tmp = {};
      const vtx = (x, y, z, c) => { pos.push(x, y, z); nor.push(0, 1, 0); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };

      // 路基（宽 11 m 的带子）
      let prevA = -1, prevB = -1;
      for (let s = s0; s <= s1; s += step) {
        U.posAt(path, s, tmp);
        const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
        const a = vtx(tmp.x + nx * 5.5, 0.02, tmp.y + ny * 5.5, ballastC);
        const b = vtx(tmp.x - nx * 5.5, 0.02, tmp.y - ny * 5.5, ballastC);
        if (prevA >= 0) idx.push(prevA, prevB, b, prevA, b, a);
        prevA = a; prevB = b;
      }
      // 钢轨（±1.45 m，抬到 0.16 m）
      for (const off of [-1.45, 1.45]) {
        let pa = -1, pb = -1;
        for (let s = s0; s <= s1; s += step) {
          U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const a = vtx(tmp.x + nx * (off - 0.09), 0.16, tmp.y + ny * (off - 0.09), railC);
          const b = vtx(tmp.x + nx * (off + 0.09), 0.16, tmp.y + ny * (off + 0.09), railC);
          if (pa >= 0) idx.push(pa, pb, b, pa, b, a);
          pa = a; pb = b;
        }
      }
      // 枕木：每 2.6 m 一根
      const tieC = [0.24, 0.20, 0.15];
      for (let s2 = s0; s2 <= s1; s2 += 2.6) {
        U.posAt(path, s2, tmp);
        const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a), ax = Math.cos(tmp.a), ay = Math.sin(tmp.a);
        const hw = 2.3, hl = 0.13, y0 = 0.10;
        const q = [
          [tmp.x - nx * hw - ax * hl, tmp.y - ny * hw - ay * hl],
          [tmp.x + nx * hw - ax * hl, tmp.y + ny * hw - ay * hl],
          [tmp.x + nx * hw + ax * hl, tmp.y + ny * hw + ay * hl],
          [tmp.x - nx * hw + ax * hl, tmp.y - ny * hw + ay * hl]
        ];
        const b0 = vtx(q[0][0], y0, q[0][1], tieC);
        const b1 = vtx(q[1][0], y0, q[1][1], tieC);
        const b2 = vtx(q[2][0], y0, q[2][1], tieC);
        const b3 = vtx(q[3][0], y0, q[3][1], tieC);
        idx.push(b0, b1, b2, b0, b2, b3);
      }
      this.track = this.uploadRaw(pos, nor, col, idx);
      this.trackFor = centerS;
    },

    uploadRaw: function (pos, nor, col, idx) {
      const gl = this.gl;
      const n = pos.length / 3;
      const p = new Float32Array(pos), nn = new Float32Array(nor), cc = new Float32Array(col);
      const ii = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      return this.upload({ pos: p, nor: nn, col: cc, idx: ii, count: ii.length });
    },

    resize: function () {
      if (!this.cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cv.width = Math.round(window.innerWidth * dpr);
      this.cv.height = Math.round(window.innerHeight * dpr);
      this.gl.viewport(0, 0, this.cv.width, this.cv.height);
    },

    // 每帧
    render: function (run) {
      if (!this.ready || !run || !run.train) return;
      const gl = this.gl;
      const path = Z.World.path;
      const tmp = {};
      const cars = run.cars, n = cars.length;
      const pitch = Z.CFG.TRAIN.carLenM + Z.CFG.TRAIN.carGapM;
      const midS = run.km;

      if (!this.track || Math.abs(this.trackFor - midS) > 260) this.buildTrack(midS);

      // 相机：列车后上方追车，看向前方
      const halfLen = (n * (Z.CFG.TRAIN.carLenM + Z.CFG.TRAIN.carGapM)) / 2;
      U.posAt(path, Math.max(0, midS - halfLen - 34), tmp);
      const back = tmp;
      const eye = [back.x - Math.cos(back.a) * 10, 25, back.y - Math.sin(back.a) * 10];
      U.posAt(path, Math.min(path.len, midS + 6), tmp);
      const center = [tmp.x, 3.4, tmp.y];
      const proj = M4.perspective(0.78, this.cv.width / Math.max(1, this.cv.height), 0.5, 700);
      const view = M4.lookAt(eye, center, [0, 1, 0]);
      const vp = M4.mul(proj, view);

      gl.viewport(0, 0, this.cv.width, this.cv.height);
      gl.clearColor(0.055, 0.06, 0.05, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      gl.useProgram(this.prog);
      gl.uniform3fv(this.U.uEye, eye);
      gl.uniform3fv(this.U.uFog, [0.055, 0.06, 0.05]);

      // 地面
      let model = M4.ident();
      gl.uniformMatrix4fv(this.U.uMVP, false, vp);
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
      this.use(this.ground);
      gl.drawElements(gl.TRIANGLES, this.ground.count, this.ground.type, 0);

      // 轨道
      if (this.track) {
        this.use(this.track);
        gl.drawElements(gl.TRIANGLES, this.track.count, this.track.type, 0);
      }

      // 路边建筑（用 building.glb 摆到废墟位置，近处才画）
      if (this.mesh.building && Z.World.ruins) {
        let drawn = 0;
        const cx = center[0], cz = center[2];
        for (const b of Z.World.ruins) {
          if (drawn >= 16) break;
          const dx = b.x - cx, dz = b.y - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 210 * 210 || d2 < 18 * 18) continue;
          const sc = M4.scale(Math.max(0.4, b.w / 14), Math.max(0.25, b.h / 16), Math.max(0.4, b.d / 11));
          const model = M4.mul(M4.mul(M4.trans(b.x, 0, b.y), M4.rotY(-b.rot)), sc);
          const mvp = M4.mul(vp, model);
          gl.uniformMatrix4fv(this.U.uMVP, false, mvp);
          gl.uniformMatrix4fv(this.U.uModel, false, model);
          gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
          this.use(this.mesh.building);
          gl.drawElements(gl.TRIANGLES, this.mesh.building.count, this.mesh.building.type, 0);
          drawn++;
        }
      }

      // 列车
      const MAP = { engine: 'loco', weapon: 'weapon', passenger: 'cargo', cargo: 'cargo', armor: 'weapon', power: 'loco', repair: 'cargo' };
      for (let k = 0; k < n; k++) {
        const car = cars[k];
        if (!car || car.dead) continue;
        const s = midS + ((n - 1) / 2 - k) * pitch;
        if (s < 0 || s > path.len) continue;
        U.posAt(path, s, tmp);
        const mesh = this.mesh[MAP[car.type] || 'cargo'];
        if (!mesh) continue;
        model = M4.mul(M4.trans(tmp.x, 0, tmp.y), M4.rotY(-tmp.a));
        const mvp = M4.mul(vp, model);
        gl.uniformMatrix4fv(this.U.uMVP, false, mvp);
        gl.uniformMatrix4fv(this.U.uModel, false, model);
        gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
        this.use(mesh);
        gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
      }
    },

    setMode: function (on) {
      if (on && !this.init()) return false;
      this.on = !!on;
      const c2 = document.getElementById('map');
      const c3 = document.getElementById('map3d');
      if (c2) c2.style.display = on ? 'none' : '';
      if (c3) c3.style.display = on ? 'block' : 'none';
      if (on) this.resize();
      return true;
    }
  };
})(window.ZT);
