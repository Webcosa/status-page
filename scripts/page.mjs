/**
 * La page de statut de Webcosa.
 *
 * ## Pourquoi on n'habille pas celle d'Upptime
 *
 * Upptime livre une page toute faite, en Svelte, qu'il RÉGÉNÈRE à chaque
 * exécution depuis son propre modèle. Toute retouche y serait effacée à la
 * mesure suivante — silencieusement, et sans que personne ne comprenne
 * pourquoi la page est redevenue générique.
 *
 * On lit donc les mêmes données et on écrit notre propre page. Elle suit la
 * charte de Webcosa (`CHARTE-GRAPHIQUE.md` du dépôt principal) : Bricolage
 * Grotesque pour les titres avec son axe optique, Plus Jakarta Sans pour le
 * texte, les gris bleutés à la teinte 265, et le dégradé de titre RADIAL
 * ancré au coin — le linéaire violet→bleu est nommément interdit par la
 * charte.
 *
 * ## Le vert acide, et pourquoi il n'est PAS dans les barres
 *
 * La charte réserve `#C2EB32` à ce qui est EN TRAIN de se passer. Le mettre
 * partout où un service va bien lui ferait perdre son sens : il ne
 * signalerait plus rien. Les barres emploient donc un vert propre, et
 * l'acide ne sert qu'au point qui pulse à côté de « mesuré il y a
 * X minutes ».
 *
 * ## Ce que la page ne prétend pas savoir
 *
 * `dailyMinutesDown` ne contient QUE les jours avec panne. Un jour absent
 * est donc ambigu : soit tout allait bien, soit on ne mesurait pas encore.
 * On tranche avec la date de première mesure — avant elle, la barre est
 * neutre et signalée « pas encore de données ».
 *
 * Sans cette distinction, une page ouverte le premier jour afficherait
 * quatre-vingt-dix jours de vert parfait sur un service jamais observé.
 * C'est le genre de mensonge qu'une page de statut ne peut pas se
 * permettre : elle n'a qu'un seul actif, et c'est d'être crue.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RACINE = process.cwd();
const SORTIE = join(RACINE, "site-webcosa");
const JOURS = 90;

/* Trente sur mobile : quatre-vingt-dix segments ne TIENNENT pas dans les
   ~256 px utiles d'un écran de 320. Ils débordaient de la carte, et le
   seul segment coloré — aujourd'hui, le seul qui porte une information —
   se retrouvait poussé hors de l'écran. Les soixante plus anciens sont
   masqués en CSS plutôt que retirés du HTML : une seule page sert les
   deux largeurs, sans script et sans second rendu. */
const JOURS_MOBILE = 30;

/** La page contact de la vitrine. Le seul lien sortant qui compte ici. */
const LIEN_ASSISTANCE = "https://www.webcosa.com/contact";

/**
 * Le symbole de la marque, embarqué EN DUR dans la page.
 *
 * Il n'est pas chargé depuis webcosa.com, et c'est le point entier : cette
 * page est celle qu'on ouvre quand webcosa.com ne répond plus. Un logo
 * pointant vers l'infrastructure surveillée serait cassé exactement le
 * jour où la page sert à quelque chose.
 *
 * Il sert de MASQUE CSS, pas d'image : la couleur vient alors de
 * `background`, donc le même fichier donne un symbole encre en thème clair
 * et blanc en thème sombre. Une balise `img` aurait imposé deux fichiers
 * et un `picture` pour les alterner.
 */
const SYMBOLE = `url("data:image/png;base64,${readFileSync(
  join(RACINE, "marque", "symbole.png"),
).toString("base64")}")`;

/** Le favicon, embarqué pour la même raison que le symbole. */
const enDonnees = (fichier) =>
  `data:image/png;base64,${readFileSync(join(RACINE, "marque", fichier)).toString("base64")}`;

