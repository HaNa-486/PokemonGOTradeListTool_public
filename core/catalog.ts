import { available, traits, type Listing } from './model';
import pack from '../data/active-catalog.generated.json';
import {validateCatalogPack} from './catalog-schema';
import {summarizeCatalog} from './catalog-summary';
const validated=validateCatalogPack(pack);
export const {items: catalog,...catalogDataset}=validated;
export const catalogVersion=catalogDataset.version;
export const catalogSummary = summarizeCatalog(catalog);
export const catalogById = new Map(catalog.map(c=>[c.id,c]));
export function variantLabel(id:string){for(const c of catalog){const v=[...c.forms,...c.costumes].find(v=>v.id===id);if(v)return v.label;}return id;}
export function tradeStatus(l:Listing){const c=catalogById.get(l.species);if(!c)return null;if(l.intent!=='provide')return null;if(l.traits.state==='SHADOW')return false;const f=c.forms.find(f=>f.id===l.traits.form);const costume=c.costumes.find(v=>v.id===l.traits.costume);if(c.tradable===false||f?.tradable===false||costume?.tradable===false)return false;return l.traits.costume==='NONE'?(f?f.tradable:c.tradable):(costume?.tradable??null);}
export function match(s: Listing, r: Listing) {
  if(s.intent!=='provide'||r.intent!=='request'||s.owner===r.owner||s.status!=='active'||r.status!=='active'||s.deletedAt||r.deletedAt) return null;
  if(Object.values(s.traits).includes('UNKNOWN')||tradeStatus(s)===false) return null;
  if(r.family ? catalog.find(x=>x.id===s.species)?.family!==r.species : s.species!==r.species) return null;
  for(const t of traits) { const c=r.traits[t];if(c.mode==='IN'&&!c.values.includes(s.traits[t]))return null; }
  if(s.protected && ['CANDY','XL_CANDY'].includes(r.purpose)) {
    const special: (typeof traits[number])[]=[];
    if(s.traits.shiny==='true')special.push('shiny');if(s.traits.costume!=='NONE')special.push('costume');if(['XXS','XXL'].includes(s.traits.size))special.push('size');
    if(special.some(t=>r.traits[t].mode==='ANY'))return null;
  }
  const q=Math.min(available(s)!,available(r)??1_000_000);return q>0?{quantity:q,reason:'物種／糖果家族與所有指定條件符合；數量於接受時重新檢查。'}:null;
}
