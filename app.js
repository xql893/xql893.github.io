'use strict';

// RadioBrowser 公共服务器（多节点故障转移，与 moOde 同源）
const SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info'
];

const QUICK_LANGS = [
  {code:'chinese', label:'中文'},
  {code:'english', label:'English'},
  {code:'japanese', label:'日本語'},
  {code:'korean', label:'한국어'},
  {code:'cantonese', label:'粤语'},
  {code:'french', label:'Français'},
  {code:'german', label:'Deutsch'},
  {code:'spanish', label:'Español'},
  {code:'russian', label:'Русский'}
];
const QUICK_COUNTRIES = [
  {code:'CN', label:'中国'},
  {code:'TW', label:'中国台湾'},
  {code:'HK', label:'中国香港'},
  {code:'US', label:'美国'},
  {code:'GB', label:'英国'},
  {code:'JP', label:'日本'},
  {code:'KR', label:'韩国'},
  {code:'FR', label:'法国'},
  {code:'DE', label:'德国'},
  {code:'RU', label:'俄罗斯'}
];
const QUICK_TAGS = ['pop','rock','jazz','news','classical','electronic','country','folk','hip hop','oldies','easy listening','dance','talk','sport'];

const FAV_KEY = 'rb_favs_v1';

let BASE = SERVERS[0];
const audio = new Audio();
let hls = null;
let current = null;

let favs = loadFavs();
let filter = { q:'', lang:null, country:null, tag:null };
let tab = 'top';

// ---------- 工具 ----------
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function loadFavs(){ try{ return JSON.parse(localStorage.getItem(FAV_KEY)||'[]'); }catch(e){ return []; } }
function saveFavs(){ localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }
function isFav(uuid){ return favs.some(f=>f.stationuuid===uuid); }

let toastTimer;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.add('hidden'),2600);
}

async function api(path){
  let lastErr;
  for(const s of SERVERS){
    try{
      const r=await fetch(s+path,{headers:{'User-Agent':'WebRadioPWA/1.0'}});
      if(r.ok){ BASE=s; return await r.json(); }
      lastErr=new Error('HTTP '+r.status);
    }catch(e){ lastErr=e; }
  }
  throw lastErr;
}

// 静默上报点击（no-cors 避免跨域报错，不影响播放）
function reportClick(uuid){
  fetch(`${BASE}/json/url/${uuid}`,{mode:'no-cors'}).catch(()=>{});
}

// ---------- UI 渲染 ----------
function renderChips(){
  const lc=document.getElementById('langChips');
  const cc=document.getElementById('countryChips');
  const tc=document.getElementById('tagChips');
  lc.innerHTML = QUICK_LANGS.map(l=>`<button class="chip ${filter.lang===l.code?'on':''}" data-k="lang" data-v="${l.code}">${l.label}</button>`).join('');
  cc.innerHTML = QUICK_COUNTRIES.map(c=>`<button class="chip ${filter.country===c.code?'on':''}" data-k="country" data-v="${c.code}">${c.label}</button>`).join('');
  tc.innerHTML = QUICK_TAGS.map(t=>`<button class="chip ${filter.tag===t?'on':''}" data-k="tag" data-v="${t}">${t}</button>`).join('');
  document.querySelectorAll('.chip').forEach(b=>{
    b.onclick=()=>{
      const k=b.dataset.k, v=b.dataset.v;
      filter[k] = (filter[k]===v)? null : v; // 再次点击取消
      renderChips(); doSearch();
    };
  });
}

function codecInfo(s){
  const parts=[];
  if(s.hls===1) parts.push('HLS');
  if(s.codec) parts.push(s.codec);
  if(s.bitrate) parts.push(s.bitrate+'k');
  return parts.join(' ');
}

function stationCard(s){
  const el=document.createElement('div');
  el.className='card'+(current&&current.stationuuid===s.stationuuid?' playing':'');
  el.dataset.uuid=s.stationuuid;
  const fav=isFav(s.stationuuid);
  el.innerHTML=`
    <img class="c-icon" src="${s.favicon||'icon.svg'}" onerror="this.src='icon.svg'" alt="">
    <div class="c-body">
      <div class="c-name">${esc(s.name)}</div>
      <div class="c-sub">${[s.country,s.language].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="c-tags">${esc(codecInfo(s))}${s.tags? ' · '+esc(String(s.tags).slice(0,42)):''}</div>
    </div>
    <button class="c-fav ${fav?'on':''}" title="收藏">${fav?'★':'☆'}</button>
    <button class="c-play" title="播放">${current&&current.stationuuid===s.stationuuid?'⏸':'▶'}</button>
  `;
  el.querySelector('.c-play').onclick=(e)=>{ e.stopPropagation(); playStation(s); };
  el.querySelector('.c-fav').onclick=(e)=>{ e.stopPropagation(); toggleFav(s); };
  el.onclick=()=>playStation(s);
  return el;
}

function renderStations(arr){
  const box=document.getElementById('results');
  if(!arr || !arr.length){ box.innerHTML='<div class="empty">没有找到电台，换个关键词或分类试试。</div>'; return; }
  box.innerHTML='';
  const frag=document.createDocumentFragment();
  arr.forEach(s=>frag.appendChild(stationCard(s)));
  box.appendChild(frag);
}

function highlightPlaying(){
  document.querySelectorAll('.card').forEach(c=>{
    const on = current && c.dataset.uuid===current.stationuuid;
    c.classList.toggle('playing', !!on);
    const pb=c.querySelector('.c-play');
    if(pb) pb.textContent = on ? (audio.paused?'▶':'⏸') : '▶';
  });
}

