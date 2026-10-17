import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { UMAP } from "umap-js";

let selectedGenres = new Set();
let genreLegendItemsByGenre = new Map(); 
let genreLegendGroups = new Map(); 
let tooltipExpanded = false; 
let pinnedArtists = new Set();
let artistPanelEls = new Map();
let onboardingOverlay = null;
let onboardingProgressFillEl = null;
let onboardingProgressLabelEl = null;
let onboardingSearchInputEl = null;
let onboardingStartCta = null;
let onboardingPresetCardEls = [];
let loadingProgress = 0;

function resetInteractionState() {
  clearHighlight();
  clearGenreSelection();
  clearYearHighlight();
  clearArtistPanels();
  resetAllFilters();
  resetNetworkInsightMode();
}

function resetView() {
  if (timeMode) setTimeMode(false);
  if (ui.timeToggle) ui.timeToggle.checked = false;
  fitCamera(false);
}

function applyArtistsPreset(artistNames, opts = {}) {
  if (!points.length) return;
  resetInteractionState();

  artistNames.forEach(name => activeFilters.artists.add(name));
  refreshFilterOptions();

  if (opts.timeMode) setTimeMode(true);

  applyPresetYears(opts.years);
}

function applyGenreGroupPreset(groupNames, opts = {}) {
  if (!points.length) return;
  resetInteractionState();

  [].concat(groupNames).forEach(name => {
    const groupData = genreLegendGroups.get(name);
    if (groupData) toggleGenreGroupSelection(groupData.genres);
  });

  if (opts.timeMode) {
    if (ui.timeToggle) ui.timeToggle.checked = true;
    setTimeMode(true);
  }

  applyPresetYears(opts.years);
}

function applyInsightPreset(mode) {
  if (!points.length) return;
  resetInteractionState();
  setNetworkInsightMode(mode);
}

function applyPresetYears(years) {
  if (!years) return;
  const [from, to] = years;

  activeFilters.yearFrom = from;
  activeFilters.yearTo = to;
  refreshFilterOptions();

  if (timeMode) {
    const selected = new Set(points.map(p => p.year).filter(y => y >= from && y <= to));
    setYearSelection(selected, { keepFilters: true, panelYears: new Set() });
  }
}

const ONBOARDING_LOADING_TEXT =
  "Una constelación que representa la evolución del rock y la música nacional a través de la interrelación de sus discos.";

const ONBOARDING_ABOUT_TEXT =
  "Una constelación que representa la evolución del rock y la música nacional a través de sus discos: cada punto es un álbum, cada cercanía una afinidad de género, cada línea una historia de influencias.";

const OB_SEARCH_ICON_SVG =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';

const ONBOARDING_SECTIONS = [
  { key: "hallazgos", title: "HALLAZGOS", subtitle: "Patrones, trayectorias, historia" },
  { key: "explorar",  title: "EXPLORAR",  subtitle: "Corrientes, estilos, géneros" }
];

const ONBOARDING_PRESETS = [
  {
    title: "Secuencia inicial",
    subtitle: "La Nueva Ola y aquellos primeros años desde La Cueva.",    
    section: "explorar",
    img:"./img/constelaSerie.jpg",
    apply: () => applyArtistsPreset(
      ['Manal', 'Almendra', 'Los Gatos', 'Vox Dei', 'Vivencia', 'Pedro y Pablo'],
      { timeMode: true }
    )
  },
  {
    title: "Primavera democrática",
    subtitle: "Del inicio en los 90’s, al auge post-2001, y su declive pos-Cromañon.",
    section: "explorar",
    img:"./img/constelaSerie.jpg",
    apply: () => applyGenreGroupPreset(['New Wave', 'Pop'], { timeMode: true, years: [1983, 1989] })
  },
  // {
  //   title: "No tan distintos",
  //   subtitle: "Lejos del imaginario popular, bandas con trayectorias similares.",
  //   section: "explorar",
  //   img:"./img/constelaSerie.jpg",
  //   apply: () => applyArtistsPreset(
  //     ['Soda Stereo', 'Patricio Rey y Sus Redonditos de Ricota'],
  //     { timeMode: false }
  //   )
  // },
  {
    title: "Artistas post-bandas",
    subtitle: "Algunos siguen la misma línea, otros van hacia nuevos rumbos. ",    
    section: "explorar",
    img:"./img/constelaDiversidad.jpg",
    apply: () => applyArtistsPreset(
      ['Soda Stereo', 'Gustavo Cerati', 'Los Fabulosos Cadillacs', 'Vicentico', 'Patricio Rey y Sus Redonditos de Ricota', 'Indio y Los Fundamentalistas del Aire Acondicionado'],
      { timeMode: true }
    )
  },
  {
    title: "Fueras de sektor",
    subtitle: "Discos más distantes a a los vecindarios a los que pertenecen.",
    section: "hallazgos",
    img:"./img/constelaSerie.jpg",
    apply: () => applyInsightPreset('outliers')
  },
  // {
  //   title: "Hubs",
  //   subtitle: "Discos por los cuales pasa la mayor cantidad de conexiones.",
  //   section: "hallazgos",
  //   img:"./img/constelaHub.jpg",
  //   apply: () => applyInsightPreset('outliers')
  // },
  {
    title: "Adorables puentes",
    subtitle: "Discos que conectan géneros, sin los cuales estos serían islas.",
    section: "hallazgos",
    img:"./img/constelaPuente.jpg",
    apply: () => applyInsightPreset('outliers')
  },
  {
    title: "Tu influyencia",
    subtitle: "Discos ancestros de una gran cantidad de obras de otros artistas.",
    section: "hallazgos",
    img:"./img/constelaInfluencia.jpg",
    apply: () => applyInsightPreset('outliers')
  }
];

function obEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createOnboardingOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "onboardingOverlay";
  (document.querySelector("#app") ?? document.body).appendChild(overlay);
  document.body.classList.add("is-onboarding"); 
  setSidebarOpen(false); 
  return overlay;
}

function exitOnboarding() {
  removeOnboardingOverlay();
  if (innerWidth > 800) setSidebarOpen(true, "filters");
}

function clearOverlayContent() {
  onboardingOverlay.textContent = "";
}

function removeOnboardingOverlay() {
  if (onboardingOverlay) onboardingOverlay.remove();
  onboardingOverlay = null;
  if (aboutFabEl) aboutFabEl.hidden = loadingProgress < 100;
  document.body.classList.remove("is-onboarding");
  onboardingProgressFillEl = null;
  onboardingProgressLabelEl = null;
  onboardingSearchInputEl = null;
  onboardingStartCta = null;
  onboardingPresetCardEls = [];
}

function closeOnboarding() {
  exitOnboarding();
}

  
function setLoadingProgress(pct) {
  loadingProgress = Math.max(0, Math.min(100, pct));
  const ready = loadingProgress >= 100;

  if (onboardingProgressFillEl) onboardingProgressFillEl.style.width = `${loadingProgress}%`;
  if (onboardingProgressLabelEl) {
    onboardingProgressLabelEl.textContent = `${Math.round(loadingProgress)}%`;
  }

  if (aboutFabEl) aboutFabEl.hidden = !ready;

  const frame = onboardingOverlay?.querySelector(".ob-frame");
  if (frame) frame.classList.toggle("is-loading", !ready);

  if (onboardingSearchInputEl) {
    const wasDisabled = onboardingSearchInputEl.disabled;
    onboardingSearchInputEl.disabled = !ready;
    if (ready && wasDisabled) onboardingSearchInputEl.focus();
  }

  [onboardingStartCta, ...onboardingPresetCardEls].forEach(el => {
    if (el) el.disabled = !ready;
  });
}

function setOnboardingSearching(on) {
  onboardingOverlay?.querySelector(".ob-frame")?.classList.toggle("is-searching", on);
  if (aboutGroupEl) aboutGroupEl.hidden = on || loadingProgress < 100;
}

function renderOnboardingStep1() {
  clearOverlayContent();
  const ready = loadingProgress >= 100;

  const frame = obEl("div", "ob-frame");
  const overlay = obEl("span", "ob-frame-overlay");
  if (frame) frame.classList.toggle("is-loading", !ready);

  const hero = obEl("header", "ob-hero");
  hero.appendChild(obEl("span", "ob-header-logo"));

  const loading = obEl("section", "ob-loading");
  loading.appendChild(obEl("h2", "ob-loading-title", "Bienvenidos a ConstelaRock"));
  loading.appendChild(obEl("p", "ob-loading-text", ONBOARDING_LOADING_TEXT));

  const track = obEl("div", "ob-loading-track");
  const fill = obEl("div", "ob-loading-fill");
  fill.style.width = `${loadingProgress}%`;
  track.appendChild(fill);
  loading.appendChild(track);

  const progressLabel = obEl("div", "ob-loading-label", `${Math.round(loadingProgress)}%`);
  loading.appendChild(progressLabel);

  const logo = obEl("span", "ob-header-logo");

  const searchBlock = obEl("section", "ob-search-block");
  searchBlock.appendChild(obEl("h2", "ob-question", "¿Cuál es tu banda o artista nacional favorito?"));

  const search = obEl("div", "ob-search");
  const field = obEl("div", "ob-search-field");

  const searchIcon = obEl("span", "ob-search-icon");
  searchIcon.innerHTML = OB_SEARCH_ICON_SVG;

  const input = obEl("input", "ob-search-input");
  input.type = "text";
  input.placeholder = "Pueden ser solistas o bandas";
  input.setAttribute("aria-label", "Buscar artista");
  input.autocomplete = "off";
  input.disabled = !ready;

  field.appendChild(searchIcon);
  field.appendChild(input);

  const results = obEl("div", "ob-results");
  search.appendChild(field);
  search.appendChild(results);
  searchBlock.appendChild(search);

  onboardingPresetCardEls = [];
  const presets = obEl("section", "ob-presets");

  ONBOARDING_SECTIONS.forEach(section => {
    const group = obEl("div", "ob-preset-group");
    group.appendChild(obEl("h2", "ob-preset-title", section.title));
    group.appendChild(obEl("p", "ob-preset-subtitle", section.subtitle));

    const row = obEl("div", "ob-card-row");
    ONBOARDING_PRESETS
      .filter(preset => preset.section === section.key)
      .forEach(preset => {
        const card = obEl("button", "ob-card");
        const title = obEl("h3", "ob-card-title", preset.title);
        const subtitle = obEl("p", "ob-card-subtitle", preset.subtitle);
        const img = obEl("i", "img");
        card.type = "button";
        card.disabled = !ready;
        card.addEventListener("click", e => {
          e.stopPropagation();
          if (card.disabled) return;
          exitOnboarding();
          preset.apply();
        });
        onboardingPresetCardEls.push(card);
        row.appendChild(card);
        card.appendChild(img);
        card.appendChild(title);
        card.appendChild(subtitle);
      });

    group.appendChild(row);
    presets.appendChild(group);
  });

  const footer = obEl("footer", "ob-footer");
  const exploreBtn = obEl("button", "ob-explore", "Quiero explorar libremente");
  exploreBtn.type = "button";
  exploreBtn.disabled = !ready;
  exploreBtn.addEventListener("click", e => {
    e.stopPropagation();
    closeOnboarding();
  });

  footer.appendChild(exploreBtn);

  input.addEventListener("input", () => {
    const query = input.value.trim();
    const matches = computeArtistMatches(query);

    setOnboardingSearching(query.length > 0);

    results.textContent = "";
    matches.forEach(name => {
      const row = obEl("div", "ob-result-row", name);
      row.addEventListener("click", () => renderOnboardingStep2(name));
      results.appendChild(row);
    });
  });

  frame.appendChild(loading);
  frame.appendChild(hero);
  frame.appendChild(searchBlock);
  frame.appendChild(presets);
  frame.appendChild(footer);
  frame.appendChild(overlay);
  onboardingOverlay.appendChild(frame);

  onboardingProgressFillEl = fill;
  onboardingProgressLabelEl = progressLabel;
  onboardingStartCta = exploreBtn;
  onboardingSearchInputEl = input;

  setOnboardingSearching(false);
  if (ready) input.focus();
}

