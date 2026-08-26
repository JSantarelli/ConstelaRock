import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { UMAP } from "umap-js";

let selectedGenres = new Set();
let genreLegendItemsByGenre = new Map(); // genre -> elemento DOM de la leyenda
let genreLegendGroups = new Map(); // group -> { titleEl, arrowEl, selectAreaEl, itemsContainerEl, genres }
let tooltipExpanded = false; // persiste entre navegaciones de disco, se resetea sólo manualmente vía el toggle


const scene = new THREE.Scene();
scene.background = new THREE.Color(0xFFFFFF);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 90);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.querySelector("#map").appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .06;
controls.minDistance = 20;
controls.maxDistance = 260;

const root = new THREE.Group();
scene.add(root);

const labelGroup = new THREE.Group();
scene.add(labelGroup);
const connectionGroup = new THREE.Group();
scene.add(connectionGroup);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let albums = [];
let points = [];
let pointMeshes = [];
let yearSprites = [];
let orbitRings = [];
let genreLabelSprites = [];

let selectedIndices = new Set();
let outlineRings = new Map();
let multiSelectPanels = new Map();
let activeFilters = {
  artist: null,
  yearFrom: null,
  yearTo: null,
  descriptor: null,
  query: ""
};
let filteredIndices = null; // null = sin filtros activos; Set<idx> cuando hay filtros
const ui = {
  list: document.querySelector("#albumList"),
  search: document.querySelector("#search"),
  searchResults: document.querySelector("#searchResults"),
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#tooltip"),
  genreLegend: document.querySelector('#genreLegend'),
  timeToggle: document.querySelector('#timeToggle'),
  genreLabelToggle: document.querySelector('#genreLabelToggle'),
  filterYearFrom: document.querySelector('#filterYearFrom'),
  filterYearTo: document.querySelector('#filterYearTo'),
  filterDescriptor: document.querySelector('#filterDescriptor'),
  filtersClear: document.querySelector('#filtersClear')
};

function clearScene() {
  pointMeshes.forEach(m => {
    m.geometry.dispose();
    m.material.dispose();
    root.remove(m);
  });
  pointMeshes = [];

  selectedIndices.clear();
  selectedGenres.clear();
  selectedYear = null;
  activeFilters = { artist: null, yearFrom: null, yearTo: null, descriptor: null, query: "" };
  filteredIndices = null;
  if (ui.search) ui.search.value = "";

  yearSprites.forEach(s => {
    s.material.map?.dispose();
    s.material.dispose();
    root.remove(s);
  });
  yearSprites = [];

  orbitRings.forEach(r => {
    r.geometry.dispose();
    r.material.dispose();
    root.remove(r);
  });
  orbitRings = [];

  clearGenreLabels();
  clearConnections();
  clearSelectionOutlines();
  clearMultiSelectPanels();

  selectedIndices.clear();
  selectedGenres.clear();
  selectedYear = null;
}

function updateSelectionVisuals() {
  if (selectedIndices.size === 0) {
    pointMeshes.forEach(m => { m.material.opacity = 1; });
    return;
  }
  pointMeshes.forEach((m, i) => {
    m.material.opacity = selectedIndices.has(i) ? 1 : 0.35;
  });
}

  const artists = new Set([...selectedIndices].map(i => points[i].artist));

  pointMeshes.forEach((m, i) => {
    const isSelected = selectedIndices.has(i);
    const sameArtist = artists.has(points[i].artist);
    m.material.opacity = (isSelected || sameArtist) ? 1 : 0.35;
  });

function ensureOutlineRing(idx) {
  if (outlineRings.has(idx)) return outlineRings.get(idx);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(POINT_RADIUS + 0.1, POINT_RADIUS + 0.2, OUTLINE_SEGMENTS),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    })
  );
  ring.renderOrder = 10;
  root.add(ring);
  outlineRings.set(idx, ring);
  return ring;
}

function getArtistDiscography(artist) {
  return points
    .filter(p => p.artist === artist)
    .sort((a, b) => a.year - b.year || a.album.localeCompare(b.album));
}

function showSelectionOutlines() {
  selectedIndices.forEach(idx => {
    const mesh = pointMeshes[idx];
    if (!mesh) return;
    const ring = ensureOutlineRing(idx);
    ring.material.color.copy(points[idx].color);
    ring.visible = true;
  });

  [...outlineRings.keys()].forEach(idx => {
    if (!selectedIndices.has(idx)) {
      const ring = outlineRings.get(idx);
      ring.geometry.dispose();
      ring.material.dispose();
      root.remove(ring);
      outlineRings.delete(idx);
    }
  });
}

function clearSelectionOutlines() {
  outlineRings.forEach(ring => {
    ring.geometry.dispose();
    ring.material.dispose();
    root.remove(ring);
  });
  outlineRings.clear();
}

function updateSelectionOutlines() {
  outlineRings.forEach((ring, idx) => {
    const mesh = pointMeshes[idx];
    if (!mesh) return;

    ring.position.copy(mesh.position);
    ring.quaternion.copy(camera.quaternion);

    const distance = camera.position.distanceTo(mesh.position);
    const vFov = camera.fov * Math.PI / 180;
    const screenHeight = renderer.domElement.clientHeight || innerHeight;
    const worldPerPixel = (2 * Math.tan(vFov / 2) * distance) / screenHeight;

    const offsetWorld = worldPerPixel * OUTLINE_OFFSET_PX;
    const thicknessWorld = worldPerPixel * OUTLINE_THICKNESS_PX;

    const innerRadius = POINT_RADIUS + offsetWorld;
    const outerRadius = innerRadius + thicknessWorld;

    ring.geometry.dispose();
    ring.geometry = new THREE.RingGeometry(innerRadius, outerRadius, OUTLINE_SEGMENTS);
  });
}

function buildAncestorDescendantSection(idx) {
  const { ancestor, descendants } = computeAncestorDescendants(idx);
  const wrap = document.createElement("div");

  if (ancestor) {
    const t = document.createElement("div");
    t.textContent = "Disco ancestro";
    t.style.cssText = "margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;";
    wrap.appendChild(t);
    wrap.appendChild(buildNearestRow(ancestor, { showYear: true }));
  }

  if (descendants.length) {
    const t = document.createElement("div");
    t.textContent = "Discos descendientes";
    t.style.cssText = "margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;";
    wrap.appendChild(t);
    descendants.forEach(p => wrap.appendChild(buildNearestRow(p, { showYear: true })));
  }

  return wrap;
}

function buildNavChevrons(a) {
  const discog = getArtistDiscography(a.artist);
  const pos = discog.findIndex(p => p.idx === a.idx);

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;position:absolute;top:6px;right:32px;";

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "‹";
  prevBtn.setAttribute("aria-label", "Disco anterior del artista");
  prevBtn.disabled = pos <= 0;
  prevBtn.style.cssText = `border:none;background:none;font-size:18px;line-height:1;cursor:${prevBtn.disabled ? "default" : "pointer"};color:${prevBtn.disabled ? "#ccc" : "#888"};padding:0;`;
  prevBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (pos > 0) selectAlbum(discog[pos - 1].idx);
  });

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "›";
  nextBtn.setAttribute("aria-label", "Disco siguiente del artista");
  nextBtn.disabled = pos === -1 || pos >= discog.length - 1;
  nextBtn.style.cssText = `border:none;background:none;font-size:18px;line-height:1;cursor:${nextBtn.disabled ? "default" : "pointer"};color:${nextBtn.disabled ? "#ccc" : "#888"};padding:0;`;
  nextBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (pos < discog.length - 1) selectAlbum(discog[pos + 1].idx);
  });

  wrap.appendChild(prevBtn);
  wrap.appendChild(nextBtn);
  return wrap;
}

function buildExpandToggle(section) {
  const btn = document.createElement("button");
  btn.textContent = tooltipExpanded ? "Saber menos" : "Saber más";
  btn.style.cssText = "margin-top:10px;border:none;background:none;color:#556;font-size:12px;text-decoration:underline;cursor:pointer;padding:0;";
  btn.addEventListener("click", e => {
    e.stopPropagation();
    tooltipExpanded = !tooltipExpanded;
    section.style.display = tooltipExpanded ? "block" : "none";
    btn.textContent = tooltipExpanded ? "Saber menos" : "Saber más";
  });
  return btn;
}

function buildHoverPanelHTML(i) {
  const a = points[i];
  const mainGenre = a.genres.primary[0] ?? "";
  return `
    <strong>${a.album}</strong>
    <div class="artist">${a.artist} · ${a.year}</div>
    ${mainGenre ? `<div class="genres"><span class="primary">${mainGenre}</span></div>` : ""}
  `;
}

function renderDetailPanel(i, x, y) {
  const a = points[i];
  if (!a) return;

  ui.tooltip.textContent = "";
  ui.tooltip.style.pointerEvents = "auto";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.style.cssText = "position:absolute;top:6px;right:8px;border:none;background:none;font-size:16px;line-height:1;cursor:pointer;color:#888;";
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    clearHighlight();
  });

  const navChevrons = buildNavChevrons(a);

  const title = document.createElement("strong");
  title.textContent = a.album;

  const artistLine = document.createElement("div");
  artistLine.className = "artist";

  const artistName = document.createElement("span");
  artistName.textContent = a.artist;
  artistName.style.cursor = "pointer";
  artistName.style.textDecoration = "underline";
  artistName.addEventListener("click", e => {
    e.stopPropagation();
    clearHighlight(); // deselecciona el nodo y limpia las conexiones dashed
    activeFilters.artist = a.artist;
    ui.search.value = a.artist;
    refreshFilterOptions(); // dibuja la trayectoria del artista con solid line (buildArtistChainConnections)
  });

  artistLine.appendChild(artistName);
  artistLine.appendChild(document.createTextNode(` · ${a.year}`));

  const genresDiv = document.createElement("div");
  genresDiv.className = "genres";
  a.genres.primary.forEach(g => {
    const span = document.createElement("span");
    span.className = "primary";
    span.textContent = g;
    genresDiv.appendChild(span);
  });
  a.genres.secondary.forEach(g => {
    const span = document.createElement("span");
    span.className = "secondary";
    span.textContent = g;
    genresDiv.appendChild(span);
  });

  ui.tooltip.appendChild(closeBtn);
  ui.tooltip.appendChild(navChevrons);
  ui.tooltip.appendChild(title);
  ui.tooltip.appendChild(artistLine);
  ui.tooltip.appendChild(genresDiv);

  const extendedSection = document.createElement("div");
  extendedSection.style.display = tooltipExpanded ? "block" : "none";
  extendedSection.appendChild(buildAncestorDescendantSection(i));

  ui.tooltip.appendChild(buildExpandToggle(extendedSection));
  ui.tooltip.appendChild(extendedSection);

  ui.tooltip.style.right = "auto";
  ui.tooltip.style.left = `${Math.min(x + 16, innerWidth - 320)}px`;
  ui.tooltip.style.top = `${Math.min(y + 16, innerHeight - 380)}px`; // más alto: hay más contenido potencial
  ui.tooltip.style.display = "block";
}

function showTooltipForPoint(i, x, y) {
  ui.tooltip.innerHTML = buildHoverPanelHTML(i);
  ui.tooltip.style.pointerEvents = "none";
  ui.tooltip.style.right = "auto";
  ui.tooltip.style.display = "block";
  ui.tooltip.style.left = `${Math.min(x+16, innerWidth-320)}px`;
  ui.tooltip.style.top = `${Math.min(y+16, innerHeight-150)}px`;
}

function ensureMultiSelectPanel(idx) {
  if (multiSelectPanels.has(idx)) return multiSelectPanels.get(idx);

  const el = document.createElement("div");
  el.className = ui.tooltip.className;
  el.style.position = "absolute";
  el.style.pointerEvents = "none";
  el.style.display = "block";
  document.body.appendChild(el);
  multiSelectPanels.set(idx, el);
  return el;
}

function clearMultiSelectPanels() {
  multiSelectPanels.forEach(el => el.remove());
  multiSelectPanels.clear();
}

function updateMultiSelectPanels() {
  const keep = new Set();

  selectedIndices.forEach(idx => {
    const mesh = pointMeshes[idx];
    if (!mesh) return;
    keep.add(idx);

    const el = ensureMultiSelectPanel(idx);
    el.innerHTML = buildHoverPanelHTML(idx);

    const { x, y } = projectToScreen(mesh.position);
    el.style.left = `${Math.min(x + 16, innerWidth - 320)}px`;
    el.style.top = `${Math.min(y + 16, innerHeight - 150)}px`;
  });

  [...multiSelectPanels.keys()].forEach(idx => {
    if (!keep.has(idx)) {
      multiSelectPanels.get(idx).remove();
      multiSelectPanels.delete(idx);
    }
  });
}

const CLICK_DRAG_THRESHOLD_PX = 6;
let pointerDownX = 0;
let pointerDownY = 0;

window.addEventListener("pointerdown", e => {
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;
});

function selectAlbum(idx, additive = false) {
  const mesh = pointMeshes[idx];
  const point = points[idx];
  if (!mesh || !point) return;

  if (additive) {
    if (selectedIndices.has(idx)) {
      selectedIndices.delete(idx);
    } else {
      selectedIndices.add(idx);
    }
  } else {
    const isOnlySelected = selectedIndices.size === 1 && selectedIndices.has(idx);
    selectedIndices = isOnlySelected ? new Set() : new Set([idx]);
  }

  applySelection();

  if (selectedIndices.size === 1) {
    const onlyIdx = [...selectedIndices][0];
    focusCameraOnPoint(pointMeshes[onlyIdx]);
    scrollListToAlbum(points[onlyIdx]);
  }
}

