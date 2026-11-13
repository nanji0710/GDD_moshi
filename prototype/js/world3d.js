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
    rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
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
uniform float uFlash;
uniform float uAlpha;
uniform vec3 uColorMul;
// ---- 程序化地表用的噪声 ----
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.55;
  for (int i = 0; i < 4; i++) {
    v += vnoise(p) * amp;
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec3 N = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  vec3 L1 = normalize(vec3(0.55, 0.85, 0.40));
  vec3 L2 = normalize(vec3(-0.65, 0.45, -0.55));
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 46.0) * 0.22;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // 补光抬高：不然车身和窗户糊成一片黑
  vec3 col = vCol * (0.30 + 0.82 * d1 + 0.42 * d2);
  col += spec * vec3(1.0, 0.94, 0.82);
  col += fres * vec3(1.0, 0.72, 0.38) * 0.22;
  col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);
  float dist = length(uEye - vWorld);
  float fog = smoothstep(220.0, 1400.0, dist);
  col = mix(col, uFog, fog);
  // 地表网格：让地面有尺度感，不然像一块沙地
  // ===== 地表：荒地 / 灌木 / 沙土 / 焦土 的程序化斑块 =====
  if (vWorld.y < 0.06) {
    vec2 p = vWorld.xz;
    float n1 = fbm(p * 0.011);                 // 大尺度：地块
    float n2 = fbm(p * 0.045 + 11.3);          // 中尺度：斑块边缘
    float n3 = fbm(p * 0.0075 + 31.0);         // 更大尺度：焦土带
    float fine = fbm(p * 0.42);                // 细颗粒

    vec3 dust  = vec3(0.44, 0.405, 0.315);
    vec3 dirt  = vec3(0.33, 0.305, 0.235);
    vec3 scrub = vec3(0.225, 0.250, 0.165);
    vec3 burnt = vec3(0.155, 0.145, 0.130);

    vec3 g = mix(dirt, dust, smoothstep(0.34, 0.72, n1));
    g = mix(g, scrub, smoothstep(0.62, 0.86, n2) * 0.85);
    g = mix(g, burnt, smoothstep(0.70, 0.90, n3));
    g *= 0.86 + fine * 0.30;
    // 中尺度土色斑驳，避免大块纯色
    g *= 0.94 + fbm(p * 0.16 + 5.0) * 0.12;

    // 细网格：给地面尺度感
    vec2 fw = abs(fract(p * 0.125) - 0.5);
    float w2 = 0.012 + dist * 0.0018;
    float grid = smoothstep(0.5 - w2, 0.5, max(fw.x, fw.y));
    g = mix(g, g * 1.16, grid * 0.09);

    col = g;
  }
  gl_FragColor = vec4(col * uColorMul, uAlpha);
}`;

  // 天空穹顶：一个覆盖全屏的三角形，按屏幕纵向做渐变
  const SKY_VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;
  const SKY_FS = `