/**
 * Ce qu'on écrit à droite du nom du service.
 *
 * Un mot, pas un pourcentage : le pourcentage descend sous les barres, là
 * où toutes les pages de statut le mettent, parce qu'il qualifie la
 * PÉRIODE dessinée juste au-dessus. En haut on veut l'état de MAINTENANT,
 * et « Opérationnel » se lit sans être interprété — « 100 % » ne dit pas
 * si le service répond à cette seconde.
 */
const MOT_ETAT = { up: "Opérationnel", degraded: "Dégradé", down: "Indisponible" };

/* ── Lecture ─────────────────────────────────────────────────────────── */

const resume = JSON.parse(
  readFileSync(join(RACINE, "history", "summary.json"), "utf8"),
);

/**
 * Les deux bornes de la surveillance, LUES DANS LES DONNÉES.
 *
 * `derniere` ne doit surtout pas être l'heure de construction de la page.
 * Les sondes tournent toutes les 5 minutes, la page est reconstruite
 * toutes les 30 : horodater au build afficherait « dernière mesure à
 * 14:00 » sur une page bâtie à 14:00 avec des chiffres de 13:47.
 *
 * Une page de statut qui se trompe sur l'heure de sa propre mesure est
 * pire qu'inutile — c'est exactement le chiffre qu'on vient y chercher
 * quand on soupçonne une panne.
 */
function bornesDeMesure() {
  let plusTot = null;
  let plusTard = null;
  for (const f of readdirSync(join(RACINE, "history"))) {
    if (!f.endsWith(".yml")) continue;
    const texte = readFileSync(join(RACINE, "history", f), "utf8");

    const debut = /^startTime:\s*(.+)$/m.exec(texte);
    if (debut) {
      const t = new Date(debut[1].trim());
      if (!plusTot || t < plusTot) plusTot = t;
    }
    const maj = /^lastUpdated:\s*(.+)$/m.exec(texte);
    if (maj) {
      const t = new Date(maj[1].trim());
      if (!plusTard || t > plusTard) plusTard = t;
    }
  }
  return { debut: plusTot ?? new Date(), derniere: plusTard ?? new Date() };
}

const { debut: DEBUT, derniere: DERNIERE } = bornesDeMesure();

/* ── Les barres ──────────────────────────────────────────────────────── */

const jourISO = (d) => d.toISOString().slice(0, 10);

/**
 * Une barre par jour, de la plus ancienne à aujourd'hui.
 *
 * `minutes` vaut le nombre de minutes d'indisponibilité ce jour-là. Le
 * seuil de « dégradé » est posé à une minute : en dessous, c'est une sonde
 * qui a bronché, pas une panne que quelqu'un a vécue.
 */
function barres(service) {
  const bas = service.dailyMinutesDown ?? {};
  const out = [];
  const auj = new Date();
  for (let i = JOURS - 1; i >= 0; i--) {
    const d = new Date(auj);
    d.setUTCDate(d.getUTCDate() - i);
    const cle = jourISO(d);
    const finDuJour = new Date(`${cle}T23:59:59Z`);

    if (finDuJour < DEBUT) {
      out.push({ cle, etat: "vide", minutes: 0 });
      continue;
    }
    const minutes = bas[cle] ?? 0;
    const etat = minutes >= 60 ? "bas" : minutes >= 1 ? "degrade" : "haut";
    out.push({ cle, etat, minutes });
  }
  return out;
}

const LIBELLE_ETAT = {
  haut: "aucune interruption",
  degrade: "interruption courte",
  bas: "indisponible",
  vide: "pas encore de données",
};

/* ── Rendu ───────────────────────────────────────────────────────────── */

const echapper = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Upptime rend « 100.00% ». En français ça s'écrit « 100 %  » : virgule
 * décimale, espace insécable avant le signe, et pas de décimales quand il
 * n'y en a pas — « 100,00 % » sur une page française fait traduction
 * automatique, et c'est précisément l'impression qu'on ne veut pas donner
 * sur la page qui doit inspirer confiance.
 */
const pourcent = (brut) => {
  const n = Number.parseFloat(String(brut));
  if (!Number.isFinite(n)) return String(brut);
  const corps = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
  return `${corps} %`;
};