function pointerClick(e) {
  if (e.target !== renderer.domElement) return;

  const dx = e.clientX - pointerDownX;
  const dy = e.clientY - pointerDownY;
  if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);

  const hit = raycaster.intersectObjects(pointMeshes)[0];
  if (hit) {
    const additive = e.ctrlKey || e.metaKey;
    selectAlbum(hit.object.userData.index, additive);
    return;
  }

  if (timeMode) {
    const yearHit = raycaster.intersectObjects([...orbitRings, ...yearSprites])[0];
    if (yearHit) {
      toggleYearHighlight(yearHit.object.userData.year);
      return;
    }
  }

  clearHighlight();
  clearGenreSelection();
  clearYearHighlight();
}

function jumpToAlbum(a) {
  selectAlbum(a.idx, true);
}

function animate() {
  requestAnimationFrame(animate);
  tickAnimation();
  tickCameraFocus();
  updateSelectionOutlines();
  updateGenreLabels();
  updateConnections();
  if (selectedIndices.size === 1) updatePinnedTooltipPosition(); // <-- nuevo
  if (selectedIndices.size > 1) updateMultiSelectPanels();
  controls.update();
  renderer.render(scene,camera);
}

const WEIGHTS = {
  primaryBase: 1.0,
  secondaryBase: .55,
  secondaryDecay: .78
};

const MODEL_CONFIG = {
  descriptorWeight: 0.33,
  nNeighbors: 4.3,
  minDist: 0.65
};

const TIME_LAYOUT = {
  foldWeight: 0.35,   // cuánto de UMAP_Y se pliega en el radio X/Z
  totalHeight: 100     // rango vertical total ocupado por los años
};

const ANIM_DURATION = 1400; // ms de la transición estilístico <-> temporal

const POINT_RADIUS = .25; // debe coincidir con el radio usado en SphereGeometry de createPoints
const CAMERA_FOCUS_DURATION = 900; // ms
const FOCUS_ZOOM_FACTOR = 0.4; // < 1 acerca la cámara al enfocar (más chico = zoom más cercano)
const OUTLINE_OFFSET_PX = 2;
const OUTLINE_THICKNESS_PX = 2;
const OUTLINE_SEGMENTS = 40;

const GENRE_LABEL_CONFIG = {
  minAlbumsForLabel: 2,
  radiusPadding: 8,   // <-- antes 16; más cerca del centroide del cluster
  visibleOpacity: 1,
  fadeSpeed: 0.25,
  overlapScreenDist: 48
};

const EVENT_LABEL_CONFIG = {
  offsetX: 1,           // separación horizontal respecto del borde del sprite del año
  fontSize: 24,         // mismo tamaño que el sprite del año (ver YEAR_LABEL_CONFIG)
  color: "#676767",
  maxCharsPerLine: 18,  // más chico que antes: con la tipografía más grande, menos caracteres entran por línea
  maxLines: 1,
  lineHeight: 36,
  dimmedOpacity: 0.25    // opacidad cuando hay otro año seleccionado
};

const YEAR_LABEL_DEFAULT_TINT = 0xffffff;
const YEAR_LABEL_SELECTED_TINT = 0x000000;
const ORBIT_RING_DEFAULT_COLOR = 0xc4c4c4;
const ORBIT_RING_SELECTED_COLOR = 0x000000;
const CONNECTION_CONFIG = {
  sameArtistLineOpacity: 0.9,
  level1LineOpacity: 0.65,
  level2LineOpacity: 0.5,
  level1NodeOpacity: 0.65,
  level2NodeOpacity: 0.5,
  level1Count: 2,
  level2Count: 2,
  stageDelay: 220,      // ms antes de que empiece a "encender" cada etapa
  siblingStagger: 90,   // ms extra entre hermanos dentro de la misma etapa
  fadeSpeed: 0.09,
  lineWidth: 3.2, // px, mismo grosor para la cadena sólida y las líneas punteadas
  dashSize: 0.35,  // trazo corto...
  gapSize: 0.18,    // ...y gap corto = punteado fino y denso
  originNodeOpacity: 1,
  ancestorOpacity: 0.8,
  descendantOpacity: 0.8,
  secondLevelOpacity: 0.65,
};

const ARROW_POSITION_T = 0.6; // fracción sobre la línea donde se ubica la flecha
const connectionArrowDir = new THREE.Vector3();
const connectionArrowUp = new THREE.Vector3(0, 1, 0);

let timeMode = false;
let animating = false;
let animStart = 0;
let animFrom = [];
let animTo = [];
let timeCentroid = new THREE.Vector3(); // mismo centro usado por el plegado radial, reutilizado por las órbitas
let genreLabelsVisible = true;
let selectedYear = null;
let eventsByYear = new Map();
let cameraAnimating = false;
let cameraAnimStart = 0;
const cameraFromPos = new THREE.Vector3();
const cameraToPos = new THREE.Vector3();
const cameraFromTarget = new THREE.Vector3();
const cameraToTarget = new THREE.Vector3();

let outlineRing = null;   // aro (RingGeometry) que siempre mira a cámara
let outlineTarget = null; 
let pinnedIndex = null;

let connectionLines = [];     // [{ line, fromMesh, toMesh }]
let connectionNodeFades = []; // [{ mesh, targetOpacity, appearAt }]
let activeGraphIndices = new Set(); // idx de todos los discos involucrados en el grafo actual
let hoverPreviewIndex = null;       // idx sobre el que se está mostrando un preview de hover (con panel fijo activo)

const UMAP_SEED = 12345;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function average(arr) {
  return arr.reduce((s,v) => s+v, 0) / arr.length;
}

function easeInOutCubic(t) {
  return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
}

function buildVocabulary(items) {
  const genres = new Set(), descriptors = new Set();
  items.forEach(a => {
    a.genres.primary.forEach(x => genres.add(x));
    a.genres.secondary.forEach(x => genres.add(x));
    a.descriptors.forEach(x => descriptors.add(x));
  });
  return { genres:[...genres].sort(), descriptors:[...descriptors].sort() };
}

function vectorize(album, vocab, descriptorWeight) {
  const v = new Array(vocab.genres.length + vocab.descriptors.length).fill(0);
  album.genres.primary.forEach((genre, i) => {
    const rankWeight = WEIGHTS.primaryBase * Math.pow(.88, i);
    v[vocab.genres.indexOf(genre)] = rankWeight;
  });
  album.genres.secondary.forEach((genre, i) => {
    const rankWeight = WEIGHTS.secondaryBase * Math.pow(WEIGHTS.secondaryDecay, i);
    v[vocab.genres.indexOf(genre)] = Math.max(
      v[vocab.genres.indexOf(genre)], rankWeight
    );
  });
  const offset = vocab.genres.length;
  album.descriptors.forEach(descriptor => {
    const i = vocab.descriptors.indexOf(descriptor);
    if (i >= 0) v[offset + i] = descriptorWeight;
  });

  return v;
}

