"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const LEADS = DATA.leads, META = DATA.meta, SALES = DATA.sales || [], B = DATA.build;
const TAX = B.tax_factor || 1.0;

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>(v==null||!isFinite(v))?'-':'R$ '+nf2.format(v);
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const dimf=v=>v==null?'-':String(v);
const norm=s=>(s==null?'':String(s)).trim().toLowerCase();
const brdate=d=>{ if(!d) return '-'; const p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const weekday=d=>{ const dt=new Date(d+'T00:00:00'); return isNaN(dt)?'':WD[dt.getDay()]; };

/* ---------------- date helpers ---------------- */
function pad(n){return String(n).padStart(2,'0');}
function dstr(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
function addDays(s,n){const dt=new Date(s+'T00:00:00');dt.setDate(dt.getDate()+n);return dstr(dt);}
const TODAY = B.today || B.date_max;

/* ---------------- STATE ---------------- */
const FUNIS = B.funis || ['APD-BR','APD-MUNDO','DIAG'];
const STATE = {
  page:'geral', from:B.date_min, to:B.date_max, preset:'todo', tax:true,
  selDays:new Set(),
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),
  filterFunil:'', filterTemp:'',
  sort:{}, colw: JSON.parse(localStorage.getItem('dm_colw')||'{}'),
  // granularidade por gráfico temporal (default diário; "Vendas & receita" mensal)
  gran:{ gVendas:'month', mVendas:'month', rVendas:'month' },
};
/* gráficos temporais que ganham o seletor de granularidade (id -> default) */
const TEMPORAL_CHARTS={ gVendas:'month', gAgd:'day', gCombo:'day',
  mVendas:'month', mAgd:'day', mCombo:'day', rVendas:'month', rAgd:'day', rCombo:'day' };
const taxf = ()=> STATE.tax ? TAX : 1;

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
/* filtro global de Funil (DIAG/APD-BR/APD-MUNDO) e Temperatura (Quente/Frio) —
   dropdowns na topbar, aplicados a todas as páginas (leads e mídia paga). */
function funilTempMatch(r){
  if(STATE.filterFunil && r.funil!==STATE.filterFunil) return false;
  if(STATE.filterTemp && r.temp!==STATE.filterTemp) return false;
  return true;
}
const leadsActive = ()=> LEADS.filter(l=>dateActive(l.d) && funilTempMatch(l));
const metaActive  = ()=> META.filter(m=>dateActive(m.d) && funilTempMatch(m));
/* Vendas ativas: filtradas pela DATA DA VENDA e pelo filtro global de funil/temp.
   Visão Geral usa TODAS; a página Meta Ads usa só as de tráfego pago (attributed). */
const salesActive = ()=> SALES.filter(s=>dateActive(s.d) && funilTempMatch(s));

/* ---------------- aggregation ---------------- */
function derive(a){
  const g=a.sp*taxf(), pv=a.pv||0;
  return {gasto:g, impr:a.im, clicks:a.cl, pv, leads:a.leads, mqls:a.mqls,
    cpm:a.im?g/a.im*1000:null, ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    cr:a.cl?pv/a.cl:null, cpv:pv?g/pv:null,
    convlp:pv?a.leads/pv:null,
    cpl:a.leads?g/a.leads:null, cpmql:a.mqls?g/a.mqls:null, tx:a.leads?a.mqls/a.leads:null};
}
/* --------- FUNIL: MQL → Agendamento → Venda (Faturamento/Receita) ---------
   Funil de High Ticket: Impressões → Cliques → Leads → MQLs → Agendamentos →
   Vendas → Faturamento/Receita. "Reunião Realizada" não existe como fonte
   própria (a planilha do comercial não distingue reunião de venda) — fica
   sempre "-"; se um dia vier, some `reunioes` em buildAgg/daily/totals que a
   UI acende sozinha. Faturamento ("faturamentoVenda") e Receita/Caixa
   ("caixaVenda") são rastreados em paralelo, cada um com seu ROAS/Ticket
   (espelha "ROAS (F)/(C)" e "Ticket Médio (F)/(C)" do relatório antigo). */
function salesOf(a){
  const g=(a?a.sp:0)*taxf();
  const mqls=(a&&a.mqls)||0;
  const agendamentos=(a&&a.agendamentos)||0, reunioes=(a&&a.reunioes)||0;
  const vendas=(a&&a.vendas)||0, fat=(a&&a.fat)||0, caixa=(a&&a.caixa)||0;
  const hasAg=agendamentos>0, hasRe=reunioes>0, hasVd=vendas>0||fat>0||caixa>0;
  return {
    // MQL → Agendamento
    agendamentos: hasAg?agendamentos:null,
    txag:         hasAg&&mqls?agendamentos/mqls:null,     // agendamentos / MQLs
    cpag:         hasAg?g/agendamentos:null,               // custo por agendamento
    // Agendamento → Reunião Realizada (sem fonte própria hoje -> "-")
    reunioes:     hasRe?reunioes:null,
    txnoshow:     hasRe&&hasAg?1-(reunioes/agendamentos):null,  // no-show = 1 - comparecimento
    cprr:         hasRe?g/reunioes:null,                   // custo por reunião realizada
    // Agendamento/Reunião → Venda
    vendas:       hasVd?vendas:null,
    txvenda:      hasVd&&hasRe?vendas/reunioes:null,       // vendas / reuniões realizadas
    cac:          hasVd&&vendas?g/vendas:null,
    convmql:      hasVd&&mqls?vendas/mqls:null,
    convagd:      hasVd&&hasAg?vendas/agendamentos:null,   // vendas / agendamentos
    // Faturamento (valor total do contrato/venda)
    fat:          hasVd?fat:null,
    roas:         hasVd&&g?fat/g:null,
    tm:           hasVd&&vendas?fat/vendas:null,
    // Receita / Caixa (valor efetivamente recebido)
    caixa:        hasVd?caixa:null,
    roascx:       hasVd&&g?caixa/g:null,
    tmcx:         hasVd&&vendas?caixa/vendas:null,
  };
}
/* Agregação — leads (contagem/MQL/agendamento), meta (gasto/impr/etc.) e sales
   (vendas/faturamento/caixa, já com data da venda e atribuição). fS é opcional. */
function buildAgg(fL,fM,fS,dim){
  const m={};
  const get=k=>m[k]||(m[k]={sp:0,im:0,cl:0,pv:0,leads:0,mqls:0,agendamentos:0,vendas:0,fat:0,caixa:0});
  fM.forEach(r=>{const a=get(r[dim]); a.sp+=r.sp; a.im+=r.im; a.cl+=r.cl; a.pv+=r.pv;});
  fL.forEach(r=>{const a=get(r[dim]); a.leads+=1; a.mqls+=r.q; a.agendamentos+=r.agd||0;});
  (fS||[]).forEach(r=>{ if(r[dim]==null) return; const a=get(r[dim]); a.vendas+=r.vendas||0; a.fat+=r.fat||0; a.caixa+=r.caixa||0;});
  return m;
}
function totals(fL,fM,fS){
  let sp=0,im=0,cl=0,pv=0; fM.forEach(r=>{sp+=r.sp;im+=r.im;cl+=r.cl;pv+=r.pv;});
  let mqls=0,agendamentos=0; fL.forEach(r=>{mqls+=r.q; agendamentos+=r.agd||0;});
  let vendas=0,fat=0,caixa=0; (fS||[]).forEach(r=>{vendas+=r.vendas||0; fat+=r.fat||0; caixa+=r.caixa||0;});
  return {sp, im, cl, pv, leads:fL.length, mqls, agendamentos, vendas, fat, caixa};
}
/* daily aggregation for leads/meta/sales — cada fonte cria o bucket do seu dia
   (a venda tem data própria: um dia com venda mas sem lead/gasto ainda aparece). */
function daily(fL,fM,fS){
  const days={}; const g=d=>days[d]||(days[d]={d, sp:0,im:0,cl:0,pv:0,leads:0,mqls:0,agendamentos:0,vendas:0,fat:0,caixa:0});
  fM.forEach(r=>{if(!r.d)return; const a=g(r.d); a.sp+=r.sp; a.im+=r.im; a.cl+=r.cl; a.pv+=r.pv;});
  fL.forEach(r=>{if(!r.d)return; const a=g(r.d); a.leads+=1; a.mqls+=r.q; a.agendamentos+=r.agd||0;});
  (fS||[]).forEach(r=>{if(!r.d)return; const a=g(r.d); a.vendas+=r.vendas||0; a.fat+=r.fat||0; a.caixa+=r.caixa||0;});
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
}
/* ---- granularidade temporal (estilo Looker Studio) ----
   Agrupa o array diário em dia/semana/mês/trimestre/semestre/ano, somando os
   campos crus. Semana/trimestre/semestre ficam SEMPRE presos ao mesmo ano (a
   chave carrega o ano — nunca junta virada de ano). */
const GRAN_OPTS=[['day','Diário'],['week','Semanal'],['month','Mensal'],['quarter','Trimestral'],['semester','Semestral'],['year','Anual']];
const MON_ABBR=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function isoWeek(dt){ const t=new Date(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate()));
  const day=t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-day);
  const ys=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil((((t-ys)/86400000)+1)/7); }
function granBucket(ds,gran){   // -> {key, sortKey, label} para o dia ISO ds
  const dt=new Date(ds+'T00:00:00'), y=dt.getFullYear();
  const yy=String(y).slice(2), mm=dt.getMonth();
  if(gran==='week'){ const w=isoWeek(dt); return {key:y+'-W'+pad(w), sortKey:ds, label:'Sem '+ds.slice(8)+'/'+ds.slice(5,7)}; }
  if(gran==='month'){ return {key:y+'-'+pad(mm+1), sortKey:y+'-'+pad(mm+1), label:MON_ABBR[mm]+'/'+yy}; }
  if(gran==='quarter'){ const q=Math.floor(mm/3)+1; return {key:y+'-Q'+q, sortKey:y+'-'+pad((q-1)*3+1), label:'T'+q+'/'+yy}; }
  if(gran==='semester'){ const s=mm<6?1:2; return {key:y+'-S'+s, sortKey:y+'-'+pad((s-1)*6+1), label:'S'+s+'/'+yy}; }
  if(gran==='year'){ return {key:''+y, sortKey:''+y, label:''+y}; }
  return {key:ds, sortKey:ds, label:ds.slice(5)};   // day
}
function rollup(dayArr, gran){
  if(!gran||gran==='day') return dayArr;
  const m={};
  dayArr.forEach(x=>{ if(!x.d) return; const b=granBucket(x.d,gran);
    const a=m[b.key]||(m[b.key]={d:x.d, sortKey:b.sortKey, label:b.label, sp:0,im:0,cl:0,pv:0,leads:0,mqls:0,agendamentos:0,vendas:0,fat:0,caixa:0});
    a.sp+=x.sp; a.im+=x.im; a.cl+=x.cl; a.pv+=x.pv; a.leads+=x.leads; a.mqls+=x.mqls;
    a.agendamentos+=x.agendamentos||0; a.vendas+=x.vendas||0; a.fat+=x.fat||0; a.caixa+=x.caixa||0;
    if(x.d<a.d) a.d=x.d;
  });
  return Object.values(m).sort((a,b)=>a.sortKey<b.sortKey?-1:1);
}
const granOf=id=> STATE.gran[id]||'day';


