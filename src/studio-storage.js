/** Browser persistence; never contains OAuth tokens. Not an immutable server audit. */
let database;
function open(){return database ||= new Promise((resolve,reject)=>{const req=indexedDB.open('wolf-studio-v5',1);req.onupgradeneeded=()=>{req.result.createObjectStore('journals',{keyPath:'id'});req.result.createObjectStore('workspaces',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{database=null;reject(Error('Stockage Studio indisponible.'));};});}
async function transact(store,mode,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),req=operation(tx.objectStore(store));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(Error('Impossible de conserver les données du Studio.'));tx.onabort=()=>reject(Error('Enregistrement Studio annulé.'));});}
export const savePublication=run=>transact('journals','readwrite',s=>s.put(run));
export const publicationHistory=async orgId=>(await transact('journals','readonly',s=>s.getAll())).filter(r=>r.actor.organizationId===orgId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
export const saveWorkspace=(id,data)=>transact('workspaces','readwrite',s=>s.put({id,data,at:new Date().toISOString()}));
export const readWorkspace=id=>transact('workspaces','readonly',s=>s.get(id));
export const clearWorkspace=id=>transact('workspaces','readwrite',s=>s.delete(id));
