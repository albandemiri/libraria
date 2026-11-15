import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import * as yauzl from 'yauzl';

/**
 * Hardened EPUB validation and metadata extraction for UNTRUSTED uploads.
 *
 * Nothing is ever extracted to disk and no entry name is ever used as a
 * filesystem path: entries are looked up by name in an in-memory map and read
 * as bounded buffers. Central-directory sizes are treated as claims: they are
 * checked against policy before any data is read, cross-checked against the
 * local header, enforced by yauzl (validateEntrySizes) and, in addition, by a
 * hard byte cap on every entry we inflate.
 *
 * This runs inside a resource-limited worker thread (run-validation.ts).
 */

export type EpubReasonCode =
  | 'NOT_AN_EPUB'
  | 'ARCHIVE_TOO_LARGE'
  | 'TOO_MANY_ENTRIES'
  | 'COMPRESSION_RATIO'
  | 'UNSAFE_PATH'
  | 'DUPLICATE_ENTRY'
  | 'INVALID_CONTAINER'
  | 'INVALID_PACKAGE'
  | 'UNSUPPORTED_ENCRYPTION'
  | 'ENCRYPTED_ARCHIVE'
  | 'SCRIPTED_CONTENT'
  | 'REMOTE_RESOURCES'
  | 'UNSUPPORTED_MEDIA';

export interface ExtractedMetadata {
  title: string;
  creators: string[];
  language: string;
  identifiers: string[];
  isbn: string | null;
  description: string | null;
  tocSummary: Array<{ label: string; depth: number }>;
  hasCover: boolean;
  epubVersion: '2.0' | '3.0' | string;
}

export type CoverMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type ValidateResult =
  | {
      ok: true;
      metadata: ExtractedMetadata;
      cover: { mediaType: CoverMediaType; data: Buffer } | null;
    }
  | { ok: false; reasonCode: EpubReasonCode; detail: string };

// Policy limits (global constraints).
const MAX_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024;
const RATIO_MIN_SIZE = 1024 * 1024;
const MAX_RATIO = 100;

// Per-entry hard caps on what we inflate into memory.
const CAP_MIMETYPE = 64;
const CAP_SMALL_XML = 1024 * 1024; // container.xml, encryption.xml
const CAP_OPF = 5 * 1024 * 1024;
const CAP_NAV = 5 * 1024 * 1024;
const CAP_CONTENT = 20 * 1024 * 1024; // one XHTML/SVG document scanned for policy
const CAP_COVER = 10 * 1024 * 1024;
const CAP_FONT = 20 * 1024 * 1024;
/** Total bytes we are willing to inflate for the content scan across all documents. */
const SCAN_BUDGET = 200 * 1024 * 1024;

const MAX_TOC_ITEMS = 200;
const MAX_TOC_DEPTH = 32;
const MAX_NAME_LENGTH = 1024;

const FONT_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding', // IDPF font obfuscation
  'http://ns.adobe.com/pdf/enc#RC', // Adobe font obfuscation
]);

const XHTML_TYPE = 'application/xhtml+xml';
const SVG_TYPE = 'image/svg+xml';
const FONT_TYPES = new Set([
  'font/otf',
  'font/ttf',
  'font/sfnt',
  'font/woff',
  'font/woff2',
  'application/font-woff',
  'application/font-woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/x-font-ttf',
  'application/x-font-opentype',
  'application/x-font-type1',
]);
const PAGE_MAP_TYPE = 'application/oebps-page-map+xml';
const PAGE_TEMPLATE_TYPE = 'application/vnd.adobe-page-template+xml';
const COVER_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const SCRIPT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
]);
const ALLOWED_MEDIA_TYPES = new Set([
  XHTML_TYPE,
  SVG_TYPE,
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/css',
  'application/x-dtbncx+xml',
  'application/smil+xml',
  'application/pls+xml',
  'font/otf',
  'font/ttf',
  'font/sfnt',
  'font/woff',
  'font/woff2',
  'application/font-woff',
  'application/font-woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/x-font-ttf',
  'application/x-font-opentype',
  'application/x-font-type1',
  PAGE_MAP_TYPE,
  PAGE_TEMPLATE_TYPE,
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'video/mp4',
]);

/** Collapses the doubled prefix some conversion tools write (application/application/x-font-ttf). */
function normaliseMediaType(mediaType: string): string {
  if (!mediaType.startsWith('application/application/')) return mediaType;
  const collapsed = mediaType.slice('application/'.length);
  return FONT_TYPES.has(collapsed) ? collapsed : mediaType;
}

function isFontLike(mediaType: string): boolean {
  return mediaType.includes('font') || mediaType === 'application/vnd.ms-opentype';
}

