import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch } from '../config/api';
import { LibraryItem } from '../types';

export const LibraryScreen = ({ navigation }: { navigation: any }) => {
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLibrary = async () => {
    try {
      const data = await apiFetch<{ books: LibraryItem[] }>('/library');
      setLibrary(data.books);
    } catch (err) {
      console.error('Failed to fetch library:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchLibrary();
    }, []),
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchLibrary();
  };

  const renderItem = ({ item }: { item: LibraryItem }) => {
    const percent = Number(item.readingProgress?.percent ?? 0).toFixed(0);

    return (
      <View style={styles.card}>
        <View style={styles.coverBox}>
          <Text style={styles.coverLetter}>{item.book.title.charAt(0)}</Text>
        </View>

        <View style={styles.details}>
          <Text style={styles.genre}>{item.book.genre}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {item.book.title}
          </Text>
          <Text style={styles.author} numberOfLines={1}>
            {item.book.author}
          </Text>

          {/* Reading Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(100, Math.max(0, Number(percent)))}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{percent}% read</Text>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() =>
                navigation.navigate('Reader', {
                  bookId: item.book.id,
                  title: item.book.title,
                })
              }
            >
              <Text style={styles.continueButtonText}>
                {Number(percent) > 0 ? 'Continue' : 'Start Reading'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Bookshelf</Text>
        <Text style={styles.headerSubtitle}>
          {library.length} {library.length === 1 ? 'book' : 'books'} in library
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : (
        <FlatList
          data={library}
          keyExtractor={(item) => item.book.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Your library is empty</Text>
              <Text style={styles.emptySubtitle}>
                Books you purchase in the store will appear here
              </Text>
              <TouchableOpacity
                style={styles.browseButton}
                onPress={() => navigation.navigate('Explore')}
              >
                <Text style={styles.browseButtonText}>Browse Storefront</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 8,
  },
  coverBox: {
    width: 84,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverLetter: {
    fontSize: 36,
    fontWeight: '800',
    color: '#94A3B8',
  },
  details: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'space-between',
  },
  genre: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 2,
  },
  author: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    backgroundColor: '#2563EB',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  actionRow: {
    marginTop: 8,
    alignItems: 'flex-start',
  },
  continueButton: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  continueButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  browseButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