function renderOnboardingStep2(artist) {
  clearOverlayContent();
  setOnboardingSearching(false);
  const discog = getArtistDiscography(artist);
  const stats = computeArtistStats(artist);
  if (!discog.length || !stats) { renderOnboardingStep1(); return; }

  const box = obEl("div", "ob-box artist");
  const overlay = obEl("span", "ob-frame-overlay");
  const header = obEl("div", "ob-box-header");

  const hero = obEl("header", "ob-hero");
  const logo = obEl("span", "ob-header-logo");
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", "ConstelaRock");

  const locateBtn = obEl("button", "ob-btn--link", "Navegar trayectoria del artista");
  locateBtn.type = "button";
  locateBtn.addEventListener("click", () => {
    resetNetworkInsightMode();
    addArtistFilter(artist);
    refreshFilterOptions();
    selectArtistLine(artist);
    finishOnboardingToArtist();
  });

  header.appendChild(obEl("p", "ob-box-artist", artist));
  
  if (stats.primaryGenres.length) {
    const tags = obEl("div", "ob-tags");
    stats.primaryGenres.forEach(g => tags.appendChild(obEl("span", "ob-tag", g)));
    header.appendChild(tags);
  }
  header.appendChild(obEl("p", "ob-box-meta", `${stats.firstYear} - ${stats.lastYear}`));
  header.appendChild(locateBtn);

  const list = obEl("div", "ob-disco-list");
  discog.forEach(a => {
    const row = obEl("div", "ob-disco-row");
    row.appendChild(createCoverThumb(a, 124));

    const info = obEl("div", "ob-disco-info");
    info.appendChild(obEl("span", "ob-disco-title", `${a.album} (${a.year})`));

    if (a.genres.primary.length) {
      const tags = obEl("div", "ob-tags");
      a.genres.primary.forEach(g => tags.appendChild(obEl("span", "ob-disco-subtitle", g)));
      info.appendChild(tags);
    }

    row.appendChild(info);
    row.addEventListener("click", () => finishOnboarding(a.idx));
    list.appendChild(row);
  });

  header.appendChild(list);
  const logo2 = obEl("span", "ob-header-logo");
  const backBtn = obEl("button", "sidebar_btn", "← Volver atrás");
  backBtn.type = "button";
  backBtn.setAttribute("aria-label", "Volver");
  backBtn.addEventListener("click", e => {
    e.stopPropagation();
    renderOnboardingStep1();
  });

  hero.appendChild(logo);
  box.appendChild(logo2);
  box.appendChild(header);
  box.appendChild(overlay);
  box.appendChild(backBtn);
  onboardingOverlay.appendChild(box);
}

function finishOnboarding(idx) {
  removeOnboardingOverlay();
  selectAlbum(idx);
}

function finishOnboardingToArtist() {
  exitOnboarding();
}

function reopenOnboarding() {
  removeOnboardingOverlay();
  onboardingOverlay = createOnboardingOverlay();
  renderOnboardingStep1();
}

function ensureArtistPanelEl(artist) {
  if (artistPanelEls.has(artist)) return artistPanelEls.get(artist);
  const el = document.createElement("div");
  el.className = ui.tooltip.className;
  el.style.position = "absolute";
  el.style.pointerEvents = "auto";
  document.body.appendChild(el);
  artistPanelEls.set(artist, el);
  renderArtistDetailPanelInto(el, artist);
  return el;
}

function removeArtistFilter(artist) {
  activeFilters.artists.delete(artist);
  unpinArtist(artist);
  refreshFilterOptions();
  updateGenreLegendActiveState();
}

function renderArtistDetailPanelInto(el, artist) {
  const stats = computeArtistStats(artist);
  if (!stats) return;

  el.textContent = "";
  setPanelBorder(el, artistColor(artist));
  el.style.display = "block";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.style.cssText = "position:absolute;top:12px;right:12px;border:none;background:none;font-size:24px;line-height:1;cursor:pointer;color:white;width:min-content;padding:0;";
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    unpinArtist(artist);
    removeArtistFilter(artist);
  });

  const title = document.createElement("strong");
  title.textContent = stats.artist;

  const trajectory = document.createElement("div");
  trajectory.className = "artist";
  trajectory.textContent = stats.firstYear === stats.lastYear
    ? `${stats.firstYear}`
    : `${stats.firstYear} – ${stats.lastYear}`;

  const genresDiv = document.createElement("div");
  genresDiv.className = "genres";
  stats.primaryGenres.forEach(g => {
    const span = document.createElement("span");
    span.className = "primary";
    span.textContent = g;
    genresDiv.appendChild(span);
  });
  stats.secondaryGenres.forEach(g => {
    const span = document.createElement("span");
    span.className = "secondary";
    span.textContent = g;
    genresDiv.appendChild(span);
  });

  el.appendChild(closeBtn);
  el.appendChild(title);
  el.appendChild(trajectory);
  el.appendChild(genresDiv);
}

const artistMidpoint = new THREE.Vector3();


function artistTrajectoryMidpoint(artist, out) {
  const meshes = getArtistDiscography(artist)
    .map(d => pointMeshes[d.idx])
    .filter(Boolean);

  if (!meshes.length) return null;
  if (meshes.length === 1) return out.copy(meshes[0].position);

  const segLengths = [];
  let total = 0;
  for (let i = 0; i < meshes.length - 1; i++) {
    const len = meshes[i].position.distanceTo(meshes[i + 1].position);
    segLengths.push(len);
    total += len;
  }
  if (total < 1e-6) return out.copy(meshes[0].position);

  let remaining = total / 2;
  for (let i = 0; i < segLengths.length; i++) {
    if (remaining <= segLengths[i] || i === segLengths.length - 1) {
      const t = segLengths[i] > 1e-6 ? Math.min(remaining / segLengths[i], 1) : 0;
      return out.lerpVectors(meshes[i].position, meshes[i + 1].position, t);
    }
    remaining -= segLengths[i];
  }
  return out.copy(meshes[0].position);
}

function updateArtistPanels() {
  const keep = new Set();

  pinnedArtists.forEach(artist => {
    keep.add(artist);

    const anchor = artistTrajectoryMidpoint(artist, artistMidpoint);
    const { x, y } = anchor
      ? projectToScreen(anchor)
      : { x: innerWidth / 2, y: innerHeight / 2 };

    const el = ensureArtistPanelEl(artist);
    placeTooltip(el, x, y, "above");
  });

  [...artistPanelEls.keys()].forEach(artist => {
    if (!keep.has(artist)) {
      artistPanelEls.get(artist).remove();
      artistPanelEls.delete(artist);
    }
  });
}

function unpinArtist(artist) {
  pinnedArtists.delete(artist);
  const el = artistPanelEls.get(artist);
  if (el) el.remove();
  artistPanelEls.delete(artist);
}

function clearArtistPanels() {
  artistPanelEls.forEach(el => el.remove());
  artistPanelEls.clear();
  pinnedArtists.clear();
}

function buildArtistHoverHTML(artist) {
  const stats = computeArtistStats(artist);
  if (!stats) return "";
  const primary = stats.primaryGenres[0] ?? "";
  const range = stats.firstYear === stats.lastYear
    ? `${stats.firstYear}`
    : `${stats.firstYear}–${stats.lastYear}`;
  return `
    <strong>${stats.artist}</strong>
    <div class="artist">${range}</div>
    ${primary ? `<div class="genres"><span class="primary">${primary}</span></div>` : ""}
  `;
}

function selectArtistLine(artist) {
  resetNetworkInsightMode();
  selectedIndices.clear();
  clearSelectionOutlines();
  clearMultiSelectPanels();
  unpinTooltip();
  renderSelectedChips();
  updateFilterGenreVisuals();

  pinnedArtists.add(artist);
  updateArtistPanels();
  focusCameraOnArtist(artist);  
}

function focusCameraOnArtist(artist) {
  const discog = getArtistDiscography(artist);
  if (!discog.length) return;

  const box = new THREE.Box3();
  discog.forEach(d => box.expandByPoint(timeMode ? d.timeVec : d.umapVec));

  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;

  focusCameraOn(center, radius);
}