/* ---------------- generic interactive table ---------------- */
/* cfg: {id, cols:[{key,label,type,dim?,heat?:'gasto'|'leads'|'mqls',cls?}], rows:[{k,cells:{}, raw?}],
        total:{}, selectable, selSet, onSelect } */
// medição de texto (canvas) p/ auto-largura de coluna — "caiba o nome inteiro" (dim)
// e auto-ajuste em duplo-clique na borda, como Google Sheets / Looker Studio.
let _measureCtx=null;
function textWidth(s, font){
  if(!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  _measureCtx.font=font;
  return _measureCtx.measureText(s==null?'':String(s)).width;
}
const fmtStd=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='date'?brdate(v):t==='html'?'':dimf(v);
const FONT_DIM='500 12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_NUM='12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_HEAD='700 11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
function autoDimWidth(cfg,c){
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_DIM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_DIM); if(w>max) max=w; }
  return Math.max(140, Math.min(640, Math.round(max)+34)); // + padding (10+10) + folga p/ seta de ordenação
}
function autoColWidth(cfg,c){
  if(c.type==='dim') return autoDimWidth(cfg,c);
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_NUM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_NUM); if(w>max) max=w; }
  return Math.max(60, Math.min(260, Math.round(max)+24));
}
function colWidth(cfg,c){ const saved=(STATE.colw[cfg.id]||{})[c.key];
  if(saved) return saved;
  if(c.w) return c.w;
  if(c.type==='date') return 96;
  if(c.type==='dim') return autoDimWidth(cfg,c);   // por padrão, cabe o nome inteiro
  if(c.type==='brl') return 110;   // "R$ 1.487,42" não cabia nos 92px padrão (cortava com "…")
  return 92; }
function renderTable(cfg){
  const table=document.getElementById(cfg.id); if(!table) return;
  table.classList.toggle('dt-center', !!cfg.center);   // Mar01: dados centralizados
  table.classList.toggle('dt-centerall', !!cfg.centerAll);  // centraliza TAMBÉM as colunas dim (tabela diária)
  table.classList.toggle('dt-stick', !!cfg.stick);     // congela colunas à esquerda (stk:'l1'/'l2')
  const fit=!!cfg.fit;                                  // fit: cabe 100% da largura, sem scroll
  table.classList.toggle('dt-fit', fit);
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && c.type==='dim'){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  // métricas de custo sempre com "R$" (mesmo em tabelas densas/fit) — % nas de taxa, sem símbolo nas demais
  const fmt=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='date'?brdate(v):t==='html'?(v==null?'-':String(v)):dimf(v);
  const widths=fit?[]:cfg.cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
  // modo fit: dimensão/data com largura fixa; colunas numéricas dividem o resto por igual
  const fitW=c=> c.w?c.w+'px' : c.type==='date'?'74px' : c.type==='dim'?(c.big?'210px':'116px') : '';
  const colgroup='<colgroup>'+cfg.cols.map((c,i)=>{
    const w=fit?fitW(c):(widths[i]+'px'); return `<col${w?` style="width:${w}"`:''}>`;
  }).join('')+'</colgroup>';
  const esc=s=>String(s==null?'':s).replace(/"/g,'&quot;');
  const stkCls=c=>c.stk?' stk-'+c.stk:'';
  let thead='<thead><tr>'+cfg.cols.map((c,i)=>{
    const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
    return `<th class="${c.type==='dim'?'dim ':''}${sc}${stkCls(c)}" data-k="${c.key}" data-ci="${i}" title="${esc(c.label)}">${c.label}${fit?'':'<span class="rsz"></span>'}</th>`;
  }).join('')+'</tr></thead>';
  // title = valor SEMPRE completo (mesmo em fit, onde a célula pode abreviar/cortar) — passe o mouse p/ ver
  let tbody='<tbody>'+rows.map(r=>{
    const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
    const tds=cfg.cols.map(c=>{
      const v=r.cells[c.key]; let bg='';
      if(c.heat && ext[c.key]) bg=`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`;
      const cls=(c.type==='dim'?'dim':'')+(c.cls&&c.cls(r)?' '+c.cls(r):'')+stkCls(c);
      const ttl=c.type==='html'?'':` title="${esc(fmtStd(c.type,v))}"`;
      return `<td class="${cls}" style="${bg}"${ttl}>${fmt(c.type,v)}</td>`;
    }).join('');
    return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
  }).join('')+'</tbody>';
  let tfoot='';
  if(cfg.total){ tfoot='<tfoot><tr>'+cfg.cols.map((c,i)=>{
    const v=cfg.total[c.key]; const isFirst=i===0&&v==null;
    return `<td class="${c.type==='dim'?'dim':''}${stkCls(c)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=fit?'100%':totalW+'px';
  table.innerHTML=colgroup+thead+tbody+tfoot;
  const cols=table.querySelector('colgroup').children;
  // colunas congeladas à esquerda: calcula o deslocamento (left) de cada uma a
  // partir da largura acumulada das colunas anteriores (offset dinâmico, pois a
  // 1ª coluna tem largura automática/redimensionável — não dá pra fixar no CSS).
  function applyStickyLeft(){
    let acc=0;
    cfg.cols.forEach((c,i)=>{
      if(c.stk && c.stk[0]==='l'){ const off=acc; table.querySelectorAll('.stk-'+c.stk).forEach(cell=>{ cell.style.left=off+'px'; }); }
      acc+=cols[i].offsetWidth;
    });
  }
  applyStickyLeft();
  // sort handlers
  table.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderTable(cfg);
    });
  });
  // resize handlers (drag right border) -> resize the <col>, grow the table
  if(!fit) table.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, ci=+th.dataset.ci, x0=e.clientX;
      const w0=cols[ci].offsetWidth, tw0=table.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); cols[ci].style.width=nw+'px'; table.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw; applyStickyLeft(); };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; localStorage.setItem('dm_colw',JSON.stringify(STATE.colw)); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
    // duplo-clique na borda = auto-ajustar largura ao conteúdo (como Sheets/Looker)
    g.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, c=cfg.cols.find(x=>x.key===k);
      const nw=autoColWidth(cfg,c);
      STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
      localStorage.setItem('dm_colw',JSON.stringify(STATE.colw));
      renderTable(cfg);
    });
  });
  // row select
  if(cfg.selectable && cfg.onSelect){
    table.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
  // hook pós-renderização (roda de novo em CADA re-render, inclusive ao ordenar,
  // pra chips/cores customizados nunca sumirem ao clicar num cabeçalho)
  if(cfg.afterRender) cfg.afterRender(table, rows);
}
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante). */
const HEAT_HUE={gasto:'--heat-gasto', leads:'--heat-leads', mqls:'--heat-mqls',
  cpl:'--heat-cpl', cpmql:'--heat-cpmql', cpag:'--heat-cpag', vendas:'--heat-vendas',
  rec:'--heat-rec', fat:'--heat-rec'};
function heat(v,lo,hi,kind){
  if(v==null||!isFinite(v)||hi===lo||!HEAT_HUE[kind]) return 'transparent';
  const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  const c=hx2rgb(cvar(HEAT_HUE[kind]));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.06+0.5*t).toFixed(3)})`;
}
function toggleSet(set,key,ctrl,others){
  if(ctrl){ set.has(key)?set.delete(key):set.add(key); }
  else { const only=set.has(key)&&set.size===1; set.clear(); if(!only) set.add(key); }
  if(others) others.forEach(s=>s.clear());
}

/* ---------------- funil ----------------
   Cada step: [label, valor, secs[], na?, hlClass].
   Cada sec: [label, valor, kind] — kind 'cost' vai p/ a DIREITA, 'conv' (default)
   p/ a ESQUERDA. Nunca quebra linha (CSS .secs nowrap). */
function funnelHTML(steps){ return steps.map(s=>{
    const secs=(s[2]||[]).slice().sort((a,b)=>((a[2]==='cost')?1:0)-((b[2]==='cost')?1:0));
    return `<div class="step ${s[3]?'na':''} ${s[4]||''}"><div class="step-main"><div class="m-label">${s[0]}</div><div class="m-val">${s[1]}</div></div>`
      +`<div class="secs">${secs.map(x=>`<div class="sec ${x[2]==='cost'?'is-cost':'is-conv'}"><span class="s-label">${x[0]}</span><span class="s-val">${x[1]}</span></div>`).join('')}</div></div>`;
  }).join(''); }
/* Constrói os steps do funil de High Ticket a partir dos totais. Reusado em
   Visão Geral, Meta Ads e Acumulado por Funil (opts.meta acrescenta Frequência/
   ConvMQL da página de mídia). Custos marcados 'cost' (direita); taxas/ROAS/
   Ticket ficam à esquerda. Faturamento e Receita realçados em VERDE. */
function buildFunnelSteps(t, dv, s, opts){
  opts=opts||{};
  const NA='<span class="na-tag">sem dado</span>';
  const imprSecs=[['CPM',brl(dv.cpm),'cost']];
  if(opts.meta) imprSecs.push(['Frequência',NA,'conv']);
  // Card de Vendas: só ConvAGD (ConvMQL removido a pedido) + CAC.
  const vendaSecs=[['ConvAGD',pct(s.convagd),'conv'],['CAC',brl(s.cac),'cost']];
  return [
    ['Gasto Total', brl(dv.gasto), [], false, 'hl-gasto'],
    ['Impressões', intf(t.im), imprSecs],
    ['Cliques', intf(t.cl), [['CTR',pct(dv.ctr),'conv'],['CPC',brl(dv.cpc),'cost']]],
    ['Page Views', intf(t.pv), [['CR',pct(dv.cr),'conv'],['CPV',brl(dv.cpv),'cost']]],
    ['Leads', intf(t.leads), [['ConvLP',pct(dv.convlp),'conv'],['CPL',brl(dv.cpl),'cost']]],
    ['MQLs (Score 10 ou QLF)', intf(t.mqls), [['Tx‑MQL',pct(dv.tx),'conv'],['CPMQL',brl(dv.cpmql),'cost']], false, 'hl-mql'],
    ['Agendamentos', intf(s.agendamentos), [['Tx‑AGD',pct(s.txag),'conv'],['CPAGD',brl(s.cpag),'cost']]],
    ['Vendas', intf(s.vendas), vendaSecs, false, 'hl-mql'],
    ['Faturamento', brl(s.fat), [['ROAS‑F',numf(s.roas),'conv'],['TM‑F',brl(s.tm),'conv']], false, 'hl-fat'],
    ['Receita (Caixa)', brl(s.caixa), [['ROAS‑R',numf(s.roascx),'conv'],['TM‑R',brl(s.tmcx),'conv']], false, 'hl-rec'],
  ];
}

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.label||x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const cLeads=cvar('--chart-leads'), cMqls=cvar('--chart-mqls'), cGasto=cvar('--chart-gasto'), cCpl=cvar('--chart-cpl')||cink(), cCpmql=cvar('--chart-cpmql');
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Leads',data:d.map(x=>x.leads),backgroundColor:cLeads,yAxisID:'y',borderRadius:3,order:3},
      {type:'bar',label:'MQLs',data:d.map(x=>x.mqls),backgroundColor:cMqls,yAxisID:'y',borderRadius:3,order:3},
      {type:'line',label:'Gasto',data:d.map(x=>+(x.sp*taxf()).toFixed(2)),borderColor:cGasto,backgroundColor:cGasto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:1},
      {type:'line',label:'CPL',data:d.map(x=>x.leads?+((x.sp*taxf())/x.leads).toFixed(2):null),borderColor:cCpl,backgroundColor:cCpl,yAxisID:'y2',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,order:0},
      {type:'line',label:'CPMQL',data:d.map(x=>x.mqls?+((x.sp*taxf())/x.mqls).toFixed(2):null),borderColor:cCpmql,backgroundColor:cCpmql,yAxisID:'y2',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,order:0},
    ]},
    // y1 = Gasto (grande); y2 = CPL/CPMQL num eixo PRÓPRIO (escala menor, oculto)
    // para a linha de custo por lead/MQL não ficar achatada no rodapé do gráfico.
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y'?intf(v):brl(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10}},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Leads / MQLs',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10},callback:v=>'R$'+nf0.format(v)},grid:{display:false},beginAtZero:true,title:{display:true,text:'Gasto (R$)',color:mut,font:{size:10}}},
        y2:{position:'right',display:false,beginAtZero:true}}}
  });
}
/* ---- Gráfico misto genérico (barras + linhas, múltiplos eixos) ----
   series[]: {label,type:'bar'|'line',axis,fn:(dia)=>valor,color,fmt}. Eixos:
   count(esq, contagem) · money(dir, R$ grande) · moneySmall(oculto, R$ pequeno:
   CAC/CPAGD/CPMQL) · ratio(oculto, ROAS/número). Custos/razões ganham eixo próprio
   pra não ficarem achatados sob o Gasto. */
