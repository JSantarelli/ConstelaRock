import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { UMAP } from "umap-js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xFFFFFF);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 120);

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
let genreLabelSprites = []; // [{ sprite, genre, position, count, screenX, screenY, behindCamera, overlapHidden }]
let selected = null;

const ui = {
  list: document.querySelector("#albumList"),
  search: document.querySelector("#search"),
  searchResults: document.querySelector("#searchResults"),
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#tooltip"),
  genreLegend: document.querySelector('#genreLegend'),
  timeToggle: document.querySelector('#timeToggle'),
  genreLabelToggle: document.querySelector('#genreLabelToggle')
};

const WEIGHTS = {
  primaryBase: 1.0,
  secondaryBase: .55,
  secondaryDecay: .78
};

const MODEL_CONFIG = {
  descriptorWeight: 0.75,
  nNeighbors: 4,
  minDist: 0.5
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
  minAlbumsForLabel: 2,   // ignora géneros con muy pocos álbumes (ruido visual)
  radiusPadding: 16,      // qué tanto se empuja la etiqueta más allá de su cluster
  visibleOpacity: 0.85,
  fadeSpeed: 0.15,
  overlapScreenDist: 46   // px mínimos entre dos etiquetas en pantalla antes de considerarlas solapadas
};

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
  sameArtistLineWidth: 3.2, // px (líneas gruesas vía Line2/LineMaterial)
  level1LineWidth: 2.4,
  level2LineWidth: 1.8,
  dashSize: 0.35,  // trazo corto...
  gapSize: 0.18    // ...y gap corto = punteado fino y denso
};

let timeMode = false;
let animating = false;
let animStart = 0;
let animFrom = [];
let animTo = [];
let timeCentroid = new THREE.Vector3(); // mismo centro usado por el plegado radial, reutilizado por las órbitas