function focusCameraOnYears(years) {
  const rings = orbitRings.filter(r => years.has(r.userData.year));
  if (!rings.length) return;

  let minY = Infinity, maxY = -Infinity, maxRadius = 0;
  rings.forEach(r => {
    minY = Math.min(minY, r.position.y);
    maxY = Math.max(maxY, r.position.y);
    maxRadius = Math.max(maxRadius, r.userData.radius);
  });

  const center = new THREE.Vector3(timeCentroid.x, (minY + maxY) / 2, timeCentroid.z);
  const radius = Math.hypot(maxRadius, (maxY - minY) / 2);

  focusCameraOn(center, radius);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

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
let eventLabelSprites = [];
let orbitRings = [];
let genreLabelSprites = [];

let selectedIndices = new Set();
let outlineRings = new Map();
let multiSelectPanels = new Map();
let activeFilters = {
  artists: new Set(),
  yearFrom: null,
  yearTo: null,
  descriptors: new Set(),
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
  filtersClear: document.querySelector('#filtersClear'),
  genreLegendToggleAll: document.querySelector('#genreLegendToggleAll')
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
  activeFilters = { artists: new Set(), yearFrom: null, yearTo: null, descriptors: new Set(), query: "" };
  filteredIndices = null;
  if (ui.search) ui.search.value = "";

  yearSprites.forEach(s => {
    s.material.map?.dispose();
    s.material.dispose();
    root.remove(s);
  });
  yearSprites = [];
  clearEventLabels();
  clearGenreTags();
  
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
}

function updateSelectionVisuals() {
  if (selectedIndices.size === 0) {
    pointMeshes.forEach(m => { m.material.opacity = 1; });
    return;
  }
  pointMeshes.forEach((m, i) => {
    m.material.opacity = selectedIndices.has(i) ? 1 : 0.25;
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
    t.style.cssText = "margin-top:16px;margin-bottom:4px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:white;line-height:1;";
    wrap.appendChild(t);
    wrap.appendChild(buildNearestRow(ancestor, { showYear: true }));
  }

  if (descendants.length) {
    const t = document.createElement("div");
    t.textContent = "Discos descendientes";
    t.style.cssText = "margin-top:16px;margin-bottom:4px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:white;line-height:1;";
    wrap.appendChild(t);
    descendants.forEach(p => wrap.appendChild(buildNearestRow(p, { showYear: true })));
  }

  return wrap;
}

function buildNavChevrons(a) {
  const discog = getArtistDiscography(a.artist);
  const pos = discog.findIndex(p => p.idx === a.idx);

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;position:absolute;bottom:12px;right:12px;";

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "‹";
  prevBtn.setAttribute("aria-label", "Disco anterior del artista");
  prevBtn.disabled = pos <= 0;
  prevBtn.style.cssText = `border:none;background:none;font-size:24px;line-height:1;cursor:${prevBtn.disabled ? "default" : "pointer"};color:${prevBtn.disabled ? "#888" : "#56CCF2"};padding:0;`;
  prevBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (pos > 0) selectAlbum(discog[pos - 1].idx);
  });

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "›";
  nextBtn.setAttribute("aria-label", "Disco siguiente del artista");
  nextBtn.disabled = pos === -1 || pos >= discog.length - 1;
  nextBtn.style.cssText = `border:none;background:none;font-size:24px;line-height:1;cursor:${nextBtn.disabled ? "default" : "pointer"};color:${nextBtn.disabled ? "#888" : "#56CCF2"};padding:0;`;
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
  btn.style.cssText = "margin-top:16px;border:none;color:white;background:#2d9cdb;font-size:12px;text-transform:uppercase;cursor:pointer;padding:8px 6px;width:fit-content;line-height:1; ";
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
    <div style="display:flex;gap:10px;align-items:flex-start;">
      ${coverThumbHTML(a, 72)}
      <div>
        <strong>${a.album}</strong>
        <div class="artist">${a.artist} · ${a.year}</div>
        ${mainGenre ? `<div class="genres"><span class="primary">${mainGenre}</span></div>` : ""}
      </div>
    </div>
  `;
}

const TOOLTIP_MARGIN = 8;
const TOOLTIP_GAP = 16;

function placeTooltip(el, x, y, mode = "above") {
  el.style.right = "auto";
  el.style.bottom = "auto";
  el.style.transform = "none";
  el.style.display = "block";
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left, top;
  if (mode === "left-center") {
    left = x - TOOLTIP_GAP - w;
    top = y - h / 2;
  } else {
    left = x + TOOLTIP_GAP;
    top = y - TOOLTIP_GAP - h;
  }

  const maxLeft = Math.max(TOOLTIP_MARGIN, innerWidth - w - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, innerHeight - h - TOOLTIP_MARGIN);
  el.style.left = `${THREE.MathUtils.clamp(left, TOOLTIP_MARGIN, maxLeft)}px`;
  el.style.top = `${THREE.MathUtils.clamp(top, TOOLTIP_MARGIN, maxTop)}px`;
}

function renderDetailPanel(i, x, y) {
  const a = points[i];
  if (!a) return;

  ui.tooltip.textContent = "";
  ui.tooltip.style.pointerEvents = "auto";
  setPanelBorder(ui.tooltip, a.color);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.style.cssText = CLOSE_BTN_STYLE;
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
    resetNetworkInsightMode();
    clearHighlight();
    addArtistFilter(a.artist);
    selectArtistLine(a.artist);
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

  const headerRow = document.createElement("div");
  headerRow.style.cssText = "display:flex;gap:10px;align-items:flex-start;";
  headerRow.appendChild(createCoverThumb(a, 84));

  const headerText = document.createElement("div");
  headerText.appendChild(title);
  headerText.appendChild(artistLine);
  headerText.appendChild(genresDiv);
  headerRow.appendChild(headerText);

  ui.tooltip.appendChild(closeBtn);
  ui.tooltip.appendChild(navChevrons);
  ui.tooltip.appendChild(headerRow);

  const extendedSection = document.createElement("div");
  extendedSection.style.display = tooltipExpanded ? "block" : "none";
  extendedSection.appendChild(buildAncestorDescendantSection(i));
  ui.tooltip.appendChild(buildExpandToggle(extendedSection));
  ui.tooltip.appendChild(extendedSection);

  placeTooltip(ui.tooltip, x, y, "above");
}

function artistColor(artist) {
  return getArtistDiscography(artist)[0]?.color ?? null;
}

function setPanelBorder(el, color) {
  el.style.border = color ? `1px solid ${color.getStyle()}` : "";
}

function showTooltipForPoint(i, x, y) {
  ui.tooltip.innerHTML = buildHoverPanelHTML(i);
  setPanelBorder(ui.tooltip, points[i].color);
  ui.tooltip.style.pointerEvents = "none";
  placeTooltip(ui.tooltip, x, y, "above");
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
    setPanelBorder(el, points[idx].color);

    const { x, y } = projectToScreen(mesh.position);
    placeTooltip(el, x, y, "above");
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
  resetNetworkInsightMode();
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

function resetAllFilters() {
  clearArtistPanels();      
  if (!hasActiveFilters()) return;
  activeFilters = { artists: new Set(), yearFrom: null, yearTo: null, descriptors: new Set(), query: "" };
  selectedGenres.clear();
  ui.search.value = "";
  hideTooltip();
  refreshFilterOptions();
  updateGenreLegendActiveState();
}

function resetNetworkInsightMode() {
  if (networkInsightMode === null) return;
  networkInsightMode = null;
  setFilterControlsEnabled(true);
  updateNetworkInsightButtons();
  updateFilterGenreVisuals();
}

function pointerClick(e) {
  if (e.target !== renderer.domElement) return;

  const dx = e.clientX - pointerDownX;
  const dy = e.clientY - pointerDownY;
  if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  raycaster.camera = camera
  const hit = raycaster.intersectObjects(getInteractivePointMeshes())[0];
  if (hit) {
    const additive = e.ctrlKey || e.metaKey;
    selectAlbum(hit.object.userData.index, additive);
    return;
  }

  const artistChainLines = connectionLines
    .filter(c => c.line.userData.isArtistChain)
    .map(c => c.line);
  const lineHit = artistChainLines.length
    ? raycaster.intersectObjects(artistChainLines)[0]
    : null;
  if (lineHit) {
    selectArtistLine(lineHit.object.userData.artist);
    return;
  }

  if (timeMode) {
    const yearHit = raycaster.intersectObjects([...orbitRings, ...yearSprites])[0];
    if (yearHit) {
      toggleYearHighlight(yearHit.object.userData.year, e.ctrlKey || e.metaKey);
      return;
    }
  }

  clearHighlight();
  clearGenreSelection();
  clearYearHighlight();
  clearArtistPanels();
  resetAllFilters();
  resetNetworkInsightMode();
}

function jumpToAlbum(a) {
  selectAlbum(a.idx, true);
}

function animate() {
  requestAnimationFrame(animate);
  tickAnimation();
  tickYearOpacity();
  tickCameraFocus();
  updateSelectionOutlines();
  updateGenreLabels();
  updateConnections();
  if (selectedIndices.size === 1) updatePinnedTooltipPosition();
  if (selectedIndices.size > 1) updateMultiSelectPanels();
  if (pinnedArtists.size > 0) updateArtistPanels();
  controls.update();
  updateYearPanels();
  updateEventLabels(); 
  updateGenreTags();
  renderer.render(scene,camera);
}

function getInteractivePointMeshes() {
  return pointMeshes.filter(m => isPointInteractive(m.userData.index));
}

function currentInsightTopSet() {
  return {
    bridges: bridgeTopIndices,
    hubs: hubTopIndices,
    outliers: outlierTopIndices,
    convergence: convergenceTopIndices,
    divergence: divergenceTopIndices
  }[networkInsightMode] ?? null;
}

function isPointInteractive(i) {
  const insightSet = currentInsightTopSet();
  const passesFilters = filteredIndices === null || filteredIndices.has(i);
  const passesInsight = insightSet === null || insightSet.has(i);
  const passesYear = selectedYears.size === 0 || selectedYears.has(points[i].year);
  if (passesFilters && passesInsight && passesYear) return true;

  return selectedIndices.has(i) || activeGraphIndices.has(i);
}

const WEIGHTS = {
  primaryBase: 1.0,
  secondaryBase: .55,
  secondaryDecay: .78
};

const MODEL_CONFIG = {
  descriptorWeight: 0.37,
  nNeighbors: 4.5,
  minDist: 0.65
};

const TIME_LAYOUT = {
  foldWeight: 0.35,
  totalHeight: 250
};

const ANIM_DURATION = 1400;

const POINT_RADIUS = .25;
const CAMERA_FOCUS_DURATION = 900;
const FOCUS_ZOOM_FACTOR = 0.4;
const OUTLINE_OFFSET_PX = 2;
const OUTLINE_THICKNESS_PX = 2;
const OUTLINE_SEGMENTS = 40;
const ORBIT_RING_IDLE_OPACITY = 0;
const GENRE_LABEL_CONFIG = {
  minAlbumsForLabel: 2,
  radiusPadding: 8,
  visibleOpacity: 1,
  fadeSpeed: 0.25,
  overlapScreenDist: 48
};

const GENRE_TAG_CONFIG = {
  maxTags: 8,                         
  scale: 0.85,                        
  minLightness: 0.55,                 
  offsetY: 0,                         
  overlapPx: { x: 100, y: 26 },       
  fadeSpeed: 0.2
};

const genreTagSprites = new Map();    
const genreTagAcc = new Map();        
const genreTagProjection = new THREE.Vector3();

const EVENT_LABEL_CONFIG = {
  gapBelowYear: 0.3, 
  fontSize: 20,      
  color: "#c4c4c4",
  maxCharsPerLine: 37,
  maxLines: 1,
  lineHeight: 24,    
  dimmedOpacity: 0.25,
  worldPerPixel: 0.05,
  canvasPadding: 8
};

const YEAR_LABEL_DEFAULT_TINT = 0xc4c4c4;
const YEAR_LABEL_FONT_PX = 26;
const ORBIT_RING_DEFAULT_COLOR = 0xc4c4c4;
const ORBIT_RING_SELECTED_COLOR = 0xffffff;
const ORBIT_RING_CONFIG = {
  coverage: 1,
  padding: 1.5,
  minRadius: 6
};
const CONNECTION_CONFIG = {
  sameArtistLineOpacity: 0.9,
  level1LineOpacity: 0.65,
  level2LineOpacity: 0.5,
  level1NodeOpacity: 0.65,
  level2NodeOpacity: 0.5,
  level1Count: 2,
  level2Count: 2,
  stageDelay: 220,      
  siblingStagger: 90,  
  fadeSpeed: 0.09,
  lineWidth: 3.2,
  dashSize: 0.35, 
  gapSize: 0.18,  
  originNodeOpacity: 1,
  ancestorOpacity: 0.8,
  descendantOpacity: 0.8,
  secondLevelOpacity: 0.65,
  showSecondLevel: false,
};

const NETWORK_INSIGHTS_CONFIG = {
  topCount: 30,
  dimOpacity: 0.15,
  outlierK: 5,
  minGenreSpread: 3,
  convergenceMinSpread: 2,     
  convergenceMinContributors: 3,
  divergenceMinSpread: 2,
  divergenceDescendants: 6
};

let networkInsightMode = null;
let bridgeBetweenness = null;
let bridgeTopIndices = new Set();
let nodeDegree = null;
let hubTopIndices = new Set();
let outlierScore = null;
let outlierTopIndices = new Set();
let convergenceScore = null;
let convergenceTopIndices = new Set();
let divergenceScore = null;
let divergenceTopIndices = new Set();

const ARROW_POSITION_T = 0.6; 
const connectionArrowDir = new THREE.Vector3();
const connectionArrowUp = new THREE.Vector3(0, 1, 0);

let timeMode = false;
let animating = false;
let animStart = 0;
let animFrom = [];
let animTo = [];
let timeCentroid = new THREE.Vector3(); 
let genreLabelsVisible = true;
let eventsByYear = new Map();
let selectedYears = new Set();


let yearPanelEl = null;
let cameraAnimating = false;
let cameraAnimStart = 0;
const cameraFromPos = new THREE.Vector3();
const cameraToPos = new THREE.Vector3();
const cameraFromTarget = new THREE.Vector3();
const cameraToTarget = new THREE.Vector3();
const YEAR_PANEL_TOP_GENRES = 3;    
const PERIOD_PANEL_TOP_GENRES = 5;  
const sidebarPanelEl = document.querySelector("#sidebar");
const aboutFabEl = document.querySelector("#aboutFab");
const aboutGroupEl = document.getElementById("aboutGroup");

let outlineRing = null;   
let outlineTarget = null; 
let pinnedIndex = null;

let connectionLines = [];     
let connectionNodeFades = []; 
let activeGraphIndices = new Set(); 
let hoverPreviewIndex = null;       

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

function coverBackgroundStyle(point) {
  const color = point.color.getStyle();
  return point.cover
    ? `background-color:${color};background-image:url('${point.cover}');background-size:cover;background-position:center;`
    : `background-color:${color};`;
}

function coverThumbHTML(point, sizePx) {
  return `<div class="cover-thumb" style="width:${sizePx}px;height:${sizePx}px;flex-shrink:0;border-radius:4px;${coverBackgroundStyle(point)}"></div>`;
}

function createCoverThumb(point, sizePx) {
  const div = document.createElement("div");
  div.className = "cover-thumb";
  div.style.cssText = `width:${sizePx}px;height:${sizePx}px;flex-shrink:0;border-radius:4px;${coverBackgroundStyle(point)}`;
  return div;
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
  clearScene();
  setLoadingProgress(20);

  const vocab = buildVocabulary(albums);
  const matrix = albums.map(a => vectorize(a, vocab, MODEL_CONFIG.descriptorWeight));
  setLoadingProgress(25);

  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(MODEL_CONFIG.nNeighbors, albums.length - 1),
    minDist: MODEL_CONFIG.minDist,
    spread: 1,
    random: mulberry32(UMAP_SEED)
  });

  const nEpochs = umap.initializeFit(matrix);
  for (let i = 0; i < nEpochs; i++) {
    umap.step();
    if (i % 5 === 0 || i === nEpochs - 1) {
      setLoadingProgress(25 + ((i + 1) / nEpochs) * 55);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const embedding = umap.getEmbedding();
  setLoadingProgress(80);

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
  createYearOrbits();
  createYearSprites();
  createEventLabels();
  createGenreLabels();
  computeNetworkMetrics();
  setLoadingProgress(92);

  if (timeMode) {
    orbitRings.forEach(r => {
      r.material.opacity = ORBIT_RING_IDLE_OPACITY;
      r.userData.targetOpacity = ORBIT_RING_IDLE_OPACITY;
    });
    pointMeshes.forEach((m,i) => m.position.copy(points[i].timeVec));
    yearSprites.forEach(s => {
      s.material.opacity = 1;
      s.userData.targetOpacity = 1;
    });
    orbitRings.forEach(r => {
      r.material.opacity = 0.05;
      r.userData.targetOpacity = 0.05;
    });
  }

  renderList();
  renderGenreLegend();
  refreshFilterOptions();
  fitCamera();
  setLoadingProgress(100);
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

  years.forEach(year => {
    const ring = orbitRings.find(r => r.userData.year === year);
    if (!ring) return;

    const y = ring.position.y;
    const x = timeCentroid.x;
    const z = timeCentroid.z;

    const sprite = makeYearSprite(String(year));
    sprite.position.set(x, y, z);
    sprite.material.opacity = 0;
    sprite.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
    sprite.userData.targetOpacity = 0;
    sprite.userData.year = year;
    root.add(sprite);
    yearSprites.push(sprite);
  });
}

function makeYearSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.font = `600 ${YEAR_LABEL_FONT_PX}px 'Bitcount Single'`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(16, 6, 1);
  return sprite;
}

function wrapEventText(text, maxChars, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  words.forEach(w => {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);

  const out = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    out[maxLines - 1] = out[maxLines - 1].replace(/[\s·.,;]+$/, "") + "…";
  }
  return out.map(l => l.length > maxChars + 1 ? l.slice(0, maxChars) + "…" : l);
}

function makeEventLabelSprite(text) {
  const cfg = EVENT_LABEL_CONFIG;
  const lines = wrapEventText(text, cfg.maxCharsPerLine, cfg.maxLines);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `${cfg.fontSize}px 'Oxanium'`;
  ctx.font = font;
  const textWidth = Math.max(...lines.map(l => ctx.measureText(l).width));

  canvas.width = Math.ceil(textWidth) + cfg.canvasPadding * 2;
  canvas.height = lines.length * cfg.lineHeight;
  text.toUpperCase(),
  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center"; 
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, cfg.lineHeight * (i + 0.5)); 
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  material.color.set(cfg.color);
  material.opacity = 0;

  const sprite = new THREE.Sprite(material);
  const w = canvas.width * cfg.worldPerPixel;
  const h = canvas.height * cfg.worldPerPixel;
  sprite.scale.set(w, h, 1);
  sprite.renderOrder = 5;
  sprite.visible = false;
  sprite.userData.halfWidth = w / 2;
  return sprite;
}

function createEventLabels() {
  eventsByYear.forEach((text, year) => {
    const ring = orbitRings.find(r => r.userData.year === year);
    if (!ring || !text) return;

    const sprite = makeEventLabelSprite(text);
    sprite.userData.year = year;
    sprite.userData.ring = ring;
    root.add(sprite);
    eventLabelSprites.push(sprite);
  });
}

function clearEventLabels() {
  eventLabelSprites.forEach(s => {
    s.material.map?.dispose();
    s.material.dispose();
    root.remove(s);
  });
  eventLabelSprites = [];
}

function updateEventLabels() {
  if (!eventLabelSprites.length) return;

  const yearsSelected = selectedYears.size > 0;
  const yearHalfHeight = YEAR_LABEL_FONT_PX * 0.0225;

  eventLabelSprites.forEach(s => {
    const { ring, year } = s.userData;

    s.position.set(
      ring.position.x,
      ring.position.y - yearHalfHeight - EVENT_LABEL_CONFIG.gapBelowYear - s.scale.y / 2,
      ring.position.z
    );

    let target = 0;
    if (timeMode) {
      target = (yearsSelected && !selectedYears.has(year))
        ? EVENT_LABEL_CONFIG.dimmedOpacity
        : 1;
    }
    s.material.opacity += (target - s.material.opacity) * 0.15;
    s.visible = s.material.opacity > 0.01;
  });
}
function updateEventLabelTints() {
  eventLabelSprites.forEach(s => {
    if (selectedYears.has(s.userData.year)) {
      s.material.color.copy(dominantGroupColor(s.userData.year));
    } else {
      s.material.color.set(EVENT_LABEL_CONFIG.color);
    }
  });
}

function createYearOrbits() {
  const byYear = new Map();
  points.forEach(p => {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year).push(p);
  });

byYear.forEach((group, year) => {
  const radii = group
    .map(p => Math.hypot(p.timeVec.x - timeCentroid.x, p.timeVec.z - timeCentroid.z))
    .sort((a, b) => a - b);

    const idx = Math.min(radii.length - 1, Math.ceil(radii.length * ORBIT_RING_CONFIG.coverage) - 1);
    const radius = Math.max(radii[idx] + ORBIT_RING_CONFIG.padding, ORBIT_RING_CONFIG.minRadius);

    const geo = new THREE.TorusGeometry(radius, 0.1, 8, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: ORBIT_RING_DEFAULT_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.raycast = () => {};  
    ring.userData.radius = radius;
    ring.rotation.x = Math.PI / 2;
    ring.position.set(timeCentroid.x, group[0].timeVec.y, timeCentroid.z);
    ring.userData.targetOpacity = 0;
    ring.userData.year = year;
    root.add(ring);
    orbitRings.push(ring);
  });
}

function getRangeYears() {
  const { yearFrom, yearTo } = activeFilters;
  if (yearFrom === null && yearTo === null) return null;
  return new Set(
    points.map(p => p.year).filter(y =>
      (yearFrom === null || y >= yearFrom) && (yearTo === null || y <= yearTo)
    )
  );
}

function syncRingsToRange() {
  if (!timeMode) return;
  const years = getRangeYears();
  if (years && years.size) {
    setYearSelection(years, { keepFilters: true, panelYears: new Set() });
  } else {
    clearYearHighlight();
  }
}

const groupLabelColorCache = new Map();
function colorForGroupLabel(group) {
  if (groupLabelColorCache.has(group)) return groupLabelColorCache.get(group);

  const families = GENRE_FAMILIES.filter(f => f.group === group);
  const c = new THREE.Color();

  if (!families.length) {
    c.setHSL(0, 0, 0.35);
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

  ctx.fillStyle = color.getStyle();
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

  const acc = new Map();

  points.forEach(p => {
    const genres = new Set([...p.genres.primary, ...p.genres.secondary]);
    const groupsForPoint = new Set(
      [...genres].map(g => cachedFamilyForGenre(g)?.group ?? "Otros")
    );

    groupsForPoint.forEach(group => {
      if (group === "Otros") return; 
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
    const sprite = makeGenreLabelSprite(d.genre, colorForGroupLabel(d.genre));
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

// ¿Hay algo aplicado? Un filtro que no restringe nada (ej. solo texto en la búsqueda) no cuenta
function hasTagContext() {
  return selectedIndices.size > 0
    || (filteredIndices !== null && filteredIndices.size < points.length)
    || networkInsightMode !== null
    || selectedYears.size > 0;
}

// Mismo criterio que updateFilterGenreVisuals; la selección de discos tiene prioridad
function isPointTagged(i) {
  if (selectedIndices.size > 0) return selectedIndices.has(i);
  const insightSet = currentInsightTopSet();
  return (filteredIndices === null || filteredIndices.has(i))
    && (insightSet === null || insightSet.has(i))
    && (selectedYears.size === 0 || selectedYears.has(points[i].year));
}

function getGenreTagEntry(genre) {
  let entry = genreTagSprites.get(genre);
  if (entry) return entry;

  const color = legendDotColor(genre);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL(hsl.h, hsl.s, Math.max(hsl.l, GENRE_TAG_CONFIG.minLightness));

  const sprite = makeGenreLabelSprite(genre, color);
  sprite.scale.multiplyScalar(GENRE_TAG_CONFIG.scale);
  sprite.material.depthTest = false;   // se lee por encima de los nodos
  sprite.material.opacity = 0;
  sprite.renderOrder = 6;
  sprite.visible = false;
  labelGroup.add(sprite);

  entry = { sprite, screenX: 0, screenY: 0 };
  genreTagSprites.set(genre, entry);
  return entry;
}

function updateGenreTags() {
  const cfg = GENRE_TAG_CONFIG;
  const active = timeMode && points.length > 0 && hasTagContext();

  // 1) Centroide en vivo (mesh.position) de los discos involucrados, por género primario
  genreTagAcc.forEach(acc => { acc.count = 0; acc.sum.set(0, 0, 0); });
  if (active) {
    for (let i = 0; i < points.length; i++) {
      if (!isPointTagged(i)) continue;
      const mesh = pointMeshes[i];
      if (!mesh) continue;
      points[i].genres.primary.forEach(g => {
        let acc = genreTagAcc.get(g);
        if (!acc) {
          acc = { sum: new THREE.Vector3(), count: 0 };
          genreTagAcc.set(g, acc);
        }
        acc.sum.add(mesh.position);
        acc.count += 1;
      });
    }
  }

  // 2) Prioridad: los géneros con más discos involucrados
  const ranked = [...genreTagAcc.entries()]
    .filter(([, acc]) => acc.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, cfg.maxTags);

  // 3) Posición, proyección y descarte por solapamiento
  const shown = new Set();
  const kept = [];
  ranked.forEach(([genre, acc]) => {
    const entry = getGenreTagEntry(genre);
    entry.sprite.position.copy(acc.sum).divideScalar(acc.count);
    entry.sprite.position.y += cfg.offsetY;

    genreTagProjection.copy(entry.sprite.position).project(camera);
    const behind = genreTagProjection.z > 1 || genreTagProjection.z < -1;
    entry.screenX = (genreTagProjection.x * 0.5 + 0.5) * innerWidth;
    entry.screenY = (-genreTagProjection.y * 0.5 + 0.5) * innerHeight;

    const overlaps = behind || kept.some(k =>
      Math.abs(entry.screenX - k.screenX) < cfg.overlapPx.x &&
      Math.abs(entry.screenY - k.screenY) < cfg.overlapPx.y
    );
    if (!overlaps) {
      kept.push(entry);
      shown.add(genre);
    }
  });

  // 4) Fade
  genreTagSprites.forEach((entry, genre) => {
    const m = entry.sprite.material;
    m.opacity += ((shown.has(genre) ? 1 : 0) - m.opacity) * cfg.fadeSpeed;
    entry.sprite.visible = m.opacity > 0.01;
  });
}

function clearGenreTags() {
  genreTagSprites.forEach(({ sprite }) => {
    sprite.material.map?.dispose();
    sprite.material.dispose();
    labelGroup.remove(sprite);
  });
  genreTagSprites.clear();
  genreTagAcc.clear();
}

function setGenreLabelsVisible(on) {
  genreLabelsVisible = on;
}

function setTimeMode(on) {
  timeMode = on;
  syncModeButtons(on ? "cronologico" : "exploratorio");
  if (!pointMeshes.length) return;

  animFrom = pointMeshes.map(m => m.position.clone());
  animTo = points.map(p => timeMode ? p.timeVec : p.umapVec);
  animStart = performance.now();
  animating = true;

  yearSprites.forEach(s => { s.userData.targetOpacity = timeMode ? 1 : 0; });
  orbitRings.forEach(r => { r.userData.targetOpacity = timeMode ? ORBIT_RING_IDLE_OPACITY : 0; });

  if (timeMode) syncRingsToRange();
  else clearYearHighlight();
}

document.addEventListener("modechange", (e) => {
  setTimeMode(e.detail.mode === "cronologico");
});

function tickAnimation() {
  if (!animating) return;

  const t = Math.min((performance.now() - animStart) / ANIM_DURATION, 1);
  const eased = easeInOutCubic(t);

  pointMeshes.forEach((m,i) => {
    m.position.lerpVectors(animFrom[i], animTo[i], eased);
  });

  if (t >= 1) animating = false;
}

function tickYearOpacity() {
  yearSprites.forEach(s => {
    const target = s.userData.targetOpacity ?? 0;
    s.material.opacity += (target - s.material.opacity) * 0.15;
  });
  orbitRings.forEach(r => {
    const target = r.userData.targetOpacity ?? 0;
    r.material.opacity += (target - r.material.opacity) * 0.15;
  });
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
  const visible = genresInGroup.filter(isGenreVisibleInLegend);
  if (!visible.length) return;
  const allSelected = visible.every(g => selectedGenres.has(g));

  if (allSelected) {
    visible.forEach(g => selectedGenres.delete(g));
  } else {
    visible.forEach(g => selectedGenres.add(g));
  }

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
  const insightActive = networkInsightMode !== null;
  const yearsActive = selectedYears.size > 0;
  const insightTopSet = insightActive ? currentInsightTopSet() : null;

  if (!filtersActive && !genresActive && !insightActive && !yearsActive) {
    pointMeshes.forEach(m => { m.material.opacity = 1; });
    return;
  }

  const dimOpacity = filtersActive ? 0.12 : (insightActive ? NETWORK_INSIGHTS_CONFIG.dimOpacity : 0.25);

  pointMeshes.forEach((m, i) => {
    const p = points[i];
    const passesFilter = !filtersActive || filteredIndices.has(i);
    const passesGenre = !genresActive ||
      p.genres.primary.some(g => selectedGenres.has(g)) ||
      p.genres.secondary.some(g => selectedGenres.has(g));
    const passesInsight = !insightActive || insightTopSet.has(i);
    const passesYear = !yearsActive || selectedYears.has(p.year);

    m.material.opacity = (passesFilter && passesGenre && passesInsight && passesYear) ? 1 : dimOpacity;
  });
}

function ensureGenreLegendToggleAllBtn() {
  const btn = ui.genreLegendToggleAll;
  if (!btn || btn.dataset.bound) return btn;

  btn.dataset.bound = "1";
  btn.addEventListener("click", e => {
    e.preventDefault();   // evita que el click también pliegue el acordeón
    e.stopPropagation();
    toggleAllGenreGroups();
  });
  return btn;
}

function getVisibleGenreGroups() {
  return [...genreLegendGroups.entries()].filter(([, data]) => data.titleEl.style.display !== "none");
}

function toggleAllGenreGroups() {
  const visible = getVisibleGenreGroups();
  if (!visible.length) return;
 
  const allExpanded = visible.every(([group]) => expandedGenreGroups.has(group));
  const shouldExpand = !allExpanded;
 
  visible.forEach(([group, data]) => {
    if (shouldExpand) {
      expandedGenreGroups.add(group);
    } else {
      expandedGenreGroups.delete(group);
    }
    data.titleEl.classList.toggle("is-expanded", shouldExpand);
    data.itemsContainerEl.style.display = shouldExpand ? "block" : "none";
  });
 
  updateGenreLegendToggleAllLabel();
}

function updateGenreLegendToggleAllLabel() {
  const btn = ui.genreLegendToggleAll;
  if (!btn) return;
  const visible = getVisibleGenreGroups();
  const allExpanded = visible.length > 0 && visible.every(([group]) => expandedGenreGroups.has(group));
  btn.textContent = allExpanded ? "Colapsar todo" : "Expandir todo";
}

function setFilterControlsEnabled(enabled) {
  [ui.search, ui.filterYearFrom, ui.filterYearTo, ui.filterDescriptor].forEach(el => {
    if (!el) return;
    el.disabled = !enabled;
  });
  if (ui.genreLegend) {
    ui.genreLegend.style.pointerEvents = enabled ? "auto" : "none";
    ui.genreLegend.style.opacity = enabled ? "1" : "0.4";
  }
}

function addArtistFilter(artist) {
  if (networkInsightMode !== null) return; // insight activo: no se permiten nuevos filtros
  activeFilters.artists.add(artist);
  refreshFilterOptions();
}

function setNetworkInsightMode(mode) {
  networkInsightMode = (networkInsightMode === mode) ? null : mode;

  if (networkInsightMode !== null && hasActiveFilters()) {
    activeFilters = { artists: new Set(), yearFrom: null, yearTo: null, descriptors: new Set(), query: "" };
    selectedGenres.clear();
    ui.search.value = "";
    filteredIndices = null;
    clearArtistPanels();
    renderList();
    refreshFilterOptions();
  }

  setFilterControlsEnabled(networkInsightMode === null);
  updateNetworkInsightButtons();
  if (selectedIndices.size === 0) updateFilterGenreVisuals();
}

function createNetworkInsightsToggle() {
  const container = document.querySelector("#networkInsights");
  if (!container) return null;
  container.textContent = "";
 
  const modes = [
    { mode: "hubs", label: "Hubs" },
    { mode: "bridges", label: "Bridges" },
    { mode: "outliers", label: "Outliers" },
    { mode: "convergence", label: "Convergentes" },
    { mode: "divergence", label: "Divergentes" }
  ];
 
  modes.forEach(({ mode, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = `${mode}Toggle`;
    btn.className = "sidebar_radio";
    btn.dataset.mode = mode;
    btn.setAttribute("aria-pressed", "false");
 
    const mark = document.createElement("span");
    mark.className = "sidebar_radio-mark";
    mark.setAttribute("aria-hidden", "true");
 
    const text = document.createElement("span");
    text.textContent = label;
 
    btn.appendChild(mark);
    btn.appendChild(text);
    btn.addEventListener("click", () => setNetworkInsightMode(mode));
    container.appendChild(btn);
  });
 
  return container;
}
 
function updateNetworkInsightButtons() {
  ["hubs", "bridges", "outliers", "convergence", "divergence"].forEach(mode => {
    const btn = document.querySelector(`#${mode}Toggle`);
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(networkInsightMode === mode));
  });
}

