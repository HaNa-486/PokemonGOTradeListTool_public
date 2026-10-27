export function summarizeCatalog(items:readonly {id:string}[]){
const ids=[...new Set(items.map(item=>Number(item.id)))].sort((a,b)=>a-b);
if(!ids.length)return {count:0,maxId:0,description:'目錄尚無資料'};
const contiguous=ids.every((id,index)=>id===ids[0]+index);
return {count:ids.length,maxId:ids.at(-1)!,description:contiguous?`目錄 ${ids[0]}–${ids.at(-1)}（${ids.length} 種）`:`已收錄 ${ids.length} 種物種（最高編號 #${ids.at(-1)}）`};
}
