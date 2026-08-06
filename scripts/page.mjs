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
          <span class="dispo dispo--${etat}">${echapper(pourcent(s.uptime))}</span>
          <span class="latence">${s.time} ms</span>
        </div>
      </header>

      <div class="barres" role="img" aria-label="Disponibilité sur ${JOURS} jours : ${echapper(s.uptime)}">${segments}</div>

      <footer class="carte-pied">
        <span>il y a ${JOURS} jours</span>
        <span class="mesure">${mesures === 0 ? "aucune mesure" : mesures === 1 ? "1 jour mesuré" : `${mesures} jours mesurés`}</span>
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
.marque{display:flex;align-items:center;gap:9px;text-decoration:none;color:inherit}
.marque-logo{width:24px;height:24px;border-radius:7px;background:var(--encre);
  display:grid;place-items:center;overflow:hidden;position:relative;flex:none}
.marque-logo::before{content:"";position:absolute;inset:0;
  background:radial-gradient(130% 130% at 20% 10%,
    color-mix(in oklch,var(--violet-300) 70%,transparent) 0%,
    color-mix(in oklch,var(--marque) 50%,transparent) 46%,transparent 76%)}
.marque-logo span{position:relative;color:#fff;font-family:var(--titre);
  font-weight:600;font-size:13px;line-height:1}
.marque b{font-family:var(--titre);font-weight:600;font-size:15.5px;
  letter-spacing:-.03em;font-variation-settings:"opsz" 24}
.marque i{font-style:normal;color:var(--texte-3);font-size:15.5px}
.lien-retour{color:var(--texte-2);text-decoration:none;font-size:13.5px;
  padding:7px 13px;border:1px solid var(--filet);border-radius:999px;
  transition:color .2s,border-color .2s}
.lien-retour:hover{color:var(--texte);border-color:var(--texte-3)}

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
.mesure{color:var(--texte-3)}

/* ── Pied ────────────────────────────────────────────────── */
.pied{margin-top:34px;padding:26px 0 46px;border-top:1px solid var(--filet);
  color:var(--texte-3);font-size:12.5px;display:flex;flex-wrap:wrap;
  gap:8px 20px;justify-content:space-between;align-items:center}
.pied a{color:var(--texte-2);text-decoration:none}
.pied a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--marque);outline-offset:3px;border-radius:4px}
@media (max-width:560px){
  .carte-tete{flex-direction:column;gap:10px}
  .carte-chiffres{text-align:left;display:flex;gap:12px;align-items:baseline}
  .barres{height:30px}
}
</style>
</head>
<body>

<header class="entete">
  <div class="enveloppe entete-corps">
    <a class="marque" href="https://www.webcosa.com">
      <span class="marque-logo"><span>W</span></span>
      <b>Webcosa</b><i>Statut</i>
    </a>
    <a class="lien-retour" href="https://www.webcosa.com">Retour au site</a>
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
    <span>Mesuré depuis le ${dateFr(DEBUT)}. Une interruption ouvre automatiquement un signalement.</span>
    <span>Hébergé hors de notre infrastructure — cette page reste debout si Webcosa tombe.</span>
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