const dateFr = (d) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Paris",
  }).format(d);

const tousEnLigne = resume.every((s) => s.status === "up");
const aucunEnLigne = resume.every((s) => s.status !== "up");

const titre = tousEnLigne
  ? "Tous les services sont <em>opérationnels</em>"
  : aucunEnLigne
    ? "Une <em>panne</em> est en cours"
    : "Un service est <em>perturbé</em>";

function carte(s) {
  /* Le taux se colore sur l'état COURANT, pas sur lui-même. Un service
     tombé il y a dix minutes affiche encore 99,9 % — le peindre en vert
     parce que le nombre est haut dirait exactement le contraire de ce que
     la page existe pour dire. */
  const etat = s.status === "up" ? "haut" : "bas";
  const b = barres(s);
  const segments = b
    .map(
      (j) =>
        `<i class="seg seg--${j.etat}" data-info="${echapper(dateFr(new Date(j.cle)))} · ${LIBELLE_ETAT[j.etat]}"></i>`,
    )
    .join("");

  const mesures = b.filter((j) => j.etat !== "vide").length;

  return `
    <article class="carte">
      <header class="carte-tete">
        <div class="carte-titre">
          <span class="pastille pastille--${s.status === "up" ? "haut" : "bas"}" aria-hidden></span>
          <div>
            <h2>${echapper(s.name)}</h2>
            <a class="lien-service" href="${echapper(s.url)}" rel="noreferrer">${echapper(s.url.replace(/^https?:\/\//, ""))}</a>
          </div>
        </div>
        <div class="carte-chiffres">
          <span class="dispo dispo--${etat}">${MOT_ETAT[s.status] ?? "Inconnu"}</span>
          <span class="latence">${s.time} ms</span>
        </div>
      </header>

      <div class="barres" role="img" aria-label="Disponibilité sur ${JOURS} jours : ${echapper(s.uptime)}">${segments}</div>

      <footer class="carte-pied">
        <span><span class="quand-long">il y a ${JOURS} jours</span><span class="quand-court">il y a ${JOURS_MOBILE} jours</span></span>
        <span class="mesure"><b>${echapper(pourcent(s.uptime))}</b><span class="mot-dispo"> de disponibilité</span><em class="sur"> · ${mesures === 0 ? "aucun jour mesuré" : mesures === 1 ? "1 jour mesuré" : `${mesures} jours mesurés`}</em></span>
        <span>aujourd'hui</span>
      </footer>
    </article>`;
}

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statut — Webcosa</title>
<meta name="description" content="L'état en direct des services Webcosa : le site, la documentation, le Store et le CMS.">
<meta name="robots" content="index, follow">
<link rel="icon" type="image/png" href="${enDonnees("favicon.png")}">
<link rel="apple-touch-icon" href="${enDonnees("favicon-180.png")}">
<meta name="theme-color" content="#0D0F15">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Plus+Jakarta+Sans:wght@400..700&display=swap" rel="stylesheet">
<style>
:root{
  /* Gris bleutés à la teinte 265, comme la charte. */
  --encre:oklch(0.17 0.012 265);
  --gris-50:oklch(0.985 0.001 265); --gris-100:oklch(0.965 0.002 265);
  --gris-200:oklch(0.925 0.003 265); --gris-500:oklch(0.62 0.008 265);
  --marque:oklch(0.55 0.19 268); --violet-300:oklch(0.75 0.15 300);
  --acide:oklch(0.88 0.2 122);

  --fond:#fff; --fond-2:var(--gris-50); --carte:#fff;
  --texte:var(--encre); --texte-2:oklch(0.5 0.01 265); --texte-3:oklch(0.55 0.01 265);
  --filet:oklch(0.9 0.004 265);

  /* Un vert PROPRE pour les barres. L'acide est réservé à ce qui est en
     train de se passer — le point qui pulse, et lui seul. */
  --haut:oklch(0.68 0.15 155);
  --degrade:oklch(0.78 0.16 75);
  --bas:oklch(0.62 0.21 25);
  --vide:oklch(0.93 0.004 265);

  --titre:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --corps:"Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;
  --symbole:${SYMBOLE};
}
@media (prefers-color-scheme:dark){
  :root{
    --fond:oklch(0.155 0.008 265); --fond-2:oklch(0.18 0.009 265);
    --carte:oklch(0.185 0.009 265);
    --texte:oklch(0.96 0.002 265); --texte-2:oklch(0.72 0.008 265);
    --texte-3:oklch(0.62 0.008 265);
    --filet:oklch(1 0 0/.11);
    --vide:oklch(1 0 0/.09);
    --haut:oklch(0.74 0.15 155);
  }
}
*,*::before,*::after{box-sizing:border-box}
body{
  margin:0;background:var(--fond);color:var(--texte);
  font-family:var(--corps);font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
  letter-spacing:-.011em;
}
.enveloppe{max-width:820px;margin:0 auto;padding:0 24px}

