import { ensure } from '../core/model';

export async function limitedBody(req: Request, limit=64000): Promise<string> {
  ensure(Number(req.headers.get('content-length')??0)<=limit,'body_size','資料過大，請分批操作。',413);
  const reader=req.body?.getReader();if(!reader)return '';
  let size=0;const parts:Uint8Array[]=[];
  while(true){
    const chunk=await reader.read();if(chunk.done)break;
    size+=chunk.value.length;
    if(size>limit){await reader.cancel();ensure(false,'body_size','資料過大，請分批操作。',413);}
    parts.push(chunk.value);
  }
  const body=new Uint8Array(size);let offset=0;
  for(const part of parts){body.set(part,offset);offset+=part.length;}
  return new TextDecoder().decode(body);
}
