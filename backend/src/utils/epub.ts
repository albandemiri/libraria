import { crc32 } from 'node:zlib';

interface ZipFileEntry {
  path: string;
  data: Buffer;
}

/**
 * Creates a valid uncompressed (STORE) ZIP archive buffer.
 * In EPUB specification, the `mimetype` file must be stored uncompressed as the first entry.
 */
export function createZipArchive(files: ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const fileNameBuf = Buffer.from(file.path, 'utf8');
    const fileCrc = crc32(file.data);
    const size = file.data.length;

    // 1. Local File Header (30 bytes + filename length)
    const localHeader = Buffer.alloc(30 + fileNameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed: 2.0
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(0, 8); // Compression method: 0 (STORE)
    localHeader.writeUInt16LE(0, 10); // Last mod time
    localHeader.writeUInt16LE(0, 12); // Last mod date
    localHeader.writeUInt32LE(fileCrc, 14); // CRC-32
    localHeader.writeUInt32LE(size, 18); // Compressed size
    localHeader.writeUInt32LE(size, 22); // Uncompressed size
    localHeader.writeUInt16LE(fileNameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    fileNameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, file.data);

    // 2. Central Directory Header (46 bytes + filename length)
    const centralHeader = Buffer.alloc(46 + fileNameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by: 2.0
    centralHeader.writeUInt16LE(20, 6); // Version needed: 2.0
    centralHeader.writeUInt16LE(0, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // Compression method: 0 (STORE)
    centralHeader.writeUInt16LE(0, 12); // Last mod time
    centralHeader.writeUInt16LE(0, 14); // Last mod date
    centralHeader.writeUInt32LE(fileCrc, 16); // CRC-32
    centralHeader.writeUInt32LE(size, 20); // Compressed size
    centralHeader.writeUInt32LE(size, 24); // Uncompressed size
    centralHeader.writeUInt16LE(fileNameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header
    fileNameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + file.data.length;
  }

  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  const centralDirOffset = offset;

  // 3. End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk with start of central directory
  eocd.writeUInt16LE(files.length, 8); // Total entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries in central directory
  eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // Offset of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export interface EpubChapter {
  title: string;
  paragraphs: string[];
}

export interface EpubMetadata {
  id: string;
  title: string;
  author: string;
  chapters: EpubChapter[];
}

/**
 * Creates a valid, well-formed EPUB 3 document as a Buffer.
 */
export function buildSampleEpub(metadata: EpubMetadata): Buffer {
  const files: ZipFileEntry[] = [];

  // 1. mimetype: MUST be first, uncompressed
  files.push({
    path: 'mimetype',
    data: Buffer.from('application/epub+zip', 'ascii'),
  });

  // 2. META-INF/container.xml
  files.push({
    path: 'META-INF/container.xml',
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      'utf8',
    ),
  });

  // 3. OEBPS/content.opf
  const manifestItems = metadata.chapters
    .map(
      (_, i) =>
        `    <item id="chap_${i}" href="chapter_${i}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');

  const spineItems = metadata.chapters.map((_, i) => `    <itemref idref="chap_${i}"/>`).join('\n');

  files.push({
    path: 'OEBPS/content.opf',
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${metadata.title}</dc:title>
    <dc:creator>${metadata.author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:${metadata.id}</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`,
      'utf8',
    ),
  });

  // 4. OEBPS/nav.xhtml
  const navList = metadata.chapters
    .map((ch, i) => `      <li><a href="chapter_${i}.xhtml">${ch.title}</a></li>`)
    .join('\n');

  files.push({
    path: 'OEBPS/nav.xhtml',
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${metadata.title} - TOC</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`,
      'utf8',
    ),
  });

  // 5. Chapters
  metadata.chapters.forEach((ch, i) => {
    const paragraphsHtml = ch.paragraphs.map((p) => `  <p>${p}</p>`).join('\n');
    files.push({
      path: `OEBPS/chapter_${i}.xhtml`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${ch.title}</title></head>
<body>
  <h2>${ch.title}</h2>
${paragraphsHtml}
</body>
</html>`,
        'utf8',
      ),
    });
  });

  return createZipArchive(files);
}
