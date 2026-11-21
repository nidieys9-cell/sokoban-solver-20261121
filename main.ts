import{mkdirSync,readdirSync,readFileSync,writeFileSync}from'node:fs'
const I=process.env.MAKEFUN_INPUT_DIR??'/input',O=process.env.MAKEFUN_OUTPUT_DIR??'/output',C='udlr'
const S=L=>{
let R=L.split('\n'),W=Math.max(...R.map(s=>s.length))+2,N=W*(R.length+2),w=new Uint8Array(N).fill(1),B=[],G=[],p,D=[-W,W,-1,1]
R.forEach((s,y)=>{for(let x=0;x<s.length;x++){let c=s[x],i=(y+1)*W+x+1;if(c=='#')continue;w[i]=0;if(c=='.'||c=='*')G.push(i);if(c=='$'||c=='*')B.push(i);if(c=='@'||c=='+')p=i}})
let h=p/W|0
let F=(f,o,g)=>{let P=new Map([[f,-1]]),q=[f];for(let i=0;i<q.length;i++){let c=q[i];for(let k=0;k<4;k++){let n=c+D[k];if(!w[n]&&!o.has(n)&&!P.has(n)&&(!g||g[n])){P.set(n,c*4+k);q.push(n)}}}return P}
let T=(P,f,t)=>{let s='',c=t;while(c!=f){let v=P.get(c);s=C[v%4]+s;c=v/4|0}return s}
let H=new Uint8Array(N);for(let i=0;i<N;i++)H[i]=!w[i]&&(i/W|0)!=h
let Q=[]
for(let b of B){if(Q.some(r=>r.includes(b)))continue;Q.push([...F(b,new Set,H).keys()])}
let u=p,o=''
for(let ci=0;ci<Q.length;ci++){let e=Q[ci],l=ci==Q.length-1,a=new Uint8Array(N);for(let c of e)a[c]=1
let b=B.filter(x=>a[x]).sort((x,y)=>x-y),g=G.filter(x=>a[x])
let A=e.filter(c=>{let y=c/W|0;return(y==h-1||y==h+1)&&!w[c%W+h*W]}).sort((x,y)=>x-y);for(let c of A)a[c%W+h*W]=2
let J=f=>{for(let c of f){if(g.includes(c))continue;if((w[c-W]||w[c+W])&&(w[c-1]||w[c+1]))return 1/0}let m=1/0;let r=(i,s,n)=>{if(s>=m)return;if(i==f.length){m=s;return}let X=f[i]%W,Y2=f[i]/W|0;for(let j=0;j<g.length;j++){if(n>>j&1)continue;let y=Math.abs(X-g[j]%W)+Math.abs(Y2-(g[j]/W|0));r(i+1,s+y,n|1<<j)}};r(0,0,0);return m}
let E=(p,f)=>p+'|'+f.join(','),t=new Set,V=[],f=0,n=0,Q2=(f2,q)=>{(V[f2]=V[f2]||[]).push(q);n++}
let h0=J(b),e0=A[0]%W+h*W
if(isFinite(h0))Q2(h0,{p:e0,b:b.slice(),g:0,s:''})
let S2=null
while(n>0){while(!V[f]||!V[f].length)f++;n--;let q=V[f].pop(),k=E(q.p,q.b)
if(t.has(k))continue;t.add(k)
if(q.b.every(c=>g.includes(c))){if(l){S2=q;break}let P=F(q.p,new Set(q.b),a);if(A.some(c=>P.has(c))){S2=q;break}}
let o2=new Set(q.b),P=F(q.p,o2,a)
for(let b2 of q.b)for(let k2=0;k2<4;k2++){let de=b2+D[k2],be=b2-D[k2];if(a[de]==1&&!o2.has(de)&&P.has(be)){let nb=q.b.slice();nb[nb.indexOf(b2)]=de;nb.sort((x,y)=>x-y);let hh=J(nb);if(!isFinite(hh))continue;Q2(q.g+1+hh,{p:b2,b:nb,g:q.g+1,s:q.s+T(P,q.p,be)+C[k2]})}}}
if(!S2)return''
o+=T(F(u,new Set,null),u,e0)+S2.s
if(!l){if((S2.p/W|0)==h)u=S2.p;else{let P=F(S2.p,new Set(S2.b),a),d2=-1;for(let c of A)if(P.has(c)){d2=c;break}if(d2<0)return'';o+=T(P,S2.p,d2)+((d2/W|0)<h?'d':'u');u=d2%W+h*W}}
}
return o}
for(let d of readdirSync(I).sort()){mkdirSync(O+'/'+d,{recursive:true});writeFileSync(O+'/'+d+'/solution.txt',S(readFileSync(I+'/'+d+'/level.txt','utf8'))+'\n')}
