import type { Space, User } from "@remix-hub/client-core";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api, session } from "./src/client";

/**
 * Minimal mobile shell demonstrating cross-platform reuse: the exact same
 * @remix-hub/client-core API + Session power this screen as the web app.
 * Login (demo accounts) → live space list from the API.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = session.subscribe(() => setUser(session.user));
    void session.init().then(() => setUser(session.user));
    return unsub;
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .listSpaces()
      .then((r) => setSpaces(r.spaces))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  async function quickLogin(email: string) {
    setError(null);
    try {
      await api.login(email, "password");
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.logo}>R</Text>
        <View>
          <Text style={styles.title}>REMIX HUB</Text>
          <Text style={styles.tag}>IP × AI 2차창작 커뮤니티</Text>
        </View>
      </View>

      <View style={styles.authbar}>
        {user ? (
          <>
            <Text style={styles.who}>
              {user.role} · {user.display_name ?? user.user_id}
            </Text>
            <Pressable style={styles.btnGho} onPress={() => session.clear()}>
              <Text style={styles.btnGhoText}>로그아웃</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.btnGho} onPress={() => quickLogin("minji@remixhub.dev")}>
              <Text style={styles.btnGhoText}>민지 (크리에이터)</Text>
            </Pressable>
            <Pressable style={styles.btnGho} onPress={() => quickLogin("owner@remixhub.dev")}>
              <Text style={styles.btnGhoText}>오너</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.section}>스페이스 탐색</Text>
      {loading && <ActivityIndicator color="#7c5cff" />}
      {error && <Text style={styles.error}>API 연결 실패: {error}</Text>}

      <FlatList
        data={spaces}
        keyExtractor={(s) => s.space_id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardMeta}>
              👤 {item.member_count.toLocaleString()} · 🟢 {item.online_count.toLocaleString()} 온라인
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#0e0f13", padding: 20, paddingTop: 64 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#7c5cff",
    color: "#fff",
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
    lineHeight: 38,
  },
  title: { color: "#e7e9ee", fontSize: 18, fontWeight: "800" },
  tag: { color: "#9aa1b0", fontSize: 11 },
  authbar: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" },
  who: { color: "#9aa1b0", fontSize: 12, fontWeight: "600" },
  btnGho: {
    backgroundColor: "#23272f",
    borderColor: "#2b2f3a",
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnGhoText: { color: "#e7e9ee", fontSize: 12, fontWeight: "700" },
  section: { color: "#e7e9ee", fontSize: 16, fontWeight: "800", marginBottom: 10 },
  error: { color: "#ff5d6c", fontSize: 12, marginBottom: 10 },
  card: {
    backgroundColor: "#16181f",
    borderColor: "#2b2f3a",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: "#e7e9ee", fontSize: 14, fontWeight: "800" },
  cardMeta: { color: "#9aa1b0", fontSize: 12, marginTop: 6 },
});
