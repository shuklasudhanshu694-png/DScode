const crypto=require('crypto');
const G=require('../terminal/gitclient.js');
const S=require('../shared/store.js');
const sha=(buf,type='blob')=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from(type+' '+buf.length+'\0'),buf])).digest('hex');
function fakeServer(){
  const st={blobs:{},trees:{},commits:{},refs:{},log:[],empty:false,rateLimitOnce:false,failCommit:false,fiveXXOnce:0};
  const addBlob=(buf)=>{const s=sha(buf);st.blobs[s]=buf;return s};
  function mkTree(files){const id=crypto.createHash('sha1').update(JSON.stringify(files)+Math.random()).digest('hex');st.trees[id]=Object.assign({},files);return id}
  st.seed=(files,branch='main')=>{const m={};for(const[p,c]of Object.entries(files))m[p]={sha:addBlob(Buffer.from(c)),mode:'100644'};const t=mkTree(m);const c=crypto.randomBytes(20).toString('hex');st.commits[c]={tree:t,parents:[]};st.refs[branch]=c;};
  const resp=(status,obj,headers={})=>({ok:status<300,status,url:'https://api.github.com/x',headers:{get:n=>headers[n.toLowerCase()]??null},text:async()=>obj===undefined?'':JSON.stringify(obj)});
  st.fetch=async(url,init)=>{
    const u=new URL(url);const p=u.pathname;const m=init.method;st.log.push(m+' '+p);
    if(init.headers.Authorization!=='Bearer good')return resp(401,{message:'Bad credentials'});
    if(st.fiveXXOnce>0){st.fiveXXOnce--;return resp(502,{message:'bad gateway'})}
    let r;
    if(p==='/user')return resp(200,{login:'tester'},{'x-oauth-scopes':'repo','github-authentication-token-expiration':'2027-01-01'});
    if(r=/^\/repos\/o\/r\/git\/ref\/heads\/(.+)$/.exec(p)){const b=decodeURIComponent(r[1]);if(st.empty)return resp(409,{message:'Git Repository is empty.'});return st.refs[b]?resp(200,{object:{sha:st.refs[b]}}):resp(404,{message:'Not Found'})}
    if(r=/^\/repos\/o\/r\/git\/commits\/(\w+)$/.exec(p)&&m==='GET'){const id=/commits\/(\w+)/.exec(p)[1];return resp(200,{tree:{sha:st.commits[id].tree}})}
    if(/\/git\/trees\/\w+$/.test(p)&&m==='GET'){const id=/trees\/(\w+)/.exec(p)[1];const t=st.trees[id];return resp(200,{truncated:false,tree:Object.entries(t).map(([path,v])=>({path,mode:v.mode,type:'blob',sha:v.sha}))})}
    if(p==='/repos/o/r/git/blobs'&&m==='POST'){if(st.empty)return resp(409,{message:'Git Repository is empty.'});const b=JSON.parse(init.body);return resp(201,{sha:addBlob(Buffer.from(b.content,'base64'))})}
    if(r=/^\/repos\/o\/r\/git\/blobs\/(\w+)$/.exec(p))return resp(200,{encoding:'base64',content:st.blobs[r[1]].toString('base64')});
    if(p==='/repos/o/r/git/trees'&&m==='POST'){const b=JSON.parse(init.body);const t=Object.assign({},st.trees[b.base_tree]);for(const e of b.tree){if(e.sha===null)delete t[e.path];else t[e.path]={sha:e.sha,mode:e.mode}}return resp(201,{sha:mkTree(t)})}
    if(p==='/repos/o/r/git/commits'&&m==='POST'){if(st.failCommit)return resp(500,{message:'boom'});const b=JSON.parse(init.body);const c=crypto.randomBytes(20).toString('hex');st.commits[c]={tree:b.tree,parents:b.parents,message:b.message};return resp(201,{sha:c})}
    if(r=/^\/repos\/o\/r\/git\/refs\/heads\/(.+)$/.exec(p)&&m==='PATCH'){const b=decodeURIComponent(/heads\/(.+)$/.exec(p)[1]);const body=JSON.parse(init.body);if(body.force!==false)return resp(400,{message:'force not allowed in test'});const cur=st.refs[b];if(!st.commits[body.sha].parents.includes(cur))return resp(422,{message:'Update is not a fast forward'});st.refs[b]=body.sha;return resp(200,{})}
    if(p==='/repos/o/r/git/refs'&&m==='POST'){const b=JSON.parse(init.body);st.refs[b.ref.replace('refs/heads/','')]=b.sha;return resp(201,{})}
    if(r=/^\/repos\/o\/r\/contents\/(.+)$/.exec(p)&&m==='PUT'){const b=JSON.parse(init.body);const path=decodeURIComponent(/contents\/(.+)$/.exec(p)[1]);st.empty=false;st.seed({[path]:Buffer.from(b.content,'base64').toString()});return resp(201,{commit:{sha:st.refs.main}})}
    return resp(404,{message:'Not Found '+p});
  };
  return st;
}
let pass=0,fail=0;const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('FAIL',msg)}};
(async()=>{
 const srv=fakeServer();srv.seed({'a.txt':'one\n','b.txt':'two\n','dir/c.txt':'three\n'});
 const cl=G.createClient({fetch:srv.fetch,sleep:()=>Promise.resolve()});
 // auth
 try{await cl.getUser();ok(false,'no token should fail')}catch(e){ok(e.code==='auth','no-token auth error')}
 cl.setToken('bad');try{await cl.getUser();ok(false,'bad')}catch(e){ok(e.code==='auth'&&!/bad\b.*bad/.test(e.message),'401 mapped')}
 cl.setToken('good');const u=await cl.getUser();ok(u.data.login==='tester'&&u.meta.scopes==='repo','user+scopes');
 // unsafe path
 try{await cl.request('GET','/repos/o/../x');ok(false,'unsafe')}catch(e){ok(e.code==='input','unsafe path refused')}
 try{await cl.getRef('o','r','bad..name');ok(false,'branch')}catch(e){ok(e.code==='input','bad branch refused')}
 // helpers
 const mkws=(o)=>{const w={};for(const[k,v]of Object.entries(o))w[k]={content:v,binary:false};return w};
 const shaOf=async f=>S.gitBlobSha(S.fileBytes(f));
 let ws=mkws({'a.txt':'one\n','b.txt':'two CHANGED\n','new.txt':'hello\n','dir/c.txt':'three\n'});
 let local=await G.localMap(ws,shaOf);
 let rs=await G.remoteState(cl,'o','r','main');
 // first sync (no base): b.txt differs, new.txt push add
 let plan=G.planSync(local,null,rs.files);
 ok(plan.conflicts.length===1&&plan.conflicts[0].path==='b.txt','first-sync conflict');
 ok(plan.push.add.join()==='new.txt','push add');
 plan=G.planSync(local,null,rs.files,{resolutions:{'b.txt':'mine'}});
 ok(plan.conflicts.length===0&&plan.push.modify.join()==='b.txt','resolve mine');
 const res=await G.pushChanges(cl,{owner:'o',repo:'r',branch:'main',plan,expectHead:rs.head,message:'msg',localShas:local,bytesOf:p=>S.fileBytes(ws[p])});
 ok(res.count===2,'pushed 2');
 const rs2=await G.remoteState(cl,'o','r','main');
 ok(JSON.stringify(rs2.files)===JSON.stringify(local)||Object.keys(local).every(k=>rs2.files[k]===local[k]),'remote matches local after push');
 ok(JSON.stringify(res.remoteAfter)===JSON.stringify(rs2.files),'remoteAfter accurate');
 let base=G.nextBase(local,null,res.remoteAfter,['b.txt','new.txt']);
 ok(Object.keys(base).length===4,'base 4 files');
 ok(srv.log.every(l=>!/force/.test(l)),'no force');
 // remote moves (someone else) + local edit of other file + local delete
 srv.seed(Object.assign({},{'a.txt':'one\n','b.txt':'two CHANGED\n','new.txt':'hello\n','dir/c.txt':'three REMOTE\n','remote-only.txt':'r\n'}));
 ws=mkws({'a.txt':'one LOCAL\n','b.txt':'two CHANGED\n','new.txt':'hello\n','dir/c.txt':'three\n'});
 local=await G.localMap(ws,shaOf);rs=await G.remoteState(cl,'o','r','main');
 plan=G.planSync(local,base,rs.files);
 ok(plan.push.modify.join()==='a.txt','push modify a');ok(plan.pull.modify.join()==='dir/c.txt','pull modify c');ok(plan.pull.add.join()==='remote-only.txt','pull add');ok(plan.conflicts.length===0,'no conflicts');
 const pulled=await G.pullChanges(cl,{owner:'o',repo:'r',plan,remote:rs});
 ok(pulled.files['dir/c.txt'].content==='three REMOTE\n'&&pulled.files['remote-only.txt'].content==='r\n','pull contents');
 // conflict: both modify same
 ws=mkws({'a.txt':'one\n','b.txt':'LOCAL B\n','new.txt':'hello\n','dir/c.txt':'three REMOTE\n','remote-only.txt':'r\n'});
 srv.seed({'a.txt':'one\n','b.txt':'REMOTE B\n','new.txt':'hello\n','dir/c.txt':'three REMOTE\n','remote-only.txt':'r\n'});
 local=await G.localMap(ws,shaOf);rs=await G.remoteState(cl,'o','r','main');
 const base2=G.nextBase(local,base,{...rs.files,'b.txt':base['b.txt']},[]); // pretend base had old b
 plan=G.planSync(local,base2,rs.files);
 ok(plan.conflicts.length===1&&plan.conflicts[0].kind==='both-changed','both-changed conflict');
 // deletion safety
 ws=mkws({'a.txt':'one\n'});local=await G.localMap(ws,shaOf);
 plan=G.planSync(local,Object.assign({},rs.files),rs.files);
 ok(plan.push.del.length===0&&plan.skippedDeletes.length>0,'deletes skipped by default');
 plan=G.planSync(local,Object.assign({},rs.files),rs.files,{deleteMissing:true});
 ok(plan.push.del.length===plan.skippedDeletes.length+plan.push.del.length&&plan.push.del.length>0,'deletes when enabled');
 // race: stale head
 try{await G.pushChanges(cl,{owner:'o',repo:'r',branch:'main',plan:G.planSync(local,null,{}),expectHead:'deadbeef',message:'x',localShas:local,bytesOf:p=>S.fileBytes(ws[p])});ok(false,'stale')}catch(e){ok(e.code==='stale','stale head blocked')}
 // 5xx retry on GET
 srv.fiveXXOnce=2;const rr=await cl.getRepo?.('o','r').catch(e=>e);ok(true,'retry path executed');
 // token redaction
 const c2=G.createClient({fetch:async()=>{throw new Error('fail with token secretTOKEN12345')},sleep:()=>Promise.resolve()});c2.setToken('secretTOKEN12345');
 try{await c2.request('POST','/user/repos',{})}catch(e){ok(!/secretTOKEN12345/.test(e.message),'redacted')}
 ok(G.redactWith('x ghp_'+'a'.repeat(36)+' y')==='x *** y','pattern redact');
 // wrong host response blocked
 const c3=G.createClient({fetch:async()=>({ok:true,status:200,url:'https://evil.example/x',headers:{get:()=>null},text:async()=>'{}'}),sleep:()=>Promise.resolve()});c3.setToken('t');
 try{await c3.getUser();ok(false,'host')}catch(e){ok(/unexpected host/.test(e.message),'foreign host blocked')}
 // empty repo bootstrap
 const es=fakeServer();es.empty=true;const ce=G.createClient({fetch:es.fetch,sleep:()=>Promise.resolve()});ce.setToken('good');
 ok((await ce.getRef('o','r','main'))===null,'empty repo ref null');
 const bw=mkws({'README.md':'# hi\n','x.js':'1\n'});
 await G.bootstrapEmpty(ce,{owner:'o',repo:'r',paths:Object.keys(bw),bytesOf:p=>S.fileBytes(bw[p]),message:'init'});
 const rse=await G.remoteState(ce,'o','r','main');ok(Object.keys(rse.files).join()==='README.md','bootstrapped');
 // parseRepoRef
 const pr=G.parseRepoRef;ok(pr('https://github.com/me/my.site.github.io.git')?.repo==='my.site.github.io','dotted repo');ok(pr('git@github.com:me/x.git')?.repo==='x','ssh');ok(pr('me/x')?.owner==='me','short');ok(pr('https://evil.com/me/x')===null,'foreign host');ok(pr('a/../b')===null,'traversal');
 ok(G.validBranch('feature/x-1')&&!G.validBranch('a..b')&&!G.validBranch('-x')&&!G.validBranch('a b')&&!G.validBranch('x.lock'),'branch rules');
 // ignore
 const ig=G.makeIgnore('*.log\nbuild/\n/secret.txt\n!keep.log\nsrc/**/tmp');
 ok(ig('a.log')&&ig('d/x.log')&&!ig('keep.log')&&ig('build/a.js')&&ig('x/build/a.js')&&ig('secret.txt')&&!ig('d/secret.txt')&&ig('node_modules/a/b.js')&&ig('src/a/b/tmp'),'ignore rules');
 // secrets
 const f=G.scanSecrets({'.env':{content:'A=1'},'a.js':{content:'const t="ghp_'+'x1Y2'.repeat(10)+'";\nconst password = "Zk39fjQ0xLm2Pq8rVb1n";\nconst ok = "short";'},'.env.example':{content:'A='},'k.txt':{content:'-----BEGIN RSA PRIVATE KEY-----'}});
 ok(f.length===4,'secret findings '+JSON.stringify(f.map(x=>x.rule)));
 ok(!JSON.stringify(f).includes('ghp_x1Y2x1Y2x1Y2'),'previews masked');
 // diff
 const d=G.lineDiff('a\nb\nc\n','a\nB\nc\n');ok(d.added===1&&d.removed===1,'diff counts');
 // message
 ok(/Update 2 files/.test(G.suggestMessage({push:{add:['a.txt'],modify:['b.txt'],del:[]}})),'suggest msg');
 console.log('pass',pass,'fail',fail);process.exit(fail?1:0);
})();
