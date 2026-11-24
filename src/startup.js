/** Enter through Genesys; a rejected callback must never restart OAuth in a loop. */
export async function loadStudioSession({loadSource,loadIdentity}) {
  const snapshot=await loadSource();
  try{return {snapshot,identity:await loadIdentity(),identityError:null};}
  catch(error){
    if(error.status===401)throw error;
    return {snapshot,identity:null,identityError:error.message};
  }
}
export async function startGenesysSession({ completeLogin, beginLogin, loadSource, invalidateSession = () => {} }) {
  const result = await completeLogin();
  if (result.authenticated) {
    try { await loadSource(); }
    catch (error) { if (error.status === 401) invalidateSession(); throw error; }
    return 'connected';
  }
  if (result.handled) throw Error('La connexion Genesys n’a pas abouti. Relancez la connexion.');
  await beginLogin();
  return 'redirecting';
}
