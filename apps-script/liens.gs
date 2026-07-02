/**
 * liens.gs — Colonne "Lien MAJ" (1re colonne) + copie du lien dans le presse-papier.
 *
 *   majLiensSheet()  -> insere/ rafraichit la colonne A "Lien MAJ" : une icone 📋 par client,
 *                       cliquable (ouvre le questionnaire pre-rempli). Lien = https://kyc.thebureau.paris/maj?...
 *   onOpen()         -> ajoute un menu "KYC The Bureau" avec "📋 Copier le lien MAJ".
 *   copierLienMaj()  -> copie le lien du client de la LIGNE active dans le presse-papier (dialogue).
 *
 * Le lien pre-remplit : SIREN + SIRET (-> enrichissement data.gouv/INPI, avec ciblage de
 * l'etablissement CLIENT meme secondaire), raison sociale, email, tel, centre.
 * Reutilise archieSheetByName_ (fillSheet).
 */
var MAJ_BASE = 'https://kyc.thebureau.paris/maj';
var MAJ_ROMAN = { 'The Bureau 1': 'I', 'The Bureau 2': 'II', 'The Bureau 3': 'III', 'The Bureau 4': 'IV' };

function lienMaj_(siren, raison, email, tel, centre, dom, uuid, contact, owner, siret) {
  var q = [];
  siren = String(siren || '').replace(/\D/g, '');
  siret = String(siret || '').replace(/\D/g, '');
  if (siren) q.push('siren=' + encodeURIComponent(siren));
  // SIRET de l'etablissement CLIENT (souvent un etablissement secondaire, ex. FNZ 16 Cours Albert Ier).
  // Interroge par SIRET, l'app cible le bon etablissement ; par SIREN seul elle retombe sur le siege.
  if (siret) q.push('siret=' + encodeURIComponent(siret));
  if (raison) q.push('raison=' + encodeURIComponent(String(raison).trim()));
  if (email) q.push('email=' + encodeURIComponent(String(email).trim()));
  if (tel) q.push('tel=' + encodeURIComponent(String(tel).trim()));   // garde l'indicatif (+33…)
  var r = MAJ_ROMAN[String(centre).trim()]; if (r) q.push('centre=' + r);
  if (String(dom).toLowerCase().indexOf('oui') > -1) q.push('dom=1');
  if (uuid) q.push('u=' + encodeURIComponent(String(uuid).trim()));
  if (contact) q.push('contact=' + encodeURIComponent(String(contact).split(/\s[—–-]\s/)[0].trim()));   // RL enregistré -> pré-sélection dans le formulaire
  if (owner) q.push('owner=' + encodeURIComponent(String(owner).split(/\s[—–-]\s/)[0].trim()));          // contact propriétaire -> pré-remplissage
  return q.length ? (MAJ_BASE + '?' + q.join('&')) : '';
}

function ligneLien_(vals, col) {
  var siren = col['SIREN'] != null ? String(vals[col['SIREN']]) : '';
  var siret = col['SIRET'] != null ? String(vals[col['SIRET']]) : '';
  if (!String(siren).replace(/\D/g, '') && siret) siren = siret.replace(/\D/g, '').slice(0, 9);
  return lienMaj_(siren,
    col['Entreprise'] != null ? vals[col['Entreprise']] : '',
    col['Email contact'] != null ? vals[col['Email contact']] : '',
    col['Téléphone contact'] != null ? vals[col['Téléphone contact']] : '',
    col['Centre de rattachement'] != null ? vals[col['Centre de rattachement']] : '',
    col['Domiciliation (O/N)'] != null ? vals[col['Domiciliation (O/N)']] : '',
    col['Réf. Archie'] != null ? vals[col['Réf. Archie']] : '',
    col['Représentant légal'] != null ? vals[col['Représentant légal']] : '',
    col['Contact propriétaire'] != null ? vals[col['Contact propriétaire']] : '',
    siret);   // SIRET client ajouté au lien -> ciblage de l'établissement (secondaire possible)
}

