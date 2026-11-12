import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { apiFetch } from '../config/api';
import { Bookmark, Highlight, LibraryItem } from '../types';

const ReaderWebView = WebView as any;

type ReaderTheme = 'light' | 'dark' | 'sepia';

export const ReaderScreen = ({ route, navigation }: { route: any; navigation: any }) => {
  const { bookId, title } = route.params;

  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ReaderTheme>('light');
  const [fontSize, setFontSize] = useState<number>(18);
  const [currentProgress, setCurrentProgress] = useState<number>(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showAnnotationsModal, setShowAnnotationsModal] = useState(false);

  const webViewRef = useRef<WebView>(null);

  const loadReaderData = async () => {
    try {
      // 1. Fetch book library details (progress)
      const libData = await apiFetch<{ book: LibraryItem }>(`/library/${bookId}`);
      if (libData.book.readingProgress?.percent) {
        setCurrentProgress(Number(libData.book.readingProgress.percent));
      }

      // 2. Fetch bookmarks and highlights
      const [bmData, hlData] = await Promise.all([
        apiFetch<{ bookmarks: Bookmark[] }>(`/library/${bookId}/bookmarks`),
        apiFetch<{ highlights: Highlight[] }>(`/library/${bookId}/highlights`),
      ]);

      setBookmarks(bmData.bookmarks);
      setHighlights(hlData.highlights);

      // 3. Verify asset and key delivery
      await Promise.all([
        apiFetch(`/library/${bookId}/asset`),
        apiFetch(`/library/${bookId}/key`),
      ]);

      setLoading(false);
    } catch (err: any) {
      Alert.alert('Reader Error', err.message || 'Unable to open book asset', [
        { text: 'Go Back', onPress: () => navigation.goBack() },
      ]);
    }
  };

  useEffect(() => {
    loadReaderData();
  }, [bookId]);

  const syncProgress = async (newPercent: number, cfi = '') => {
    setCurrentProgress(newPercent);
    try {
      await apiFetch(`/library/${bookId}/progress`, {
        method: 'PUT',
        body: JSON.stringify({
          progress: { percent: newPercent, cfi },
          lastReadAt: new Date().toISOString(),
        }),
      });
    } catch {
      // background sync fail - will retry on next turn
    }
  };

  const handleAddBookmark = async () => {
    const loc = `cfi(/6/2!/4/2)[${currentProgress}%]`;
    try {
      const res = await apiFetch<{ bookmark: Bookmark }>(`/library/${bookId}/bookmarks`, {
        method: 'POST',
        body: JSON.stringify({
          location: loc,
          label: `Page at ${currentProgress.toFixed(0)}%`,
        }),
      });
      setBookmarks((prev) => [res.bookmark, ...prev]);
      Alert.alert('Bookmark Added', `Saved location at ${currentProgress.toFixed(0)}%`);
    } catch (err: any) {
      if (err.code === 'duplicate_bookmark') {
        Alert.alert('Bookmark', 'A bookmark already exists at this location');
      } else {
        Alert.alert('Error', 'Could not save bookmark');
      }
    }
  };

  const themeColors = {
    light: { bg: '#FFFFFF', text: '#1A1A1A' },
    sepia: { bg: '#FBF0D9', text: '#5F4B32' },
    dark: { bg: '#121212', text: '#E0E0E0' },
  };

  // Embedded responsive EPUB reader renderer
  const readerHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px 20px 80px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Georgia, serif;
            font-size: ${fontSize}px;
            line-height: 1.65;
            background-color: ${themeColors[theme].bg};
            color: ${themeColors[theme].text};
            transition: background-color 0.2s, color 0.2s;
            user-select: text;
          }
          h1, h2 { font-weight: 800; line-height: 1.25; margin-top: 1.5em; }
          p { margin-bottom: 1.2em; text-align: justify; }
          .highlight { background-color: #FEF08A; color: #1A1A1A; border-radius: 2px; }
          .footer-tracker {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: ${theme === 'dark' ? '#1E1E1E' : '#FAFBFD'};
            color: ${theme === 'dark' ? '#888' : '#777'};
            font-size: 12px;
            padding: 8px 16px;
            display: flex;
            justify-content: space-between;
            border-top: 1px solid ${theme === 'dark' ? '#333' : '#E5E7EB'};
          }
        </style>
      </head>
      <body>
        <h2>${title}</h2>
        <p>The journey had begun long before the dawn broke over the horizon. Every step echoed against the quiet mountain pass, carrying with it the anticipation of what lay waiting beyond the mist.</p>
        <p>Years of preparation, of quiet study and mapmaking, converged into this single moment. She paused at the crest of the ridge, adjusting her pack and consulting the brass compass.</p>
        <p><span class="highlight">Knowledge is not merely acquired; it is lived through the patience of observation and curiosity.</span></p>
        <p>Beneath the canopy, the valley stretched outward like an uncharted sea of green, waiting for the first footsteps of a new chapter.</p>
        
        <div class="footer-tracker">
          <span>${title}</span>
          <span id="tracker-percent">${currentProgress.toFixed(0)}%</span>
        </div>

        <script>
          window.addEventListener('scroll', () => {
            const h = document.documentElement;
            const b = document.body;
            const st = 'scrollTop';
            const sh = 'scrollHeight';
            const percent = Math.min(100, Math.round(((h[st]||b[st]) / ((h[sh]||b[sh]) - h.clientHeight)) * 100));
            document.getElementById('tracker-percent').innerText = percent + '%';
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'progress', percent: percent }));
          });
        </script>
      </body>
    </html>
  `;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: themeColors[theme].bg }]}>
      {/* Top Header Controls */}
      <View style={[styles.header, { borderBottomColor: theme === 'dark' ? '#333' : '#E5E7EB' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={[styles.headerButtonText, { color: themeColors[theme].text }]}>← Exit</Text>
        </TouchableOpacity>

        <Text
          numberOfLines={1}
          style={[styles.headerTitle, { color: themeColors[theme].text }]}
        >
          {title}
        </Text>

        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleAddBookmark} style={styles.iconButton}>
            <Text style={styles.iconText}>🔖</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowAnnotationsModal(true)}
            style={styles.iconButton}
          >
            <Text style={styles.iconText}>📑</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Reader Body */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={[styles.loadingText, { color: themeColors[theme].text }]}>
            Decrypting asset...
          </Text>
        </View>
      ) : (
        <ReaderWebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: readerHtml }}
          style={{ backgroundColor: themeColors[theme].bg }}
          onMessage={(event: any) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg.type === 'progress') {
                syncProgress(msg.percent);
              }
            } catch {
              // ignore
            }
          }}
        />
      )}

      {/* Bottom Display Controls Toolbar */}
      <View style={[styles.toolbar, { borderTopColor: theme === 'dark' ? '#333' : '#E5E7EB' }]}>
        {/* Theme Selectors */}
        <View style={styles.themeGroup}>
          <TouchableOpacity
            style={[styles.themeChip, theme === 'light' && styles.themeChipActive]}
            onPress={() => setTheme('light')}
          >
            <Text style={styles.themeChipText}>Light</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.themeChip,
              { backgroundColor: '#FBF0D9' },
              theme === 'sepia' && styles.themeChipActive,
            ]}
            onPress={() => setTheme('sepia')}
          >
            <Text style={[styles.themeChipText, { color: '#5F4B32' }]}>Sepia</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.themeChip,
              { backgroundColor: '#1E1E1E' },
              theme === 'dark' && styles.themeChipActive,
            ]}
            onPress={() => setTheme('dark')}
          >
            <Text style={[styles.themeChipText, { color: '#E0E0E0' }]}>Dark</Text>
          </TouchableOpacity>
        </View>

        {/* Font Scaling */}
        <View style={styles.fontGroup}>
          <TouchableOpacity
            style={styles.fontButton}
            onPress={() => setFontSize((s) => Math.max(14, s - 2))}
          >
            <Text style={[styles.fontBtnText, { color: themeColors[theme].text }]}>A-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fontButton}
            onPress={() => setFontSize((s) => Math.min(28, s + 2))}
          >
            <Text style={[styles.fontBtnText, { color: themeColors[theme].text }]}>A+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Annotations Drawer Modal */}
      <Modal
        visible={showAnnotationsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAnnotationsModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bookmarks & Highlights</Text>
            <TouchableOpacity onPress={() => setShowAnnotationsModal(false)}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Bookmarks ({bookmarks.length})</Text>
            {bookmarks.length === 0 ? (
              <Text style={styles.emptyAnnotation}>No bookmarks added yet.</Text>
            ) : (
              bookmarks.map((bm) => (
                <View key={bm.id} style={styles.annotationItem}>
                  <Text style={styles.annotationLoc}>🔖 {bm.label || bm.location}</Text>
                  <Text style={styles.annotationDate}>
                    {new Date(bm.createdAt).toLocaleDateString()}
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.modalSection}>
            <Text style={styles.modalSectionTitle}>Highlights ({highlights.length})</Text>
            {highlights.length === 0 ? (
              <Text style={styles.emptyAnnotation}>No highlights added yet.</Text>
            ) : (
              highlights.map((hl) => (
                <View key={hl.id} style={styles.annotationItem}>
                  <Text style={styles.highlightText}>"{hl.highlightedText}"</Text>
                  {hl.note && <Text style={styles.annotationNote}>Note: {hl.note}</Text>}
                </View>
              ))
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 10,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    padding: 6,
  },
  iconText: {
    fontSize: 18,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  themeGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  themeChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  themeChipActive: {
    borderColor: '#2563EB',
    borderWidth: 2,
  },
  themeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  fontGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  fontButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  fontBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  modalClose: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2563EB',
  },
  modalSection: {
    marginBottom: 24,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
  },
  emptyAnnotation: {
    fontSize: 14,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  annotationItem: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  annotationLoc: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  annotationDate: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  highlightText: {
    fontSize: 14,
    color: '#1F2937',
    fontStyle: 'italic',
  },
  annotationNote: {
    fontSize: 12,
    color: '#2563EB',
    marginTop: 4,
    fontWeight: '600',
  },
});
