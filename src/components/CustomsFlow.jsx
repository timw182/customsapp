"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls,
  Handle, Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/* ── Shared logic ─────────────────────────────────────────── */
const EU = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI",
  "FR","GR","HR","HU","IE","IT","LT","LU","LV","MT",
  "NL","PL","PT","RO","SE","SI","SK",
]);
const LU_VAT_3 = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,36,49];
function getLuVAT(hs) {
  if (!hs) return 0.17;
  const ch = parseInt(String(hs).replace(/\D/g,"").substring(0,2), 10);
  if (ch === 30) return 0.03;
  if (LU_VAT_3.includes(ch)) return 0.03;
  if (ch === 90) return 0.08;
  if (ch === 22) return 0.14;
  return 0.17;
}
const EXCISE_CH = new Set([22, 24, 27]);
function isExcise(hs) {
  return EXCISE_CH.has(parseInt(String(hs||"").replace(/\D/g,"").substring(0,2),10));
}
const ORIGIN_AGREEMENTS = {
  IS:{name:"Iceland",         pref:true,  type:"EEA"},
  LI:{name:"Liechtenstein",   pref:true,  type:"EEA"},
  NO:{name:"Norway",          pref:true,  type:"EEA"},
  CH:{name:"Switzerland",     pref:true,  type:"FTA"},
  TR:{name:"Turkey",          pref:true,  type:"CU"},
  GB:{name:"United Kingdom",  pref:true,  type:"TCA"},
  CA:{name:"Canada",          pref:true,  type:"CETA"},
  JP:{name:"Japan",           pref:true,  type:"FTA"},
  KR:{name:"South Korea",     pref:true,  type:"FTA"},
  SG:{name:"Singapore",       pref:true,  type:"FTA"},
  VN:{name:"Vietnam",         pref:true,  type:"FTA"},
  MA:{name:"Morocco",         pref:true,  type:"FTA"},
  TN:{name:"Tunisia",         pref:true,  type:"FTA"},
  EG:{name:"Egypt",           pref:true,  type:"FTA"},
  MX:{name:"Mexico",          pref:true,  type:"FTA"},
  CL:{name:"Chile",           pref:true,  type:"FTA"},
  CO:{name:"Colombia",        pref:true,  type:"FTA"},
  PE:{name:"Peru",            pref:true,  type:"FTA"},
  EC:{name:"Ecuador",         pref:true,  type:"FTA"},
  BD:{name:"Bangladesh",      pref:true,  type:"EBA"},
  KH:{name:"Cambodia",        pref:true,  type:"EBA"},
  ET:{name:"Ethiopia",        pref:true,  type:"EBA"},
  MZ:{name:"Mozambique",      pref:true,  type:"EBA"},
  US:{name:"United States",   pref:false, type:"MFN"},
  CN:{name:"China",           pref:false, type:"MFN"},
  IN:{name:"India",           pref:false, type:"MFN"},
  BR:{name:"Brazil",          pref:false, type:"MFN"},
  AU:{name:"Australia",       pref:false, type:"MFN"},
  RU:{name:"Russia",          pref:false, type:"sanctioned"},
  BY:{name:"Belarus",         pref:false, type:"sanctioned"},
};
const INCOTERMS = {
  EXW:{label:"EXW — Ex Works",             needsFreight:true,  needsIns:true},
  FCA:{label:"FCA — Free Carrier",          needsFreight:true,  needsIns:true},
  FOB:{label:"FOB — Free on Board",         needsFreight:true,  needsIns:true},
  CFR:{label:"CFR — Cost & Freight",        needsFreight:false, needsIns:true},
  CIF:{label:"CIF — Cost Ins. Freight",     needsFreight:false, needsIns:false},
  CPT:{label:"CPT — Carriage Paid To",      needsFreight:false, needsIns:true},
  CIP:{label:"CIP — Carriage Ins. Paid",    needsFreight:false, needsIns:false},
  DAP:{label:"DAP — Delivered At Place",    needsFreight:false, needsIns:false},
  DDP:{label:"DDP — Delivered Duty Paid",   needsFreight:false, needsIns:false},
};
function fmt(n) { return "€"+(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,","); }