/* ── En-tête ─────────────────────────────────────────────── */
.entete{border-bottom:1px solid var(--filet);position:sticky;top:0;
  background:color-mix(in oklch,var(--fond) 86%,transparent);
  backdrop-filter:blur(12px);z-index:10}
.entete-corps{display:flex;align-items:center;justify-content:space-between;
  gap:16px;height:60px}
.marque{display:flex;align-items:center;gap:9px;text-decoration:none;
  color:inherit;min-width:0}
/* Le symbole est un MASQUE : sa couleur vient de « background », donc il
   suit le thème tout seul. « currentColor » serait tentant, mais un masque
   ne lit pas la couleur du texte — il faut une vraie valeur de fond. */
.symbole{background:var(--texte);flex:none;
  -webkit-mask:var(--symbole) center/contain no-repeat;
  mask:var(--symbole) center/contain no-repeat}
.marque .symbole{width:26px;height:26px}
/* Le verrou de la marque, identique à celui de dev et du Store :
   « Webcosa » en normale, le mot de la surface en grasse, MÊME couleur
   pour les deux. Griser le second mot en ferait une légende ; ici il
   nomme le produit, au même titre que le premier. */
.verrou{font-family:var(--titre);font-size:16.5px;font-weight:400;
  letter-spacing:-.028em;font-variation-settings:"opsz" 24;
  white-space:nowrap}
.verrou b{font-weight:700}
/* Le seul geste possible depuis cette page. Rempli, donc : quelqu'un qui
   arrive ici parce que « ça ne marche pas » doit voir où demander de
   l'aide sans le chercher.
   En encre et non en bleu — la charte interdit le bleu Webcosa en aplat.
   « --texte » sur « --fond » s'inverse tout seul en thème sombre. */
.bouton-aide{background:var(--texte);color:var(--fond);text-decoration:none;
  font-size:13.5px;font-weight:600;padding:9px 16px;border-radius:999px;
  white-space:nowrap;flex:none;transition:opacity .18s ease}
.bouton-aide:hover{opacity:.85}

/* ── Bandeau ─────────────────────────────────────────────── */
.bandeau{padding:56px 0 40px}
.bandeau h1{
  font-family:var(--titre);font-weight:600;
  font-size:clamp(1.9rem,4.4vw,2.9rem);line-height:1.02;
  letter-spacing:-.038em;font-variation-settings:"opsz" 72;
  margin:0 0 14px;max-width:16ch}
/* Le masque-titre de la charte, aux valeurs exactes : radial, ancré au
   coin supérieur gauche, éteint dans currentColor — donc encre en clair
   et blanc en sombre, sans avoir à le redéclarer.

   Posé sur le TITRE ENTIER, pas sur le mot mis en avant. La charte dit
   « le mot », et c'est juste pour un mot court ; ici le mot saillant est
   « opérationnels », treize lettres. Le rayon valant le côté le plus
   éloigné, l'extinction à 24 % ne mordait que « opé » — trois lettres
   bleues au milieu d'une ligne noire, qui se lisent comme un bug
   d'affichage, pas comme une signature. Sur le bloc, la teinte parcourt
   le début de la première ligne et s'éteint : le geste voulu par la
   charte, à l'échelle où il fonctionne. */
