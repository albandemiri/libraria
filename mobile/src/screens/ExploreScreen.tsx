import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch } from '../config/api';
import { formatPrice } from '../config/money';
import { Book } from '../types';

export const ExploreScreen = ({ navigation }: { navigation: any }) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGenres = async () => {
    try {
      const data = await apiFetch<{ genres: Array<{ genre: string; bookCount: number }> }>(
        '/books/genres',
        { authenticated: false },
      );
      setGenres(data.genres.map((g) => g.genre));
    } catch {
      // ignore
    }
  };

  const fetchBooks = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedGenre) params.append('genre', selectedGenre);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());

      const url = `/books?${params.toString()}`;
      const data = await apiFetch<{ books: Book[] }>(url, { authenticated: false });
      setBooks(data.books);
    } catch (err) {
      console.error('Failed to fetch books:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchGenres();
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [selectedGenre, searchQuery]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchGenres();
    fetchBooks();
  }, [selectedGenre, searchQuery]);

  const renderBookItem = ({ item }: { item: Book }) => {
    const priceFormatted = formatPrice(item.price.amountCents, item.price.currency);

    return (
      <TouchableOpacity
        style={styles.bookCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
      >
        <View style={styles.coverPlaceholder}>
          <Text style={styles.coverText}>{item.title.charAt(0)}</Text>
        </View>

        <View style={styles.bookInfo}>
          <View style={styles.tagRow}>
            <Text style={styles.genreTag}>{item.genre}</Text>
            <Text style={styles.mediaTag}>{item.mediaType.toUpperCase()}</Text>
          </View>

          <Text style={styles.bookTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.bookAuthor} numberOfLines={1}>
            {item.author}
          </Text>

          <View style={styles.footerRow}>
            <Text style={styles.bookPrice}>{priceFormatted}</Text>
            <Text style={styles.publisherName} numberOfLines={1}>
              {item.publisher.name}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <TextInput
          style={styles.searchBar}
          placeholder="Search by title or author..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.genreBarContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreList}
        >
          <TouchableOpacity
            style={[styles.genreChip, selectedGenre === null && styles.genreChipActive]}
            onPress={() => setSelectedGenre(null)}
          >
            <Text
              style={[
                styles.genreChipText,
                selectedGenre === null && styles.genreChipTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
          {genres.map((genre) => (
            <TouchableOpacity
              key={genre}
              style={[
                styles.genreChip,
                selectedGenre === genre && styles.genreChipActive,
              ]}
              onPress={() => setSelectedGenre(genre)}
            >
              <Text
                style={[
                  styles.genreChipText,
                  selectedGenre === genre && styles.genreChipTextActive,
                ]}
              >
                {genre}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.id}
          renderItem={renderBookItem}
          contentContainerStyle={styles.booksList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No titles found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search or filters</Text>
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
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  searchBar: {
    height: 44,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111827',
  },
  genreBarContainer: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  genreList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  genreChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  genreChipActive: {
    backgroundColor: '#2563EB',
  },
  genreChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  genreChipTextActive: {
    color: '#FFFFFF',
  },
  booksList: {
    padding: 16,
    gap: 12,
  },
  bookCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 8,
  },
  coverPlaceholder: {
    width: 80,
    height: 110,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverText: {
    fontSize: 32,
    fontWeight: '800',
    color: '#94A3B8',
  },
  bookInfo: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'space-between',
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  genreTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mediaTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  bookAuthor: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  bookPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#059669',
  },
  publisherName: {
    fontSize: 11,
    color: '#9CA3AF',
    maxWidth: 140,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
});

