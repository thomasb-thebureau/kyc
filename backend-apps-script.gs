/* ============================================================
   THE BUREAU — Dossier d'entrée · Backend Google Apps Script
   ------------------------------------------------------------
   PHASE 1 : reçoit le dossier envoyé par dossier-entree.html,
   crée un sous-dossier au nom du client dans votre Drive,
   y dépose les pièces, et notifie le centre par email.
   Le client n'a PAS besoin de compte Google.

   DÉPLOIEMENT (une seule fois) :
   1. script.google.com → Nouveau projet → coller ce code.
   2. Renseigner PARENT_FOLDER_ID + CENTRE_EMAIL ci-dessous.
   3. Déployer → Nouveau déploiement → type « Application Web ».
        - Exécuter en tant que : moi
        - Qui a accès : « Tout le monde »
   4. Copier l'URL /exec et la coller dans CONFIG.ENDPOINT
      (dans dossier-entree.html).
============================================================ */

const PARENT_FOLDER_ID = 'XXXXXXXXXXXXXXXXXXXXXXXXX'; // dossier Drive racine "Dossiers d'entrée"
const CENTRE_EMAIL     = 'thomasb@thebureau.paris';      // adresse de repli si centre inconnu

// Routage par centre : destinataire = conciergerie du centre, copie = équipe de l'adresse.
//  - 16 & 28 Cours Albert 1er (TB I & II) : Oscar, Pierre-Henri, Thomas
//  - 25 4 Septembre & 42 Victoires (TB III & IV) : Dynah, Charles, Thomas
const CC_ALBERT    = ['oscar@thebureau.paris', 'pierrehenri@thebureau.paris', 'thomasb@thebureau.paris'];
const CC_VICTOIRES = ['dynah@thebureau.paris', 'charles@thebureau.paris', 'thomasb@thebureau.paris'];
const CENTRE_ROUTING = {
  'I':   { to: '28Albert@thebureau.paris',    cc: CC_ALBERT },
  'II':  { to: '16albert@thebureau.paris',    cc: CC_ALBERT },
  'III': { to: '4septembre@thebureau.paris',  cc: CC_VICTOIRES },
  'IV':  { to: '42victoires@thebureau.paris', cc: CC_VICTOIRES }
};