function mixChart(id, d, series){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.label||x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const axisDefs={
    count:{position:'left',beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:gr}},
    money:{position:'right',beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>'R$'+nf0.format(v)},grid:{display:false}},
    moneySmall:{position:'right',display:false,beginAtZero:true},
    ratio:{position:'right',display:false,beginAtZero:true},
  };
  const scales={x:{ticks:{color:mut,font:{size:10}},grid:{display:false}}};
  series.forEach(s=>{ if(!scales[s.axis]) scales[s.axis]=axisDefs[s.axis]; });
  const datasets=series.map(s=>{
    const base={type:s.type,label:s.label,data:d.map(s.fn),yAxisID:s.axis,backgroundColor:s.color,borderColor:s.color,spanGaps:true,tension:.25};
    if(s.type==='bar'){ base.borderRadius=3; base.order=3; }
    else { base.borderWidth=2; base.pointRadius=2; base.order=1; }
    return base;
  });
  charts[id]=new Chart(el,{data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:10}}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': '+series[c.datasetIndex].fmt(c.raw)}}},
      scales}});
}
/* Gráficos dedicados: Vendas & receita · Agendamentos (MQLs removido a pedido).
   Cada um respeita sua própria granularidade (rollup por id). A etapa vem em
   BARRAS e as métricas de apoio em LINHAS. */
function renderDailyMixes(vId,aId,d){
  const g=x=>+(x.sp*taxf()).toFixed(2);
  const cv=n=>cvar(n);
  // ORDEM das séries = ordem do TOOLTIP e da legenda (pedido do cliente):
  // Gasto · Vendas · CAC · Receita · TM‑R · ROAS‑R · Faturamento · TM‑F · ROAS‑F.
  mixChart(vId, rollup(d,granOf(vId)), [
    {label:'Gasto',type:'line',axis:'money',color:cv('--chart-gasto'),fn:g,fmt:brl},
    {label:'Vendas',type:'bar',axis:'count',color:cv('--chart-leads'),fn:x=>x.vendas||null,fmt:intf},
    {label:'CAC',type:'line',axis:'moneySmall',color:cv('--chart-cpl'),fn:x=>x.vendas?+(g(x)/x.vendas).toFixed(2):null,fmt:brl},
    {label:'Receita',type:'line',axis:'money',color:cv('--good'),fn:x=>x.caixa||null,fmt:brl},
    {label:'TM‑R',type:'line',axis:'money',color:cv('--cc6'),fn:x=>x.vendas?+(x.caixa/x.vendas).toFixed(2):null,fmt:brl},
    {label:'ROAS‑R',type:'line',axis:'ratio',color:cv('--cc5'),fn:x=>{const s=x.sp*taxf();return s?+(x.caixa/s).toFixed(2):null;},fmt:numf},
    {label:'Faturamento',type:'line',axis:'money',color:cv('--aqua'),fn:x=>x.fat||null,fmt:brl},
    {label:'TM‑F',type:'line',axis:'money',color:cv('--cc8'),fn:x=>x.vendas?+(x.fat/x.vendas).toFixed(2):null,fmt:brl},
    {label:'ROAS‑F',type:'line',axis:'ratio',color:cv('--cc9'),fn:x=>{const s=x.sp*taxf();return s?+(x.fat/s).toFixed(2):null;},fmt:numf},
  ]);
  mixChart(aId, rollup(d,granOf(aId)), [
    {label:'Agendamentos',type:'bar',axis:'count',color:cv('--cc4'),fn:x=>x.agendamentos||null,fmt:intf},
    {label:'Gasto',type:'line',axis:'money',color:cv('--chart-gasto'),fn:g,fmt:brl},
    // CPAGD em PRETO (contraste com a barra âmbar) — --chart-cpl é quase-preto no
    // tema claro e quase-branco no escuro (visível nos dois).
    {label:'CPAGD',type:'line',axis:'moneySmall',color:cv('--chart-cpl'),fn:x=>x.agendamentos?+(g(x)/x.agendamentos).toFixed(2):null,fmt:brl},
  ]);
}
function hbar(id, items, valFn, colorFn, top, unit){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  unit=unit||'leads';
  let arr=items.slice().sort((a,b)=>valFn(b)-valFn(a)); if(top) arr=arr.slice(0,top);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabels],
    data:{labels:arr.map(x=>x.label), datasets:[{label:unit,data:arr.map(valFn),backgroundColor:arr.map(colorFn||(()=>cvar('--chart-leads'))),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:28}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>intf(c.raw)+' '+unit}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10}},grid:{display:false}}}}});
}
/* distribuição: conta leads por resposta de um campo e desenha barras horizontais */
function distBars(id, fL, field, colorVar, top){
  const m={}; fL.forEach(l=>{ const k=(l[field]==null||l[field]==='')?'Sem resposta':l[field]; m[k]=(m[k]||0)+1; });
  hbar(id, Object.entries(m).map(([label,leads])=>({label,leads})), x=>x.leads, ()=>cvar(colorVar), top||10);
}
const barLabels={id:'barLabels',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(!v)return; ctx.fillText(intf(v),el.x+5,el.y);});ctx.restore();}};
function lineChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted();
  const cCpmql=cvar('--chart-cpmql'), cCpl=cvar('--chart-cpl')||cink();
  charts[id]=new Chart(el,{type:'line',
    data:{labels,datasets:[
      {label:'CPMQL',data:d.map(x=>x.mqls?+((x.sp*taxf())/x.mqls).toFixed(2):null),borderColor:cCpmql,backgroundColor:cCpmql,borderWidth:2,pointRadius:2,spanGaps:true,tension:.25},
      {label:'CPL',data:d.map(x=>x.leads?+((x.sp*taxf())/x.leads).toFixed(2):null),borderColor:cCpl,backgroundColor:cCpl,borderWidth:2,pointRadius:2,spanGaps:true,tension:.25},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+brl(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},y:{ticks:{color:mut,font:{size:9}},grid:{color:cgrid()},beginAtZero:true}}}});
}

/* Donut de taxa de qualificação (Mar02): verde = MQL · vermelho = desqualificado */
function donutQlf(id, mqls, leads){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const dsq=Math.max(0,leads-mqls);
  charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:['MQL (qualificado)','Desqualificado'],datasets:[{data:[mqls,dsq],
      backgroundColor:[cvar('--good'),cvar('--bad')],borderColor:cvar('--surface'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+intf(c.raw)+(leads?' ('+pct(c.raw/leads)+')':'')}}}}});
  const el2=document.getElementById('mQlfPct'); if(el2) el2.textContent=pct(leads?mqls/leads:null);
}
/* Mar03/Mar10: MQLs por dimensão (campanha/conjunto/anúncio) por dia — 1 linha por membro.
   Legenda é um painel HTML próprio (fora do canvas) — a legenda NATIVA do Chart.js
   quebra/trunca nomes longos porque respeita a largura do canvas; a nossa não.
   Formato de cada linha: [quadrado da cor] Nome completo da campanha ... CPMQL.
   Clique numa linha da legenda OU numa linha do gráfico filtra a tabela (selDim);
   quando a tabela já tem seleção (STATE.mSel*), o gráfico plota SÓ as linhas
   selecionadas (a legenda continua listando todas p/ dar pra trocar a seleção). */