function calcCIF({itemValue,freight,insurance,currency,incoterm,fxRate}) {
  const fx  = currency==="EUR" ? 1 : (parseFloat(fxRate)||1);
  const val = (parseFloat(itemValue)||0) / fx;
  const fr  = (parseFloat(freight)||0)   / fx;
  const ins = (parseFloat(insurance)||0) / fx;
  const inc = INCOTERMS[incoterm]||INCOTERMS.FOB;
  let cif = val;
  if (inc.needsFreight) cif += fr;
  if (inc.needsIns)     cif += ins;
  return cif;
}

/* ── Progressive visibility ───────────────────────────────── */
// Returns set of node IDs that should be visible given current inputs.
// Each step only unlocks once the previous step's required input is provided.
function getVisible({interacted, originCountry, cif, preferential, antiDumpingRate, hsCode}) {
  const v = new Set(["start"]);
  if (!interacted) return v;

  v.add("q1");
  const eu = EU.has(originCountry);

  if (eu) { v.add("r_eu"); return v; }

  // Need value to continue
  if (!(cif > 0)) return v;
  v.add("q2");

  if (cif <= 150) { v.add("r_lv"); return v; }

  // Have value > 150 — show preferential check
  v.add("q3");
  const hasPref = preferential && ORIGIN_AGREEMENTS[originCountry]?.pref;
  if (hasPref) v.add("r_pref");
  v.add("q4");

  // ADD — always resolve (0 = no ADD)
  const addPct = parseFloat(antiDumpingRate)||0;
  if (addPct > 0) v.add("r_add");
  v.add("q5");

  // Need HS code to resolve excise
  if (!hsCode) return v;
  if (isExcise(hsCode)) v.add("r_exc");
  v.add("vat");
  v.add("total");

  return v;
}

/* ── Node styles ──────────────────────────────────────────── */
const ENTER = "nodeEnter 0.28s cubic-bezier(0.34,1.56,0.64,1) both";

const PAL = {
  decision:{bg:"#ede9fe",border:"#7c3aed",text:"#4c1d95",abg:"#7c3aed",at:"#fff"},
  good:    {bg:"#d1fae5",border:"#10b981",text:"#065f46",abg:"#10b981",at:"#fff"},
  bad:     {bg:"#fee2e2",border:"#ef4444",text:"#7f1d1d",abg:"#ef4444",at:"#fff"},
  neutral: {bg:"#f0f9ff",border:"#0ea5e9",text:"#0c4a6e",abg:"#0ea5e9",at:"#fff"},
  amber:   {bg:"#fefce8",border:"#f59e0b",text:"#78350f",abg:"#f59e0b",at:"#fff"},
};