function updateFilterArtistConnections() {
  clearConnections();
  if (activeFilters.artists.size === 0) return;

  activeFilters.artists.forEach(artist => {
    const originPoint = points.find(p => p.artist === artist);
    if (!originPoint) return;
    buildArtistChainConnections(originPoint.idx);
  });
}

function applyFilterMapVisuals() {
  if (selectedIndices.size > 0) return; 

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
    title.className = "sidebar_tree-item" + (isExpanded ? " is-expanded" : "");
 
    const selectArea = document.createElement("span");
    selectArea.className = "sidebar_tree-select";
 
    const groupBox = document.createElement("input");
    groupBox.type = "checkbox";
    groupBox.className = "sidebar_checkbox";
    groupBox.setAttribute("aria-label", `Seleccionar todos los géneros de ${group}`);
    groupBox.addEventListener("click", e => {
      e.stopPropagation();
      toggleGenreGroupSelection(groupGenres);
    });
 
    const swatch = document.createElement("i");
    swatch.className = "sidebar_dot";
    swatch.style.background = colorForGroup(group).getStyle();
 
    const label = document.createElement("span");
    label.className = "sidebar_tree-label";
    label.textContent = group;
 
    selectArea.appendChild(groupBox);
    selectArea.appendChild(swatch);
    selectArea.appendChild(label);
 
    const arrow = document.createElement("span");
    arrow.className = "sidebar_tree-caret";
    arrow.setAttribute("aria-hidden", "true");
 
    title.appendChild(selectArea);
    title.appendChild(arrow);
 
    const itemsContainer = document.createElement("div");
    itemsContainer.style.display = isExpanded ? "block" : "none";
 
    const list = document.createElement("div");
    list.className = "sidebar_checkbox-list";
    itemsContainer.appendChild(list);
 
    title.addEventListener("click", () => {
      const nowExpanded = !expandedGenreGroups.has(group);
      if (nowExpanded) {
        expandedGenreGroups.add(group);
      } else {
        expandedGenreGroups.delete(group);
      }
      title.classList.toggle("is-expanded", nowExpanded);
      itemsContainer.style.display = nowExpanded ? "block" : "none";
      updateGenreLegendToggleAllLabel();
    });
 
    frag.appendChild(title);
 
    groupGenres.forEach(g => {
      const item = document.createElement("div");
      item.className = "sidebar_checkbox-item";
      item.dataset.genre = g;
 
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "sidebar_checkbox";
      box.setAttribute("aria-label", g);
 
      const dot = document.createElement("i");
      dot.className = "sidebar_dot";
      dot.style.background = legendDotColor(g).getStyle();
 
      const itemLabel = document.createElement("span");
      itemLabel.className = "sidebar_checkbox-text";
      itemLabel.textContent = g;
 
      item.appendChild(box);
      item.appendChild(dot);
      item.appendChild(itemLabel);
 
      item.addEventListener("click", () => toggleGenreHighlight(g));
 
      genreLegendItemsByGenre.set(g, item);
      list.appendChild(item);
    });
 
    frag.appendChild(itemsContainer);
 
    genreLegendGroups.set(group, {
      titleEl: title,
      arrowEl: arrow,
      checkboxEl: groupBox,
      itemsContainerEl: itemsContainer,
      genres: groupGenres
    });
  });
 
  ui.genreLegend.textContent = "";
  ui.genreLegend.appendChild(frag);
 
  updateGenreLegendActiveState();
  updateGenreTreeVisibility();
  ensureGenreLegendToggleAllBtn();
  updateGenreLegendToggleAllLabel();
}
 