function mqlByDimChart(id, fL, fM, agg, dim, selSet){
  destroy(id); const el=document.getElementById(id); const legEl=document.getElementById(id+'Legend');
  if(!el) return;
  const days=[...new Set([...fL,...fM].filter(r=>r.d).map(r=>r.d))].sort();
  // ordena por CPMQL (melhor primeiro; sem MQL/gasto fica no fim) — ordem estável p/ cor e legenda
  const members=[...new Set(fL.map(r=>r[dim]))].sort((a,b)=>{
    const ca=agg[a]?derive(agg[a]).cpmql:null, cb=agg[b]?derive(agg[b]).cpmql:null;
    if(ca==null&&cb==null) return 0; if(ca==null) return 1; if(cb==null) return -1; return ca-cb;
  });
  const pal=chartPalette(), mut=cmuted();
  const dimChar={'camp':'C','adset':'A','ad':'D'}[dim]||'C';
  // com seleção ativa nesta MESMA dimensão, o GRÁFICO plota só as linhas selecionadas
  // (a legenda abaixo continua mostrando todos os membros, pra dar pra trocar a seleção)
  const plotMembers = (selSet&&selSet.size) ? members.filter(m=>selSet.has(m)) : members;
  // métrica do gráfico: CUSTO POR MQL por dia (gasto do dia / MQLs do dia), não contagem
  const dsets=plotMembers.map(mv=>{
    const idx=members.indexOf(mv);
    const spDay={}, mqlDay={}; days.forEach(d=>{spDay[d]=0; mqlDay[d]=0;});
    fM.forEach(r=>{ if(r[dim]===mv && r.d!=null && spDay[r.d]!=null) spDay[r.d]+=r.sp; });
    fL.forEach(r=>{ if(r[dim]===mv && r.d!=null && mqlDay[r.d]!=null) mqlDay[r.d]+=r.q; });
    const data=days.map(d=> mqlDay[d]>0 ? +((spDay[d]*taxf())/mqlDay[d]).toFixed(2) : null);
    const col=pal[idx%pal.length];
    return {label:String(mv), data, borderColor:col, backgroundColor:col, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true};
  });
  charts[id]=new Chart(el,{type:'line',
    data:{labels:days.map(d=>d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
      // clique em qualquer ponto/linha do gráfico filtra igual clicar na linha da tabela
      onClick:(e,act)=>{ if(act.length){ const idx=act[0].datasetIndex;
        if(idx!=null&&dsets[idx]) selDim(dimChar,dsets[idx].label,false); } },
      plugins:{
        legend:{display:false},   // legenda nativa desligada — usamos o painel HTML abaixo
        // tooltip: nome COMPLETO do dataset (nunca o rótulo do eixo X) + CPMQL do dia.
        // usa array (2 linhas por item) — o Chart.js NUNCA corta/trunca texto do tooltip.
        tooltip:{displayColors:true,
          callbacks:{title:()=>'', label:c=>[c.dataset.label, (c.raw==null?'-':brl(c.raw))+' / MQL']}}
      },
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()},beginAtZero:true}}
    }
  });
  // painel de legenda HTML: quadrado da cor | nome completo (1 linha, nunca corta) | CPMQL
  if(legEl){
    legEl.innerHTML = members.map((mv,idx)=>{
      const col=pal[idx%pal.length];
      const cpmql = agg[mv]!=null ? derive(agg[mv]).cpmql : null;
      const sel = !!(selSet && selSet.has(mv));
      return `<div class="cl-row${sel?' sel':''}" data-mv="${escHtml(mv)}" title="${escHtml(mv)}">`
        +`<span class="cl-swatch" style="background:${col}"></span>`
        +`<span class="cl-name">${escHtml(mv)}</span>`
        +`<span class="cl-val">${brl(cpmql)}</span></div>`;
    }).join('');
    legEl.querySelectorAll('.cl-row').forEach(row=>{
      row.addEventListener('click',()=>selDim(dimChar,row.dataset.mv,false));
    });
  }
}

/* ---------------- KPI cards ---------------- */
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

/* ---------------- PAGE 1: Visão Geral ---------------- */
/* IDs dos elementos por página — a Visão Geral e o Relatório compartilham o
   MESMO corpo (renderGeralCore), só mudam os alvos no DOM. */
const GERAL_IDS={funnel:'geralFunnel',kpis2:'geralKpis2',combo:'gCombo',vendas:'gVendas',agd:'gAgd',mql:'gMql',
  pais:'gPais',estado:'gEstado',momento:'gMomento',exp:'gExp',resultado:'gResultado',investir:'gInvestir',retorno:'gRetorno',daily:'gDaily'};
const REL_IDS  ={funnel:'relFunnel', kpis2:'relKpis2', combo:'rCombo',vendas:'rVendas',agd:'rAgd',mql:'rMql',
  pais:'rPais',estado:'rEstado',momento:'rMomento',exp:'rExp',resultado:'rResultado',investir:'rInvestir',retorno:'rRetorno',daily:'rDaily'};
function renderGeral(){ renderGeralCore(GERAL_IDS); renderFunilSegments(); }
/* Segmentação por funil (Visão Geral Total): abaixo do acumulado total, um
   card compacto por funil (APD-BR / APD-MUNDO / DIAG) com os mesmos KPIs
   principais — respeita o filtro global de funil/temperatura e o período
   ativo (mesma base leadsActive()/metaActive() da Visão Geral). */