function StartNode({ data }) {
  return (
    <div style={{background:"#1f2937",border:"2px solid #374151",borderRadius:999,
                 color:"#f9fafb",padding:"10px 28px",fontWeight:700,fontSize:14}}>
      {data.label}
      <Handle type="source" position={Position.Bottom} style={{background:"#374151"}}/>
    </div>
  );
}
function DecisionNode({ data }) {
  const p = PAL.decision;
  const a = data.active;
  return (
    <div style={{
      background:a?p.abg:p.bg, border:`2px solid ${p.border}`, borderRadius:12,
      color:a?p.at:p.text, padding:"14px 18px", minWidth:185, maxWidth:230,
      textAlign:"center", fontSize:13, fontWeight:600,
      boxShadow:a?`0 0 0 5px ${p.border}33`:"0 2px 8px #0001",
      animation:ENTER, transition:"background 0.2s,box-shadow 0.2s",
    }}>
      <Handle type="target" position={Position.Top} style={{background:p.border}}/>
      <div style={{fontSize:18,marginBottom:5}}>{data.icon}</div>
      <div>{data.label}</div>
      {data.val && (
        <div style={{marginTop:6,padding:"3px 10px",borderRadius:6,fontSize:12,fontWeight:700,
                     background:a?"rgba(255,255,255,0.2)":"rgba(124,58,237,0.12)"}}>
          {data.val}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="yes" style={{left:"30%",background:"#10b981"}}/>
      <Handle type="source" position={Position.Bottom} id="no"  style={{left:"70%",background:"#ef4444"}}/>
    </div>
  );
}
function ResultNode({ data }) {
  const p = PAL[data.pal]||PAL.neutral;
  const a = data.active;
  return (
    <div style={{
      background:a?p.abg:p.bg, border:`2px solid ${p.border}`, borderRadius:12,
      color:a?p.at:p.text, padding:"12px 16px", minWidth:165, maxWidth:215,
      textAlign:"center", fontSize:13, fontWeight:600,
      boxShadow:a?`0 0 0 5px ${p.border}33`:"0 2px 8px #0001",
      animation:ENTER, transition:"background 0.2s,box-shadow 0.2s",
    }}>
      <Handle type="target" position={Position.Top} style={{background:p.border}}/>
      <div style={{fontSize:20,marginBottom:4}}>{data.icon}</div>
      <div>{data.label}</div>
      {data.val && (
        <div style={{marginTop:5,padding:"3px 10px",borderRadius:6,fontSize:12,fontWeight:700,
                     background:a?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.06)"}}>
          {data.val}
        </div>
      )}
      {data.sub && <div style={{fontSize:11,marginTop:3,opacity:0.7,fontWeight:400}}>{data.sub}</div>}
      {data.hasSource && <Handle type="source" position={Position.Bottom} style={{background:p.border}}/>}
    </div>
  );
}
const nodeTypes = { start:StartNode, decision:DecisionNode, result:ResultNode };

/* ── Build graph ──────────────────────────────────────────── */
// Y positions with generous spacing so edge lines are clearly visible
const Y = { start:0, q1:160, branch2:320, q3:480, q4:640, q5:800, vat:960, total:1120 };
const X = { main:380, left:100, right:660 };

function buildGraph({ visible, activeNodes, cif, hasPref, addPct, vatRate, vat, customsDuty, addDuty, total }) {
  const nd = (id, type, x, y, data) => ({
    id, type, position:{x,y},
    data:{ ...data, active: activeNodes.has(id) },
  });

  const allNodes = [
    nd("start",  "start",    X.main,  Y.start, {label:"▶  Import into Luxembourg"}),
    nd("q1",     "decision", X.main,  Y.q1,    {icon:"🌍", label:"EU / EEA origin?",
                                                  val: cif>0 ? `CIF ${fmt(cif)}` : null}),
    nd("r_eu",   "result",   X.left,  Y.branch2,{pal:"good", icon:"✅", label:"No customs duty", val:"Free movement", sub:"Internal market"}),
    nd("q2",     "decision", X.main,  Y.branch2,{icon:"💶", label:"Customs value > €150?",
                                                  val: cif>0 ? fmt(cif) : null}),
    nd("r_lv",   "result",   X.left,  Y.q3,    {pal:"neutral", icon:"📦", label:"Low-value import", val:"VAT only", sub:"ICS2 threshold"}),
    nd("q3",     "decision", X.main,  Y.q3,    {icon:"🤝", label:"Preferential rate?",
                                                  val: hasPref ? "✓ applies" : null}),
    nd("r_pref", "result",   X.right, Y.q3,    {pal:"good", icon:"📉", label:"0% pref. duty",
                                                  val: hasPref ? "0% (with proof)" : null, sub:"EUR.1 / origin decl.", hasSource:true}),
    nd("q4",     "decision", X.main,  Y.q4,    {icon:"⚠️", label:"Anti-dumping (ADD)?",
                                                  val: addPct>0 ? `${addPct}% ADD` : "None"}),
    nd("r_add",  "result",   X.right, Y.q4,    {pal:"bad", icon:"🚫", label:"ADD applies",
                                                  val: addDuty>0 ? fmt(addDuty) : null, sub:"additional duty", hasSource:true}),
    nd("q5",     "decision", X.main,  Y.q5,    {icon:"🍷", label:"Excise goods?", sub:"Ch. 22 · 24 · 27"}),
    nd("r_exc",  "result",   X.right, Y.q5,    {pal:"bad", icon:"🔥", label:"Excise duty",
                                                  val:null, sub:"→ see Excise tab", hasSource:true}),
    nd("vat",    "result",   X.main,  Y.vat,   {pal:"neutral", icon:"🧾", label:"Import VAT",
                                                  val: vat>0 ? `${fmt(vat)} (${(vatRate*100).toFixed(0)}%)` : vatRate ? `${(vatRate*100).toFixed(0)}% rate` : null,
                                                  sub:"LU VAT — derived from HS", hasSource:true}),
    nd("total",  "result",   X.main,  Y.total, {pal:"amber", icon:"🧮", label:"Total landed cost",
                                                  val: total>0 ? fmt(total) : null}),
  ];

  const nodes = allNodes.filter(n => visible.has(n.id));
  const visSet = visible;

  const edgeDefs = [
    {id:"e0", s:"start", t:"q1",    sh:null,  col:"#6b7280", lbl:null},
    {id:"e1y",s:"q1",   t:"r_eu",  sh:"yes", col:"#10b981", lbl:"Yes"},
    {id:"e1n",s:"q1",   t:"q2",    sh:"no",  col:"#ef4444", lbl:"No"},
    {id:"e2n",s:"q2",   t:"r_lv",  sh:"yes", col:"#0ea5e9", lbl:"≤ €150"},
    {id:"e2y",s:"q2",   t:"q3",    sh:"no",  col:"#ef4444", lbl:"> €150"},
    {id:"e3y",s:"q3",   t:"r_pref",sh:"yes", col:"#10b981", lbl:"Yes"},
    {id:"e3n",s:"q3",   t:"q4",    sh:"no",  col:"#ef4444", lbl:"No / MFN"},
    {id:"ep", s:"r_pref",t:"q4",   sh:null,  col:"#9ca3af", lbl:null},
    {id:"e4y",s:"q4",   t:"r_add", sh:"yes", col:"#ef4444", lbl:"Yes"},
    {id:"e4n",s:"q4",   t:"q5",    sh:"no",  col:"#10b981", lbl:"No"},
    {id:"ea", s:"r_add",t:"q5",    sh:null,  col:"#9ca3af", lbl:null},
    {id:"e5y",s:"q5",   t:"r_exc", sh:"yes", col:"#ef4444", lbl:"Yes"},
    {id:"e5n",s:"q5",   t:"vat",   sh:"no",  col:"#10b981", lbl:"No"},
    {id:"ee", s:"r_exc",t:"vat",   sh:null,  col:"#9ca3af", lbl:null},
    {id:"e6", s:"vat",  t:"total", sh:null,  col:"#f59e0b", lbl:null},
  ];

  const edges = edgeDefs
    .filter(({s,t}) => visSet.has(s) && visSet.has(t))
    .map(({id,s,t,sh,col,lbl}) => {
      const active = activeNodes.has(s) && activeNodes.has(t);
      return {
        id, source:s, target:t, sourceHandle:sh||undefined,
        type:"smoothstep", animated:active,
        label:lbl||undefined,
        labelStyle:{fill:col,fontWeight:700,fontSize:11},
        style:{stroke:col, strokeWidth:active?2.5:1.5},
        markerEnd:{type:MarkerType.ArrowClosed, color:col},
      };
    });

  return {nodes, edges};
}

/* ── Input panel ──────────────────────────────────────────── */
function InputPanel({inputs, onChange, onFetchDuty, dutyLoading}) {
  const {originCountry,itemValue,freight,insurance,currency,incoterm,
         dutyRate,antiDumpingRate,preferential,hsCode,fxRate} = inputs;
  const hasPrefAvail = ORIGIN_AGREEMENTS[originCountry]?.pref && !EU.has(originCountry);
  const inc = INCOTERMS[incoterm]||INCOTERMS.FOB;

  const s = {input:{padding:"7px 10px",borderRadius:8,border:"1.5px solid #e5e7eb",
                     fontSize:13,color:"#111827",background:"#fff",width:"100%",boxSizing:"border-box"}};
  const fld = (lbl, node) => (
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <label style={{fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</label>
      {node}
    </div>
  );
  const sel = (name, opts) => (
    <select value={inputs[name]} onChange={e=>onChange(name,e.target.value)} style={s.input}>
      {opts}
    </select>
  );
  const num = (name, placeholder) => (
    <input type="number" value={inputs[name]} placeholder={placeholder} min={0} step="0.01"
      onChange={e=>onChange(name,e.target.value)} style={s.input}/>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12,padding:"16px 18px",
                 overflowY:"auto",borderRight:"1px solid #e5e7eb",width:265,flexShrink:0}}>
      <div style={{fontWeight:700,fontSize:14,color:"#111827"}}>📋 Inputs</div>

      {fld("Origin country",
        <select value={originCountry} onChange={e=>onChange("originCountry",e.target.value)} style={s.input}>
          <optgroup label="── EU (no duty)">
            {[...EU].sort().map(c=><option key={c} value={c}>{c}</option>)}
          </optgroup>
          <optgroup label="── Third countries">
            {Object.entries(ORIGIN_AGREEMENTS).sort((a,b)=>a[1].name.localeCompare(b[1].name))
              .map(([c,v])=><option key={c} value={c}>{v.name} ({c})</option>)}
          </optgroup>
        </select>
      )}

      {fld("Incoterm", sel("incoterm",
        Object.entries(INCOTERMS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)
      ))}

      {fld("Currency", sel("currency",
        ["EUR","USD","GBP","CHF","CNY","JPY","CAD","AUD"].map(c=><option key={c} value={c}>{c}</option>)
      ))}

      {fld("Item value", num("itemValue","e.g. 1000"))}
      {inc.needsFreight && fld("Freight", num("freight","e.g. 150"))}
      {inc.needsIns     && fld("Insurance", num("insurance","e.g. 20"))}
      {currency!=="EUR" && fld(`FX rate (${currency}/EUR)`, num("fxRate","e.g. 1.08"))}

      <hr style={{border:"none",borderTop:"1px solid #e5e7eb",margin:"2px 0"}}/>

      {fld("HS code",
        <div style={{display:"flex",gap:6}}>
          <input value={hsCode} onChange={e=>onChange("hsCode",e.target.value)}
            placeholder="e.g. 8471300000" maxLength={10}
            style={{...s.input,flex:1,width:"auto"}}/>
          <button onClick={onFetchDuty} disabled={!hsCode||dutyLoading}
            style={{padding:"7px 10px",borderRadius:8,background:"#10b981",color:"#fff",
                    border:"none",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",
                    opacity:(!hsCode||dutyLoading)?0.5:1}}>
            {dutyLoading?"…":"Fetch"}
          </button>
        </div>
      )}
      {fld("Duty rate (%)", num("dutyRate","e.g. 3.7"))}
      {fld("ADD rate (%)", num("antiDumpingRate","0 if none"))}

      {hasPrefAvail && (
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,
                        color:"#111827",cursor:"pointer"}}>
          <input type="checkbox" checked={preferential}
            onChange={e=>onChange("preferential",e.target.checked)}
            style={{width:16,height:16,accentColor:"#10b981"}}/>
          <span>Pref. rate ({ORIGIN_AGREEMENTS[originCountry]?.type})</span>
        </label>
      )}

      <div style={{fontSize:11,color:"#9ca3af",lineHeight:1.6,borderTop:"1px solid #f3f4f6",paddingTop:8}}>
        VAT auto-derived from HS chapter.<br/>
        Excise (ch. 22/24/27) — see Excise tab for detailed calc.
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */
export default function CustomsFlow() {
  const FLOW_DEFAULTS = {
    originCountry:"US", itemValue:"", freight:"", insurance:"",
    currency:"EUR", incoterm:"FOB", dutyRate:"", antiDumpingRate:"",
    preferential:false, hsCode:"", fxRate:"1",
  };
  const [inputs, setInputs] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("dutify_flow") || "null");
      return s ? { ...FLOW_DEFAULTS, ...s } : FLOW_DEFAULTS;
    } catch { return FLOW_DEFAULTS; }
  });
  const [interacted, setInteracted] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem("dutify_flow") || "null");
      return !!(s && (s.itemValue || s.hsCode || s.dutyRate));
    } catch { return false; }
  });
  const [dutyLoading, setDutyLoading] = useState(false);

  function onChange(key, val) {
    setInteracted(true);
    setInputs(p => {
      const next = {...p, [key]:val};
      try { localStorage.setItem("dutify_flow", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function onFetchDuty() {
    if (!inputs.hsCode) return;
    setDutyLoading(true);
    try {
      const res = await fetch(`/api/taric-duty?hs=${inputs.hsCode}&origin=${inputs.originCountry}`);
      if (res.ok) {
        const data = await res.json();
        if (data.dutyRate !== undefined) onChange("dutyRate", String(data.dutyRate));
      }
    } catch {}
    setDutyLoading(false);
  }

  const { nodes, edges } = useMemo(() => {
    const cif    = calcCIF(inputs);
    const fx     = inputs.currency==="EUR" ? 1 : (parseFloat(inputs.fxRate)||1);
    const duty   = parseFloat(inputs.dutyRate)||0;
    const addPct = parseFloat(inputs.antiDumpingRate)||0;
    const hasPref= inputs.preferential && ORIGIN_AGREEMENTS[inputs.originCountry]?.pref && !EU.has(inputs.originCountry);
    const vatRate= getLuVAT(inputs.hsCode);

    const dutyFree    = EU.has(inputs.originCountry) || (cif>0 && cif<=150);
    const effDuty     = hasPref ? 0 : duty/100;
    const customsDuty = dutyFree ? 0 : cif*effDuty;
    const addDuty     = dutyFree ? 0 : cif*(addPct/100);
    const vat         = (cif+customsDuty+addDuty)*vatRate;
    const total       = cif+customsDuty+addDuty+vat;

    const visible = getVisible({
      interacted,
      originCountry:inputs.originCountry,
      cif,
      preferential:inputs.preferential,
      antiDumpingRate:inputs.antiDumpingRate,
      hsCode:inputs.hsCode,
    });

    // Active = nodes on the live path
    const activeNodes = new Set(["start"]);
    if (interacted) {
      activeNodes.add("q1");
      if (EU.has(inputs.originCountry)) { activeNodes.add("r_eu"); }
      else if (cif > 0) {
        activeNodes.add("q2");
        if (cif <= 150) { activeNodes.add("r_lv"); }
        else {
          activeNodes.add("q3");
          if (hasPref) activeNodes.add("r_pref");
          activeNodes.add("q4");
          if (addPct > 0) activeNodes.add("r_add");
          if (inputs.hsCode) {
            activeNodes.add("q5");
            if (isExcise(inputs.hsCode)) activeNodes.add("r_exc");
            activeNodes.add("vat");
            activeNodes.add("total");
          }
        }
      }
    }

    return buildGraph({visible, activeNodes, cif, hasPref, addPct, vatRate, vat, customsDuty, addDuty, total});
  }, [inputs, interacted]);

  return (
    <>
      <style>{`@keyframes nodeEnter{from{opacity:0;transform:scale(0.82) translateY(-10px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      <div className="v2-card" style={{display:"flex",flexDirection:"column"}}>
        <div className="v2-card-hdr">
          <h2 style={{margin:0,fontSize:16,fontWeight:700,color:"#111827"}}>🗺️ Import Flow Calculator</h2>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#6b7280"}}>
            {interacted ? "Showing your import path live" : "Select origin and enter values to trace your import path"}
          </p>
        </div>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          <InputPanel inputs={inputs} onChange={onChange} onFetchDuty={onFetchDuty} dutyLoading={dutyLoading}/>
          <div style={{flex:1,height:720}}>
            <ReactFlow
              nodes={nodes} edges={edges} nodeTypes={nodeTypes}
              fitView fitViewOptions={{padding:0.15}}
              proOptions={{hideAttribution:true}}
              nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            >
              <Background color="#e5e7eb" gap={24} size={1}/>
              <Controls showInteractive={false}/>
            </ReactFlow>
          </div>
        </div>
      </div>
    </>
  );
}
