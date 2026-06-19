# The Bureau — Dossier d'entrée (KYC / LCB-FT)

Outil interactif permettant aux Membres de constituer leur dossier d'entrée
(conformité LCB-FT) : informations, déclarations, fiche Annexe 3 (en cas de
domiciliation) et téléversement des pièces justificatives.

- **`index.html`** — l'outil (page statique autonome, FR/EN, mode jour/nuit, WCAG).
- **`backend-apps-script.gs`** — backend Google Apps Script (dépôt Drive + notification email aux centres).
- `logo.svg`, `logo-white.svg`, `chevrons-gold.svg`, `favicon.svg` — charte The Bureau.

## Mise en ligne

Page statique → **GitHub Pages**. Activer Pages sur la branche `main` (dossier racine).
URL : `https://thomasb-thebureau.github.io/kyc/`.

Sans backend configuré, l'outil fonctionne en **mode démo** (aucun envoi réel).

## Activer le backend (Drive + email)

1. [script.google.com](https://script.google.com) → nouveau projet → coller `backend-apps-script.gs`.
2. Renseigner `PARENT_FOLDER_ID` (dossier Drive racine) ; le routage email par centre est dans `CENTRE_ROUTING`.
3. Déployer en **Application Web** (*exécuter en tant que : moi* · *accès : tout le monde*).
4. Coller l'URL `…/exec` dans `CONFIG.ENDPOINT` (haut de `index.html`).

## Autocomplétion d'adresses (optionnel)

Créer une clé **Google Places API** (restreinte au domaine) et la coller dans
`CONFIG.GOOGLE_PLACES_KEY`. Vide = saisie manuelle.

## Drapeaux

Images `flagcdn.com` (les emojis drapeaux ne s'affichent pas sous Windows).