function updateGenreLegendActiveState() {
  const anySelected = selectedGenres.size > 0;
 
  genreLegendItemsByGenre.forEach((el, g) => {
    const active = selectedGenres.has(g);
    el.classList.toggle("active", active);
 
    const box = el.querySelector(".sidebar_checkbox");
    if (box) box.checked = active;
 
    // Los no seleccionados se atenúan solo si ya hay alguna selección
    const text = el.querySelector(".sidebar_checkbox-text");
    if (text) text.classList.toggle("sidebar_checkbox-unchecked", anySelected && !active);
  });
 
  genreLegendGroups.forEach(data => {
    const visible = data.genres.filter(isGenreVisibleInLegend);
    const selectedCount = visible.filter(g => selectedGenres.has(g)).length;
    const allSelected = selectedCount > 0 && selectedCount === visible.length;
    const partial = selectedCount > 0 && !allSelected;
 
    data.checkboxEl.checked = allSelected;
    data.checkboxEl.indeterminate = partial;
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
  updateGenreLegendToggleAllLabel();
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
if (filters.artists && filters.artists.size > 0 && !filters.artists.has(p.artist)) return false;  if (filters.yearFrom !== null && p.year < filters.yearFrom) return false;
  if (filters.yearTo !== null && p.year > filters.yearTo) return false;
    if (filters.descriptors && filters.descriptors.size > 0 &&
      ![...filters.descriptors].every(d => p.descriptors.includes(d))) return false;
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
return activeFilters.artists.size > 0
    || activeFilters.yearFrom !== null
    || activeFilters.yearFrom !== null
    || activeFilters.yearTo !== null
    || activeFilters.descriptors.size > 0
    || Boolean(activeFilters.query && activeFilters.query.trim() !== "")
    || selectedGenres.size > 0;
}

function getFilteredPoints(excludeKey) {
  const filters = currentFilters();
   if (excludeKey === 'year') { filters.yearFrom = null; filters.yearTo = null; }
   else if (excludeKey === 'descriptor') { filters.descriptors = new Set(); }
   else if (excludeKey === 'genres') { filters.genres = new Set(); }
   else if (excludeKey) { filters[excludeKey] = null; }
  return points.filter(p => pointMatchesFilters(p, filters));
}

function populateSelectOptions(selectEl, values, placeholder, currentValue) {
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
  syncRingsToRange();
}

function pruneInvalidSelections() {
  if (networkInsightMode !== null) return;

  if (activeFilters.descriptors.size) {
    const base = {
      artists: activeFilters.artists,
      yearFrom: activeFilters.yearFrom,
      yearTo: activeFilters.yearTo
    };
    let pool = points.filter(p => pointMatchesFilters(p, base));
    const kept = new Set();
    activeFilters.descriptors.forEach(d => {
      const next = pool.filter(p => p.descriptors.includes(d));
      if (next.length) { kept.add(d); pool = next; }
    });
    activeFilters.descriptors = kept;
  }

  if (selectedGenres.size) {
    const filters = { ...currentFilters(), genres: new Set(), query: "" };
    const valid = new Set(
      points.filter(p => pointMatchesFilters(p, filters)).flatMap(p => p.genres.primary)
    );
    [...selectedGenres].forEach(g => { if (!valid.has(g)) selectedGenres.delete(g); });
  }
}

function refreshFilterOptions() {
  pruneInvalidSelections();

  const descriptorPool = getFilteredPoints();
  const yearPool = getFilteredPoints('year');

  const availableDescriptors = [...new Set(descriptorPool.flatMap(p => p.descriptors))]
    .filter(d => !activeFilters.descriptors.has(d))
    .sort();

  populateSelectOptions(
    ui.filterDescriptor,
    availableDescriptors,
    activeFilters.descriptors.size ? "Agregar otro descriptor…" : "Descriptor (todos)",
    null
  );

  const years = [...new Set(yearPool.map(p => p.year))].sort((a, b) => a - b);
  const { yearFrom, yearTo } = activeFilters;
  populateSelectOptions(
    ui.filterYearFrom,
    yearTo !== null ? years.filter(y => y <= yearTo) : years,
    "Desde",
    yearFrom
  );
  populateSelectOptions(
    ui.filterYearTo,
    yearFrom !== null ? years.filter(y => y >= yearFrom) : years,
    "Hasta",
    yearTo
  );

  ui.filtersClear.style.display = hasActiveFilters() ? "inline-block" : "none";

  applyFilters();
  updateGenreTreeVisibility();
  updateGenreLegendActiveState();
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
  if (e.target.value) activeFilters.descriptors.add(e.target.value);
  refreshFilterOptions(); // vuelve el select al placeholder y regenera las opciones
});

ui.filtersClear.addEventListener("click", () => resetAllFilters());

function renderList() {
  const toRender = filteredIndices === null ? points : points.filter(p => filteredIndices.has(p.idx));
  const frag = document.createDocumentFragment();
  toRender.forEach(a => frag.appendChild(buildAlbumRow(a)));
  ui.list.textContent = "";
  ui.list.appendChild(frag);
  document.querySelector("#count").textContent = `(${toRender.length} discos)`;
}

const MAX_SUGGESTIONS_PER_GROUP = 6;
let currentSuggestions = []; 
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


function buildNetworkGraphAdjacency() {
  const adjacency = new Map();
  points.forEach((_, i) => adjacency.set(i, new Set()));

  const addEdge = (a, b) => {
    if (a == null || b == null || a === b) return;
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };

  // Fuente 1: cadena cronológica por artista (idéntica a buildArtistChainConnections)
  const artists = new Set(points.map(p => p.artist));
  artists.forEach(artist => {
    const discog = getArtistDiscography(artist);
    for (let i = 0; i < discog.length - 1; i++) {
      addEdge(discog[i].idx, discog[i + 1].idx);
    }
  });

  points.forEach((p, idx) => {
    const { ancestor, descendants, secondLevel } = computeAncestorDescendants(idx);
    if (ancestor) addEdge(ancestor.idx, idx);
    descendants.forEach((d, i) => {
      addEdge(idx, d.idx);
      const level2 = secondLevel[i];
      if (level2) addEdge(d.idx, level2.idx);
    });
  });

  return adjacency;
}

function brandesBetweenness(adjacency, n) {
  const betweenness = new Map();
  for (let i = 0; i < n; i++) betweenness.set(i, 0);

  for (let s = 0; s < n; s++) {
    const stack = [];
    const predecessors = Array.from({ length: n }, () => []);
    const sigma = new Array(n).fill(0);
    const dist = new Array(n).fill(-1);
    sigma[s] = 1;
    dist[s] = 0;

    const queue = [s];
    let qi = 0;
    while (qi < queue.length) {
      const v = queue[qi++];
      stack.push(v);
      adjacency.get(v).forEach(w => {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          predecessors[w].push(v);
        }
      });
    }

    const delta = new Array(n).fill(0);
    while (stack.length) {
      const w = stack.pop();
      predecessors[w].forEach(v => {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      });
      if (w !== s) betweenness.set(w, betweenness.get(w) + delta[w]);
    }
  }

  for (let i = 0; i < n; i++) betweenness.set(i, betweenness.get(i) / 2);

  return betweenness;
}

