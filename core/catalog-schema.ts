import {z} from 'zod';
const key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/);
const variant=z.object({id:key,label:z.string().trim().min(1).max(100),tradable:z.boolean().nullable()}).strict();
export const catalogPackSchema=z.object({
  schemaVersion:z.literal(1),datasetId:key,version:z.string().min(1).max(60),kind:z.enum(['synthetic','external']),
  title:z.string().min(1).max(100),license:z.string().min(1).max(200),
  source:z.string().min(1).max(1000),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
  items:z.array(z.object({id:z.string().regex(/^[1-9][0-9]{0,8}$/),zh:z.string().min(1).max(100),en:z.string().min(1).max(100),alias:z.string().max(300),family:key,tradable:z.boolean().nullable(),forms:z.array(variant).min(1).max(200),costumes:z.array(variant).max(200)}).strict()).min(1).max(10000)
}).strict().superRefine((pack,ctx)=>{
  const ids=new Set<string>();const variants=new Map<string,string>();
  for(const [i,item] of pack.items.entries()){
    if(ids.has(item.id))ctx.addIssue({code:'custom',path:['items',i,'id'],message:'Duplicate species ID'});ids.add(item.id);
    if(!item.costumes.some(v=>v.id==='NONE'))ctx.addIssue({code:'custom',path:['items',i,'costumes'],message:'Explicit NONE costume is required'});
    for(const type of ['forms','costumes'] as const){const seen=new Set<string>();for(const v of item[type]){
      if(seen.has(v.id)||v.id.startsWith('custom:')||(['UNKNOWN','ANY','true','false','NORMAL','SHADOW','PURIFIED','DEX','CANDY','XL_CANDY','SIZE','COLLECTION','XXS','XS','XL','XXL'].includes(v.id)||(type==='forms'&&v.id==='NONE')))ctx.addIssue({code:'custom',path:['items',i,type],message:'Duplicate or reserved variant ID'});
      if((v.id==='STANDARD'&&(type!=='forms'||v.label!=='標準形態'))||(v.id==='NONE'&&(type!=='costumes'||v.label!=='無裝扮')))ctx.addIssue({code:'custom',path:['items',i,type],message:'Built-in variant meaning must be preserved'});
      seen.add(v.id);const prior=variants.get(v.id);if(prior&&prior!==v.label)ctx.addIssue({code:'custom',path:['items',i,type],message:'Variant ID has inconsistent labels'});variants.set(v.id,v.label);
    }}
  }
});
export type CatalogPack=z.infer<typeof catalogPackSchema>;
export function validateCatalogPack(value:unknown){return catalogPackSchema.parse(value);}