.bandeau h1{
  background-image:radial-gradient(circle farthest-side at 0% 0%,
    var(--violet-300) 5%,var(--marque) 12%,currentColor 24%);
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent}
.bandeau h1 em{font-style:normal}
.vivant{display:inline-flex;align-items:center;gap:8px;
  font-size:13.5px;color:var(--texte-2)}
.point{width:7px;height:7px;border-radius:999px;background:var(--acide);
  box-shadow:0 0 0 0 color-mix(in oklch,var(--acide) 70%,transparent);
  animation:pulse 2.4s ease-out infinite;flex:none}
@keyframes pulse{
  0%{box-shadow:0 0 0 0 color-mix(in oklch,var(--acide) 55%,transparent)}
  70%{box-shadow:0 0 0 7px transparent}
  100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.point{animation:none}}

/* ── Cartes ──────────────────────────────────────────────── */
.services{display:flex;flex-direction:column;gap:12px;padding-bottom:8px}
.carte{background:var(--carte);border:1px solid var(--filet);
  border-radius:14px;padding:18px 20px 15px}
.carte-tete{display:flex;align-items:flex-start;justify-content:space-between;
  gap:16px;margin-bottom:14px}
.carte-titre{display:flex;align-items:flex-start;gap:10px;min-width:0}
.pastille{width:8px;height:8px;border-radius:999px;margin-top:8px;flex:none}
.pastille--haut{background:var(--haut)}
.pastille--bas{background:var(--bas)}
.carte h2{font-family:var(--titre);font-weight:600;font-size:16px;
  letter-spacing:-.028em;font-variation-settings:"opsz" 24;margin:0;
  line-height:1.35}
.lien-service{color:var(--texte-3);text-decoration:none;font-size:12.5px;
  font-variant-numeric:tabular-nums}
.lien-service:hover{color:var(--texte-2);text-decoration:underline}
.carte-chiffres{text-align:right;flex:none}
.dispo{display:block;font-size:14.5px;font-weight:600;
  font-variant-numeric:tabular-nums}
.dispo--haut{color:var(--haut)}
.dispo--bas{color:var(--bas)}
.latence{display:block;font-size:12px;color:var(--texte-3);
  font-variant-numeric:tabular-nums}

/* ── Les barres ──────────────────────────────────────────── */
.barres{display:flex;gap:2px;height:34px;align-items:stretch}
.seg{flex:1 1 0;min-width:2px;border-radius:2px;background:var(--vide);
  position:relative;transition:transform .12s ease,filter .12s ease}
/* Un jour non mesuré est un TRAIT FIN centré, pas une barre grise pleine
   hauteur. La différence n'est pas cosmétique : à quatre-vingt-dix
   colonnes grises pour un jour de vert, la page ressemblait à une panne
   généralisée alors qu'elle dit « je viens d'être installée ». Le trait
   se lit comme une ligne de temps qui n'a pas encore commencé — et les
   barres poussent dessus au fil des jours. */
.seg--vide{align-self:center;height:5px;border-radius:999px}
.seg--haut{background:var(--haut)}
.seg--degrade{background:var(--degrade)}
.seg--bas{background:var(--bas)}
.seg:hover{transform:scaleY(1.14);filter:brightness(1.08);z-index:2}
/* L'infobulle sort du segment survolé. Elle ne prend pas le pointeur, sans
   quoi elle se volerait le survol à elle-même et clignoterait. */
.seg:hover::after{content:attr(data-info);position:absolute;
  bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
  background:var(--encre);color:#fff;font-size:11.5px;line-height:1.4;
  padding:5px 9px;border-radius:7px;white-space:nowrap;
  pointer-events:none;z-index:3;font-family:var(--corps);letter-spacing:0;
  /* Le segment est un <i> — sans ça l'infobulle sort en italique. */
  font-style:normal;font-weight:500}