// ---------- 数据加载 ----------
async function loadTop(){
  showStatus('加载热门电台…');
  try{
    const d=await api('/json/stations/topclick/60?hidebroken=true');
    renderStations(d);
    showStatus('');
  }catch(e){ showStatus(''); toast('加载失败，请检查网络'); }
}

function buildSearchQs(){
  const p=new URLSearchParams();
  if(filter.q) p.set('name', filter.q);
  if(filter.lang) p.set('language', filter.lang);
  if(filter.country) p.set('countrycode', filter.country);
  if(filter.tag) p.set('tag', filter.tag);
  p.set('limit','60');
  p.set('hidebroken','true');
  p.set('order','clickcount');
  p.set('reverse','true');
  return p.toString();
}

async function doSearch(){
  if(tab!=='search') return;
  showStatus('搜索中…');
  try{
    const d=await api('/json/stations/search?'+buildSearchQs());
    renderStations(d);
    showStatus('');
    if(!d.length) toast('没有结果，试试其他分类');
  }catch(e){ showStatus(''); toast('搜索失败'); }
}

function renderFavs(){
  if(!favs.length){ document.getElementById('results').innerHTML='<div class="empty">还没有收藏。点卡片上的 ☆ 即可收藏电台，收藏后即使断网也能播放已保存的电台。</div>'; return; }
  renderStations(favs);
}

// ---------- 播放 ----------
function stopHls(){ if(hls){ try{hls.destroy();}catch(e){} hls=null; } }

function playStation(s){
  stopHls();
  audio.pause();
  const url=s.url_resolved||s.url;
  current=s;
  if(!url){ toast('该电台没有可用地址'); return; }
  const isHls = s.hls===1 || /\.m3u8(\?.*)?$/i.test(url);
  if(isHls){
    if(audio.canPlayType('application/vnd.apple.mpegurl')){
      audio.src=url;
      audio.play().catch(()=>toast('播放被拦截，轻点屏幕后重试'));
    } else if(window.Hls && Hls.isSupported()){
      hls=new Hls();
      hls.loadSource(url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED,()=>audio.play().catch(()=>{}));
      hls.on(Hls.Events.ERROR,(ev,data)=>{
        if(data.fatal){
          if(data.type==='networkError'){ hls.startLoad(); }
          else { stopHls(); toast('该 HLS 流无法播放'); }
        }
      });
    } else {
      audio.src=url; audio.play().catch(()=>toast('当前浏览器不支持 HLS'));
    }
  } else {
    audio.src=url;
    audio.play().catch(()=>toast('播放失败，可能电台已离线'));
  }
  reportClick(s.stationuuid);
  showPlayer(s);
  highlightPlaying();
}

function showPlayer(s){
  const p=document.getElementById('player');
  document.getElementById('pIcon').src=s.favicon||'icon.svg';
  document.getElementById('pName').textContent=s.name||'未知电台';
  document.getElementById('pSub').textContent=[s.country,s.language,codecInfo(s)].filter(Boolean).join(' · ');
  document.getElementById('pToggle').textContent='⏸';
  document.getElementById('pVol').value=audio.volume;
  p.classList.remove('hidden');
}

function togglePlay(){
  if(!current) return;
  if(audio.paused) audio.play().catch(()=>{}); else audio.pause();
}

function toggleFav(s){
  if(isFav(s.stationuuid)){ favs=favs.filter(f=>f.stationuuid!==s.stationuuid); toast('已取消收藏'); }
  else {
    favs.push({
      stationuuid:s.stationuuid, name:s.name, url:s.url, url_resolved:s.url_resolved,
      favicon:s.favicon, country:s.country, language:s.language, codec:s.codec,
      bitrate:s.bitrate, hls:s.hls, tags:s.tags
    });
    toast('已收藏');
  }
  saveFavs();
  document.querySelectorAll('.card').forEach(c=>{
    if(c.dataset.uuid===s.stationuuid){
      const fb=c.querySelector('.c-fav'); const on=isFav(s.stationuuid);
      fb.classList.toggle('on',on); fb.textContent=on?'★':'☆';
    }
  });
  if(tab==='fav') renderFavs();
}

function showStatus(msg){
  if(msg) document.getElementById('results').innerHTML=`<div class="empty">${esc(msg)}</div>`;
}

// ---------- 事件绑定 ----------
function bind(){
  document.getElementById('tabs').addEventListener('click',e=>{
    const t=e.target.dataset.tab; if(!t) return;
    tab=t;
    document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
    const sp=document.getElementById('searchPanel');
    sp.classList.toggle('hidden', t!=='search');
    if(t==='top') loadTop();
    else if(t==='search') document.getElementById('results').innerHTML='<div class="empty">输入关键词，或选择下方语言 / 国家 / 分类，然后点“搜索”。</div>';
    else if(t==='fav') renderFavs();
  });
  document.getElementById('q').addEventListener('input',e=>{
    filter.q=e.target.value.trim();
    clearTimeout(window.__dt);
    window.__dt=setTimeout(doSearch,350);
  });
  document.getElementById('searchBtn').onclick=doSearch;
  document.getElementById('pToggle').onclick=togglePlay;
  document.getElementById('pVol').oninput=e=>{ audio.volume=parseFloat(e.target.value); };

  audio.addEventListener('playing',()=>{ document.getElementById('pToggle').textContent='⏸'; highlightPlaying(); });
  audio.addEventListener('pause',()=>{ document.getElementById('pToggle').textContent='▶'; highlightPlaying(); });
  audio.addEventListener('error',()=>{ toast('播放出错，可能电台已离线或网络受限'); });

  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
}

// ---------- 启动 ----------
renderChips();
bind();
loadTop();
