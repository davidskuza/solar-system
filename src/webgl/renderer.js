/**
 * Raw WebGL2 Solar System Renderer with HDR Bloom & ACES Tone Mapping.
 */
import { CELESTIAL_BODIES, SKYBOX_TEXTURE, computeOrbitPosition } from '../data/planets.js';
import { clamp, damp, mat4, vec3 } from '../math.js';
import {
  createAsteroidBeltGeometry,
  createISSGeometry,
  createOrbitGeometry,
  createQuadGeometry,
  createRingGeometry,
  createSphereGeometry,
  createStarfieldGeometry,
  createProgram,
  loadTexture2D,
} from './glUtils.js';
import {
  ASTEROID_FS,
  ASTEROID_VS,
  BLUR_FS,
  BRIGHT_FS,
  CLOUD_FS,
  CLOUD_VS,
  COMPOSITE_FS,
  CORONA_FS,
  CORONA_VS,
  ISS_FS,
  ISS_VS,
  ORBIT_FS,
  ORBIT_VS,
  PLANET_FS,
  PLANET_VS,
  POST_VS,
  RING_FS,
  RING_VS,
  SKYBOX_FS,
  SKYBOX_VS,
  STAR_FS,
  STAR_VS,
  SUN_FS,
  SUN_VS,
} from './shaders.js';