let genreLabelsVisible = true;

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

  {
    match: /heavy metal/i,
    group: "Metal",
    hueRange: [0, 0],
    satRange: [0, 8],
    lightRange: [18, 32]
  },

  {
    match: /thrash metal/i,
    group: "Metal",
    hueRange: [0, 0],
    satRange: [0, 8],
    lightRange: [30, 44]
  },

  {
    match: /hard rock/i,
    group: "Rock",
    hueRange: [210, 220]
  },

  {
    match: /alternative rock/i,
    group: "Rock",
    hueRange: [220, 232]
  },

  {
    match: /blues rock/i,
    group: "Rock",
    hueRange: [232, 242]
  },

  {
    match: /progressive rock/i,
    group: "Rock",
    hueRange: [242, 252]
  },

  {
    match: /art rock/i,
    group: "Rock",
    hueRange: [252, 262]
  },

  {
    match: /rock opera/i,
    group: "Rock",
    hueRange: [262, 272]
  },

  {
    match: /\bbig music\b/i,
    group: "Rock",
    hueRange: [272, 282]
  },

  {
    match: /punk rock/i,
    group: "Punk",
    hueRange: [0, 10]
  },

  {
    match: /melodic hardcore/i,
    group: "Punk",
    hueRange: [10, 20]
  },

  {
    match: /post-punk revival/i,
    group: "Punk",
    hueRange: [20, 30]
  },

  {
    match: /dance-punk revival/i,
    group: "Punk",
    hueRange: [30, 40]
  },

  {
    match: /synthpop/i,
    group: "Pop",
    hueRange: [265, 275]
  },

  {
    match: /art pop/i,
    group: "Pop",
    hueRange: [275, 285]
  },

  {
    match: /chamber pop/i,
    group: "Pop",
    hueRange: [285, 295]
  },

  {
    match: /sophisti-pop/i,
    group: "Pop",
    hueRange: [295, 305]
  },

  {
    match: /power pop/i,
    group: "Pop",
    hueRange: [305, 315]
  },

  {
    match: /indie pop/i,
    group: "Pop",
    hueRange: [315, 325]
  },

  {
    match: /twee pop/i,
    group: "Pop",
    hueRange: [325, 335]
  },

  {
    match: /latin pop/i,
    group: "Pop",
    hueRange: [335, 345]
  },

  {
    match: /pop rock/i,
    group: "Pop",
    hueRange: [345, 355]
  },

  {
    match: /new wave/i,
    group: "New Wave",
    hueRange: [300, 320]
  },

  {
    match: /post-punk/i,
    group: "Post-Punk",
    hueRange: [350, 360]
  },

  {
    match: /reggae/i,
    group: "Reggae",
    hueRange: [100, 112]
  },

  {
    match: /lovers rock/i,
    group: "Reggae",
    hueRange: [112, 124]
  },

  {
    match: /third wave ska/i,
    group: "Ska",
    hueRange: [80, 90]
  },

  {
    match: /\bska\b/i,
    group: "Ska",
    hueRange: [90, 102]
  },

  {
    match: /psychedelic rock/i,
    group: "Psicodelia",
    hueRange: [145, 155]
  },

  {
    match: /neo-psychedelia/i,
    group: "Psicodelia",
    hueRange: [155, 165]
  },

  {
    match: /shoegaze/i,
    group: "Psicodelia",
    hueRange: [165, 175]
  },

  {
    match: /downtempo/i,
    group: "Electrónica / Dance",
    hueRange: [175, 185]
  },

  {
    match: /alternative dance/i,
    group: "Electrónica / Dance",
    hueRange: [185, 195]
  },

  {
    match: /new rave/i,
    group: "Electrónica / Dance",
    hueRange: [195, 205]
  },

  {
    match: /rap rock/i,
    group: "Hip Hop / Rap",
    hueRange: [200, 210]
  },

  {
    match: /pop rap/i,
    group: "Hip Hop / Rap",
    hueRange: [210, 220]
  },

  {
    match: /folk rock/i,
    group: "Folk / Canción",
    hueRange: [35, 45]
  },

  {
    match: /singer-songwriter/i,
    group: "Folk / Canción",
    hueRange: [45, 55]
  },

  {
    match: /beat/i,
    group: "Folk / Canción",
    hueRange: [55, 65]
  },

  {
    match: /latin alternative/i,
    group: "Latin / Hispanoamericano",
    hueRange: [65, 75]
  },

  {
    match: /jazz-rock/i,
    group: "Jazz",
    hueRange: [70, 80]
  },

  {
    match: /christian rock/i,
    group: "Christian",
    hueRange: [50, 60]
  }

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
  "Electrónica / Dance",
  "Hip Hop / Rap",
  "Folk / Canción",
  "Latin / Hispanoamericano",
  "Jazz",
  "Christian",
  "Otros"
];

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
    random: Math.random
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
      r.material.opacity = 0.4;
      r.userData.targetOpacity = 0.4;
    });
  }

  renderList();
  renderGenreLegend();
  fitCamera();
  ui.status.textContent =
    `${albums.length} álbumes · ${vocab.genres.length} géneros · ${vocab.descriptors.length} descriptores · UMAP 3D`;
}

function clearScene() {
  pointMeshes.forEach(m => {
    m.geometry.dispose();
    m.material.dispose();
    root.remove(m);
  });
  pointMeshes = [];

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
  clearSelectionOutline();
  disposeOutlineMeshes();

  selected = null;
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
    sprite.userData.targetOpacity = 0;
    root.add(sprite);
    yearSprites.push(sprite);
  });
}

function makeYearSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = "regular 36px sans-serif";
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

function createYearOrbits() {
  const byYear = new Map();
  points.forEach(p => {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year).push(p);
  });

  byYear.forEach((group) => {
    const radii = group.map(p =>
      Math.hypot(p.timeVec.x - timeCentroid.x, p.timeVec.z - timeCentroid.z)
    );

    const radius = Math.max(average(radii), 6);

    const geo = new THREE.TorusGeometry(radius, 0.18, 8, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc4c4c4,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2; // acostar el anillo en el plano X/Z
    ring.position.set(timeCentroid.x, group[0].timeVec.y, timeCentroid.z);
    ring.userData.targetOpacity = 0;
    root.add(ring);
    orbitRings.push(ring);
  });
}

