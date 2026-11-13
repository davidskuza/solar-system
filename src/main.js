/**
 * Main entry point for the Raw WebGL2 Solar System Observatory.
 */
import { SpaceAudioController } from './audio.js';
import { CameraController } from './camera.js';
import { CELESTIAL_BODIES } from './data/planets.js';
import { intersectRaySphere, projectToScreen, screenToWorldRay, vec3 } from './math.js';
import { SolarSystemRenderer } from './webgl/renderer.js';

const canvas = document.getElementById('gl-canvas');
const loadingScreen = document.getElementById('loading-screen');
const loadingStatus = document.getElementById('loading-status');
const loadingBar = document.getElementById('loading-bar');
const labelsLayer = document.getElementById('labels-layer');
const planetNav = document.getElementById('planet-nav');

const planetPanel = document.getElementById('planet-panel');
const panelClassification = document.getElementById('panel-classification');
const panelSymbol = document.getElementById('panel-symbol');
const panelName = document.getElementById('panel-name');
const panelTagline = document.getElementById('panel-tagline');
const panelDescription = document.getElementById('panel-description');
const panelStats = document.getElementById('panel-stats');
const panelFact = document.getElementById('panel-fact');
const panelSubnav = document.getElementById('panel-subnav');

const btnPlayPause = document.getElementById('btn-play-pause');
const iconPlayPause = document.getElementById('icon-play-pause');
const speedPills = document.getElementById('speed-pills');
const btnOrbits = document.getElementById('btn-orbits');
const btnLabels = document.getElementById('btn-labels');
const btnAudio = document.getElementById('btn-audio');
const audioLabel = document.getElementById('audio-label');
const audioVolume = document.getElementById('audio-volume');
const btnClosePanel = document.getElementById('btn-close-panel');
const btnReturnOverview = document.getElementById('btn-return-overview');

let renderer;
try {
  renderer = new SolarSystemRenderer(canvas);
} catch (err) {
  loadingStatus.textContent = err.message || 'WebGL2 initialization failed.';
  throw err;
}

const camera = new CameraController();
const audio = new SpaceAudioController('assets/audio/space_ambient.mp3');

const state = {
  simTime: 0,
  realTime: 0,
  paused: false,
  speedMultiplier: 1,
  showLabels: true,
  selectedBody: null,
  hoveredId: null,
};

// Lookup map for all celestial bodies (including moons)
const bodyMap = new Map();
for (const b of CELESTIAL_BODIES) {
  bodyMap.set(b.id, { body: b, parent: null });
  if (b.moons) {
    for (const m of b.moons) {
      bodyMap.set(m.id, { body: m, parent: b });
    }
  }
}

// Build bottom quick-nav & 3D floating labels
const navPills = new Map();
const floatingLabels = new Map();

function buildUI() {
  const addNavPill = (body) => {
    const pill = document.createElement('button');
    pill.className = 'nav-pill';
    pill.style.setProperty('--pill-color', body.accentColor);
    pill.innerHTML = `<span class="nav-dot"></span><span>${body.name}</span>`;
    pill.addEventListener('click', () => {
      audio.tryAutoStart();
      syncAudioUI();
      selectBody(body.id);
    });
    planetNav.appendChild(pill);
    navPills.set(body.id, pill);
  };

  for (const body of CELESTIAL_BODIES) {
    addNavPill(body);
    if (body.id === 'earth' && body.moons) {
      const iss = body.moons.find((m) => m.id === 'iss');
      if (iss) addNavPill(iss);
    }
  }

  for (const { body, parent } of bodyMap.values()) {
    const label = document.createElement('button');
    label.className = 'planet-label';
    label.style.setProperty('--label-color', body.accentColor);
    label.innerHTML = `<span class="planet-label-dot"></span><span>${body.name}</span>`;
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.tryAutoStart();
      syncAudioUI();
      selectBody(body.id);
    });
    label.addEventListener('mouseenter', () => {
      state.hoveredId = body.id;
      renderer.hoveredId = body.id;
    });
    label.addEventListener('mouseleave', () => {
      if (state.hoveredId === body.id) {
        state.hoveredId = null;
        renderer.hoveredId = null;
      }
    });
    labelsLayer.appendChild(label);
    floatingLabels.set(body.id, { el: label, body, parent });
  }
}