function computeNetworkMetrics() {
  if (!points.length) return;

  const adjacency = buildNetworkGraphAdjacency();

  nodeDegree = new Map();
  adjacency.forEach((neighbors, idx) => nodeDegree.set(idx, neighbors.size));
  hubTopIndices = new Set(
    points.map((_, i) => i)
      .filter(i => (nodeDegree.get(i) ?? 0) > 0)
      .sort((a, b) => nodeDegree.get(b) - nodeDegree.get(a))
      .slice(0, NETWORK_INSIGHTS_CONFIG.topCount)
  );

  bridgeBetweenness = brandesBetweenness(adjacency, points.length);
  bridgeTopIndices = new Set(
    points.map((_, i) => i)
      .filter(i => (bridgeBetweenness.get(i) ?? 0) > 0)
      .sort((a, b) => bridgeBetweenness.get(b) - bridgeBetweenness.get(a))
      .slice(0, NETWORK_INSIGHTS_CONFIG.topCount)
  );

  outlierScore = computeOutlierScores();
  outlierTopIndices = new Set(
    points.map((_, i) => i)
      .sort((a, b) => outlierScore.get(b) - outlierScore.get(a))
      .slice(0, NETWORK_INSIGHTS_CONFIG.topCount)
  );

  const { convergence, divergence } = computeConvergenceDivergence();
  convergenceScore = convergence;
  divergenceScore = divergence;

  convergenceTopIndices = new Set(
    points.map((_, i) => i)
      .filter(i => convergenceScore.get(i) >= NETWORK_INSIGHTS_CONFIG.convergenceMinSpread)
      .sort((a, b) => convergenceScore.get(b) - convergenceScore.get(a))
      .slice(0, NETWORK_INSIGHTS_CONFIG.topCount)
  );

  divergenceTopIndices = new Set(
    points.map((_, i) => i)
      .filter(i => divergenceScore.get(i) >= NETWORK_INSIGHTS_CONFIG.divergenceMinSpread)
      .sort((a, b) => divergenceScore.get(b) - divergenceScore.get(a))
      .slice(0, NETWORK_INSIGHTS_CONFIG.topCount)
  );
}

function isGenreVisibleInLegend(g) {
  const el = genreLegendItemsByGenre.get(g);
  return Boolean(el) && el.style.display !== "none";
}

function computeOutlierScores() {
  const scores = new Map();
  points.forEach((p, i) => {
    const dists = points
      .filter((_, j) => j !== i)
      .map(q => p.umapVec.distanceTo(q.umapVec))
      .sort((a, b) => a - b)
      .slice(0, NETWORK_INSIGHTS_CONFIG.outlierK);
    scores.set(i, dists.length ? average(dists) : 0);
  });
  return scores;
}

function computeConvergenceDivergence() {
  const convergenceCounts = new Map();
  const divergenceCounts = new Map();
  points.forEach((_, i) => {
    convergenceCounts.set(i, new Map());
    divergenceCounts.set(i, new Map());
  });

  points.forEach((p, idx) => {
    const { ancestor } = computeAncestorDescendants(idx);
    if (ancestor) bumpCount(convergenceCounts.get(ancestor.idx), primaryGenreOf(p));

    computeDescendantsOnly(idx, NETWORK_INSIGHTS_CONFIG.divergenceDescendants)
      .forEach(d => bumpCount(divergenceCounts.get(idx), primaryGenreOf(d)));
  });

  const convergence = new Map();
  const divergence = new Map();
  points.forEach((_, i) => {
    const cc = convergenceCounts.get(i);
    const contributors = [...cc.values()].reduce((s, n) => s + n, 0);
    convergence.set(
      i,
      contributors >= NETWORK_INSIGHTS_CONFIG.convergenceMinContributors ? effectiveGenres(cc) : 0
    );
    divergence.set(i, effectiveGenres(divergenceCounts.get(i)));
  });

  return { convergence, divergence };
}

function primaryGenreOf(p) {
  return p.genres.primary[0] ?? "Sin género";
}

function effectiveGenres(counts) {
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let h = 0;
  counts.forEach(n => {
    const p = n / total;
    h -= p * Math.log(p);
  });
  return Math.exp(h);
}

