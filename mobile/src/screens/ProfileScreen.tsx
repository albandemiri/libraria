import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { TransactionReceipt } from '../types';

export const ProfileScreen = () => {
  const { user, logout } = useAuth();
  const [transactions, setTransactions] = useState<TransactionReceipt[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);

  const fetchTransactions = async () => {
    try {
      const data = await apiFetch<{ transactions: TransactionReceipt[] }>('/transactions');
      setTransactions(data.transactions);
    } catch {
      // ignore
    } finally {
      setLoadingTxns(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const renderReceipt = ({ item }: { item: TransactionReceipt }) => {
    const amount = `$${(item.amount.amountCents / 100).toFixed(2)}`;
    const date = new Date(item.createdAt).toLocaleDateString();

    return (
      <View style={styles.txnCard}>
        <View style={styles.txnLeft}>
          <Text style={styles.txnTitle} numberOfLines={1}>
            {item.book.title}
          </Text>
          <Text style={styles.txnDate}>
            {date} • Ref: {item.paymentGatewayRef || 'N/A'}
          </Text>
        </View>
        <View style={styles.txnRight}>
          <Text style={styles.txnAmount}>{amount}</Text>
          <Text style={styles.txnStatus}>{item.status.toUpperCase()}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.userName}>{user?.displayName || 'Reader'}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{user?.role.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <View style={styles.historySection}>
        <Text style={styles.sectionTitle}>Order History</Text>
        {loadingTxns ? (
          <ActivityIndicator color="#2563EB" style={{ marginVertical: 20 }} />
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={(item) => item.id}
            renderItem={renderReceipt}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No purchases recorded yet.</Text>
            }
          />
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
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
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  profileInfo: {
    marginLeft: 16,
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  userEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  roleBadge: {
    backgroundColor: '#EFF6FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 6,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#2563EB',
  },
  historySection: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  txnCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  txnLeft: {
    flex: 1,
    marginRight: 12,
  },
  txnTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
  },
  txnDate: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  txnRight: {
    alignItems: 'flex-end',
  },
  txnAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#059669',
  },
  txnStatus: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginTop: 8,
  },
  footer: {
    padding: 20,
  },
  logoutButton: {
    height: 50,
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
});