function renderFunilSegments(){
  const host=document.getElementById('geralFunis'); if(!host) return;
  const fL=leadsActive(), fM=metaActive(), fS=salesActive();
  host.innerHTML = FUNIS.map(fn=>{
    const sL=fL.filter(l=>l.funil===fn), sM=fM.filter(m=>m.funil===fn), sS=fS.filter(s=>s.funil===fn);
    const t=totals(sL,sM,sS), dv=derive(t), s=salesOf(t);
    return `<div class="card funil-seg-card"><h3>${fn}</h3><div class="funnel">${funnelHTML(buildFunnelSteps(t,dv,s))}</div></div>`;
  }).join('');
}
function renderGeralCore(ids){
  const fL=leadsActive(), fM=metaActive(), fS=salesActive();
  const fSp=fS.filter(x=>x.attributed);   // vendas de tráfego pago (p/ atribuição por anúncio)
  const t=totals(fL,fM,fS), dv=derive(t), s=salesOf(t), g=dv.gasto;
  const leadsAds=fL.filter(l=>l.src==='meta'||l.src==='google');
  const nAds=leadsAds.length, mqlsAds=leadsAds.reduce((s,r)=>s+r.q,0);
  const nOrg=fL.filter(l=>l.src==='org').length;
  const semUtm=fL.filter(l=>!l.utm).length, comUtm=t.leads-semUtm;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(buildFunnelSteps(t,dv,s));
  // ---- Mar05: métricas secundárias mais úteis (não repetem o funil) ----
  const dd=daily(fL,fM,fS), nDays=dd.length||1;
  const adAgg=buildAgg(fL,fM,fSp,'ad');
  let topAd=null, bestAd=null, nAdsAtivos=0;
  Object.entries(adAgg).forEach(([ad,a])=>{
    if(a.sp>0) nAdsAtivos++;
    if(topAd==null||a.mqls>topAd.m) topAd={ad,m:a.mqls};
    if(a.mqls>0){ const cq=(a.sp*taxf())/a.mqls; if(bestAd==null||cq<bestAd.v) bestAd={ad,v:cq}; }
  });
  const nCampAtivas=Object.values(buildAgg(fL,fM,[],'camp')).filter(a=>a.sp>0).length;
  const concTop=(t.mqls&&topAd)?topAd.m/t.mqls:null;
  const adShort=s=>{ s=String(s||'—'); return s.length>22?s.slice(0,21)+'…':s; };
  const k2=[
    {label:'MQLs por dia (média)',val:numf(t.mqls/nDays),aux:numf(t.leads/nDays)+' leads/dia'},
    {label:'Melhor CPMQL (anúncio)',val:bestAd?brl(bestAd.v):'-',aux:bestAd?adShort(bestAd.ad):'—'},
    {label:'Top anúncio (MQLs)',val:topAd?intf(topAd.m):'-',aux:topAd?adShort(topAd.ad):'—'},
    {label:'Concentração top anúncio',val:pct(concTop),aux:'% dos MQLs no melhor anúncio'},
    {label:'Anúncios ativos',val:intf(nAdsAtivos),aux:intf(nCampAtivas)+' campanhas c/ gasto'},
    {label:'% Eficácia Rastr.',val:pct(t.leads?comUtm/t.leads:null),aux:'Leads c/ UTM / Leads'},
    {label:'Leads Orgânicos',val:intf(nOrg),aux:'sem fonte paga'},
    {label:'Proporção Org:Ads',val:nOrg?numf(nAds/nOrg)+':1':(nAds?'∞':'-'),aux:'Ads por orgânico'},
    {label:'Receita (Caixa)',val:brl(s.caixa),aux:'valor efetivamente recebido'},
    {label:'ROAS (Caixa)',val:numf(s.roascx),aux:'Receita / Gasto'},
    {label:'Ticket Médio (Caixa)',val:brl(s.tmcx),aux:'Receita / Vendas'},
    {label:'Ticket Médio (Faturamento)',val:brl(s.tm),aux:'Faturamento / Vendas'},
  ];
  document.getElementById(ids.kpis2).innerHTML=k2.map(kpiCard).join('');
  const dCombo=daily(fL,fM,fS);
  comboChart(ids.combo, rollup(dCombo,granOf(ids.combo)));
  renderDailyMixes(ids.vendas, ids.agd, dCombo);
  // Distribuição de leads (4.1): respostas do formulário, aproveitando melhor os
  // campos coletados. Cada gráfico = contagem de leads por resposta (top 10).
  distBars(ids.pais, fL, 'pais', '--chart-leads', 10);
  distBars(ids.estado, fL, 'estado', '--chart-leads', 10);
  distBars(ids.momento, fL, 'momento', '--chart-mqls', 10);
  distBars(ids.exp, fL, 'exp', '--chart-mqls', 10);
  distBars(ids.resultado, fL, 'resultado', '--cc6', 10);
  distBars(ids.investir, fL, 'investir', '--cc4', 10);
  distBars(ids.retorno, fL, 'retorno', '--aqua', 10);
  // tabela diaria (todos os leads), ultimo dia no topo + heatmap
  const dl=daily(fL,fM,fS).slice().reverse();
  renderTable({id:ids.daily, cols:DAILY_COLS, center:true, centerAll:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}
/* ---------------- PAGE 3: Relatório ----------------
   Espelha a Visão Geral (renderGeralCore com IDs próprios) e, abaixo, acrescenta
   Top Anúncios · Piores Anúncios · Briefing do Gestor. */
const AD_LINKS = DATA.ad_links || {};
const SAMPLE_MIN_SPEND = (B.sample_min_spend!=null?B.sample_min_spend:100);
const SAMPLE_MIN_MQLS  = (B.sample_min_mqls!=null?B.sample_min_mqls:3);
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---- Metas & parâmetros (painel editável) — ajusta cores/amostra AO VIVO ----
   Defaults vêm do build.py; o usuário edita no painel (persistido em
   localStorage 'dm_metas') e as tabelas de anúncio recoram CPMQL/CAC e reavaliam
   a amostra na hora. Meta null = "não definida" (métrica fica sem cor). */
const METAS_DEFAULT = {
  cpagd: (B.meta_cpagd!=null?B.meta_cpagd:null),
  cac:   (B.meta_cac!=null?B.meta_cac:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:SAMPLE_MIN_MQLS),
};
function loadMetas(){
  let saved={}; try{ saved=JSON.parse(localStorage.getItem('dm_metas')||'{}'); }catch(e){}
  const m={...METAS_DEFAULT};
  ['cpagd','cac'].forEach(k=>{ if(saved[k]!=null&&isFinite(saved[k])) m[k]=saved[k]; else if(k in saved && saved[k]===null) m[k]=null; });
  if(saved.volMin!=null&&isFinite(saved.volMin)&&saved.volMin>=1) m.volMin=saved.volMin;
  return m;
}
const METAS = loadMetas();
function saveMetas(){ try{ localStorage.setItem('dm_metas', JSON.stringify(METAS)); }catch(e){} }
/* código de cor de um CUSTO vs meta (menor=melhor): verde ≤ meta; amarelo até
   meta×1,3 (atenção); vermelho acima (teto). Meta não definida => sem cor. */
function metaColorClass(v, meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v<=meta) return 'mc-green';
  if(v<=meta*1.3) return 'mc-yellow';
  return 'mc-red';
}

function adLinkCell(name){ const u=AD_LINKS[name];
  return u?`<a class="rel-adlink" href="${escHtml(u)}" target="_blank" rel="noopener">Abrir ▸</a>`:'<span class="rel-adlink off">—</span>'; }

/* ad -> (campanha, conjunto) dominantes por gasto no Meta (fallback: lead).
   Um anúncio pode rodar em mais de uma campanha/conjunto; fica com a combinação
   de maior gasto. */
function adStructMap(fM,fL){
  const acc={};
  fM.forEach(r=>{ const byCamp=acc[r.ad]=acc[r.ad]||{};
    const byAdset=byCamp[r.camp]=byCamp[r.camp]||{};
    byAdset[r.adset]=(byAdset[r.adset]||0)+r.sp; });
  const out={};
  Object.entries(acc).forEach(([ad,byCamp])=>{
    let best=null;
    Object.entries(byCamp).forEach(([camp,byAdset])=>{
      Object.entries(byAdset).forEach(([adset,sp])=>{
        if(!best||sp>best.sp) best={camp,adset,sp};
      });
    });
    out[ad]={camp:best.camp,adset:best.adset};
  });
  fL.forEach(r=>{ if(!out[r.ad]) out[r.ad]={camp:r.camp,adset:r.adset}; });
  return out;
}
/* amostra relevante para JULGAR o anúncio (senão: "Em observação"). O limiar de
   MQLs vem do painel de metas (volume mínimo amostral), editável ao vivo. */
function adSampleOk(a){ return a.sp>=SAMPLE_MIN_SPEND && a.mqls>=METAS.volMin; }
/* qualidade pelo resultado MAIS PROFUNDO disponível (venda>reunião>agendamento>MQL>lead):
   tier alto = etapa mais profunda; dentro do tier, mais volume e menor custo = melhor. */
function adQuality(a){
  const d=derive(a), s=salesOf(a);
  if(s.vendas!=null)        return {tier:4, vol:s.vendas,       cost:s.cac==null?Infinity:s.cac};
  if(s.reunioes!=null)      return {tier:3, vol:s.reunioes,     cost:s.cprr==null?Infinity:s.cprr};
  if(s.agendamentos!=null)  return {tier:2, vol:s.agendamentos, cost:s.cpag==null?Infinity:s.cpag};
  if(a.mqls>0)              return {tier:1, vol:a.mqls,         cost:d.cpmql==null?Infinity:d.cpmql};
  return                           {tier:0, vol:a.leads,        cost:d.cpl==null?Infinity:d.cpl};
}
function cmpBest(a,b){ const qa=adQuality(a), qb=adQuality(b);   // <0 => a antes (melhor)
  if(qa.tier!==qb.tier) return qb.tier-qa.tier;
  if(qa.vol!==qb.vol)   return qb.vol-qa.vol;
  return qa.cost-qb.cost; }

/* 22 colunas pedidas pelo cliente + coluna própria de Status (amostra).
   Anúncio/Status ficam FIXOS à esquerda e Link FIXO à direita (position:sticky
   em .rel-adt), então dão pra ver sem rolar lateralmente — só as métricas do
   meio rolam. Larguras em px casam com o CSS (.rel-adt .stk-*). */
const AD_COLS=[
  {k:'ad',label:'Anúncio',dim:true,stk:'l1'},{k:'status',label:'Status',dim:true,stk:'l2'},
  {k:'camp',label:'Campanha',dim:true},{k:'adset',label:'Conjunto',dim:true},
  {k:'gasto',label:'Gasto'},{k:'im',label:'Impr.'},{k:'cpm',label:'CPM'},{k:'ctr',label:'CTR'},
  {k:'leads',label:'Leads'},{k:'cpl',label:'CPL'},{k:'mqls',label:'MQLs'},{k:'tx',label:'Tx‑MQL'},{k:'cpmql',label:'CPMQL'},
  {k:'agendamentos',label:'Agendamentos'},{k:'txag',label:'Tx‑Agend.'},{k:'cpag',label:'CPAG'},
  {k:'reunioes',label:'Reuniões'},{k:'noshow',label:'No‑Show'},{k:'cprr',label:'CPRR'},
  {k:'vendas',label:'Vendas'},{k:'cac',label:'CAC'},{k:'fat',label:'Faturamento'},{k:'roas',label:'ROAS'},
  {k:'link',label:'Link',dim:true,stk:'r'},
];
function adRowCells(ad,a,struct){
  const d=derive(a), s=salesOf(a);
  return {ad, camp:struct.camp, adset:struct.adset,
    gasto:d.gasto, im:a.im, cpm:d.cpm, ctr:d.ctr,
    leads:a.leads, cpl:d.cpl, mqls:a.mqls, tx:d.tx, cpmql:d.cpmql,
    agendamentos:s.agendamentos, txag:s.txag, cpag:s.cpag,
    reunioes:s.reunioes, noshow:s.txnoshow, cprr:s.cprr,
    vendas:s.vendas, cac:s.cac, fat:s.fat, roas:s.roas,
    link:adLinkCell(ad),
    _cpag:s.cpag, _cac:s.cac, status:null};   // valores crus p/ colorir vs meta
}
const statusChip=obs=>obs?'<span class="rel-chip c-yellow">Em observação</span>':'<span class="rel-chip c-green">Avaliável</span>';
function relRenderAdTable(id,list){
  const el=document.getElementById(id); if(!el) return;
  const cols=[
    {key:'ad',label:'Anúncio',type:'dim',big:true,stk:'l1'},{key:'status',label:'Status',type:'dim',w:140},
    {key:'camp',label:'Campanha',type:'dim',big:true},{key:'adset',label:'Conjunto',type:'dim',big:true},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'im',label:'Impr.',type:'int'},
    {key:'cpm',label:'CPM',type:'brl'},{key:'ctr',label:'CTR',type:'pct'},
    {key:'leads',label:'Leads',type:'int'},{key:'cpl',label:'CPL',type:'brl'},
    {key:'mqls',label:'MQLs',type:'int'},{key:'tx',label:'Tx‑MQL',type:'pct'},
    {key:'cpmql',label:'CPMQL',type:'brl'},
    {key:'agendamentos',label:'Agendamentos',type:'int'},
    {key:'txag',label:'Tx‑Agend.',type:'pct'},
    {key:'cpag',label:'CPAG',type:'brl'},
    {key:'reunioes',label:'Reuniões',type:'int'},
    {key:'noshow',label:'No‑Show',type:'pct'},
    {key:'cprr',label:'CPRR',type:'brl'},
    {key:'vendas',label:'Vendas',type:'int'},
    {key:'cac',label:'CAC',type:'brl'},
    {key:'fat',label:'Faturamento',type:'brl'},
    {key:'roas',label:'ROAS',type:'num'},
    {key:'link',label:'Link',type:'html',w:90,stk:'r'},
  ];
  const rows=list.map(item=>{
    const cells=adRowCells(item.ad,item.a,item.struct);
    cells.status='';  // placeholder textual; o chip real entra via afterRender
    return {k:item.ad, cells, _obs:item.obs, _cpag:cells._cpag, _cac:cells._cac};
  });
  renderTable({
    id, cols, rows, center:true,   // Mar10: só as MÉTRICAS centralizam; dim fica à esquerda (CSS .dt-center)
    // roda em TODA renderização (inclusive ao ordenar por um cabeçalho) — chip de
    // status e cores de meta (CPMQL/CAC) nunca mais somem ao clicar pra ordenar
    afterRender:(table,sortedRows)=>{
      table.querySelectorAll('tbody tr').forEach((tr,idx)=>{
        const item=sortedRows[idx]; if(!item) return;
        const tds=tr.querySelectorAll('td');
        cols.forEach((c,ci)=>{
          if(ci>=tds.length) return;
          const td=tds[ci];
          if(c.key==='status') td.innerHTML=statusChip(item._obs);
          if(c.key==='cpag'){ const mc=metaColorClass(item._cpag,METAS.cpagd); if(mc) td.classList.add(mc); }
          if(c.key==='cac'){ const mc=metaColorClass(item._cac,METAS.cac); if(mc) td.classList.add(mc); }
        });
      });
    }
  });
}