precision highp float;
varying vec2 vUV;
uniform vec3 uTop, uBot, uSun;
void main() {
  float t = pow(clamp(vUV.y, 0.0, 1.0), 1.5);
  vec3 c = mix(uBot, uTop, t);
  // 低垂的太阳：地平线附近一团暖光
  float g = exp(-length((vUV - vec2(0.74, 0.24)) * vec2(1.6, 1.0)) * 5.0);
  c += uSun * g * 0.6;
  // 远处尘霾
  c += vec3(0.10, 0.075, 0.05) * exp(-abs(vUV.y - 0.30) * 14.0);
  gl_FragColor = vec4(c, 1.0);
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
      for (const k of ['uMVP', 'uModel', 'uNrm', 'uEye', 'uFog', 'uFlash', 'uAlpha', 'uColorMul']) Uu[k] = gl.getUniformLocation(prog, k);
      this.A = A; this.U = Uu;

      // GLB 模型
      this.mesh = {};
      for (const name of (Z.GLB ? Z.GLB.names() : [])) {
        try { this.mesh[name] = this.upload(Z.GLB.load(name)); }
        catch (e) { /* 单个模型失败不影响整体 */ }
      }
      this.ground = this.upload(this.groundMesh());
      this.cube = this.upload(this.cubeMesh());
      this.hill = this.upload(this.hillMesh());
      this.buildRoads();
      // 天空
      const sky = gl.createProgram();
      gl.attachShader(sky, compile(gl, gl.VERTEX_SHADER, SKY_VS));
      gl.attachShader(sky, compile(gl, gl.FRAGMENT_SHADER, SKY_FS));
      gl.linkProgram(sky);
      this.skyProg = sky;
      this.skyA = gl.getAttribLocation(sky, "aPos");
      this.skyU = {
        top: gl.getUniformLocation(sky, "uTop"),
        bot: gl.getUniformLocation(sky, "uBot"),
        sun: gl.getUniformLocation(sky, "uSun")
      };
      this.skyBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      // 曳光弹：动态线段缓冲
      this.lineBuf = gl.createBuffer();
      this.lineCol = gl.createBuffer();
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
        type: (m.idx instanceof Uint32Array) ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        w: (function () { let a = 1e9, b = -1e9; for (let k = 0; k < m.pos.length; k += 3) { const v = m.pos[k]; if (v < a) a = v; if (v > b) b = v; } return b - a; })(),
        d: (function () { let a = 1e9, b = -1e9; for (let k = 2; k < m.pos.length; k += 3) { const v = m.pos[k]; if (v < a) a = v; if (v > b) b = v; } return b - a; })()
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

    cubeMesh: function () {
      const p = [], n2 = [], c = [], idx = [];
      const push = (x, y, z, nx, ny, nz) => { p.push(x, y, z); n2.push(nx, ny, nz); c.push(1, 1, 1); return p.length / 3 - 1; };
      const faces = [
        [[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1],[0,1,0]],
        [[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1],[0,-1,0]],
        [[-1,-1,1],[-1,1,1],[1,1,1],[1,-1,1],[0,0,1]],
        [[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,-1],[0,0,-1]],
        [[1,-1,1],[1,1,1],[1,1,-1],[1,-1,-1],[1,0,0]],
        [[-1,-1,-1],[-1,1,-1],[-1,1,1],[-1,-1,1],[-1,0,0]]
      ];
      for (const f of faces) {
        const a = push(f[0][0]*0.5, f[0][1]*0.5, f[0][2]*0.5, f[4][0], f[4][1], f[4][2]);
        const b = push(f[1][0]*0.5, f[1][1]*0.5, f[1][2]*0.5, f[4][0], f[4][1], f[4][2]);
        const c2 = push(f[2][0]*0.5, f[2][1]*0.5, f[2][2]*0.5, f[4][0], f[4][1], f[4][2]);
        const d = push(f[3][0]*0.5, f[3][1]*0.5, f[3][2]*0.5, f[4][0], f[4][1], f[4][2]);
        idx.push(a, b, c2, a, c2, d);
      }
      return { pos: new Float32Array(p), nor: new Float32Array(n2), col: new Float32Array(c),
        idx: new Uint16Array(idx), count: idx.length };
    },

    groundMesh: function () {
      const s = 2600, y = -0.02;
      const pos = new Float32Array([-s, y, -s, s, y, -s, s, y, s, -s, y, s]);
      const nor = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
      const c = [0.34, 0.315, 0.245];
      const col = new Float32Array([].concat(c, c, c, c));
      return { pos: pos, nor: nor, col: col, idx: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 };
    },

    // 按里程生成一段轨道（道砟 + 两根钢轨 + 枕木）
    // 轨道：道砟梯形断面 + 0.6 m 枕木 + 工字钢轨（轨距 1.435 m）
    buildTrack: function (centerS) {
      const path = Z.World.path;
      const s0 = Math.max(0, centerS - 420), s1 = Math.min(path.len, centerS + 420);
      const pos = [], nor = [], col = [], idx = [];
      const tmp = {};
      const vtx = function (x, y, z, nx, ny, nz, c) {
        pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]);
        return pos.length / 3 - 1;
      };
      // 生成一条沿路径的"带子"（两边缘点 + 法线朝向由调用方给）
      const strip = function (latA, latB, y, color) {
        let prevA = -1, prevB = -1, first = [];
        for (let s = s0; s <= s1; s += 3) {
          U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const a = vtx(tmp.x + nx * latA, y, tmp.y + ny * latA, 0, 1, 0, color);
          const b = vtx(tmp.x + nx * latB, y, tmp.y + ny * latB, 0, 1, 0, color);
          if (prevA >= 0) idx.push(prevA, prevB, b, prevA, b, a);
          prevA = a; prevB = b;
        }
      };

      const BALLAST = [0.33, 0.315, 0.285];
      const BALLAST_D = [0.26, 0.245, 0.215];
      const SHADOW = [0.20, 0.19, 0.17];

      // 1) 道砟：底部宽 7.2 m，肩部 5.0 m，两层叠出梯形断面
      strip(-3.6, 3.6, 0.02, BALLAST_D);
      strip(-2.8, 2.8, 0.18, BALLAST);
      strip(-2.5, 2.5, 0.30, BALLAST);
      // 中间压暗（钢轨之间的油污带）
      // 铁路旁的服务土路 + 两道车辙
      const ROAD = [0.235, 0.205, 0.160], RUT = [0.165, 0.145, 0.115];
      strip(-15.2, -9.0, 0.05, ROAD);
      strip(-12.9, -12.4, 0.065, RUT);
      strip(-11.6, -11.1, 0.065, RUT);
      strip(-0.9, 0.9, 0.31, SHADOW);

      // 2) 枕木：间距 0.62 m，长 2.6 m
      const TIE = [0.34, 0.32, 0.29];
      const TIE_TOP = [0.42, 0.40, 0.36];
      for (let s = Math.ceil(s0 / 0.62) * 0.62; s <= s1; s += 0.62) {
        U.posAt(path, s, tmp);
        const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
        const ax = Math.cos(tmp.a), ay = Math.sin(tmp.a);
        const hw = 1.30, hl = 0.13, y0 = 0.34, hh = 0.14;
        const q = [
          [tmp.x - nx * hw - ax * hl, tmp.y - ny * hw - ay * hl],
          [tmp.x + nx * hw - ax * hl, tmp.y + ny * hw - ay * hl],
          [tmp.x + nx * hw + ax * hl, tmp.y + ny * hw + ay * hl],
          [tmp.x - nx * hw + ax * hl, tmp.y - ny * hw + ay * hl]
        ];
        const b0 = vtx(q[0][0], y0 + hh, q[0][1], 0, 1, 0, TIE_TOP);
        const b1 = vtx(q[1][0], y0 + hh, q[1][1], 0, 1, 0, TIE_TOP);
        const b2 = vtx(q[2][0], y0 + hh, q[2][1], 0, 1, 0, TIE_TOP);
        const b3 = vtx(q[3][0], y0 + hh, q[3][1], 0, 1, 0, TIE_TOP);
        idx.push(b0, b1, b2, b0, b2, b3);
        // 侧面（让枕木有厚度）
        const t0 = vtx(q[0][0], y0, q[0][1], 0, 0, 0, TIE);
        const t1 = vtx(q[1][0], y0, q[1][1], 0, 0, 0, TIE);
        idx.push(t0, b0, b1, t0, b1, t1);
        const t2 = vtx(q[2][0], y0, q[2][1], 0, 0, 0, TIE);
        idx.push(t1, b1, b2, t1, b2, t2);
      }

      // 3) 钢轨：工字断面（底 0.14 宽、腰 0.05、头 0.12），轨距 1.435 m
      const RAIL = [0.55, 0.57, 0.60];
      const RAIL_TOP = [0.86, 0.88, 0.90];
      const step2 = 3;
      for (const lat of [-0.7175, 0.7175]) {
        // 轨底
        let pa = -1, pb = -1;
        for (let s = s0; s <= s1; s += step2) {
          U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const a = vtx(tmp.x + nx * (lat - 0.07), 0.46, tmp.y + ny * (lat - 0.07), 0, 1, 0, RAIL);
          const b = vtx(tmp.x + nx * (lat + 0.07), 0.46, tmp.y + ny * (lat + 0.07), 0, 1, 0, RAIL);
          if (pa >= 0) idx.push(pa, pb, b, pa, b, a);
          pa = a; pb = b;
        }
        // 轨腰（两片竖直面）
        for (const side of [-1, 1]) {
          let q0 = -1, q1 = -1;
          for (let s = s0; s <= s1; s += step2) {
            U.posAt(path, s, tmp);
            const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
            const off = lat + side * 0.028;
            const a = vtx(tmp.x + nx * off, 0.46, tmp.y + ny * off, nx * side, 0, ny * side, [0.40, 0.42, 0.45]);
            const b = vtx(tmp.x + nx * off, 0.60, tmp.y + ny * off, nx * side, 0, ny * side, [0.46, 0.48, 0.51]);
            if (q0 >= 0) idx.push(q0, q1, b, q0, b, a);
            q0 = a; q1 = b;
          }
        }
        // 轨头（车轮压出的亮面）
        let ra = -1, rb = -1;
        for (let s = s0; s <= s1; s += step2) {
          U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const a = vtx(tmp.x + nx * (lat - 0.06), 0.62, tmp.y + ny * (lat - 0.06), 0, 1, 0, RAIL_TOP);
          const b = vtx(tmp.x + nx * (lat + 0.06), 0.62, tmp.y + ny * (lat + 0.06), 0, 1, 0, RAIL_TOP);
          if (ra >= 0) idx.push(ra, rb, b, ra, b, a);
          ra = a; rb = b;
        }
      }

      this.track = this.uploadRaw(pos, nor, col, idx);
      this.trackFor = centerS;
    },


    // 道路：直接用 2D 世界生成的道路折线，铺成深色土路
    buildRoads: function () {
      if (this.roadMesh || !Z.World || !Z.World.roads) return;
      const pos = [], nor = [], col = [], idx = [];
      const C = [0.215, 0.190, 0.150];
      const EDGE = [0.26, 0.235, 0.190];
      const vtx = function (x, y, z, c) {
        pos.push(x, y, z); nor.push(0, 1, 0); col.push(c[0], c[1], c[2]);
        return pos.length / 3 - 1;
      };
      for (const rd of Z.World.roads) {
        const pts = rd.pts || [];
        if (pts.length < 2) continue;
        const hw = (rd.w || 7) * 0.5;
        let pA = -1, pB = -1, pC = -1, pD = -1;
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k], q = pts[Math.min(k + 1, pts.length - 1)];
          const dx = q.x - p.x, dy = q.y - p.y;
          const l = Math.hypot(dx, dy) || 1;
          const nx = -dy / l, ny = dx / l;
          const a = vtx(p.x + nx * hw, 0.045, p.y + ny * hw, EDGE);
          const b = vtx(p.x + nx * (hw - 0.6), 0.05, p.y + ny * (hw - 0.6), C);
          const c = vtx(p.x - nx * (hw - 0.6), 0.05, p.y - ny * (hw - 0.6), C);
          const d = vtx(p.x - nx * hw, 0.045, p.y - ny * hw, EDGE);
          if (pA >= 0) {
            idx.push(pA, pB, b, pA, b, a);
            idx.push(pB, pC, c, pB, c, b);
            idx.push(pC, pD, d, pC, d, c);
          }
          pA = a; pB = b; pC = c; pD = d;
        }
      }
      if (pos.length) this.roadMesh = this.uploadRaw(pos, nor, col, idx);
    },

    // 远处的丘陵：给地平线一点起伏
    hillMesh: function () {
      const seg = 8, p = [], n2 = [], c = [], idx = [];
      const apex = p.length / 3; p.push(0, 1, 0); n2.push(0, 1, 0); c.push(0.30, 0.26, 0.19);
      for (let i2 = 0; i2 <= seg; i2++) {
        const a = i2 / seg * Math.PI * 2;
        p.push(Math.cos(a), 0, Math.sin(a));
        n2.push(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6);
        c.push(0.24, 0.21, 0.155);
      }
      for (let i2 = 0; i2 < seg; i2++) idx.push(apex, apex + 1 + i2, apex + 2 + i2);
      return { pos: new Float32Array(p), nor: new Float32Array(n2), col: new Float32Array(c),
        idx: new Uint16Array(idx), count: idx.length };
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
    // 把 2D 的 biome 配色套到 3D 模型上：除以模型自身的基色，得到乘子
    palTint: function (hex, base) {
      const h = function (c) { return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]; };
      const a = h(hex), b = base;
      return [Math.min(2.4, 0.55 + a[0] / b[0] * 0.75), Math.min(2.4, 0.55 + a[1] / b[1] * 0.75), Math.min(2.4, 0.55 + a[2] / b[2] * 0.75)];
    },

    // 当前关卡的调色板（与 2D 完全同源）
    pal: function () {
      const p = (Z.World && Z.World.pal) || null;
      return p || { tree: ["#2b3a2b", "#33442f", "#26332b"], wall: ["#2e2d26"], roof: ["#403e34"] };
    },

    render: function (run) {
      if (!this.ready || !run || !run.train) return;
      const gl = this.gl;
      const path = Z.World.path;
      const tmp = {};
      const cars = run.cars, n = cars.length;
      const pitch = Z.CFG.TRAIN.carLenM + Z.CFG.TRAIN.carGapM;
      this._burn = [];
      const midS = run.km;

      if (!this.track || Math.abs(this.trackFor - midS) > 260) this.buildTrack(midS);

      // 相机：列车后上方追车，看向前方
      const halfLen = (n * (Z.CFG.TRAIN.carLenM + Z.CFG.TRAIN.carGapM)) / 2;
      // 目标：列车中点
      U.posAt(path, midS, tmp);
      const target = [tmp.x, 3.2, tmp.y];
      const heading = tmp.a;
      if (!this.cam) this.cam = { yaw: heading, pitch: 0.30, dist: halfLen * 0.75 + 30, manual: false };
      const cam = this.cam;
      if (!cam.manual) { cam.yaw = heading; if (!cam.distFixed) cam.dist = halfLen * 0.75 + 30; }
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const eye = [
        target[0] - Math.cos(cam.yaw) * cam.dist * cp,
        target[1] + sp * cam.dist,
        target[2] - Math.sin(cam.yaw) * cam.dist * cp
      ];
      const center = [target[0] + Math.cos(heading) * 6, 2.8, target[2] + Math.sin(heading) * 6];

      const proj = M4.perspective(0.78, this.cv.width / Math.max(1, this.cv.height), 0.5, 700);
      const view = M4.lookAt(eye, center, [0, 1, 0]);
      const vp = M4.mul(proj, view);

      gl.viewport(0, 0, this.cv.width, this.cv.height);
      gl.clearColor(0.38, 0.31, 0.24, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 天空：先铺满背景，再画地面和模型
      if (this.skyProg) {
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.skyProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
        gl.enableVertexAttribArray(this.skyA);
        gl.vertexAttribPointer(this.skyA, 2, gl.FLOAT, false, 0, 0);
        gl.uniform3f(this.skyU.top, 0.055, 0.075, 0.105);
        gl.uniform3f(this.skyU.bot, 0.38, 0.31, 0.24);
        gl.uniform3f(this.skyU.sun, 0.85, 0.48, 0.22);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
        gl.disableVertexAttribArray(this.skyA);
        gl.useProgram(this.prog);
      }
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      this.vp = vp;
      gl.useProgram(this.prog);
      gl.uniform1f(this.U.uFlash, 0);
      gl.uniform1f(this.U.uAlpha, 1);
      gl.uniform3f(this.U.uColorMul, 1, 1, 1);
      gl.uniform3fv(this.U.uEye, eye);
      gl.uniform3fv(this.U.uFog, [0.38, 0.31, 0.24]);

      // 地面
      let model = M4.trans(center[0], 0, center[2]);
      gl.uniformMatrix4fv(this.U.uMVP, false, M4.mul(vp, model));
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
      this.use(this.ground);
      gl.drawElements(gl.TRIANGLES, this.ground.count, this.ground.type, 0);

      // 轨道
      if (this.track) {
        // 轨道用自己的单位矩阵（地面用了平移矩阵，不能复用）
        const tm = M4.ident();
        gl.uniformMatrix4fv(this.U.uMVP, false, vp);
        gl.uniformMatrix4fv(this.U.uModel, false, tm);
        gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(tm));
        this.use(this.track);
        gl.drawElements(gl.TRIANGLES, this.track.count, this.track.type, 0);
      }

      // 道路
      if (this.roadMesh) {
        const rm = M4.ident();
        gl.uniformMatrix4fv(this.U.uMVP, false, vp);
        gl.uniformMatrix4fv(this.U.uModel, false, rm);
        gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(rm));
        this.use(this.roadMesh);
        gl.drawElements(gl.TRIANGLES, this.roadMesh.count, this.roadMesh.type, 0);
      }

      // 远处丘陵：位置/大小都用哈希打散，避免排成锯齿墙
      if (this.hill) {
        const hx0 = center[0], hz0 = center[2];
        for (let i2 = 0; i2 < 34; i2++) {
          const h1 = Math.abs(Math.sin(i2 * 12.9898) * 43758.5453) % 1;
          const h2 = Math.abs(Math.sin(i2 * 78.233 + 3.1) * 24634.6345) % 1;
          const h3 = Math.abs(Math.sin(i2 * 37.719 + 9.7) * 19341.115) % 1;
          const ang = h1 * 6.2832;
          const rad = 380 + h2 * 520;
          const hx = hx0 + Math.cos(ang) * rad;
          const hz = hz0 + Math.sin(ang) * rad;
          const sc = 90 + h3 * 160;
          const hh = 22 + h2 * 55;
          const m2 = M4.mul(M4.trans(hx, -2, hz), M4.scale(sc, hh, sc));
          gl.uniformMatrix4fv(this.U.uMVP, false, M4.mul(vp, m2));
          gl.uniformMatrix4fv(this.U.uModel, false, m2);
          gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(m2));
          gl.uniform3f(this.U.uColorMul, 0.86 + h1 * 0.28, 0.84 + h2 * 0.24, 0.80 + h3 * 0.22);
          this.use(this.hill);
          gl.drawElements(gl.TRIANGLES, this.hill.count, this.hill.type, 0);
        }
        gl.uniform3f(this.U.uColorMul, 1, 1, 1);
      }

      // 站台（含废弃站台）
      this.drawPlatforms(midS, run);

      // 路边植被与杂物：沿铁路程序化生成，保证密度和纵深
      if (this.mesh.tree) {
        const rnd = function (v) { const x = Math.sin(v * 127.1) * 43758.5453; return x - Math.floor(x); };
        const p0 = Math.max(0, midS - 320), p1 = Math.min(path.len, midS + 320);
        for (let ss = Math.floor(p0 / 11) * 11; ss < p1; ss += 11) {
          const h1 = rnd(ss * 0.013), h2 = rnd(ss * 0.031 + 7);
          if (h1 > 0.62) continue;
          const side = (ss % 22 === 0) ? 1 : -1;
          const lat = 13 + h2 * 95;
          U.posAt(path, ss, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const px = tmp.x + nx * lat * side, pz = tmp.y + ny * lat * side;
          const dxx = px - center[0], dzz = pz - center[2];
          if (dxx * dxx + dzz * dzz > 300 * 300) continue;
          const sc = 0.7 + h1 * 1.5;
          const tp = this.pal().tree || ["#2b3a2b"];
          const tc = tp[(Math.floor(ss) % tp.length + tp.length) % tp.length];
          this.gl.uniform3f(this.U.uColorMul, 1, 1, 1);
          const tm = this.palTint(tc, [0.24, 0.30, 0.22]);
          this.gl.uniform3fv(this.U.uColorMul, tm);
          this.drawModel(this.mesh.tree, px, 0, pz, h2 * 6.28, sc);
        }
      }

      // 报废车辆：散在路基两侧，贴地
      if (this.mesh.cargo) {
        const rnd2 = function (v) { const x = Math.sin(v * 91.7) * 24573.13; return x - Math.floor(x); };
        const q0 = Math.max(0, midS - 260), q1 = Math.min(path.len, midS + 260);
        for (let ss = Math.floor(q0 / 37) * 37; ss < q1; ss += 37) {
          const h = rnd2(ss * 0.07);
          if (h > 0.45) continue;
          const side = h > 0.22 ? 1 : -1;
          const lat = 9 + h * 30;
          U.posAt(path, ss, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          this.gl.uniform3f(this.U.uColorMul, 0.34, 0.30, 0.25);
          this.drawModel(this.mesh.cargo, tmp.x + nx * lat * side, -0.9, tmp.y + ny * lat * side, tmp.a + h * 3, 0.26);
          this.gl.uniform3f(this.U.uColorMul, 1, 1, 1);
        }
      }


      // 丧尸（用 zombie.glb）：按类型缩放、朝列车转身、按距离裁剪
      const ZM = this.mesh.zombie;
      if (ZM && Z.Zombies && Z.Zombies.list) {
        const sc0 = center[0], sc2 = center[2];
        let zn = 0;
        for (const zb of Z.Zombies.list) {
          if (zn >= 70) continue;
          if (zb.dead) {
            // 死亡：先原地挺一下就往下沉，1.1 秒后消失
            if (zb.deadT > 1.1) continue;
            const k2 = Math.min(1, zb.deadT / 1.1);
            this.drawModel(ZM, zb.x, -k2 * 1.6, zb.y, Math.atan2(sc0 - zb.x, sc2 - zb.y),
              (zb.boss ? 2.3 : zb.mini ? 1.7 : zb.elite ? 1.25 : 1) * (1 - k2 * 0.25), 0);
            zn++;
            continue;
          }
          const dx = zb.x - sc0, dz = zb.y - sc2;
          const d2 = dx * dx + dz * dz;
          if (d2 > 190 * 190) continue;
          const rot = Math.atan2(sc0 - zb.x, sc2 - zb.y);   // 模型正面是 +Z
          const big = zb.boss ? 2.3 : zb.mini ? 1.7 : zb.elite ? 1.25 : 1;
          const bob = Math.sin(zb.phase * 2) * 0.06;
          const windup = zb.atk > 0 ? (1 + (1 - zb.atk / (zb.atkMax || 0.45)) * 0.22) : 1;
          const fl = Math.min(1, zb.flash || 0);
          const sc = big * windup;
          const base = M4.mul(M4.mul(M4.trans(zb.x, bob, zb.y), M4.rotY(rot)), M4.scale(sc, sc, sc));
          const B = this.mesh.zbody, LG = this.mesh.zleg, AR = this.mesh.zarm;
          if (B && LG && AR) {
            const sw = Math.sin(zb.phase) * 0.55;
            this.drawModelMat(B, base, fl);
            this.drawModelMat(LG, M4.mul(M4.mul(base, M4.trans(-0.2, 0.95, 0)), M4.rotX(sw)), fl);
            this.drawModelMat(LG, M4.mul(M4.mul(base, M4.trans(0.2, 0.95, 0)), M4.rotX(-sw)), fl);
            this.drawModelMat(AR, M4.mul(M4.mul(base, M4.trans(-0.42, 1.42, 0)), M4.rotX(-sw * 0.6)), fl);
            this.drawModelMat(AR, M4.mul(M4.mul(base, M4.trans(0.42, 1.42, 0)), M4.rotX(sw * 0.6)), fl);
          } else {
            this.drawModel(ZM, zb.x, bob, zb.y, rot, sc, fl);
          }
          zn++;
        }
      }

      // 车顶炮塔：跟着武器的瞄准角转
      if (this.mesh.turret) {
        for (let k = 0; k < n; k++) {
          const car = cars[k];
          if (!car || car.dead) continue;
          const s2 = midS + ((n - 1) / 2 - k) * pitch;
          if (s2 < 0 || s2 > path.len) continue;
          U.posAt(path, s2, tmp);
          for (let si = 0; si < car.slots.length; si++) {
            const w = car.slots[si];
            if (!w) continue;
            // 沿车身纵向排位（与 2D 挂点的 ±4.5 m 一致），两个炮塔不会叠在一起
            const off = (si - (car.slots.length - 1) / 2) * 9.0;   // 纵向 ±4.5
            const latOff = 0;                                   // 居中：炮塔比车宽，偏一点就会探出车边
            const px = tmp.x + Math.cos(tmp.a) * off - Math.sin(tmp.a) * latOff;
            const pz = tmp.y + Math.sin(tmp.a) * off + Math.cos(tmp.a) * latOff;
            // 炮塔四件：底座圈（不转）→ 回转台（yaw）→ 炮管（yaw + 俯仰）
            // 外观按武器种类区分（机枪/喷火/近防/电磁/迫击）
            const kind = w.k || 'mg';
            const bodyMesh = this.mesh['t_' + kind] || this.mesh.turret_body;
            const barrelMesh = this.mesh['t_' + kind + '_b'] || this.mesh.turret_barrel;
            const yaw = -w.aim;
            if (this.mesh.turret_base) this.drawModel(this.mesh.turret_base, px, 3.42, pz, yaw, 1);
            const bodyM = M4.mul(M4.trans(px, 3.52, pz), M4.rotY(yaw));
            this.drawModelMat(bodyMesh, bodyM, 0);
            // 迫击炮仰角大、电磁微仰，其余平射
            const basePitch = kind === 'mortar' ? 0.85 : (kind === 'tesla' ? 0.14 : 0.05);
            const recoil = Math.max(0, Math.min(0.16, (w.cool || 0) * 0.5));
            const piv = M4.mul(bodyM, M4.trans(kind === 'tesla' ? 0.5 : 0.75, 0.55, 0));
            this.drawModelMat(barrelMesh, M4.mul(piv, M4.rotX(basePitch - recoil)), 0);
          }
        }
      }

      // 曳光弹（复用 2D 的 Fx 数据，转成 3D 线段）
      this.drawBlasts(vp);
      this.drawTracers(vp);

      // 路边建筑（用 building.glb 摆到废墟位置，近处才画）
      if (this.mesh.building && Z.World.ruins) {
        let drawn = 0;
        const cx = center[0], cz = center[2];
        for (const b of Z.World.ruins) {
          if (drawn >= 16) break;
          const dx = b.x - cx, dz = b.y - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > 170 * 170 || d2 < 26 * 26) continue;
          const usc = Math.max(0.45, b.h / 15);
          const model = M4.mul(M4.mul(M4.trans(b.x, 0, b.y), M4.rotY(-b.rot)), M4.scale(usc, usc, usc));
          const mvp = M4.mul(vp, model);
          gl.uniformMatrix4fv(this.U.uMVP, false, mvp);
          gl.uniformMatrix4fv(this.U.uModel, false, model);
          gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
          // 每栋楼自己的配色：色系 × 明度抖动（同一关卡的楼才不会千篇一律）
          const h1 = Math.abs(Math.sin(b.x * 12.9898 + b.y * 78.233) * 43758.5453) % 1;
          const h2 = Math.abs(Math.sin(b.y * 39.346 + b.x * 11.135) * 24634.6345) % 1;
const TINTS = [
            [1.12, 1.10, 1.06],   // 冷灰
            [1.62, 1.34, 0.96],   // 土黄
            [0.82, 0.98, 1.48],   // 蓝灰
            [1.58, 1.02, 0.84],   // 砖红
            [0.78, 0.78, 0.78],   // 深灰
            [1.40, 1.30, 0.98],   // 米黄
            [1.02, 1.06, 0.98]    // 原色
          ];
          const tc = TINTS[Math.floor(h1 * TINTS.length) % TINTS.length];
          const br = 0.92 + h2 * 0.55;                 // 明暗差异 0.92~1.47
          this.gl.uniform3f(this.U.uColorMul,
            Math.min(2.2, tc[0] * br), Math.min(2.2, tc[1] * br), Math.min(2.2, tc[2] * br));
          // 一部分楼在烧：记下来，等所有建筑画完再统一画火和烟
          const fh = h1;
          if (fh < 0.55) this._burn.push([b.x, b.y, Math.max(0.55, b.h / 16), b.h * usc]);
          this.use(this.mesh.building);
          gl.drawElements(gl.TRIANGLES, this.mesh.building.count, this.mesh.building.type, 0);
          drawn++;
          this.gl.uniform3f(this.U.uColorMul, 1, 1, 1);
        }

      if (this._burn && this._burn.length) this.drawBurn(vp, this._burn, performance.now());
      }

      // 列车
      // 各车型的车顶高度：顶面带子要落在车顶上，不能飘也不能陷进去
      const MAP = { engine: 'engine', passenger: 'passenger', cargo: 'cargo', weapon: 'weapon', power: 'power', armor: 'armor', repair: 'repair' };
      for (let k = 0; k < n; k++) {
        const car = cars[k];
        if (!car || car.dead) continue;
        const s = midS + ((n - 1) / 2 - k) * pitch;
        if (s < 0 || s > path.len) continue;
        U.posAt(path, s, tmp);
        const mesh = this.mesh[MAP[car.type] || 'cargo'];
        if (!mesh) continue;
        // 用 2D 的车厢配色染色，并走 drawModel 以获得接触阴影
        this.drawModel(mesh, tmp.x, 0, tmp.y, -tmp.a, 1, 0);
      }
    },

    // 着火的楼：火光 + 烟柱（加色混合，画在建筑之后）
    drawBurn: function (vp, list, now) {
      if (!list.length || !this.cube) return;
      const gl = this.gl;
      const cube = this.cube;
      const t = now / 1000;
      const self = this;
      gl.disable(gl.DEPTH_TEST);          // 火光烟雾不受楼体遮挡
      const put = function (x, y, z, sx, sy, sz, r, g, b, a) {
        const m = M4.mul(M4.trans(x, y, z), M4.scale(sx, sy, sz));
        gl.uniformMatrix4fv(self.U.uMVP, false, M4.mul(vp, m));
        gl.uniformMatrix4fv(self.U.uModel, false, m);
        gl.uniformMatrix3fv(self.U.uNrm, false, M4.nrm(m));
        gl.uniform1f(self.U.uFlash, 0);
        gl.uniform3f(self.U.uColorMul, r, g, b);
        gl.uniform1f(self.U.uAlpha, a);
        self.use(cube);
        gl.drawElements(gl.TRIANGLES, cube.count, cube.type, 0);
      };

      // 第一遍：火苗（加色混合）
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      for (let n = 0; n < list.length; n++) {
        const p = list[n], x = p[0], z = p[1], s = p[2], hy = p[3] || 9;
        const baseY = Math.max(1.0, hy * 0.62);
        for (let i = 0; i < 5; i++) {
          const ph = (t * 2.4 + i * 0.43) % 1;
          const jx = (i - 2) * 0.85 * s + Math.sin(t * 3 + i * 2.1) * 0.5 * s;
          const sz = (0.55 + s * 0.75) * (1 - ph * 0.5);
          // 芯部偏黄、外焰偏橙
          const warm = 1 - ph;
          put(x + jx, baseY + ph * 4.2 * s, z,
            sz, sz * 2.1, sz,
            1.0, 0.35 + warm * 0.45, 0.05 + warm * 0.25, (1 - ph) * 0.75);
        }
      }

      // 第二遍：烟柱（普通混合，暗色上升）
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (let n = 0; n < list.length; n++) {
        const p = list[n], x = p[0], z = p[1], s = p[2], hy = p[3] || 9;
        const baseY = Math.max(1.4, hy * 0.85);
        for (let i = 0; i < 5; i++) {
          const ph = (t * 0.22 + i * 0.2) % 1;
          const sz = (1.4 + ph * 6.5) * s;
          put(x + Math.sin(t * 0.7 + i * 1.7) * 2.2 * s, baseY + ph * 20 * s, z,
            sz, sz * 0.85, sz, 0.13, 0.125, 0.12, (1 - ph) * 0.42);
        }
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1f(gl.getUniformLocation ? this.U.uAlpha : this.U.uAlpha, 1);
      gl.uniform1f(this.U.uAlpha, 1);
      gl.uniform3f(this.U.uColorMul, 1, 1, 1);
    },

    // 炮口火光 / 爆炸：复用 2D 的 Fx 数据，画成发光体
    drawBlasts: function (vp) {
      const gl = this.gl;
      const list = (Z.Fx && Z.Fx.list) ? Z.Fx.list : null;
      if (!list || !list.length || !this.cube) return;   // 没特效就早退，别改动 GL 状态
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      for (const fx of list) {
        if (fx.kind !== 'flash' && fx.kind !== 'boom') continue;
        const o = fx.o;
        const k = Math.min(1, fx.t / fx.dur);
        const alpha = 1 - k;
        if (alpha <= 0.02) continue;
        let scls;
        if (fx.kind === 'flash') scls = (0.5 + k * 0.9) * (o.r || 3) * 0.30;
        else scls = (o.r || 12) * (0.30 + k * 0.55) * 0.34;
        const m = M4.mul(M4.trans(o.x, o.h || 2.4, o.y), M4.scale(scls, scls, scls));
        gl.uniformMatrix4fv(this.U.uMVP, false, M4.mul(vp, m));
        gl.uniformMatrix4fv(this.U.uModel, false, m);
        gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(m));
        gl.uniform1f(this.U.uFlash, Math.min(1, alpha * 0.85 + 0.15));
        gl.uniform1f(this.U.uAlpha, Math.min(0.92, alpha * 0.9));
        this.use(this.cube);
        gl.drawElements(gl.TRIANGLES, this.cube.count, this.cube.type, 0);
      }
      gl.uniform1f(this.U.uFlash, 0);
      gl.uniform1f(this.U.uAlpha, 1);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },


    drawTracers: function (vp) {
      const list = (Z.Fx && Z.Fx.list) ? Z.Fx.list : null;
      if (!list || !list.length) return;
      const pos = [], col = [];
      const hexRgb = function (h) {
        if (typeof h !== 'string' || h[0] !== '#') return [1, 0.8, 0.4];
        const v = parseInt(h.slice(1), 16);
        return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
      };
      for (const f of list) {
        if (f.kind !== 'tracer') continue;
        const o = f.o;
        const k = Math.min(1, f.t / f.dur);
        const a = Math.max(0, 1 - k);
        const c = hexRgb(o.color);
        pos.push(o.x0, o.h0 || 2.2, o.y0, o.x1, o.h1 || 2.2, o.y1);
        col.push(c[0] * a, c[1] * a, c[2] * a, c[0] * a, c[1] * a, c[2] * a);
      }
      if (!pos.length) return;
      const gl = this.gl, A = this.A;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineCol);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 0, 0);
      // 法线给个固定值，避免残留缓冲
      gl.disableVertexAttribArray(A.nor);
      gl.vertexAttrib3f(A.nor, 0, 1, 0);
      const model = M4.ident();
      gl.uniformMatrix4fv(this.U.uMVP, false, vp);
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
      gl.drawArrays(gl.LINES, 0, pos.length / 3);
      // 恢复法线属性（后续模型要用）
      gl.enableVertexAttribArray(A.nor);
    },

    // 通用：摆一个模型
    // 直接给矩阵绘制（骨骼/部件用）
    // 用单位立方体画一个长方体（站台/雨棚/立柱都走这个）
    box: function (x, y, z, sx, sy, sz, rot, r, g, b, a) {
      if (!this.cube) return;
      const gl = this.gl;
      const m = M4.mul(M4.mul(M4.trans(x, y, z), M4.rotY(rot || 0)), M4.scale(sx, sy, sz));
      gl.uniformMatrix4fv(this.U.uMVP, false, M4.mul(this.vp, m));
      gl.uniformMatrix4fv(this.U.uModel, false, m);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(m));
      gl.uniform1f(this.U.uFlash, 0);
      gl.uniform3f(this.U.uColorMul, r, g, b);
      gl.uniform1f(this.U.uAlpha, a == null ? 1 : a);
      this.use(this.cube);
      gl.drawElements(gl.TRIANGLES, this.cube.count, this.cube.type, 0);
      gl.uniform1f(this.U.uAlpha, 1);
      gl.uniform3f(this.U.uColorMul, 1, 1, 1);
    },

    // 站台：普通站是完整雨棚，废弃站缺柱缺顶、留一地碎块
    drawPlatforms: function (midS, run) {
      if (!this.cube) return;
      const path = Z.World.path, tmp = {};
      const list = [];
      for (const fr of (Z.CFG.STATION_AT || [])) list.push({ s: fr * run.totalKm, ruin: false });
      if (run.abandon) list.push({ s: run.abandon.s, ruin: true });
      for (const st of list) {
        if (Math.abs(st.s - midS) > 430) continue;
        const L = st.ruin ? 48 : 66;
        const lat = 6.4;
        const r = st.ruin ? 0.26 : 0.44, gg = st.ruin ? 0.25 : 0.44, bb = st.ruin ? 0.23 : 0.42;
        let seg = 0;
        for (let s = st.s - L / 2; s <= st.s + L / 2; s += 6) {
          if (s < 0 || s > path.len) continue;
          Z.U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          const px = tmp.x + nx * lat, pz = tmp.y + ny * lat;
          // 站台本体
          this.box(px, 0.55, pz, 6.2, 1.1, 6.4, tmp.a, r, gg, bb);
          // 靠轨道一侧的黄色安全线
          this.box(tmp.x + nx * (lat - 2.9), 1.12, tmp.y + ny * (lat - 2.9), 5.8, 0.06, 0.35, tmp.a,
            st.ruin ? 0.30 : 0.78, st.ruin ? 0.26 : 0.60, st.ruin ? 0.10 : 0.18);
          // 雨棚（废弃站台隔一段塌一块）
          if (!st.ruin || seg % 3 !== 0) {
            this.box(tmp.x + nx * (lat + 0.2), 5.0, tmp.y + ny * (lat + 0.2), 6.4, 0.28, 7.4, tmp.a,
              st.ruin ? 0.20 : 0.30, st.ruin ? 0.19 : 0.32, st.ruin ? 0.18 : 0.34);
          }
          // 立柱：双排，废弃站缺一半
          if (seg % 2 === 0 || !st.ruin) {
            for (const dl of [-2.6, 3.0]) {
              if (st.ruin && (seg + dl) % 5 === 0) continue;
              this.box(tmp.x + nx * (lat + dl), 3.0, tmp.y + ny * (lat + dl), 0.34, 3.8, 0.34, tmp.a,
                st.ruin ? 0.22 : 0.38, st.ruin ? 0.21 : 0.38, st.ruin ? 0.20 : 0.36);
            }
          }
          // 废弃站台：地上散落碎块
          if (st.ruin && seg % 2 === 1) {
            this.box(px + 1.2, 0.35, pz - 1.0, 1.1, 0.7, 0.9, tmp.a + 0.4, 0.24, 0.23, 0.21);
            this.box(px - 1.6, 0.28, pz + 1.4, 0.8, 0.55, 1.2, tmp.a - 0.3, 0.21, 0.20, 0.19);
          }
          seg++;
        }
        // ============ 站房（火车站主体） ============
        if (st.s > 0 && st.s < path.len) {
          Z.U.posAt(path, st.s, tmp);
          const a = tmp.a;
          const nx = -Math.sin(a), ny = Math.cos(a);
          const ax = Math.cos(a), ay = Math.sin(a);
          const hallLat = st.ruin ? 17 : 15.5;
          const hx = tmp.x + nx * hallLat, hz = tmp.y + ny * hallLat;
          // 沿站房局部坐标摆东西：offL 纵向、offLat 横向
          const at = (offL, offLat, y) => [
            hx + ax * offL + nx * offLat,
            y,
            hz + ay * offL + ny * offLat
          ];
          const wallR = st.ruin ? 0.24 : 0.46, wallG = st.ruin ? 0.23 : 0.45, wallB = st.ruin ? 0.21 : 0.43;
          const hallH = st.ruin ? 5.0 : 8.0;

          // 主楼
          let p = at(0, 0, hallH / 2);
          this.box(p[0], p[1], p[2], 26, hallH, 13, a, wallR, wallG, wallB);
          // 基座
          p = at(0, 0, 0.5);
          this.box(p[0], p[1], p[2], 27, 1.0, 14, a, wallR * 1.15, wallG * 1.15, wallB * 1.15);
          // 檐口（废弃站塌了）
          if (!st.ruin) {
            p = at(0, 0, hallH + 0.35);
            this.box(p[0], p[1], p[2], 27.4, 0.7, 14.2, a, 0.32, 0.31, 0.30);
            // 大门雨棚
            p = at(0, -6.2, 4.6);
            this.box(p[0], p[1], p[2], 9, 0.4, 3.2, a, 0.30, 0.29, 0.28);
          }
          // 门
          p = at(0, -6.45, 2.2);
          this.box(p[0], p[1], p[2], 5.4, 4.4, 0.3, a, 0.12, 0.13, 0.14);
          p = at(0, -6.6, 4.0);
          this.box(p[0], p[1], p[2], 6.0, 0.5, 0.25, a, 0.72, 0.58, 0.28);   // 站名牌

          // 窗：两排，废弃站只剩零散几个
          for (let wi = 0; wi < 6; wi++) {
            if (st.ruin && (wi === 1 || wi === 4)) continue;
            const offL = (wi - 2.5) * 4.1;
            for (const wy of st.ruin ? [2.6] : [2.4, 5.4]) {
              p = at(offL, -6.55, wy);
              this.box(p[0], p[1], p[2], 2.2, 1.7, 0.22, a, 0.20, 0.26, 0.31);
              if (!st.ruin) {
                p = at(offL, -6.7, wy);
                this.box(p[0], p[1], p[2], 2.4, 1.9, 0.10, a, 0.56, 0.56, 0.54);
              }
            }
          }

          // 钟楼（只有完好的站有）
          if (!st.ruin) {
            p = at(0, 0, hallH + 4.2);
            this.box(p[0], p[1], p[2], 5.4, 8.4, 5.4, a, 0.44, 0.43, 0.41);
            p = at(0, 0, hallH + 8.6);
            this.box(p[0], p[1], p[2], 6.4, 0.8, 6.4, a, 0.34, 0.33, 0.32);
            p = at(0, 0, hallH + 9.6);
            this.box(p[0], p[1], p[2], 3.6, 1.4, 3.6, a, 0.30, 0.29, 0.28);
            // 钟面（四面各一块亮片）
            for (const side of [-1, 1]) {
              p = at(0, side * 2.75, hallH + 5.4);
              this.box(p[0], p[1], p[2], 2.6, 2.6, 0.14, a, 0.86, 0.82, 0.62);
            }
            p = at(2.75, 0, hallH + 5.4);
            this.box(p[0], p[1], p[2], 0.14, 2.6, 2.6, a, 0.86, 0.82, 0.62);
            p = at(-2.75, 0, hallH + 5.4);
            this.box(p[0], p[1], p[2], 0.14, 2.6, 2.6, a, 0.86, 0.82, 0.62);
          } else {
            // 废弃站：半截塌掉的塔基 + 碎块
            p = at(0, 0, hallH + 1.4);
            this.box(p[0], p[1], p[2], 5.4, 2.8, 5.4, a, 0.22, 0.21, 0.20);
            for (let rb = 0; rb < 5; rb++) {
              p = at(-6 + rb * 3, -8.5 + (rb % 2) * 1.6, 0.3);
              this.box(p[0], p[1], p[2], 1.4, 0.6, 1.1, a, 0.20, 0.19, 0.18);
            }
          }
        }


      }
    },

    drawModelMat: function (mesh, mat, flash) {
      if (!mesh) return;
      const gl = this.gl;
      gl.uniform1f(this.U.uFlash, flash || 0);
      gl.uniformMatrix4fv(this.U.uMVP, false, M4.mul(this.vp, mat));
      gl.uniformMatrix4fv(this.U.uModel, false, mat);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(mat));
      this.use(mesh);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    },

    drawModel: function (mesh, x, y, z, rot, scl, flash) {
      // 接触阴影：压扁的暗色方块，把物件按在地上
      if (this.cube) {
        const g0 = this.gl;
        g0.enable(g0.BLEND);
        g0.blendFunc(g0.SRC_ALPHA, g0.ONE_MINUS_SRC_ALPHA);
        g0.depthMask(false);
        g0.uniform3f(this.U.uColorMul, 0.05, 0.045, 0.04);
        g0.uniform1f(this.U.uAlpha, 0.5);
        g0.uniform1f(this.U.uFlash, 0);
        const k2 = scl || 1;
        const sw = Math.max(0.6, (mesh.w || 3) * k2 * 0.55);
        const sd = Math.max(0.6, (mesh.d || 3) * k2 * 0.55);
        const sm = M4.mul(M4.mul(M4.trans(x, 0.04, z), M4.rotY(rot)), M4.scale(sw, 0.02, sd));
        g0.uniformMatrix4fv(this.U.uMVP, false, M4.mul(this.vp, sm));
        g0.uniformMatrix4fv(this.U.uModel, false, sm);
        g0.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(sm));
        this.use(this.cube);
        g0.drawElements(g0.TRIANGLES, this.cube.count, this.cube.type, 0);
        g0.depthMask(true);
        g0.disable(g0.BLEND);
        g0.uniform1f(this.U.uAlpha, 1);
        g0.uniform3f(this.U.uColorMul, 1, 1, 1);
      }
      if (!mesh) return;
      const gl = this.gl;
      gl.uniform1f(this.U.uFlash, flash || 0);
      let model = M4.mul(M4.trans(x, y, z), M4.rotY(rot));
      if (scl && scl !== 1) model = M4.mul(model, M4.scale(scl, scl, scl));
      const mvp = M4.mul(this.vp, model);
      gl.uniformMatrix4fv(this.U.uMVP, false, mvp);
      gl.uniformMatrix4fv(this.U.uModel, false, model);
      gl.uniformMatrix3fv(this.U.uNrm, false, M4.nrm(model));
      this.use(mesh);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    },

    // 自由视角：拖拽旋转 / 滚轮缩放 / 双击回到追车视角
    bindCamera: function () {
      if (this._camBound || !this.cv) return;
      this._camBound = true;
      const cv = this.cv;
      let drag = false, lx = 0, ly = 0;
      const cam = this.cam || (this.cam = { yaw: 0, pitch: 0.30, dist: 60, manual: false });
      cv.style.touchAction = "none";
      cv.addEventListener("pointerdown", function (e) {
        drag = true; lx = e.clientX; ly = e.clientY;
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      });
      cv.addEventListener("pointerup", function () { drag = false; });
      cv.addEventListener("pointercancel", function () { drag = false; });
      cv.addEventListener("pointermove", function (e) {
        if (!drag) return;
        cam.yaw -= (e.clientX - lx) * 0.008;
        cam.pitch = Math.max(0.04, Math.min(1.35, cam.pitch + (e.clientY - ly) * 0.006));
        cam.manual = true;
        lx = e.clientX; ly = e.clientY;
      });
      cv.addEventListener("wheel", function (e) {
        e.preventDefault();
        cam.dist = Math.max(14, Math.min(260, cam.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
        cam.manual = true;
      }, { passive: false });
      cv.addEventListener("dblclick", function () { cam.manual = false; });
    },

    setMode: function (on) {
      if (on && !this.init()) return false;
      this.on = !!on;
      const c2 = document.getElementById('map');
      const c3 = document.getElementById('map3d');
      if (c2) c2.style.display = on ? 'none' : '';
      if (c3) c3.style.display = on ? 'block' : 'none';
      if (on) this.resize();
      if (on) this.bindCamera();
      return true;
    }
  };
})(window.ZT);