function doPost(e) {
  try {
    const body  = JSON.parse(e.postData.contents);
    const m     = body.meta || {};
    const files = body.files || [];

    // Sous-dossier : "2026-06-19 — Acme Studio (Marie Dupont)"
    const stamp = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH-mm');
    const rl    = (m.rl || {});
    const name  = stamp + ' — ' + (m.raison || 'Sans nom') + ' (' + [rl.prenom, rl.nom].filter(String).join(' ') + ')';
    const folder = DriveApp.getFolderById(PARENT_FOLDER_ID).createFolder(name);

    // Pièces jointes
    files.forEach(function (f) {
      const blob = Utilities.newBlob(Utilities.base64Decode(f.dataB64), f.mimeType, f.name);
      folder.createFile(blob);
    });

    // Récapitulatif complet (texte) déposé dans le dossier
    var denom = (m.raison || 'Dossier').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'DOSSIER';
    var recapBlob = Utilities.newBlob(summary(m), 'text/plain', denom + '_Recapitulatif.txt');
    folder.createFile(recapBlob);

    // Fiche LCB-FT exportée en PDF (uniquement en cas de domiciliation) → Drive (+ Archie en phase 2)
    var attachments = [recapBlob];
    if (m.fiche_lcb) {
      var pdf = Utilities.newBlob(ficheHtml(m), 'text/html', 'fiche.html')
                  .getAs('application/pdf').setName(denom + '_FicheLCB-FT.pdf');
      folder.createFile(pdf);
      attachments.push(pdf);
    }

    // Notification au centre de rattachement choisi : récap complet + fiche PDF en pièces jointes
    var ratt = m.rattachement || {};
    var route = (ratt.id && CENTRE_ROUTING[ratt.id]) || { to: CENTRE_EMAIL, cc: [] };
    MailApp.sendEmail({
      to: route.to,
      cc: (route.cc || []).join(','),
      subject: 'Nouveau dossier d’entrée' + (ratt.nom ? ' [' + ratt.nom + ']' : '') + ' — ' + (m.raison || ''),
      replyTo: rl.email || CENTRE_EMAIL,
      htmlBody: '<p>Un nouveau dossier a été transmis.</p>'
              + '<p><b>' + esc(m.raison || '') + '</b><br>'
              + esc([rl.prenom, rl.nom].join(' ')) + ' — ' + esc(rl.email || '') + '</p>'
              + '<p>Domiciliation : ' + (m.domiciliation ? 'oui' : 'non')
              + ' · Pièces fournies : ' + files.length + '</p>'
              + '<p>Récapitulatif complet et fiche LCB-FT en pièces jointes.</p>'
              + '<p><a href="' + folder.getUrl() + '">Ouvrir le dossier Drive</a></p>',
      attachments: attachments
    });

    return json({ ok: true, folder: folder.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function summary(m) {
  const rl = m.rl || {};
  const lines = [
    'DOSSIER D’ENTRÉE — THE BUREAU',
    'Date : ' + new Date(),
    'Centre de rattachement : ' + ((m.rattachement && m.rattachement.nom) || '—') + ((m.rattachement && m.rattachement.adr) ? ' (' + m.rattachement.adr + ')' : ''),
    '',
    'Domiciliation : ' + (m.domiciliation ? 'oui' : 'non'),
    'Type de structure : ' + (m.entity || ''),
    'Siège à l’étranger : ' + (m.etranger ? 'oui' : 'non'),
    'Dénomination : ' + (m.raison || ''),
    'Forme juridique : ' + (m.forme || ''),
    'SIREN/SIRET/TVA : ' + [m.siren, m.siret, m.tva].filter(String).join(' / '),
    '',
    'Représentant légal : ' + [rl.prenom, rl.nom].join(' '),
    'Email : ' + (rl.email || '') + '  ·  Tél : ' + (rl.tel || ''),
    '',
    'PPE : ' + (m.ppe || ''),
    'Sanctions/gel des avoirs (attestation) : ' + (m.sanction ? 'oui' : 'non'),
    'Bénéficiaires effectifs : ' + (m.beneficiaires || []).map(function (b) {
      return b.prenom + ' ' + b.nom + ' (' + (b.pct || '?') + '%, ' + (b.domicile || '') + ')';
    }).join('; '),
    ''
  ];

  // Fiche LCB-FT (Annexe 3) — uniquement en cas de domiciliation
  if (m.fiche_lcb) {
    lines.push('FICHE LCB-FT (ANNEXE 3)', '');
    Object.keys(m.fiche_lcb.identite || {}).forEach(function (k) {
      var f = m.fiche_lcb.identite[k];
      lines.push(' - ' + f.label + ' : ' + (f.valeur || ''));
    });
    lines.push('');
    (m.fiche_lcb.questionnaire || []).forEach(function (q) {
      var ligne = ' ' + q.n + '/ ' + q.question + '  →  ';
      if (q.valeur && typeof q.valeur === 'object') {
        ligne += 'N-1: ' + q.valeur.n1 + ' / N-2: ' + q.valeur.n2 + ' / N-3: ' + q.valeur.n3;
      } else if (q.valeur !== undefined) {
        ligne += q.valeur;
      } else {
        ligne += (q.reponse || '');
        (q.details || []).forEach(function (d) {
          ligne += '\n      · ' + d.label + ' : ' + (d.valeur !== undefined ? d.valeur : d.reponse || '');
        });
      }
      lines.push(ligne);
    });
    lines.push('');
  }

  lines.push('PIÈCES :');
  (m.pieces || []).forEach(function (p) {
    lines.push(' [' + (p.fourni ? 'x' : ' ') + '] ' + p.label + (p.fichier ? ' — ' + p.fichier : ''));
  });
  return lines.join('\n');
}

/* Fiche LCB-FT (Annexe 3) au format HTML — converti en PDF par doPost */
function ficheHtml(m) {
  var rl = m.rl || {}, f = m.fiche_lcb || {};
  var h = '<html><head><meta charset="utf-8"><style>'
        + 'body{font-family:Arial,Helvetica,sans-serif;color:#0F0F0F;font-size:11px;line-height:1.5;padding:8px 14px}'
        + 'h1{font-size:16px;color:#1E4035;margin:0 0 2px}.sub{color:#7A6015;font-size:9px;letter-spacing:.12em;text-transform:uppercase;font-weight:bold}'
        + 'h2{font-size:12px;color:#1E4035;border-bottom:1px solid #ccc;padding-bottom:3px;margin:18px 0 8px}'
        + 'table{width:100%;border-collapse:collapse}td{padding:4px 6px;vertical-align:top;border-bottom:1px solid #eee}'
        + 'td.k{color:#666;width:42%}td.v{font-weight:bold}.q{color:#666}.a{font-weight:bold}.law{color:#888;font-size:9px;margin-top:4px}'
        + '</style></head><body>';
  h += '<div class="sub">The Bureau — Conformité LCB-FT (Annexe 3)</div><h1>Fiche Client — Lutte anti-blanchiment</h1>';
  h += '<div class="law">Articles L.561-2 et s. du Code monétaire et financier · directive (UE) 2015/849</div>';
  h += '<h2>Identité de la structure</h2><table>';
  var ratt = m.rattachement || {};
  h += row('Centre de rattachement', (ratt.nom || '') + (ratt.adr ? ' — ' + ratt.adr : ''));
  h += row('Dénomination sociale', m.raison) + row('Forme juridique', m.forme) + row('SIREN / SIRET / TVA', [m.siren, m.siret, m.tva].filter(String).join(' / '));
  h += row('Représentant légal', [rl.prenom, rl.nom].join(' ')) + row('Email / Tél', (rl.email || '') + '  ' + (rl.tel || ''));
  var id = f.identite || {};
  Object.keys(id).forEach(function (k) { h += row(id[k].label, id[k].valeur); });
  h += '</table><h2>Questionnaire</h2><table>';
  (f.questionnaire || []).forEach(function (q) {
    var val = (q.valeur !== undefined)
      ? (typeof q.valeur === 'object' ? 'N-1 ' + q.valeur.n1 + ' · N-2 ' + q.valeur.n2 + ' · N-3 ' + q.valeur.n3 : q.valeur)
      : (q.reponse || '');
    var det = (q.details || []).map(function (d) { return d.label + ' : ' + (d.valeur !== undefined ? d.valeur : d.reponse || ''); }).filter(function(x){return x.indexOf(': ')<x.length-2;}).join(' — ');
    h += '<tr><td class="q">' + q.n + '/ ' + esc(q.question) + '</td><td class="a">' + esc(String(val)) + (det ? '<br><span class="q">' + esc(det) + '</span>' : '') + '</td></tr>';
  });
  h += '</table><h2>Déclarations</h2><table>'
     + row('Statut PPE', m.ppe) + row('Sanctions / gel des avoirs', m.sanction ? 'Attesté' : 'Non attesté')
     + row('Bénéficiaires effectifs', (m.beneficiaires || []).map(function (b) { return b.prenom + ' ' + b.nom + ' (' + (b.pct || '?') + '%)'; }).join('; '))
     + '</table>';
  h += '<h2>Pièces</h2><table>';
  (m.pieces || []).forEach(function (p) { h += '<tr><td class="k">' + esc(p.label) + '</td><td class="v">' + (p.fourni ? '✔ ' + esc(p.fichier || '') : '— manquant') + '</td></tr>'; });
  h += '</table></body></html>';
  return h;
}
function row(k, v) { return '<tr><td class="k">' + esc(k) + '</td><td class="v">' + esc(v || '—') + '</td></tr>'; }

function esc(s) { return String(s == null ? '' : s).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
