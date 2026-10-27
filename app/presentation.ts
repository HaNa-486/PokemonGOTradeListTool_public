import { catalog, variantLabel } from '../core/catalog';
import { traits,type ListingInput } from '../core/model';
export const names:Record<string,string>={STANDARD:'標準形態',NONE:'無裝扮',UNKNOWN:'未知',false:'一般色',true:'異色',NORMAL:'一般',SHADOW:'暗影',PURIFIED:'已淨化',ANY:'不限',DEX:'開圖鑑',CANDY:'收糖',XL_CANDY:'糖果 XL',SIZE:'體型收藏',COLLECTION:'其他收藏'};
export const title=(l:ListingInput)=>l.family?`${catalog.find(c=>c.family===l.species)?.zh??l.species} 物種家族`:(catalog.find(c=>c.id===l.species)?.zh??l.species);
export const label=(value:unknown,custom:Record<string,string>={}):string=>typeof value==='string'?(custom[value]??names[value]??variantLabel(value)):value&&typeof value==='object'&&'mode' in value?(value.mode==='ANY'?'不限':(value as {mode:string;values:string[]}).values.map(v=>label(v,custom)).join('／')):'';
export const summarize=(l:ListingInput&{variantLabels?:Record<string,string>})=>traits.map(t=>label(l.traits[t],l.variantLabels)).join(' · ');
