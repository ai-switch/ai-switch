import {parse, type Node} from "acorn";
import type {Diagnostic} from "@ai-switch/tauri-plugin-runtime/protocol";

interface SyntaxNode extends Node {[key:string]:unknown}
const isNode=(value:unknown):value is SyntaxNode=>value!==null && typeof value==="object" && typeof (value as {type?:unknown}).type==="string";
const literal=(value:unknown)=>isNode(value) && value.type==="Literal" && typeof value.value==="string" ? value.value : undefined;
const child=(value:unknown)=>isNode(value)?value:undefined;

/** Node-only syntax inspection. No evaluation, no Vite optional-peer dependency. */
export function scanJavaScriptSyntax(path:string,text:string,resource:(value:string)=>void):Diagnostic[] {
  const diagnostics:Diagnostic[]=[];
  try {
    const tree=parse(text,{ecmaVersion:"latest",sourceType:"module",onComment(_block,value){
      if(/sourceMappingURL\s*=/.test(value))diagnostics.push({code:"E_SOURCE_MAP",path,message:"Source maps are not part of the offline artifact profile."});
    }});
    const queue:SyntaxNode[]=[tree as unknown as SyntaxNode];let count=0;
    while(queue.length){
      const item=queue.pop()!;if(++count>500000)throw new Error("syntax budget");
      if(item.type==="CallExpression"){
        const callee=child(item.callee);
        const member=callee?.type==="MemberExpression" ? (callee.computed?literal(callee.property):child(callee.property)?.name):undefined;
        if(callee?.type==="Identifier" && callee.name==="require" || member==="require")diagnostics.push({code:"E_NODE_IMPORT",path,message:"Runtime require calls are not portable browser artifact imports."});
      }
      if(item.type==="NewExpression"){
        const callee=child(item.callee);const args=Array.isArray(item.arguments)?item.arguments:[];const url=literal(args[0]);
        if(callee?.type==="Identifier" && ["URL","Worker","SharedWorker"].includes(String(callee.name)) && url!==undefined) {
          resource(url);const base=literal(args[1]);if(callee.name==="URL" && base!==undefined)resource(base);
        }
      }
      for(const value of Object.values(item))if(isNode(value))queue.push(value);else if(Array.isArray(value))for(const nested of value)if(isNode(nested))queue.push(nested);
    }
  }catch{diagnostics.push({code:"E_JS_PARSE",path,message:"JavaScript syntax could not be parsed within its budget."});}
  return diagnostics;
}
