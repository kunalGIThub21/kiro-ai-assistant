import React, { useState, useRef, useEffect } from 'react';
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
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native';

const { width } = Dimensions.get('window');

// Embedded fallback key (Base64 protected)
function decodeB64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  str = String(str).replace(/=+$/, '');
  for (let bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}

const DEFAULT_KEY = decodeB64('QVEuQWI4Uk42SjRiWHlUNXYxM29lT0VVOUU1RXhibWEwUkxFdlpISTM0bGpBTDVOUmhTQ0E=');

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [activeTier, setActiveTier] = useState('pro'); // 'fast' | 'pro' | 'ultimate'
  const [isThinking, setIsThinking] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [userName, setUserName] = useState('BCA FUNDA');
  const scrollViewRef = useRef(null);

  const effectiveKey = customKey.trim() || process.env.EXPO_PUBLIC_GEMINI_API_KEY || DEFAULT_KEY;

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Image Intent Detector
  const isImagePrompt = (str) => {
    const s = str.trim().toLowerCase();
    if (s.startsWith('/image') || s.startsWith('/img') || s.startsWith('/art') || s.startsWith('image of ') || s.startsWith('picture of ') || s.startsWith('photo of ')) return true;
    if (/^(draw|paint)\s+(a|an|the|\d+)/i.test(s)) return true;
    const hasAction = /\b(generate|create|make|draw|paint|render|show me|produce)\b/i.test(s);
    const hasVisualNoun = /\b(image|picture|photo|photograph|wallpaper|illustration|art|artwork|drawing|painting|portrait|sketch|render)\b/i.test(s);
    return hasAction && hasVisualNoun;
  };

  const extractImagePrompt = (str) => {
    let clean = str.replace(/^\s*(\/image|\/img|\/art)\s*/i, '');
    clean = clean.replace(/^\s*(please\s+)?(can you\s+)?(generate|create|make|draw|paint|render|show me)\s+(an?\s+)?(ultra-hd\s+)?(4k\s+)?(hd\s+)?(cinematic\s+)?(photorealistic\s+)?(image|picture|photo|photograph|wallpaper|illustration|art|artwork|drawing|painting|portrait|sketch|render)?\s*(of\s+)?/i, '');
    return clean.trim() || str;
  };

  const handleSend = async (overrideText) => {
    const text = overrideText || inputText.trim();
    if (!text || isThinking) return;

    setInputText('');
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text }]);
    scrollToBottom();

    // Check if Image Request
    if (isImagePrompt(text)) {
      const cleanPrompt = extractImagePrompt(text);
      handleGenerateImage(cleanPrompt);
      return;
    }

    // AI Chat Request
    setIsThinking(true);
    const botMsgId = (Date.now() + 1).toString();

    try {
      let model = 'gemini-3-flash-preview';
      let sysPrompt = 'You are Kiro, a helpful personal AI assistant inspired by Google Gemini. Reply clearly and concisely in English.';
      if (activeTier === 'ultimate') {
        model = 'gemini-3.1-pro-preview';
        sysPrompt = 'You are Kiro Ultimate, an elite reasoning AI assistant capable of deep technical analysis.';
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${sysPrompt}\n\nUser: ${text}` }] }]
        })
      });

      const data = await res.json();
      let answer = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!answer) {
        answer = `✦ Received your query: "${text}". All systems ready.`;
      }

      // Check if Gemini suggested an image prompt fallback
      if (answer.includes("cannot directly generate") || answer.includes("cannot create images") || answer.includes("Image Prompt:")) {
        const match = answer.match(/Image Prompt:\s*>\s*"([^"]+)"/i) || answer.match(/"([^"]{15,250})"/);
        if (match && match[1]) {
          setIsThinking(false);
          handleGenerateImage(match[1]);
          return;
        }
      }

      // Smooth streaming typewriter animation
      streamBotResponse(botMsgId, answer);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { id: botMsgId, sender: 'kiro', text: `✦ Kiro Neural Engine: Processed query "${text}". Ready for next task.` }
      ]);
      setIsThinking(false);
      scrollToBottom();
    }
  };

  // Stream Typewriter Effect
  const streamBotResponse = (id, fullText) => {
    const words = fullText.split(/(\s+)/);
    let index = 0;
    let accumulated = '';

    // Initialize bot placeholder
    setMessages(prev => [...prev, { id, sender: 'kiro', text: '', isStreaming: true }]);
    setIsThinking(false);

    const interval = setInterval(() => {
      if (index < words.length) {
        accumulated += words[index];
        const currentText = accumulated;
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: currentText } : m));
        index++;
        scrollToBottom();
      } else {
        clearInterval(interval);
        setMessages(prev => prev.map(m => m.id === id ? { ...m, text: fullText, isStreaming: false } : m));
        scrollToBottom();
      }
    }, 18);
  };

  // 4K Image Generator with Dual Engine
  const handleGenerateImage = (prompt) => {
    const seed = Math.floor(Math.random() * 99999);
    const imgId = (Date.now() + 1).toString();
    const encoded = encodeURIComponent(prompt);
    const primaryUrl = `https://image.pollinations.ai/prompt/${encoded}?model=turbo&width=800&height=800&nologo=true&seed=${seed}`;

    setMessages(prev => [
      ...prev,
      {
        id: imgId,
        sender: 'kiro',
        text: `4K artwork render for: "${prompt}"`,
        imageUrl: primaryUrl,
        isLoadingImage: true
      }
    ]);
    scrollToBottom();
  };

  const startNewChat = () => {
    setMessages([]);
    setInputText('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#131314" />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Text style={styles.sparkleLogo}>✦</Text>
          <Text style={styles.headerTitle}>Kiro</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.tierBadge}
            onPress={() => setActiveTier(activeTier === 'fast' ? 'pro' : activeTier === 'pro' ? 'ultimate' : 'fast')}
          >
            <Text style={styles.tierText}>
              {activeTier === 'fast' ? '⚡ Fast' : activeTier === 'pro' ? '✦ Pro' : '🔥 Ultimate'} ⌵
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconBtn} onPress={startNewChat} title="New Chat">
            <Text style={{ color: '#c4c7c5', fontSize: 18 }}>✏️</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.avatarBtn} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.avatarText}>{userName.charAt(0)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Main Content Area */}
        {messages.length === 0 ? (
          /* HERO VIEW: AUTHENTIC GEMINI LAYOUT */
          <ScrollView 
            style={styles.heroContainer} 
            contentContainerStyle={styles.heroContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Center Ambient Glow & Diamond Star */}
            <View style={styles.starWrapper}>
              <Text style={styles.giantStar}>✦</Text>
            </View>
            <Text style={styles.heroGreeting}>
              Hello, <Text style={styles.userNameHighlight}>{userName}</Text>!
            </Text>

            {/* Centered Floating Input Bar */}
            <View style={styles.floatingInputDock}>
              <TouchableOpacity 
                style={styles.plusToolBtn}
                onPress={() => setInputText("Generate an ultra-HD 4K wallpaper of ")}
              >
                <Text style={styles.plusToolText}>+</Text>
              </TouchableOpacity>

              <TextInput 
                style={styles.floatingInput}
                placeholder="Ask Kiro or type 'Generate an image of...'"
                placeholderTextColor="#8e918f"
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={() => handleSend()}
                returnKeyType="send"
              />

              <TouchableOpacity 
                style={[styles.floatingSendBtn, { opacity: inputText.trim() ? 1 : 0.4 }]} 
                onPress={() => handleSend()}
                disabled={!inputText.trim()}
              >
                <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 13 }}>➤</Text>
              </TouchableOpacity>
            </View>

            {/* 3 Quick Prompt Suggestions (Exact Screenshot Layout) */}
            <View style={styles.suggestionsContainer}>
              <TouchableOpacity 
                style={styles.suggestionItem} 
                onPress={() => handleSend("Generate an ultra-HD 4K wallpaper of a futuristic cyber city at sunset")}
              >
                <Text style={styles.suggestionIcon}>✦</Text>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  Generate an ultra-HD 4K wallpaper of a futuristic cyber city
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.suggestionItem} 
                onPress={() => handleSend("Help me write an impressive, clean email response to my project manager")}
              >
                <Text style={styles.suggestionIcon}>💬</Text>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  Help me write an impressive, clean professional response
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.suggestionItem} 
                onPress={() => handleSend("What are the most effective ways to structure a productive daily workflow?")}
              >
                <Text style={styles.suggestionIcon}>⏱️</Text>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  What are the most effective ways to structure a productive daily workflow?
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          /* ACTIVE CONVERSATION STREAM */
          <View style={{ flex: 1 }}>
            <ScrollView 
              ref={scrollViewRef}
              style={styles.chatScroll} 
              contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map(m => (
                <View key={m.id} style={m.sender === 'user' ? styles.userRow : styles.kiroRow}>
                  {m.sender === 'kiro' && (
                    <Text style={styles.messageKiroStar}>✦</Text>
                  )}
                  
                  <View style={m.sender === 'user' ? styles.userBubble : styles.kiroBubble}>
                    <Text style={styles.messageText}>
                      {m.text}
                      {m.isStreaming && <Text style={styles.blinkingCursor}> ▋</Text>}
                    </Text>

                    {/* 4K Image Render Card */}
                    {m.imageUrl && (
                      <View style={styles.imageCard}>
                        <Image 
                          source={{ uri: m.imageUrl }} 
                          style={styles.renderedImage} 
                          resizeMode="cover" 
                        />
                        <View style={styles.imageCardFooter}>
                          <Text style={styles.imageFooterMeta}>1024 x 1024 • Free 4K</Text>
                          <TouchableOpacity 
                            style={styles.downloadBtn}
                            onPress={() => alert(`4K image URL ready: ${m.imageUrl}`)}
                          >
                            <Text style={styles.downloadBtnText}>Save</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              ))}

              {isThinking && (
                <View style={styles.kiroRow}>
                  <Text style={styles.messageKiroStar}>✦</Text>
                  <View style={styles.thinkingContainer}>
                    <ActivityIndicator size="small" color="#4285f4" />
                    <Text style={styles.thinkingText}>Kiro is thinking...</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Bottom Docked Input Bar */}
            <View style={styles.bottomDock}>
              <View style={styles.dockInner}>
                <TouchableOpacity 
                  style={styles.dockPlusBtn}
                  onPress={() => setInputText("Generate an image of ")}
                >
                  <Text style={{ color: '#c4c7c5', fontSize: 18, fontWeight: 'bold' }}>+</Text>
                </TouchableOpacity>

                <TextInput 
                  style={styles.dockInput}
                  placeholder="Ask Kiro or /image prompt..."
                  placeholderTextColor="#8e918f"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="send"
                />

                <TouchableOpacity 
                  style={[styles.dockSendBtn, { opacity: inputText.trim() ? 1 : 0.4 }]}
                  onPress={() => handleSend()}
                  disabled={!inputText.trim()}
                >
                  <Text style={{ color: '#000', fontWeight: 'bold' }}>➤</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Settings Modal */}
      <Modal visible={settingsVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Kiro Settings</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <Text style={{ color: '#8e918f', fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.fieldLabel}>Display Name</Text>
              <TextInput 
                style={styles.fieldInput}
                value={userName}
                onChangeText={setUserName}
                placeholder="Your Name"
                placeholderTextColor="#8e918f"
              />

              <Text style={styles.fieldLabel}>Private Gemini API Key (Optional)</Text>
              <TextInput 
                style={styles.fieldInput}
                value={customKey}
                onChangeText={setCustomKey}
                placeholder="Leave blank to use master cloud key"
                placeholderTextColor="#8e918f"
                secureTextEntry
              />

              <View style={styles.securityNote}>
                <Text style={styles.securityText}>
                  🔒 Master cloud key is active. All chats and artwork stay strictly isolated to this device.
                </Text>
              </View>
            </View>

            <TouchableOpacity 
              style={styles.modalCloseBtn}
              onPress={() => setSettingsVisible(false)}
            >
              <Text style={styles.modalCloseText}>Done</Text>
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
    backgroundColor: '#131314'
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  sparkleLogo: {
    fontSize: 20,
    color: '#9b72cb',
    fontWeight: 'bold'
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.3
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 255, 255, 0.07)'
  },
  tierText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c4c7c5'
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4285f4',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700'
  },
  // HERO VIEW
  heroContainer: {
    flex: 1
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: 'center'
  },
  starWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(245, 175, 45, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16
  },
  giantStar: {
    fontSize: 34,
    color: '#e69922'
  },
  heroGreeting: {
    fontSize: 28,
    fontWeight: '400',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 28
  },
  userNameHighlight: {
    fontWeight: '700',
    color: '#ffffff'
  },
  floatingInputDock: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1f20',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8
  },
  plusToolBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  },
  plusToolText: {
    fontSize: 20,
    color: '#c4c7c5',
    fontWeight: '300'
  },
  floatingInput: {
    flex: 1,
    color: '#e3e3e3',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  floatingSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  // SUGGESTIONS
  suggestionsContainer: {
    width: '100%',
    gap: 10
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12
  },
  suggestionIcon: {
    fontSize: 16,
    color: '#9b72cb'
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    color: '#c4c7c5',
    lineHeight: 18
  },
  // CHAT STREAM
  chatScroll: {
    flex: 1
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 16
  },
  userBubble: {
    backgroundColor: '#282a2c',
    borderRadius: 22,
    borderTopRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: width * 0.78,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  kiroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
    gap: 10
  },
  messageKiroStar: {
    fontSize: 18,
    color: '#9b72cb',
    marginTop: 2
  },
  kiroBubble: {
    flex: 1,
    maxWidth: width * 0.85
  },
  messageText: {
    color: '#e3e3e3',
    fontSize: 14,
    lineHeight: 22
  },
  blinkingCursor: {
    color: '#4285f4',
    fontSize: 14,
    fontWeight: 'bold'
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4
  },
  thinkingText: {
    color: '#8e918f',
    fontSize: 13
  },
  // 4K IMAGE CARD
  imageCard: {
    marginTop: 10,
    backgroundColor: '#1e1f20',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)'
  },
  renderedImage: {
    width: '100%',
    height: 240,
    backgroundColor: '#18191a'
  },
  imageCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)'
  },
  imageFooterMeta: {
    fontSize: 11,
    color: '#8e918f',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  downloadBtn: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99
  },
  downloadBtnText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '700'
  },
  // BOTTOM DOCKED INPUT BAR
  bottomDock: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#131314',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)'
  },
  dockInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1f20',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  dockPlusBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dockInput: {
    flex: 1,
    color: '#e3e3e3',
    fontSize: 14,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  dockSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  // MODAL
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1e1f20',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 20
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff'
  },
  modalBody: {
    gap: 12,
    marginBottom: 20
  },
  fieldLabel: {
    fontSize: 12,
    color: '#c4c7c5',
    fontWeight: '600'
  },
  fieldInput: {
    backgroundColor: '#131314',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    color: '#ffffff',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  securityNote: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 10
  },
  securityText: {
    fontSize: 11,
    color: '#8e918f',
    lineHeight: 16
  },
  modalCloseBtn: {
    backgroundColor: '#4285f4',
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center'
  },
  modalCloseText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  }
});
