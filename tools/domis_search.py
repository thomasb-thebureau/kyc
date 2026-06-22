# -*- coding: utf-8 -*-
# Recherche data.gouv (base SIRENE) : sociétés ACTIVES dont le SIÈGE est dans l'un de nos 4 bâtiments.
# Produit domiciliations.json (lu ensuite par Apps Script qui exclut les clients Archie + enrichit).
#
# RECALL : les adresses SIRENE arrivent sous des formes variées —
#   "28 CRS ALBERT 1ER 75008 PARIS 8", "16 COURS ALBERT IER 75008 PARIS", "COURS ALBERT PREMIER"…
# On canonicalise donc l'adresse (CRS->COURS, IER/PREMIER->1ER, QUATRE->4) avant de filtrer,
# et on lance PLUSIEURS requêtes par voie pour ne rien rater, puis on fusionne et on filtre par
# numéro + voie + code postal. (BODACC/INPI n'énumèrent pas par adresse : SIRENE est la source.)
import urllib.request, urllib.parse, json, time, unicodedata, io, sys

UA = {'User-Agent': 'TheBureau-KYC/1.0 (contact: thomasb@thebureau.paris)', 'Accept': 'application/json'}

def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().upper()
    return ' '.join(s.replace('-', ' ').split())

def canon(s):
    """Adresse canonique : abréviations et numéraux harmonisés pour un matching robuste."""
    a = ' ' + norm(s) + ' '
    a = a.replace(' CRS ', ' COURS ').replace(' COURS ', ' COURS ')
    a = a.replace(' ALBERT IER ', ' ALBERT 1ER ').replace(' ALBERT PREMIER ', ' ALBERT 1ER ').replace(' ALBERT 1 ER ', ' ALBERT 1ER ')
    a = a.replace(' QUATRE SEPTEMBRE ', ' 4 SEPTEMBRE ').replace(' DU 4 ', ' 4 ')
    a = a.replace(' ND ', ' NOTRE DAME ').replace(' N D ', ' NOTRE DAME ')
    return ' '.join(a.split())

# Cibles : (tab, numéro, voie canonique, code postal)
TARGETS = [
    ("TB I — 28 Cours Albert 1er",    "28", "COURS ALBERT 1ER",          "75008"),
    ("TB II — 16 Cours Albert 1er",   "16", "COURS ALBERT 1ER",          "75008"),
    ("TB III — 25 Rue du 4 Septembre","25", "4 SEPTEMBRE",               "75002"),
    ("TB IV — 42 rue ND des Victoires","42", "NOTRE DAME DES VICTOIRES",  "75002"),
]
# Requêtes (q, cp) — IMPORTANT : inclure le NUMÉRO + la voie dans ses DEUX graphies ("1ER" et "IER" romain),
# car l'API plafonne à ~625 résultats récupérables par requête et classe par pertinence : seule la requête
# « numéro + voie exacte » fait remonter les sociétés de ce numéro. Les résultats sont fusionnés puis filtrés.
QUERIES = [
    ("28 cours albert 1er", "75008"), ("28 cours albert ier", "75008"), ("28 cours albert premier", "75008"),
    ("16 cours albert 1er", "75008"), ("16 cours albert ier", "75008"), ("16 cours albert premier", "75008"),
    ("cours albert ier", "75008"), ("cours albert 1er", "75008"),
    ("25 rue du 4 septembre", "75002"), ("25 rue du quatre septembre", "75002"), ("25 quatre septembre", "75002"),
    ("42 rue notre dame des victoires", "75002"), ("42 notre dame des victoires", "75002"),
]

def fetch(q, cp, page):
    url = "https://recherche-entreprises.api.gouv.fr/search?" + urllib.parse.urlencode(
        {'q': q, 'code_postal': cp, 'per_page': 25, 'page': page})
    for att in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as ex:
            sys.stderr.write("retry %s (%s): %s\n" % (att, q, ex)); time.sleep(1.5 + att)
    return {}

def match_target(r):
    """Renvoie le tab si le siège de r correspond exactement à l'un de nos bâtiments, sinon None."""
    s = r.get('siege', {}) or {}
    a = canon(s.get('adresse', ''))
    toks = a.split()
    num0 = toks[0] if toks else ''
    nvoie = norm(s.get('numero_voie', ''))
    cp = str(s.get('code_postal', '') or '')
    for tab, num, voie, tcp in TARGETS:
        if cp != tcp:
            continue
        if (num0 == num or nvoie == num) and voie in a:
            return tab
    return None

def rl_of(r):
    for d in (r.get('dirigeants') or []):
        if d.get('type_dirigeant') == 'personne morale':
            if d.get('denomination'):
                return d['denomination']
            continue
        nm = ' '.join(x for x in [d.get('prenoms'), d.get('nom')] if x).strip()
        if nm:
            return (nm + (' — ' + d['qualite'] if d.get('qualite') else '')).upper()
    return ''

def dfr(iso):
    p = str(iso or '')[:10].split('-')
    return (p[2] + '/' + p[1] + '/' + p[0]) if len(p) == 3 else ''

seen, out, per = set(), [], {}
for q, cp in QUERIES:
    j = fetch(q, cp, 1)
    pages = min(j.get('total_pages', 1) or 1, 25)
    for p in range(1, pages + 1):
        jj = j if p == 1 else fetch(q, cp, p)
        for r in (jj.get('results') or []):
            si = r.get('siren')
            if not si or si in seen or r.get('etat_administratif') != 'A':
                continue
            tab = match_target(r)
            if not tab:
                continue
            seen.add(si)
            s = r.get('siege', {}) or {}
            out.append({'siren': si, 'siret': s.get('siret', ''),
                        'nom': r.get('nom_complet') or r.get('nom_raison_sociale') or '',
                        'nature': r.get('nature_juridique') or '', 'date': dfr(r.get('date_creation')),
                        'adresse': s.get('adresse', ''), 'cp': s.get('code_postal', ''),
                        'ville': s.get('libelle_commune', ''), 'pays': 'FRANCE',
                        'rl': rl_of(r), 'tab': tab})
            per[tab] = per.get(tab, 0) + 1
        time.sleep(0.2)

for tab, _n, _v, _c in TARGETS:
    sys.stderr.write("%s -> %d actives au siège\n" % (tab, per.get(tab, 0)))
io.open("domiciliations.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
sys.stderr.write("TOTAL actives au siège: %d\n" % len(out))