// Pose/rafraichit les liens 📋 sur UNE feuille (insere la colonne A "Lien MAJ" si absente). Renvoie le nb de liens.
// Appelee PAR FEUILLE depuis la synchro (juste apres l'ecriture de chaque onglet) -> les liens sont toujours
// restaures meme si la synchro s'arrete avant la fin (plus besoin de relancer le script a la main).
function poserLiensFeuille_(sh) {
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (x) { return String(x).trim(); });
  if (head[0] === 'Lien MAJ') {                       // ancienne en-tête -> on renomme en "KYC"
    sh.getRange(1, 1).setValue('KYC').setFontWeight('bold').setBackground('#1d3b2a').setFontColor('#ffffff');
  } else if (head[0] !== 'KYC') {                      // 1re colonne absente -> on insère
    sh.insertColumnBefore(1);
    sh.getRange(1, 1).setValue('KYC').setFontWeight('bold').setBackground('#1d3b2a').setFontColor('#ffffff');
    sh.setColumnWidth(1, 70);
  }
  var v = sh.getDataRange().getValues(); if (v.length < 2) return 0;
  head = v[0].map(function (x) { return String(x).trim(); });
  var col = {}; for (var i = 0; i < head.length; i++) col[head[i]] = i;
  var out = [], n = 0;
  for (var r = 1; r < v.length; r++) {
    var link = ligneLien_(v[r], col);
    out.push([SpreadsheetApp.newRichTextValue().setText(link ? '📋' : '').setLinkUrl(link || null).build()]);
    if (link) n++;
  }
  sh.getRange(2, 1, out.length, 1).setRichTextValues(out);   // lien RichText (independant de la locale)
  // ✉ (demande de MAJ) : la synchro réécrit le bloc data (colonne AB) et aplatit la case en booléen « false » (texte)
  // -> on repose les cases à cocher à chaque passage (point unique appelé après chaque écriture de feuille).
  try {
    var mjC = head.indexOf('✉');
    if (mjC >= 0) {
      sh.getRange(1, mjC + 1).setHorizontalAlignment('center').setVerticalAlignment('middle');   // ✉ centrée dans l'en-tête (h + v)
      if (out.length) {
        sh.getRange(2, mjC + 1, out.length, 1).insertCheckboxes().setHorizontalAlignment('center');
        var eiC = col['Entreprise'];                                                              // retire les cases sur les lignes SANS entreprise (pas de case parasite)
        for (var rr = 1; rr < v.length; rr++) { if (eiC == null || !String(v[rr][eiC] || '').trim()) { var cMj = sh.getRange(rr + 1, mjC + 1); try { cMj.removeCheckboxes(); } catch (e) {} cMj.clearContent(); } }
      }
    }
  } catch (eMj) {}
  sh.setFrozenColumns(4);   // fige A→D (jusqu'à Entreprise)
  return n;
}

// Insere (si besoin) la colonne A "Lien MAJ" et y met une icone 📋 cliquable par client (toutes feuilles).
function majLiensSheet() {
  var ss = archieSheetByName_(), sheets = ss.getSheets(), n = 0;
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s]; if (!/^TB /.test(sh.getName())) continue;
    try { n += poserLiensFeuille_(sh); } catch (e) { }
  }
  Logger.log('Liens MAJ poses : ' + n); return 'Liens MAJ posés : ' + n;
}

// Renvoie les URLs de référence (tableau clients, domiciliations, Drive KYC, formulaire) pour la notice.
function liensRef() {
  var p = PropertiesService.getScriptProperties();
  var cl = p.getProperty('ARCHIE_SHEET_ID'), dm = p.getProperty('DOMIS_SHEET_ID'), fo = p.getProperty('PARENT_FOLDER_ID') || p.getProperty('PIECES_FOLDER_ID');
  return JSON.stringify({
    clients: cl ? 'https://docs.google.com/spreadsheets/d/' + cl + '/edit' : '',
    domiciliations: dm ? 'https://docs.google.com/spreadsheets/d/' + dm + '/edit' : '',
    drive: fo ? 'https://drive.google.com/drive/folders/' + fo : '',
    formulaire: 'https://kyc.thebureau.paris'
  });
}

/* Installe un déclencheur onOpen SUR le tableau clients (script autonome -> le simple onOpen ne se déclenche
   pas ; un déclencheur installable, lui, crée le menu à chaque ouverture). À lancer une fois. */
function installerMenu() {
  var id = PropertiesService.getScriptProperties().getProperty('ARCHIE_SHEET_ID');
  if (!id) return 'ARCHIE_SHEET_ID absent des propriétés.';
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onOpen') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onOpen').forSpreadsheet(SpreadsheetApp.openById(id)).onOpen().create();
  return 'Déclencheur onOpen installé — le menu « KYC The Bureau » apparaîtra à l\'ouverture du tableau (recharge-le).';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('KYC The Bureau')
    .addItem('📋 Copier le lien MAJ (ligne sélectionnée)', 'copierLienMaj')
    .addSeparator()
    .addItem('🗂️ Visualiseur documents', 'ouvrirVisualiseur')
    .addToUi();
}

// Copie le lien du client de la ligne active dans le presse-papier (via un petit dialogue).
function copierLienMaj() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSheet();
  var row = sh.getActiveCell().getRow();
  if (row < 2) { ui.alert('Sélectionne d\'abord la ligne d\'un client.'); return; }
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var col = {}; for (var i = 0; i < head.length; i++) col[head[i]] = i;
  var vals = sh.getRange(row, 1, 1, lastCol).getValues()[0];
  var link = ligneLien_(vals, col);
  if (!link) { ui.alert('Pas de lien pour cette ligne (SIREN manquant).'); return; }
  var ent = col['Entreprise'] != null ? vals[col['Entreprise']] : '';
  var safe = link.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  var html = '<div style="font:13px Arial;padding:8px">'
    + '<div id="m">Copie en cours…</div>'
    + '<p style="color:#1E4035"><b>' + String(ent).replace(/</g, '&lt;') + '</b></p>'
    + '<textarea id="t" style="width:100%;height:64px">' + link.replace(/</g, '&lt;') + '</textarea>'
    + '<script>var L="' + safe + '";function done(ok){document.getElementById("m").innerHTML=ok?"✅ Lien copié dans le presse-papier !":"⚠ Copie auto bloquée — sélectionne le texte ci-dessous et Ctrl+C.";}'
    + 'try{navigator.clipboard.writeText(L).then(function(){done(true);},function(){done(false);document.getElementById("t").select();});}catch(e){done(false);document.getElementById("t").select();}<\/script>'
    + '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(180), 'Lien MAJ — ' + String(ent).slice(0, 40));
}