/** Known font signatures: TrueType/sfnt, OpenType, TTC, WOFF, WOFF2 and Type 1 (PFB/PFA). */
function hasKnownFontSignature(b: Buffer): boolean {
  if (b.length < 4) return false;
  if (b.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00]))) return true;
  const tag = b.subarray(0, 4).toString('latin1');
  if (['true', 'OTTO', 'ttcf', 'wOFF', 'wOF2'].includes(tag)) return true;
  if (b[0] === 0x80 && b[1] === 0x01) return true; // PFB
  const text = b.subarray(0, 32).toString('latin1');
  return text.startsWith('%!PS-AdobeFont') || text.startsWith('%!FontType1');
}

/** True when the leading bytes look like markup, a script, a PDF or plain text. */
function looksLikeTextOrMarkup(b: Buffer): boolean {
  if (b.length === 0) return true;
  let start = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3;
  while (start < b.length && [0x20, 0x09, 0x0a, 0x0d].includes(b[start] as number)) start++;
  if (b[start] === 0x3c) return true; // '<': HTML, SVG, XML
  const head = b.toString('latin1', 0, 4);
  if (head === '%PDF' || head.startsWith('#!')) return true;
  const sample = b.subarray(0, 1024);
  for (const byte of sample) {
    if (byte === 0 || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d))
      return false;
  }
  // valid UTF-8 (a multi-byte character may be cut at the sample boundary)
  for (let cut = 0; cut <= 3 && cut < sample.length; cut++) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - cut));
      return true;
    } catch {
      // try again with fewer trailing bytes
    }
  }
  return false;
}

/**
 * A font-labelled file is accepted unless it is evidently not binary font
 * data. Unrecognised binary is allowed: some publishers scramble fonts
 * without declaring it in encryption.xml.
 */
function looksLikeFont(b: Buffer): boolean {
  return hasKnownFontSignature(b) || !looksLikeTextOrMarkup(b);
}

/** A deliberate, publisher-facing rejection. */
class Reject extends Error {
  constructor(
    readonly reasonCode: EpubReasonCode,
    readonly detail: string,
  ) {
    super(detail);
  }
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

const ARRAY_TAGS = new Set([
  'item',
  'itemref',
  'creator',
  'identifier',
  'meta',
  'rootfile',
  'EncryptedData',
  'nav',
  'ol',
  'li',
  'navPoint',
]);

const xmlParser = new XMLParser({
  processEntities: false, // never expand entities; predefined ones are decoded by us
  allowBooleanAttributes: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

/**
 * Parser for XHTML/SVG content documents. Prefixes are KEPT so that `href`,
 * `xlink:href` and `x:href` stay distinct attributes (each is judged by its
 * local name in the scan) instead of collapsing into one key.
 */
const contentParser = new XMLParser({
  processEntities: false,
  allowBooleanAttributes: true,
  ignoreAttributes: false,
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, body: string) => {
    switch (body.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
    }
    const code =
      body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    return Number.isInteger(code) &&
      code > 0 &&
      code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : whole;
  });
}

/** Text of a node (own text only), entity-decoded and trimmed. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return decodeEntities(node).trim();
  if (isNode(node) && typeof node['#text'] === 'string')
    return decodeEntities(node['#text']).trim();
  return '';
}

/** All text beneath a node, space separated (labels in nav/NCX). */
function deepText(node: unknown, depth = 0): string {
  if (depth > MAX_TOC_DEPTH) return '';
  if (typeof node === 'string') return decodeEntities(node);
  if (Array.isArray(node)) return node.map((n) => deepText(n, depth + 1)).join(' ');
  if (isNode(node)) {
    return Object.entries(node)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, value]) => deepText(value, depth + 1))
      .join(' ');
  }
  return '';
}

function attr(node: unknown, name: string): string | undefined {
  if (!isNode(node)) return undefined;
  const value = node[`@_${name}`];
  return typeof value === 'string' ? decodeEntities(value) : undefined;
}

/**
 * Parses untrusted XML. Any DOCTYPE that declares an entity is refused
 * outright (XXE and entity-expansion), whatever the parser would have done
 * with it, and the parser is configured never to expand or fetch anything.
 */
