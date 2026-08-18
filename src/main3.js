import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let albums = [];
let points = [];
let pointMeshes = [];
let yearSprites = [];
let orbitRings = [];
let selected = null;

const ui = {
  list: document.querySelector("#albumList"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status"),
  tooltip: document.querySelector("#tooltip"),
  genreLegend: document.querySelector('#genreLegend'),
  timeToggle: document.querySelector('#timeToggle')
};

const WEIGHTS = {
  primaryBase: 1.0,
  secondaryBase: .55,
  secondaryDecay: .78
};

const MODEL_CONFIG = {
  descriptorWeight: 0.5,
  nNeighbors: 4,
  minDist: 0.25
};

const TIME_LAYOUT = {
  foldWeight: 0.35,   // cuánto de UMAP_Y se pliega en el radio X/Z
  totalHeight: 100     // rango vertical total ocupado por los años
};

const ANIM_DURATION = 1400; // ms de la transición estilístico <-> temporal

let timeMode = false;
let animating = false;
let animStart = 0;
let animFrom = [];
let animTo = [];
let timeCentroid = new THREE.Vector3(); // mismo centro usado por el plegado radial, reutilizado por las órbitas

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

  // Principales: misma jerarquía conceptual, pero conservando el orden.
  album.genres.primary.forEach((genre, i) => {
    const rankWeight = WEIGHTS.primaryBase * Math.pow(.88, i);
    v[vocab.genres.indexOf(genre)] = rankWeight;
  });

  // Secundarios: menor influencia y decrecimiento por posición.
  album.genres.secondary.forEach((genre, i) => {
    const rankWeight = WEIGHTS.secondaryBase * Math.pow(WEIGHTS.secondaryDecay, i);
    v[vocab.genres.indexOf(genre)] = Math.max(
      v[vocab.genres.indexOf(genre)], rankWeight
    );
  });

  // Descriptores: señal secundaria configurable.
  const offset = vocab.genres.length;
  album.descriptors.forEach(descriptor => {
    const i = vocab.descriptors.indexOf(descriptor);
    if (i >= 0) v[offset + i] = descriptorWeight;
  });

  return v;
}

// Cada familia declara `group`: el clúster de afinidad que se usa para
// agrupar el panel lateral de géneros (ver renderGenreLegend / GROUP_ORDER
// más abajo), además de definir el color por hue/sat/light.
const GENRE_FAMILIES = [

  // =========================================================
  // METAL — negros / grises
  // =========================================================

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


  // =========================================================
  // ROCK — azules
  // =========================================================

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


  // =========================================================
  // PUNK — rojos
  // =========================================================

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


  // =========================================================
  // POP — púrpuras / violetas
  // =========================================================

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


  // =========================================================
  // NEW WAVE — magentas / violetas rojizos
  // =========================================================

  {
    match: /new wave/i,
    group: "New Wave",
    hueRange: [300, 320]
  },


  // =========================================================
  // POST-PUNK — rojos oscuros / magentas
  // =========================================================

  {
    match: /post-punk/i,
    group: "Post-Punk",
    hueRange: [350, 360]
  },


  // =========================================================
  // REGGAE — verdes
  // =========================================================

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


  // =========================================================
  // SKA — verde / amarillo verdoso
  // =========================================================

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


  // =========================================================
  // PSYCHEDELIA — verdeazulados
  // =========================================================

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


  // =========================================================
  // ELECTRÓNICA / DANCE — cianes
  // =========================================================

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


  // =========================================================
  // HIP HOP / RAP — cian / turquesa
  // =========================================================

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


  // =========================================================
  // FOLK / CANCIÓN — ocres
  // =========================================================

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


  // =========================================================
  // LATIN / HISPANOAMERICANO — naranjas
  // =========================================================

  {
    match: /latin alternative/i,
    group: "Latin / Hispanoamericano",
    hueRange: [65, 75]
  },


  // =========================================================
  // JAZZ — amarillos
  // =========================================================

  {
    match: /jazz-rock/i,
    group: "Jazz",
    hueRange: [70, 80]
  },


  // =========================================================
  // CHRISTIAN — dorados
  // =========================================================

  {
    match: /christian rock/i,
    group: "Christian",
    hueRange: [50, 60]
  }

];

// Orden de despliegue de los grupos en el panel lateral: sigue el mismo
// recorrido de hue que ya usan las familias arriba (grises -> azules ->
// rojos -> violetas -> magentas -> verdes -> cianes -> ocres -> amarillos),
// para que la lista visual y el orden de colores coincidan. "Otros" (géneros
// sin familia asignada, ej. "Beat" si no matchea ningún regex) va al final.
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

// Cache género -> familia, para no recorrer GENRE_FAMILIES con regex
// en cada color/leyenda cuando la cola de géneros crezca a full dataset.
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