const GENRE_FAMILIES = [

  // ---------- METAL ----------
  { match: /heavy metal/i,        group: "Metal", hueRange: [0, 0],   satRange: [0, 5],  lightRange: [12, 22] },
  { match: /thrash metal/i,       group: "Metal", hueRange: [0, 0],   satRange: [0, 5],  lightRange: [18, 28] },
  { match: /alternative metal/i,  group: "Metal", hueRange: [0, 0],   satRange: [0, 8],  lightRange: [24, 34] },
  { match: /groove metal/i,       group: "Metal", hueRange: [0, 0],   satRange: [0, 8],  lightRange: [30, 40] },
  { match: /metalcore/i,          group: "Metal", hueRange: [0, 0],   satRange: [0, 8],  lightRange: [36, 46] },
  { match: /nu metal/i,           group: "Metal", hueRange: [0, 0],   satRange: [0, 10], lightRange: [42, 52] },
  { match: /power metal/i,        group: "Metal", hueRange: [0, 0],   satRange: [0, 10], lightRange: [48, 58] },
  { match: /speed metal/i,        group: "Metal", hueRange: [0, 0],   satRange: [0, 8],  lightRange: [54, 64] },
  { match: /glam metal/i,         group: "Metal", hueRange: [0, 0],   satRange: [0, 12], lightRange: [60, 72] },
  { match: /neoclassical metal/i, group: "Metal", hueRange: [0, 0],   satRange: [0, 5],  lightRange: [15, 25] },
  { match: /rap metal/i,          group: "Metal", hueRange: [0, 0],   satRange: [0, 8],  lightRange: [25, 35] },

  // ---------- ROCK ----------
  { match: /hard rock/i,              group: "Rock", hueRange: [205, 210], satRange: [55, 75], lightRange: [30, 42] },
  { match: /alternative rock/i,       group: "Rock", hueRange: [210, 215], satRange: [50, 75], lightRange: [35, 47] },
  { match: /blues rock/i,             group: "Rock", hueRange: [215, 220], satRange: [45, 70], lightRange: [38, 50] },
  { match: /progressive rock/i,       group: "Rock", hueRange: [220, 225], satRange: [50, 75], lightRange: [42, 54] },
  { match: /art rock/i,               group: "Rock", hueRange: [225, 230], satRange: [45, 70], lightRange: [45, 57] },
  { match: /rock opera/i,             group: "Rock", hueRange: [230, 235], satRange: [50, 75], lightRange: [48, 60] },
  { match: /\bbig music\b/i,          group: "Rock", hueRange: [235, 240], satRange: [50, 80], lightRange: [50, 62] },
  { match: /\baor\b/i,                group: "Rock", hueRange: [240, 245], satRange: [45, 70], lightRange: [52, 64] },
  { match: /acoustic rock/i,          group: "Rock", hueRange: [210, 218], satRange: [35, 60], lightRange: [55, 67] },
  { match: /boogie rock/i,            group: "Rock", hueRange: [215, 223], satRange: [45, 70], lightRange: [45, 57] },
  { match: /britpop/i,                group: "Rock", hueRange: [220, 228], satRange: [50, 75], lightRange: [48, 60] },
  { match: /experimental rock/i,      group: "Rock", hueRange: [225, 233], satRange: [45, 70], lightRange: [40, 52] },
  { match: /funk rock/i,              group: "Rock", hueRange: [230, 238], satRange: [55, 80], lightRange: [45, 57] },
  { match: /garage rock/i,            group: "Rock", hueRange: [205, 215], satRange: [60, 80], lightRange: [32, 44] },
  { match: /grunge/i,                 group: "Rock", hueRange: [210, 220], satRange: [25, 50], lightRange: [28, 40] },
  { match: /indie rock/i,             group: "Rock", hueRange: [220, 230], satRange: [40, 65], lightRange: [45, 58] },
  { match: /industrial rock/i,        group: "Rock", hueRange: [225, 235], satRange: [20, 45], lightRange: [25, 38] },
  { match: /noise rock/i,             group: "Rock", hueRange: [230, 240], satRange: [30, 55], lightRange: [30, 42] },
  { match: /piano rock/i,             group: "Rock", hueRange: [235, 245], satRange: [35, 60], lightRange: [55, 67] },
  { match: /roots rock/i,             group: "Rock", hueRange: [205, 215], satRange: [35, 60], lightRange: [40, 52] },
  { match: /slacker rock/i,           group: "Rock", hueRange: [215, 225], satRange: [35, 60], lightRange: [45, 57] },
  { match: /soft rock/i,              group: "Rock", hueRange: [225, 235], satRange: [35, 60], lightRange: [58, 70] },
  { match: /stoner rock/i,            group: "Rock", hueRange: [205, 215], satRange: [40, 65], lightRange: [25, 37] },
  { match: /^rock\s*(&|and)\s*roll$/i, group: "Rock", hueRange: [210, 220], satRange: [55, 80], lightRange: [38, 50] },
  { match: /^rock$/i,                group: "Rock", hueRange: [220, 230], satRange: [50, 75], lightRange: [42, 54] },
  { match: /comedy rock/i,            group: "Rock", hueRange: [235, 245], satRange: [50, 75], lightRange: [55, 67] },
  { match: /geek rock/i,              group: "Rock", hueRange: [225, 235], satRange: [45, 70], lightRange: [55, 67] },
  { match: /post-rock/i,              group: "Rock", hueRange: [240, 250], satRange: [35, 60], lightRange: [35, 50] },
  { match: /symphonic prog/i,         group: "Rock", hueRange: [250, 258], satRange: [45, 70], lightRange: [40, 55] },
  { match: /symphonic rock/i,         group: "Rock", hueRange: [258, 266], satRange: [50, 75], lightRange: [42, 55] },

  // ---------- PUNK ----------
  { match: /punk rock/i,             group: "Punk", hueRange: [0, 5],   satRange: [75, 95], lightRange: [35, 45] },
  { match: /melodic hardcore/i,      group: "Punk", hueRange: [5, 10],  satRange: [70, 90], lightRange: [40, 50] },
  { match: /post-punk revival/i,      group: "Punk", hueRange: [10, 15], satRange: [65, 90], lightRange: [45, 55] },
  { match: /dance-punk revival/i,     group: "Punk", hueRange: [15, 20], satRange: [70, 95], lightRange: [50, 60] },
  { match: /art punk/i,              group: "Punk", hueRange: [20, 25], satRange: [60, 85], lightRange: [45, 55] },
  { match: /hardcore punk/i,         group: "Punk", hueRange: [0, 8],   satRange: [80, 100], lightRange: [25, 35] },
  { match: /pop punk/i,              group: "Punk", hueRange: [8, 16],  satRange: [70, 95], lightRange: [55, 65] },
  { match: /post-hardcore/i,         group: "Punk", hueRange: [15, 22], satRange: [65, 90], lightRange: [35, 45] },
  { match: /skate punk/i,            group: "Punk", hueRange: [22, 28], satRange: [75, 95], lightRange: [45, 55] },

  // ---------- POP ----------
  { match: /synthpop/i,              group: "Pop", hueRange: [285, 290], satRange: [55, 85], lightRange: [45, 58] },
  { match: /art pop/i,               group: "Pop", hueRange: [290, 295], satRange: [50, 80], lightRange: [50, 63] },
  { match: /chamber pop/i,           group: "Pop", hueRange: [295, 300], satRange: [40, 70], lightRange: [58, 70] },
  { match: /sophisti-pop/i,          group: "Pop", hueRange: [300, 305], satRange: [40, 70], lightRange: [52, 65] },
  { match: /power pop/i,             group: "Pop", hueRange: [305, 310], satRange: [65, 90], lightRange: [48, 60] },
  { match: /indie pop/i,             group: "Pop", hueRange: [310, 315], satRange: [50, 80], lightRange: [50, 63] },
  { match: /twee pop/i,              group: "Pop", hueRange: [315, 320], satRange: [45, 75], lightRange: [60, 72] },
  { match: /latin pop/i,             group: "Pop", hueRange: [320, 325], satRange: [65, 90], lightRange: [50, 63] },
  { match: /pop rock/i,              group: "Pop", hueRange: [325, 330], satRange: [55, 85], lightRange: [45, 58] },
  { match: /baroque pop/i,           group: "Pop", hueRange: [330, 335], satRange: [40, 70], lightRange: [55, 68] },
  { match: /jangle pop/i,            group: "Pop", hueRange: [300, 310], satRange: [45, 75], lightRange: [58, 70] },
  { match: /noise pop/i,             group: "Pop", hueRange: [310, 320], satRange: [55, 85], lightRange: [42, 55] },
  { match: /progressive pop/i,       group: "Pop", hueRange: [320, 330], satRange: [45, 75], lightRange: [45, 58] },
  { match: /dance-pop/i,             group: "Pop", hueRange: [335, 340], satRange: [70, 95], lightRange: [50, 63] },
  { match: /^pop$/i,                 group: "Pop", hueRange: [315, 325], satRange: [60, 90], lightRange: [55, 68] },
  { match: /adult contemporary/i,    group: "Pop", hueRange: [290, 300], satRange: [30, 60], lightRange: [65, 78] },
  { match: /electropop/i,            group: "Pop", hueRange: [280, 290], satRange: [60, 90], lightRange: [45, 60] },
  { match: /folk pop/i,              group: "Pop", hueRange: [300, 310], satRange: [40, 70], lightRange: [60, 72] },

  // ---------- NEW WAVE ----------
  { match: /new wave/i,              group: "New Wave", hueRange: [260, 270], satRange: [45, 75], lightRange: [40, 55] },
  { match: /ethereal wave/i,         group: "New Wave", hueRange: [270, 280], satRange: [35, 65], lightRange: [50, 65] },

  // ---------- POST-PUNK ----------
  { match: /post-punk/i,             group: "Post-Punk", hueRange: [330, 340], satRange: [45, 70], lightRange: [28, 42] },
  { match: /gothic rock/i,            group: "Post-Punk", hueRange: [340, 350], satRange: [35, 65], lightRange: [22, 38] },

  // ---------- REGGAE ----------
  { match: /reggae/i,                group: "Reggae", hueRange: [95, 105],  satRange: [55, 85], lightRange: [35, 50] },
  { match: /lovers rock/i,           group: "Reggae", hueRange: [105, 115], satRange: [45, 75], lightRange: [45, 60] },
  { match: /\bdub\b/i,               group: "Reggae", hueRange: [115, 130], satRange: [50, 80], lightRange: [28, 43] },

  // ---------- SKA ----------
  { match: /2 tone/i,                group: "Ska", hueRange: [45, 52], satRange: [60, 85], lightRange: [35, 50] },
  { match: /third wave ska/i,        group: "Ska", hueRange: [52, 60], satRange: [65, 90], lightRange: [40, 55] },
  { match: /\bska\b/i,               group: "Ska", hueRange: [60, 70], satRange: [60, 90], lightRange: [45, 60] },

  // ---------- PSICODELIA ----------
  { match: /psychedelic rock/i,      group: "Psicodelia", hueRange: [165, 172], satRange: [55, 85], lightRange: [40, 55] },
  { match: /neo-psychedelia/i,       group: "Psicodelia", hueRange: [172, 179], satRange: [50, 80], lightRange: [45, 60] },
  { match: /shoegaze/i,              group: "Psicodelia", hueRange: [179, 186], satRange: [35, 65], lightRange: [50, 65] },
  { match: /dream pop/i,             group: "Psicodelia", hueRange: [186, 193], satRange: [35, 70], lightRange: [55, 70] },
  { match: /heavy psych/i,           group: "Psicodelia", hueRange: [160, 168], satRange: [60, 90], lightRange: [30, 45] },
  { match: /psychedelic folk/i,      group: "Psicodelia", hueRange: [168, 176], satRange: [40, 70], lightRange: [50, 65] },
  { match: /psychedelic pop/i,       group: "Psicodelia", hueRange: [176, 184], satRange: [55, 85], lightRange: [50, 65] },
  { match: /acid rock/i,             group: "Psicodelia", hueRange: [184, 192], satRange: [60, 90], lightRange: [35, 50] },
  { match: /space rock/i,            group: "Psicodelia", hueRange: [192, 200], satRange: [40, 75], lightRange: [35, 52] },

  // ---------- ELECTRÓNICA / DANCE ----------
  { match: /downtempo/i,             group: "Electrónica", hueRange: [180, 188], satRange: [35, 65], lightRange: [40, 55] },
  { match: /alternative dance/i,     group: "Electrónica", hueRange: [188, 196], satRange: [50, 80], lightRange: [45, 60] },
  { match: /new rave/i,              group: "Electrónica", hueRange: [196, 204], satRange: [65, 95], lightRange: [45, 60] },
  { match: /chillout/i,              group: "Electrónica", hueRange: [204, 212], satRange: [30, 60], lightRange: [55, 70] },
  { match: /^electronic$/i,          group: "Electrónica", hueRange: [212, 220], satRange: [50, 80], lightRange: [45, 60] },
  { match: /synth funk/i,            group: "Electrónica", hueRange: [220, 228], satRange: [55, 85], lightRange: [45, 60] },
  { match: /euro house/i,            group: "Electrónica", hueRange: [228, 236], satRange: [65, 95], lightRange: [50, 65] },
  { match: /acid house/i,            group: "Electrónica", hueRange: [196, 204], satRange: [70, 100], lightRange: [35, 50] },
  { match: /electronic dance music/i, group: "Electrónica", hueRange: [204, 212], satRange: [70, 100], lightRange: [40, 55] },
  { match: /indietronica/i,           group: "Electrónica", hueRange: [212, 220], satRange: [55, 85], lightRange: [45, 60] },
  { match: /^techno$/i,              group: "Electrónica", hueRange: [220, 228], satRange: [60, 90], lightRange: [30, 45] },
  { match: /^disco$/i,               group: "Electrónica", hueRange: [236, 244], satRange: [65, 95], lightRange: [45, 60] },
  { match: /\bidm\b/i,               group: "Electrónica", hueRange: [244, 252], satRange: [40, 70], lightRange: [35, 50] },

  // ---------- AMBIENT ----------
  { match: /dark ambient/i,          group: "Electrónica", hueRange: [180, 190], satRange: [15, 40], lightRange: [20, 32] },
  { match: /ambient pop/i,            group: "Electrónica", hueRange: [190, 200], satRange: [25, 55], lightRange: [55, 70] },
  { match: /^ambient$/i,             group: "Electrónica", hueRange: [200, 210], satRange: [20, 50], lightRange: [45, 60] },
  { match: /^drone$/i,               group: "Electrónica", hueRange: [210, 220], satRange: [10, 35], lightRange: [25, 40] },
  { match: /neoclassical new age/i,  group: "Electrónica", hueRange: [220, 228], satRange: [10, 30], lightRange: [50, 65] },
  { match: /^new age$/i,             group: "Electrónica", hueRange: [228, 236], satRange: [10, 30], lightRange: [50, 65] },

  // ---------- HIP HOP / RAP ----------
  { match: /rap rock/i,              group: "Hip Hop / Rap", hueRange: [15, 22], satRange: [60, 90], lightRange: [35, 50] },
  { match: /pop rap/i,               group: "Hip Hop / Rap", hueRange: [22, 29], satRange: [65, 95], lightRange: [45, 60] },
  { match: /abstract hip hop/i,      group: "Hip Hop / Rap", hueRange: [29, 36], satRange: [45, 75], lightRange: [35, 50] },
  { match: /experimental hip hop/i,  group: "Hip Hop / Rap", hueRange: [36, 43], satRange: [50, 80], lightRange: [40, 55] },
  { match: /hardcore hip hop/i,      group: "Hip Hop / Rap", hueRange: [15, 25], satRange: [70, 95], lightRange: [25, 40] },
  { match: /latin rap/i,             group: "Hip Hop / Rap", hueRange: [25, 35], satRange: [70, 95], lightRange: [45, 60] },
  { match: /mid-school hip hop/i,    group: "Hip Hop / Rap", hueRange: [35, 45], satRange: [55, 85], lightRange: [40, 55] },
  { match: /^hip hop$/i,             group: "Hip Hop / Rap", hueRange: [20, 35], satRange: [60, 90], lightRange: [35, 52] },

  // ---------- FOLK / CANCIÓN ----------
  { match: /folk rock/i,              group: "Folk", hueRange: [40, 45], satRange: [45, 70], lightRange: [40, 55] },
  { match: /singer-songwriter/i,      group: "Folk", hueRange: [45, 50], satRange: [35, 60], lightRange: [50, 65] },
  { match: /\bbeat\b/i,               group: "Folk", hueRange: [50, 55], satRange: [50, 75], lightRange: [45, 60] },
  { match: /contemporary folk/i,      group: "Folk", hueRange: [55, 60], satRange: [35, 65], lightRange: [55, 70] },
  { match: /progressive folk/i,       group: "Folk", hueRange: [60, 65], satRange: [40, 70], lightRange: [45, 60] },
  { match: /folktronica/i,            group: "Folk", hueRange: [50, 60], satRange: [45, 75], lightRange: [50, 65] },
  { match: /indie folk/i,             group: "Folk", hueRange: [65, 70], satRange: [40, 65], lightRange: [45, 60] },

  // ---------- LATINA ----------
  { match: /latin alternative/i,       group: "Latina", hueRange: [5, 12],   satRange: [60, 90], lightRange: [40, 55] },
  { match: /andean new age/i,          group: "Latina", hueRange: [12, 19],  satRange: [45, 75], lightRange: [45, 60] },
  { match: /bossa nova/i,              group: "Latina", hueRange: [19, 26],  satRange: [50, 80], lightRange: [45, 60] },
  { match: /chamamé/i,                 group: "Latina", hueRange: [26, 33],  satRange: [55, 85], lightRange: [40, 55] },
  { match: /hispanic american folk music/i, group: "Latina", hueRange: [33, 40], satRange: [40, 70], lightRange: [45, 60] },
  { match: /indigenous andean music/i, group: "Latina", hueRange: [40, 47],  satRange: [45, 75], lightRange: [40, 55] },
  { match: /latin rock/i,              group: "Latina", hueRange: [5, 15],   satRange: [55, 85], lightRange: [35, 50] },
  { match: /nuevo cancionero/i,       group: "Latina", hueRange: [15, 25],  satRange: [40, 70], lightRange: [45, 60] },
  { match: /rock andino/i,             group: "Latina", hueRange: [25, 35],  satRange: [50, 80], lightRange: [35, 50] },
  { match: /cumbia argentina/i,       group: "Latina", hueRange: [35, 45],  satRange: [70, 100], lightRange: [45, 60] },
  { match: /^tango$/i,                group: "Latina", hueRange: [350, 360], satRange: [35, 65], lightRange: [25, 40] },
  { match: /bolero/i,                 group: "Latina", hueRange: [47, 54],  satRange: [35, 60], lightRange: [50, 65] },
  { match: /candombe/i,               group: "Latina", hueRange: [54, 61],  satRange: [60, 90], lightRange: [35, 50] },
  { match: /chacarera/i,              group: "Latina", hueRange: [61, 68],  satRange: [55, 85], lightRange: [40, 55] },
  { match: /^hispanic american music$/i, group: "Latina", hueRange: [68, 75], satRange: [40, 70], lightRange: [45, 60] },
  { match: /milonga/i,                group: "Latina", hueRange: [340, 347], satRange: [35, 60], lightRange: [30, 45] },
  { match: /zamba/i,                  group: "Latina", hueRange: [75, 82],  satRange: [45, 70], lightRange: [40, 55] },

  // ---------- JAZZ ----------
  { match: /jazz-rock/i,              group: "Jazz", hueRange: [45, 50], satRange: [50, 75], lightRange: [35, 50] },
  { match: /acid jazz/i,              group: "Jazz", hueRange: [50, 55], satRange: [60, 85], lightRange: [40, 55] },
  { match: /free improvisation/i,     group: "Jazz", hueRange: [55, 60], satRange: [35, 65], lightRange: [35, 50] },
  { match: /jazz fusion/i,            group: "Jazz", hueRange: [60, 65], satRange: [55, 80], lightRange: [40, 55] },
  { match: /jazz-funk/i,              group: "Jazz", hueRange: [65, 70], satRange: [65, 90], lightRange: [45, 60] },
  { match: /jazz pop/i,               group: "Jazz", hueRange: [70, 75], satRange: [45, 70], lightRange: [50, 65] },
  { match: /smooth jazz/i,            group: "Jazz", hueRange: [75, 80], satRange: [35, 60], lightRange: [55, 70] },

  // ---------- RAÍCES ----------
  { match: /^blues$/i,                group: "Raíces", hueRange: [25, 30], satRange: [45, 70], lightRange: [30, 45] },
  { match: /rockabilly/i,             group: "Raíces", hueRange: [30, 35], satRange: [55, 80], lightRange: [35, 50] },
  { match: /^twist$/i,                group: "Raíces", hueRange: [35, 40], satRange: [50, 75], lightRange: [45, 60] },
  { match: /^funk$/i,                 group: "Raíces", hueRange: [40, 45], satRange: [60, 85], lightRange: [40, 55] },
  { match: /rhythm (&|and) blues/i,   group: "Raíces", hueRange: [45, 50], satRange: [50, 75], lightRange: [35, 50] },
  { match: /americana/i,              group: "Raíces", hueRange: [30, 38], satRange: [40, 65], lightRange: [45, 60] },
  { match: /neo-soul/i,               group: "Raíces", hueRange: [38, 46], satRange: [45, 70], lightRange: [40, 55] },
  { match: /acoustic blues/i,         group: "Raíces", hueRange: [20, 25], satRange: [35, 60], lightRange: [35, 50] },
  { match: /^boogie$/i,               group: "Raíces", hueRange: [46, 52], satRange: [55, 80], lightRange: [35, 50] },
  { match: /contemporary r&b/i,       group: "Raíces", hueRange: [50, 56], satRange: [50, 75], lightRange: [40, 55] },

  // ---------- CHRISTIAN ----------
  { match: /christian rock/i,         group: "Christian", hueRange: [150, 160], satRange: [40, 70], lightRange: [40, 55] }

];