function relBriefKey(){ if(STATE.selDays.size) return null; return STATE.preset||null; }

/* Nota de saúde do funil: cor por faixa (mesmas faixas de build/relatorio_lib.py::_classificacao) */
function healthClass(nota){
  if(nota==null) return 'rh-none';
  if(nota>=8) return 'rh-excelente';
  if(nota>=6.5) return 'rh-saudavel';
  if(nota>=5) return 'rh-atencao';
  if(nota>=3) return 'rh-critico';
  return 'rh-critico-grave';
}

function renderHealthBadge(ns){
  if(!ns) return '';
  const cls=healthClass(ns.nota);
  const notaTxt = ns.nota==null ? '—/10' : nf1.format(ns.nota)+'/10';
  const prov = ns.provisoria ? '<span class="rh-prov">Nota provisória</span>' : '';
  const motivo = ns.motivo ? `<p class="rh-motivo">${ns.motivo}</p>` : '';
  const subnotas = ns.subnotas ? Object.entries(ns.subnotas)
    .map(([k,v])=>`<span class="rh-sub">${k.replace(/_/g,' ')}: ${v==null?'—':nf1.format(v)}</span>`).join('') : '';
  return `<div class="rel-health ${cls}">
    <div class="rh-top"><span class="rh-nota">${notaTxt}</span><span class="rh-classe">${ns.classificacao||''}</span>${prov}</div>
    ${motivo}
    <div class="rh-subs">${subnotas}</div>
  </div>`;
}