function makeGenreLabelSprite(genre) {
  const label = genre.toUpperCase();

  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = "400 16px sans-serif";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1px";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.strokeText(label, canvas.width/2, canvas.height/2);

  ctx.fillStyle = "#a2a1a1";
  ctx.fillText(label, canvas.width/2, canvas.height/2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true // el z-buffer oculta la etiqueta cuando queda detrás del modelo
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

  const acc = new Map(); // genre -> { sum: Vector3, count }
  points.forEach(p => {
    const genres = new Set([...p.genres.primary, ...p.genres.secondary]);
    genres.forEach(g => {
      if (!acc.has(g)) acc.set(g, { sum: new THREE.Vector3(), count: 0 });
      const entry = acc.get(g);
      entry.sum.add(p.umapVec);
      entry.count += 1;
    });
  });

  const data = [];
  acc.forEach((entry, genre) => {
    if (entry.count < GENRE_LABEL_CONFIG.minAlbumsForLabel) return;

    const centroid = entry.sum.clone().divideScalar(entry.count);
    const dir = centroid.clone().sub(globalCentroid);

    if (dir.lengthSq() < 1e-6) {
      const h = (hueForGenre(genre) / 360) * Math.PI * 2;
      dir.set(Math.cos(h), 0.2, Math.sin(h));
    }
    dir.normalize();

    const position = centroid.clone().addScaledVector(dir, GENRE_LABEL_CONFIG.radiusPadding);
    data.push({ genre, position, count: entry.count });
  });

  return data;
}

function createGenreLabels() {
  computeGenreLabelData().forEach(d => {
    const sprite = makeGenreLabelSprite(d.genre);
    sprite.position.copy(d.position);
    sprite.material.opacity = 0; // entra con fade, igual que yearSprites/orbitRings
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
  orbitRings.forEach(r => { r.userData.targetOpacity = timeMode ? 0.4 : 0; });

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
  const artist = mesh.userData.album?.artist ?? null;
  selected = artist;

  pointMeshes.forEach(m => {
    const sameArtist = artist && m.userData.album?.artist === artist;
    m.material.opacity = (m === mesh || sameArtist) ? 1 : 0.35;
  });

  const idx = mesh.userData.index;
  if (idx !== undefined) buildDiscoveryGraph(idx);
}

function clearHighlight() {
  pointMeshes.forEach(m => { m.material.opacity = 1; });
  selected = null;
  clearConnections();
  clearSelectionOutline();
  unpinTooltip();
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

  orderedGroups.forEach(group => {
    const title = document.createElement("div");
    title.className = "legend-group-title";
    title.textContent = group;
    frag.appendChild(title);

    byGroup.get(group).forEach(g => {
      const item = document.createElement("div");
      item.className = "legend-item";

      const dot = document.createElement("i");
      dot.className = "legend-dot";
      dot.style.background = legendDotColor(g).getStyle();

      const label = document.createElement("span");
      label.textContent = g;

      item.appendChild(dot);
      item.appendChild(label);
      frag.appendChild(item);
    });
  });

  ui.genreLegend.textContent = "";
  ui.genreLegend.appendChild(frag);
}

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

function renderList() {
  const frag = document.createDocumentFragment();
  points.forEach(a => frag.appendChild(buildAlbumRow(a)));
  ui.list.textContent = "";
  ui.list.appendChild(frag);
  document.querySelector("#count").textContent = `(${points.length})`;
}

const MAX_SUGGESTIONS = 8;
let currentSuggestions = [];
let activeSuggestionIndex = -1;

function computeMatches(query) {
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

  return matches.slice(0, MAX_SUGGESTIONS);
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
  currentSuggestions = computeMatches(query);
  activeSuggestionIndex = -1;

  if (!ui.searchResults) return; // sin markup del dropdown en el HTML, no-op

  ui.searchResults.textContent = "";

  if (!currentSuggestions.length) {
    ui.searchResults.classList.remove("open");
    return;
  }

  const frag = document.createDocumentFragment();
  currentSuggestions.forEach((a, i) => frag.appendChild(buildSuggestionRow(a, i)));
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
  const a = currentSuggestions[i];
  if (!a) return;
  ui.search.value = a.album;
  closeTypeahead();
  jumpToAlbum(a);
}

function jumpToAlbum(a) {
  selectAlbum(a.idx);
}

function selectAlbum(idx) {
  const mesh = pointMeshes[idx];
  const point = points[idx];
  if (!mesh || !point) return;

  highlightPoint(mesh);
  focusCameraOnPoint(mesh);
  showSelectionOutline(mesh, point.color);
  scrollListToAlbum(point);
  pinTooltip(idx);
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

function nearestOtherArtist(originVec, excludeArtist, excludeIdx, k) {
  return points
    .filter(p => p.idx !== excludeIdx && p.artist !== excludeArtist)
    .map(p => ({ p, d: p.umapVec.distanceTo(originVec) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(e => e.p);
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

function addConnection(fromMesh, toMesh, colorHex, targetOpacity, dashed, appearAt, lineWidth) {
  const line = createConnectionLine(colorHex, dashed, lineWidth);
  line.userData.targetOpacity = targetOpacity;
  line.userData.appearAt = appearAt;
  line.userData.dashed = dashed;
  connectionGroup.add(line);
  connectionLines.push({ line, fromMesh, toMesh });
}

function fadeNodeIn(mesh, targetOpacity, appearAt) {
  connectionNodeFades.push({ mesh, targetOpacity, appearAt });
}

function clearConnections() {
  connectionLines.forEach(c => {
    c.line.geometry.dispose();
    c.line.material.dispose();
    connectionGroup.remove(c.line);
  });
  connectionLines = [];
  connectionNodeFades = [];
  activeGraphIndices = new Set();
  hoverPreviewIndex = null;
}

function buildDiscoveryGraph(originIdx) {
  clearConnections();

  const origin = points[originIdx];
  if (!origin) return;

  const now = performance.now();
  activeGraphIndices.add(origin.idx);

  // --- Hilo cronológico entre discos del mismo artista ---
  const sameArtistChain = points
    .filter(p => p.artist === origin.artist)
    .sort((a, b) => a.year - b.year);

  sameArtistChain.forEach(p => activeGraphIndices.add(p.idx));

  for (let i = 0; i < sameArtistChain.length - 1; i++) {
    addConnection(
      pointMeshes[sameArtistChain[i].idx],
      pointMeshes[sameArtistChain[i + 1].idx],
      origin.color.getHex(),
      CONNECTION_CONFIG.sameArtistLineOpacity,
      false,
      now,
      CONNECTION_CONFIG.sameArtistLineWidth
    );
  }

  // --- Nivel 1: discos más afines, de otro artista ---
  const level1Delay = now + CONNECTION_CONFIG.stageDelay;
  const level1 = nearestOtherArtist(
    origin.umapVec, origin.artist, origin.idx, CONNECTION_CONFIG.level1Count
  );

  level1.forEach((node, i) => {
    const appearAt = level1Delay + i * CONNECTION_CONFIG.siblingStagger;
    const nodeMesh = pointMeshes[node.idx];
    activeGraphIndices.add(node.idx);

    addConnection(
      pointMeshes[origin.idx], nodeMesh, 0x9a9a9a, CONNECTION_CONFIG.level1LineOpacity, true, appearAt,
      CONNECTION_CONFIG.level1LineWidth
    );
    fadeNodeIn(nodeMesh, CONNECTION_CONFIG.level1NodeOpacity, appearAt);

    // --- Nivel 2: hijos de cada nodo de nivel 1 ---
    const level2Delay = appearAt + CONNECTION_CONFIG.stageDelay;
    const level2 = nearestOtherArtist(
      node.umapVec, node.artist, node.idx, CONNECTION_CONFIG.level2Count
    );

    level2.forEach((child, j) => {
      const childAppearAt = level2Delay + j * CONNECTION_CONFIG.siblingStagger;
      const childMesh = pointMeshes[child.idx];
      activeGraphIndices.add(child.idx);

      addConnection(
        nodeMesh, childMesh, 0xc4c4c4, CONNECTION_CONFIG.level2LineOpacity, true, childAppearAt,
        CONNECTION_CONFIG.level2LineWidth
      );
      fadeNodeIn(childMesh, CONNECTION_CONFIG.level2NodeOpacity, childAppearAt);
    });
  });
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

function showTooltipForPoint(i, x, y) {
  const a = points[i];
  const primary = a.genres.primary.map(g=>`<span class="primary">${g}</span>`).join(" · ");
  const secondary = a.genres.secondary.map(g=>`<span class="secondary">${g}</span>`).join(" · ");
  ui.tooltip.innerHTML = `
    <strong>${a.album}</strong>
    <div class="artist">${a.artist} · ${a.year}</div>
    <div class="genres">${primary}${secondary ? "<br>"+secondary : ""}</div>
  `;
  ui.tooltip.style.pointerEvents = "none";
  ui.tooltip.style.right = "auto";
  ui.tooltip.style.display = "block";
  ui.tooltip.style.left = `${Math.min(x+16, innerWidth-320)}px`;
  ui.tooltip.style.top = `${Math.min(y+16, innerHeight-150)}px`;
}

function hideTooltip() {
  ui.tooltip.style.display = "none";
}

function buildNearestRow(p) {
  const row = document.createElement("div");
  row.className = "nearest-row";
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;";

  const dot = document.createElement("i");
  dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p.color.getStyle()};`;

  const text = document.createElement("span");
  text.style.fontSize = "12px";
  text.textContent = `${p.album} — ${p.artist}`;

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

// Proyecta una posición 3D a coordenadas de pantalla (mismo cálculo que ya
// usan las etiquetas de género para su chequeo de solapamiento).
const screenProjectionVector = new THREE.Vector3();
function projectToScreen(vec3) {
  screenProjectionVector.copy(vec3).project(camera);
  return {
    x: (screenProjectionVector.x * 0.5 + 0.5) * innerWidth,
    y: (-screenProjectionVector.y * 0.5 + 0.5) * innerHeight
  };
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

  const title = document.createElement("strong");
  title.textContent = a.album;

  const artistLine = document.createElement("div");
  artistLine.className = "artist";
  artistLine.textContent = `${a.artist} · ${a.year}`;

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
  ui.tooltip.appendChild(title);
  ui.tooltip.appendChild(artistLine);
  ui.tooltip.appendChild(genresDiv);

  const nearest = computeNearestAlbums(i, 3);
  if (nearest.length) {
    const nearestTitle = document.createElement("div");
    nearestTitle.textContent = "Discos más cercanos";
    nearestTitle.style.cssText = "margin-top:10px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;";
    ui.tooltip.appendChild(nearestTitle);
    nearest.forEach(p => ui.tooltip.appendChild(buildNearestRow(p)));
  }

  ui.tooltip.style.right = "auto";
  ui.tooltip.style.left = `${Math.min(x+16, innerWidth-320)}px`;
  ui.tooltip.style.top = `${Math.min(y+16, innerHeight-300)}px`;
  ui.tooltip.style.display = "block";
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

function pointerMove(e) {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  const hit = raycaster.intersectObjects(pointMeshes)[0];

  pointMeshes.forEach(m => m.material.emissiveIntensity = .35);

  if (hit) {
    hit.object.material.emissiveIntensity = 1.2;
    renderer.domElement.style.cursor = "pointer";
  } else {
    renderer.domElement.style.cursor = "default";
  }

  if (pinnedIndex !== null) {
    const hitIdx = hit?.object.userData.index;
    const showPreview = hit && hitIdx !== pinnedIndex && activeGraphIndices.has(hitIdx);

    if (showPreview) {
      hoverPreviewIndex = hitIdx;
      showTooltipForPoint(hitIdx, e.clientX, e.clientY);
    } else if (hoverPreviewIndex !== null) {
      hoverPreviewIndex = null;
      pinTooltip(pinnedIndex); // restaura el panel fijado
    }
    return;
  }

  if (hit) {
    showTooltipForPoint(hit.object.userData.index, e.clientX, e.clientY);
  } else {
    hideTooltip();
  }
}

function pointerClick(e) {
  if (e.target !== renderer.domElement) return; // ignora clicks fuera del mapa 3D (ej: dropdown de búsqueda)

  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  const hit = raycaster.intersectObjects(pointMeshes)[0];
  if (!hit) {
    clearHighlight();
    return;
  }
  selectAlbum(hit.object.userData.index);
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
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => renderTypeahead(value), SEARCH_DEBOUNCE_MS);
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

ui.timeToggle?.addEventListener("change", e => setTimeMode(e.target.checked));
ui.genreLabelToggle?.addEventListener("change", e => setGenreLabelsVisible(e.target.checked));

window.addEventListener("pointermove",pointerMove);
window.addEventListener("click",pointerClick);
window.addEventListener("resize",()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  connectionLines.forEach(c => c.line.material.resolution.set(innerWidth, innerHeight));
});

function animate() {
  requestAnimationFrame(animate);
  tickAnimation();
  tickCameraFocus();
  updateSelectionOutline();
  updateGenreLabels();
  updateConnections();
  controls.update();
  renderer.render(scene,camera);
}

fetch("./data/albums.json")
  .then(r => r.json())
  .then(data => {
    albums = data;
    return calculateModel();
  })
  .catch(err => {
    console.error(err);
    ui.status.textContent = "No se pudo cargar data/albums.json";
  });

animate();