function parseXml(buf: Buffer, onInvalid: Reject, parser: XMLParser = xmlParser): XmlNode {
  if (
    buf.subarray(0, 4).includes(0) ||
    (buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf[0] === 0xfe && buf[1] === 0xff)
  ) {
    throw new Reject(onInvalid.reasonCode, 'XML documents must be UTF-8 encoded.');
  }
  const text = buf.toString('utf8').replace(/^﻿/, '');
  // No DTD declarations anywhere (comments cannot be trusted to hide or not hide them):
  // entities expand content, ATTLIST defaults inject attributes.
  if (/<!(?:ENTITY|ATTLIST|ELEMENT|NOTATION)/i.test(text)) {
    throw new Reject(onInvalid.reasonCode, 'DTD declarations are not allowed.');
  }
  // Any DOCTYPE with an internal subset is refused; check every occurrence.
  for (let at = text.indexOf('<!'); at !== -1; at = text.indexOf('<!', at + 2)) {
    if (text.slice(at, at + 9).toUpperCase() !== '<!DOCTYPE') continue;
    const close = text.indexOf('>', at);
    if (close === -1 || text.slice(at, close).includes('[')) {
      throw new Reject(onInvalid.reasonCode, 'An internal DTD subset is not allowed.');
    }
  }
  try {
    if (XMLValidator.validate(text) !== true) throw onInvalid;
    const parsed: unknown = parser.parse(text);
    if (!isNode(parsed)) throw onInvalid;
    return parsed;
  } catch {
    throw onInvalid;
  }
}

/** UTF-16/32 text would slip past byte-oriented pattern scans. */
function assertUtf8Compatible(buf: Buffer): void {
  if (
    buf.subarray(0, 4).includes(0) ||
    (buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf[0] === 0xfe && buf[1] === 0xff)
  ) {
    throw new Reject('INVALID_PACKAGE', 'Content documents must be UTF-8 encoded.');
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return true;
  if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(name)) return true;
  // "." and empty segments would alias another entry's name once normalised.
  return name.split('/').some((segment) => segment === '..' || segment === '.' || segment === '');
}

/**
 * Resolves a manifest/container/cipher href against a base directory inside
 * the archive. Relative references such as "../Images/a.jpg" are normalised
 * first and rejected only if the result escapes the container root.
 */
function resolveInArchive(baseDir: string, href: string, onBad: Reject): string {
  const cleaned = href.split('#')[0]?.split('?')[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    throw onBad;
  }
  const outside = () =>
    new Reject('UNSAFE_PATH', 'A package file reference points outside the book.');
  if (decoded === '') throw onBad;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (decoded.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f\\]/.test(decoded)) throw outside();
  if (decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) throw outside();
  const joined = path.posix.normalize(path.posix.join(baseDir, decoded));
  if (joined === '..' || joined.startsWith('../') || joined.startsWith('/') || joined === '.') {
    throw outside();
  }
  return joined;
}

// ---------------------------------------------------------------------------
// ZIP access
// ---------------------------------------------------------------------------

const CORRUPT = () => new Reject('NOT_AN_EPUB', 'The file is not a valid or intact ZIP archive.');
const ENCRYPTED = () =>
  new Reject('ENCRYPTED_ARCHIVE', 'Password-protected archives are not accepted.');

interface Archive {
  zip: yauzl.ZipFile;
  /** Central-directory order. */
  entries: yauzl.Entry[];
  byName: Map<string, yauzl.Entry>;
  scanned: { bytes: number };
}

/**
 * Decodes the raw name ourselves. yauzl's decoder silently turns "\\" into
 * "/", which would hide the very thing the path check must see.
 */
function entryName(entry: yauzl.Entry): string {
  return entry.fileNameRaw.toString(entry.generalPurposeBitFlag & 0x800 ? 'utf8' : 'latin1');
}

function collectEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        reject(new Reject('TOO_MANY_ENTRIES', `The archive has more than ${MAX_ENTRIES} entries.`));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', (err: Error) => {
      reject(/encryption/i.test(err.message) ? ENCRYPTED() : CORRUPT());
    });
    zip.readEntry();
  });
}

function checkLocalHeader(entry: yauzl.Entry, local: yauzl.LocalFileHeader): void {
  if (local.generalPurposeBitFlag & 0x1) throw ENCRYPTED();
  const mismatch = () =>
    new Reject('NOT_AN_EPUB', 'The ZIP archive has inconsistent headers and was rejected.');
  if (!local.fileName.equals(entry.fileNameRaw)) throw mismatch();
  if (local.compressionMethod !== entry.compressionMethod) throw mismatch();
  // With a data descriptor (bit 3) the local sizes and CRC are legitimately zero.
  if ((local.generalPurposeBitFlag & 0x8) === 0) {
    const differs = (localValue: number, centralValue: number) =>
      localValue !== 0xffffffff && localValue !== centralValue;
    if (
      differs(local.crc32, entry.crc32) ||
      differs(local.compressedSize, entry.compressedSize) ||
      differs(local.uncompressedSize, entry.uncompressedSize)
    ) {
      throw mismatch();
    }
  }
}

/**
 * Inflates every entry through a sink that retains nothing, cross-checking the
 * local header and capping each entry at its declared size, so sizes claimed in
 * the headers cannot hide a bomb in an entry we would otherwise never read.
 */