function bumpCount(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function computeDescendantsOnly(idx, k) {
  const origin = points[idx];
  const seenArtists = new Set();
  return points
    .filter(p => p.idx !== idx && p.artist !== origin.artist && p.year > origin.year)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)
    .reduce((acc, { p }) => {
      if (acc.length >= k || seenArtists.has(p.artist)) return acc;
      seenArtists.add(p.artist);
      acc.push(p);
      return acc;
    }, []);
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

  if (!ui.searchResults) return; 

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

  activeFilters.query = "";

if (entry.type === "artist") {
    clearHighlight();               
    addArtistFilter(entry.value);
    ui.search.value = "";
    closeTypeahead();
    refreshFilterOptions();
    selectArtistLine(entry.value);  
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
    .filter((p, i) => i !== idx && p.artist)
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

const artistFirstYear = getArtistDiscography(origin.artist)[0]?.year ?? origin.year;

const ancestor = others
    .filter(p => p.year <= artistFirstYear)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)[0]?.p ?? null;

  const usedDescendantArtists = new Set();
  const descendants = others

    .filter(p => p.year > origin.year)
    .map(p => ({ p, d: p.umapVec.distanceTo(origin.umapVec) }))
    .sort((a, b) => a.d - b.d)
    .reduce((acc, entry) => {
      if (acc.length >= 3) return acc;
      if (usedDescendantArtists.has(entry.p.artist)) return acc;
      usedDescendantArtists.add(entry.p.artist);
      acc.push(entry.p);
      return acc;
    }, []);

  const usedArtists = new Set([
    origin.artist,
    ancestor?.artist,
    ...descendants.map(d => d.artist)
  ].filter(Boolean));

const secondLevel = descendants.map(d => {
    const candidates = points.filter(p =>
      p.idx !== d.idx &&
      !usedArtists.has(p.artist) &&
      p.year > d.year
    );
    const nearest = candidates
      .map(p => ({ p, dist: p.umapVec.distanceTo(d.umapVec) }))
      .sort((a, b) => a.dist - b.dist)[0]?.p ?? null;

    if (nearest) usedArtists.add(nearest.artist);
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
    if (level2 && CONNECTION_CONFIG.showSecondLevel) { 
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
    linewidth: lineWidth,
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
  shape.moveTo(0, height / 2);            
  shape.lineTo(-halfWidth, -height / 2);  
  shape.lineTo(halfWidth, -height / 2);  
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function addConnection(fromMesh, toMesh, colorHex, targetOpacity, dashed, appearAt, lineWidth, withArrow = false, meta = null) {
  const line = createConnectionLine(colorHex, dashed, lineWidth);
  line.userData.targetOpacity = targetOpacity;
  line.userData.appearAt = appearAt;
  line.userData.dashed = dashed;
  if (meta) Object.assign(line.userData, meta);
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
      CONNECTION_CONFIG.lineWidth,
      false,
      { isArtistChain: true, artist: origin.artist }
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
  if (!ui.selectedChips) ui.selectedChips = document.querySelector("#selectedChips");
  return ui.selectedChips;
}

function buildChip({ color = null, text, ariaLabel, onRemove }) {
  const chip = document.createElement("span");
  chip.className = "sidebar_chips";
 
  if (color) {
    const dot = document.createElement("i");
    dot.className = "sidebar_dot sidebar_dot--lg";
    dot.style.background = color;
    chip.appendChild(dot);
  }
 
  const label = document.createElement("span");
  label.className = "sidebar_chips-label";
  label.textContent = text;
 
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sidebar_chips-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", ariaLabel);
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    onRemove();
  });
 
  chip.appendChild(label);
  chip.appendChild(closeBtn);
  return chip;
}

function renderSelectedChips() {
  const container = ensureSelectedChipsContainer();
  container.textContent = "";
 
  renderFilterChipsInto(container);
 
  [...selectedIndices].forEach(idx => {
    const point = points[idx];
    if (!point) return;
    container.appendChild(buildChip({
      color: point.color.getStyle(),
      text: point.album,
      ariaLabel: `Quitar ${point.album}`,
      onRemove: () => {
        selectedIndices.delete(idx);
        applySelection();
      }
    }));
  });
 
  container.hidden = container.childElementCount === 0;
 
  const descContainer = document.querySelector("#descriptorChips");
  if (descContainer) {
    descContainer.textContent = "";
    activeFilters.descriptors.forEach(d => {
      descContainer.appendChild(buildChip({
        text: d,
        ariaLabel: `Quitar descriptor ${d}`,
        onRemove: () => {
          activeFilters.descriptors.delete(d);
          refreshFilterOptions();
          updateGenreLegendActiveState();
        }
      }));
    });
    descContainer.hidden = descContainer.childElementCount === 0;
  }
}

function renderFilterChipsInto(container) {
  activeFilters.artists.forEach(artist => {
    const discog = getArtistDiscography(artist);
    container.appendChild(buildChip({
      color: discog.length ? discog[0].color.getStyle() : "#ccc",
      text: artist,
      ariaLabel: `Quitar filtro de artista ${artist}`,
      onRemove: () => {
        removeArtistFilter(artist);
        activeFilters.artists.delete(artist);
        unpinArtist(artist);
        refreshFilterOptions();
        updateGenreLegendActiveState();
      }
    }));
  });
 
  const defs = [
    { active: () => activeFilters.yearFrom !== null || activeFilters.yearTo !== null,
      label: () => `Año: ${activeFilters.yearFrom ?? "…"}–${activeFilters.yearTo ?? "…"}`,
      clear: () => { activeFilters.yearFrom = null; activeFilters.yearTo = null; } },
    { active: () => Boolean(activeFilters.query && activeFilters.query.trim() !== ""),
      label: () => `Búsqueda: "${activeFilters.query}"`,
      clear: () => { activeFilters.query = ""; ui.search.value = ""; } },
    { active: () => selectedGenres.size > 0,
      label: () => `Géneros: ${selectedGenres.size}`,
      clear: () => { selectedGenres.clear(); } }
  ];
 
  defs.forEach(def => {
    if (!def.active()) return;
    container.appendChild(buildChip({
      text: def.label(),
      ariaLabel: "Quitar filtro",
      onRemove: () => {
        def.clear();
        refreshFilterOptions();
        updateGenreLegendActiveState();
      }
    }));
  });
}

function applySelection() {
  clearArtistPanels();
  clearYearHighlight({ keepSelection: true });
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
    buildAncestorDescendantGraph(idx);
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
  focusCameraOn(mesh.position);
}

function focusCameraOn(targetPos, fitRadius = 0) {
  const currentDistance = camera.position.distanceTo(controls.target);

  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fitDistance = fitRadius > 0
    ? (fitRadius * 1.3) / Math.sin(Math.min(vFov, hFov) / 2)
    : 0;

  const desiredDistance = THREE.MathUtils.clamp(
    Math.max(currentDistance * FOCUS_ZOOM_FACTOR, fitDistance),
    controls.minDistance + 2,
    controls.maxDistance
  );

  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
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
      depthWrite: false
    })
  );
  outlineRing.renderOrder = 10;
  outlineRing.visible = false;
  root.add(outlineRing);
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

const INITIAL_CAMERA = {
  offsetX: 0.2,
  offsetY: 0.35,
  distanceFactor: 0.75,   
  minDistance: 60    
};

function fitCamera(useTimeLayout = timeMode) {
  if (!points.length) return;
  const box = new THREE.Box3();
  points.forEach(p => box.expandByPoint(useTimeLayout ? p.timeVec : p.umapVec));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const distance = Math.max(size.length() * INITIAL_CAMERA.distanceFactor, INITIAL_CAMERA.minDistance);

  cameraAnimating = false;  
  controls.target.copy(center);
  camera.position.set(
    center.x + size.x * INITIAL_CAMERA.offsetX,
    center.y + size.y * INITIAL_CAMERA.offsetY,
    center.z + distance
  );
  controls.update();
}

function hideTooltip() {
  ui.tooltip.style.display = "none";
}

