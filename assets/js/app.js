(function(){
  'use strict';

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function statusDialog(){
    const dlg = new mdc.dialog.MDCDialog(document.querySelector('#sys-dialog'));
    return {
      open(title, content){
        document.getElementById('sys-title').textContent = title;
        document.getElementById('sys-content').textContent = content;
        dlg.open();
      }
    };
  }

  const dlg = statusDialog();
  const filtersDlg = new mdc.dialog.MDCDialog(document.querySelector('#filters-dialog'));

  const mapboxToken = 'pk.eyJ1Ijoic3NteCIsImEiOiJjbTBtemd2c2QwN2prMm5xNWpweHo5cHNuIn0.gyloN7dCA3dB9dvs3uETuA';
  mapboxgl.accessToken = mapboxToken;
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-99.1331, 19.4326],
    zoom: 4.7,
    dragRotate: false
  });

  const FEEDS = {
    week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
    month: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson'
  };
  let currentFeed = 'week';
  let quakeGeoJSON = null;
  let currentFilters = { magMin: 4.0, magMax: null, depthMin: null, depthMax: null };
  const PAGE_SIZE = 22;
  let shownCount = PAGE_SIZE;

  const panelHome = document.getElementById('panelHome');
  const panelList = document.getElementById('panelList');
  const panelSim  = document.getElementById('panelSim');

  function switchPanels(from, to){
    from.classList.add('inactive');
    to.classList.add('active');
    to.classList.remove('inactive', 'hidden');
    if(!prefersReducedMotion){
      to.classList.add('enter'); void to.offsetWidth; to.classList.add('show');
      from.classList.add('leave'); void from.offsetWidth; from.classList.add('done');
      setTimeout(()=>{
        from.classList.add('hidden');
        from.classList.remove('leave','done','active');
        to.classList.remove('enter','show');
      }, 280);
    } else {
      from.classList.add('hidden');
      from.classList.remove('active');
    }
  }

  document.getElementById('btnOpenList').addEventListener('click', ()=>{ switchPanels(panelHome, panelList); shownCount = PAGE_SIZE; renderList(); });
  document.getElementById('btnBack').addEventListener('click', ()=>{ switchPanels(panelList, panelHome); });
  document.getElementById('btnRefresh').addEventListener('click', ()=>{ shownCount = PAGE_SIZE; renderList(); });

  document.getElementById('btnHeat').addEventListener('click', ()=>{
    switchPanels(panelHome, panelSim);
    hideUSGSLayers(true);
    setSimStatus('Mapa limpio. Configure y ejecute.');
  });
  document.getElementById('btnSimBack').addEventListener('click', ()=>{
    stopSimulation();
    clearSimLayers();
    hideUSGSLayers(false);
    switchPanels(panelSim, panelHome);
  });

  const rangeSelectEl = document.getElementById('rangeSelect');
  document.getElementById('btnFilters').addEventListener('click', ()=>{
    rangeSelectEl.value = currentFeed;
    document.getElementById('magMin').value = currentFilters.magMin ?? '';
    document.getElementById('magMax').value = currentFilters.magMax ?? '';
    document.getElementById('depthMin').value = currentFilters.depthMin ?? '';
    document.getElementById('depthMax').value = currentFilters.depthMax ?? '';
    filtersDlg.open();
  });

  document.getElementById('filtersApply').addEventListener('click', async ()=>{
    const v = (id)=>document.getElementById(id).value.trim();
    const parseNum = (x)=>x===''?null:Number(x);
    const newFeed = v('rangeSelect');
    if(newFeed !== currentFeed){ currentFeed = newFeed; await reloadUSGS(); }
    currentFilters = {
      magMin: parseNum(v('magMin')),
      magMax: parseNum(v('magMax')),
      depthMin: parseNum(v('depthMin')),
      depthMax: parseNum(v('depthMax'))
    };
    if(currentFilters.magMin!=null && currentFilters.magMax!=null && currentFilters.magMin>currentFilters.magMax){
      const t=currentFilters.magMin; currentFilters.magMin=currentFilters.magMax; currentFilters.magMax=t;
    }
    if(currentFilters.depthMin!=null && currentFilters.depthMax!=null && currentFilters.depthMin>currentFilters.depthMax){
      const t=currentFilters.depthMin; currentFilters.depthMin=currentFilters.depthMax; currentFilters.depthMax=t;
    }
    shownCount = PAGE_SIZE; renderList();
  });

  let reloadAbort = null;
  async function reloadUSGS(){
    if(reloadAbort) reloadAbort.abort();
    reloadAbort = new AbortController();
    try{
      const res = await fetch(FEEDS[currentFeed], { cache: 'no-store', signal: reloadAbort.signal });
      quakeGeoJSON = await res.json();
      document.getElementById('lastUpdated').textContent = 'Actualizado: ' + new Date().toLocaleTimeString();
      if(map.getSource('earthquakes')) updateMapSource(); else initMapLayers();
    }catch(err){ if(err.name !== 'AbortError'){ console.error('USGS error', err); } }
  }

  function initMapLayers(){
    map.addSource('earthquakes', { type:'geojson', data: applyFiltersToGeoJSON() });
    map.addLayer({ id:'eq-circles', type:'circle', source:'earthquakes', paint:{
      'circle-color':['interpolate',['linear'],['get','mag'],4,'#00c3ff',5,'#ffc400',6,'#ff5c33',7,'#ff2b88'],
      'circle-radius':['interpolate',['linear'],['get','mag'],4,13,5,20,6,30,7,42],
      'circle-opacity':0.35
    }});
  }

  function applyFiltersToGeoJSON(){
    if(!quakeGeoJSON) return { type:'FeatureCollection', features:[] };
    const f = currentFilters;
    const features = quakeGeoJSON.features
      .filter((feat)=>{
        const p = feat.properties || {};
        const m = p.mag;
        const depth = feat.geometry?.coordinates?.[2];
        if(m==null || isNaN(m)) return false;
        if(f.magMin!=null && m < f.magMin) return false;
        if(f.magMax!=null && m > f.magMax) return false;
        if(f.depthMin!=null && depth < f.depthMin) return false;
        if(f.depthMax!=null && depth > f.depthMax) return false;
        return true;
      })
      .sort((a,b)=>(b.properties.time||0)-(a.properties.time||0));
    return { type:'FeatureCollection', features };
  }

  function updateMapSource(){
    const src = map.getSource('earthquakes');
    if(src) src.setData(applyFiltersToGeoJSON());
  }

  function hideUSGSLayers(hide){
    const vis = hide ? 'none' : 'visible';
    if(map.getLayer('eq-circles')) map.setLayoutProperty('eq-circles','visibility',vis);
  }

  map.on('load', async ()=>{
    try{
      map.addSource('plates', {
        type: 'geojson',
        data: 'https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services/Tectonic_Plate_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
      });
      map.addLayer({ id: 'plates', type: 'line', source: 'plates', paint: {
        'line-width': 1.6,
        'line-opacity': 0.9,
        'line-color': [ 'match', ['downcase', ['get', 'TYPE'] ], 'convergent', '#ff2d2d', 'subduction', '#ff2d2d', 'ridge', '#ffb300', 'divergent', '#ffb300', 'transform', '#ffb300', '#ff7300' ]
      }});
    }catch(e){ console.warn('Plates source failed', e); }

    await reloadUSGS();
    renderList();
    initSimSources();
  });

  const eqList = document.getElementById('eqList');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const btnLoadMore = document.getElementById('btnLoadMore');
  btnLoadMore.addEventListener('click', ()=>{ shownCount += PAGE_SIZE; renderList(); });

  function timeAgo(ms) {
    const sec = Math.floor((Date.now() - ms) / 1000);
    const units = [ ["año", 365*24*3600], ["mes", 30*24*3600], ["semana", 7*24*3600], ["día", 24*3600], ["hora", 3600], ["minuto", 60] ];
    for (const [name, size] of units) { const v = Math.floor(sec / size); if (v >= 1) return `Hace ${v} ${name}${v===1?"":"s"}`; }
    return "Hace segundos";
  }

  function eqCardHTML(mag, place, metaLine1, metaLine2, magType, lat, lng){
    const m = Number(mag);
    const cls = isNaN(m) ? '' : (m>=7 ? 'mag-high' : m>=5 ? 'mag-mid' : 'mag-ok');
    const pos = (Number.isFinite(lat)&&Number.isFinite(lng)) ? ` data-lat="${lat}" data-lng="${lng}"` : '';
    return `<div class="eq-card"${pos}>
      <div class="eq-item">
        <div class="magbox ${cls}"><span class="t1">MAG</span><span class="t2">${isNaN(m)?'—':m.toFixed(1)}</span><span class="t3">${(magType||'M').toUpperCase()}</span></div>
        <div class="eq-text">
          <div class="title">${place||'Ubicación no disponible'}</div>
          <div class="meta">${metaLine1}</div>
          <div class="meta">${metaLine2}</div>
        </div>
      </div>
    </div>`;
  }

  function renderList(){
    const fc = applyFiltersToGeoJSON();
    const dfDate = new Intl.DateTimeFormat(undefined,{dateStyle:'medium'});
    const dfTime = new Intl.DateTimeFormat(undefined,{timeStyle:'short'});

    const total = fc.features.length;
    const end = Math.min(shownCount, total);
    const slice = fc.features.slice(0, end);

    eqList.innerHTML = slice.map(f=>{
      const { mag, place, time, magType } = f.properties;
      const [lng, lat, depth] = f.geometry.coordinates;
      const d = Number.isFinite(depth) ? depth.toFixed(1) : '—';
      const meta1 = `${timeAgo(time)} · Prof: ${d} km`;
      const meta2 = `${dfDate.format(new Date(time))} ${dfTime.format(new Date(time))}`;
      return eqCardHTML(mag, place, meta1, meta2, magType, lat, lng);
    }).join('');

    loadMoreWrap.style.display = end < total ? 'flex' : 'none';

    eqList.querySelectorAll('.eq-card').forEach(row=>{
      row.addEventListener('click', ()=>{
        const lat = parseFloat(row.dataset.lat), lng = parseFloat(row.dataset.lng);
        if(Number.isFinite(lat) && Number.isFinite(lng)){
          const flyOpts = { center:[lng,lat], zoom:3.2, speed:1.5, curve:1.4 };
          if(prefersReducedMotion){ map.easeTo({ center:[lng,lat], zoom:3.2, duration:0 }); }
          else { map.flyTo(flyOpts); }
        }
      });
    });

    updateMapSource();
    document.getElementById('lastUpdated').textContent = 'Ultima Actualizacion: ' + new Date().toLocaleTimeString();
  }

  function setUserProfile({ photoURL=null, displayName=null }={}){
    const slot = document.getElementById('avatarSlot');
    const nameEl = document.getElementById('userName');
    if(photoURL){ slot.innerHTML = `<img class="avatar" alt="Usuario" src="${photoURL}">`; }
    else { slot.innerHTML = `<div class="avatar-icon" aria-label="Sin foto de perfil"><span class="material-icons" aria-hidden="true">account_circle</span></div>`; }
    nameEl.textContent = displayName || 'Bienvenido, Usuario Anonimo';
  }
  setUserProfile();

  /* Conectividad */
  const btnWifi = document.getElementById('btnWifi');
  const wifiIcon = document.getElementById('wifiIcon');
  const btnAlzo = document.getElementById('btnAlzo');
  const alzoIcon = document.getElementById('alzoIcon');
  function setWifiUI() {
    const online = navigator.onLine;
    wifiIcon.classList.toggle('wifi-ok', online);
    wifiIcon.classList.toggle('wifi-off', !online);
    wifiIcon.setAttribute('title', online ? 'Wi-Fi en línea' : 'Sin Wi-Fi');
    btnWifi.setAttribute('aria-pressed', online ? 'true' : 'false');

    alzoIcon.textContent = online ? 'check' : 'close';
    alzoIcon.classList.toggle('server-ok', online);
    alzoIcon.classList.toggle('wifi-off', !online);
    alzoIcon.setAttribute('title', online ? 'Servidor AlzoMX conectado' : 'Sin conexión con AlzoMX');
    btnAlzo.setAttribute('aria-pressed', online ? 'true' : 'false');
  }
  function handleConnectivityChange() {
    setWifiUI();
    if (!navigator.onLine) {
      dlg.open('Sin conexión Wi‑Fi','Verifica tu conexión. Sin acceso a Internet no podrás cargar datos ni visualizar los últimos sismos.');
    }
  }
  setWifiUI();
  window.addEventListener('online', handleConnectivityChange);
  window.addEventListener('offline', handleConnectivityChange);
  btnWifi.addEventListener('click', ()=>{
    if (!navigator.onLine) dlg.open('Sin conexión Wi‑Fi','Verifica tu conexión. Sin Internet no se cargan datos.');
    else dlg.open('Conexión Wi‑Fi','Conexión establecida. Permite actualizar datos en tiempo real.');
  });
  btnAlzo.addEventListener('click', ()=>{
    if (!navigator.onLine) dlg.open('Conexión AlzoMX','Sin Internet no hay conexión con el servidor de AlzoMX.');
    else dlg.open('Conexión AlzoMX','Conexión correcta. Podrás recibir alertas de la comunidad y AlzoMX.');
  });

  /* ===================== SIMULADOR ===================== */
  const V_P_KM_S = 6.0;
  const V_S_KM_S = 3.5;
  let simRAF = null;
  let simStartTs = null;
  let simRunning = false;
  let simAutoStopAt = null;
  let simReachedUser = false;
  let simState = { epic: null, user: null, picking: null };

  const epLat = document.getElementById('epLat');
  const epLon = document.getElementById('epLon');
  const epDepth = document.getElementById('epDepth');
  const epIntensity = document.getElementById('epIntensity');
  const usLat = document.getElementById('usLat');
  const usLon = document.getElementById('usLon');

  const btnPickEpic = document.getElementById('btnPickEpic');
  const btnPickUser = document.getElementById('btnPickUser');
  const btnSimToggle = document.getElementById('btnSimToggle');
  const iconSimToggle = document.getElementById('iconSimToggle');

  function setSimStatus(t){ document.getElementById('simStatus').textContent = t; }

  function initSimSources(){
    if(!map.getSource('sim-waves')){
      map.addSource('sim-waves', { type:'geojson', data: {type:'FeatureCollection',features:[]} });
      map.addLayer({ id:'sim-wave-P', type:'line', source:'sim-waves', filter:['==',['get','kind'],'P'], paint:{ 'line-color':'#4cc9f0', 'line-width':2, 'line-opacity':0.9 } });
      map.addLayer({ id:'sim-wave-S', type:'line', source:'sim-waves', filter:['==',['get','kind'],'S'], paint:{ 'line-color':'#ffb703', 'line-width':2, 'line-opacity':0.9 } });
    }
    if(!map.getSource('sim-points')){
      map.addSource('sim-points', { type:'geojson', data: {type:'FeatureCollection',features:[]} });
      map.addLayer({ id:'sim-epic', type:'circle', source:'sim-points', filter:['==',['get','role'],'epic'], paint:{ 'circle-radius':6, 'circle-color':'#e63946', 'circle-stroke-color':'#ffffff', 'circle-stroke-width':1 } });
      map.addLayer({ id:'sim-user', type:'circle', source:'sim-points', filter:['==',['get','role'],'user'], paint:{ 'circle-radius':6, 'circle-color':'#06d6a0', 'circle-stroke-color':'#ffffff', 'circle-stroke-width':1 } });
      map.addLayer({ id:'sim-line', type:'line', source:'sim-points', filter:['==',['get','role'],'line'], paint:{ 'line-color':'#8ecae6', 'line-width':1.5, 'line-dasharray':[2,2], 'line-opacity':0.8 } });
    }
  }

  function updateSimPoints(){
    const feats=[];
    if(simState.epic){ feats.push({type:'Feature',properties:{role:'epic'},geometry:{type:'Point',coordinates:[simState.epic.lon,simState.epic.lat]}}); }
    if(simState.user){ feats.push({type:'Feature',properties:{role:'user'},geometry:{type:'Point',coordinates:[simState.user.lon,simState.user.lat]}}); }
    if(simState.epic && simState.user){ feats.push({type:'Feature',properties:{role:'line'},geometry:{type:'LineString',coordinates:[[simState.epic.lon,simState.epic.lat],[simState.user.lon,simState.user.lat]]}}); }
    map.getSource('sim-points')?.setData({type:'FeatureCollection',features:feats});
  }

  function toRad(d){ return d*Math.PI/180; }
  function haversineKm(lat1,lon1,lat2,lon2){
    const R=6371; const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }

  function circlePoly(centerLon,centerLat,rKm,steps=128){
    const coords=[]; const dLat = rKm/111; const cosLat = Math.cos(toRad(centerLat));
    for(let i=0;i<=steps;i++){
      const t = 2*Math.PI*i/steps;
      const lat = centerLat + dLat*Math.sin(t);
      const lon = centerLon + (rKm/(111*Math.max(cosLat, 0.01)))*Math.cos(t);
      coords.push([lon,lat]);
    }
    return coords;
  }

  btnPickEpic.addEventListener('click', ()=>{ simState.picking='epic'; setSimStatus('Click en el mapa para fijar EPICENTRO.'); });
  btnPickUser.addEventListener('click', ()=>{ simState.picking='user'; setSimStatus('Click en el mapa para fijar UBICACIÓN de usuario.'); });

  map.on('click', (e)=>{
    if(panelSim.classList.contains('hidden')) return;
    if(simState.picking==='epic'){
      epLat.value = e.lngLat.lat.toFixed(5);
      epLon.value = e.lngLat.lng.toFixed(5);
      if(!epDepth.value) epDepth.value = 10;
      if(!epIntensity.value) epIntensity.value = 'moderado';
      simState.epic = { lat:e.lngLat.lat, lon:e.lngLat.lng, depth:Number(epDepth.value)||10, intensity:String(epIntensity.value || 'moderado') };
      simState.picking=null; updateSimPoints(); setSimStatus('Epicentro fijado.');
    } else if(simState.picking==='user'){
      usLat.value = e.lngLat.lat.toFixed(5);
      usLon.value = e.lngLat.lng.toFixed(5);
      simState.user = { lat:e.lngLat.lat, lon:e.lngLat.lng };
      simState.picking=null; updateSimPoints(); setSimStatus('Ubicación de usuario fijada.');
    }
  });

  [epLat,epLon,epDepth,epIntensity,usLat,usLon].forEach(el=>{
    el.addEventListener('input', ()=>{
      const eLat = parseFloat(epLat.value), eLon = parseFloat(epLon.value);
      const uLat = parseFloat(usLat.value), uLon = parseFloat(usLon.value);
      if(Number.isFinite(eLat)&&Number.isFinite(eLon)){
        simState.epic = { lat:eLat, lon:eLon, depth:Math.max(0, parseFloat(epDepth.value)||0), intensity:String(epIntensity.value||'moderado') };
      }
      if(Number.isFinite(uLat)&&Number.isFinite(uLon)){
        simState.user = { lat:uLat, lon:uLon };
      }
      updateSimPoints();
    });
  });

  function startSimulation(){
    const eLat = parseFloat(epLat.value), eLon = parseFloat(epLon.value);
    const eDepth = Math.max(0, parseFloat(epDepth.value)||0);
    const eIntensityStr = String(epIntensity.value || 'moderado');
    const uLat = parseFloat(usLat.value), uLon = parseFloat(usLon.value);
    if(!Number.isFinite(eLat)||!Number.isFinite(eLon)||!Number.isFinite(uLat)||!Number.isFinite(uLon)){
      dlg.open('Parámetros incompletos','Necesitas epicentro y ubicación del usuario.');
      return false;
    }
    simState.epic = {lat:eLat, lon:eLon, depth:eDepth, intensity:eIntensityStr};
    simState.user = {lat:uLat, lon:uLon};
    updateSimPoints();
    clearWaves();

    simStartTs = performance.now();
    simRunning = true;
    simReachedUser = false;
    simAutoStopAt = null;

    iconSimToggle.textContent = 'stop_circle';
    btnSimToggle.setAttribute('aria-label','Detener evento');
    btnSimToggle.title = 'Detener evento';
    setSimStatus('Simulación en curso. Presiona para detener.');
    if(prefersReducedMotion){ map.easeTo({center:[eLon,eLat], zoom:5.5, duration:0}); }
    else { map.flyTo({center:[eLon,eLat], zoom:5.5, speed:1.2}); }
    animateWaves();
    return true;
  }

  function stopSimulation(){
    if(simRAF){ cancelAnimationFrame(simRAF); simRAF=null; }
    simStartTs = null; simRunning = false; simAutoStopAt = null; simReachedUser = false; clearWaves();
    iconSimToggle.textContent = 'play_circle';
    btnSimToggle.setAttribute('aria-label','Iniciar evento');
    btnSimToggle.title = 'Iniciar evento';
  }
  btnSimToggle.addEventListener('click', ()=>{ simRunning ? (stopSimulation(), setSimStatus('Simulación detenida.')) : startSimulation(); });

  function clearSimLayers(){
    clearWaves();
    map.getSource('sim-points')?.setData({type:'FeatureCollection',features:[]});
    simState = { epic:null, user:null, picking:null };
    epLat.value = epLon.value = epDepth.value = '';
    epIntensity.value = 'moderado';
    usLat.value = usLon.value = '';
  }

  function clearWaves(){ map.getSource('sim-waves')?.setData({type:'FeatureCollection',features:[]}); }

  function animateWaves(){
    if(!simRunning || !simStartTs || !simState.epic) return;
    const t = (performance.now()-simStartTs)/1000; // s
    const rP = Math.max(0, V_P_KM_S * t);
    const rS = Math.max(0, V_S_KM_S * t);
    const e = simState.epic;

    const pPoly = circlePoly(e.lon, e.lat, rP);
    const sPoly = circlePoly(e.lon, e.lat, rS);
    const waves = { type:'FeatureCollection', features:[
      {type:'Feature',properties:{kind:'P'},geometry:{type:'LineString',coordinates:pPoly}},
      {type:'Feature',properties:{kind:'S'},geometry:{type:'LineString',coordinates:sPoly}}
    ]};
    map.getSource('sim-waves')?.setData(waves);

    if(simState.user){
      const flatKm = haversineKm(e.lat, e.lon, simState.user.lat, simState.user.lon);
      const depth = Number(epDepth.value)||0;
      const hypo = Math.sqrt(flatKm*flatKm + depth*depth);
      const tS = hypo / V_S_KM_S;
      if(!simReachedUser && t >= tS){ simReachedUser = true; simAutoStopAt = performance.now() + 20000; }
      if(simAutoStopAt && performance.now() >= simAutoStopAt){ stopSimulation(); setSimStatus('Evento finalizado.'); setTimeout(() => { setSimStatus('Iniciar evento'); }, 5000); return; }
    }
    simRAF = requestAnimationFrame(animateWaves);
  }

  // Error surfacing
  window.addEventListener('unhandledrejection', (e)=>{ console.error(e.reason); });
  window.addEventListener('error', (e)=>{ console.error(e.error || e.message); });
})();
