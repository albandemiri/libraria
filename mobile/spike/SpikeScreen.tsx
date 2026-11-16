// Reader-engine spike screen. Throwaway: proves foliate-js + WebCrypto in a
// WebView under Expo Go, with the real Libraria DRM format.
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { READER_HTML } from './readerHtml.generated';
import { books, signingKey, testDevice } from '../spike-fixtures/manifest';

type Book = (typeof books)[number];
type Json = Record<string, any>;
type TocItem = { label: string; href: string; depth: number };

const BASE_URL = 'https://reader.libraria.invalid/';
// Same workaround as src/screens/ReaderScreen.tsx: WebView's class types clash with React 19.
const RNWebView = WebView as any;
const log = (tag: string, data: unknown) => console.log(`[SPIKE] ${tag} ${JSON.stringify(data)}`);
const posKey = (id: string) => `spike_pos_${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export function SpikeScreen() {
  const web = useRef<WebView>(null);
  const [webKey, setWebKey] = useState(0);
  const [caps, setCaps] = useState<Json | null>(null);
  const [results, setResults] = useState<Record<string, Json>>({});
  const [blockedNav, setBlockedNav] = useState<string[]>([]);
  const [reading, setReading] = useState<Book | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loc, setLoc] = useState<Json | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [fontSize, setFontSize] = useState(100);
  const [dark, setDark] = useState(false);
  const pendingOpen = useRef<{ book: Book; restore: boolean } | null>(null);
  const awaitingSnippet = useRef<{ kind: 'restore' | 'font'; bookId: string; before: string } | null>(null);
  const lastSnippet = useRef('');

  const send = useCallback((msg: Json) => {
    web.current?.injectJavaScript(`window.__lib && window.__lib.handle(${JSON.stringify(msg)}); true;`);
  }, []);

  const merge = useCallback((id: string, patch: Json) => {
    setResults((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }, []);

  const loadCiphertextB64 = useCallback(async (book: Book) => {
    const t0 = Date.now();
    const uri = Image.resolveAssetSource(book.ciphertext as number)?.uri;
    if (!uri) throw new Error('fixture asset not resolvable');
    const dir = new Directory(Paths.cache, 'spike');
    if (!dir.exists) dir.create();
    const dest = new File(dir, `${book.id}.bin`);
    if (dest.exists) dest.delete();
    const file = await File.downloadFileAsync(uri, dest);
    const t1 = Date.now();
    const b64 = await file.base64();
    const t2 = Date.now();
    return { b64, downloadMs: t1 - t0, readBase64Ms: t2 - t1 };
  }, []);

  const openBook = useCallback(
    async (book: Book, restore: boolean) => {
      setBusy(`Opening ${book.title}…`);
      setReading(book);
      setLoc(null);
      try {
        const { b64, downloadMs, readBase64Ms } = await loadCiphertextB64(book);
        const lastLocation = restore ? await SecureStore.getItemAsync(posKey(book.id)) : null;
        merge(book.id, { native: { downloadMs, readBase64Ms, sizeBytes: book.sizeBytes } });
        const t = Date.now();
        send({
          cmd: 'open',
          ciphertextB64: b64,
          sha256: book.sha256,
          licence: book.licence,
          device: testDevice,
          signingKey,
          lastLocation,
          sanitize: book.sanitize,
        });
        merge(book.id, { native: { downloadMs, readBase64Ms, injectMs: Date.now() - t, sizeBytes: book.sizeBytes } });
      } catch (e: any) {
        setBusy(null);
        merge(book.id, { error: { stage: 'native', message: String(e?.message ?? e) } });
        log('native-error', { id: book.id, message: String(e?.message ?? e) });
      }
    },
    [loadCiphertextB64, merge, send],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = JSON.parse(e.nativeEvent.data);
      const id = reading?.id ?? '_';
      switch (msg.type) {
        case 'caps':
          setCaps(msg);
          log('caps', msg);
          if (pendingOpen.current) {
            const p = pendingOpen.current;
            pendingOpen.current = null;
            openBook(p.book, p.restore);
          }
          break;
        case 'opened':
          setBusy(null);
          setToc(msg.toc ?? []);
          merge(id, { opened: msg, error: undefined });
          log('opened', { id, ...msg, toc: msg.toc?.length });
          break;
        case 'error':
          setBusy(null);
          merge(id, { error: msg });
          log('error', { id, ...msg });
          break;
        case 'relocate': {
          setLoc(msg);
          lastSnippet.current = msg.snippet ?? '';
          if (reading && msg.cfi) SecureStore.setItemAsync(posKey(reading.id), msg.cfi).catch(() => {});
          const w = awaitingSnippet.current;
          // iOS sends an empty-range relocate first during layout; wait for a real one.
          if (w && w.bookId === id && msg.snippet) {
            awaitingSnippet.current = null;
            const check = { before: w.before, after: msg.snippet, sameStart: w.before === msg.snippet };
            merge(id, w.kind === 'restore' ? { restoreCheck: check } : { fontChangeCheck: check });
            log(`${w.kind}-check`, { id, ...check });
          }
          break;
        }
        case 'security':
          merge(id, { security: msg });
          log('security', { id, ...msg });
          break;
        case 'negative':
          merge(id, { negative: msg });
          log('negative', { id, ...msg });
          break;
        case 'externalLink':
        case 'internalLink':
          log(msg.type, { id, href: msg.href });
          merge(id, { [msg.type]: msg.href });
          break;
      }
    },
    [merge, openBook, reading],
  );

  const reopen = () => {
    if (!reading) return;
    awaitingSnippet.current = { kind: 'restore', bookId: reading.id, before: lastSnippet.current };
    pendingOpen.current = { book: reading, restore: true };
    setCaps(null);
    setWebKey((k) => k + 1); // full WebView reload, like a cold start
  };

  const changeFont = (delta: number) => {
    if (!reading) return;
    const next = Math.max(70, Math.min(200, fontSize + delta));
    setFontSize(next);
    awaitingSnippet.current = { kind: 'font', bookId: reading.id, before: lastSnippet.current };
    send({ cmd: 'style', style: { fontSize: next } });
  };

  const toggleDark = () => {
    setDark((d) => {
      send({ cmd: 'style', style: { dark: !d } });
      return !d;
    });
  };

  const close = () => {
    send({ cmd: 'close' });
    setReading(null);
    setLoc(null);
    setToc([]);
  };

  const runNegative = async () => {
    const book = books[0];
    setBusy('Negative tests…');
    const { b64 } = await loadCiphertextB64(book);
    setReading(null);
    send({ cmd: 'negative', ciphertextB64: b64, licence: book.licence, device: testDevice, signingKey });
    setTimeout(() => setBusy(null), 1500);
  };

  const allResults = { caps, results, blockedNavigations: blockedNav };
  const shareResults = () => {
    log('ALL', allResults);
    Share.share({ message: JSON.stringify(allResults, null, 1) });
  };

  return (
    <SafeAreaView style={[s.root, dark && reading && s.rootDark]} edges={['top', 'bottom']}>
      <View style={s.webWrap}>
        <RNWebView
          key={webKey}
          ref={web}
          source={{ html: READER_HTML, baseUrl: BASE_URL }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          bounces={false}
          scrollEnabled={false}
          onShouldStartLoadWithRequest={(req: { url: string }) => {
            const ok = req.url.startsWith(BASE_URL) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:');
            if (!ok) {
              log('blocked-navigation', { url: req.url, isTopFrame: (req as any).isTopFrame });
              setBlockedNav((b) => [...b, `${(req as any).isTopFrame === false ? '[frame] ' : ''}${req.url}`]);
            }
            return ok;
          }}
          onContentProcessDidTerminate={() => log('webview-terminated', {})}
          style={s.web}
        />
        {!reading && (
          <ScrollView style={s.home} contentContainerStyle={s.homeContent}>
            <Text style={s.h1}>Reader engine trial</Text>
            <Text style={s.h2}>WebView capabilities</Text>
            {!caps ? (
              <Text>Waiting for the WebView…</Text>
            ) : (
              Object.entries(caps)
                .filter(([k]) => k !== 'type')
                .map(([k, v]) => (
                  <Text key={k} style={[s.cap, String(v).startsWith('FAIL') || v === false ? s.bad : null]}>
                    {k}: {String(v)}
                  </Text>
                ))
            )}
            <Text style={s.h2}>Books</Text>
            {books.map((b) => {
              const r = results[b.id];
              return (
                <Pressable key={b.id} style={s.book} onPress={() => openBook(b, true)} disabled={!caps}>
                  <Text style={s.bookTitle}>{b.title}</Text>
                  <Text style={s.small}>
                    {b.note} · {(b.sizeBytes / 1024).toFixed(0)} KB
                  </Text>
                  {r?.opened && <Text style={s.ok}>opened ✓ {JSON.stringify(r.opened.timings)}</Text>}
                  {r?.error && <Text style={s.bad}>error: {r.error.message}</Text>}
                  {r?.security && (
                    <Text style={r.security.pwnedTop || r.security.executedMarker || r.security.remoteImageLoaded === true ? s.bad : s.ok}>
                      security: pwned={String(r.security.pwnedTop ?? r.security.pwnedInner)} remoteImg={String(r.security.remoteImageLoaded)} violations={r.security.violations?.length}
                    </Text>
                  )}
                </Pressable>
              );
            })}
            <View style={s.row}>
              <Btn label="Negative tests" onPress={runNegative} />
              <Btn label="Share results" onPress={shareResults} />
            </View>
            {results[books[0].id]?.negative && <Text style={s.small}>{JSON.stringify(results[books[0].id].negative)}</Text>}
            {blockedNav.length > 0 && <Text style={s.small}>Blocked navigations: {blockedNav.join(', ')}</Text>}
          </ScrollView>
        )}
        {busy && (
          <View style={s.busy}>
            <Text style={s.busyText}>{busy}</Text>
          </View>
        )}
      </View>

      {reading && (
        <View style={[s.bar, dark && s.barDark]}>
          <Text style={[s.status, dark && s.textDark]} numberOfLines={1}>
            {loc?.tocLabel ?? '…'} · {loc?.location ? `${loc.location.current + 1}/${loc.location.total}` : ''} ·{' '}
            {loc ? `${Math.round((loc.fraction ?? 0) * 100)}%` : ''}
          </Text>
          <View style={s.row}>
            <Btn label="‹" onPress={() => send({ cmd: 'prev' })} />
            <Btn label="›" onPress={() => send({ cmd: 'next' })} />
            <Btn label="TOC" onPress={() => setTocOpen(true)} />
            <Btn label="A−" onPress={() => changeFont(-10)} />
            <Btn label="A+" onPress={() => changeFont(10)} />
            <Btn label={dark ? '☀' : '☾'} onPress={toggleDark} />
            <Btn label="⟳" onPress={reopen} />
            <Btn label="i" onPress={() => setInfoOpen(true)} />
            <Btn label="✕" onPress={close} />
          </View>
        </View>
      )}

      <Modal visible={tocOpen} animationType="slide" onRequestClose={() => setTocOpen(false)}>
        <SafeAreaView style={s.modal}>
          <Text style={s.h1}>Përmbajtja</Text>
          <FlatList
            data={toc}
            keyExtractor={(it, i) => `${i}-${it.href}`}
            renderItem={({ item }) => (
              <Pressable
                style={[s.tocItem, { paddingLeft: 12 + item.depth * 18 }]}
                onPress={() => {
                  setTocOpen(false);
                  send({ cmd: 'goTo', href: item.href });
                }}
              >
                <Text>{item.label}</Text>
              </Pressable>
            )}
          />
          <Btn label="Close" onPress={() => setTocOpen(false)} />
        </SafeAreaView>
      </Modal>

      <Modal visible={infoOpen} animationType="slide" onRequestClose={() => setInfoOpen(false)}>
        <SafeAreaView style={s.modal}>
          <ScrollView>
            <Text style={s.mono}>{JSON.stringify({ location: loc, result: reading ? results[reading.id] : null }, null, 1)}</Text>
          </ScrollView>
          <Btn label="Close" onPress={() => setInfoOpen(false)} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.btn, pressed && { opacity: 0.5 }]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  rootDark: { backgroundColor: '#121212' },
  webWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  home: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fafaf7' },
  homeContent: { padding: 16, paddingBottom: 48 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  cap: { fontSize: 12, fontFamily: 'Courier', marginBottom: 2 },
  ok: { fontSize: 11, color: '#1b7a3a', marginTop: 4 },
  bad: { fontSize: 11, color: '#b3261e', marginTop: 4 },
  small: { fontSize: 11, color: '#555', marginTop: 6 },
  book: { padding: 12, borderRadius: 10, backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#e4e1d8' },
  bookTitle: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#ece8dd' },
  btnText: { fontSize: 15 },
  bar: { paddingHorizontal: 8, paddingBottom: 4, borderTopWidth: 1, borderColor: '#e4e1d8', backgroundColor: '#fff' },
  barDark: { backgroundColor: '#1c1c1c', borderColor: '#333' },
  status: { fontSize: 12, color: '#444', marginTop: 6 },
  textDark: { color: '#ccc' },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  busyText: { fontSize: 15 },
  modal: { flex: 1, padding: 16 },
  tocItem: { paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  mono: { fontFamily: 'Courier', fontSize: 11 },
});
