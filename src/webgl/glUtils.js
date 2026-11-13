/**
 * Raw WebGL2 helpers: shader compilation, texture loading, and procedural geometry builders.
 */

export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    const kind = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
    gl.deleteShader(shader);
    throw new Error(`${kind} shader compile error:\n${info}`);
  }
  return shader;
}

export function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${info}`);
  }

  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) {
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
  }
  return { program, uniforms };
}

export function loadTexture2D(gl, url, options = {}) {
  const {
    wrapS = gl.REPEAT,
    wrapT = gl.CLAMP_TO_EDGE,
    flipY = true,
    anisotropy = true,
  } = options;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // 1x1 dark fallback pixel while image loads
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([24, 28, 38, 255])
  );

  const extAniso = anisotropy
    ? gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
    : null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      if (extAniso) {
        const maxAniso = gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(
          gl.TEXTURE_2D,
          extAniso.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(8, maxAniso)
        );
      }
      resolve(texture);
    };
    img.onerror = () => {
      console.warn(`Failed to load texture: ${url}`);
      resolve(texture);
    };
    img.src = url;
  });
}

/**
 * Generates a unit sphere with outward CCW winding, normals, and equirectangular UVs.
 */
export function createSphereGeometry(gl, latBands = 64, lonBands = 96) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const v = 1.0 - lat / latBands;

    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;
      const u = 1.0 - lon / lonBands;

      positions.push(x, y, z);
      normals.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon;
      const second = first + lonBands + 1;
      indices.push(first, first + 1, second);
      indices.push(second, first + 1, second + 1);
    }
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {
    vao,
    indexCount: indices.length,
    indexType: gl.UNSIGNED_INT,
  };
}

/**
 * Generates an annulus (ring) in the XZ plane with radial UVs (u=0 inner, u=1 outer).
 */
export function createRingGeometry(gl, innerRadius, outerRadius, segments = 160) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const v = i / segments;

    positions.push(c * innerRadius, 0, s * innerRadius);
    uvs.push(0.0, v);

    positions.push(c * outerRadius, 0, s * outerRadius);
    uvs.push(1.0, v);
  }

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 2, base + 1, base + 3);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {
    vao,
    indexCount: indices.length,
    indexType: gl.UNSIGNED_SHORT,
  };
}

/**
 * Generates an elliptical inclined orbital track with angle attribute for directional fade.
 */
export function createOrbitGeometry(gl, body, segments = 256) {
  const positions = [];
  const angles = [];

  const a = body.orbitRadius;
  const e = body.eccentricity || 0;
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;
  const incRad = ((body.inclinationDeg || 0) * Math.PI) / 180;
  const sinInc = Math.sin(incRad);
  const cosInc = Math.cos(incRad);

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const lx = Math.cos(angle) * a - c;
    const lz = Math.sin(angle) * b;

    positions.push(lx, lz * sinInc, lz * cosInc);
    angles.push(angle);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const angBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, angBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(angles), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  return {
    vao,
    vertexCount: segments + 1,
  };
}

/**
 * Generates thousands of spectral stars on a distant celestial sphere.
 */
export function createStarfieldGeometry(gl, count = 4200, radius = 480) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const spectralPalette = [
    [0.68, 0.80, 1.0], // O/B blue-white
    [0.86, 0.91, 1.0], // A white-blue
    [1.0, 0.98, 0.94], // F/G warm white
    [1.0, 0.88, 0.72], // K pale orange
    [1.0, 0.74, 0.56], // M warm amber
  ];

  // Deterministic pseudo-random for reproducible sky
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);

    // Slight concentration near galactic plane
    const r = radius + (rand() - 0.5) * 40;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const tint = spectralPalette[Math.floor(rand() * spectralPalette.length)];
    const brightness = 0.45 + Math.pow(rand(), 2.2) * 0.95;
    colors[i * 3] = tint[0] * brightness;
    colors[i * 3 + 1] = tint[1] * brightness;
    colors[i * 3 + 2] = tint[2] * brightness;

    sizes[i] = 1.2 + Math.pow(rand(), 4.0) * 4.2;
    phases[i] = rand() * Math.PI * 2;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const addAttrib = (loc, data, size) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  addAttrib(0, positions, 3);
  addAttrib(1, colors, 3);
  addAttrib(2, sizes, 1);
  addAttrib(3, phases, 1);

  gl.bindVertexArray(null);

  return { vao, count };
}

/**
 * Generates an instanced 3D rocky asteroid belt between Mars and Jupiter.
 */
export function createAsteroidBeltGeometry(gl, instanceCount = 1500) {
  // Base irregular polyhedron (displaced icosahedron)
  const t = (1 + Math.sqrt(5)) / 2;
  const rawVerts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  // Displace vertices slightly for rocky silhouette and compute flat face normals
  const displaced = rawVerts.map((v, idx) => {
    const len = Math.hypot(v[0], v[1], v[2]);
    const jitter = 0.8 + 0.35 * Math.sin(idx * 2.17 + 0.5);
    return [(v[0] / len) * jitter, (v[1] / len) * jitter, (v[2] / len) * jitter];
  });

  const positions = [];
  const normals = [];

  for (const [ia, ib, ic] of faces) {
    const a = displaced[ia];
    const b = displaced[ib];
    const c = displaced[ic];

    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

    positions.push(...a, ...b, ...c);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  // Instance attributes:
  // aOrbitData: (orbitRadius, initialAngle, orbitSpeed, yOffset)
  // aVisualData: (scale, tumbleSpeed, tintShade, phase)
  const orbitData = new Float32Array(instanceCount * 4);
  const visualData = new Float32Array(instanceCount * 4);

  let seed = 9001;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < instanceCount; i++) {
    const r = 41.0 + rand() * 8.5;
    const angle = rand() * Math.PI * 2;
    const speed = 0.075 + (45.0 / r) * 0.035;
    const yOff = (rand() - 0.5) * 1.65 * (1.0 - Math.abs(r - 45.2) / 7.5);

    orbitData[i * 4] = r;
    orbitData[i * 4 + 1] = angle;
    orbitData[i * 4 + 2] = speed;
    orbitData[i * 4 + 3] = yOff;

    const scale = 0.045 + Math.pow(rand(), 3.2) * 0.16;
    const tumble = (rand() - 0.5) * 1.6;
    const shade = 0.55 + rand() * 0.55;
    const phase = rand() * Math.PI * 2;

    visualData[i * 4] = scale;
    visualData[i * 4 + 1] = tumble;
    visualData[i * 4 + 2] = shade;
    visualData[i * 4 + 3] = phase;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const instOrbitBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instOrbitBuf);
  gl.bufferData(gl.ARRAY_BUFFER, orbitData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  const instVisualBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instVisualBuf);
  gl.bufferData(gl.ARRAY_BUFFER, visualData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  return {
    vao,
    vertexCount: positions.length / 3,
    instanceCount,
  };
}

/**
 * Generates a full-screen quad for post-processing and billboard corona passes.
 */
export function createQuadGeometry(gl) {
  const vertices = new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1,
  ]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);
  return { vao, vertexCount: 4 };
}

/**
 * Generates a detailed 3D International Space Station (ISS) mesh:
 * integrated truss, 8 photovoltaic solar wings, pressurized habitat/lab modules,
 * docked nodes, and thermal radiators.
 * Attributes:
 *   0: aPosition (vec3)
 *   1: aNormal   (vec3)
 *   2: aColor    (vec3)
 *   3: aMatType  (float: 0 = white module/radiator, 1 = metallic truss, 2 = solar array)
 */
export function createISSGeometry(gl) {
  const positions = [];
  const normals = [];
  const colors = [];
  const matTypes = [];

  const pushBox = (cx, cy, cz, sx, sy, sz, color, matType) => {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const faces = [
      // +X
      { n: [1, 0, 0], v: [[hx,-hy,hz],[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz]] },
      // -X
      { n: [-1, 0, 0], v: [[-hx,-hy,-hz],[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz]] },
      // +Y
      { n: [0, 1, 0], v: [[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz],[-hx,hy,-hz]] },
      // -Y
      { n: [0, -1, 0], v: [[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz],[-hx,-hy,hz]] },
      // +Z
      { n: [0, 0, 1], v: [[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]] },
      // -Z
      { n: [0, 0, -1], v: [[hx,-hy,-hz],[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz]] },
    ];
    for (const f of faces) {
      const idx = [0, 1, 2, 0, 2, 3];
      for (const k of idx) {
        positions.push(cx + f.v[k][0], cy + f.v[k][1], cz + f.v[k][2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
        colors.push(color[0], color[1], color[2]);
        matTypes.push(matType);
      }
    }
  };

  const pushCylinderZ = (cx, cy, cz, radius, length, segs, color, matType) => {
    const hz = length * 0.5;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const x0 = cx + c0 * radius, y0 = cy + s0 * radius;
      const x1 = cx + c1 * radius, y1 = cy + s1 * radius;

      // Side quad
      positions.push(x0, y0, cz - hz, x1, y1, cz - hz, x1, y1, cz + hz);
      normals.push(c0, s0, 0, c1, s1, 0, c1, s1, 0);
      positions.push(x0, y0, cz - hz, x1, y1, cz + hz, x0, y0, cz + hz);
      normals.push(c0, s0, 0, c1, s1, 0, c0, s0, 0);
      for (let k = 0; k < 6; k++) {
        colors.push(color[0], color[1], color[2]);
        matTypes.push(matType);
      }

      // End caps
      positions.push(cx, cy, cz + hz, x0, y0, cz + hz, x1, y1, cz + hz);
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      positions.push(cx, cy, cz - hz, x1, y1, cz - hz, x0, y0, cz - hz);
      normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
      for (let k = 0; k < 6; k++) {
        colors.push(color[0], color[1], color[2]);
        matTypes.push(matType);
      }
    }
  };

  const trussCol = [0.76, 0.78, 0.82];
  const modWhite = [0.94, 0.95, 0.97];
  const modWarm = [0.88, 0.85, 0.78];
  const solarBlueGold = [0.16, 0.24, 0.44];
  const radiatorCol = [0.96, 0.97, 1.0];

  // 1. Integrated Main Truss (along X)
  pushBox(0, 0, 0, 1.04, 0.032, 0.032, trussCol, 1.0);
  // Central truss keel & cupola node
  pushBox(0, -0.025, 0.02, 0.06, 0.05, 0.06, trussCol, 1.0);

  // 2. Pressurized Habitat & Lab Spine (along Z)
  pushCylinderZ(0, -0.03, 0.04, 0.042, 0.42, 14, modWhite, 0.0);
  // Aft Russian segment (Zarya / Zvezda)
  pushCylinderZ(0, -0.03, -0.22, 0.034, 0.22, 12, modWarm, 0.0);
  // Forward Harmony / Crew Dragon adapter
  pushCylinderZ(0, -0.03, 0.28, 0.028, 0.1, 12, modWhite, 0.0);

  // 3. Port & Starboard Labs (Columbus & Kibo along X near forward node)
  pushBox(0.11, -0.03, 0.12, 0.14, 0.052, 0.052, modWhite, 0.0);
  pushBox(-0.12, -0.03, 0.12, 0.16, 0.054, 0.054, modWhite, 0.0);

  // 4. Thermal Radiators (3 central panels extending -Z)
  for (const rx of [-0.14, 0.14]) {
    pushBox(rx, 0.04, -0.14, 0.055, 0.006, 0.18, radiatorCol, 0.0);
  }

  // 5. Eight Main Solar Array Wings (4 port, 4 starboard)
  const arrayXs = [-0.46, -0.35, 0.35, 0.46];
  for (const ax of arrayXs) {
    // Rotary mast
    pushBox(ax, 0, 0, 0.014, 0.018, 0.78, trussCol, 1.0);
    // Forward & Aft solar blankets
    pushBox(ax, 0.006, 0.21, 0.088, 0.008, 0.34, solarBlueGold, 2.0);
    pushBox(ax, 0.006, -0.21, 0.088, 0.008, 0.34, solarBlueGold, 2.0);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const addBuf = (loc, data, size) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  addBuf(0, positions, 3);
  addBuf(1, normals, 3);
  addBuf(2, colors, 3);
  addBuf(3, matTypes, 1);

  gl.bindVertexArray(null);

  return {
    vao,
    vertexCount: positions.length / 3,
  };
}