const GROUP_ORDER = [
  "Metal",
  "Rock",
  "Punk",
  "Pop",
  "New Wave",
  "Post-Punk",
  "Reggae",
  "Ska",
  "Psicodelia",
  "Electrónica",
  "Hip Hop / Rap",
  "Folk",
  "Latina",
  "Jazz",
  "Raíces",
  "Christian",
  "Otros"
];

const groupColorCache = new Map();
const groupHueCache = new Map();
function hueForGroup(group) {
  if (groupHueCache.has(group)) return groupHueCache.get(group);

  const families = GENRE_FAMILIES.filter(f => f.group === group);
  const hue = families.length
    ? average(families.map(f => (f.hueRange[0] + f.hueRange[1]) / 2)) % 360
    : 0;

  groupHueCache.set(group, hue);
  return hue;
}

function colorForGroup(group) {
  if (groupColorCache.has(group)) return groupColorCache.get(group);
 
  const families = GENRE_FAMILIES.filter(f => f.group === group);
  const c = new THREE.Color();
 
  if (!families.length) {
    c.setHSL(0, 0, 0.5);
    groupColorCache.set(group, c);
    return c;
  }
 
  const hueMid = f => (f.hueRange[0] + f.hueRange[1]) / 2;
  const satMid = f => f.satRange ? (f.satRange[0] + f.satRange[1]) / 2 / 100 : 0.72;
  const lightMid = f => f.lightRange ? (f.lightRange[0] + f.lightRange[1]) / 2 / 100 : 0.58;
 
  const avgHue = (average(families.map(hueMid)) % 360) / 360;
  const avgSat = average(families.map(satMid));
  const avgLight = average(families.map(lightMid));
 
  c.setHSL(avgHue, avgSat, avgLight);
  groupColorCache.set(group, c);
  return c;
}

function familyForGenre(name) {
  return GENRE_FAMILIES.find(f => f.match.test(name)) ?? null;
}

const genreHue = new Map();
function hueForGenre(name) {
  if (!genreHue.has(name)) {
    let hash = 0;
    for (let i=0;i<name.length;i++) hash = (hash * 31 + name.charCodeAt(i)) % 1000;

    const family = familyForGenre(name);
    if (family) {
      const [min, max] = family.hueRange;
      const span = max - min;
      const hue = span === 0 ? min : min + (hash % 1000) / 1000 * span;
      genreHue.set(name, hue);
    } else {
      // Sin familia (ej: "Beat"): hash libre, como respaldo
      genreHue.set(name, hash % 360);
    }
  }
  return genreHue.get(name);
}

const genreFamilyCache = new Map();
function cachedFamilyForGenre(name) {
  if (!genreFamilyCache.has(name)) {
    genreFamilyCache.set(name, familyForGenre(name));
  }
  return genreFamilyCache.get(name);
}

function colorForAlbum(album) {
  const primary = album.genres.primary[0];
  const c = new THREE.Color();

  if (!primary) {
    c.setHSL(0, 0, 0.5);
    return c;
  }

  const family = cachedFamilyForGenre(primary);

  if (!family) {
    c.setHSL(0, 0, 0.5);
    return c;
  }

  const hue = hueForGenre(primary);

  const saturation = family.satRange
    ? ((family.satRange[0] + family.satRange[1]) / 2) / 100
    : 0.72;

  const lightness = family.lightRange
    ? ((family.lightRange[0] + family.lightRange[1]) / 2) / 100
    : 0.58;

  c.setHSL(
    hue / 360,
    saturation,
    lightness
  );

  return c;
}
function normalize3D(coords) {
  const out = coords.map(p => [...p]);
  for (let d=0; d<3; d++) {
    const vals = out.map(p => p[d]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max-min || 1;
    out.forEach(p => p[d] = ((p[d]-min)/span - .5) * 90);
  }
  return out;
}

function computeTimeLayout() {
  if (!points.length) return;

  const ux = points.map(p => p.position[0]);
  const uy = points.map(p => p.position[1]);
  const uz = points.map(p => p.position[2]);

  const cx = average(ux);
  const cy = average(uy);
  const cz = average(uz);
  timeCentroid.set(cx, cy, cz);

  const years = points.map(p => p.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearSpan = (maxYear - minYear) || 1;

  points.forEach(p => {
    const [px, py, pz] = p.position;
    const angle = Math.atan2(pz - cz, px - cx);
    const baseRadius = Math.hypot(px - cx, pz - cz);

    const foldedRadius = baseRadius + TIME_LAYOUT.foldWeight * (py - cy);

    const timeX = cx + foldedRadius * Math.cos(angle);
    const timeZ = cz + foldedRadius * Math.sin(angle);

    const t = (p.year - minYear) / yearSpan; // 0..1
    const timeY = (t - 0.5) * TIME_LAYOUT.totalHeight;

    p.umapVec = new THREE.Vector3(px, py, pz);
    p.timeVec = new THREE.Vector3(timeX, timeY, timeZ);
  });
}

async function calculateModel() {
  ui.status.textContent = "Calculando espacio latente…";
  clearScene();

  const vocab = buildVocabulary(albums);
  const matrix = albums.map(a => vectorize(a, vocab, MODEL_CONFIG.descriptorWeight));

  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(MODEL_CONFIG.nNeighbors, albums.length - 1),
    minDist: MODEL_CONFIG.minDist,
    spread: 1,
    random: mulberry32(UMAP_SEED)
  });

  const embedding = await umap.fitAsync(matrix);
  const coords = normalize3D(embedding);

  points = coords.map((p,i) => ({
    ...albums[i],
    position: p,
    color: colorForAlbum(albums[i]),
    idx: i, 
    searchText: `${albums[i].album} ${albums[i].artist}`.toLowerCase()
  }));

  computeTimeLayout();
  createPoints();
  createYearSprites();
  createYearOrbits();
  createGenreLabels();

  if (timeMode) {
    pointMeshes.forEach((m,i) => m.position.copy(points[i].timeVec));
    yearSprites.forEach(s => {
      s.material.opacity = 1;
      s.userData.targetOpacity = 1;
    });
    orbitRings.forEach(r => {
      r.material.opacity = 0.25;
      r.userData.targetOpacity = 0.25;
    });
  }

  renderList();
  renderGenreLegend();
  refreshFilterOptions();
  fitCamera();
  ui.status.textContent =
    `${albums.length} álbumes · ${vocab.genres.length} géneros · ${vocab.descriptors.length} descriptores · UMAP 3D`;
}

function createPoints() {
  points.forEach((a,i) => {
    const geo = new THREE.SphereGeometry(POINT_RADIUS, 10, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: a.color,
      emissive: a.color,
      emissiveIntensity: .35,
      roughness: .35,
      metalness: .15,
      transparent: true,
      opacity: 1  
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a.umapVec);
    mesh.userData.index = i;
    mesh.userData.album = a;
    root.add(mesh);
    pointMeshes.push(mesh);
  });

  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  root.add(ambient);
  const light = new THREE.DirectionalLight(0xffffff, 0.25);
  light.position.set(30,60,50);
  root.add(light);
}

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";

  words.forEach(word => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);

  return lines;
}

function createYearSprites() {
  const years = [...new Set(points.map(p => p.year))].sort((a,b) => a-b);
  if (!years.length) return;

  const minYear = years[0], maxYear = years[years.length-1];
  const yearSpan = (maxYear - minYear) || 1;

  const ux = points.map(p => p.position[0]);
  const uz = points.map(p => p.position[2]);
  const marginX = Math.min(...ux) - 14;
  const cz = average(uz);

  years.forEach(year => {
    const t = (year - minYear) / yearSpan;
    const y = (t - 0.5) * TIME_LAYOUT.totalHeight;

    const sprite = makeYearSprite(String(year));
    sprite.position.set(marginX, y, cz);
    sprite.material.opacity = 0;
    sprite.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
    sprite.userData.targetOpacity = 0;
    sprite.userData.year = year;
    root.add(sprite);
    yearSprites.push(sprite);

    const eventText = eventsByYear.get(year);
    if (eventText) {
      const eventSprite = makeEventLabelSprite(eventText);
      const yearLeftEdgeX = sprite.position.x - sprite.scale.x / 2;
      eventSprite.position.set(
        yearLeftEdgeX - EVENT_LABEL_CONFIG.offsetX - eventSprite.scale.x / 2,
        y,
        cz
      );
      eventSprite.material.opacity = 0;
      eventSprite.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
      eventSprite.userData.targetOpacity = 0;
      eventSprite.userData.year = year;
      eventSprite.userData.isEventLabel = true;
      root.add(eventSprite);
      yearSprites.push(eventSprite);
    }
  });
}

function makeYearSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = "regular 48px sans-serif";
  ctx.fillStyle = "#848484";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 48);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(14, 5.25, 1);
  return sprite;
}

