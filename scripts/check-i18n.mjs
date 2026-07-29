import fs from 'fs';
import path from 'path';
const src=fs.readFileSync('src/lib/i18n.jsx','utf8');
const heStart=src.indexOf('  he: {'), enStart=src.indexOf('  en: {'), end=src.indexOf('\n}\n', enStart);
const keysIn=(chunk)=>new Set([...chunk.matchAll(/(?:^|[{,]\s*)([a-zA-Z_][\w]*)\s*:/gm)].map(m=>m[1]));
const he=keysIn(src.slice(heStart,enStart)), en=keysIn(src.slice(enStart,end));
// dynamic keys the code builds at runtime
const dynamic=new Set(['scope_frc','scope_ftc','scope_both']);
const files=[];
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);
  if(fs.statSync(p).isDirectory())walk(p); else if(/\.jsx?$/.test(p))files.push(p);}})('src');
let bad=0;
for(const f of files){
  const c=fs.readFileSync(f,'utf8');
  for(const m of c.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)){
    const k=m[1];
    if(dynamic.has(k))continue;
    if(!he.has(k)||!en.has(k)){console.log('MISSING',k,'->',f,he.has(k)?'':'[no he]',en.has(k)?'':'[no en]');bad++;}
  }
  // template-built keys, e.g. t('scope_' + s)
  for(const m of c.matchAll(/\bt\(\s*'([a-zA-Z_]+)_?'\s*\+/g)) console.log('  (dynamic prefix)',m[1],'in',f);
}
console.log(bad? `\n${bad} MISSING KEYS`:'\nall t() keys present in both languages');
process.exit(bad ? 1 : 0)
