import {z} from 'zod';
import {listingInput,positive,qty} from './model';
const s=z.string().min(1).max(100),timestamp=z.string().datetime();
const base=z.object({id:s,kind:s,owner:s,circle:s.optional(),version:positive,createdAt:timestamp,updatedAt:timestamp});
const refList=z.array(s).refine(a=>new Set(a).size===a.length);
const listingTail=z.object({reserved:qty,fulfilled:qty,deletedAt:timestamp.nullable(),historyBound:z.boolean().optional(),variantLabels:z.record(z.string(),z.string()).optional()});
export const backupListing=z.union(listingInput.options.map(o=>base.merge(o).merge(listingTail).strict()) as unknown as [z.ZodTypeAny,z.ZodTypeAny]);
const item=z.object({id:s,from:s,supply:s.nullable(),request:s.nullable(),quantity:positive,snapshot:backupListing.nullable(),completed:qty,pending:qty,cancelled:qty}).strict();
const schemas:Record<string,z.ZodTypeAny>={
  visibility:base.omit({circle:true}).extend({id:z.string().min(1).max(220),kind:z.literal('visibility'),listing:s,hidden:z.boolean()}).strict(),
  listing:backupListing,
  circle:base.extend({kind:z.literal('circle'),name:z.string().min(1).max(60),fast:z.boolean(),members:z.record(z.string(),z.object({role:z.enum(['owner','admin','member']),status:z.enum(['active','pending','removed'])}).strict())}).strict(),
  grant:base.extend({delegate:s,targets:refList,circles:refList,create:z.boolean(),revoked:z.boolean()}).strict(),
  variant:base.extend({species:s,trait:z.enum(['form','costume']),label:z.string().min(2).max(60),status:z.enum(['pending','approved','rejected'])}).strict(),
  plan:base.extend({parties:z.array(s).length(2).refine(a=>new Set(a).size===a.length),revision:positive,status:z.enum(['proposed','reserved','in_progress','completed','cancelled','declined']),items:z.array(item).min(2).max(30),consents:refList,fastConsents:refList}).strict(),
  completion:base.extend({plan:s,lines:z.record(z.string(),positive),consents:refList,voidConsents:refList,fast:z.boolean(),status:z.enum(['pending','posted','void']),revision:positive}).strict(),
  correction:base.extend({completion:s,plan:s,reason:z.string().min(5).max(1000),consents:refList,status:z.enum(['pending','posted','rejected']),restoreInventory:z.boolean(),rejectionReason:z.string().min(5).max(1000).optional()}).strict(),
  import:base.extend({rows:z.array(z.object({sourceId:s,id:s,data:listingInput}).strict()),conflicts:z.array(z.string()),backup:z.array(backupListing),status:z.enum(['preview','applied'])}).strict(),
};
export function validateEntitySchema(value:unknown){const kind=(value as {kind?:string})?.kind;const schema=kind?schemas[kind]:undefined;if(!schema)throw new Error('Unsupported backup entity kind');schema.parse(value);}