function makeEventLabelSprite(text) {
  const { fontSize, color, maxCharsPerLine, maxLines, lineHeight } = EVENT_LABEL_CONFIG;
  const lines = [text];

  const canvasWidth = 600;
  const canvasHeight = Math.max(lines.length * lineHeight + 20, 60);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  ctx.font = `regular ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const startY = canvasHeight / 2 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasWidth - 8, startY + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  const unitsPerPx = 14 / 256;
  sprite.scale.set(canvasWidth * unitsPerPx, canvasHeight * unitsPerPx, 1);
  return sprite;
}

function createYearOrbits() {
  const byYear = new Map();
  points.forEach(p => {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year).push(p);
  });

  byYear.forEach((group, year) => {
    const radii = group.map(p =>
      Math.hypot(p.timeVec.x - timeCentroid.x, p.timeVec.z - timeCentroid.z)
    );

    const radius = Math.max(average(radii), 6);

    const geo = new THREE.TorusGeometry(radius, 0.18, 8, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: ORBIT_RING_DEFAULT_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2; // acostar el anillo en el plano X/Z
    ring.position.set(timeCentroid.x, group[0].timeVec.y, timeCentroid.z);
    ring.userData.targetOpacity = 0;
    ring.userData.year = year;
    root.add(ring);
    orbitRings.push(ring);
  });
}

const groupLabelColorCache = new Map();
function colorForGroupLabel(group) {
  if (groupLabelColorCache.has(group)) return groupLabelColorCache.get(group);

  const families = GENRE_FAMILIES.filter(f => f.group === group);
  const c = new THREE.Color();

  if (!families.length) {
    c.setHSL(0, 0, 0.35); // "Otros": gris oscuro neutro, sin familia de la que tomar hue
    groupLabelColorCache.set(group, c);
    return c;
  }

  const hue = hueForGroup(group) / 360;
  const satMid = f => f.satRange ? (f.satRange[0] + f.satRange[1]) / 2 / 100 : 0.72;
  const lightMid = f => f.lightRange ? (f.lightRange[0] + f.lightRange[1]) / 2 / 100 : 0.58;

  const avgSat = average(families.map(satMid));
  const minLight = Math.min(...families.map(lightMid));
  const labelLight = THREE.MathUtils.clamp(minLight, 0.22, 0.42);

  c.setHSL(hue, avgSat, labelLight);
  groupLabelColorCache.set(group, c);
  return c;
}

function makeGenreLabelSprite(genre, color) {
  const label = genre.toUpperCase();

  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 24px sans-serif";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.strokeText(label, canvas.width/2, canvas.height/2);

  ctx.fillStyle = color.getStyle(); // <-- antes: "#a2a1a1"
  ctx.fillText(label, canvas.width/2, canvas.height/2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(11, 2.75, 1);
  return sprite;
}

function computeGenreLabelData() {
  if (!points.length) return [];

  const cx = average(points.map(p => p.umapVec.x));
  const cy = average(points.map(p => p.umapVec.y));
  const cz = average(points.map(p => p.umapVec.z));
  const globalCentroid = new THREE.Vector3(cx, cy, cz);

  const acc = new Map(); // group -> { sum: Vector3, count }

  points.forEach(p => {
    const genres = new Set([...p.genres.primary, ...p.genres.secondary]);
    const groupsForPoint = new Set(
      [...genres].map(g => cachedFamilyForGenre(g)?.group ?? "Otros")
    );

    groupsForPoint.forEach(group => {
      if (group === "Otros") return; // <-- nuevo: no generar etiqueta flotante para "Otros"
      if (!acc.has(group)) acc.set(group, { sum: new THREE.Vector3(), count: 0 });
      const entry = acc.get(group);
      entry.sum.add(p.umapVec);
      entry.count += 1;
    });
  });

  const data = [];
  acc.forEach((entry, group) => {
    if (entry.count < GENRE_LABEL_CONFIG.minAlbumsForLabel) return;

    const centroid = entry.sum.clone().divideScalar(entry.count);
    const dir = centroid.clone().sub(globalCentroid);

    if (dir.lengthSq() < 1e-6) {
      const h = (hueForGroup(group) / 360) * Math.PI * 2;
      dir.set(Math.cos(h), 0.2, Math.sin(h));
    }
    dir.normalize();

    const position = centroid.clone().addScaledVector(dir, GENRE_LABEL_CONFIG.radiusPadding);
    data.push({ genre: group, position, count: entry.count });
  });

  return data;
}
function createGenreLabels() {
  computeGenreLabelData().forEach(d => {
    const sprite = makeGenreLabelSprite(d.genre, colorForGroupLabel(d.genre)); // <-- agregado el color
    sprite.position.copy(d.position);
    sprite.material.opacity = 0;
    labelGroup.add(sprite);

    genreLabelSprites.push({
      sprite,
      genre: d.genre,
      position: d.position,
      count: d.count,
      screenX: 0,
      screenY: 0,
      behindCamera: false,
      overlapHidden: false
    });
  });
}

function clearGenreLabels() {
  genreLabelSprites.forEach(g => {
    g.sprite.material.map?.dispose();
    g.sprite.material.dispose();
    labelGroup.remove(g.sprite);
  });
  genreLabelSprites = [];
}

const genreLabelProjection = new THREE.Vector3();

function updateGenreLabels() {
  if (!genreLabelSprites.length) return;

  const shouldEvaluate = genreLabelsVisible && !timeMode;

  if (shouldEvaluate) {
    genreLabelSprites.forEach(g => {
      genreLabelProjection.copy(g.position).project(camera);
      g.behindCamera = genreLabelProjection.z > 1 || genreLabelProjection.z < -1;
      g.screenX = (genreLabelProjection.x * 0.5 + 0.5) * innerWidth;
      g.screenY = (-genreLabelProjection.y * 0.5 + 0.5) * innerHeight;
    });

    const sorted = [...genreLabelSprites].sort((a, b) => b.count - a.count);
    const kept = [];
    sorted.forEach(g => {
      if (g.behindCamera) { g.overlapHidden = true; return; }
      const overlaps = kept.some(k => {
        const dx = g.screenX - k.screenX;
        const dy = g.screenY - k.screenY;
        return Math.hypot(dx, dy) < GENRE_LABEL_CONFIG.overlapScreenDist;
      });
      g.overlapHidden = overlaps;
      if (!overlaps) kept.push(g);
    });
  }

  genreLabelSprites.forEach(g => {
    const target = (shouldEvaluate && !g.overlapHidden) ? GENRE_LABEL_CONFIG.visibleOpacity : 0;
    g.sprite.material.opacity += (target - g.sprite.material.opacity) * GENRE_LABEL_CONFIG.fadeSpeed;
  });
}

function setGenreLabelsVisible(on) {
  genreLabelsVisible = on;
}

function setTimeMode(on) {
  if (!pointMeshes.length) { timeMode = on; return; }

  timeMode = on;
  animFrom = pointMeshes.map(m => m.position.clone());
  animTo = points.map(p => timeMode ? p.timeVec : p.umapVec);
  animStart = performance.now();
  animating = true;

  yearSprites.forEach(s => { s.userData.targetOpacity = timeMode ? 1 : 0; });
  orbitRings.forEach(r => { r.userData.targetOpacity = timeMode ? 0.25 : 0; });

}

function tickAnimation() {
  if (!animating) return;

  const t = Math.min((performance.now() - animStart) / ANIM_DURATION, 1);
  const eased = easeInOutCubic(t);

  pointMeshes.forEach((m,i) => {
    m.position.lerpVectors(animFrom[i], animTo[i], eased);
  });

  yearSprites.forEach(s => {
    const target = s.userData.targetOpacity ?? 0;
    s.material.opacity += (target - s.material.opacity) * 0.15;
  });

  orbitRings.forEach(r => {
    const target = r.userData.targetOpacity ?? 0;
    r.material.opacity += (target - r.material.opacity) * 0.15;
  });

  if (t >= 1) animating = false;
}

function highlightPoint(mesh) {
  clearGenreSelection();
  clearYearHighlight();

  pointMeshes.forEach(m => {
    m.material.opacity = (m === mesh) ? 1 : 0.35;
  });

  const idx = mesh.userData.index;
  if (idx !== undefined) buildAncestorDescendantGraph(idx);
}

function legendDotColor(g) {
  const family = cachedFamilyForGenre(g);

  const hue = hueForGenre(g) / 360;
  const saturation = family?.satRange
    ? ((family.satRange[0] + family.satRange[1]) / 2) / 100
    : 0.72;
  const lightness = family?.lightRange
    ? ((family.lightRange[0] + family.lightRange[1]) / 2) / 100
    : 0.58;

  const c = new THREE.Color();
  c.setHSL(hue, saturation, lightness);
  return c;
}

// --- Selección de géneros (árbol) ---------------------------------------
// selectedGenres guarda géneros/subgéneros "hoja". Seleccionar un grupo
// padre (ej. "Metal") agrega/quita de una vez todos sus géneros hijos.
// La selección ahora es un filtro real (ver currentFilters/pointMatchesFilters),
// no sólo un resaltado visual.

function toggleGenreHighlight(genre) {
  if (selectedGenres.has(genre)) {
    selectedGenres.delete(genre);
  } else {
    selectedGenres.add(genre);
  }

  clearHighlight();
  clearYearHighlight();
  refreshFilterOptions();
  updateGenreLegendActiveState();
}

function toggleGenreGroupSelection(genresInGroup) {
  if (!genresInGroup.length) return;
  const allSelected = genresInGroup.every(g => selectedGenres.has(g));

  if (allSelected) {
    genresInGroup.forEach(g => selectedGenres.delete(g));
  } else {
    genresInGroup.forEach(g => selectedGenres.add(g));
  }

  clearHighlight();
  clearYearHighlight();
  refreshFilterOptions();
  updateGenreLegendActiveState();
}

function clearGenreSelection() {
  if (selectedGenres.size === 0) return;
  selectedGenres.clear();
  refreshFilterOptions();
  updateGenreLegendActiveState();
}

function updateFilterGenreVisuals() {
  const filtersActive = filteredIndices !== null;
  const genresActive = selectedGenres.size > 0;

  if (!filtersActive && !genresActive) {
    pointMeshes.forEach(m => { m.material.opacity = 1; });
    return;
  }

  const dimOpacity = filtersActive ? 0.12 : 0.25;

  pointMeshes.forEach((m, i) => {
    const p = points[i];
    const passesFilter = !filtersActive || filteredIndices.has(i);
    const passesGenre = !genresActive ||
      p.genres.primary.some(g => selectedGenres.has(g)) ||
      p.genres.secondary.some(g => selectedGenres.has(g));

    m.material.opacity = (passesFilter && passesGenre) ? 1 : dimOpacity;
  });
}

function updateFilterArtistConnections() {
  clearConnections();
  if (!activeFilters.artist) return;

  const originPoint = points.find(p => p.artist === activeFilters.artist);
  if (!originPoint) return;

  buildArtistChainConnections(originPoint.idx);
}

function applyFilterMapVisuals() {
  if (filteredIndices !== null) {
    clearHighlight();
    clearYearHighlight();
  }
  updateFilterGenreVisuals();
  updateFilterArtistConnections();
}

function renderGenreLegend() {
  const genres = new Set();
  albums.forEach(a =>
    a.genres.primary.forEach(g => genres.add(g))
  );

  const byGroup = new Map();
  genres.forEach(g => {
    const group = cachedFamilyForGenre(g)?.group ?? "Otros";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(g);
  });
  byGroup.forEach(list => list.sort());

  const orderedGroups = [
    ...GROUP_ORDER.filter(group => byGroup.has(group)),
    ...[...byGroup.keys()].filter(group => !GROUP_ORDER.includes(group))
  ];

  const frag = document.createDocumentFragment();
  genreLegendItemsByGenre = new Map();
  genreLegendGroups = new Map();

  orderedGroups.forEach(group => {
    const isExpanded = expandedGenreGroups.has(group);
    const groupGenres = byGroup.get(group);

    const title = document.createElement("div");
    title.className = "legend-group-title";
    title.style.cssText = "display:flex;align-items:center;gap:6px;";

    const arrow = document.createElement("span");
    arrow.textContent = isExpanded ? "▾" : "▸";
    arrow.style.cssText = "font-size:10px;width:10px;flex-shrink:0;cursor:pointer;";

    const selectArea = document.createElement("span");
    selectArea.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;";

    const swatch = document.createElement("i");
    swatch.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0;background:${colorForGroup(group).getStyle()};`;

    const label = document.createElement("span");
    label.textContent = group;

    selectArea.appendChild(swatch);
    selectArea.appendChild(label);

    title.appendChild(arrow);
    title.appendChild(selectArea);

    const itemsContainer = document.createElement("div");
    itemsContainer.className = "legend-group-items";
    itemsContainer.style.display = isExpanded ? "block" : "none";

    // La flecha sólo expande/colapsa; el swatch+label selecciona/deselecciona
    // todo el grupo (todos sus géneros hijos de una vez).
    arrow.addEventListener("click", e => {
      e.stopPropagation();
      const nowExpanded = !expandedGenreGroups.has(group);
      if (nowExpanded) {
        expandedGenreGroups.add(group);
      } else {
        expandedGenreGroups.delete(group);
      }
      arrow.textContent = nowExpanded ? "▾" : "▸";
      itemsContainer.style.display = nowExpanded ? "block" : "none";
    });

    selectArea.addEventListener("click", e => {
      e.stopPropagation();
      toggleGenreGroupSelection(groupGenres);
    });

    frag.appendChild(title);

    groupGenres.forEach(g => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.dataset.genre = g;
      item.style.cursor = "pointer";

      const dot = document.createElement("i");
      dot.className = "legend-dot";
      dot.style.background = legendDotColor(g).getStyle();

      const itemLabel = document.createElement("span");
      itemLabel.textContent = g;

      item.appendChild(dot);
      item.appendChild(itemLabel);

      item.addEventListener("click", () => toggleGenreHighlight(g));

      genreLegendItemsByGenre.set(g, item);

      itemsContainer.appendChild(item);
    });

    frag.appendChild(itemsContainer);

    genreLegendGroups.set(group, {
      titleEl: title,
      arrowEl: arrow,
      selectAreaEl: selectArea,
      itemsContainerEl: itemsContainer,
      genres: groupGenres
    });
  });

  ui.genreLegend.textContent = "";
  ui.genreLegend.appendChild(frag);

  updateGenreLegendActiveState();
  updateGenreTreeVisibility();
}
 
function updateGenreLegendActiveState() {
  genreLegendItemsByGenre.forEach((el, g) => {
    const active = selectedGenres.has(g);
    el.classList.toggle("active", active);
    el.style.fontWeight = active ? "700" : "400";
    el.style.backgroundColor = active ? "rgba(0,0,0,0.06)" : "transparent";
    el.style.borderRadius = active ? "4px" : "0";
  });

  genreLegendGroups.forEach(data => {
    const selectedCount = data.genres.filter(g => selectedGenres.has(g)).length;
    const allSelected = selectedCount > 0 && selectedCount === data.genres.length;
    const partial = selectedCount > 0 && !allSelected;

    data.selectAreaEl.classList.toggle("active", allSelected);
    data.selectAreaEl.classList.toggle("partial", partial);
    data.selectAreaEl.style.fontWeight = allSelected ? "700" : "400";
    data.selectAreaEl.style.opacity = partial ? "0.7" : "1";
  });
}

