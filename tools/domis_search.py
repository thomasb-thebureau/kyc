# -*- coding: utf-8 -*-
# Recherche data.gouv : sociétés ACTIVES dont le siège est dans l'un de nos 4 bâtiments.
# Produit domiciliations.json (lu ensuite par Apps Script qui exclut les clients Archie + enrichit).
import urllib.request, urllib.parse, json, time, unicodedata, io, sys
UA={'User-Agent':'TheBureau-KYC/1.0 (contact: thomasb@thebureau.paris)','Accept':'application/json'}
def norm(s):
    s=unicodedata.normalize('NFD',str(s or '')).encode('ascii','ignore').decode().upper()
    return ' '.join(s.replace('-',' ').split())
BUILD=[  # (tab, numéro, mots de voie, code postal, requête)
 ("TB I — 28 Cours Albert 1er","28",["ALBERT 1"],"75008","28 cours albert 1er"),
 ("TB II — 16 Cours Albert 1er","16",["ALBERT 1"],"75008","16 cours albert 1er"),
 ("TB III — 25 Rue du 4 Septembre","25",["4 SEPTEMBRE","QUATRE SEPTEMBRE"],"75002","25 rue du quatre septembre"),
 ("TB IV — 42 rue ND des Victoires","42",["NOTRE DAME DES VICTOIRES"],"75002","42 rue notre dame des victoires"),
]
def fetch(q,cp,page):
    url="https://recherche-entreprises.api.gouv.fr/search?"+urllib.parse.urlencode({'q':q,'code_postal':cp,'per_page':25,'page':page})
    for att in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=30))
        except Exception as ex:
            sys.stderr.write("retry %s: %s\n"%(att,ex)); time.sleep(1.5+att)
    return {}
def at_building(r,num,streets,cp):
    s=r.get('siege',{}) or {}; adr=norm(s.get('adresse',''))
    if cp not in adr: return False
    toks=adr.split(); numok=(toks and toks[0]==num) or norm(s.get('numero_voie',''))==num
    return numok and any(st in adr for st in streets)
def rl_of(r):
    for d in (r.get('dirigeants') or []):
        if d.get('type_dirigeant')=='personne morale':
            if d.get('denomination'): return d['denomination']
            continue
        nm=' '.join(x for x in [d.get('prenoms'),d.get('nom')] if x).strip()
        if nm: return (nm+(' — '+d['qualite'] if d.get('qualite') else '')).upper()
    return ''
def dfr(iso):
    p=str(iso or '')[:10].split('-'); return (p[2]+'/'+p[1]+'/'+p[0]) if len(p)==3 else ''
out=[]
for tab,num,streets,cp,q in BUILD:
    seen=set(); j=fetch(q,cp,1); pages=min(j.get('total_pages',1),10); n=0
    for p in range(1,pages+1):
        jj=j if p==1 else fetch(q,cp,p)
        for r in jj.get('results',[]):
            si=r.get('siren')
            if si in seen or r.get('etat_administratif')!='A': continue
            if not at_building(r,num,streets,cp): continue
            seen.add(si); s=r.get('siege',{}) or {}
            out.append({'siren':si,'siret':s.get('siret',''),'nom':r.get('nom_complet') or r.get('nom_raison_sociale') or '',
                'nature':r.get('nature_juridique') or '','date':dfr(r.get('date_creation')),
                'adresse':s.get('adresse',''),'cp':s.get('code_postal',''),'ville':s.get('libelle_commune',''),
                'pays':'FRANCE','rl':rl_of(r),'tab':tab}); n+=1
        time.sleep(0.2)
    sys.stderr.write("%s -> %d actives au siège\n"%(tab,n))
io.open("domiciliations.json","w",encoding="utf-8").write(json.dumps(out,ensure_ascii=False))
sys.stderr.write("TOTAL actives au siège: %d\n"%len(out))