export class SolarSystemRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required for this visualization.');
    }
    this.gl = gl;

    this.hasFloatFBO = Boolean(
      gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
    );
    gl.getExtension('OES_texture_half_float_linear');
    gl.getExtension('OES_texture_float_linear');

    this.useFloatFBO = this.hasFloatFBO;
    this.usePostProcess = true;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.5 : 2);
    this.width = 1;
    this.height = 1;

    this.showOrbits = true;
    this.hoveredId = null;
    this.focusedId = null;

    this.programs = {};
    this.geometries = {};
    this.textures = {};
    this.orbitGeoms = new Map();
    this.ringGeoms = new Map();
    this.bodyStates = new Map();
    this.allBodies = [];

    for (const body of CELESTIAL_BODIES) {
      this.allBodies.push({ body, parent: null });
      if (body.moons) {
        for (const moon of body.moons) {
          this.allBodies.push({ body: moon, parent: body });
        }
      }
    }

    this.fbos = null;
    this._initPrograms();
    this._initGeometries();
    this.resize();
  }

  _initPrograms() {
    const gl = this.gl;
    this.programs.skybox = createProgram(gl, SKYBOX_VS, SKYBOX_FS);
    this.programs.stars = createProgram(gl, STAR_VS, STAR_FS);
    this.programs.sun = createProgram(gl, SUN_VS, SUN_FS);
    this.programs.corona = createProgram(gl, CORONA_VS, CORONA_FS);
    this.programs.planet = createProgram(gl, PLANET_VS, PLANET_FS);
    this.programs.iss = createProgram(gl, ISS_VS, ISS_FS);
    this.programs.cloud = createProgram(gl, CLOUD_VS, CLOUD_FS);
    this.programs.ring = createProgram(gl, RING_VS, RING_FS);
    this.programs.asteroid = createProgram(gl, ASTEROID_VS, ASTEROID_FS);
    this.programs.orbit = createProgram(gl, ORBIT_VS, ORBIT_FS);
    this.programs.bright = createProgram(gl, POST_VS, BRIGHT_FS);
    this.programs.blur = createProgram(gl, POST_VS, BLUR_FS);
    this.programs.composite = createProgram(gl, POST_VS, COMPOSITE_FS);
  }

  _initGeometries() {
    const gl = this.gl;
    this.geometries.sphere = createSphereGeometry(gl, 64, 96);
    this.geometries.iss = createISSGeometry(gl);
    this.geometries.stars = createStarfieldGeometry(gl, 4200, 520);
    this.geometries.asteroids = createAsteroidBeltGeometry(gl, 1500);
    this.geometries.quad = createQuadGeometry(gl);

    for (const { body } of this.allBodies) {
      if (body.orbitRadius > 0) {
        this.orbitGeoms.set(body.id, createOrbitGeometry(gl, body, 256));
      }
      if (body.ringTexture) {
        this.ringGeoms.set(
          body.id,
          createRingGeometry(gl, body.ringInnerRadius, body.ringOuterRadius, 180)
        );
      }
      this.bodyStates.set(body.id, {
        body,
        position: vec3.create(),
        angle: body.initialAngle || 0,
        hoverLerp: 0,
        model: mat4.create(),
        normalMatrix: mat4.create(),
        ringModel: mat4.create(),
        ringInv: mat4.create(),
      });
    }
  }

  async loadAssets(onProgress) {
    const gl = this.gl;
    const queue = [];

    const register = (key, url, opts) => {
      queue.push({ key, url, opts });
    };

    register('skybox', SKYBOX_TEXTURE, { wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE });
    for (const { body } of this.allBodies) {
      if (body.texture) {
        register(body.id, body.texture, { wrapS: gl.REPEAT, wrapT: gl.CLAMP_TO_EDGE });
      }
      if (body.nightTexture) {
        register(`${body.id}_night`, body.nightTexture, {
          wrapS: gl.REPEAT,
          wrapT: gl.CLAMP_TO_EDGE,
        });
      }
      if (body.cloudsTexture) {
        register(`${body.id}_clouds`, body.cloudsTexture, {
          wrapS: gl.REPEAT,
          wrapT: gl.CLAMP_TO_EDGE,
        });
      }
      if (body.ringTexture && !queue.some((q) => q.key === body.ringTexture)) {
        register(body.ringTexture, body.ringTexture, {
          wrapS: gl.CLAMP_TO_EDGE,
          wrapT: gl.CLAMP_TO_EDGE,
        });
      }
    }

    let loaded = 0;
    const total = queue.length;
    await Promise.all(
      queue.map(async ({ key, url, opts }) => {
        const tex = await loadTexture2D(gl, url, opts);
        this.textures[key] = tex;
        loaded += 1;
        if (onProgress) onProgress(loaded / total);
      })
    );
  }

  resize() {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.5 : 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : window.innerWidth;
    const cssH = rect.height > 0 ? rect.height : window.innerHeight;
    const w = Math.max(1, Math.floor(cssW * this.pixelRatio));
    const h = Math.max(1, Math.floor(cssH * this.pixelRatio));

    if (w === this.width && h === this.height && (this.fbos || !this.usePostProcess)) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    this._createFBOs(w, h);
  }

  _deleteFBOs() {
    const gl = this.gl;
    if (!this.fbos) return;
    if (this.fbos.scene) {
      gl.deleteFramebuffer(this.fbos.scene.fbo);
      gl.deleteTexture(this.fbos.scene.tex);
      gl.deleteRenderbuffer(this.fbos.scene.depth);
    }
    for (const b of this.fbos.bloom || []) {
      gl.deleteFramebuffer(b.fbo);
      gl.deleteTexture(b.tex);
    }
    this.fbos = null;
  }

  _tryBuildFBOs(w, h, useFloat, depthFormat) {
    const gl = this.gl;
    const internalFormat = useFloat ? gl.RGBA16F : gl.RGBA8;
    const type = useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    const makeColorTex = (tw, th) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, tw, th, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };

    const sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    const sceneTex = makeColorTex(w, h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);

    const depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, depthFormat, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

    const sceneOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    const bw = Math.max(2, Math.floor(w / 2));
    const bh = Math.max(2, Math.floor(h / 2));
    const bloom = [0, 1].map(() => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const tex = makeColorTex(bw, bh);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      return { fbo, tex, width: bw, height: bh, ok };
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!sceneOk || bloom.some((b) => !b.ok)) {
      gl.deleteFramebuffer(sceneFbo);
      gl.deleteTexture(sceneTex);
      gl.deleteRenderbuffer(depthRb);
      for (const b of bloom) {
        gl.deleteFramebuffer(b.fbo);
        gl.deleteTexture(b.tex);
      }
      return null;
    }

    return {
      scene: { fbo: sceneFbo, tex: sceneTex, depth: depthRb, width: w, height: h },
      bloom,
    };
  }

  _createFBOs(w, h) {
    const gl = this.gl;
    this._deleteFBOs();

    const attempts = [];
    if (this.hasFloatFBO) {
      attempts.push({ useFloat: true, depth: gl.DEPTH_COMPONENT24 });
      attempts.push({ useFloat: true, depth: gl.DEPTH_COMPONENT16 });
    }
    attempts.push({ useFloat: false, depth: gl.DEPTH_COMPONENT24 });
    attempts.push({ useFloat: false, depth: gl.DEPTH_COMPONENT16 });

    for (const cfg of attempts) {
      const built = this._tryBuildFBOs(w, h, cfg.useFloat, cfg.depth);
      if (built) {
        this.fbos = built;
        this.useFloatFBO = cfg.useFloat;
        this.usePostProcess = true;
        return;
      }
    }

    this.useFloatFBO = false;
    this.usePostProcess = false;
    console.warn('FBO post-processing unsupported; rendering directly to default framebuffer.');
  }

  updateSimulation(simTime, dt) {
    for (const { body, parent } of this.allBodies) {
      const state = this.bodyStates.get(body.id);
      const parentPos = parent ? this.bodyStates.get(parent.id).position : null;
      const pos = computeOrbitPosition(body, simTime, parentPos);
      vec3.set(state.position, pos[0], pos[1], pos[2]);
      state.angle = (body.initialAngle || 0) + simTime * (body.orbitSpeed || 0);

      const targetHover = this.hoveredId === body.id ? 1.0 : 0.0;
      state.hoverLerp = damp(state.hoverLerp, targetHover, 12.0, Math.min(dt, 0.05));

      const tiltRad = ((body.axialTiltDeg || 0) * Math.PI) / 180;
      const spinRad = simTime * (body.rotationSpeed || 0);

      // Ring / axial frame (without spin)
      mat4.identity(state.ringModel);
      mat4.translate(state.ringModel, state.ringModel, state.position);
      mat4.rotateZ(state.ringModel, state.ringModel, tiltRad);
      mat4.invert(state.ringInv, state.ringModel);

      if (body.isSpacecraft) {
        // Orient ISS tangent to its orbital flight around Earth
        const incRad = ((body.inclinationDeg || 0) * Math.PI) / 180;
        const scScale = body.visualScale || body.radius;
        mat4.identity(state.model);
        mat4.translate(state.model, state.model, state.position);
        mat4.rotateX(state.model, state.model, -incRad * 0.6);
        mat4.rotateY(state.model, state.model, -state.angle);
        mat4.rotateZ(state.model, state.model, 0.25);
        mat4.copy(state.normalMatrix, state.model);
        mat4.scale(state.model, state.model, [scScale, scScale, scScale]);
      } else {
        // Full sphere model matrix
        mat4.copy(state.model, state.ringModel);
        mat4.rotateY(state.model, state.model, spinRad);
        mat4.scale(state.model, state.model, [body.radius, body.radius, body.radius]);

        // Normal matrix (inverse transpose of upper 3x3)
        mat4.copy(state.normalMatrix, state.ringModel);
        mat4.rotateY(state.normalMatrix, state.normalMatrix, spinRad);
      }
    }
  }

  getBodyPosition(id) {
    const state = this.bodyStates.get(id);
    return state ? state.position : null;
  }

  render(camera, simTime, realTime) {
    const gl = this.gl;

    // 1. Render full 3D scene into offscreen HDR FBO (or directly to screen if unsupported)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.usePostProcess ? this.fbos.scene.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.005, 0.007, 0.015, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this._renderSkyboxAndStars(camera, realTime);
    this._renderOrbits(camera);
    this._renderAsteroids(camera, simTime);
    this._renderSun(camera, realTime);
    this._renderPlanets(camera, simTime);
    this._renderSpacecraft(camera);
    this._renderCoronaAndCloudsAndRings(camera, simTime, realTime);

    if (!this.usePostProcess) return;

    // 2. Bloom bright pass
    const bloomA = this.fbos.bloom[0];
    const bloomB = this.fbos.bloom[1];

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.viewport(0, 0, bloomA.width, bloomA.height);
    const brightProg = this.programs.bright;
    gl.useProgram(brightProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.scene.tex);
    gl.uniform1i(brightProg.uniforms.uSceneTex, 0);
    gl.uniform1f(brightProg.uniforms.uThresholdLow, this.useFloatFBO ? 0.82 : 0.65);
    gl.uniform1f(brightProg.uniforms.uThresholdHigh, this.useFloatFBO ? 1.35 : 0.98);
    gl.bindVertexArray(this.geometries.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. Separable Gaussian Blur (2 ping-pong iterations for lush glow)
    const blurProg = this.programs.blur;
    gl.useProgram(blurProg.program);
    gl.uniform1i(blurProg.uniforms.uTex, 0);
    for (let pass = 0; pass < 2; pass++) {
      // Horizontal
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
      gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.uniform2f(blurProg.uniforms.uDirection, 1.6 + pass * 1.4, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Vertical
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
      gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
      gl.uniform2f(blurProg.uniforms.uDirection, 0.0, 1.6 + pass * 1.4);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 4. Composite onto default backbuffer with ACES filmic tone mapping
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const compProg = this.programs.composite;
    gl.useProgram(compProg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.scene.tex);
    gl.uniform1i(compProg.uniforms.uSceneTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform1i(compProg.uniforms.uBloomTex, 1);
    gl.uniform1f(compProg.uniforms.uBloomStrength, 0.78);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }

  _renderSkyboxAndStars(camera, realTime) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // Milky Way panoramic skybox sphere
    const skyProg = this.programs.skybox;
    gl.useProgram(skyProg.program);
    gl.uniformMatrix4fv(skyProg.uniforms.uViewNoTranslate, false, camera.viewNoTranslate);
    gl.uniformMatrix4fv(skyProg.uniforms.uProjection, false, camera.projection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.skybox);
    gl.uniform1i(skyProg.uniforms.uSkyboxMap, 0);
    gl.bindVertexArray(this.geometries.sphere.vao);
    gl.drawElements(
      gl.TRIANGLES,
      this.geometries.sphere.indexCount,
      this.geometries.sphere.indexType,
      0
    );

    // Additive spectral star particles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const starProg = this.programs.stars;
    gl.useProgram(starProg.program);
    gl.uniformMatrix4fv(starProg.uniforms.uViewNoTranslate, false, camera.viewNoTranslate);
    gl.uniformMatrix4fv(starProg.uniforms.uProjection, false, camera.projection);
    gl.uniform1f(starProg.uniforms.uTime, realTime);
    gl.uniform1f(starProg.uniforms.uPixelRatio, this.pixelRatio);
    gl.bindVertexArray(this.geometries.stars.vao);
    gl.drawArrays(gl.POINTS, 0, this.geometries.stars.count);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  _renderOrbits(camera) {
    if (!this.showOrbits) return;
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    const prog = this.programs.orbit;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, camera.viewProj);

    const identity = mat4.create();
    const moonModel = mat4.create();

    for (const { body, parent } of this.allBodies) {
      if (!body.orbitRadius) continue;
      const geom = this.orbitGeoms.get(body.id);
      const state = this.bodyStates.get(body.id);

      if (parent) {
        // Moon / ISS orbits fade in smoothly as camera approaches Earth
        const parentState = this.bodyStates.get(parent.id);
        const distToEarth = vec3.distance(camera.position, parentState.position);
        const maxDist = body.isSpacecraft ? 14.0 : 32.0;
        const fadeStart = body.isSpacecraft ? 2.5 : 8.0;
        const moonOrbitOpacity = clamp(1.0 - (distToEarth - fadeStart) / maxDist, 0.0, 0.78);
        if (moonOrbitOpacity <= 0.01) continue;

        mat4.identity(moonModel);
        mat4.translate(moonModel, moonModel, parentState.position);
        gl.uniformMatrix4fv(prog.uniforms.uModel, false, moonModel);
        gl.uniform1f(prog.uniforms.uOpacity, moonOrbitOpacity);
      } else {
        gl.uniformMatrix4fv(prog.uniforms.uModel, false, identity);
        const overviewFade = this.focusedId && this.focusedId !== body.id ? 0.35 : 0.9;
        gl.uniform1f(prog.uniforms.uOpacity, overviewFade);
      }

      const rgb = this._hexToRgb(body.accentColor);
      gl.uniform3f(prog.uniforms.uColor, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(prog.uniforms.uPlanetAngle, state.angle);
      const isActive = this.focusedId === body.id ? 1.0 : state.hoverLerp;
      gl.uniform1f(prog.uniforms.uHighlight, isActive);

      gl.bindVertexArray(geom.vao);
      gl.drawArrays(gl.LINE_STRIP, 0, geom.vertexCount);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _renderAsteroids(camera, simTime) {
    const gl = this.gl;
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const prog = this.programs.asteroid;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform1f(prog.uniforms.uTime, simTime);
    gl.uniform3f(prog.uniforms.uSunPos, 0, 0, 0);

    gl.bindVertexArray(this.geometries.asteroids.vao);
    gl.drawArraysInstanced(
      gl.TRIANGLES,
      0,
      this.geometries.asteroids.vertexCount,
      this.geometries.asteroids.instanceCount
    );
  }

  _renderSun(camera, realTime) {
    const gl = this.gl;
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const sunState = this.bodyStates.get('sun');
    const prog = this.programs.sun;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uModel, false, sunState.model);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform3fv(prog.uniforms.uCameraPos, camera.position);
    gl.uniform1f(prog.uniforms.uTime, realTime);
    gl.uniform1f(prog.uniforms.uHover, sunState.hoverLerp);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.sun);
    gl.uniform1i(prog.uniforms.uSunMap, 0);

    gl.bindVertexArray(this.geometries.sphere.vao);
    gl.drawElements(
      gl.TRIANGLES,
      this.geometries.sphere.indexCount,
      this.geometries.sphere.indexType,
      0
    );
  }

  _renderPlanets(camera) {
    const gl = this.gl;
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const prog = this.programs.planet;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform3fv(prog.uniforms.uCameraPos, camera.position);
    gl.uniform3f(prog.uniforms.uSunPos, 0, 0, 0);

    gl.bindVertexArray(this.geometries.sphere.vao);

    for (const { body } of this.allBodies) {
      if (body.isStar || body.isSpacecraft) continue;
      const state = this.bodyStates.get(body.id);

      gl.uniformMatrix4fv(prog.uniforms.uModel, false, state.model);
      gl.uniformMatrix4fv(prog.uniforms.uNormalMatrix, false, state.normalMatrix);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[body.id]);
      gl.uniform1i(prog.uniforms.uDiffuseMap, 0);

      gl.uniform1i(prog.uniforms.uIsEarth, body.isEarth ? 1 : 0);
      if (body.isEarth && this.textures[`${body.id}_night`]) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[`${body.id}_night`]);
        gl.uniform1i(prog.uniforms.uNightMap, 1);
      } else {
        gl.uniform1i(prog.uniforms.uNightMap, 0);
      }

      if (body.atmosphere) {
        gl.uniform1i(prog.uniforms.uHasAtmosphere, 1);
        gl.uniform3fv(prog.uniforms.uAtmoColor, body.atmosphere.color);
        gl.uniform1f(prog.uniforms.uAtmoIntensity, body.atmosphere.intensity);
        gl.uniform1f(prog.uniforms.uAtmoPower, body.atmosphere.power || 3.0);
      } else {
        gl.uniform1i(prog.uniforms.uHasAtmosphere, 0);
      }

      gl.uniform1f(prog.uniforms.uSpecularStrength, body.specularStrength || 0.05);
      gl.uniform1f(prog.uniforms.uHover, state.hoverLerp);

      if (body.ringTexture && body.id === 'saturn') {
        gl.uniform1i(prog.uniforms.uReceivesRingShadow, 1);
        gl.uniformMatrix4fv(prog.uniforms.uPlanetInvTransform, false, state.ringInv);
        gl.uniform1f(prog.uniforms.uRingInner, body.ringInnerRadius);
        gl.uniform1f(prog.uniforms.uRingOuter, body.ringOuterRadius);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[body.ringTexture]);
        gl.uniform1i(prog.uniforms.uRingShadowMap, 2);
      } else {
        gl.uniform1i(prog.uniforms.uReceivesRingShadow, 0);
        gl.uniform1i(prog.uniforms.uRingShadowMap, 0);
      }

      gl.drawElements(
        gl.TRIANGLES,
        this.geometries.sphere.indexCount,
        this.geometries.sphere.indexType,
        0
      );
    }
  }

  _renderSpacecraft(camera) {
    const gl = this.gl;
    const issEntry = this.allBodies.find((e) => e.body.isSpacecraft);
    if (!issEntry) return;

    const state = this.bodyStates.get(issEntry.body.id);
    const earthPos = this.bodyStates.get(issEntry.parent.id).position;
    const prog = this.programs.iss;

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uModel, false, state.model);
    gl.uniformMatrix4fv(prog.uniforms.uNormalMatrix, false, state.normalMatrix);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform3fv(prog.uniforms.uCameraPos, camera.position);
    gl.uniform3f(prog.uniforms.uSunPos, 0, 0, 0);
    gl.uniform3fv(prog.uniforms.uEarthPos, earthPos);
    gl.uniform1f(prog.uniforms.uHover, state.hoverLerp);

    gl.bindVertexArray(this.geometries.iss.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.geometries.iss.vertexCount);
  }

  _renderCoronaAndCloudsAndRings(camera, simTime, realTime) {
    const gl = this.gl;

    // 1. Earth Cloud Shell (slightly larger translucent sphere)
    const earthEntry = this.allBodies.find((e) => e.body.isEarth);
    if (earthEntry && this.textures[`${earthEntry.body.id}_clouds`]) {
      const earth = earthEntry.body;
      const state = this.bodyStates.get(earth.id);
      const cloudModel = mat4.create();
      const cloudNorm = mat4.create();
      const tiltRad = (earth.axialTiltDeg * Math.PI) / 180;
      const cloudSpin = simTime * (earth.rotationSpeed * 1.18);

      mat4.translate(cloudModel, cloudModel, state.position);
      mat4.rotateZ(cloudModel, cloudModel, tiltRad);
      mat4.rotateY(cloudModel, cloudModel, cloudSpin);
      mat4.copy(cloudNorm, cloudModel);
      const cr = earth.radius * 1.016;
      mat4.scale(cloudModel, cloudModel, [cr, cr, cr]);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);

      const cProg = this.programs.cloud;
      gl.useProgram(cProg.program);
      gl.uniformMatrix4fv(cProg.uniforms.uModel, false, cloudModel);
      gl.uniformMatrix4fv(cProg.uniforms.uNormalMatrix, false, cloudNorm);
      gl.uniformMatrix4fv(cProg.uniforms.uViewProj, false, camera.viewProj);
      gl.uniform3f(cProg.uniforms.uSunPos, 0, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[`${earth.id}_clouds`]);
      gl.uniform1i(cProg.uniforms.uCloudMap, 0);

      gl.bindVertexArray(this.geometries.sphere.vao);
      gl.drawElements(
        gl.TRIANGLES,
        this.geometries.sphere.indexCount,
        this.geometries.sphere.indexType,
        0
      );
    }

    // 2. Planetary Rings (Saturn + faint Uranus rings)
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    const ringProg = this.programs.ring;
    gl.useProgram(ringProg.program);
    gl.uniformMatrix4fv(ringProg.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform3f(ringProg.uniforms.uSunPos, 0, 0, 0);

    for (const { body } of this.allBodies) {
      if (!body.ringTexture) continue;
      const geom = this.ringGeoms.get(body.id);
      const state = this.bodyStates.get(body.id);
      const tint = body.ringTint || [1.0, 0.96, 0.88, 0.95];

      gl.uniformMatrix4fv(ringProg.uniforms.uModel, false, state.ringModel);
      gl.uniform3fv(ringProg.uniforms.uPlanetCenter, state.position);
      gl.uniform1f(ringProg.uniforms.uPlanetRadius, body.radius * 0.985);
      gl.uniform4fv(ringProg.uniforms.uRingTint, tint);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[body.ringTexture]);
      gl.uniform1i(ringProg.uniforms.uRingMap, 0);

      gl.bindVertexArray(geom.vao);
      gl.drawElements(gl.TRIANGLES, geom.indexCount, geom.indexType, 0);
    }

    // 3. Sun Corona Additive Billboard
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const coronaProg = this.programs.corona;
    gl.useProgram(coronaProg.program);
    gl.uniformMatrix4fv(coronaProg.uniforms.uViewProj, false, camera.viewProj);
    gl.uniform3fv(coronaProg.uniforms.uCameraRight, camera.right);
    gl.uniform3fv(coronaProg.uniforms.uCameraUp, camera.up);
    gl.uniform1f(coronaProg.uniforms.uScale, 17.5);
    gl.uniform1f(coronaProg.uniforms.uTime, realTime);

    gl.bindVertexArray(this.geometries.quad.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  /**
   * Returns the nearest celestial body hit by a screen-space ray, or null.
   */
  pickBody(rayOrigin, rayDir, cameraDistance, intersectFn) {
    let bestHit = null;
    let bestDist = Infinity;

    for (const { body } of this.allBodies) {
      // Avoid intercepting Earth clicks with tiny LEO ISS when zoomed far out
      if (body.isSpacecraft && cameraDistance > 16) continue;
      const state = this.bodyStates.get(body.id);
      const minPick = cameraDistance > 45 ? Math.max(body.radius * 1.45, 1.35) : body.radius * 1.15;
      const t = intersectFn(rayOrigin, rayDir, state.position, minPick);
      if (t > 0 && t < bestDist) {
        bestDist = t;
        bestHit = body;
      }
    }
    return bestHit;
  }

  _hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((v) => v / 255);
  }
}