function updateGenreTreeVisibility() {
  const pool = getFilteredPoints('genres');
  const visibleGenres = new Set(pool.flatMap(p => p.genres.primary));

  genreLegendGroups.forEach((data, group) => {
    let anyVisible = false;

    data.genres.forEach(g => {
      const el = genreLegendItemsByGenre.get(g);
      if (!el) return;
      const visible = visibleGenres.has(g);
      el.style.display = visible ? "" : "none";
      if (visible) anyVisible = true;
    });

    data.titleEl.style.display = anyVisible ? "" : "none";
    data.itemsContainerEl.style.display = anyVisible && expandedGenreGroups.has(group) ? "block" : "none";
  });
}

let expandedGenreGroups = new Set();

function buildAlbumRow(a) {
  const el = document.createElement("div");
  el.className = "album";
  el.dataset.idx = a.idx;

  const img = document.createElement("img");
  img.className = "cover";
  img.loading = "lazy";
  img.alt = a.album;
  img.src = a.cover ?? "";
  img.addEventListener("error", () => {
    img.classList.add("cover-fallback");
    img.style.background = a.color.getStyle();
  });

  const info = document.createElement("div");

  const title = document.createElement("strong");
  title.textContent = a.album;

  const meta = document.createElement("span");
  meta.textContent = `${a.artist} · ${a.year}`;

  const genresDiv = document.createElement("div");
  genresDiv.className = "genres-primary";
  a.genres.primary.forEach(g => {
    const tag = document.createElement("span");
    tag.className = "genre-tag";
    tag.textContent = g;
    genresDiv.appendChild(tag);
  });

  info.appendChild(title);
  info.appendChild(meta);
  info.appendChild(genresDiv);
  el.appendChild(img);
  el.appendChild(info);
  return el;
}

function pointMatchesFilters(p, filters) {
  if (filters.artist && p.artist !== filters.artist) return false;
  if (filters.yearFrom !== null && p.year < filters.yearFrom) return false;
  if (filters.yearTo !== null && p.year > filters.yearTo) return false;
  if (filters.descriptor && !p.descriptors.includes(filters.descriptor)) return false;
  if (filters.query && !p.searchText.includes(filters.query)) return false;
  if (filters.genres && filters.genres.size > 0) {
    const matchesGenre = p.genres.primary.some(g => filters.genres.has(g)) ||
      p.genres.secondary.some(g => filters.genres.has(g));
    if (!matchesGenre) return false;
  }
  return true;
}

function currentFilters() {
  return { ...activeFilters, genres: selectedGenres };
}

function hasActiveFilters() {
  return activeFilters.artist !== null
    || activeFilters.yearFrom !== null
    || activeFilters.yearTo !== null
    || activeFilters.descriptor !== null
    || Boolean(activeFilters.query && activeFilters.query.trim() !== "")
    || selectedGenres.size > 0;
}

function getFilteredPoints(excludeKey) {
  const filters = currentFilters();
  if (excludeKey === 'year') {
    filters.yearFrom = null;
    filters.yearTo = null;
  } else if (excludeKey === 'genres') {
    filters.genres = new Set();
  } else if (excludeKey) {
    filters[excludeKey] = null;
  }
  return points.filter(p => pointMatchesFilters(p, filters));
}

function populateSelectOptions(selectEl, values, placeholder, currentValue) {
  // Si el valor actual quedó fuera de las opciones disponibles (por cómo
  // se acomodó la cascada), lo mantenemos igual para no perder la
  // selección silenciosamente — el cruce puede dar 0 resultados, y está bien.
  const finalValues = currentValue && !values.includes(String(currentValue))
    ? [String(currentValue), ...values]
    : values;

  selectEl.textContent = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = placeholder;
  selectEl.appendChild(optAll);

  finalValues.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });

  selectEl.value = currentValue !== null ? String(currentValue) : "";
}

function applyFilters() {
  const filters = currentFilters();
  filteredIndices = hasActiveFilters()
    ? new Set(points.filter(p => pointMatchesFilters(p, filters)).map(p => p.idx))
    : null;

  renderList();
  applyFilterMapVisuals();
}

function refreshFilterOptions() {
  const descriptorPool = getFilteredPoints('descriptor');
  const yearPool = getFilteredPoints('year');

  populateSelectOptions(
    ui.filterDescriptor,
    [...new Set(descriptorPool.flatMap(p => p.descriptors))].sort(),
    "Descriptor (todos)",
    activeFilters.descriptor
  );

  const years = [...new Set(yearPool.map(p => p.year))].sort((a, b) => a - b);
  populateSelectOptions(ui.filterYearFrom, years, "Desde", activeFilters.yearFrom);
  populateSelectOptions(ui.filterYearTo, years, "Hasta", activeFilters.yearTo);

  ui.filtersClear.style.display = hasActiveFilters() ? "inline-block" : "none";

  applyFilters();
  updateGenreTreeVisibility();
  renderSelectedChips();
}

ui.filterYearFrom.addEventListener("change", e => {
  activeFilters.yearFrom = e.target.value ? Number(e.target.value) : null;
  refreshFilterOptions();
});
ui.filterYearTo.addEventListener("change", e => {
  activeFilters.yearTo = e.target.value ? Number(e.target.value) : null;
  refreshFilterOptions();
});
ui.filterDescriptor.addEventListener("change", e => {
  activeFilters.descriptor = e.target.value || null;
  refreshFilterOptions();
});
ui.filtersClear.addEventListener("click", () => {
  activeFilters = { artist: null, yearFrom: null, yearTo: null, descriptor: null, query: "" };
  selectedGenres.clear();
  ui.search.value = "";
  refreshFilterOptions();
  updateGenreLegendActiveState();
});

function renderList() {
  const toRender = filteredIndices === null ? points : points.filter(p => filteredIndices.has(p.idx));
  const frag = document.createDocumentFragment();
  toRender.forEach(a => frag.appendChild(buildAlbumRow(a)));
  ui.list.textContent = "";
  ui.list.appendChild(frag);
  document.querySelector("#count").textContent = `(${toRender.length})`;
}

// --- Buscador unificado (artistas + discos) ------------------------------
const MAX_SUGGESTIONS_PER_GROUP = 6;
let currentSuggestions = []; // [{ type: 'artist'|'album', value }]
let activeSuggestionIndex = -1;

function computeArtistMatches(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const seen = new Set();
  const matches = [];
  for (const p of points) {
    if (seen.has(p.artist)) continue;
    if (p.artist.toLowerCase().includes(q)) {
      seen.add(p.artist);
      matches.push(p.artist);
    }
  }

  matches.sort((a,b) => {
    const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
    const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.localeCompare(b);
  });

  return matches.slice(0, MAX_SUGGESTIONS_PER_GROUP);
}

function computeAlbumMatches(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const matches = [];
  for (const p of points) {
    if (p.searchText.includes(q)) matches.push(p);
  }

  matches.sort((a,b) => {
    const aStarts = a.searchText.startsWith(q) ? 0 : 1;
    const bStarts = b.searchText.startsWith(q) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.album.localeCompare(b.album);
  });

  return matches.slice(0, MAX_SUGGESTIONS_PER_GROUP);
}

function buildSectionHeader(text) {
  const el = document.createElement("div");
  el.className = "search-section-header";
  el.textContent = text;
  el.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;padding:6px 10px 2px;";
  return el;
}

function buildArtistSuggestionRow(name, i) {
  const el = document.createElement("div");
  el.className = "search-suggestion";
  el.dataset.i = i;

  const dot = document.createElement("i");
  dot.className = "suggestion-dot";
  dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:2px;background:#bbb;flex-shrink:0;";

  const text = document.createElement("span");
  text.textContent = name;

  el.appendChild(dot);
  el.appendChild(text);

  el.addEventListener("mousedown", e => {
    e.preventDefault();
    selectSuggestion(i);
  });
  el.addEventListener("mouseenter", () => setActiveSuggestion(i));

  return el;
}

function buildSuggestionRow(a, i) {
  const el = document.createElement("div");
  el.className = "search-suggestion";
  el.dataset.i = i;

  const dot = document.createElement("i");
  dot.className = "suggestion-dot";
  dot.style.background = a.color.getStyle();

  const text = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = a.album;
  text.appendChild(title);
  text.appendChild(document.createTextNode(` — ${a.artist} · ${a.year}`));

  el.appendChild(dot);
  el.appendChild(text);

  el.addEventListener("mousedown", e => {
    e.preventDefault();
    selectSuggestion(i);
  });
  el.addEventListener("mouseenter", () => setActiveSuggestion(i));

  return el;
}

function renderTypeahead(query) {
  const artistNames = computeArtistMatches(query);
  const albumPoints = computeAlbumMatches(query);

  currentSuggestions = [
    ...artistNames.map(name => ({ type: "artist", value: name })),
    ...albumPoints.map(p => ({ type: "album", value: p }))
  ];
  activeSuggestionIndex = -1;

  if (!ui.searchResults) return; // sin markup del dropdown en el HTML, no-op

  ui.searchResults.textContent = "";

  if (!currentSuggestions.length) {
    ui.searchResults.classList.remove("open");
    return;
  }

  const frag = document.createDocumentFragment();

  if (artistNames.length) {
    frag.appendChild(buildSectionHeader("Artistas"));
    currentSuggestions.forEach((s, i) => {
      if (s.type === "artist") frag.appendChild(buildArtistSuggestionRow(s.value, i));
    });
  }

  if (albumPoints.length) {
    frag.appendChild(buildSectionHeader("Discos"));
    currentSuggestions.forEach((s, i) => {
      if (s.type === "album") frag.appendChild(buildSuggestionRow(s.value, i));
    });
  }

  ui.searchResults.appendChild(frag);
  ui.searchResults.classList.add("open");
}

function setActiveSuggestion(i) {
  activeSuggestionIndex = i;
  ui.searchResults?.querySelectorAll(".search-suggestion").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.i) === i);
  });
}

function closeTypeahead() {
  currentSuggestions = [];
  activeSuggestionIndex = -1;
  ui.searchResults?.classList.remove("open");
}

function selectSuggestion(i) {
  const entry = currentSuggestions[i];
  if (!entry) return;

  // Elegir una sugerencia limpia el filtro de texto libre: el objetivo acá
  // es navegar/filtrar por ese artista o disco puntual, no seguir acotando
  // por la subcadena que se llegó a tipear.
  activeFilters.query = "";

  if (entry.type === "artist") {
    activeFilters.artist = entry.value;
    ui.search.value = entry.value;
    closeTypeahead();
    refreshFilterOptions();
  } else {
    const a = entry.value;
    ui.search.value = a.album;
    closeTypeahead();
    refreshFilterOptions();
    jumpToAlbum(a);
  }
}

function computeNearestAlbums(idx, k = 3) {
  const origin = points[idx];
  if (!origin) return [];

  return points
    .filter((p, i) => i !== idx && p.artist !== origin.artist)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(entry => entry.p);
}

function nearestOtherArtist(originVec, excludeArtists, minYear, k) {
  return points
    .filter(p => !excludeArtists.has(p.artist) && p.year >= minYear)
    .map(p => ({ p, d: p.umapVec.distanceTo(originVec) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(e => e.p);
}

function pickNearestUnvisited(originVec, visitedArtists, minYear, count) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    const candidate = nearestOtherArtist(originVec, visitedArtists, minYear, 1)[0];
    if (!candidate) break;
    visitedArtists.add(candidate.artist);
    picked.push(candidate);
  }
  return picked;
}

function computeAncestorDescendants(idx) {
  const origin = points[idx];
  const others = points.filter(p => p.idx !== idx && p.artist !== origin.artist);

  const ancestor = others
    .filter(p => p.year < origin.year)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)[0]?.p ?? null;

  const usedDescendantArtists = new Set();
  const descendants = others
    // PARA REPETIR ARTISTAS A NIVEL 2
    .filter(p => p.year > origin.year)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(e => e.p);

    // .filter(p => p.year > origin.year)
    // .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    // .sort((a, b) => a.d - b.d)
    // .reduce((acc, entry) => {
    //   if (acc.length >= 3) return acc;
    //   if (usedDescendantArtists.has(entry.p.artist)) return acc;
    //   usedDescendantArtists.add(entry.p.artist);
    //   acc.push(entry.p);
    //   return acc;
    // }, []);



  // Artistas ya usados en el grafo hasta este punto (para el filtro de nivel 2)
  const usedArtists = new Set([
    origin.artist,
    ancestor?.artist,
    ...descendants.map(d => d.artist)
  ].filter(Boolean));

  const secondLevel = descendants.map(d => {
    const candidates = points.filter(p =>
      p.idx !== d.idx &&
      !usedArtists.has(p.artist) &&
      p.year <= d.year
    );
    const nearest = candidates
      .map(p => ({ p, dist: p.umapVec.distanceTo(d.umapVec) }))
      .sort((a, b) => a.dist - b.dist)[0]?.p ?? null;

    if (nearest) usedArtists.add(nearest.artist); // evita duplicar artista entre las 3 ramas de nivel 2
    return nearest;
  });

  return { ancestor, descendants, secondLevel };
}