async function drainAllEntries(archive: Archive): Promise<void> {
  let total = 0;
  for (const entry of archive.entries) {
    try {
      checkLocalHeader(entry, await archive.zip.readLocalFileHeaderPromise(entry));
      if (entry.compressedSize === 0 && entry.uncompressedSize === 0) continue;
      const stream = await archive.zip.openReadStreamPromise(entry);
      let seen = 0;
      for await (const chunk of stream) {
        const length = (chunk as Buffer).length;
        seen += length;
        total += length;
        if (seen > entry.uncompressedSize) {
          stream.destroy();
          throw new Reject('COMPRESSION_RATIO', 'An entry expands beyond its declared size.');
        }
        if (total > MAX_UNCOMPRESSED_TOTAL) {
          stream.destroy();
          throw new Reject(
            'ARCHIVE_TOO_LARGE',
            'The book is larger than 500 MB when uncompressed.',
          );
        }
      }
    } catch (err) {
      if (err instanceof Reject) throw err;
      if (err instanceof Error && /too many bytes/.test(err.message)) {
        throw new Reject('COMPRESSION_RATIO', 'An entry expands beyond its declared size.');
      }
      throw CORRUPT();
    }
  }
}

/** Reads one entry into memory, never more than `cap` bytes. */
async function readEntry(
  archive: Archive,
  entry: yauzl.Entry,
  cap: number,
  tooLarge: Reject,
): Promise<Buffer> {
  if (entry.uncompressedSize > cap) throw tooLarge;
  try {
    checkLocalHeader(entry, await archive.zip.readLocalFileHeaderPromise(entry));
    const stream = await archive.zip.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const piece = chunk as Buffer;
      total += piece.length;
      if (total > cap) {
        stream.destroy();
        throw tooLarge;
      }
      chunks.push(piece);
    }
    return Buffer.concat(chunks, total);
  } catch (err) {
    if (err instanceof Reject) throw err;
    throw CORRUPT();
  }
}

// ---------------------------------------------------------------------------
// Structural checks (headers only; no entry data is read)
// ---------------------------------------------------------------------------

function checkStructure(entries: yauzl.Entry[]): Map<string, yauzl.Entry> {
  const first = entries[0];
  if (
    !first ||
    entryName(first) !== 'mimetype' ||
    first.relativeOffsetOfLocalHeader !== 0 ||
    first.compressionMethod !== 0
  ) {
    throw new Reject(
      'NOT_AN_EPUB',
      'This is not an EPUB: the first entry must be an uncompressed "mimetype" file.',
    );
  }

  const byName = new Map<string, yauzl.Entry>();
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (entry.generalPurposeBitFlag & 0x1 || entry.generalPurposeBitFlag & 0x40) throw ENCRYPTED();
    const name = entryName(entry);
    if (isUnsafeEntryName(name.endsWith('/') ? name.slice(0, -1) : name)) {
      throw new Reject('UNSAFE_PATH', 'The archive contains an unsafe file path.');
    }
    const key = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (seen.has(key)) {
      throw new Reject('DUPLICATE_ENTRY', 'The archive contains duplicate file names.');
    }
    seen.add(key);
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new Reject('NOT_AN_EPUB', 'The archive uses an unsupported compression method.');
    }
    total += entry.uncompressedSize;
    byName.set(name, entry);
  }
  if (total > MAX_UNCOMPRESSED_TOTAL) {
    throw new Reject('ARCHIVE_TOO_LARGE', 'The book is larger than 500 MB when uncompressed.');
  }
  for (const entry of entries) {
    if (
      entry.uncompressedSize > RATIO_MIN_SIZE &&
      (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_RATIO)
    ) {
      throw new Reject(
        'COMPRESSION_RATIO',
        'The archive has a suspiciously high compression ratio.',
      );
    }
  }
  return byName;
}

// ---------------------------------------------------------------------------
// Content policy scan (scripts, remote resources)
// ---------------------------------------------------------------------------

