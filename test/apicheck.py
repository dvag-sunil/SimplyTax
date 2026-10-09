#!/usr/bin/env python3
"""Cross-check: every frontend API call vs the server's routes (method, path, fields read). Usage: python3 apicheck.py index.html server.js certificate-store.js"""
import re,sys
fe=open(sys.argv[1],encoding='utf-8').read(); srv=''.join(open(p,encoding='utf-8').read()+'\n' for p in sys.argv[2:])
def balanced(s,i):                      # s[i] is an opening bracket
    pairs={'(':')','{':'}','[':']'}; stack=[]; q=None; k=i
    while k<len(s):
        ch=s[k]
        if q:
            if ch=='\\': k+=1
            elif ch==q: q=None
        elif ch in '\'"`': q=ch
        elif ch in pairs: stack.append(pairs[ch])
        elif stack and ch==stack[-1]:
            stack.pop()
            if not stack: return s[i:k+1]
        k+=1
    return ''
def split_top(s):                       # split "a, b, {c:1}" at top level
    out=[];cur='';d=0;q=None;k=0
    while k<len(s):
        ch=s[k]
        if q:
            cur+=ch
            if ch=='\\': k+=1; cur+=s[k]
            elif ch==q: q=None
        elif ch in '\'"`': q=ch; cur+=ch
        elif ch in '([{': d+=1; cur+=ch
        elif ch in ')]}': d-=1; cur+=ch
        elif ch==',' and d==0: out.append(cur); cur=''
        else: cur+=ch
        k+=1
    out.append(cur); return [x.strip() for x in out]
def obj_keys(o):
    keys=[]
    for p in split_top(o[1:-1]):
        if not p or p.startswith('...'): continue
        m=re.match(r"['\"]?(\w+)['\"]?\s*(?::|$)",p)
        if m: keys.append(m.group(1))
    return keys
# ---- server routes (any indentation, any file) ----
routes=[]
for m in re.finditer(r"^\s*app\.(get|post|put|delete)\(\s*'([^']+)'",srv,flags=re.M):
    nxt=re.search(r"^\s*app\.(get|post|put|delete|use)\(",srv[m.end():],flags=re.M)
    body=srv[m.start():m.end()+(nxt.start() if nxt else len(srv)-m.end())]
    reads=set()
    for d in re.finditer(r"const\s*\{([^}]*)\}\s*=\s*(?:req\.body|\(req\.body|clean)\b",body): reads|={k.strip().split(':')[0].split('=')[0].strip() for k in d.group(1).split(',') if k.strip() and not k.strip().startswith('...')}
    reads|=set(re.findall(r"req\.body(?:\?)?\.(\w+)",body)); reads|=set(re.findall(r"\(req\.body\s*\|\|\s*\{\}\)\.(\w+)",body))
    routes.append({'m':m.group(1).upper(),'p':m.group(2),'reads':reads,'re':re.compile('^'+re.sub(r':\w+','[^/]+',m.group(2))+'$')})
# ---- frontend calls ----
calls=[]
for m in re.finditer(r"\bapi\(",fe):
    args=split_top(balanced(fe,m.end()-1)[1:-1])
    if not args or not re.match(r"[`'\"]/api/",args[0]): continue
    a0=args[0]; lit=re.match(r"[`'\"](/api/[^`'\"$]*)",a0).group(1)
    path=re.sub(r"\$\{[^}]*\}",':id',lit)
    if '+' in a0 or '${' in a0: path=path.rstrip('/')+('/:id' if not path.endswith(':id') else '')
    meth=(args[1].strip("'\"") if len(args)>1 and re.match(r"['\"]\w+['\"]$",args[1]) else 'GET').upper()
    keys=obj_keys(args[2]) if len(args)>2 and args[2].startswith('{') else []
    calls.append({'m':meth,'p':path,'keys':keys,'line':fe.count('\n',0,m.start())+1})
for m in re.finditer(r"fetch\(\s*BACKEND\.baseUrl\s*\+\s*[`'\"](/api/[^`'\"]*)[`'\"]",fe):
    seg=fe[m.start():m.start()+900]; meth=(re.search(r"method:\s*'(\w+)'",seg) or [0,'GET'])[1].upper()
    bm=re.search(r"JSON\.stringify\(\s*\{",seg); keys=obj_keys(balanced(seg,bm.end()-1)) if bm else []
    calls.append({'m':meth,'p':m.group(1),'keys':keys,'line':fe.count('\n',0,m.start())+1})
print(f"frontend call sites: {len(calls)} | server routes: {len(routes)}")
called=set(); probs=0
print("\nA. frontend call -> server route with the SAME method:")
for c in sorted(calls,key=lambda c:c['line']):
    hit=[r for r in routes if r['re'].match(c['p'])]; ok=[r for r in hit if r['m']==c['m']]
    if ok: called.add((ok[0]['m'],ok[0]['p'])); continue
    probs+=1; print(f"   MISMATCH line {c['line']}: {c['m']} {c['p']} ->",('server has only '+','.join(r['m'] for r in hit)) if hit else 'NO such route')
print("   all %d calls match a route"%len(calls) if not probs else f"   {probs} problem(s)")
FAILED = probs
print("\nB. fields the frontend sends that the server does not read:")
n=0
for c in sorted(calls,key=lambda c:c['line']):
    r=next((r for r in routes if r['re'].match(c['p']) and r['m']==c['m']),None)
    if r and c['keys']:
        extra=[k for k in c['keys'] if k not in r['reads']]
        if extra: n+=1; print(f"   line {c['line']}: {c['m']} {c['p']} sends {extra}")
print("   (none)" if not n else "")
print("C. fields the server REQUIRES/reads that no frontend call sends (possible missing parameter):")
n=0
for r in routes:
    for c in [c for c in calls if r['re'].match(c['p']) and c['m']==r['m'] and c['keys']]:
        miss=sorted(r['reads']-set(c['keys']))
        if miss: n+=1; print(f"   {r['m']} {r['p']} (frontend line {c['line']}): server also reads {miss} - confirm they are optional")
print("   (none)" if not n else "")
print("D. server routes the frontend never calls:")
for r in routes:
    if (r['m'],r['p']) not in called: print(f"   {r['m']:6} {r['p']}")
# Only section A (a call to a route/method that does not exist) fails the build; B-D are information for a human.
sys.exit(1 if FAILED else 0)
