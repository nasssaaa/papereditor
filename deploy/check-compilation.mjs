import fs from 'node:fs';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:18080';
const credentials=JSON.parse(fs.readFileSync(process.env.TEST_CREDENTIALS_FILE || '.data/bootstrap-admin.json','utf8'));
let response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
if(!response.ok)throw new Error('Login failed');const cookie=response.headers.get('set-cookie').split(';')[0];
const headers={Cookie:cookie,'Content-Type':'application/json'};
const projects=await(await fetch(base+'/api/projects',{headers})).json();
for(const title of ['English Research Paper','我的第一篇论文']){
  const project=projects.find(p=>p.title===title);if(!project)continue;
  response=await fetch(base+`/api/projects/${project.id}/compile`,{method:'POST',headers,body:'{}'});if(!response.ok)throw new Error(await response.text());let b=await response.json();
  console.log(title,'requested');let last='';const deadline=Date.now()+150000;
  while(['queued','running'].includes(b.status)){if(Date.now()>deadline)throw new Error('Compile polling timed out');await new Promise(r=>setTimeout(r,1000));b=await(await fetch(base+`/api/builds/${b.id}`,{headers})).json();if(b.status!==last){console.log(title,b.status);last=b.status;}}
  console.log(JSON.stringify({title,id:b.id,status:b.status,durationMs:b.durationMs,diagnostics:b.diagnostics}));
  if(b.status!=='success'){console.log(b.log.slice(-5000));process.exitCode=1;continue;}
  const pdf=await fetch(base+`/api/builds/${b.id}/pdf`,{headers});const bytes=Buffer.from(await pdf.arrayBuffer());if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Output is not a PDF');
  fs.mkdirSync('.local',{recursive:true});fs.writeFileSync(`.local/${project.engine}-output.pdf`,bytes);
  const sync=await fetch(base+`/api/builds/${b.id}/synctex`,{method:'POST',headers,body:JSON.stringify({fileId:project.mainFileId,line:project.engine==='xelatex'?14:16})});console.log('SyncTeX forward:',sync.status,await sync.text());
}