function selectBody(id) {
  const entry = bodyMap.get(id);
  if (!entry) return;
  const { body, parent } = entry;
  state.selectedBody = body;
  renderer.focusedId = body.id;

  const worldPos = renderer.getBodyPosition(body.id);
  camera.focusBody(body, worldPos, window.innerWidth);

  // Update active nav pills
  for (const [bid, pill] of navPills) {
    const matchExact = bid === id;
    const matchParent = !navPills.has(id) && parent && bid === parent.id;
    pill.classList.toggle('active', matchExact || matchParent);
  }

  // Populate description drawer
  document.documentElement.style.setProperty('--planet-accent', body.accentColor);
  panelClassification.textContent = body.classification;
  panelSymbol.textContent = body.symbol;
  panelName.textContent = body.fullName || body.name;
  panelTagline.textContent = body.tagline;
  panelDescription.textContent = body.description;
  panelFact.textContent = body.fact;

  panelStats.innerHTML = '';
  for (const stat of body.stats) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-label">${stat.label}</div>
      <div class="stat-value">${stat.value}</div>
    `;
    panelStats.appendChild(card);
  }

  // Sub-navigation for moons / satellites (e.g., Earth <-> ISS <-> Moon)
  panelSubnav.innerHTML = '';
  if (body.moons && body.moons.length > 0) {
    panelSubnav.classList.remove('hidden');
    for (const moon of body.moons) {
      const btn = document.createElement('button');
      btn.className = 'subnav-btn';
      btn.textContent = `Inspect ${moon.name} ${moon.symbol}`;
      btn.addEventListener('click', () => selectBody(moon.id));
      panelSubnav.appendChild(btn);
    }
  } else if (parent) {
    panelSubnav.classList.remove('hidden');
    const backBtn = document.createElement('button');
    backBtn.className = 'subnav-btn';
    backBtn.textContent = `← Back to ${parent.name} ${parent.symbol}`;
    backBtn.addEventListener('click', () => selectBody(parent.id));
    panelSubnav.appendChild(backBtn);

    if (parent.moons) {
      for (const sibling of parent.moons) {
        if (sibling.id === body.id) continue;
        const sibBtn = document.createElement('button');
        sibBtn.className = 'subnav-btn';
        sibBtn.textContent = `Inspect ${sibling.name} ${sibling.symbol}`;
        sibBtn.addEventListener('click', () => selectBody(sibling.id));
        panelSubnav.appendChild(sibBtn);
      }
    }
  } else {
    panelSubnav.classList.add('hidden');
  }

  planetPanel.classList.add('open');
  planetPanel.setAttribute('aria-hidden', 'false');
}

function closeDescriptionAndZoomOut() {
  if (!state.selectedBody) return;
  state.selectedBody = null;
  renderer.focusedId = null;

  for (const pill of navPills.values()) {
    pill.classList.remove('active');
  }

  planetPanel.classList.remove('open');
  planetPanel.setAttribute('aria-hidden', 'true');
  camera.returnToOverview();
}

function syncAudioUI() {
  btnAudio.classList.toggle('playing', audio.isPlaying);
  audioLabel.textContent = audio.isPlaying ? 'Playing' : 'Soundtrack';
}

// Pointer / Orbit / Click picking controls
let isDragging = false;
let pointerDownPos = { x: 0, y: 0 };
let lastPointerPos = { x: 0, y: 0 };
let activePointers = new Map();
let lastPinchDist = 0;

function handleResize() {
  renderer.resize();
  camera.setAspect(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', handleResize);

canvas.addEventListener('pointerdown', (e) => {
  audio.tryAutoStart().then(syncAudioUI);
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 1) {
    isDragging = true;
    pointerDownPos = { x: e.clientX, y: e.clientY };
    lastPointerPos = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  } else if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (lastPinchDist > 0) {
      const ratio = lastPinchDist / Math.max(1, dist);
      camera.zoomBy(ratio);
    }
    lastPinchDist = dist;
    return;
  }

  if (isDragging) {
    const dx = e.clientX - lastPointerPos.x;
    const dy = e.clientY - lastPointerPos.y;
    lastPointerPos = { x: e.clientX, y: e.clientY };
    camera.rotateBy(-dx * 0.0055, dy * 0.0055);
    return;
  }

  // Hover ray-picking
  const rect = canvas.getBoundingClientRect();
  const ray = screenToWorldRay(e.clientX, e.clientY, rect, camera.invViewProj, camera.position);
  const hit = renderer.pickBody(ray.origin, ray.dir, camera.distance, intersectRaySphere);
  const hitId = hit ? hit.id : null;

  if (hitId !== state.hoveredId) {
    state.hoveredId = hitId;
    renderer.hoveredId = hitId;
    canvas.classList.toggle('hovering', Boolean(hitId));
  }
});

canvas.addEventListener('pointerup', (e) => {
  const wasSingle = activePointers.size === 1;
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinchDist = 0;

  if (isDragging && activePointers.size === 0) {
    isDragging = false;
    canvas.classList.remove('dragging');

    if (wasSingle) {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (moveDist < 6) {
        const rect = canvas.getBoundingClientRect();
        const ray = screenToWorldRay(
          e.clientX,
          e.clientY,
          rect,
          camera.invViewProj,
          camera.position
        );
        const hit = renderer.pickBody(ray.origin, ray.dir, camera.distance, intersectRaySphere);
        if (hit) {
          selectBody(hit.id);
        }
      }
    }
  }
});

canvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  isDragging = false;
  lastPinchDist = 0;
  canvas.classList.remove('dragging');
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0011);
    camera.zoomBy(factor);
  },
  { passive: false }
);

// HUD Controls
btnPlayPause.addEventListener('click', () => {
  state.paused = !state.paused;
  iconPlayPause.textContent = state.paused ? '▶' : '❚❚';
});

speedPills.addEventListener('click', (e) => {
  const btn = e.target.closest('.speed-btn');
  if (!btn) return;
  state.speedMultiplier = parseFloat(btn.dataset.speed);
  for (const el of speedPills.querySelectorAll('.speed-btn')) {
    el.classList.toggle('active', el === btn);
  }
  if (state.paused) {
    state.paused = false;
    iconPlayPause.textContent = '❚❚';
  }
});

btnOrbits.addEventListener('click', () => {
  renderer.showOrbits = !renderer.showOrbits;
  btnOrbits.classList.toggle('active', renderer.showOrbits);
});

btnLabels.addEventListener('click', () => {
  state.showLabels = !state.showLabels;
  btnLabels.classList.toggle('active', state.showLabels);
  labelsLayer.classList.toggle('hidden', !state.showLabels);
});

btnAudio.addEventListener('click', async () => {
  await audio.toggle();
  syncAudioUI();
});

audioVolume.addEventListener('input', (e) => {
  audio.setVolume(parseFloat(e.target.value));
});

btnClosePanel.addEventListener('click', closeDescriptionAndZoomOut);
btnReturnOverview.addEventListener('click', closeDescriptionAndZoomOut);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectedBody) {
    closeDescriptionAndZoomOut();
  } else if (e.key === ' ' && document.activeElement.tagName !== 'BUTTON') {
    e.preventDefault();
    state.paused = !state.paused;
    iconPlayPause.textContent = state.paused ? '▶' : '❚❚';
  }
});

function updateProjectedLabels(vw, vh) {
  if (!state.showLabels) return;

  for (const [id, entry] of floatingLabels) {
    const { el, body, parent } = entry;
    if (state.selectedBody && state.selectedBody.id === id) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      continue;
    }

    const pos = renderer.getBodyPosition(id);
    if (parent) {
      const parentPos = renderer.getBodyPosition(parent.id);
      const distCam = vec3.distance(camera.position, parentPos);
      const threshold = body.isSpacecraft ? 9.5 : 22;
      if (distCam > threshold) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
    }

    const anchorWorld = [pos[0], pos[1] + body.radius * 1.15, pos[2]];
    const proj = projectToScreen(anchorWorld, camera.viewProj, vw, vh);

    if (!proj.visible) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      continue;
    }

    el.style.opacity = state.selectedBody ? '0.45' : '1';
    el.style.pointerEvents = 'auto';
    el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -120%)`;
    el.classList.toggle('hovered', state.hoveredId === id);
  }
}

async function boot() {
  buildUI();
  handleResize();

  loadingStatus.textContent = 'Streaming 2K NASA planetary textures…';
  await renderer.loadAssets((progress) => {
    const pct = Math.round(progress * 100);
    loadingBar.style.width = `${pct}%`;
    loadingStatus.textContent = `Loading celestial maps… ${pct}%`;
  });

  // Initial simulation step before revealing canvas
  renderer.updateSimulation(state.simTime, 0.016);
  camera.update(0.016, null);

  loadingScreen.classList.add('hidden');

  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    state.realTime += dt;
    if (!state.paused) {
      state.simTime += dt * state.speedMultiplier;
    }

    renderer.updateSimulation(state.simTime, dt);
    const focusedPos = state.selectedBody
      ? renderer.getBodyPosition(state.selectedBody.id)
      : null;
    camera.update(dt, focusedPos);

    renderer.render(camera, state.simTime, state.realTime);
    updateProjectedLabels(window.innerWidth, window.innerHeight);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

boot();
