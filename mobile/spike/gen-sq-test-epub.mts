// @ts-nocheck -- Node-only script (run from backend/ with tsx); not part of the app.
/**
 * Generates Albanian edge-case EPUBs for the reader-engine trial.
 *
 *   cd backend && npx tsx <this file> <outDir>
 *
 * Output: liber-prove-sq-epub3.epub and liber-prove-sq-epub2.epub.
 * Original text written for testing; no third-party content.
 * Fonts: Instrument Serif (SIL OFL 1.1) from @fontsource, embedded.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Loaded at run time (a static import would pull backend Node types into the app's typecheck).
let createZipArchive: any;

// <repo>/mobile/spike/gen-sq-test-epub.mts -> <repo>/backend (needs `npm ci` there for sharp)
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
const req = createRequire(`${BACKEND}/package.json`);
const sharp = req('sharp') as typeof import('sharp');

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: gen-sq-test-epub.ts <outDir>');

const TITLE = 'Libër prove: Çështje të vogla për lexuesin';
const AUTHOR = 'Libraria (tekst prove)';
const UUID = '5a1b9c3e-7d42-4f0e-9b8a-2c6d1e0f4a71';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const utf8 = (s: string) => Buffer.from(s, 'utf8');

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
  body: string; // XHTML fragment
}
interface Chapter {
  file: string;
  title: string;
  body: string; // XHTML fragment (after the h1)
  sections?: Section[];
  className?: string;
}

const p = (s: string) => `<p>${s}</p>`;

const LONG_PARAGRAPHS = [
  'Mëngjesi në Tiranë nis herët. Furrat e bukës hapen para se të zbardhë drita, dhe era e bukës së ngrohtë përhapet nëpër rrugicat e ngushta. Një plak me kapelë leshi ulet në stol dhe lexon gazetën, faqe pas faqeje, pa nxitim.',
  'Në bibliotekën e qytetit, një vajzë e re kërkon një libër që e kishte lexuar në fëmijëri. Nuk ia mban mend titullin, vetëm ngjyrën e kopertinës dhe një fjali: „Deti nuk harron asgjë.“ Bibliotekarja buzëqesh dhe ngrihet nga karrigia.',
  '— Ku e keni lexuar? — e pyeti bibliotekarja. — Në Durrës, — u përgjigj vajza, — në shtëpinë e gjyshes, një verë kur binte shi çdo pasdite.',
  'Çdo libër ka një kujtesë të vetën. Faqet e palosura, shënimet me laps në anë, një biletë autobusi e harruar midis kapitujve: të gjitha këto tregojnë se dikush ka kaluar andej përpara nesh.',
  'Ëndrrat e verës janë të shkurtra. Çelësat e shtëpisë varen te dera, çadra pushon në cep, dhe çajin e malit e pijmë në ballkon ndërsa dielli fshihet pas maleve të Dajtit.',
  'Mësuesi i gjuhës shqipe u thoshte nxënësve se drejtshkrimi nuk është vetëm rregull, por edhe respekt për lexuesin. Një „ë“ e harruar ndryshon kuptimin: „mire“ nuk është „mirë“, dhe „pare“ nuk është „parë“.',
  'Udhëtimi nga Shkodra në Gjirokastër zgjat gati gjithë ditën. Rruga kalon pranë lumenjve, ullishteve dhe fshatrave me shtëpi prej guri, ku pleqtë të përshëndesin edhe kur nuk të njohin.',
  'Në tregun e Korçës, shitësit thërrasin me zë të lartë: «Mollë të freskëta! Djathë i bardhë! Mjaltë mali!» Blerësit pazarllëkojnë, qeshin dhe në fund largohen me qese të mbushura plot.',
  'Kur bie dëbora në Theth, rrugët mbyllen dhe fshati mbetet i vetmuar për javë të tëra. Banorët ndezin zjarrin, tregojnë përralla dhe presin pranverën me durimin e atyre që e njohin malin.',
  'Ky paragraf është shkruar qëllimisht i gjatë, që të testojë ndarjen e faqeve kur një paragraf i vetëm nuk nxë në ekran. Lexuesi duhet ta vazhdojë leximin në faqen tjetër pa humbur asnjë fjalë, pa përsëritur rreshta dhe pa hapësira të çuditshme. Nëse lexuesi e mbyll aplikacionin këtu dhe e hap përsëri, duhet të kthehet saktësisht në të njëjtin vend, edhe kur madhësia e shkronjave ndryshon, edhe kur telefoni rrotullohet, edhe kur kalon nga modaliteti i ditës në atë të natës. Këto janë gjëra të vogla, por pikërisht gjërat e vogla e bëjnë leximin të këndshëm ose të bezdisshëm, dhe askush nuk dëshiron që libri ta harrojë se ku kishte mbetur.',
];

const chapters: Chapter[] = [
  {
    file: 'kapitulli-01.xhtml',
    title: 'Hyrje',
    className: 'dropcap',
    body: [
      p('Çdo lexues e di ndjesinë kur hap një libër të ri: pak kureshtje, pak pritje, dhe shpresa që faqet do të rrjedhin lehtë. Ky libër nuk ka histori; është shkruar vetëm që të provojë si duket teksti shqip në lexuesin e Librarias.'),
      p('Shkronjat e veçanta të shqipes duhet të shfaqen saktë kudo: <b>ë Ë ç Ç</b>, në tekst të zakonshëm, në <i>tekst të pjerrët</i>, në <b>tekst të trashë</b> dhe në <b><i>të dyja bashkë</i></b>. Edhe fjalë si <i>çështje, ëndërr, çelës, Ërsekë, Çorovodë</i> duhet të duken natyrshëm.'),
      p('Thonjëzat shqipe janë „kështu“ ose «kështu», ndërsa dialogu shpesh shënohet me vizë të gjatë — si këtu. Tri pikat… duhet të qëndrojnë bashkë me fjalën para tyre, dhe pikëpyetja? nuk duhet të kalojë vetëm në rresht të ri.'),
      p('Numrat dhe çmimet: 1\u00a0250,00\u00a0€, 3,5\u00a0%, 12\u00a0km, ora 08:30. Hapësira e pandashme (non-breaking space) duhet ta mbajë numrin bashkë me njësinë.'),
      p('Ky paragraf përmban edhe një fjalë angleze, <span lang="en" xml:lang="en">bookmark</span>, të shënuar me gjuhën e saj, që motori i leximit ta ndajë sipas rregullave të anglishtes.'),
    ].join('\n'),
  },
  {
    file: 'kapitulli-02.xhtml',
    title: 'Fjalë të gjata dhe ndarja në rrokje',
    body: [
      p('Shqipja ka fjalë të gjata që provojnë ndarjen në rrokje (<i>hyphenation</i>) dhe rreshtimin e justifikuar. Në ekrane të ngushta, këto fjalë nuk duhet të dalin jashtë faqes:'),
      p('papërgjegjshmëria, mosmarrëveshjeve, ndërkombëtarizimit, kundërrevolucionarëve, shqiptaroamerikanët, mospërputhshmëria, vetëqeverisjeje, bashkëpunëtorëve, keqinterpretimeve, mirëkuptueshmëria.'),
      p('Një fjalë shumë e gjatë pa asnjë vend ndarjeje: <span class="nobreak-test">ndërkombëtarizimimosmarrëveshjevepapërgjegjshmëria</span>. Ajo duhet të thyhet ose të ndahet, por kurrë të shtyjë faqen anash.'),
      p('Teksti i justifikuar me shumë fjalë të gjata mund të krijojë hapësira të mëdha midis fjalëve. Mosmarrëveshjet ndërkombëtare për bashkëpunimin ekonomik u diskutuan gjerësisht nga përfaqësuesit e qeverive përkatëse gjatë konferencës vjetore.'),
      p('SHKRONJA TË MËDHA: ËSHTË ÇELËSI I SHTËPISË SË GJYSHES. Dhe e njëjta fjali me <span class="upper">është çelësi i shtëpisë së gjyshes</span> (me <i>text-transform</i>), si dhe me <span class="smallcaps">shkronja të vogla kapitale: Ëndërr Çudibërëse</span>.'),
    ].join('\n'),
  },
  {
    file: 'kapitulli-03.xhtml',
    title: 'Kapitull me nënkapituj',
    body: p('Ky kapitull ka nënkapituj të ndërthurur. Tabela e përmbajtjes duhet t’i tregojë në nivele, dhe çdo lidhje duhet të çojë në vendin e saktë brenda kapitullit, jo vetëm në fillim të tij.'),
    sections: [
      {
        id: 'nenkapitulli-3-1',
        title: '3.1 Qyteti',
        body: [LONG_PARAGRAPHS[0], LONG_PARAGRAPHS[6], LONG_PARAGRAPHS[7]].map(p).join('\n'),
      },
      {
        id: 'nenkapitulli-3-2',
        title: '3.2 Mali',
        body: [LONG_PARAGRAPHS[8], LONG_PARAGRAPHS[4]].map(p).join('\n'),
      },
      {
        id: 'nenkapitulli-3-3',
        title: '3.3 Deti — një titull i gjatë që duhet të mbështillet në dy rreshta në ekrane të vogla telefoni',
        body: [LONG_PARAGRAPHS[1], LONG_PARAGRAPHS[2], LONG_PARAGRAPHS[3]].map(p).join('\n'),
      },
    ],
  },
  {
    file: 'kapitulli-04.xhtml',
    title: 'Shënime në fund të faqes',
    body: [
      p('Lexuesi duhet të trajtojë shënimet si dritare të vogla, jo si kërcime në fund të librit.<a epub:type="noteref" class="noteref" href="#shenim-1" id="ref-1">1</a> Shënimi i dytë është më i gjatë dhe ka formatim brenda tij.<a epub:type="noteref" class="noteref" href="#shenim-2" id="ref-2">2</a>'),
      p('Ky shënim i tretë çon në një skedar tjetër, te shënimet në fund të librit.<a epub:type="noteref" class="noteref" href="shenimet.xhtml#fundshenim-1" id="ref-3">3</a> Lidhja duhet të funksionojë midis skedarëve, dhe kthimi prapa duhet të sjellë lexuesin këtu.'),
      p(LONG_PARAGRAPHS[5]),
      `<aside epub:type="footnote" id="shenim-1" class="footnote"><p><a href="#ref-1">1.</a> Ky është shënimi i parë. Ai është i shkurtër.</p></aside>`,
      `<aside epub:type="footnote" id="shenim-2" class="footnote"><p><a href="#ref-2">2.</a> Shënimi i dytë ka <i>tekst të pjerrët</i>, <b>tekst të trashë</b> dhe thonjëza „shqipe“. Ai duhet të shfaqet i plotë edhe kur është më i gjatë se një rresht, pa e prerë fjalinë në mes.</p></aside>`,
    ].join('\n'),
  },
  {
    file: 'kapitulli-05.xhtml',
    title: 'Figura, tabela, lista dhe poezi',
    body: [
      p('Më poshtë është një figurë brenda tekstit. Ajo duhet të përshtatet me gjerësinë e faqes dhe të mos ndahet në dy faqe.'),
      `<figure class="fig"><img src="imazhe/figura-1.png" alt="Male dhe diell, ilustrim provë"/><figcaption>Figura 1. Male në perëndim të diellit (ilustrim provë).</figcaption></figure>`,
      p('Një tabelë e thjeshtë:'),
      `<table class="tbl"><thead><tr><th>Qyteti</th><th>Rajoni</th><th>Lartësia (m)</th></tr></thead><tbody>
<tr><td>Shkodër</td><td>Veri</td><td>13</td></tr>
<tr><td>Korçë</td><td>Juglindje</td><td>850</td></tr>
<tr><td>Gjirokastër</td><td>Jug</td><td>300</td></tr>
<tr><td>Ërsekë</td><td>Juglindje</td><td>1\u00a0050</td></tr>
<tr><td>Çorovodë</td><td>Jug</td><td>390</td></tr>
</tbody></table>`,
      p('Një tabelë e gjerë që nuk nxë në ekran të telefonit; ajo nuk duhet ta prishë faqen:'),
      `<table class="tbl wide"><thead><tr><th>Viti</th><th>Janar</th><th>Shkurt</th><th>Mars</th><th>Prill</th><th>Maj</th><th>Qershor</th><th>Korrik</th><th>Gusht</th><th>Shtator</th><th>Tetor</th><th>Nëntor</th><th>Dhjetor</th></tr></thead><tbody>
<tr><td>2025</td><td>12</td><td>15</td><td>19</td><td>22</td><td>27</td><td>31</td><td>34</td><td>35</td><td>29</td><td>24</td><td>18</td><td>13</td></tr>
<tr><td>2026</td><td>11</td><td>14</td><td>20</td><td>23</td><td>28</td><td>32</td><td>35</td><td>34</td><td>30</td><td>23</td><td>17</td><td>12</td></tr>
</tbody></table>`,
      p('Listat:'),
      `<ul><li>bukë, djathë dhe ullinj</li><li>çaj mali me mjaltë</li><li>një libër i mirë<ul><li>me kopertinë të fortë</li><li>ose në telefon</li></ul></li></ul>`,
      `<ol><li>Hap librin.</li><li>Gjej vendin ku ke mbetur.</li><li>Lexo.</li></ol>`,
      `<blockquote><p>„Gjuha është shtëpia e një populli.“ — një fjali provë në bllok citimi, e zhvendosur nga margjina.</p></blockquote>`,
      p('Poezi, ku çdo varg duhet të mbetet në rreshtin e vet:'),
      `<div class="poem"><p>Bie shi mbi çatitë e qytetit,<br/>ëndrrat zgjohen një nga një,<br/>çelësi kërcet në derën e vjetër —<br/>dhe drita hyn, e qetë, në shtëpi.</p><p>Ç’mbetet nga dita kur ikën?<br/>Një faqe e kthyer, një fjalë,<br/>një shenjë e vogël në cep —<br/>që nesër ta gjesh prapë.</p></div>`,
      `<pre class="code">rreshti 1:  kod    me    hapësira
rreshti 2:  ë ç Ë Ç  — teksti i paformatuar</pre>`,
    ].join('\n'),
  },
  {
    file: 'kapitulli-06.xhtml',
    title: 'Kapitull i gjatë',
    body: (() => {
      const parts: string[] = [
        p('Ky kapitull është i gjatë me qëllim: rreth tridhjetë faqe në telefon. Ai provon ndarjen e faqeve, shpejtësinë e kalimit, ruajtjen e pozicionit dhe rikthimin në vendin e saktë pas ndryshimit të madhësisë së shkronjave.'),
      ];
      for (let i = 1; i <= 40; i++) {
        parts.push(`<h3 id="pjesa-${i}">Pjesa ${i}</h3>`);
        for (let j = 0; j < 3; j++) {
          parts.push(p(LONG_PARAGRAPHS[(i * 3 + j) % LONG_PARAGRAPHS.length]));
        }
      }
      return parts.join('\n');
    })(),
  },
  {
    file: 'shenimet.xhtml',
    title: 'Shënimet',
    body: `<aside epub:type="endnote" id="fundshenim-1" class="endnote"><p><a href="kapitulli-04.xhtml#ref-3">3.</a> Ky është një shënim në fund të librit, në skedar tjetër. Lidhja prapa duhet të çojë te shënimi 3 në kapitullin 4.</p></aside>`,
  },
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CSS = `@font-face {
  font-family: "Instrument Serif";
  font-style: normal;
  font-weight: 400;
  src: url("../fonte/instrument-serif-400.woff2") format("woff2");
}
@font-face {
  font-family: "Instrument Serif";
  font-style: italic;
  font-weight: 400;
  src: url("../fonte/instrument-serif-400-italic.woff2") format("woff2");
}
html { -webkit-hyphens: auto; hyphens: auto; }
body { line-height: 1.5; text-align: justify; }
h1, h2, h3 { font-family: "Instrument Serif", serif; font-weight: 400; text-align: left; -webkit-hyphens: manual; hyphens: manual; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 2em; margin: 1em 0 0.75em; page-break-before: always; break-before: page; }
h2 { font-size: 1.5em; margin: 1.5em 0 0.5em; }
h3 { font-size: 1.2em; margin: 1.25em 0 0.4em; }
p { margin: 0; text-indent: 1.2em; orphans: 2; widows: 2; }
h1 + p, h2 + p, h3 + p, .footnote p, .endnote p, blockquote p, .poem p { text-indent: 0; }
.dropcap h1 + p::first-letter { float: left; font-family: "Instrument Serif", serif; font-size: 3.2em; line-height: 0.85; margin: 0.05em 0.08em 0 0; }
.nobreak-test { overflow-wrap: anywhere; word-break: break-word; }
.upper { text-transform: uppercase; }
.smallcaps { font-variant: small-caps; }
a.noteref { vertical-align: super; font-size: 0.75em; line-height: 0; text-decoration: none; }
.footnote, .endnote { font-size: 0.9em; margin-top: 1em; }
figure.fig { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure.fig img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85em; font-style: italic; margin-top: 0.4em; }
table.tbl { border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
table.tbl th, table.tbl td { border: 1px solid currentColor; padding: 0.25em 0.5em; text-align: left; }
table.wide { width: 100%; }
blockquote { margin: 1em 1.5em; font-style: italic; }
.poem { margin: 1em 0 1em 1.5em; text-align: left; }
.poem p { margin-bottom: 0.8em; }
pre.code { font-family: monospace; font-size: 0.85em; white-space: pre-wrap; }
nav ol { list-style: none; padding-left: 1em; }
`;

function xhtml(title: string, body: string, opts: { v3: boolean; bodyClass?: string; epubNs?: boolean }): string {
  const ns = opts.v3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : '';
  // EPUB 2 has no epub:type; strip the attributes rather than emit invalid markup.
  const content = opts.v3 ? body : body.replace(/\s+epub:type="[^"]*"/g, '').replace(/<aside\b/g, '<div').replace(/<\/aside>/g, '</div>').replace(/<figure\b/g, '<div').replace(/<\/figure>/g, '</div>').replace(/<figcaption>/g, '<p class="caption">').replace(/<\/figcaption>/g, '</p>');
  const doctype = opts.v3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  return `<?xml version="1.0" encoding="UTF-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${ns}${opts.v3 ? ' lang="sq"' : ''} xml:lang="sq">
<head>
  ${opts.v3 ? '<meta charset="UTF-8"/>' : '<meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>'}
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="../stile/stili.css"/>
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ''}>
${content}
</body>
</html>`;
}

function chapterBody(ch: Chapter): string {
  const parts = [`<h1 id="fillimi">${esc(ch.title)}</h1>`, ch.body];
  for (const s of ch.sections ?? []) {
    parts.push(`<h2 id="${s.id}">${esc(s.title)}</h2>`, s.body);
  }
  return parts.join('\n');
}

async function makeImages(): Promise<{ cover: Buffer; figure: Buffer }> {
  const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400" viewBox="0 0 1600 2400">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d3557"/><stop offset="1" stop-color="#7a2e2e"/></linearGradient></defs>
  <rect width="1600" height="2400" fill="url(#g)"/>
  <circle cx="1150" cy="700" r="260" fill="#f4a261" opacity="0.9"/>
  <path d="M0 1500 L420 1050 L700 1350 L1050 900 L1600 1500 L1600 2400 L0 2400 Z" fill="#0b1d33" opacity="0.85"/>
  <text x="120" y="1780" font-family="Georgia, 'Times New Roman', serif" font-size="150" fill="#fdf6e3">Libër prove</text>
  <text x="120" y="1900" font-family="Georgia, 'Times New Roman', serif" font-size="70" font-style="italic" fill="#fdf6e3">Çështje të vogla për lexuesin</text>
  <text x="120" y="2240" font-family="Arial, sans-serif" font-size="48" letter-spacing="6" fill="#e9c46a">LIBRARIA · ËSHTË VETËM PROVË</text>
</svg>`;
  const figureSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <rect width="1200" height="700" fill="#f1e3c6"/>
  <circle cx="860" cy="260" r="120" fill="#e76f51"/>
  <path d="M0 520 L260 260 L470 470 L700 210 L1200 560 L1200 700 L0 700 Z" fill="#2a4d69"/>
  <path d="M0 620 L300 470 L620 640 L900 500 L1200 640 L1200 700 L0 700 Z" fill="#1b3147"/>
</svg>`;
  const cover = await sharp(Buffer.from(coverSvg)).jpeg({ quality: 85 }).toBuffer();
  const figure = await sharp(Buffer.from(figureSvg)).png().toBuffer();
  return { cover, figure };
}

async function build(v3: boolean): Promise<Buffer> {
  const { cover, figure } = await makeImages();
  // Fontsource's "latin" subset covers U+0000–00FF, which includes ë ç Ë Ç (and â û).
  const fontDir = `${BACKEND}/node_modules/@fontsource/instrument-serif/files`;
  const fontRegularLatin = readFileSync(`${fontDir}/instrument-serif-latin-400-normal.woff2`);
  const fontItalicLatin = readFileSync(`${fontDir}/instrument-serif-latin-400-italic.woff2`);

  const files: Array<{ path: string; data: Buffer; compress?: boolean }> = [];
  files.push({ path: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') });
  files.push({
    path: 'META-INF/container.xml',
    compress: true,
    data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  });

  // Title page
  const titlePage = xhtml(
    TITLE,
    `<div style="text-align:center; margin-top:20%;">
<h1 style="page-break-before:avoid; break-before:auto; text-align:center;">Libër prove</h1>
<p style="text-indent:0; font-style:italic;">Çështje të vogla për lexuesin</p>
<p style="text-indent:0; margin-top:3em;">${esc(AUTHOR)}</p>
<p style="text-indent:0; font-size:0.85em; margin-top:3em;">Ky libër është krijuar vetëm për të provuar lexuesin e Librarias. Teksti është origjinal dhe nuk ka vlerë letrare.</p>
</div>`,
    { v3 },
  );

  const coverPage = xhtml(
    'Kopertina',
    `<div style="text-align:center; margin:0; padding:0;"><img src="imazhe/kopertina.jpg" alt="${esc(TITLE)}" style="max-width:100%; max-height:100%;"/></div>`,
    { v3 },
  );

  files.push({ path: 'OEBPS/tekst/kopertina.xhtml', data: utf8(coverPage.replaceAll('imazhe/', '../imazhe/')), compress: true });
  files.push({ path: 'OEBPS/tekst/titulli.xhtml', data: utf8(titlePage), compress: true });
  for (const ch of chapters) {
    const html = xhtml(ch.title, chapterBody(ch), { v3, bodyClass: ch.className }).replaceAll(
      'src="imazhe/',
      'src="../imazhe/',
    );
    files.push({ path: `OEBPS/tekst/${ch.file}`, data: utf8(html), compress: true });
  }
  files.push({ path: 'OEBPS/stile/stili.css', data: utf8(CSS), compress: true });
  files.push({ path: 'OEBPS/fonte/instrument-serif-400.woff2', data: fontRegularLatin });
  files.push({ path: 'OEBPS/fonte/instrument-serif-400-italic.woff2', data: fontItalicLatin });
  files.push({ path: 'OEBPS/imazhe/kopertina.jpg', data: cover });
  files.push({ path: 'OEBPS/imazhe/figura-1.png', data: figure });

  // TOC entries
  type TocEntry = { label: string; href: string; children?: TocEntry[] };
  const toc: TocEntry[] = [
    { label: 'Faqja e titullit', href: 'tekst/titulli.xhtml' },
    ...chapters.map((ch) => ({
      label: ch.title,
      href: `tekst/${ch.file}`,
      children: ch.sections?.map((s) => ({ label: s.title, href: `tekst/${ch.file}#${s.id}` })),
    })),
  ];

  // NCX (both versions; EPUB 3 keeps it for older engines)
  let order = 0;
  const ncxPoints = (entries: TocEntry[], depth: number): string =>
    entries
      .map((e) => {
        order++;
        const pad = '  '.repeat(depth + 2);
        const kids = e.children?.length ? `\n${ncxPoints(e.children, depth + 1)}\n${pad}` : '';
        return `${pad}<navPoint id="np-${order}" playOrder="${order}"><navLabel><text>${esc(e.label)}</text></navLabel><content src="${e.href}"/>${kids}</navPoint>`;
      })
      .join('\n');
  files.push({
    path: 'OEBPS/toc.ncx',
    compress: true,
    data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="sq">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${UUID}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(TITLE)}</text></docTitle>
  <docAuthor><text>${esc(AUTHOR)}</text></docAuthor>
  <navMap>
${ncxPoints(toc, 0)}
  </navMap>
</ncx>`),
  });

  if (v3) {
    const navList = (entries: TocEntry[], depth: number): string => {
      const pad = '  '.repeat(depth + 2);
      return `${pad}<ol>\n${entries
        .map((e) => {
          const href = e.href.replace(/^tekst\//, '');
          const kids = e.children?.length ? `\n${navList(e.children, depth + 1)}\n${pad}  ` : '';
          return `${pad}  <li><a href="${href}">${esc(e.label)}</a>${kids}</li>`;
        })
        .join('\n')}\n${pad}</ol>`;
    };
    files.push({
      path: 'OEBPS/tekst/nav.xhtml',
      compress: true,
      data: utf8(
        xhtml(
          'Përmbajtja',
          `<nav epub:type="toc" id="toc">
  <h1 style="page-break-before:avoid;">Përmbajtja</h1>
${navList(toc, 0)}
</nav>
<nav epub:type="landmarks" hidden="">
  <ol>
    <li><a epub:type="cover" href="kopertina.xhtml">Kopertina</a></li>
    <li><a epub:type="toc" href="nav.xhtml">Përmbajtja</a></li>
    <li><a epub:type="bodymatter" href="${chapters[0].file}">Hyrje</a></li>
  </ol>
</nav>`,
          { v3 },
        ),
      ),
    });
  }

  const chapterItems = chapters
    .map((ch, i) => `    <item id="k${i + 1}" href="tekst/${ch.file}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = [
    '    <itemref idref="kopertina" linear="yes"/>',
    '    <itemref idref="titulli"/>',
    ...(v3 ? ['    <itemref idref="nav"/>'] : []),
    ...chapters.map((_, i) => `    <itemref idref="k${i + 1}"/>`),
  ].join('\n');

  const opf = v3
    ? `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookID" xml:lang="sq">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">urn:uuid:${UUID}</dc:identifier>
    <dc:title>${esc(TITLE)}</dc:title>
    <dc:creator id="autori">${esc(AUTHOR)}</dc:creator>
    <dc:language>sq</dc:language>
    <dc:publisher>Libraria</dc:publisher>
    <dc:description>Libër prove me tekst shqip për të provuar motorin e leximit: shkronjat ë/ç, thonjëzat, ndarjen në rrokje, shënimet, tabelat, figurat dhe një kapitull të gjatë.</dc:description>
    <dc:subject>Provë</dc:subject>
    <dc:date>2026-11-15</dc:date>
    <meta property="dcterms:modified">2026-11-15T00:00:00Z</meta>
    <meta name="cover" content="kopertina-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="tekst/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="kopertina-img" href="imazhe/kopertina.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="figura-1" href="imazhe/figura-1.png" media-type="image/png"/>
    <item id="stili" href="stile/stili.css" media-type="text/css"/>
    <item id="font-r" href="fonte/instrument-serif-400.woff2" media-type="font/woff2"/>
    <item id="font-i" href="fonte/instrument-serif-400-italic.woff2" media-type="font/woff2"/>
    <item id="kopertina" href="tekst/kopertina.xhtml" media-type="application/xhtml+xml"/>
    <item id="titulli" href="tekst/titulli.xhtml" media-type="application/xhtml+xml"/>
${chapterItems}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookID">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookID" opf:scheme="UUID">urn:uuid:${UUID}</dc:identifier>
    <dc:title>${esc(TITLE)}</dc:title>
    <dc:creator opf:role="aut">${esc(AUTHOR)}</dc:creator>
    <dc:language>sq</dc:language>
    <dc:publisher>Libraria</dc:publisher>
    <dc:description>Libër prove (EPUB 2) me tekst shqip për të provuar motorin e leximit.</dc:description>
    <dc:date>2026-11-15</dc:date>
    <meta name="cover" content="kopertina-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="kopertina-img" href="imazhe/kopertina.jpg" media-type="image/jpeg"/>
    <item id="figura-1" href="imazhe/figura-1.png" media-type="image/png"/>
    <item id="stili" href="stile/stili.css" media-type="text/css"/>
    <item id="font-r" href="fonte/instrument-serif-400.woff2" media-type="application/font-woff2"/>
    <item id="font-i" href="fonte/instrument-serif-400-italic.woff2" media-type="application/font-woff2"/>
    <item id="kopertina" href="tekst/kopertina.xhtml" media-type="application/xhtml+xml"/>
    <item id="titulli" href="tekst/titulli.xhtml" media-type="application/xhtml+xml"/>
${chapterItems}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
  <guide>
    <reference type="cover" title="Kopertina" href="tekst/kopertina.xhtml"/>
    <reference type="text" title="Hyrje" href="tekst/${chapters[0].file}"/>
  </guide>
</package>`;
  files.splice(2, 0, { path: 'OEBPS/content.opf', data: utf8(opf), compress: true });

  return createZipArchive(files);
}

(async () => {
  ({ createZipArchive } = await import(pathToFileURL(`${BACKEND}/src/utils/epub.ts`).href));
  mkdirSync(outDir, { recursive: true });
  for (const v3 of [true, false]) {
    const name = `liber-prove-sq-epub${v3 ? 3 : 2}.epub`;
    const buf = await build(v3);
    writeFileSync(path.join(outDir, name), buf);
    console.log(`${name}  ${buf.length} bytes`);
  }
})();