function buildNearestRow(p, opts = {}) {
  const { showYear = false } = opts;
  const row = document.createElement("div");
  row.className = "nearest-row";
  row.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 0;cursor:pointer;font-weight:bolder;letter-spacing:.1px;line-height:1;";

  const dot = document.createElement("i");
  dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${p.color.getStyle()};`

  const text = document.createElement("span");
  text.style.fontSize = "12px";
  text.textContent = showYear
    ? `${p.album} — ${p.artist} · ${p.year}`
    : `${p.album} — ${p.artist}`;

  row.appendChild(dot);
  row.appendChild(text);
  row.addEventListener("mouseenter", () => { row.style.color = "#56CCF2"; });
  row.addEventListener("mouseleave", () => { row.style.color = "#d3d3d3"; });
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
  if (pinnedIndex === null || hoverPreviewIndex !== null) return;
  const mesh = pointMeshes[pinnedIndex];
  if (!mesh) return;
  const { x, y } = projectToScreen(mesh.position);
  placeTooltip(ui.tooltip, x, y, "above");
}

function computeArtistStats(artist) {
  const discog = getArtistDiscography(artist);
  if (!discog.length) return null;

  const primaryCounts = new Map();
  const secondaryCounts = new Map();

  discog.forEach(a => {
    a.genres.primary.forEach(g => primaryCounts.set(g, (primaryCounts.get(g) ?? 0) + 1));
    a.genres.secondary.forEach(g => secondaryCounts.set(g, (secondaryCounts.get(g) ?? 0) + 1));
  });

  const dominant = (counts) => {
    if (!counts.size) return [];
    const max = Math.max(...counts.values());
    return [...counts.entries()].filter(([, c]) => c === max).map(([g]) => g);
  };

  return {
    artist,
    primaryGenres: dominant(primaryCounts),
    secondaryGenres: dominant(secondaryCounts),
    firstYear: discog[0].year,
    lastYear: discog[discog.length - 1].year
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
function dominantGroupColor(year) {
  const top = computeYearGenreStats(year).groups[0];
  return top ? colorForGroup(top.genre) : new THREE.Color(ORBIT_RING_SELECTED_COLOR);
}

 function computePeriodGenreStats(years) {
  const albumsInPeriod = points.filter(p => years.has(p.year));
  const total = albumsInPeriod.length;
  const groupCounts = new Map();
 
  albumsInPeriod.forEach(a => {
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
 
  return { total, albums: albumsInPeriod, groups };
}
 
function computeYearGenreStats(year) {
  return { year, ...computePeriodGenreStats(new Set([year])) };
}
 
function periodLabel(years) {
  const list = [...years];
  const min = Math.min(...list);
  const max = Math.max(...list);
  return min === max ? `${min}` : `${min} - ${max}`;
}
 
function toggleYearHighlight(year, additive = false) {
  let next;
  if (additive) {
    next = new Set(selectedYears);
    if (next.has(year)) next.delete(year); else next.add(year);
  } else {
    next = (selectedYears.size === 1 && selectedYears.has(year))
      ? new Set()
      : new Set([year]);
  }

  setYearSelection(next, {
    keepFilters: selectedYears.size > 0 || getRangeYears() !== null,
    focus: true   
  });
}
 
function setYearSelection(years, { keepFilters = false, showPanel = true, focus = false } = {}) {
  if (years.size === 0) { clearYearHighlight(); return; }

  selectedYears = new Set();
  clearHighlight();
  if (!keepFilters) clearGenreSelection();

  selectedYears = years;
  applyYearVisuals();
  if (showPanel) syncYearPanels(); else clearYearPanels();

  if (focus) focusCameraOnYears(years);
}

function clearYearHighlight({ keepSelection = false } = {}) {
  const hadYears = selectedYears.size > 0;
  const hadSelection = selectedIndices.size > 0;
  if (!hadYears && (keepSelection || !hadSelection)) return;

  selectedYears = new Set();
  clearYearPanels();
  if (!keepSelection) clearHighlight();
  updateFilterGenreVisuals();

  orbitRings.forEach(r => {
    r.userData.targetOpacity = timeMode ? ORBIT_RING_IDLE_OPACITY : 0;
    r.material.color.setHex(ORBIT_RING_DEFAULT_COLOR);
  });
  yearSprites.forEach(s => {
    s.userData.targetOpacity = timeMode ? 1 : 0;
    s.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
  });
  updateEventLabelTints();
}

function clearYearPanels() {
  if (yearPanelEl) yearPanelEl.remove();
  yearPanelEl = null;
}
 
function syncYearPanels() {
  if (selectedYears.size === 0) { clearYearPanels(); return; }
 
  if (!yearPanelEl) {
    const el = document.createElement("div");
    el.className = ui.tooltip.className;
    el.style.position = "absolute";
    el.style.pointerEvents = "auto";
    el.style.right = "auto";
    el.style.maxHeight = `${innerHeight - 2 * TOOLTIP_MARGIN}px`;
    el.style.overflowY = "auto";
    document.body.appendChild(el);
    yearPanelEl = el;
  }
 
  renderYearStatsPanelInto(yearPanelEl, selectedYears);
  yearPanelEl.style.display = "block";
  updateYearPanels();
}
 
const SECTION_TITLE_STYLE =
  "margin-top:16px;margin-bottom:4px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:white;line-height:1;";

const CLOSE_BTN_STYLE =
  "position:absolute;top:12px;right:12px;border:none;background:none;font-size:24px;line-height:1;cursor:pointer;color:white;width:min-content;padding:0;";

const TOGGLE_BTN_STYLE =
  "margin-top:16px;border:none;color:white;background:#2d9cdb;font-size:12px;text-transform:uppercase;cursor:pointer;padding:8px 6px;width:fit-content;line-height:1;";


function renderYearStatsPanelInto(el, years) {
  const isPeriod = years.size > 1;
  const stats = computePeriodGenreStats(years);
  el.textContent = "";
  const dominantGroup = stats.groups[0];
  const borderColor = dominantGroup ? colorForGroup(dominantGroup.genre) : "#888";
  setPanelBorder(el, borderColor);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.style.cssText = CLOSE_BTN_STYLE;
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    clearYearHighlight();
  });

  const title = document.createElement("strong");
  title.textContent = periodLabel(years);

  const meta = document.createElement("div");
  meta.className = "artist";
  meta.textContent =
    `${stats.total} álbum${stats.total === 1 ? "" : "es"}` +
    (isPeriod ? ` · ${years.size} años` : "");

  el.appendChild(closeBtn);
  el.appendChild(title);
  el.appendChild(meta);

  if (stats.groups.length) {
    const groupsTitle = document.createElement("div");
    groupsTitle.textContent = "Géneros principales";
    groupsTitle.style.cssText = SECTION_TITLE_STYLE;
    el.appendChild(groupsTitle);

    const limit = isPeriod ? PERIOD_PANEL_TOP_GENRES : YEAR_PANEL_TOP_GENRES;
    stats.groups.slice(0, limit).forEach(entry =>
      el.appendChild(buildGenreStatRow(entry, colorForGroup(entry.genre)))
    );
  }

  if (!isPeriod && stats.albums.length) {
    const albumsSection = document.createElement("div");
    albumsSection.style.display = "none";

    const albumsTitle = document.createElement("div");
    albumsTitle.textContent = "Álbumes de este año";
    albumsTitle.style.cssText = SECTION_TITLE_STYLE;
    albumsSection.appendChild(albumsTitle);

    const albumsList = document.createElement("div");
    albumsList.className = "panel-scroll";
    stats.albums.forEach(p => albumsList.appendChild(buildNearestRow(p)));
    albumsSection.appendChild(albumsList);


    const showLabel = `Ver álbumes (${stats.albums.length})`;
    const showBtn = document.createElement("button");
    showBtn.textContent = showLabel;
    showBtn.style.cssText = TOGGLE_BTN_STYLE;
    showBtn.addEventListener("click", e => {
      e.stopPropagation();
      const showing = albumsSection.style.display !== "none";
      albumsSection.style.display = showing ? "none" : "block";
      showBtn.textContent = showing ? showLabel : "Ocultar álbumes";
    });

    el.appendChild(showBtn);
    el.appendChild(albumsSection);
  }
}

function applyYearVisuals() {
  updateFilterGenreVisuals();

  orbitRings.forEach(r => {
    const isSelected = selectedYears.has(r.userData.year);
    r.userData.targetOpacity = isSelected ? .25 : ORBIT_RING_IDLE_OPACITY;
    if (isSelected) r.material.color.copy(dominantGroupColor(r.userData.year));
    else r.material.color.setHex(ORBIT_RING_DEFAULT_COLOR);
  });

  yearSprites.forEach(s => {
    const year = s.userData.year;
    const isSelected = selectedYears.has(year);
    s.userData.targetOpacity = isSelected ? 1 : EVENT_LABEL_CONFIG.dimmedOpacity;
    if (isSelected) s.material.color.copy(dominantGroupColor(year));
    else s.material.color.setHex(YEAR_LABEL_DEFAULT_TINT);
  });
  updateEventLabelTints();
}

const yearAnchorVec = new THREE.Vector3();
const cameraRightVec = new THREE.Vector3();

function ringScreenAnchor(ring, side = 1) {
  cameraRightVec.setFromMatrixColumn(camera.matrixWorld, 0);
  cameraRightVec.y = 0;
  if (cameraRightVec.lengthSq() < 1e-6) cameraRightVec.set(1, 0, 0);
  cameraRightVec.normalize();

  yearAnchorVec.copy(ring.position).addScaledVector(cameraRightVec, ring.userData.radius * side);
  return projectToScreen(yearAnchorVec);
}

function updateYearPanels() {
  if (!yearPanelEl || selectedYears.size === 0) return;

  const years = [...selectedYears];
  const ringMin = orbitRings.find(r => r.userData.year === Math.min(...years));
  const ringMax = orbitRings.find(r => r.userData.year === Math.max(...years));
  if (!ringMin || !ringMax) return;

  camera.updateMatrixWorld();
  const a = ringScreenAnchor(ringMin, -1);
  const b = ringScreenAnchor(ringMax, -1);
  const x = Math.min(a.x, b.x);
  const y = (a.y + b.y) / 2;

  placeTooltip(yearPanelEl, x, y, "left-center");
}

function pointerMove(e) {
  mouse.x = e.clientX / innerWidth * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse,camera);
  raycaster.camera = camera;

  const interactiveMeshes = getInteractivePointMeshes();
  const hit = raycaster.intersectObjects(interactiveMeshes)[0];
  const yearHit = timeMode ? raycaster.intersectObjects([...orbitRings, ...yearSprites])[0] : null;

  const artistChainLines = connectionLines
    .filter(c => c.line.userData.isArtistChain)
    .map(c => c.line);
  const lineHit = !hit && artistChainLines.length
    ? raycaster.intersectObjects(artistChainLines)[0]
    : null;

  pointMeshes.forEach(m => m.material.emissiveIntensity = .35);

  if (hit) {
    hit.object.material.emissiveIntensity = 1.2;
    renderer.domElement.style.cursor = "pointer";
  } else if (lineHit || yearHit) {
    renderer.domElement.style.cursor = "pointer";
  } else {
    renderer.domElement.style.cursor = "default";
  }

  if (lineHit && pinnedIndex === null) {
    ui.tooltip.innerHTML = buildArtistHoverHTML(lineHit.object.userData.artist);
    setPanelBorder(ui.tooltip, artistColor(lineHit.object.userData.artist));
    ui.tooltip.style.pointerEvents = "none";
    ui.tooltip.style.right = "auto";
    ui.tooltip.innerHTML = buildArtistHoverHTML(lineHit.object.userData.artist);
    setPanelBorder(ui.tooltip, artistColor(lineHit.object.userData.artist));
    ui.tooltip.style.pointerEvents = "none";
    placeTooltip(ui.tooltip, e.clientX, e.clientY, "above");
    return;
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
      pinTooltip(pinnedIndex);
    }
    return;
  }

  const hitIdx = hit?.object.userData.index;
  const compareMode = (e.ctrlKey || e.metaKey) && selectedIndices.size > 0;

  if (hit && (compareMode || !selectedIndices.has(hitIdx))) {
    showTooltipForPoint(hitIdx, e.clientX, e.clientY);
  } else if (!lineHit) {
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

  activeFilters.query = value.toLowerCase().trim();
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
  if (e.target.checked) syncRingsToRange();
  else clearYearHighlight();
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

const homeBtn = document.getElementById("homeBtn");
const modeBtns = document.querySelectorAll(".topbar_switch [data-mode]");

function closeSidebar({ restoreFocus = false } = {}) {
  body.classList.add("is-closed");
  sidebarEl.setAttribute("aria-hidden", "true");
  syncFilterBtn();
  if (restoreFocus) sidebarOpenBtn.focus();
}

function syncModeButtons(mode) {
  modeBtns.forEach(btn => {
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  });
}

modeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.getAttribute("aria-pressed") === "true") return;
    setTimeMode(btn.dataset.mode === "cronologico");
  });
});

homeBtn.addEventListener("click", e => {
  e.stopPropagation();
  resetInteractionState();
  resetView(); 
  reopenOnboarding();
});

syncModeButtons(timeMode ? "cronologico" : "exploratorio");

onboardingOverlay = createOnboardingOverlay();
renderOnboardingStep1();
createNetworkInsightsToggle();

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
    setLoadingProgress(10);
    return calculateModel();
  })
  .catch(err => {
    console.error(err);
    if (onboardingProgressLabelEl) {
      onboardingProgressLabelEl.textContent = "No se pudo cargar data/albums.json";
    }
  });

function setSidebarOpen(open, view) {
  if (!sidebarPanelEl) return;
  sidebarPanelEl.classList.toggle("is-closed", !open);
  if (view === "about") sidebarPanelEl.dataset.view = "about";
  else if (view === "filters") delete sidebarPanelEl.dataset.view;
}

function isSidebarOpen() {
  return Boolean(sidebarPanelEl) && !sidebarPanelEl.classList.contains("is-closed");
}

function isAboutVisible() {
  return isSidebarOpen() && sidebarPanelEl.dataset.view === "about";
}

function syncSidebarButtons() {
  const about = isAboutVisible();
  aboutFabEl?.setAttribute("aria-expanded", String(about));
  document.querySelector("#sidebarOpen")
    ?.setAttribute("aria-expanded", String(isSidebarOpen() && !about));
}

function toggleAboutPanel() {
  if (isAboutVisible()) setSidebarOpen(false);
  else setSidebarOpen(true, "about");
}

function initSidebar() {
  const text = document.querySelector("#aboutText");
  if (text) text.textContent = ONBOARDING_ABOUT_TEXT;

  aboutFabEl?.addEventListener("click", toggleAboutPanel);

  document.querySelector("#aboutBack")?.addEventListener("click", () => {
    setSidebarOpen(true, "filters");
  });

  document.querySelector("#sidebarOpen")?.addEventListener("click", () => {
    const inFilters = isSidebarOpen() && sidebarPanelEl.dataset.view !== "about";
    setSidebarOpen(!inFilters, "filters");
  });

  document.querySelector("#sidebarClose")?.addEventListener("click", () => {
    setSidebarOpen(false);
  });

  // NUEVO: reemplaza al Escape del bloque viejo
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isSidebarOpen()) setSidebarOpen(false);
  });

  if (sidebarPanelEl) {
    new MutationObserver(syncSidebarButtons).observe(sidebarPanelEl, {
      attributes: true,
      attributeFilter: ["class", "data-view"]
    });
  }
  syncSidebarButtons();
}
  
initSidebar();
animate();