function buildAncestorDescendantGraph(idx) {
  const origin = points[idx];
  if (!origin) return;

  const now = performance.now();
  const originColor = origin.color.getHex();
  activeGraphIndices.add(origin.idx);

  const { ancestor, descendants, secondLevel } = computeAncestorDescendants(idx);

  if (ancestor) {
    activeGraphIndices.add(ancestor.idx);
    addConnection(
      pointMeshes[ancestor.idx], pointMeshes[origin.idx],
      originColor, CONNECTION_CONFIG.ancestorOpacity,
      true, now, CONNECTION_CONFIG.lineWidth, true
    );
    fadeNodeIn(pointMeshes[ancestor.idx], CONNECTION_CONFIG.ancestorOpacity, now);
  }

  descendants.forEach((d, i) => {
    activeGraphIndices.add(d.idx);
    const appearAt = now + i * CONNECTION_CONFIG.siblingStagger;

    addConnection(
      pointMeshes[origin.idx], pointMeshes[d.idx],
      originColor, CONNECTION_CONFIG.descendantOpacity,
      true, appearAt, CONNECTION_CONFIG.lineWidth, true
    );
    fadeNodeIn(pointMeshes[d.idx], CONNECTION_CONFIG.descendantOpacity, appearAt);

    const level2 = secondLevel[i];
    if (level2) {
      activeGraphIndices.add(level2.idx);
      const level2AppearAt = appearAt + CONNECTION_CONFIG.stageDelay;

      addConnection(
        pointMeshes[d.idx], pointMeshes[level2.idx],
        originColor, CONNECTION_CONFIG.secondLevelOpacity,
        true, level2AppearAt, CONNECTION_CONFIG.lineWidth, true
      );
      fadeNodeIn(pointMeshes[level2.idx], CONNECTION_CONFIG.secondLevelOpacity, level2AppearAt);
    }
  });
}

function createConnectionLine(colorHex, dashed, lineWidth) {
  const geometry = new LineGeometry();
  geometry.setPositions([0, 0, 0, 0, 0, 0]);

  const material = new LineMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0,
    linewidth: lineWidth, // px de pantalla (worldUnits: false por defecto)
    depthWrite: false,
    dashed,
    dashSize: dashed ? CONNECTION_CONFIG.dashSize : 0,
    gapSize: dashed ? CONNECTION_CONFIG.gapSize : 0
  });
  material.resolution.set(innerWidth, innerHeight);

  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.frustumCulled = false;
  return line;
}

