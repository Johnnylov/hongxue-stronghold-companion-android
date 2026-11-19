// Normalize the public formation data into the same model used for manual imports.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const directory = process.argv[2];
if (!directory) throw Error("Pass the directory containing index.json and public guide detail JSON files.");
const assets = fileURLToPath(new URL("../app/src/main/assets/", import.meta.url));
const shared = fs.readFileSync(path.join(assets,"model.js"),"utf8");
const parse = vm.runInNewContext(shared+"\nGuideModel.fromSkland", {URL});
const index = JSON.parse(fs.readFileSync(path.join(directory,"index.json"),"utf8"));
const guides = index.selected.map(row => {
  if (row.likes <= index.minLikesExclusive || row.invalid || row.page < 1 || row.page > index.pages) throw Error("Invalid selection: "+row.id);
  const source = JSON.parse(fs.readFileSync(path.join(directory,row.id+".json"),"utf8"));
  const guide=parse(source,row.id);
  guide.likes=row.likes;guide.listPage=row.page;guide.blurb="";
  for(const stage of guide.stages){
    // Community editorial text is read on demand from its attributed original.
    const ops=stage.entries.filter(x=>x.key.startsWith("op:")).length;
    stage.note="本阶段列出 "+ops+" 名干员、"+(stage.entries.length-ops)+" 件装备。";
  }
  return guide;
}).sort((a,b)=>b.likes-a.likes);
const {selected,...meta}=index;
if(new Set(guides.map(g=>g.id)).size!==guides.length)throw Error("Duplicate guide IDs");
fs.writeFileSync(path.join(assets,"bundled-guides.json"),JSON.stringify({...meta,guides}));
console.log(guides.length+" offline guides, "+guides.reduce((n,g)=>n+g.stages.length,0)+" stages");