// Calcula, para cada álbum, la posición del "modo temporal" sin descartar
// ninguna de las 3 dimensiones de UMAP. Ver comentario de TIME_LAYOUT arriba.
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

    // Ángulo y radio en el plano X/Z: proximidad estilística dominante.
    const angle = Math.atan2(pz - cz, px - cx);
    const baseRadius = Math.hypot(px - cx, pz - cz);

    // UMAP_Y no se descarta: se pliega como modulación del radio, así
    // sigue empujando el punto dentro/fuera del cluster.
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
    // Precomputado una sola vez: evita relowercasear todo el dataset
    // en cada tecla que se tipea en el buscador.
    searchText: `${albums[i].album} ${albums[i].artist}`.toLowerCase()
  }));

  computeTimeLayout();
  createPoints();
  createYearSprites();
  createYearOrbits();

  // Si el modo temporal ya estaba activo (ej: tras recalcular UMAP),
  // saltamos directo al layout temporal sin animar desde cero.
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

  selected = null;
}

function createPoints() {
  points.forEach((a,i) => {
    const geo = new THREE.SphereGeometry(1, 10, 10);
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

// ---------- Etiquetas de año (solo visibles en modo temporal) ----------

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
  ctx.font = "bold 48px sans-serif";
  ctx.fillStyle = "#333333";
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

// ---------- Órbitas por año (anillo de referencia en modo temporal) ----------
// Un aro gris claro por cada año, apoyado en el mismo centro que usa el
// plegado radial (timeCentroid), a la altura (timeY) correspondiente a ese
// año. Sirve como referencia visual del "plano temporal" que comparten
// todos los álbumes de ese año.

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
    // Mínimo para que el anillo se vea incluso si el año tiene un solo
    // álbum muy cerca del centro.
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

// ---------- Toggle de modo temporal ----------

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

function highlightArtist(artist) {
  pointMeshes.forEach(m => {
    m.material.opacity = (m.userData.album.artist === artist) ? 1 : 0.25;
  });
  selected = artist;
}

function clearHighlight() {
  pointMeshes.forEach(m => { m.material.opacity = 1; });
  selected = null;
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

// Agrupa los primary genres por afinidad (la misma familia usada para el
// color, ver GENRE_FAMILIES/GROUP_ORDER) en vez de listarlos alfabéticamente
// sueltos. Géneros sin familia asignada caen en "Otros", al final.
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

// ---------- Lista lateral de álbumes ----------
// Antes: innerHTML con template string por fila (reparseo HTML completo
// en cada render) y sin debounce en el input, así que cada tecla del
// buscador reconstruía las ~1000 filas.
// Ahora: DOM armado con createElement/textContent + DocumentFragment
// (un solo reflow al final) y el filtro corre sobre searchText, ya
// precomputado en calculateModel.

function buildAlbumRow(a) {
  const el = document.createElement("div");
  el.className = "album";

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

function renderList(filter="") {
  const q = filter.toLowerCase().trim();
  const frag = document.createDocumentFragment();
  let visibleCount = 0;

  points.forEach(a => {
    if (q && !a.searchText.includes(q)) return;
    visibleCount++;
    frag.appendChild(buildAlbumRow(a));
  });

  ui.list.textContent = "";
  ui.list.appendChild(frag);
  document.querySelector("#count").textContent = `(${visibleCount})`;
}

function focusArtist(i) {
  const p = points[i];
  highlightArtist(p.artist);
}

function fitCamera() {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.set(center.x + size.x*.2, center.y + size.y*.35, center.z + Math.max(size.length()*1.25, 80));
  controls.update();
}

function showTooltipForPoint(i,x,y) {
  const a = points[i];
  const primary = a.genres.primary.map(g=>`<span class="primary">${g}</span>`).join(" · ");
  const secondary = a.genres.secondary.map(g=>`<span class="secondary">${g}</span>`).join(" · ");
  ui.tooltip.innerHTML = `
    <strong>${a.album}</strong>
    <div class="artist">${a.artist} · ${a.year}</div>
    <div class="genres">${primary}${secondary ? "<br>"+secondary : ""}</div>
  `;
  ui.tooltip.style.display = "block";
  ui.tooltip.style.left = `${Math.min(x+16, innerWidth-320)}px`;
  ui.tooltip.style.top = `${Math.min(y+16, innerHeight-150)}px`;
}

function hideTooltip() {
  ui.tooltip.style.display = "none";
}

function pointerMove(e) {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  const hit = raycaster.intersectObjects(pointMeshes)[0];

  pointMeshes.forEach(m => m.material.emissiveIntensity = .35);

  if (hit) {
    hit.object.material.emissiveIntensity = 1.2;
    showTooltipForPoint(hit.object.userData.index,e.clientX,e.clientY);
    renderer.domElement.style.cursor = "pointer";
  } else {
    hideTooltip();
    renderer.domElement.style.cursor = "default";
  }
}

function pointerClick(e) {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  const hit = raycaster.intersectObjects(pointMeshes)[0];
  if (!hit) {
    clearHighlight();
    return;
  }
  focusArtist(hit.object.userData.index);
}

// Debounce del buscador: evita reconstruir toda la lista en cada tecla.
const SEARCH_DEBOUNCE_MS = 180;
let searchDebounceTimer = null;
ui.search.addEventListener("input", e => {
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => renderList(value), SEARCH_DEBOUNCE_MS);
});

ui.timeToggle?.addEventListener("change", e => setTimeMode(e.target.checked));

window.addEventListener("pointermove",pointerMove);
window.addEventListener("click",pointerClick);
window.addEventListener("resize",()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  tickAnimation();
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