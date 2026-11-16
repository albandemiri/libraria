import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SpikeScreen } from './spike/SpikeScreen';

// spike/reader-engine: the app is replaced by the reader-engine trial screen.
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SpikeScreen />
    </SafeAreaProvider>
  );
}
