/** Shared parsing and uniqueness rules for participant-data definitions. */
const text=v=>String(v??'');
export const participantIdentity=value=>text(value).normalize('NFC').toLocaleLowerCase('fr');
export function parseAssignments(value){
 if(value==null||value==='')return [];
 return text(value).split('||').map(part=>{const at=part.indexOf('==');if(at<=0)throw Error('Une configuration contient un couple attribut/valeur invalide. Corrigez-le dans les réglages avancés.');return {name:part.slice(0,at),value:part.slice(at+2)};});
}
export const participantAssignments=row=>Object.keys(row||{}).filter(k=>/^PDATA_LIST_[1-5]$/.test(k)).sort().flatMap(field=>parseAssignments(row[field]));
