import { createZipArchive } from '../../utils/epub';

/** A real 1x1 PNG, so cover sniffing sees a valid signature. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** A valid ISBN-13 (978-0-306-40615-7). */
export const VALID_ISBN = '978-0-306-40615-7';

export interface BuildEpubOptions {
  version?: '2' | '3';
  title?: string | null;
  language?: string | null;
  isbn?: string;
  extraEntries?: Array<{ path: string; data: Buffer; compress?: boolean }>;
  mimetypeFirst?: boolean;
  mimetype?: string;
  manifestExtras?: string;
  /** Empty spine. */
  spineMissing?: boolean;
  scripted?: boolean;
  remote?: boolean;
  cover?: boolean;
  encryptionXml?: string;
  /** Replace the spine's idrefs (default: the single chapter). */
  spineIdrefs?: string[];
  /** Omit META-INF/container.xml. */
  omitContainer?: boolean;
  /** Path the container's rootfile points at (default OEBPS/content.opf). */
  rootfilePath?: string;
  /** Replace the whole OPF document text. */
  rawOpf?: string;
  /** Content of the chapter XHTML body. */
  chapterBody?: string;
}

const utf8 = (s: string) => Buffer.from(s, 'utf8');

/** Builds a small, valid EPUB (2 or 3) with knobs to break it in specific ways. */
export function buildEpub(opts: BuildEpubOptions = {}): Buffer {
  const v3 = (opts.version ?? '3') === '3';
  const title = opts.title === undefined ? 'Test Book' : opts.title;
  const language = opts.language === undefined ? 'en' : opts.language;
  const hasCover = opts.cover ?? false;

  const chapterProps = [opts.scripted ? 'scripted' : '', opts.remote ? 'remote-resources' : '']
    .filter(Boolean)
    .join(' ');
  const idrefs = opts.spineMissing ? [] : (opts.spineIdrefs ?? ['chap1']);

  const metadata = [
    title === null ? '' : `<dc:title>${title}</dc:title>`,
    '<dc:creator>Ada Author</dc:creator>',
    language === null ? '' : `<dc:language>${language}</dc:language>`,
    '<dc:identifier id="BookID">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>',
    opts.isbn ? `<dc:identifier>urn:isbn:${opts.isbn}</dc:identifier>` : '',
    '<dc:description>A short test book.</dc:description>',
    !v3 && hasCover ? '<meta name="cover" content="cover-img"/>' : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  const manifest = [
    v3
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    `<item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"${
      chapterProps ? ` properties="${chapterProps}"` : ''
    }/>`,
    hasCover
      ? `<item id="cover-img" href="cover.png" media-type="image/png"${
          v3 ? ' properties="cover-image"' : ''
        }/>`
      : '',
    opts.manifestExtras ?? '',
  ]
    .filter(Boolean)
    .join('\n    ');

  const opf =
    opts.rawOpf ??
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="${v3 ? '3.0' : '2.0'}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    ${metadata}
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine${v3 ? '' : ' toc="ncx"'}>
    ${idrefs.map((id) => `<itemref idref="${id}"/>`).join('\n    ')}
  </spine>
</package>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opts.rootfilePath ?? 'OEBPS/content.opf'}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>TOC</title></head>
<body>
  <nav epub:type="toc"><ol>
    <li><a href="chapter1.xhtml">Chapter One</a><ol><li><a href="chapter1.xhtml#s">Section A</a></li></ol></li>
    <li><a href="chapter1.xhtml#two">Chapter Two</a></li>
  </ol></nav>
</body>
</html>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Chapter One</text></navLabel><content src="chapter1.xhtml"/>
      <navPoint id="n2" playOrder="2"><navLabel><text>Section A</text></navLabel><content src="chapter1.xhtml#s"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`;

  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body>${opts.chapterBody ?? '<p>Hello world.</p>'}</body></html>`;

  const mimetypeEntry = {
    path: 'mimetype',
    data: Buffer.from(opts.mimetype ?? 'application/epub+zip', 'ascii'),
  };
  const rest: Array<{ path: string; data: Buffer; compress?: boolean }> = [];
  if (!opts.omitContainer) rest.push({ path: 'META-INF/container.xml', data: utf8(container) });
  if (opts.encryptionXml !== undefined) {
    rest.push({ path: 'META-INF/encryption.xml', data: utf8(opts.encryptionXml) });
  }
  rest.push({ path: 'OEBPS/content.opf', data: utf8(opf) });
  rest.push(
    v3 ? { path: 'OEBPS/nav.xhtml', data: utf8(nav) } : { path: 'OEBPS/toc.ncx', data: utf8(ncx) },
  );
  rest.push({ path: 'OEBPS/chapter1.xhtml', data: utf8(chapter), compress: true });
  if (hasCover) rest.push({ path: 'OEBPS/cover.png', data: PNG_1X1 });
  rest.push(...(opts.extraEntries ?? []));

  const files = opts.mimetypeFirst === false ? [...rest, mimetypeEntry] : [mimetypeEntry, ...rest];
  return createZipArchive(files);
}

/** Offset of the central directory header for `name`, or throws. */
function findCentralHeader(zip: Buffer, name: string): number {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(eocd + 16);
  while (zip.readUInt32LE(p) === 0x02014b50) {
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) return p;
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no central header for ${name}`);
}

/** Sets the general-purpose bit flag in both the central and local header (copy returned). */
export function setGeneralPurposeFlag(zip: Buffer, name: string, flag: number): Buffer {
  const out = Buffer.from(zip);
  const central = findCentralHeader(out, name);
  out.writeUInt16LE(flag, central + 8);
  out.writeUInt16LE(flag, out.readUInt32LE(central + 42) + 6);
  return out;
}

/** Lies about an entry's uncompressed size in the central directory only (copy returned). */
export function setCentralUncompressedSize(zip: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(zip);
  out.writeUInt32LE(size, findCentralHeader(out, name) + 24);
  return out;
}

/** Lies about an entry's uncompressed size in the local header only (copy returned). */
export function setLocalUncompressedSize(zip: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(zip);
  out.writeUInt32LE(size, out.readUInt32LE(findCentralHeader(out, name) + 42) + 22);
  return out;
}

/** Overwrites an entry's name in its LOCAL header only; `newName` must have the same length. */
export function setLocalFileName(zip: Buffer, name: string, newName: string): Buffer {
  if (Buffer.byteLength(newName) !== Buffer.byteLength(name)) throw new Error('length differs');
  const out = Buffer.from(zip);
  const local = out.readUInt32LE(findCentralHeader(out, name) + 42);
  out.write(newName, local + 30, 'utf8');
  return out;
}
