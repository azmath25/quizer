// STG2.1: offline staging composition of the existing QN11 full runtime.
// Intentionally NOT imported by the active Firebase router, index or worker.
// This module is inert until trusted server code explicitly enables it.
import {createQuizerStagedFullRuntime}
  from "./private-full-staging.js";
import {createQuizerStg2Bridge}
  from "./stg2-callable-bridge.js";

export function createQuizerStg2StagingRuntime({
  enabled=false,stagingPorts,attestIdentity,authorizeWorker,now,
}={}){
  if(enabled!==true)return createQuizerStg2Bridge();
  if(!stagingPorts || typeof stagingPorts!=="object" ||
      Array.isArray(stagingPorts) ||
      typeof attestIdentity!=="function" ||
      typeof authorizeWorker!=="function")
    throw new Error("Missing trusted Quizer staging integration ports.");
  const ports=Object.freeze({...stagingPorts,enabled:true});
  return createQuizerStg2Bridge({
    enabled:true,attestIdentity,authorizeWorker,now,
    makeRuntime:()=>createQuizerStagedFullRuntime(ports),
  });
}
