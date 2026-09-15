import {createPluginHost} from "@ai-switch/tauri-plugin-runtime/host";
import {type HostTransport, type SessionDescriptor, type HostOperation, type JsonObject} from "@ai-switch/tauri-plugin-runtime/protocol";

const requested=new URLSearchParams(location.search).get("variant");
const variant=requested==="throws"||requested==="static"?requested:"normal";
const automatic=new URLSearchParams(location.search).has("automatic");
const set=(id:string,value:string|number)=>{document.getElementById(id)!.textContent=String(value);};
let pending: {source:Window;data:unknown;origin:string}|undefined;let released=false;let calls=0;let sessions=0;
// A test-only gate before the public host's real listener. The replay below
// carries the same source/origin/nonce and exercises R5 handshake, not a fake SDK.
window.addEventListener("message",(event)=>{
  if(!automatic && !released && event.source===document.querySelector("iframe")?.contentWindow && event.data?.channel==="aplg.bootstrap" && event.data?.kind==="ready") {
    event.stopImmediatePropagation();pending={source:event.source as Window,data:event.data,origin:event.origin};set("waiting","ready intercepted");
  }
},true);
const descriptor=():SessionDescriptor=>({
  sessionId:"d4-session",assetUrl:`http://127.0.0.1:43272/${variant}/index.html`,
  manifest:{manifestVersion:1,id:"io.github.example.notes",name:"Bootstrap fixture",version:"0.1.0",description:"Fixture",license:"MIT",engines:{aplg:"^1.0.0"},entry:"dist/index.html",activation:"view",requires:{"aplg.storage":"^1.0.0"},optional:{},permissions:{filesystem:[],network:[],native:false},contributes:{views:[{id:"main",title:"Notes"}]}},
  info:{protocol:"aplg/1",apiVersion:"1.0.0",plugin:{id:"io.github.example.notes",version:"0.1.0",packageSha256:"0".repeat(64)},capabilities:{"aplg.storage":{version:"1.0.0",methods:["get","set","remove"]}},limits:{controlBytes:1048576,fileChunkBytes:262144,fileBytes:8388608,fileTransfers:2}},
});
const transport:HostTransport={
  async call<T>(operation:HostOperation,_args:JsonObject):Promise<T> {
    if(operation==="session.open"){set("sessions",++sessions);return descriptor() as T;}
    if(operation==="session.close"){set("sessions",--sessions);return null as T;}
    if(operation==="capability.call"){set("calls",++calls);return null as T;}
    return null as T;
  },async subscribe(){return ()=>{};},
};
const host=createPluginHost({transport,allowedAssetOrigins:["http://127.0.0.1:43272"]});
void host.mount({pluginId:"io.github.example.notes",container:document.getElementById("slot")!}).then(()=>set("status","mounted"),()=>set("status","closed"));
document.getElementById("connect")!.addEventListener("click",()=>{
  if(!pending || released)return;released=true;
  window.dispatchEvent(new MessageEvent("message",{data:pending.data,source:pending.source,origin:pending.origin}));
});
document.getElementById("reject")!.addEventListener("click",()=>{
  if(!pending || released)return;released=true;
  const data=pending.data as {nonce:string};
  pending.source.postMessage({channel:"aplg.bootstrap",kind:"connect",protocol:"aplg/99",nonce:data.nonce},"*");
});
document.getElementById("dispose")!.addEventListener("click",()=>{void host.dispose();});
window.addEventListener("pagehide",()=>{void host.dispose();});
