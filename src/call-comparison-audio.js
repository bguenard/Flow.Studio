import {simulationPlaylist,audioSegments} from './simulation-audio.js';
import {simulationStep} from './call-simulator.js';
import {comparisonWaitingStage} from './call-comparison.js';
export function comparisonPlaylist(c,side=c.cursor){
 const session=c.lanes[side],step=simulationStep(session);
 if(!step.waiting||session.status!=='active')return simulationPlaylist(session);
 const last=session.trail.at(-1),internal=c.events[side].at(-1)?.internal;
 const incoming=!internal&&last?.audio?audioSegments(last.audio):[];
 const stage=comparisonWaitingStage(c,side),value=stage<5?step.node.row['INQUEUE_AUDIO_'+stage]:'';
 return [...incoming,...(value?audioSegments(value):[])];
}
