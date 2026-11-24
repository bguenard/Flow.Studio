import { simulationStep } from './call-simulator.js';
import { GENESYS_API_ORIGIN } from './genesys-direct.js';
export function audioSegments(value) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !/^barg:/i.test(part))
    .map((part) => {
      if (/\$?var:/i.test(part))
        return { kind: 'unavailable', name: 'Message dépendant du contexte de l’appel' };
      const match = part.match(/^(tts|pr|prompt):([\s\S]*)$/i);
      if (!match || !match[2].trim()) return { kind: 'unavailable', name: part };
      return match[1].toLowerCase() === 'tts'
        ? { kind: 'tts', text: match[2].trim() }
        : { kind: 'prompt', name: match[2].trim() };
    });
}
export function simulationPlaylist(session) {
  const last = session.trail.at(-1),
    transition = last?.audio ? audioSegments(last.audio) : [];
  const messages =
    session.status === 'active'
      ? simulationStep(session).messages.flatMap((message) => audioSegments(message.value))
      : [];
  return [...transition, ...messages];
}
export function simulationLanguage(session) {
  const node = simulationStep(session).node,
    entry = session.flow.nodes.find((n) => n.id === session.flow.id);
  // A transition may switch the language (menu|lang:en-us) for what follows.
  const switched = [...session.trail].reverse().find((step) => step.language)?.language;
  const lang = String(node?.row.LANGUAGE || switched || entry?.row.LANGUAGE || 'fr-fr');
  return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(lang) ? lang : 'fr-fr';
}
/** Fixed API origin. The bearer token never goes to the media URL. */
export function createPromptResolver(getToken, { fetchImpl = globalThis.fetch } = {}) {
  return async (name, language, signal) => {
    const token = getToken();
    if (!token) throw Error('Connectez-vous à Genesys pour écouter les messages enregistrés.');
    const url = new URL(GENESYS_API_ORIGIN + '/api/v2/architect/prompts');
    url.search = new URLSearchParams({
      name,
      includeResources: 'true',
      includeMediaUris: 'true',
      pageSize: '100',
      pageNumber: '1',
    });
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw Error('Message Genesys injoignable. Vérifiez le réseau, puis relancez la lecture.');
    }
    if (!response.ok)
      throw Error(
        response.status === 403
          ? 'Lecture du message refusée par Genesys : accès aux prompts requis.'
          : response.status === 401
            ? 'Session Genesys expirée.'
            : `Message Genesys indisponible (HTTP ${response.status}).`,
      );
    const payload = await response.json(),
      prompts = (payload.entities || []).filter((p) => p.name === name);
    if (prompts.length !== 1 || payload.pageCount > 1)
      throw Error(`Message « ${name} » absent ou ambigu dans Genesys.`);
    const resources = prompts[0].resources || [],
      lang = language.toLowerCase();
    const exact = resources.filter((r) => String(r.language).toLowerCase() === lang);
    const resource = exact.length === 1 ? exact[0] : null;
    if (!resource) throw Error(`Message « ${name} » indisponible en ${language}.`);
    if (resource.mediaUri) {
      let media;
      try {
        media = new URL(resource.mediaUri);
      } catch {}
      if (!media || media.protocol !== 'https:' || media.username || media.password)
        throw Error('Adresse audio Genesys invalide.');
      return { kind: 'media', url: media.href };
    }
    if (resource.ttsString) return { kind: 'tts', text: resource.ttsString };
    throw Error(`Le message « ${name} » ne contient aucun audio ni texte à lire.`);
  };
}
// Voix de synthèse robotiques ou fantaisie livrées avec macOS (Eloquence, effets sonores). Sans choix
// explicite, le navigateur prend la première voix de la langue : en français, c'est l'une d'elles.
const NOVELTY_VOICE =
  /^(?:Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph)\b/i;