const REMOTE_ELEMENTS = new Set([
  'img',
  'image',
  'link',
  'audio',
  'video',
  'source',
  'track',
  'iframe',
  'object',
  'embed',
  'use',
  'input',
  'script',
]);
const REMOTE_ATTRIBUTES = new Set(['src', 'href', 'data', 'poster', 'srcset']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'data', 'formaction']);
/** Attributes that can smuggle a javascript: URL (including SVG animation targets). */
const SCRIPT_URL_ATTRIBUTES = new Set([...URL_ATTRIBUTES, 'values', 'to', 'from']);
const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
// Linear patterns: a quantified class is only ever followed by a literal or a non-overlapping group.
const CSS_REMOTE_URL = /url\([\s"']*(?:https?:)?\/\//i;
const CSS_REMOTE_IMPORT = /@import[\s"']*(?:url\([\s"']*)?(?:https?:)?\/\//i;

function cssHasRemote(css: string): boolean {
  return CSS_REMOTE_URL.test(css) || CSS_REMOTE_IMPORT.test(css);
}

/** Browsers drop tabs and newlines inside a URL, so "jav\tascript:" still runs. */
function isScriptUrl(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  return /^[\s\u0000-\u001f]*javascript:/i.test(value.replace(/[\t\n\r]/g, ''));
}

type Violation = 'SCRIPTED_CONTENT' | 'REMOTE_RESOURCES';

/**
 * Walks the element tree of a parsed XHTML/SVG document (iteratively, so
 * depth cannot overflow the stack). Namespace prefixes are already removed by
 * the parser, so "<svg:script>" and "<h:script>" are plain "script".
 */
function scanXmlTree(root: XmlNode): Violation | null {
  let remote = false;
  const stack: Array<[string, unknown]> = Object.entries(root);
  while (stack.length > 0) {
    const [key, value] = stack.pop() as [string, unknown];
    if (key.startsWith('@_') || key === '#text' || key.startsWith('?')) continue;
    const name = (key.split(':').pop() ?? key).toLowerCase();
    if (name === 'script') return 'SCRIPTED_CONTENT';
    for (const node of Array.isArray(value) ? value : [value]) {
      if (typeof node === 'string') {
        if (name === 'style' && cssHasRemote(node)) remote = true;
        continue;
      }
      if (!isNode(node)) continue;
      if (name === 'style' && cssHasRemote(textOf(node))) remote = true;
      for (const [attrKey, attrValue] of Object.entries(node)) {
        if (!attrKey.startsWith('@_')) {
          stack.push([attrKey, attrValue]);
          continue;
        }
        if (typeof attrValue !== 'string') continue;
        const attrName = (attrKey.slice(2).split(':').pop() ?? '').toLowerCase();
        const decoded = decodeEntities(attrValue);
        if (attrName.length > 2 && attrName.startsWith('on')) return 'SCRIPTED_CONTENT';
        if (attrName === 'srcdoc') return 'SCRIPTED_CONTENT';
        if (SCRIPT_URL_ATTRIBUTES.has(attrName) && isScriptUrl(decoded)) return 'SCRIPTED_CONTENT';
        if (
          URL_ATTRIBUTES.has(attrName) &&
          /^\s*data:(?:text\/html|application\/xhtml|image\/svg)/i.test(decoded)
        ) {
          return 'SCRIPTED_CONTENT';
        }
        if (
          REMOTE_ELEMENTS.has(name) &&
          REMOTE_ATTRIBUTES.has(attrName) &&
          REMOTE_URL.test(decoded)
        ) {
          remote = true;
        }
        if (attrName === 'style' && cssHasRemote(decoded)) remote = true;
      }
    }
  }
  return remote ? 'REMOTE_RESOURCES' : null;
}

/**
 * Adobe auxiliary XML (page map, XPGT) has no known "remote" elements, so any
 * attribute value or text that is itself a remote URL counts. xmlns
 * declarations are namespace names, not fetches, and are ignored.
 */
function auxXmlHasRemote(root: XmlNode): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === 'string') {
      if (REMOTE_URL.test(decodeEntities(node))) return true;
      continue;
    }
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isNode(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@_xmlns') || key.startsWith('?')) continue;
      stack.push(value);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Package parsing
// ---------------------------------------------------------------------------

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
  path: string;
}

const invalidPackage = (detail: string) => new Reject('INVALID_PACKAGE', detail);

function isValidIsbn13(candidate: string): boolean {
  if (!/^97[89]\d{10}$/.test(candidate)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(candidate[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(candidate[12]);
}

function extractIsbn(identifiers: string[]): string | null {
  for (const identifier of identifiers) {
    const digits = identifier.replace(/^urn:isbn:/i, '').replace(/[-\s]/g, '');
    if (isValidIsbn13(digits)) return digits;
  }
  return null;
}

function sniffImage(data: Buffer): CoverMediaType | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString('latin1', 0, 6))) return 'image/gif';
  if (
    data.length >= 12 &&
    data.toString('latin1', 0, 4) === 'RIFF' &&
    data.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function walkNavList(list: unknown, depth: number, out: Array<{ label: string; depth: number }>) {
  if (depth > MAX_TOC_DEPTH) return;
  for (const ol of toArray(list)) {
    if (!isNode(ol)) continue;
    for (const li of toArray(ol.li)) {
      if (out.length >= MAX_TOC_ITEMS) return;
      if (!isNode(li)) continue;
      const label = deepText(li.a ?? li.span)
        .replace(/\s+/g, ' ')
        .trim();
      if (label) out.push({ label: label.slice(0, 300), depth });
      walkNavList(li.ol, depth + 1, out);
    }
  }
}

function walkNavPoints(
  points: unknown,
  depth: number,
  out: Array<{ label: string; depth: number }>,
) {
  if (depth > MAX_TOC_DEPTH) return;
  for (const point of toArray(points)) {
    if (out.length >= MAX_TOC_ITEMS) return;
    if (!isNode(point)) continue;
    const label = deepText(isNode(point.navLabel) ? point.navLabel.text : undefined)
      .replace(/\s+/g, ' ')
      .trim();
    if (label) out.push({ label: label.slice(0, 300), depth });
    walkNavPoints(point.navPoint, depth + 1, out);
  }
}

function isTocNav(nav: unknown): nav is XmlNode {
  return isNode(nav) && (attr(nav, 'type') ?? '').split(/\s+/).includes('toc');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function validate(data: Buffer): Promise<ValidateResult> {
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) {
    throw new Reject('NOT_AN_EPUB', 'This file is not an EPUB (it is not a ZIP archive).');
  }

  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromBufferPromise(data, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: false,
      validateEntrySizes: true,
    });
  } catch {
    throw CORRUPT();
  }

  try {
    if (zip.entryCount > MAX_ENTRIES) {
      throw new Reject('TOO_MANY_ENTRIES', `The archive has more than ${MAX_ENTRIES} entries.`);
    }
    const entries = await collectEntries(zip);
    const byName = checkStructure(entries);
    const archive: Archive = { zip, entries, byName, scanned: { bytes: 0 } };
    await drainAllEntries(archive);
    return await inspect(archive);
  } finally {
    zip.close();
  }
}

async function inspect(archive: Archive): Promise<ValidateResult> {
  const { byName } = archive;
  const notEpub = new Reject('NOT_AN_EPUB', 'This is not an EPUB: the "mimetype" file is wrong.');

  // mimetype (first entry, already verified stored)
  const mimetypeEntry = archive.entries[0] as yauzl.Entry;
  const mimetype = await readEntry(archive, mimetypeEntry, CAP_MIMETYPE, notEpub);
  if (mimetype.toString('ascii') !== 'application/epub+zip') throw notEpub;

  // META-INF/container.xml -> OPF
  const invalidContainer = new Reject(
    'INVALID_CONTAINER',
    'The book has no valid META-INF/container.xml.',
  );
  const containerEntry = byName.get('META-INF/container.xml');
  if (!containerEntry) throw invalidContainer;
  const container = parseXml(
    await readEntry(archive, containerEntry, CAP_SMALL_XML, invalidContainer),
    invalidContainer,
  );
  const rootfiles = toArray(
    isNode(container.container) ? container.container.rootfiles : undefined,
  ).flatMap((rf) => (isNode(rf) ? toArray(rf.rootfile) : []));
  const rootfile =
    rootfiles.find((rf) => attr(rf, 'media-type') === 'application/oebps-package+xml') ??
    rootfiles[0];
  const fullPath = attr(rootfile, 'full-path');
  if (!fullPath) throw invalidContainer;
  const opfPath = resolveInArchive('', fullPath, invalidContainer);
  const opfEntry = byName.get(opfPath);
  if (!opfEntry) throw invalidContainer;

  // OPF
  const invalidOpf = invalidPackage('The package document (OPF) is missing or malformed.');
  const opfXml = parseXml(await readEntry(archive, opfEntry, CAP_OPF, invalidOpf), invalidOpf);
  const pkg = opfXml.package;
  if (!isNode(pkg)) throw invalidOpf;
  const version = attr(pkg, 'version');
  if (!version || !/^\d+\.\d+$/.test(version)) {
    throw invalidPackage('The package document has no valid version.');
  }
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);

  const metadata = isNode(pkg.metadata) ? pkg.metadata : {};
  const title = toArray(metadata.title).map(textOf).find(Boolean);
  if (!title) throw invalidPackage('The book has no title (dc:title).');
  const language = toArray(metadata.language).map(textOf).find(Boolean);
  if (!language) throw invalidPackage('The book has no language (dc:language).');
  const creators = toArray(metadata.creator).map(textOf).filter(Boolean);
  const identifiers = toArray(metadata.identifier).map(textOf).filter(Boolean);
  const description = toArray(metadata.description).map(textOf).find(Boolean);

  // manifest
  const manifest = new Map<string, ManifestItem>();
  const items: ManifestItem[] = [];
  const manifestNode = isNode(pkg.manifest) ? pkg.manifest : {};
  for (const raw of toArray(manifestNode.item)) {
    const id = attr(raw, 'id');
    const href = attr(raw, 'href');
    const rawMediaType = attr(raw, 'media-type')?.trim().toLowerCase();
    const mediaType = rawMediaType === undefined ? undefined : normaliseMediaType(rawMediaType);
    if (!id || !href || !mediaType)
      throw invalidPackage('A manifest item is missing id, href or media-type.');
    if (manifest.has(id)) throw invalidPackage('The manifest contains duplicate item ids.');
    const item: ManifestItem = {
      id,
      href,
      mediaType,
      properties: (attr(raw, 'properties') ?? '').split(/\s+/).filter(Boolean),
      path: '',
    };
    manifest.set(id, item);
    items.push(item);
  }

  // content policy on manifest declarations (before anything else is read)
  for (const item of items) {
    if (item.properties.includes('scripted') || SCRIPT_TYPES.has(item.mediaType)) {
      throw new Reject('SCRIPTED_CONTENT', 'Scripted content is not allowed.');
    }
  }
  for (const item of items) {
    if (
      item.properties.includes('remote-resources') ||
      /^[a-z][a-z0-9+.-]*:/i.test(item.href.trim()) ||
      item.href.trim().startsWith('//')
    ) {
      throw new Reject('REMOTE_RESOURCES', 'Resources hosted outside the book are not allowed.');
    }
  }
  for (const item of items) {
    if (!ALLOWED_MEDIA_TYPES.has(item.mediaType)) {
      throw new Reject(
        'UNSUPPORTED_MEDIA',
        `The book contains an unsupported media type (${item.mediaType.slice(0, 80)}).`,
      );
    }
    item.path = resolveInArchive(
      opfDir,
      item.href,
      invalidPackage('A manifest item has an invalid href.'),
    );
  }

  // META-INF/encryption.xml: only font obfuscation, and only of declared font items
  const obfuscatedPaths = new Set<string>();
  const encryptionEntry = byName.get('META-INF/encryption.xml');
  if (encryptionEntry) {
    const unsupported = (detail: string) => new Reject('UNSUPPORTED_ENCRYPTION', detail);
    const bad = unsupported('The book uses an unsupported encryption.');
    const xml = parseXml(await readEntry(archive, encryptionEntry, CAP_SMALL_XML, bad), bad);
    const root = xml.encryption;
    if (!isNode(root)) throw bad;
    const fontPaths = new Set(
      items.filter((item) => FONT_TYPES.has(item.mediaType)).map((item) => item.path),
    );
    for (const data of toArray(root.EncryptedData)) {
      const method = isNode(data) ? data.EncryptionMethod : undefined;
      const algorithm = attr(Array.isArray(method) ? method[0] : method, 'Algorithm');
      if (!algorithm || !FONT_OBFUSCATION_ALGORITHMS.has(algorithm)) {
        throw unsupported(
          'The book is encrypted or protected by DRM. Only font obfuscation is accepted.',
        );
      }
      const cipherData = isNode(data) ? data.CipherData : undefined;
      const reference = isNode(cipherData) ? cipherData.CipherReference : undefined;
      const uri = attr(Array.isArray(reference) ? reference[0] : reference, 'URI');
      if (!uri) throw bad;
      const target = resolveInArchive('', uri, bad);
      if (!fontPaths.has(target)) {
        throw unsupported('Only font files declared in the manifest may be obfuscated.');
      }
      obfuscatedPaths.add(target);
    }
  }

  // fonts are judged by content, not label (obfuscated fonts cannot be byte-checked)
  for (const item of items) {
    if (!isFontLike(item.mediaType) || obfuscatedPaths.has(item.path)) continue;
    const entry = byName.get(item.path);
    if (!entry) continue;
    const bad = invalidPackage('A font file is too large to process.');
    archive.scanned.bytes += Math.min(entry.uncompressedSize, CAP_FONT);
    if (archive.scanned.bytes > SCAN_BUDGET) throw bad;
    const data = await readEntry(archive, entry, CAP_FONT, bad);
    if (!looksLikeFont(data)) {
      throw new Reject(
        'UNSUPPORTED_MEDIA',
        `A file declared as a font (${item.mediaType.slice(0, 80)}) is not a font.`,
      );
    }
  }

  // spine
  const spineNode = isNode(pkg.spine) ? pkg.spine : {};
  const spine = toArray(spineNode.itemref);
  if (spine.length === 0) throw invalidPackage('The book has an empty reading order (spine).');
  for (const ref of spine) {
    const idref = attr(ref, 'idref');
    if (!idref || !manifest.has(idref)) {
      throw invalidPackage('The spine refers to an item that is not in the manifest.');
    }
  }

  // scan every XHTML/SVG document and stylesheet; each declared one must exist under that exact name
  const scanTypes = new Set([XHTML_TYPE, SVG_TYPE, 'text/css', PAGE_MAP_TYPE, PAGE_TEMPLATE_TYPE]);
  for (const item of items) {
    if (!scanTypes.has(item.mediaType)) continue;
    const entry = byName.get(item.path);
    if (!entry) throw invalidPackage('A declared content document is missing from the archive.');
    archive.scanned.bytes += entry.uncompressedSize;
    const tooLarge = invalidPackage('A content document is too large to process.');
    if (archive.scanned.bytes > SCAN_BUDGET) throw tooLarge;
    const content = await readEntry(archive, entry, CAP_CONTENT, tooLarge);
    let violation: Violation | null;
    if (item.mediaType === 'text/css') {
      assertUtf8Compatible(content);
      violation = cssHasRemote(content.toString('utf8')) ? 'REMOTE_RESOURCES' : null;
    } else {
      const tree = parseXml(
        content,
        invalidPackage('A content document is malformed or not UTF-8.'),
        contentParser,
      );
      violation = scanXmlTree(tree);
      if (
        !violation &&
        (item.mediaType === PAGE_MAP_TYPE || item.mediaType === PAGE_TEMPLATE_TYPE)
      ) {
        violation = auxXmlHasRemote(tree) ? 'REMOTE_RESOURCES' : null;
      }
    }
    if (violation === 'SCRIPTED_CONTENT') {
      throw new Reject(violation, 'Scripted content is not allowed.');
    }
    if (violation === 'REMOTE_RESOURCES') {
      throw new Reject(violation, 'Resources hosted outside the book are not allowed.');
    }
  }

  // table of contents: EPUB 3 nav, else NCX
  const tocSummary: Array<{ label: string; depth: number }> = [];
  const navItem = items.find((item) => item.properties.includes('nav'));
  const navEntry = navItem ? byName.get(navItem.path) : undefined;
  if (navEntry) {
    const bad = invalidPackage('The navigation document is malformed or too large.');
    const nav = parseXml(await readEntry(archive, navEntry, CAP_NAV, bad), bad);
    const html = nav.html;
    const body = isNode(html) ? html.body : undefined;
    const tocNav = toArray(isNode(body) ? body.nav : undefined).find(isTocNav);
    if (tocNav) walkNavList(tocNav.ol, 0, tocSummary);
  } else {
    const ncxId = attr(spineNode, 'toc');
    const ncxItem =
      (ncxId ? manifest.get(ncxId) : undefined) ??
      items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
    const ncxEntry = ncxItem ? byName.get(ncxItem.path) : undefined;
    if (ncxEntry) {
      const bad = invalidPackage('The table of contents (NCX) is malformed or too large.');
      const ncx = parseXml(await readEntry(archive, ncxEntry, CAP_NAV, bad), bad);
      const navMap = isNode(ncx.ncx) ? ncx.ncx.navMap : undefined;
      walkNavPoints(isNode(navMap) ? navMap.navPoint : undefined, 0, tocSummary);
    }
  }

  // cover: EPUB 3 cover-image property, else EPUB 2 <meta name="cover">
  let coverItem = items.find((item) => item.properties.includes('cover-image'));
  if (!coverItem) {
    const meta = toArray(metadata.meta).find((m) => attr(m, 'name') === 'cover');
    const id = attr(meta, 'content');
    coverItem = id ? manifest.get(id) : undefined;
  }
  let cover: { mediaType: CoverMediaType; data: Buffer } | null = null;
  const coverEntry = coverItem ? byName.get(coverItem.path) : undefined;
  if (coverItem && coverEntry && COVER_TYPES.has(coverItem.mediaType)) {
    try {
      const data = await readEntry(
        archive,
        coverEntry,
        CAP_COVER,
        invalidPackage('The cover image is too large.'),
      );
      const sniffed = sniffImage(data);
      if (sniffed && sniffed === coverItem.mediaType) cover = { mediaType: sniffed, data };
    } catch (err) {
      if (!(err instanceof Reject) || err.reasonCode !== 'INVALID_PACKAGE') throw err;
      // an oversized or unreadable cover just means "no cover"
    }
  }

  return {
    ok: true,
    metadata: {
      title: title.slice(0, 1000),
      creators: creators.slice(0, 50).map((c) => c.slice(0, 500)),
      language: language.slice(0, 50),
      identifiers: identifiers.slice(0, 50).map((i) => i.slice(0, 200)),
      isbn: extractIsbn(identifiers),
      description: description ? description.slice(0, 5000) : null,
      tocSummary,
      hasCover: cover !== null,
      epubVersion: version,
    },
    cover,
  };
}

/**
 * Validates an uploaded EPUB held in memory and extracts its metadata.
 * Never throws for bad input: every rejection is a `{ ok: false, reasonCode }`.
 * `detail` is safe to show to the publisher and never contains server paths.
 */
export async function validateEpub(data: Buffer): Promise<ValidateResult> {
  try {
    return await validate(data);
  } catch (err) {
    if (err instanceof Reject) {
      return { ok: false, reasonCode: err.reasonCode, detail: err.detail };
    }
    throw err;
  }
}