/* Aux DEUX BOUTS, l'infobulle s'aligne sur le bord au lieu d'être centrée.
   Centrée, celle du jour même — le segment le plus à droite, et le plus
   susceptible d'être survolé — dépassait de la fenêtre et se faisait
   couper net. Douze segments de marge de chaque côté couvrent la largeur
   d'une bulle aux libellés les plus longs. */
.seg:nth-child(-n+12):hover::after{left:0;transform:none}
.seg:nth-last-child(-n+12):hover::after{left:auto;right:0;transform:none}
@media (prefers-color-scheme:dark){
  .seg:hover::after{background:oklch(0.28 0.01 265)}}
.carte-pied{display:flex;justify-content:space-between;align-items:center;
  gap:12px;margin-top:9px;font-size:11.5px;color:var(--texte-3)}
.mesure{color:var(--texte-3);text-align:center}
.mesure b{font-weight:600;color:var(--texte-2);font-variant-numeric:tabular-nums}
/* Le nombre de jours réellement mesurés qualifie le pourcentage : « 100 % »
   sur un seul jour ne vaut pas « 100 % » sur quatre-vingt-dix. Il sort sur
   mobile, où la ligne n'a pas la place — pas la garde d'honnêteté qui
   compte le plus, mais celle qu'on peut se permettre de perdre. */
.sur{font-style:normal;opacity:.8}

/* ── Pied ────────────────────────────────────────────────── */
/* Une seule ligne, centrée, discrète — comme la font toutes les pages de
   statut qu'on regarde sans y penser. Les deux phrases qui étaient là
   expliquaient le montage technique à des gens venus vérifier si leur
   site répond ; personne ne lit ça. Ce qui reste tient dans le survol. */
.pied{margin-top:38px;padding:24px 0 52px;border-top:1px solid var(--filet);
  display:flex;justify-content:center}
.propulse{display:inline-flex;align-items:center;gap:7px;
  color:var(--texte-3);font-size:12.5px;text-decoration:none;
  transition:color .18s ease}
.propulse:hover{color:var(--texte-2)}
.propulse .symbole{width:15px;height:15px;background:currentColor}
.propulse b{font-weight:600;font-family:var(--titre);
  font-variation-settings:"opsz" 14;letter-spacing:-.02em}
.propulse em{font-style:normal;opacity:.72}
:focus-visible{outline:2px solid var(--marque);outline-offset:3px;border-radius:4px}
/* L'étiquette de gauche a deux versions : la période affichée change avec
   la largeur, donc le libellé doit changer avec elle. Écrire « il y a 90
   jours » sous trente barres serait un mensonge de plus. */
.quand-court{display:none}

@media (max-width:640px){
  .enveloppe{padding:0 16px}
  .entete-corps{height:56px}
  .bandeau{padding:38px 0 30px}

  /* Les soixante plus anciens sortent : il reste les trente derniers.
     Masqués et non supprimés — « display:none » les retire aussi de l'arbre
     d'accessibilité, donc un lecteur d'écran annonce ce qui est montré. */
  .seg:nth-child(-n+${JOURS - JOURS_MOBILE}){display:none}
  .quand-long{display:none}
  .quand-court{display:inline}
  /* L'ancrage de l'infobulle suit : le premier segment VISIBLE n'est plus
     l'enfant 1 mais l'enfant 61. Sans ça, les bulles du bord gauche
     restaient centrées et sortaient de l'écran. */
  .seg:nth-child(-n+${JOURS - JOURS_MOBILE + 12}):hover::after{
    left:0;transform:none}

  .sur{display:none}
  /* Les bornes ne se coupent jamais en deux lignes : « il y a 30 / jours »
     casse la lecture de la frise plus sûrement qu'un corps plus petit. */
  .carte-pied{font-size:11px;gap:8px}
  .carte-pied>span:first-child,.carte-pied>span:last-child{white-space:nowrap}
  .carte{padding:16px 16px 13px}
  .carte-tete{flex-direction:column;gap:9px}
  .carte-chiffres{text-align:left;display:flex;gap:11px;align-items:baseline}
  .barres{height:30px}
  .pied{padding:22px 0 40px}
}