function createArrowHead(colorHex) {
  const shape = new THREE.Shape();
  const halfWidth = 0.12;
  const height = 0.55;
  shape.moveTo(0, height / 2);            // punta
  shape.lineTo(-halfWidth, -height / 2);  // base izquierda
  shape.lineTo(halfWidth, -height / 2);   // base derecha
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide // plano: sin esto no se ve desde el lado "de atrás"
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function addConnection(fromMesh, toMesh, colorHex, targetOpacity, dashed, appearAt, lineWidth, withArrow = false) {
  const line = createConnectionLine(colorHex, dashed, lineWidth);
  line.userData.targetOpacity = targetOpacity;
  line.userData.appearAt = appearAt;
  line.userData.dashed = dashed;
  connectionGroup.add(line);

  let arrow = null;
  if (withArrow) {
    arrow = createArrowHead(colorHex);
    arrow.userData.targetOpacity = targetOpacity;
    arrow.userData.appearAt = appearAt;
    connectionGroup.add(arrow);
  }

  connectionLines.push({ line, fromMesh, toMesh, arrow });
}

function fadeNodeIn(mesh, targetOpacity, appearAt) {
  connectionNodeFades.push({ mesh, targetOpacity, appearAt });
}

function clearConnections() {
  connectionLines.forEach(c => {
    c.line.geometry.dispose();
    c.line.material.dispose();
    connectionGroup.remove(c.line);
    if (c.arrow) {
      c.arrow.geometry.dispose();
      c.arrow.material.dispose();
      connectionGroup.remove(c.arrow);
    }
  });
  connectionLines = [];
  connectionNodeFades = [];
  activeGraphIndices = new Set();
  hoverPreviewIndex = null;
}

function buildArtistChainConnections(originIdx) {
  const origin = points[originIdx];
  if (!origin) return;

  const now = performance.now();
  const originColor = origin.color.getHex();

  const sameArtistChain = points
    .filter(p => p.artist === origin.artist)
    .sort((a, b) => a.year - b.year);

  sameArtistChain.forEach(p => activeGraphIndices.add(p.idx));

  for (let i = 0; i < sameArtistChain.length - 1; i++) {
    addConnection(
      pointMeshes[sameArtistChain[i].idx],
      pointMeshes[sameArtistChain[i + 1].idx],
      originColor,
      CONNECTION_CONFIG.sameArtistLineOpacity,
      false,
      now,
      CONNECTION_CONFIG.lineWidth
    );
  }
}

function buildDiscoveryGraph(originIdx) {
  // clearConnections(); 

  const origin = points[originIdx];
  if (!origin) return;

  const now = performance.now();
  const visitedArtists = new Set([origin.artist]);
  activeGraphIndices.add(origin.idx);

  buildArtistChainConnections(originIdx);

  const level1Delay = now + CONNECTION_CONFIG.stageDelay;
  const level1 = pickNearestUnvisited(
    origin.umapVec, visitedArtists, origin.year, CONNECTION_CONFIG.level1Count
  );

  level1.forEach((node, i) => {
    const appearAt = level1Delay + i * CONNECTION_CONFIG.siblingStagger;
    const nodeMesh = pointMeshes[node.idx];
    activeGraphIndices.add(node.idx);

    addConnection(
      pointMeshes[origin.idx], nodeMesh, origin.color.getHex(), CONNECTION_CONFIG.level1LineOpacity, true, appearAt,
      CONNECTION_CONFIG.lineWidth
    );
    fadeNodeIn(nodeMesh, CONNECTION_CONFIG.level1NodeOpacity, appearAt);

    const level2Delay = appearAt + CONNECTION_CONFIG.stageDelay;
    const level2 = pickNearestUnvisited(
      node.umapVec, visitedArtists, node.year, CONNECTION_CONFIG.level2Count
    );

    level2.forEach((child, j) => {
      const childAppearAt = level2Delay + j * CONNECTION_CONFIG.siblingStagger;
      const childMesh = pointMeshes[child.idx];
      activeGraphIndices.add(child.idx);

      addConnection(
        nodeMesh, childMesh, origin.color.getHex(), CONNECTION_CONFIG.level2LineOpacity, true, childAppearAt,
        CONNECTION_CONFIG.lineWidth
      );
      fadeNodeIn(childMesh, CONNECTION_CONFIG.level2NodeOpacity, childAppearAt);
    });
  });
}

function ensureSelectedChipsContainer() {
  if (ui.selectedChips) return ui.selectedChips;

  const container = document.createElement("div");
  container.id = "selectedChips";
  container.style.cssText = "display:none;flex-wrap:wrap;gap:6px;margin-top:8px;";
  ui.search.insertAdjacentElement("afterend", container);
  ui.selectedChips = container;
  return container;
}

function renderSelectedChips() {
  const container = ensureSelectedChipsContainer();
  container.textContent = "";

  renderFilterChipsInto(container);

  [...selectedIndices].forEach(idx => {
    const point = points[idx];
    if (!point) return;

    const chip = document.createElement("span");
    chip.className = "chip chip-album";
    chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#f0f0f0;font-size:12px;";

    const dot = document.createElement("i");
    dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:50%;background:${point.color.getStyle()};`;

    const label = document.createElement("span");
    label.textContent = point.album;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", `Quitar ${point.album}`);
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;line-height:1;color:#888;padding:0;";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      selectedIndices.delete(idx);
      applySelection();
    });

    chip.appendChild(dot);
    chip.appendChild(label);
    chip.appendChild(closeBtn);
    container.appendChild(chip);
  });

  container.style.display = (selectedIndices.size || hasActiveFilters()) ? "flex" : "none";
}

function renderFilterChipsInto(container) {
  const defs = [
    { active: () => activeFilters.artist !== null,
      label: () => `Artista: ${activeFilters.artist}`,
      clear: () => {
        if (ui.search.value === activeFilters.artist) ui.search.value = "";
        activeFilters.artist = null;
      } },
    { active: () => activeFilters.yearFrom !== null || activeFilters.yearTo !== null,
      label: () => `Año: ${activeFilters.yearFrom ?? "…"}–${activeFilters.yearTo ?? "…"}`,
      clear: () => { activeFilters.yearFrom = null; activeFilters.yearTo = null; } },
    { active: () => activeFilters.descriptor !== null,
      label: () => `Descriptor: ${activeFilters.descriptor}`,
      clear: () => { activeFilters.descriptor = null; } },
    { active: () => Boolean(activeFilters.query && activeFilters.query.trim() !== ""),
      label: () => `Búsqueda: "${activeFilters.query}"`,
      clear: () => { activeFilters.query = ""; ui.search.value = ""; } },
    { active: () => selectedGenres.size > 0,
      label: () => `Géneros: ${selectedGenres.size}`,
      clear: () => { selectedGenres.clear(); } }
  ];

  defs.forEach(def => {
    if (!def.active()) return;

    const chip = document.createElement("span");
    chip.className = "chip chip-filter";
    chip.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#e8edff;font-size:12px;";

    const label = document.createElement("span");
    label.textContent = def.label();

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Quitar filtro");
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:14px;line-height:1;color:#556;padding:0;";
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      def.clear();
      refreshFilterOptions();
      updateGenreLegendActiveState();
    });

    chip.appendChild(label);
    chip.appendChild(closeBtn);
    container.appendChild(chip);
  });
}

function applySelection() {
  clearYearHighlight();
  clearConnections();
  unpinTooltip();
  clearMultiSelectPanels();

  updateSelectionVisuals();
  renderSelectedChips();

  if (selectedIndices.size === 0) {
    clearSelectionOutlines();
    return;
  }

  showSelectionOutlines();

  if (selectedIndices.size === 1) {
    const idx = [...selectedIndices][0];
    buildAncestorDescendantGraph(idx); // <-- antes: buildDiscoveryGraph(idx)
    pinTooltip(idx);
  } else {
    buildMultiSelectionChains();
    updateMultiSelectPanels();
  }
}

function buildMultiSelectionChains() {
  selectedIndices.forEach(idx => buildAncestorDescendantGraph(idx));
}

function clearHighlight() {
  pointMeshes.forEach(m => { m.material.opacity = 1; });
  selectedIndices.clear();
  clearConnections();
  clearSelectionOutlines();
  clearMultiSelectPanels();
  unpinTooltip();
  renderSelectedChips();
}

function updateConnections() {
  if (!connectionLines.length && !connectionNodeFades.length) return;

  const now = performance.now();

  connectionLines.forEach(c => {
    const from = c.fromMesh.position;
    const to = c.toMesh.position;
    c.line.geometry.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
    if (c.line.userData.dashed) c.line.computeLineDistances();

    const target = now >= c.line.userData.appearAt ? c.line.userData.targetOpacity : 0;
    c.line.material.opacity += (target - c.line.material.opacity) * CONNECTION_CONFIG.fadeSpeed;

    if (c.arrow) {
      connectionArrowDir.subVectors(to, from);
      if (connectionArrowDir.lengthSq() > 1e-6) {
        connectionArrowDir.normalize();
        c.arrow.position.lerpVectors(from, to, ARROW_POSITION_T);
        c.arrow.quaternion.setFromUnitVectors(connectionArrowUp, connectionArrowDir);
      }
      const arrowTarget = now >= c.arrow.userData.appearAt ? c.arrow.userData.targetOpacity : 0;
      c.arrow.material.opacity += (arrowTarget - c.arrow.material.opacity) * CONNECTION_CONFIG.fadeSpeed;
    }
  });

  connectionNodeFades.forEach(n => {
    if (now < n.appearAt) return;
    n.mesh.material.opacity += (n.targetOpacity - n.mesh.material.opacity) * CONNECTION_CONFIG.fadeSpeed;
  });
}

function focusCameraOnPoint(mesh) {
  const targetPos = mesh.position.clone();
  const currentDistance = camera.position.distanceTo(controls.target);
  const desiredDistance = THREE.MathUtils.clamp(
    currentDistance * FOCUS_ZOOM_FACTOR,
    controls.minDistance + 2,
    controls.maxDistance
  );

  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); // fallback si estaban superpuestos
  dir.normalize();

  cameraFromPos.copy(camera.position);
  cameraToPos.copy(targetPos).addScaledVector(dir, desiredDistance);
  cameraFromTarget.copy(controls.target);
  cameraToTarget.copy(targetPos);

  cameraAnimStart = performance.now();
  cameraAnimating = true;
}

function tickCameraFocus() {
  if (!cameraAnimating) return;

  const t = Math.min((performance.now() - cameraAnimStart) / CAMERA_FOCUS_DURATION, 1);
  const eased = easeInOutCubic(t);

  camera.position.lerpVectors(cameraFromPos, cameraToPos, eased);
  controls.target.lerpVectors(cameraFromTarget, cameraToTarget, eased);

  if (t >= 1) cameraAnimating = false;
}

function ensureOutlineMeshes() {
  if (outlineRing) return;

  outlineRing = new THREE.Mesh(
    new THREE.RingGeometry(POINT_RADIUS + 0.1, POINT_RADIUS + 0.2, OUTLINE_SEGMENTS),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false // decorativo: no debe tapar objetos detrás suyo
    })
  );
  outlineRing.renderOrder = 10; // se dibuja después de los puntos, ya está resuelto por geometría igual
  outlineRing.visible = false;
  root.add(outlineRing);
}

function disposeOutlineMeshes() {
  if (!outlineRing) return;
  outlineRing.geometry.dispose();
  outlineRing.material.dispose();
  root.remove(outlineRing);
  outlineRing = null;
}

function showSelectionOutline(mesh, color) {
  ensureOutlineMeshes();
  outlineTarget = mesh;
  outlineRing.material.color.copy(color);
  outlineRing.visible = true;
  updateSelectionOutline();
}

function clearSelectionOutline() {
  outlineTarget = null;
  if (outlineRing) outlineRing.visible = false;
}

function updateSelectionOutline() {
  if (!outlineTarget || !outlineRing) return;

  outlineRing.position.copy(outlineTarget.position);

  outlineRing.quaternion.copy(camera.quaternion);

  const distance = camera.position.distanceTo(outlineTarget.position);
  const vFov = camera.fov * Math.PI / 180;
  const screenHeight = renderer.domElement.clientHeight || innerHeight;
  const worldPerPixel = (2 * Math.tan(vFov / 2) * distance) / screenHeight;

  const offsetWorld = worldPerPixel * OUTLINE_OFFSET_PX;
  const thicknessWorld = worldPerPixel * OUTLINE_THICKNESS_PX;

  const innerRadius = POINT_RADIUS + offsetWorld;
  const outerRadius = innerRadius + thicknessWorld;

  outlineRing.geometry.dispose();
  outlineRing.geometry = new THREE.RingGeometry(innerRadius, outerRadius, OUTLINE_SEGMENTS);
}

function fitCamera() {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.set(center.x + size.x*.2, center.y + size.y*.35, center.z + Math.max(size.length()*1.25, 80));
  controls.update();
}

function hideTooltip() {
  ui.tooltip.style.display = "none";
}

function buildNearestRow(p, opts = {}) {
  const { showYear = false } = opts;
  const row = document.createElement("div");
  row.className = "nearest-row";
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;";

  const dot = document.createElement("i");
  dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p.color.getStyle()};`;

  const text = document.createElement("span");
  text.style.fontSize = "12px";
  text.textContent = showYear
    ? `${p.album} — ${p.artist} · ${p.year}`
    : `${p.album} — ${p.artist}`;

  row.appendChild(dot);
  row.appendChild(text);
  row.addEventListener("mouseenter", () => { row.style.opacity = "0.7"; });
  row.addEventListener("mouseleave", () => { row.style.opacity = "1"; });
  row.addEventListener("click", e => {
    e.stopPropagation();
    selectAlbum(p.idx);
  });
  return row;
}

const screenProjectionVector = new THREE.Vector3();
function projectToScreen(vec3) {
  screenProjectionVector.copy(vec3).project(camera);
  return {
    x: (screenProjectionVector.x * 0.5 + 0.5) * innerWidth,
    y: (-screenProjectionVector.y * 0.5 + 0.5) * innerHeight
  };
}

function pinTooltip(idx) {
  pinnedIndex = idx;
  const mesh = pointMeshes[idx];
  const { x, y } = mesh
    ? projectToScreen(mesh.position)
    : { x: innerWidth / 2, y: innerHeight / 2 };
  renderDetailPanel(idx, x, y);
}

function unpinTooltip() {
  pinnedIndex = null;
  hideTooltip();
}

function updatePinnedTooltipPosition() {
  // No pisar la posición si hay un preview de hover activo (ese sigue al
  // mouse, no al nodo).
  if (pinnedIndex === null || hoverPreviewIndex !== null) return;

  const mesh = pointMeshes[pinnedIndex];
  if (!mesh) return;

  const { x, y } = projectToScreen(mesh.position);
  ui.tooltip.style.left = `${Math.min(x + 16, innerWidth - 320)}px`;
  ui.tooltip.style.top = `${Math.min(y + 16, innerHeight - 300)}px`;
}

function computeYearGenreStats(year) {
  const albumsThatYear = points.filter(p => p.year === year);
  const total = albumsThatYear.length;
 
  const groupCounts = new Map();
 
  albumsThatYear.forEach(a => {
    const groupsForAlbum = new Set(
      a.genres.primary.map(g => cachedFamilyForGenre(g)?.group ?? "Otros")
    );
    groupsForAlbum.forEach(group => {
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    });
  });
 
  const groups = [...groupCounts.entries()]
    .map(([group, count]) => ({ genre: group, count, pct: total ? (count / total * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
 
  return {
    year,
    total,
    albums: albumsThatYear,
    groups
  };
}

function buildGenreStatRow(entry, color) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;";
 
  const label = document.createElement("span");
  label.style.cssText = "flex:0 0 auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  label.textContent = entry.genre;
 
  const barWrap = document.createElement("div");
  barWrap.style.cssText = "flex:1 1 auto;background:#eee;border-radius:3px;height:8px;overflow:hidden;";
 
  const bar = document.createElement("div");
  bar.style.cssText = `width:${entry.pct.toFixed(0)}%;height:100%;background:${color.getStyle()};`;
  barWrap.appendChild(bar);
 
  const pctLabel = document.createElement("span");
  pctLabel.style.cssText = "flex:0 0 auto;width:34px;text-align:right;font-size:11px;color:#999;";
  pctLabel.textContent = `${entry.pct.toFixed(0)}%`;
 
  row.appendChild(label);
  row.appendChild(barWrap);
  row.appendChild(pctLabel);
  return row;
}

function renderYearStatsPanel(year, x, y) {
  const stats = computeYearGenreStats(year);
 
  ui.tooltip.textContent = "";
  ui.tooltip.style.pointerEvents = "auto";
 
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.style.cssText = "position:absolute;top:6px;right:8px;border:none;background:none;font-size:16px;line-height:1;cursor:pointer;color:#888;";
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    clearYearHighlight();
  });
 
  const title = document.createElement("strong");
  title.textContent = `${year}`;
 
  const meta = document.createElement("div");
  meta.className = "artist";
  meta.textContent = `${stats.total} álbum${stats.total === 1 ? "" : "es"}`;
 
  ui.tooltip.appendChild(closeBtn);
  ui.tooltip.appendChild(title);
  ui.tooltip.appendChild(meta);
 
  const eventText = eventsByYear.get(year);
  if (eventText) {
    const eventLine = document.createElement("div");
    eventLine.style.cssText = "margin-top:6px;font-size:12px;font-style:italic;color:#888;";
    eventLine.textContent = eventText;
    ui.tooltip.appendChild(eventLine);
  }
 
  if (stats.groups.length) {
    const groupsTitle = document.createElement("div");
    groupsTitle.textContent = "Géneros principales";
    groupsTitle.style.cssText = "margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;";
    ui.tooltip.appendChild(groupsTitle);
    stats.groups.forEach(entry => ui.tooltip.appendChild(buildGenreStatRow(entry, colorForGroup(entry.genre))));
  }
 
  if (stats.albums.length) {
    const albumsTitle = document.createElement("div");
    albumsTitle.textContent = "Álbumes de este año";
    albumsTitle.style.cssText = "margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;";
    ui.tooltip.appendChild(albumsTitle);
    stats.albums.forEach(p => ui.tooltip.appendChild(buildNearestRow(p)));
  }
 
  ui.tooltip.style.right = "auto";
  ui.tooltip.style.left = `${Math.min(x+16, innerWidth-320)}px`;
  ui.tooltip.style.top = `${Math.min(y+16, innerHeight-360)}px`;
  ui.tooltip.style.display = "block";
}
 

function showYearStatsPanel(year) {
  const ring = orbitRings.find(r => r.userData.year === year);
  const { x, y } = ring
    ? projectToScreen(ring.position)
    : { x: innerWidth / 2, y: innerHeight / 2 };
  renderYearStatsPanel(year, x, y);
}

function toggleYearHighlight(year) {
  if (selectedYear === year) {
    clearYearHighlight();
  } else {
    setYearHighlight(year);
  }
}

function setYearHighlight(year) {
  clearHighlight();
  clearGenreSelection();

  selectedYear = year;

  pointMeshes.forEach((m, i) => {
    m.material.opacity = points[i].year === year ? 1 : 0.15;
  });

  orbitRings.forEach(r => {
    const isSelected = r.userData.year === year;
    r.userData.targetOpacity = isSelected ? 0.9 : 0.08;
    r.material.color.setHex(isSelected ? ORBIT_RING_SELECTED_COLOR : ORBIT_RING_DEFAULT_COLOR);
  });

  yearSprites.forEach(s => {
    const isSelected = s.userData.year === year;
    s.userData.targetOpacity = isSelected ? 1 : EVENT_LABEL_CONFIG.dimmedOpacity;
    s.material.color.setHex(isSelected ? YEAR_LABEL_SELECTED_TINT : YEAR_LABEL_DEFAULT_TINT);
  });

  showYearStatsPanel(year);
}

function clearYearHighlight() {
  if (selectedYear === null) return;
  selectedYear = null;

  pointMeshes.forEach(m => { m.material.opacity = 1; });

  orbitRings.forEach(r => {
    r.userData.targetOpacity = timeMode ? 0.4 : 0;
    r.material.color.setHex(ORBIT_RING_DEFAULT_COLOR);
  });

  yearSprites.forEach(s => {
    s.userData.targetOpacity = timeMode ? 1 : 0;
    s.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
  });

  hideTooltip();
}

function pointerMove(e) {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  const hit = raycaster.intersectObjects(pointMeshes)[0];
  const yearHit = timeMode ? raycaster.intersectObjects([...orbitRings, ...yearSprites])[0] : null;

  pointMeshes.forEach(m => m.material.emissiveIntensity = .35);

  if (hit) {
    hit.object.material.emissiveIntensity = 1.2;
    renderer.domElement.style.cursor = "pointer";
  } else if (yearHit) {
    renderer.domElement.style.cursor = "pointer";
  } else {
    renderer.domElement.style.cursor = "default";
  }

  if (pinnedIndex !== null) {
    const hitIdx = hit?.object.userData.index;
    const compareMode = e.ctrlKey || e.metaKey;
    const showPreview = hit && hitIdx !== pinnedIndex && (compareMode || activeGraphIndices.has(hitIdx));

    if (showPreview) {
      hoverPreviewIndex = hitIdx;
      showTooltipForPoint(hitIdx, e.clientX, e.clientY);
    } else if (hoverPreviewIndex !== null) {
      hoverPreviewIndex = null;
      pinTooltip(pinnedIndex); // restaura el panel fijado
    }
    return;
  }

  if (selectedYear !== null) return;

  const hitIdx = hit?.object.userData.index;
  const compareMode = (e.ctrlKey || e.metaKey) && selectedIndices.size > 0;

  if (hit && (compareMode || !selectedIndices.has(hitIdx))) {
    showTooltipForPoint(hitIdx, e.clientX, e.clientY);
  } else {
    hideTooltip();
  }
}

function scrollListToAlbum(a) {
  const row = ui.list.querySelector(`[data-idx="${a.idx}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("row-highlight");
  setTimeout(() => row.classList.remove("row-highlight"), 1200);
}

const SEARCH_DEBOUNCE_MS = 150;
let searchDebounceTimer = null;
ui.search.addEventListener("input", e => {
  const value = e.target.value;

  // Reescribir el texto invalida cualquier artista previamente elegido: el
  // filtro de artista sólo se fija de nuevo al elegir una sugerencia.
  if (activeFilters.artist && value !== activeFilters.artist) {
    activeFilters.artist = null;
  }
  activeFilters.query = value.toLowerCase().trim();

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderTypeahead(value);
    refreshFilterOptions();
  }, SEARCH_DEBOUNCE_MS);
});

ui.search.addEventListener("keydown", e => {
  if (!currentSuggestions.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveSuggestion((activeSuggestionIndex + 1) % currentSuggestions.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveSuggestion(
      (activeSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length
    );
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectSuggestion(activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0);
  } else if (e.key === "Escape") {
    closeTypeahead();
  }
});

ui.search.addEventListener("blur", () => {
  setTimeout(closeTypeahead, 100);
});

ui.timeToggle?.addEventListener("change", e => {
  setTimeMode(e.target.checked);
  if (!e.target.checked) clearYearHighlight(); // salir de modo temporal limpia la selección de año
});
ui.genreLabelToggle?.addEventListener("change", e => setGenreLabelsVisible(e.target.checked));

window.addEventListener("pointermove",pointerMove);
window.addEventListener("click",pointerClick);
window.addEventListener("resize",()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  connectionLines.forEach(c => c.line.material.resolution.set(innerWidth, innerHeight));
});

function buildEventsByYear(events) {
  const map = new Map();
  events.forEach(e => {
    const existing = map.get(e.year);
    map.set(e.year, existing ? `${existing} · ${e.event}` : e.event);
  });
  return map;
}

Promise.all([
  fetch("./data/albums.json").then(r => r.json()),
  fetch("./data/eventos.json")
    .then(r => r.json())
    .catch(err => {
      console.warn("No se pudo cargar data/eventos.json", err);
      return [];
    })
])
  .then(([albumsData, eventsData]) => {
    albums = albumsData;
    eventsByYear = buildEventsByYear(eventsData);
    return calculateModel();
  })
  .catch(err => {
    console.error(err);
    ui.status.textContent = "No se pudo cargar data/albums.json";
  });

animate();