const QUALITY_VOICE = /\b(?:premium|enhanced|améliorée|natural|neural|online|siri)\b/i;
/** Meilleure voix installée pour une langue : même pays d'abord, voix naturelle avant voix standard, jamais une voix fantaisie s'il existe autre chose. */
export function pickVoice(voices, language) {
  const wanted = String(language || '')
      .toLowerCase()
      .replace('_', '-'),
    primary = wanted.split('-')[0];
  let best = null,
    bestScore = -Infinity;
  for (const voice of voices || []) {
    const lang = String(voice?.lang || '')
      .toLowerCase()
      .replace('_', '-');
    if (!lang || lang.split('-')[0] !== primary) continue;
    const name = String(voice.name || '');
    const score =
      (lang === wanted ? 40 : 0) +
      (QUALITY_VOICE.test(name) ? 30 : /^Google\b/i.test(name) ? 20 : 0) -
      (NOVELTY_VOICE.test(name) ? 100 : 0) +
      (voice.default ? 5 : 0);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
/** Cancellable sequential audio; completion, not a timer estimate, drives navigation. */
export function createSimulationAudio({
  speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  AudioClass = globalThis.Audio,
  resolvePrompt,
  onState = () => {},
} = {}) {
  let controller = null,
    cleanup = null,
    generation = 0;
  // Chrome ne remplit la liste des voix qu'après une première demande.
  try {
    speech?.getVoices?.();
  } catch {}
  function cancel() {
    generation++;
    controller?.abort();
    cleanup?.();
    cleanup = null;
    controller = null;
    speech?.cancel();
  }
  function playItem(item, language, signal) {
    return new Promise((resolve, reject) => {
      let media,
        utterance,
        timeout,
        finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (media) {
          media.onended = media.onerror = null;
          media.pause();
          media.removeAttribute('src');
          media.load();
        }
        if (utterance) utterance.onend = utterance.onerror = utterance.onstart = null;
        cleanup = null;
        error ? reject(error) : resolve();
      };
      const abort = () => finish(Object.assign(Error('Lecture annulée'), { name: 'AbortError' }));
      cleanup = abort;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      timeout = setTimeout(
        () =>
          finish(
            Error('La lecture audio n’a pas pu se terminer. Relancez-la ou désactivez le son.'),
          ),
        180000,
      );
      if (item.kind === 'tts') {
        if (!speech || !Utterance)
          return finish(Error('La synthèse vocale n’est pas disponible dans ce navigateur.'));
        utterance = new Utterance(item.text);
        utterance.lang = language;
        let voice = null;
        try {
          voice = pickVoice(speech.getVoices?.(), language);
        } catch {}
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.onstart = () => onState('speaking');
        utterance.onend = () => finish();
        utterance.onerror = () =>
          finish(
            Error('Lecture vocale bloquée par le navigateur. Relancez la lecture pour réessayer.'),
          );
        try {
          speech.speak(utterance);
        } catch {
          finish(Error('Impossible de démarrer la lecture vocale.'));
        }
      } else if (item.kind === 'media') {
        if (!AudioClass) return finish(Error('Lecture audio indisponible.'));
        media = new AudioClass();
        media.src = item.url;
        media.onended = () => finish();
        media.onerror = () => finish(Error('Le message enregistré ne peut pas être lu.'));
        try {
          Promise.resolve(media.play()).then(
            () => {
              if (!finished) onState('speaking');
            },
            () => finish(Error('Lecture audio bloquée par le navigateur. Relancez la lecture.')),
          );
        } catch {
          finish(Error('Lecture audio indisponible.'));
        }
      } else finish(Error(`Audio non résolu : ${item.name || 'message dynamique'}.`));
    });
  }
  async function play(items, language) {
    cancel();
    const run = generation;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      for (const part of items) {
        if (signal.aborted) break;
        onState('loading');
        const item =
          part.kind === 'prompt' ? await resolvePrompt(part.name, language, signal) : part;
        if (signal.aborted) break;
        await playItem(item, language, signal);
      }
      if (run !== generation) return { cancelled: true };
      onState('done');
      return { cancelled: false };
    } catch (error) {
      if (signal.aborted || run !== generation) return { cancelled: true };
      onState('error');
      throw error;
    }
  }
  return { play, cancel };
}