/* Sous 360 px, « Statut » passe à la trappe : le symbole, le nom et le
   bouton d'assistance doivent tenir sur une ligne, et c'est le mot le
   moins utile des trois — le titre de l'onglet le dit déjà. */
@media (max-width:359px){
  .verrou b{display:none}
  /* Le chiffre suffit ; « de disponibilité » est deviné par la frise. */
  .mot-dispo{display:none}
}
</style>
</head>
<body>

<header class="entete">
  <div class="enveloppe entete-corps">
    <a class="marque" href="https://www.webcosa.com">
      <span class="symbole" aria-hidden></span>
      <span class="verrou">Webcosa <b>Statut</b></span>
    </a>
    <a class="bouton-aide" href="${LIEN_ASSISTANCE}">Assistance</a>
  </div>
</header>

<main class="enveloppe">
  <section class="bandeau">
    <h1>${titre}</h1>
    <p class="vivant"><span class="point" aria-hidden></span>
      Dernière mesure <time id="fraicheur" datetime="${DERNIERE.toISOString()}">à ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(DERNIERE)}</time></p>
  </section>

  <section class="services">
    ${resume.map(carte).join("\n")}
  </section>

  <footer class="pied">
    <a class="propulse" href="https://www.webcosa.com"
       title="Cette page est hébergée en dehors de l'infrastructure Webcosa : elle reste accessible même pendant une panne.">
      Propulsé par <span class="symbole" aria-hidden></span><b>Webcosa</b>
      <em>· hors infrastructure</em>
    </a>
  </footer>
</main>

<script>
/* La fraîcheur en clair — « il y a 4 minutes » plutôt qu'une heure que le
   lecteur doit soustraire lui-même.

   Elle est calculée CHEZ LE VISITEUR, et c'est le seul moyen qu'elle
   reste vraie : la page est un fichier statique servi par un CDN, donc
   une durée écrite à la construction vieillit avec elle. L'horodatage
   absolu est écrit dans le HTML et reste affiché si le script ne tourne
   pas — on ne perd rien, on gagne juste la lecture directe.

   Et rien ici ne PROMET une cadence. Le cron d'Upptime demande une mesure
   toutes les cinq minutes, mais l'ordonnanceur de GitHub est « au mieux »
   et peut prendre des heures à démarrer sur un dépôt neuf. Afficher
   « vérifié toutes les 5 minutes » serait donc une affirmation que la
   page ne peut pas tenir — sur une page de statut, l'écart entre ce qui
   est promis et ce qui est fait est précisément ce qui la discrédite.
   Le chiffre affiché, lui, est mesuré et se corrige tout seul. */
(function () {
  var t = document.getElementById("fraicheur");
  if (!t) return;
  var quand = new Date(t.getAttribute("datetime"));
  if (isNaN(quand)) return;

  function ecrire() {
    var min = Math.round((Date.now() - quand) / 60000);
    t.textContent =
      min < 1 ? "à l'instant"
      : min === 1 ? "il y a 1 minute"
      : min < 60 ? "il y a " + min + " minutes"
      : min < 120 ? "il y a 1 heure"
      : min < 1440 ? "il y a " + Math.round(min / 60) + " heures"
      : "il y a plus d'un jour";
  }
  ecrire();
  setInterval(ecrire, 30000);
})();
</script>

</body>
</html>
`;

mkdirSync(SORTIE, { recursive: true });
writeFileSync(join(SORTIE, "index.html"), html, "utf8");
writeFileSync(join(SORTIE, "CNAME"), "status.webcosa.com\n", "utf8");
writeFileSync(join(SORTIE, ".nojekyll"), "", "utf8");

console.log(
  `Page écrite : ${resume.length} services, ${JOURS} jours, mesure depuis ${DEBUT.toISOString()}`,
);