function renderWhatsappBlock(texto){
  if(!texto) return '';
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div class="rel-wa">
    <div class="rel-wa-head"><b>Bloco para copiar (WhatsApp)</b>
      <button type="button" class="rel-wa-copy" onclick="copyWhatsappBlock(this)">Copiar</button>
    </div>
    <pre class="rel-wa-box" id="relWaText">${esc(texto)}</pre>
  </div>`;
}

function copyWhatsappBlock(btn){
  const el=document.getElementById('relWaText'); if(!el) return;
  const text=el.textContent;
  const done=()=>{ const old=btn.textContent; btn.textContent='Copiado!'; setTimeout(()=>{btn.textContent=old;},1500); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done)); }
  else fallbackCopy(text,done);
}
function fallbackCopy(text,done){
  const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); done(); }catch(e){}
  document.body.removeChild(ta);
}

const QUAD_TITLES={
  quadro1_resumo:'1 · Resumo executivo e saúde do funil',
  quadro2_diagnostico:'2 · Diagnóstico do funil',
  quadro3_campeoes:'3 · Campanhas, estruturas e anúncios campeões',
  quadro4_acoes:'4 · Ações priorizadas',
};

function renderRelBrief(){
  const wrap=document.getElementById('relBrief'), stampEl=document.getElementById('relBriefStamp');
  const bf=DATA.briefings||{}, per=bf.periodos||{}, key=relBriefKey();
  stampEl.textContent = bf.generated_at ? `Insights gerados por IA · última atualização ${bf.generated_at} · atualiza 1×/dia (23h59 BRT)` : '';
  if(!Object.keys(per).length){
    wrap.innerHTML='<div class="rel-brief-empty">Os insights por IA ainda não foram gerados. São atualizados automaticamente 1×/dia.</div>'; return; }
  if(!key || !per[key]){
    wrap.innerHTML='<div class="rel-brief-empty">Insights disponíveis para os períodos predefinidos (Hoje, Ontem, 3, 7, 14, 30 dias, Este mês, Mês passado, Todo período). Selecione um desses no seletor de período.</div>'; return; }
  const item=per[key];

  // Schema novo (4 quadrantes + nota de saúde + bloco WhatsApp)
  const temQuadrantes = item.quadro1_resumo || item.quadro2_diagnostico || item.quadro3_campeoes || item.quadro4_acoes;
  if(temQuadrantes){
    const quads = Object.keys(QUAD_TITLES).map(k=>
      `<div class="rel-quad-card"><h4>${QUAD_TITLES[k]}</h4><div class="rel-quad-body rel-brief">${item[k]||'<p>—</p>'}</div></div>`
    ).join('');
    wrap.innerHTML = renderHealthBadge(item.nota_saude) + renderWhatsappBlock(item.whatsapp) +
      `<div class="rel-quad-grid">${quads}</div>`;
    return;
  }

  // Fallback: schema antigo (bloco único de html/texto), enquanto a última
  // geração real ainda não tiver rodado no novo formato.
  wrap.innerHTML = item.html || item.texto || '<div class="rel-brief-empty">Sem conteúdo.</div>';
}

/* Top Anúncios (separado p/ recolorir sem re-renderizar os gráficos quando o
   usuário edita as metas). Considera todos os leads + gasto do período.
   Mar10: NÃO força um número fixo de linhas preenchendo com anúncios sem
   resultado — mostra TODOS os anúncios com gasto (ordenados: campeões com
   amostra relevante primeiro, depois pela qualidade). Só os que têm amostra
   relevante (adSampleOk) recebem o status "Avaliável" (campeão); o resto fica
   "Em observação" — o pill do título mostra quantos são campeões DE quantos
   anúncios no total, pra não sugerir que 10 linhas = 10 vencedores. */
function renderRelAds(){
  const fL=leadsActive(), fM=metaActive();
  const fS=salesActive().filter(s=>s.attributed);   // vendas de tráfego pago, por anúncio
  const struct=adStructMap(fM,fL);
  const agg=buildAgg(fL,fM,fS,'ad');
  const pool=Object.entries(agg).filter(([ad,a])=>a.sp>0).map(([ad,a])=>({ad, a, struct:struct[ad]||{camp:'—',adset:'—'}}));

  const all=pool.slice().sort((x,y)=>{ const sx=adSampleOk(x.a), sy=adSampleOk(y.a);
    if(sx!==sy) return sx?-1:1; return cmpBest(x.a,y.a); })
    .map(it=>({...it, obs:!adSampleOk(it.a)}));
  const champs=all.filter(it=>!it.obs).length;

  relRenderAdTable('relTop',all);
  document.getElementById('relTopCount').textContent =
    champs+' '+(champs===1?'campeão':'campeões')+' de '+all.length+' anúncio'+(all.length===1?'':'s')+' com gasto';
}

/* nota de referência do painel de metas (mostra as metas ativas + legenda de cor) */
function renderMetasNote(){
  const el=document.getElementById('relMetasNote'); if(!el) return;
  const cpagd=METAS.cpagd==null?'<b>não definida</b>':('<b>'+brl(METAS.cpagd)+'</b>');
  const cac=METAS.cac==null?'<b>não definida</b>':('<b>'+brl(METAS.cac)+'</b>');
  const semMeta=(METAS.cpagd==null||METAS.cac==null);
  el.innerHTML=`Referência ativa — Meta CPAGD: ${cpagd} · Meta CAC: ${cac} · Amostra mínima: <b>${intf(METAS.volMin)} MQLs</b>. `
    +(semMeta?'Preencha as metas para colorir CPAGD/CAC nas tabelas de anúncio.':'')
    +' Código de cor (CPAGD/CAC): <span class="mc-lg mc-green">verde ≤ meta</span> <span class="mc-lg mc-yellow">amarelo até +30%</span> <span class="mc-lg mc-red">vermelho acima</span>.';
}
function syncMetasInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=(v==null?'':v); };
  set('metaCpagd',METAS.cpagd); set('metaCac',METAS.cac); set('metaVolMin',METAS.volMin);
  renderMetasNote();
}

function renderRelatorio(){
  renderGeralCore(REL_IDS);   // espelho da Visão Geral (funil, KPIs, gráficos, tabela diária)

  // cabeçalho do período
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  document.getElementById('relPeriodName').textContent = STATE.selDays.size?'Dias selecionados':(pr?pr[1]:'Personalizado');
  let rangeTxt='';
  if(STATE.from&&STATE.to){ const nD=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
    rangeTxt=`${brdate(STATE.from)} a ${brdate(STATE.to)}`+(nD>0?` · ${nD} dia${nD>1?'s':''}`:''); }
  document.getElementById('relPeriodRange').textContent=rangeTxt;

  renderMetasNote();
  renderRelAds();
  renderRelBrief();
}

/* colunas padrão das tabelas de heatmap por dia (ordem pedida) */
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date'},{key:'wd',label:'Dia',type:'dim',w:64},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},{key:'cpm',label:'CPM',type:'brl'},
  {key:'ctr',label:'CTR',type:'pct'},{key:'cr',label:'CR',type:'pct'},{key:'convlp',label:'ConvLP',type:'pct'},
  {key:'leads',label:'Leads',type:'int'},{key:'cpl',label:'CPL',type:'brl',heat:'cpl'},
  {key:'tx',label:'Tx‑MQL',type:'pct'},{key:'mqls',label:'MQLs',type:'int'},{key:'cpmql',label:'CPMQL',type:'brl',heat:'cpmql'},
  {key:'txag',label:'Tx‑AGD',type:'pct'},{key:'agd',label:'AGDs',type:'int'},{key:'cpag',label:'CPAGD',type:'brl',heat:'cpag'},
  {key:'convagd',label:'ConvAGD',type:'pct'},
  {key:'vendas',label:'Vendas',type:'int',heat:'vendas'},{key:'cac',label:'CAC',type:'brl'},
  {key:'caixa',label:'Rec.',type:'brl',heat:'rec'},{key:'roascx',label:'ROAS‑R',type:'num'},
  {key:'fat',label:'Fat.',type:'brl',heat:'fat'},{key:'roas',label:'ROAS‑F',type:'num'},
];
function dailyCells(x,d,isTotal){
  const s=salesOf(x);
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d), gasto:d.gasto, cpm:d.cpm, ctr:d.ctr, cr:d.cr, convlp:d.convlp,
    leads:x.leads, cpl:d.cpl, tx:d.tx, mqls:x.mqls, cpmql:d.cpmql,
    txag:s.txag, agd:s.agendamentos, cpag:s.cpag, convagd:s.convagd,
    vendas:s.vendas, cac:s.cac, caixa:s.caixa, roascx:s.roascx, fat:s.fat, roas:s.roas};
}

/* ---------------- PAGE 2: Meta Ads ---------------- */
/* Página de TRÁFEGO PAGO: só leads de mídia paga (src meta/google — exclui
   orgânico, senão os agendamentos/MQLs orgânicos entrariam) e só vendas
   atribuídas ao tráfego (attributed). fS acompanha o mesmo escopo (camp/adset/ad). */
function metaScope(ex){
  let fL=leadsActive().filter(l=>l.src==='meta'||l.src==='google');
  let fM=metaActive();
  let fS=salesActive().filter(s=>s.attributed);
  if(ex!=='C'&&STATE.mSelC.size){ fL=fL.filter(r=>STATE.mSelC.has(r.camp)); fM=fM.filter(r=>STATE.mSelC.has(r.camp)); fS=fS.filter(r=>STATE.mSelC.has(r.camp)); }
  if(ex!=='A'&&STATE.mSelA.size){ fL=fL.filter(r=>STATE.mSelA.has(r.adset)); fM=fM.filter(r=>STATE.mSelA.has(r.adset)); fS=fS.filter(r=>STATE.mSelA.has(r.adset)); }
  if(ex!=='D'&&STATE.mSelAd.size){ fL=fL.filter(r=>STATE.mSelAd.has(r.ad)); fM=fM.filter(r=>STATE.mSelAd.has(r.ad)); fS=fS.filter(r=>STATE.mSelAd.has(r.ad)); }
  return {fL,fM,fS}; }
/* selecao multipla: Ctrl adiciona (OR) sem sumir as demais linhas; clique simples troca a ancora */
function selDim(dim,key,ctrl){
  const sets={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}, s=sets[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const sole=s.has(key)&&s.size===1&&!Object.entries(sets).some(([k2,x])=>k2!==dim&&x.size);
    Object.values(sets).forEach(x=>x.clear()); if(!sole) s.add(key); }
  renderMeta();
}
function renderMeta(){
  const F=metaScope(null), fL=F.fL, fM=F.fM, fS=F.fS;   // KPIs, funil, graficos e tabela diaria
  const t=totals(fL,fM,fS), dv=derive(t), s=salesOf(t), g=dv.gasto;
  document.getElementById('metaFunnel').innerHTML=funnelHTML(buildFunnelSteps(t,dv,s,{meta:true}));

  const dComboM=daily(fL,fM,fS);
  comboChart('mCombo', rollup(dComboM,granOf('mCombo')));
  renderDailyMixes('mVendas','mAgd', dComboM);

  const dl=daily(fL,fM,fS).slice().reverse();
  renderTable({id:'tDaily', cols:DAILY_COLS, center:true, centerAll:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:(()=>{const d=derive(t);return dailyCells({...t,d:null},d,true);})(),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });

  // hierarquia — cada tabela vem do escopo que exclui a PRÓPRIA dimensão,
  // então todas as linhas irmãs continuam visíveis para multi-seleção (Ctrl).
  const hcols=[
    {key:'dim',label:'',type:'dim',big:true,stk:'l1'},{key:'gasto',label:'Gasto',type:'brl',stk:'l2'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'ctr',label:'CTR',type:'pct'},{key:'cr',label:'CR',type:'pct'},{key:'convlp',label:'ConvLP',type:'pct'},
    {key:'leads',label:'Leads',type:'int'},{key:'cpl',label:'CPL',type:'brl'},
    {key:'tx',label:'Tx‑MQL',type:'pct'},{key:'mqls',label:'MQLs',type:'int'},{key:'cpmql',label:'CPMQL',type:'brl'},
    {key:'agd',label:'AGDs',type:'int'},{key:'txag',label:'Tx‑AGD',type:'pct'},{key:'cpag',label:'CPAGD',type:'brl'},
    {key:'convagd',label:'ConvAGD',type:'pct'},{key:'vendas',label:'Vendas',type:'int'},{key:'cac',label:'CAC',type:'brl'},
    {key:'fat',label:'Fat.',type:'brl'},{key:'tm',label:'TM',type:'brl'},{key:'roas',label:'ROAS',type:'num'},
    {key:'caixa',label:'Receita',type:'brl'},{key:'roascx',label:'ROAS (C)',type:'num'},
  ];
  function hierRows(map){ return Object.entries(map).map(([k,a])=>{const d=derive(a),s=salesOf(a);
    return {k, cells:{dim:k,gasto:d.gasto,cpm:d.cpm,ctr:d.ctr,cr:d.cr,convlp:d.convlp,leads:a.leads,cpl:d.cpl,tx:d.tx,mqls:a.mqls,cpmql:d.cpmql,
      agd:s.agendamentos,txag:s.txag,cpag:s.cpag,
      convagd:s.convagd,vendas:s.vendas,cac:s.cac,fat:s.fat,tm:s.tm,roas:s.roas,caixa:s.caixa,roascx:s.roascx}};}); }
  function totRowOf(tt){const d=derive(tt),s=salesOf(tt);return{dim:null,gasto:d.gasto,cpm:d.cpm,ctr:d.ctr,cr:d.cr,convlp:d.convlp,leads:tt.leads,cpl:d.cpl,tx:d.tx,mqls:tt.mqls,cpmql:d.cpmql,
    agd:s.agendamentos,txag:s.txag,cpag:s.cpag,
    convagd:s.convagd,vendas:s.vendas,cac:s.cac,fat:s.fat,tm:s.tm,roas:s.roas,caixa:s.caixa,roascx:s.roascx};}
  const Sc=metaScope('C'), Sa=metaScope('A'), Sd=metaScope('D');
  const aggC=buildAgg(Sc.fL,Sc.fM,Sc.fS,'camp'), aggA=buildAgg(Sa.fL,Sa.fM,Sa.fS,'adset'), aggD=buildAgg(Sd.fL,Sd.fM,Sd.fS,'ad');
  // Tabelas hierárquicas: NÃO usam "fit" — a dimensão (campanha/conjunto/anúncio)
  // tem largura automática p/ caber o nome INTEIRO por padrão, nunca quebra linha,
  // é redimensionável (arrastar borda) e 2 cliques na borda auto-ajusta (Sheets/Looker).
  renderTable({id:'tCamp', stick:true, cols:hcols.map((c,i)=>i===0?{...c,label:'Campanha'}:c), rows:hierRows(aggC), total:totRowOf(totals(Sc.fL,Sc.fM,Sc.fS)),
    selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', stick:true, cols:hcols.map((c,i)=>i===0?{...c,label:'Conjunto',big:true}:c), rows:hierRows(aggA), total:totRowOf(totals(Sa.fL,Sa.fM,Sa.fS)),
    selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', stick:true, cols:hcols.map((c,i)=>i===0?{...c,label:'Anúncio'}:c), rows:hierRows(aggD), total:totRowOf(totals(Sd.fL,Sd.fM,Sd.fS)),
    selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});

  // Mar03/Mar10: cada gráfico varia a dimensão da sua tabela — MQLs por dia, 1 linha
  // por membro, com legenda própria (cor · nome completo · CPMQL) e filtro bidirecional
  // com a tabela (STATE.mSel* determina quais linhas o gráfico plota).
  mqlByDimChart('chCamp', Sc.fL, Sc.fM, aggC, 'camp', STATE.mSelC);
  mqlByDimChart('chAdset', Sa.fL, Sa.fM, aggA, 'adset', STATE.mSelA);
  mqlByDimChart('chAd', Sd.fL, Sd.fM, aggD, 'ad', STATE.mSelAd);

  // qualified leads
  const q=fL.filter(l=>l.q).sort((a,b)=>(a.d<b.d?1:-1));
  document.getElementById('qCount').textContent=q.length+' leads';
  renderTable({id:'tQual',
    cols:[{key:'d',label:'Data',type:'date'},{key:'nm',label:'Nome',type:'dim'},
      {key:'retorno',label:'Quanto acredita retornar',type:'dim',big:true},
      {key:'bucket',label:'Faixa',type:'dim'},{key:'camp',label:'Campanha',type:'dim',big:true},
      {key:'ad',label:'Anúncios',type:'dim',big:true},
      {key:'em',label:'E‑mail',type:'dim',w:200},{key:'ph',label:'Telefone',type:'dim',w:110},
      {key:'leadscore',label:'LeadScore',type:'dim',w:90}],
    rows:q.map((l,i)=>({k:'q'+i, cells:{d:l.d,nm:l.nm,retorno:l.retorno,bucket:l.bucket,camp:l.camp,ad:l.ad,em:l.em,ph:l.ph,leadscore:l.leadscore}}))});
}

/* ---------------- date presets ---------------- */
const PRESETS=[
  ['hoje','Hoje',()=>[TODAY,TODAY]],
  ['ontem','Ontem',()=>[addDays(TODAY,-1),addDays(TODAY,-1)]],
  ['3d','3 dias',()=>[addDays(TODAY,-2),TODAY]],
  ['7d','7 dias',()=>[addDays(TODAY,-6),TODAY]],
  ['14d','14 dias',()=>[addDays(TODAY,-13),TODAY]],
  ['30d','30 dias',()=>[addDays(TODAY,-29),TODAY]],
  ['mes','Este mês',()=>{const [y,m]=TODAY.split('-');return [`${y}-${m}-01`,TODAY];}],
  ['mespass','Mês passado',()=>{const dt=new Date(TODAY+'T00:00:00');const f=new Date(dt.getFullYear(),dt.getMonth()-1,1);const l=new Date(dt.getFullYear(),dt.getMonth(),0);return [dstr(f),dstr(l)];}],
  ['todo','Todo período',()=>[B.date_min,B.date_max]],
];
/* rótulo do botão de período — mostra o intervalo aplicado dentro do próprio botão */
function syncDateInputs(){
  const el=document.getElementById('periodBtnLabel'); if(!el) return;
  if(STATE.selDays.size){ el.textContent=STATE.selDays.size+(STATE.selDays.size>1?' dias selecionados':' dia selecionado'); return; }
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  if(STATE.from&&STATE.to) el.textContent=brdate(STATE.from)+' – '+brdate(STATE.to)+(pr?' · '+pr[1]:'');
  else el.textContent='Selecionar período';
}
function applyPreset(id){ const p=PRESETS.find(x=>x[0]===id); if(!p)return; const [f,t]=p[2]();
  STATE.from=f; STATE.to=t; STATE.preset=id; STATE.selDays.clear(); ppClose(); syncDateInputs(); renderAll(); }

/* ---- popover do seletor de período (estilo Data Studio) ---- */
const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_PT=['D','S','T','Q','Q','S','S'];
const PP={from:null,to:null,preset:'',fromView:'',toView:''};
function ymView(ds){ return (ds||TODAY).slice(0,7); }
function shiftView(view,delta){ const [y,m]=view.split('-').map(Number); const dt=new Date(y,m-1+delta,1); return dt.getFullYear()+'-'+pad(dt.getMonth()+1); }
function ppIsOpen(){ const pop=document.getElementById('periodPop'); return pop && !pop.hidden; }
function ppOpen(){
  PP.from=STATE.from; PP.to=STATE.to; PP.preset=STATE.selDays.size?'':STATE.preset;
  PP.fromView=ymView(STATE.from); PP.toView=ymView(STATE.to);
  document.getElementById('periodPop').hidden=false;
  document.getElementById('periodBtn').setAttribute('aria-expanded','true');
  ppRenderAll();
}
function ppClose(){ const pop=document.getElementById('periodPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('periodBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function ppRenderAll(){ ppRenderPresets(); ppRenderCal('from'); ppRenderCal('to'); ppRenderRange(); }
function ppRenderPresets(){
  const host=document.getElementById('ppPresets');
  host.innerHTML=PRESETS.map(p=>`<button class="pp-preset ${PP.preset===p[0]?'active':''}" data-p="${p[0]}">${p[1]}</button>`).join('');
  host.querySelectorAll('.pp-preset').forEach(c=>c.addEventListener('click',()=>{
    const p=PRESETS.find(x=>x[0]===c.dataset.p); const [f,t]=p[2]();
    PP.from=f; PP.to=t; PP.preset=p[0]; PP.fromView=ymView(f); PP.toView=ymView(t); ppRenderAll();
  }));
}
function ppRenderCal(side){
  const host=document.getElementById(side==='from'?'ppCalFrom':'ppCalTo');
  const view=side==='from'?PP.fromView:PP.toView;
  const [y,m]=view.split('-').map(Number);
  const startDow=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<span class="pp-day empty"></span>';
  for(let d=1;d<=dim;d++){
    const ds=view+'-'+pad(d);
    const inR=PP.from&&PP.to&&ds>=PP.from&&ds<=PP.to, isEdge=(ds===PP.from||ds===PP.to);
    const cls=['pp-day']; if(inR) cls.push('in'); if(ds===PP.from) cls.push('edge-l'); if(ds===PP.to) cls.push('edge-r'); if(isEdge) cls.push('sel');
    cells+=`<button class="${cls.join(' ')}" data-side="${side}" data-d="${ds}">${d}</button>`;
  }
  host.innerHTML=`<div class="pp-cal-head"><span class="pp-cal-title">${side==='from'?'Data de início':'Data de término'}</span></div>
    <div class="pp-cal-nav"><button class="pp-nav" data-nav="-1">‹</button><span class="pp-cal-month">${MONTHS_PT[m-1]} ${y}</span><button class="pp-nav" data-nav="1">›</button></div>
    <div class="pp-dow">${DOW_PT.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pp-grid">${cells}</div>`;
  host.querySelectorAll('.pp-nav').forEach(b=>b.addEventListener('click',()=>{
    const nv=shiftView(view,+b.dataset.nav); if(side==='from') PP.fromView=nv; else PP.toView=nv; ppRenderCal(side);
  }));
  host.querySelectorAll('.pp-day[data-d]').forEach(b=>b.addEventListener('click',()=>ppPickDay(side,b.dataset.d)));
}
function ppPickDay(side,ds){
  PP.preset='';
  if(side==='from'){ PP.from=ds; if(PP.to&&PP.from>PP.to) PP.to=PP.from; }
  else { PP.to=ds; if(PP.from&&PP.to<PP.from) PP.from=PP.to; }
  ppRenderAll();
}
function ppRenderRange(){
  const el=document.getElementById('ppRange');
  if(PP.from&&PP.to){ const n=Math.round((new Date(PP.to+'T00:00:00')-new Date(PP.from+'T00:00:00'))/86400000)+1;
    el.textContent=brdate(PP.from)+' – '+brdate(PP.to)+(n>0?' · '+n+(n>1?' dias':' dia'):''); }
  else el.textContent='Selecione as datas';
}
function ppApply(){
  if(!PP.from||!PP.to){ ppClose(); return; }
  STATE.from=PP.from; STATE.to=PP.to; STATE.preset=PP.preset||''; STATE.selDays.clear();
  ppClose(); syncDateInputs(); renderAll();
}

/* ---------------- navigation & boot ---------------- */
function setPage(p){ STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.getElementById('page-geral').classList.toggle('active',p==='geral');
  document.getElementById('page-meta').classList.toggle('active',p==='meta');
  document.getElementById('page-rel').classList.toggle('active',p==='rel');
  document.getElementById('ptitle').textContent = p==='meta'?'Meta Ads':(p==='rel'?'Relatório':'Visão Geral Total');
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'', p==='meta'?'#meta':(p==='rel'?'#rel':'#geral'));
  renderAll();
}
function renderAll(){ if(STATE.page==='meta') renderMeta(); else if(STATE.page==='rel') renderRelatorio(); else renderGeral(); }

