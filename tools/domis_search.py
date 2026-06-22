# -*- coding: utf-8 -*-
# Recherche EXHAUSTIVE des sociétés dont le SIÈGE actif est dans l'un de nos 4 bâtiments.
# Source d'énumération : API Sirene de l'INSEE (autoritaire, filtre structuré par adresse, pagination
# par curseur — aucun plafond de pertinence). Le représentant légal (absent de Sirene) est complété
# via data.gouv. Produit domiciliations.json, lu ensuite par Apps Script (exclusion clients + enrichissement).
#
# SÉCURITÉ : la clé INSEE est lue dans la variable d'environnement INSEE_API_KEY (secret GitHub Actions),
# JAMAIS écrite dans ce fichier (repo public).
import urllib.request, urllib.parse, json, time, os, sys, io

INSEE_KEY = os.environ.get('INSEE_API_KEY', '')
INSEE = "https://api.insee.fr/api-sirene/3.11/siret"
DG = "https://recherche-entreprises.api.gouv.fr/search"
UA = {'User-Agent': 'TheBureau-KYC/1.0 (contact: thomasb@thebureau.paris)', 'Accept': 'application/json'}

# (tab, code postal, numéro de voie, [libellés de voie à interroger])
# Albert : « IER » (romain) ET « 1ER » (chiffre) sont des libellés distincts dans Sirene -> on interroge les deux.
BUILDINGS = [
    ("TB I — 28 Cours Albert 1er",      "75008", "28", ['ALBERT IER', 'ALBERT 1ER']),
    ("TB II — 16 Cours Albert 1er",     "75008", "16", ['ALBERT IER', 'ALBERT 1ER']),
    ("TB III — 25 Rue du 4 Septembre",  "75002", "25", ['4 SEPTEMBRE']),
    ("TB IV — 42 rue ND des Victoires", "75002", "42", ['NOTRE DAME DES VICTOIRES']),
]
SIEGE_ACTIF = 'etablissementSiege:true AND periode(etatAdministratifEtablissement:A)'

def insee(query, curseur='*'):
    url = INSEE + "?" + urllib.parse.urlencode({'q': query, 'nombre': 1000, 'curseur': curseur})
    req = urllib.request.Request(url, headers={'X-INSEE-Api-Key-Integration': INSEE_KEY, 'Accept': 'application/json'})
    for att in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {'etablissements': [], 'header': {}}   # 0 résultat
            sys.stderr.write("insee retry %s (HTTP %s)\n" % (att, e.code)); time.sleep(2 + att)
        except Exception as e:
            sys.stderr.write("insee retry %s (%s)\n" % (att, e)); time.sleep(2 + att)
    return {'etablissements': [], 'header': {}}

def fr_date(iso):
    p = str(iso or '')[:10].split('-')
    return (p[2] + '/' + p[1] + '/' + p[0]) if len(p) == 3 else ''

def nom_of(ul):
    d = ul.get('denominationUniteLegale')
    if d:
        return d
    nom = ' '.join(x for x in [ul.get('prenomUsuelUniteLegale') or ul.get('prenom1UniteLegale'), ul.get('nomUniteLegale')] if x)
    return nom.strip()

def adresse_of(a):
    parts = [a.get('numeroVoieEtablissement'), a.get('typeVoieEtablissement'), a.get('libelleVoieEtablissement')]
    return ' '.join(x for x in parts if x).strip()

def rl_of_siren(siren):
    """Représentant légal via data.gouv (absent de Sirene). Best-effort : si indisponible -> ''."""
    try:
        url = DG + "?" + urllib.parse.urlencode({'q': siren, 'per_page': 1})
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            j = json.load(r)
        res = [x for x in (j.get('results') or []) if x.get('siren') == siren] or (j.get('results') or [])
        r0 = res[0] if res else None
        if not r0:
            return ''
        for d in (r0.get('dirigeants') or []):
            if d.get('type_dirigeant') == 'personne morale':
                if d.get('denomination'):
                    return d['denomination']
                continue
            nm = ' '.join(x for x in [d.get('prenoms'), d.get('nom')] if x).strip()
            if nm:
                return (nm + (' — ' + d['qualite'] if d.get('qualite') else '')).upper()
    except Exception:
        pass
    return ''

if not INSEE_KEY:
    sys.stderr.write("ERREUR : INSEE_API_KEY manquante (secret GitHub Actions).\n"); sys.exit(1)

seen, out, per = set(), [], {}
for tab, cp, num, libelles in BUILDINGS:
    for lbl in libelles:
        q = 'codePostalEtablissement:%s AND numeroVoieEtablissement:%s AND libelleVoieEtablissement:"%s" AND %s' % (cp, num, lbl, SIEGE_ACTIF)
        cur = '*'
        while True:
            j = insee(q, cur)
            ets = j.get('etablissements') or []
            for e in ets:
                si = e.get('siren')
                if not si or si in seen:
                    continue
                seen.add(si)
                ul = e.get('uniteLegale', {}) or {}
                a = e.get('adresseEtablissement', {}) or {}
                out.append({'siren': si, 'siret': e.get('siret', ''), 'nom': nom_of(ul),
                            'nature': ul.get('categorieJuridiqueUniteLegale') or '',
                            'date': fr_date(ul.get('dateCreationUniteLegale')),
                            'adresse': adresse_of(a), 'cp': a.get('codePostalEtablissement', ''),
                            'ville': a.get('libelleCommuneEtablissement', ''),
                            'pays': 'FRANCE', 'rl': '', 'tab': tab})
                per[tab] = per.get(tab, 0) + 1
            nxt = (j.get('header') or {}).get('curseurSuivant')
            if not ets or not nxt or nxt == cur:
                break
            cur = nxt; time.sleep(0.3)

# Représentant légal via data.gouv (best-effort, n'empêche pas la production de la liste)
for c in out:
    c['rl'] = rl_of_siren(c['siren']); time.sleep(0.15)

for tab, cp, num, l in BUILDINGS:
    sys.stderr.write("%s -> %d sièges actifs\n" % (tab, per.get(tab, 0)))
io.open("domiciliations.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
sys.stderr.write("TOTAL sièges actifs : %d\n" % len(out))
