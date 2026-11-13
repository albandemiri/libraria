import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch } from '../config/api';
import { formatPrice } from '../config/money';
import { Book, CheckoutSessionResponse, LibraryItem, TransactionReceipt } from '../types';

const PAYMENT_POLL_INTERVAL_MS = 2000;
const PAYMENT_POLL_TIMEOUT_MS = 3 * 60 * 1000;

export const BookDetailModal = ({ route, navigation }: { route: any; navigation: any }) => {
  const { bookId } = route.params;
  const [book, setBook] = useState<Book | null>(null);
  const [isOwned, setIsOwned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  // Stops payment polling if the user leaves the screen.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const fetchDetails = async () => {
    try {
      // 1. Get book details
      const bookData = await apiFetch<{ book: Book }>(`/books/${bookId}`, {
        authenticated: false,
      });
      setBook(bookData.book);

      // 2. Check if user already owns it
      try {
        await apiFetch<{ book: LibraryItem }>(`/library/${bookId}`);
        setIsOwned(true);
      } catch {
        setIsOwned(false);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load book details');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [bookId]);

  /**
   * Polls the receipt until the payment provider's webhook has settled it.
   * The app never decides a purchase succeeded; the backend does, from a
   * verified provider event. `failed` keeps polling because the customer can
   * retry inside the same checkout.
   */
  const waitForSettlement = async (
    transactionId: string,
  ): Promise<TransactionReceipt | null> => {
    const deadline = Date.now() + PAYMENT_POLL_TIMEOUT_MS;
    while (Date.now() < deadline && mounted.current) {
      const { transaction } = await apiFetch<{ transaction: TransactionReceipt }>(
        `/transactions/${transactionId}`,
      );
      if (!['pending', 'failed'].includes(transaction.status)) {
        return transaction;
      }
      await new Promise((resolve) => setTimeout(resolve, PAYMENT_POLL_INTERVAL_MS));
    }
    return null;
  };

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      // One key per purchase attempt: a retried request returns the same checkout.
      const idempotencyKey = `${bookId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const session = await apiFetch<CheckoutSessionResponse>('/checkout-sessions', {
        method: 'POST',
        body: JSON.stringify({ bookIds: [bookId], idempotencyKey }),
      });
      const transactionId = session.transaction.id;

      if (session.checkout.provider === 'simulated') {
        // Development backend: stand in for the payment provider. This sends
        // a signed sandbox webhook through the same path a real one takes.
        await apiFetch(`/sandbox/transactions/${transactionId}/events`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'payment_succeeded' }),
        });
      } else if (session.checkout.url) {
        await Linking.openURL(session.checkout.url);
      } else {
        throw new Error('Checkout is not available right now. Please try again later.');
      }

      const settled = await waitForSettlement(transactionId);
      if (!mounted.current) return;

      if (!settled) {
        Alert.alert(
          'Payment pending',
          "We'll add the book to your library as soon as the payment is confirmed.",
        );
        return;
      }
      if (settled.status !== 'paid') {
        Alert.alert('Payment not completed', 'Your card was not charged for this book.');
        return;
      }

      setIsOwned(true);
      Alert.alert(
        'Purchase Successful!',
        `"${book?.title}" has been added to your library.`,
        [
          { text: 'Keep Browsing', style: 'cancel' },
          {
            text: 'Read Now',
            onPress: () => {
              navigation.replace('Reader', { bookId: book?.id, title: book?.title });
            },
          },
        ],
      );
    } catch (err: any) {
      if (err.code === 'ALREADY_OWNED') {
        setIsOwned(true);
        Alert.alert('Notice', 'You already own this book in your library.');
      } else if (err.code === 'BOOK_NOT_FOR_SALE') {
        setBook((current) => (current ? { ...current, forSale: false } : current));
        Alert.alert('Not available', "This book can't be bought right now. Please try again later.");
      } else {
        Alert.alert('Checkout Failed', err.message || 'Could not complete transaction');
      }
    } finally {
      setPurchasing(false);
    }
  };

  if (loading || !book) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  const priceFormatted = formatPrice(book.price.amountCents, book.price.currency);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topSection}>
          <View style={styles.coverLarge}>
            <Text style={styles.coverLetter}>{book.title.charAt(0)}</Text>
          </View>

          <View style={styles.badgeRow}>
            <Text style={styles.genreBadge}>{book.genre}</Text>
            <Text style={styles.mediaBadge}>{book.mediaType.toUpperCase()}</Text>
          </View>

          <Text style={styles.title}>{book.title}</Text>
          <Text style={styles.author}>by {book.author}</Text>
          <Text style={styles.publisherText}>Published by {book.publisher.name}</Text>
        </View>

        <View style={styles.metaCard}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Language</Text>
            <Text style={styles.metaVal}>{book.language.toUpperCase()}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Format</Text>
            <Text style={styles.metaVal}>EPUB (DRM)</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Price</Text>
            <Text style={styles.priceHighlight}>{priceFormatted}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About this book</Text>
          <Text style={styles.description}>
            {book.description || 'No description provided.'}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        {isOwned ? (
          <TouchableOpacity
            style={styles.readButton}
            onPress={() => {
              navigation.replace('Reader', { bookId: book.id, title: book.title });
            }}
          >
            <Text style={styles.buttonText}>Open in Library</Text>
          </TouchableOpacity>
        ) : book.forSale === false ? (
          <View style={styles.unavailableButton}>
            <Text style={styles.unavailableText}>Not available for purchase</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.buyButton}
            onPress={handlePurchase}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Buy for {priceFormatted}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 100,
  },
  topSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  coverLarge: {
    width: 140,
    height: 200,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 18,
  },
  coverLetter: {
    fontSize: 54,
    fontWeight: '800',
    color: '#94A3B8',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  genreBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  mediaBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },
  author: {
    fontSize: 16,
    color: '#4B5563',
    marginBottom: 4,
  },
  publisherText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  metaCard: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  metaCol: {
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  metaVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F2937',
  },
  priceHighlight: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: '#E5E7EB',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: '#4B5563',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F6',
  },
  buyButton: {
    height: 52,
    backgroundColor: '#059669',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readButton: {
    height: 52,
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableButton: {
    height: 52,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unavailableText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

