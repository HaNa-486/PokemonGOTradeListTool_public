import { z } from 'zod';
export class Problem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function ensure(value: unknown, code = 'conflict', message = '資料已變更，請重新整理後確認。', status = 409): asserts value {
  if (!value) throw new Problem(status, code, message);
}
export const qty = z.number().int().min(0).max(1_000_000);
export const positive = qty.min(1);
const choice = z.union([z.object({ mode: z.literal('ANY') }).strict(), z.object({ mode: z.literal('IN'), values: z.array(z.string().min(1).max(100)).min(1).max(50) }).strict()]);
export const traits = ['form', 'shiny', 'size', 'state', 'costume'] as const;
export const supplyTraits = z.object({ form: z.string().min(1).max(100), shiny: z.enum(['false','true','UNKNOWN']), size: z.enum(['XXS','XS','NORMAL','XL','XXL','UNKNOWN']), state: z.enum(['NORMAL','SHADOW','PURIFIED','UNKNOWN']), costume: z.string().min(1).max(100) }).strict();
export const requestTraits = z.object({ form: choice, shiny: choice, size: choice, state: choice, costume: choice }).strict();
const common = { species: z.string().min(1).max(100), shares: z.array(z.string().min(1).max(100)).max(30), purpose: z.enum(['DEX','CANDY','XL_CANDY','SIZE','COLLECTION']), note: z.string().max(1000), protected: z.boolean(), status: z.enum(['active','draft','paused','archived']), priority: z.number().int().min(0).max(3) };
export const listingInput = z.discriminatedUnion('intent', [
  z.object({ ...common, intent: z.literal('provide'), traits: supplyTraits, quantity: qty, family: z.literal(false) }).strict(),
  z.object({ ...common, intent: z.literal('request'), traits: requestTraits, quantity: qty.nullable(), family: z.boolean() }).strict(),
]);
export type ListingInput = z.infer<typeof listingInput>;
export type Entity = { id: string; kind: string; owner: string; circle?: string; version: number; createdAt: string; updatedAt: string };
export type Visibility = Entity & {kind:'visibility';listing:string;hidden:boolean};
export type Audit = {id:string;actor:string;operation:string;entityId:string;owner:string;data:unknown};
export type Listing = Entity & ListingInput & { reserved: number; fulfilled: number; deletedAt: string | null; historyBound?: boolean; variantLabels?:Record<string,string> };
export type Variant = Entity & { species:string; trait:'form'|'costume'; label:string; status:'pending'|'approved'|'rejected' };
export type VariantOption = Pick<Variant,'id'|'species'|'trait'|'label'|'status'> & Partial<Variant>;
export type Circle = Entity & { kind: 'circle'; name: string; fast: boolean; members: Record<string, { role: 'owner'|'admin'|'member'; status:'active'|'pending'|'removed' }> };
export type Invitation = Entity & { hash: string; expires: number; used: boolean; revoked: boolean };
export type Grant = Entity & { delegate: string; targets: string[]; circles: string[]; create: boolean; revoked: boolean };
export type TradeItem = { id: string; from: string; supply: string | null; request: string | null; quantity: number; snapshot: Listing | null; completed: number; pending: number; cancelled: number };
export type Plan = Entity & { parties: string[]; revision: number; status: 'proposed'|'reserved'|'in_progress'|'completed'|'cancelled'|'declined'; items: TradeItem[]; consents: string[]; fastConsents: string[] };
export type Completion = Entity & { plan: string; lines: Record<string, number>; consents: string[]; voidConsents: string[]; fast: boolean; status: 'pending'|'posted'|'void'; revision: number };
export type Correction = Entity & { completion: string; plan: string; reason: string; consents: string[]; status:'pending'|'posted'|'rejected'; restoreInventory: boolean; rejectionReason?:string };
export interface Unit {
  audit(id:string):Promise<Audit|null>;
  get<T extends Entity>(id: string): Promise<T | null>;
  list<T extends Entity>(kind: string, filter?: {owner?: string;circle?:string}): Promise<T[]>;
  put<T extends Entity>(entity: T): void;
  event(owner: string, entityId: string, data: unknown): void;
}
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function make(kind: string, owner: string, circle?: string): Entity { return { id:id(),kind,owner,...(circle?{circle}:{}),version:1,createdAt:now(),updatedAt:now() }; }
export function change<T extends Entity>(e: T): T { return {...e,version:e.version+1,updatedAt:now()}; }
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return '['+x.map(canonical).join(',')+']';
  if (x && typeof x === 'object') return '{'+Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(x);
}
export async function digest(s: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export function opaque() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export function fingerprint(l: ListingInput & {owner:string}): string | null {
  if (canonical(l.traits).includes('UNKNOWN')) return null;
  const normalized = l.intent==='request' ? Object.fromEntries(traits.map(t=>[t,l.traits[t].mode==='ANY'?{mode:'ANY'}:{mode:'IN',values:[...new Set((l.traits[t] as {values:string[]}).values)].sort()}])) : l.traits;
  return canonical({comparisonVersion:1,owner:l.owner,intent:l.intent,species:l.species,family:l.family,traits:normalized, shares:[...new Set(l.shares)].sort(),purpose:l.purpose,note:l.note.normalize('NFC').trim().replace(/\r\n/g,'\n'),protected:l.protected, status:l.status,priority:l.priority,mode:l.intent==='request'?(l.quantity===null?'ongoing':'finite'):'stock'});
}
export function available(l: Listing) { return l.quantity===null ? null : l.quantity-l.reserved-(l.intent==='request'?l.fulfilled:0); }
export function invariant(l: Listing) {
  qty.parse(l.reserved);qty.parse(l.fulfilled);
  if(l.quantity!==null) { qty.parse(l.quantity); ensure(available(l)!>=0,'quantity','數量不得低於已完成與已預留。'); }
}