function applyTheme(){ const t=localStorage.getItem('dm_theme'); if(t==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); }
applyTheme();
document.getElementById('themeBtn').addEventListener('click',()=>{ const dark=document.documentElement.getAttribute('data-theme')==='dark'; localStorage.setItem('dm_theme',dark?'light':'dark'); applyTheme(); renderAll(); });

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
document.getElementById('taxToggle').addEventListener('click',function(){ STATE.tax=!STATE.tax; this.classList.toggle('on',STATE.tax); renderAll(); });
/* seletor de período: abre/fecha popover, aplicar/cancelar, fechar ao clicar fora/Esc */
document.getElementById('periodBtn').addEventListener('click',e=>{ e.stopPropagation(); ppIsOpen()?ppClose():ppOpen(); });
document.getElementById('ppApply').addEventListener('click',ppApply);
document.getElementById('ppCancel').addEventListener('click',ppClose);
document.getElementById('periodPop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{ if(ppIsOpen()) ppClose(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ppIsOpen()) ppClose(); });
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.mSelC.clear();STATE.mSelA.clear();STATE.mSelAd.clear();STATE.selDays.clear();
  STATE.filterFunil=''; STATE.filterTemp=''; syncFunilFilters(); applyPreset('mes'); });
/* filtro global: Funil (DIAG/APD-BR/APD-MUNDO) e Temperatura (Quente/Frio) —
   afeta leadsActive()/metaActive() em todas as páginas (topbar). */
function syncFunilFilters(){
  const fe=document.getElementById('filterFunil'), te=document.getElementById('filterTemp');
  if(fe) fe.value=STATE.filterFunil; if(te) te.value=STATE.filterTemp;
}
(function wireFunilFilters(){
  const fe=document.getElementById('filterFunil'), te=document.getElementById('filterTemp');
  if(fe){ fe.innerHTML='<option value="">Todos os funis</option>'+FUNIS.map(f=>`<option value="${f}">${f}</option>`).join('');
    fe.addEventListener('change',()=>{ STATE.filterFunil=fe.value; renderAll(); }); }
  if(te){ te.addEventListener('change',()=>{ STATE.filterTemp=te.value; renderAll(); }); }
  syncFunilFilters();
})();
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

/* painel de Metas & parâmetros — edita ao vivo, salva em localStorage e recolore
   as tabelas de anúncio (sem re-renderizar os gráficos) */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const onEdit=()=>{
    METAS.cpagd=num(document.getElementById('metaCpagd'));
    METAS.cac=num(document.getElementById('metaCac'));
    const vm=num(document.getElementById('metaVolMin')); METAS.volMin=(vm!=null&&vm>=1)?Math.round(vm):METAS_DEFAULT.volMin;
    saveMetas(); renderMetasNote();
    if(STATE.page==='rel') renderRelAds();   // só as tabelas, sem mexer nos gráficos
  };
  ['metaCpagd','metaCac','metaVolMin'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',onEdit); });
  const rb=document.getElementById('relMetasReset');
  if(rb) rb.addEventListener('click',()=>{ METAS.cpagd=METAS_DEFAULT.cpagd; METAS.cac=METAS_DEFAULT.cac; METAS.volMin=METAS_DEFAULT.volMin;
    try{ localStorage.removeItem('dm_metas'); }catch(e){} syncMetasInputs(); if(STATE.page==='rel') renderRelAds(); });
  syncMetasInputs();
})();

document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build __BUILD_ID__';
document.getElementById('buildFoot2').textContent='· build __BUILD_ID__';

/* seletor de granularidade (Diário/Semanal/Mensal/Trimestral/Semestral/Anual) —
   injetado no cabeçalho de cada gráfico temporal; troca a agregação do eixo X ao
   vivo (estilo Looker Studio). Default por gráfico em TEMPORAL_CHARTS. */
function injectGranSelectors(){
  Object.keys(TEMPORAL_CHARTS).forEach(id=>{
    const cv=document.getElementById(id); if(!cv) return;
    const host=cv.closest('.panel-chart')||cv.closest('.card'); if(!host||host.querySelector('.gran-sel')) return;
    if(!(id in STATE.gran)) STATE.gran[id]=TEMPORAL_CHARTS[id];
    const sel=document.createElement('select'); sel.className='gran-sel'; sel.title='Agregação do período';
    sel.innerHTML=GRAN_OPTS.map(([v,l])=>`<option value="${v}"${STATE.gran[id]===v?' selected':''}>${l}</option>`).join('');
    sel.addEventListener('change',()=>{ STATE.gran[id]=sel.value; renderAll(); });
    host.classList.add('has-gran');
    host.appendChild(sel);
  });
}
injectGranSelectors();

/* período padrão ao abrir: "Este mês" (define STATE.from/to/preset antes do 1º render) */
(function(){ const p=PRESETS.find(x=>x[0]==='mes'); if(p){ const [f,t]=p[2](); STATE.from=f; STATE.to=t; STATE.preset='mes'; } })();
syncDateInputs();
setPage(location.hash==='#meta'?'meta':(location.hash==='#rel'?'rel':'geral'));

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);
