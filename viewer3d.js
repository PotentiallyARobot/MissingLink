/* ============================================================
   TRELLIS.2 Studio — 3D GLB Viewer (deployed-Modal version)

   Streamlined from the Colab build: dropped paint-mode and UV
   texture-modal features that the deployed worker doesn't expose.
   Keeps the interaction-aware quality model (fast unlit while
   orbiting, full PBR when idle) and the keyboard camera shortcuts.
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── State ───────────────────────────────────────────────────────
let renderer, scene, camera, controls, clock;
let currentModel = null;
let originalMaterials = new Map();
let unlitMaterials = new Map();
let isInteracting = false;
let idleTimer = null;
let forcedWireframe = false;
let frameCount = 0, fpsTime = 0, currentFps = 0;
let animFrameId = null;
let isActive = false;

// ── Keyboard ────────────────────────────────────────────────────
const keysDown = new Set();
const PAN_SPEED = 0.015;
const ZOOM_KEY_SPEED = 0.08;

const IDLE_DELAY = 180;

// ── DOM refs ─────────────────────────────────────────────────────
const container = document.getElementById('canvas3dViewer');
const canvas    = document.getElementById('glbCanvas');
const hudTris   = document.getElementById('hudTris');
const hudVerts  = document.getElementById('hudVerts');
const hudFps    = document.getElementById('hudFps');
const hudMode   = document.getElementById('hudMode');
const btnResetCam  = document.getElementById('btnResetCam');
const btnWireframe = document.getElementById('btnWireframe');

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
function init() {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x09090B, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x09090B);

  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.set(2, 1.5, 3);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 1.2;
  controls.screenSpacePanning = true;

  controls.addEventListener('start', onInteractionStart);
  controls.addEventListener('end',   onInteractionEnd);

  setupLights();

  clock = new THREE.Clock();

  // Resize handling
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Buttons
  if (btnResetCam)  btnResetCam.addEventListener('click', resetCamera);
  if (btnWireframe) btnWireframe.addEventListener('click', toggleWireframe);

  // Keyboard nav
  window.addEventListener('keydown', e => {
    // Don't intercept when typing into form fields
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    keysDown.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));
}

function setupLights() {
  // Soft hemisphere fill for general visibility
  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x202028, 0.65));

  // Key light — warm, slightly above front
  const key = new THREE.DirectionalLight(0xFFE8C8, 1.2);
  key.position.set(3, 4, 2.5);
  scene.add(key);

  // Rim light — cool, behind
  const rim = new THREE.DirectionalLight(0x88AAFF, 0.5);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

  // Subtle bottom fill so dark undersides aren't pitch black
  const fill = new THREE.DirectionalLight(0xFFFFFF, 0.25);
  fill.position.set(0, -2, 0);
  scene.add(fill);
}

function resize() {
  if (!renderer || !container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (w === 0 || h === 0) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ════════════════════════════════════════════════════════════════
// LOAD
// ════════════════════════════════════════════════════════════════
function loadFromUrl(url, name) {
  // Clear previous
  if (currentModel) {
    scene.remove(currentModel);
    currentModel.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => disposeMat(m));
        else disposeMat(o.material);
      }
    });
    currentModel = null;
    originalMaterials.clear();
    unlitMaterials.clear();
  }

  hudMode.textContent = 'LOADING…';
  show();

  const loader = new GLTFLoader();
  loader.load(
    url,
    gltf => {
      const root = gltf.scene || gltf.scenes[0];

      // Center + normalize size
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? 1.6 / maxDim : 1;
      root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      root.scale.setScalar(scale);

      // Cache materials & build cheap unlit twins for orbit-mode swap
      let triCount = 0, vertCount = 0;
      root.traverse(o => {
        if (o.isMesh) {
          if (o.geometry.index) triCount += o.geometry.index.count / 3;
          else                   triCount += o.geometry.attributes.position.count / 3;
          vertCount += o.geometry.attributes.position.count;

          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => {
            originalMaterials.set(m.uuid, m);
            // Make a MeshBasicMaterial twin (textured but unlit) for fast
            // orbit rendering on weak GPUs.
            const unlit = new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.color ? m.color.clone() : new THREE.Color(0xFFFFFF),
              side: m.side,
              transparent: m.transparent,
              opacity: m.opacity,
            });
            unlitMaterials.set(m.uuid, unlit);
          });
        }
      });

      hudTris.textContent  = '△ ' + Math.round(triCount).toLocaleString();
      hudVerts.textContent = '◆ ' + vertCount.toLocaleString();

      currentModel = root;
      scene.add(root);

      // Aim camera nicely
      resetCamera();
      hudMode.textContent = 'SHADED';
    },
    undefined,
    err => {
      console.error('GLTF load error', err);
      hudMode.textContent = 'LOAD FAIL';
    },
  );
}

function disposeMat(m) {
  if (m.map) m.map.dispose();
  if (m.normalMap) m.normalMap.dispose();
  if (m.roughnessMap) m.roughnessMap.dispose();
  if (m.metalnessMap) m.metalnessMap.dispose();
  m.dispose();
}

// ════════════════════════════════════════════════════════════════
// INTERACTION QUALITY SWAP
// ════════════════════════════════════════════════════════════════
function onInteractionStart() {
  isInteracting = true;
  if (!currentModel || forcedWireframe) return;
  // Swap to unlit while moving — frame rates stay smooth even for
  // 500K-tri meshes on weak GPUs.
  currentModel.traverse(o => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const swapped = mats.map(m => unlitMaterials.get(m.uuid) || m);
      if (Array.isArray(o.material)) o.material = swapped;
      else                             o.material = swapped[0];
    }
  });
  hudMode.textContent = 'UNLIT';
}

function onInteractionEnd() {
  isInteracting = false;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!currentModel || forcedWireframe) return;
    currentModel.traverse(o => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const restored = mats.map(m => {
          // We swapped to the unlit material; find the original by checking
          // each unlit's owner.
          for (const [origUuid, unlit] of unlitMaterials.entries()) {
            if (unlit === m) return originalMaterials.get(origUuid) || m;
          }
          return m;
        });
        if (Array.isArray(o.material)) o.material = restored;
        else                             o.material = restored[0];
      }
    });
    hudMode.textContent = 'SHADED';
  }, IDLE_DELAY);
}

// ════════════════════════════════════════════════════════════════
// CAMERA + KEYBOARD
// ════════════════════════════════════════════════════════════════
function resetCamera() {
  camera.position.set(2.0, 1.4, 2.6);
  controls.target.set(0, 0, 0);
  controls.update();
}

function toggleWireframe() {
  if (!currentModel) return;
  forcedWireframe = !forcedWireframe;
  btnWireframe.classList.toggle('active', forcedWireframe);
  currentModel.traverse(o => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { m.wireframe = forcedWireframe; });
    }
  });
  hudMode.textContent = forcedWireframe ? 'WIREFRAME' : 'SHADED';
}

function zoomIn()  { camera.position.lerp(controls.target, 0.12); controls.update(); }
function zoomOut() {
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.add(dir.multiplyScalar(0.4));
  controls.update();
}
function panCamera(dx, dy) {
  const offset = new THREE.Vector3();
  const dist = camera.position.distanceTo(controls.target);
  // dx pans along the camera's right vector, dy along its up vector
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.getWorldDirection(offset);
  right.crossVectors(offset, camera.up).normalize();
  up.copy(camera.up);
  const move = right.multiplyScalar(dx * dist * 0.15)
                    .add(up.multiplyScalar(dy * dist * 0.15));
  camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

function processKeyboard(dt) {
  if (keysDown.size === 0) return;
  // Pan
  let dx = 0, dy = 0;
  if (keysDown.has('a') || keysDown.has('arrowleft'))  dx -= 1;
  if (keysDown.has('d') || keysDown.has('arrowright')) dx += 1;
  if (keysDown.has('w') || keysDown.has('arrowup'))    dy += 1;
  if (keysDown.has('s') || keysDown.has('arrowdown'))  dy -= 1;
  if (dx || dy) panCamera(dx * PAN_SPEED * 60 * dt, dy * PAN_SPEED * 60 * dt);

  // Zoom
  if (keysDown.has('=') || keysDown.has('+')) {
    camera.position.lerp(controls.target, ZOOM_KEY_SPEED * dt * 5);
    controls.update();
  }
  if (keysDown.has('-') || keysDown.has('_')) {
    const d = camera.position.clone().sub(controls.target).normalize();
    camera.position.add(d.multiplyScalar(0.05));
    controls.update();
  }
}

// ════════════════════════════════════════════════════════════════
// SHOW/HIDE/ANIMATE
// ════════════════════════════════════════════════════════════════
function show() { isActive = true; if (!animFrameId) animate(); }
function hide() {
  isActive = false;
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function animate() {
  if (!isActive) return;
  animFrameId = requestAnimationFrame(animate);
  const dt = clock.getDelta();
  processKeyboard(dt);
  controls.update();
  renderer.render(scene, camera);

  // FPS HUD
  frameCount++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    currentFps = Math.round(frameCount / fpsTime);
    if (hudFps) hudFps.textContent = '⟳ ' + currentFps + ' fps';
    frameCount = 0;
    fpsTime = 0;
  }
}

// ════════════════════════════════════════════════════════════════
// INIT + EXPORTS
// ════════════════════════════════════════════════════════════════
init();
animate();

window.viewer3d = {
  loadFromUrl,
  show, hide,
  resetCamera,
  toggleWireframe,
  zoomIn, zoomOut, panCamera,
};
