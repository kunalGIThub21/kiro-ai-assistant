import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  SafeAreaView,
  StatusBar,
  Modal,
  Dimensions
} from 'react-native';

const { width } = Dimensions.get('window');

export default function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'voice' | 'chat'
  const [activeTier, setActiveTier] = useState('pro'); // 'fast' | 'pro' | 'ultimate'
  const [messages, setMessages] = useState([
    {
      id: '1',
      sender: 'kiro',
      text: "Hello! I am Kiro. How can I assist you with your day or generate 4K art for you?"
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [voiceQuery, setVoiceQuery] = useState("What are the top trending collaborating interface design tools 2026");
  const [isListening, setIsListening] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [apiKey, setApiKey] = useState(process.env.EXPO_PUBLIC_GEMINI_API_KEY || '');

  const handleSend = (overrideText) => {
    const text = overrideText || inputText.trim();
    if (!text) return;

    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text }]);
    setInputText('');
    setView('chat');

    // Image Generation Check
    const s = text.trim().toLowerCase();
    const isImg = s.startsWith('/image') || s.startsWith('/img') || s.startsWith('image of ') || s.startsWith('picture of ') || s.startsWith('photo of ') ||
                  /^(draw|paint)\s+(a|an|the|\d+)/i.test(s) ||
                  (/\b(generate|create|make|draw|paint|render|show me)\b/i.test(s) && /\b(image|picture|photo|photograph|wallpaper|illustration|art|artwork|drawing|painting)\b/i.test(s));

    if (isImg) {
      let cleanPrompt = text.replace(/^\s*(\/image|\/img|\/art)\s*/i, '');
      cleanPrompt = cleanPrompt.replace(/^\s*(please\s+)?(can you\s+)?(generate|create|make|draw|paint|render|show me)\s+(an?\s+)?(ultra-hd\s+)?(4k\s+)?(hd\s+)?(cinematic\s+)?(photorealistic\s+)?(image|picture|photo|photograph|wallpaper|illustration|art|artwork|drawing|painting|portrait|sketch|render)?\s*(of\s+)?/i, '').trim();
      cleanPrompt = cleanPrompt || text;
      const seed = Math.floor(Math.random() * 99999);
      const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=turbo&width=800&height=800&nologo=true&seed=${seed}`;

      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: 'kiro',
            text: `Generated 4K artwork for: "${cleanPrompt}"`,
            imageUrl: imgUrl
          }
        ]);
      }, 1000);
      return;
    }

    // Live Gemini API Bot Response
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are Kiro, a helpful personal AI assistant. Reply clearly: ${text}` }] }]
        })
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || `Received: "${text}". Ready for next task.`;
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: 'kiro', text: reply }]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { id: (Date.now() + 1).toString(), sender: 'kiro', text: `Processed on Kiro ${activeTier.toUpperCase()} tier: "${text}". All systems ready.` }
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#070707" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setView('dashboard')}>
          <Text style={{ color: '#fff', fontSize: 18 }}>☰</Text>
        </TouchableOpacity>

        <View style={styles.greetingHeader}>
          <Text style={styles.greetingText}>Hi, Michael ✌️</Text>
        </View>

        <TouchableOpacity 
          style={styles.tierPill} 
          onPress={() => setActiveTier(activeTier === 'fast' ? 'pro' : activeTier === 'pro' ? 'ultimate' : 'fast')}
        >
          <Text style={styles.tierText}>
            {activeTier === 'fast' ? '⚡ Fast' : activeTier === 'pro' ? '✦ Pro' : '🔥 Ultimate'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatarBtn} onPress={() => setSettingsVisible(true)}>
          <Text style={styles.avatarText}>M</Text>
        </TouchableOpacity>
      </View>

      {/* VIEW: DASHBOARD (Matching Right Screen in Example) */}
      {view === 'dashboard' && (
        <ScrollView style={styles.body} contentContainerStyle={{ padding: 20 }}>
          <Text style={styles.heroTitle}>How may I help{'\n'}<Text style={{ fontWeight: '800' }}>you today?</Text></Text>

          {/* Bento Grid */}
          <View style={styles.bentoRow}>
            {/* Talk with Bot (Neon Lime) */}
            <TouchableOpacity 
              style={[styles.bentoCardLarge, { backgroundColor: '#ccff00' }]} 
              onPress={() => setView('voice')}
            >
              <View style={styles.cardTop}>
                <View style={styles.iconCircle}>
                  <Text style={{ fontSize: 20 }}>🗣️</Text>
                </View>
                <Text style={styles.arrowIcon}>↗</Text>
              </View>
              <View>
                <Text style={styles.cardLargeTitle}>Talk{'\n'}with Bot</Text>
                <Text style={styles.cardLargeSub}>Live 3D Voice Orb</Text>
              </View>
            </TouchableOpacity>

            {/* Stacked Right Column */}
            <View style={styles.bentoColSmall}>
              {/* Chat with Bot (Lavender) */}
              <TouchableOpacity 
                style={[styles.bentoCardSmall, { backgroundColor: '#b8a4f8' }]} 
                onPress={() => setView('chat')}
              >
                <View style={styles.cardTop}>
                  <View style={styles.iconCircleSmall}>
                    <Text style={{ fontSize: 14 }}>💬</Text>
                  </View>
                  <Text style={styles.arrowIcon}>↗</Text>
                </View>
                <Text style={styles.cardSmallTitle}>Chat with Bot</Text>
              </TouchableOpacity>

              {/* Search / Generate Image (Soft Pink) */}
              <TouchableOpacity 
                style={[styles.bentoCardSmall, { backgroundColor: '#ffb4c8' }]} 
                onPress={() => handleSend("Generate a 4K image of a futuristic neon city")}
              >
                <View style={styles.cardTop}>
                  <View style={styles.iconCircleSmall}>
                    <Text style={{ fontSize: 14 }}>🖼️</Text>
                  </View>
                  <Text style={styles.arrowIcon}>↗</Text>
                </View>
                <Text style={styles.cardSmallTitle}>Generate 4K Art</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* History Section */}
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>History</Text>
              <Text style={styles.seeAllText}>See all</Text>
            </View>

            <TouchableOpacity style={styles.historyItem} onPress={() => handleSend("I need some UI inspiration for dark theme")}>
              <View style={[styles.historyBadge, { backgroundColor: '#ccff00' }]}>
                <Text style={{ fontSize: 12 }}>🗣️</Text>
              </View>
              <Text style={styles.historyText} numberOfLines={1}>I need some UI inspiration for dark theme</Text>
              <Text style={styles.historyMenu}>⋮</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.historyItem} onPress={() => handleSend("Generate a 4K wallpaper of futuristic cyber city")}>
              <View style={[styles.historyBadge, { backgroundColor: '#b8a4f8' }]}>
                <Text style={{ fontSize: 12 }}>💬</Text>
              </View>
              <Text style={styles.historyText} numberOfLines={1}>Generate a 4K wallpaper of futuristic cyber city</Text>
              <Text style={styles.historyMenu}>⋮</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.historyItem} onPress={() => handleSend("Design ideas for mobile application interface")}>
              <View style={[styles.historyBadge, { backgroundColor: '#ffb4c8' }]}>
                <Text style={{ fontSize: 12 }}>🖼️</Text>
              </View>
              <Text style={styles.historyText} numberOfLines={1}>Design ideas for mobile application interface</Text>
              <Text style={styles.historyMenu}>⋮</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* VIEW: VOICE ORB (Matching Left Screen in Example) */}
      {view === 'voice' && (
        <View style={styles.voiceContainer}>
          <View style={styles.aiBuddyPill}>
            <Text style={styles.aiBuddyText}>AI Buddy</Text>
          </View>
          <Text style={styles.onlineText}>● Online</Text>

          {/* 3D Iridescent Orb */}
          <View style={styles.orbCircle}>
            <View style={styles.orbInnerGlow} />
          </View>

          {/* Transcript */}
          <Text style={styles.voiceTranscript}>"{voiceQuery}"</Text>

          {/* Voice Dock */}
          <View style={styles.voiceDock}>
            <TouchableOpacity style={styles.dockSquareBtn} onPress={() => setView('chat')}>
              <Text style={{ fontSize: 16 }}>⌨️</Text>
            </TouchableOpacity>

            {/* Glowing Big Neon Mic Button */}
            <TouchableOpacity 
              style={styles.bigMicBtn} 
              onPress={() => {
                setIsListening(!isListening);
                if (!isListening) {
                  setTimeout(() => handleSend(voiceQuery), 1500);
                }
              }}
            >
              <Text style={{ fontSize: 28 }}>🎙️</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.dockRoundBtn} onPress={() => setView('dashboard')}>
              <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* VIEW: CHAT & IMAGES */}
      {view === 'chat' && (
        <View style={{ flex: 1 }}>
          <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 16 }}>
            {messages.map(m => (
              <View 
                key={m.id} 
                style={[
                  styles.chatBubble, 
                  m.sender === 'user' ? styles.userChatBubble : styles.kiroChatBubble
                ]}
              >
                <Text style={styles.chatText}>{m.text}</Text>
                {m.imageUrl && (
                  <Image source={{ uri: m.imageUrl }} style={styles.chatImage} resizeMode="cover" />
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.inputDock}>
            <TouchableOpacity 
              style={styles.imageActionBtn}
              onPress={() => setInputText("Generate a 4K image of ")}
            >
              <Text style={{ fontSize: 18 }}>🖼️</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.inputField}
              placeholder="Ask Kiro or /image prompt..."
              placeholderTextColor="#8e918f"
              value={inputText}
              onChangeText={setInputText}
            />
            <TouchableOpacity style={styles.sendActionBtn} onPress={() => handleSend()}>
              <Text style={{ color: '#000', fontWeight: 'bold' }}>➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Settings Modal */}
      <Modal visible={settingsVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Kiro Settings</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Paste Gemini API key..."
              placeholderTextColor="#8e918f"
              value={apiKey}
              onChangeText={setApiKey}
            />
            <TouchableOpacity style={styles.modalSave} onPress={() => setSettingsVisible(false)}>
              <Text style={{ color: '#000', fontWeight: 'bold' }}>Save & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070707'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 99,
    backgroundColor: '#18181a',
    alignItems: 'center',
    justifyContent: 'center'
  },
  greetingHeader: {
    flex: 1,
    marginLeft: 12
  },
  greetingText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700'
  },
  tierPill: {
    backgroundColor: '#18181a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    marginRight: 8
  },
  tierText: {
    color: '#ccff00',
    fontSize: 11,
    fontWeight: '700'
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 99,
    backgroundColor: '#252528',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14
  },
  body: {
    flex: 1
  },
  heroTitle: {
    fontSize: 32,
    color: '#ffffff',
    marginBottom: 20,
    lineHeight: 38
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24
  },
  bentoCardLarge: {
    flex: 1,
    height: 220,
    borderRadius: 28,
    padding: 18,
    justifyContent: 'space-between'
  },
  bentoColSmall: {
    flex: 1,
    height: 220,
    justifyContent: 'space-between'
  },
  bentoCardSmall: {
    height: 104,
    borderRadius: 22,
    padding: 14,
    justifyContent: 'space-between'
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconCircleSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  arrowIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000'
  },
  cardLargeTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000000',
    lineHeight: 26
  },
  cardLargeSub: {
    fontSize: 11,
    color: '#000000',
    opacity: 0.75,
    marginTop: 2
  },
  cardSmallTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000'
  },
  historySection: {
    marginTop: 8
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  historyTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  seeAllText: {
    color: '#8e918f',
    fontSize: 12
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151517',
    padding: 12,
    borderRadius: 18,
    marginBottom: 8,
    gap: 12
  },
  historyBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  historyText: {
    flex: 1,
    color: '#e3e3e3',
    fontSize: 12
  },
  historyMenu: {
    color: '#8e918f',
    fontSize: 16
  },
  voiceContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 20
  },
  aiBuddyPill: {
    backgroundColor: '#ccff00',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 99
  },
  aiBuddyText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 12
  },
  onlineText: {
    color: '#ccff00',
    fontSize: 11,
    marginTop: 4
  },
  orbCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#3b82f6',
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  orbInnerGlow: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#b8d5ff',
    opacity: 0.4
  },
  voiceTranscript: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20
  },
  voiceDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24
  },
  dockSquareBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center'
  },
  bigMicBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ccff00',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10
  },
  dockRoundBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatScroll: {
    flex: 1
  },
  chatBubble: {
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
    maxWidth: '85%'
  },
  userChatBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#222226'
  },
  kiroChatBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#151517'
  },
  chatText: {
    color: '#ffffff',
    fontSize: 13,
    lineHeight: 18
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginTop: 8
  },
  inputDock: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
    backgroundColor: '#151517',
    borderRadius: 99,
    margin: 12,
    gap: 8
  },
  imageActionBtn: {
    padding: 6
  },
  inputField: {
    flex: 1,
    color: '#fff',
    fontSize: 12
  },
  sendActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: {
    backgroundColor: '#151517',
    padding: 20,
    borderRadius: 24
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12
  },
  modalInput: {
    backgroundColor: '#000',
    color: '#fff',
    padding: 10,
    borderRadius: 12,
    fontSize: 12,
    marginBottom: 16
  },
  modalSave: {
    backgroundColor: '#ccff00',
    paddingVertical: 10,
    borderRadius: 99,
    alignItems: 'center'
  }
});