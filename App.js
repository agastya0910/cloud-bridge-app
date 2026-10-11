import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';

const API_URL =
  'https://9cme007lbi.execute-api.us-east-1.amazonaws.com/prod/button';

export default function App() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // =========================================================
  // GET MESSAGES FROM AWS
  // =========================================================

  const fetchMessages = async () => {
    try {
      console.log('Fetching messages from AWS...');

      const response = await fetch(API_URL, {
        method: 'GET',
      });

      const responseText = await response.text();

      console.log('GET STATUS:', response.status);
      console.log('GET RESPONSE:', responseText);

      if (!response.ok) {
        throw new Error(
          `AWS GET returned HTTP ${response.status}\n\n${responseText}`
        );
      }

      const result = JSON.parse(responseText);

      console.log('GET PARSED:', result);

      if (result.status !== 'success') {
        console.log('AWS did not return success');
        return;
      }

      if (!Array.isArray(result.messages)) {
        console.log('No messages array received');
        return;
      }

      // Convert AWS messages into our app format
      const awsMessages = result.messages.map((item, index) => {
        let direction = item.direction;

        // If Lambda gives direction, use it
        if (!direction) {
          if (item.source === 'slack') {
            direction = 'slack-to-app';
          } else {
            direction = 'app-to-slack';
          }
        }

        return {
          id:
            `${item.source || 'unknown'}-` +
            `${item.timestamp || index}-` +
            `${item.message || ''}`,

          message: item.message || 'No message',

          timestamp:
            item.timestamp_ist ||
            formatTimestamp(item.timestamp),

          source: item.source || 'unknown',

          direction: direction,

          user_id: item.user_id || '',

          channel_id: item.channel_id || '',
        };
      });

      // Remove duplicate records
      const uniqueMessages = [];

      const seen = new Set();

      for (const item of awsMessages) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          uniqueMessages.push(item);
        }
      }

      setHistory(uniqueMessages);

      console.log(
        `Loaded ${uniqueMessages.length} messages from AWS`
      );
    } catch (error) {
      console.log('FETCH MESSAGES ERROR:', error);
    }
  };

  // =========================================================
  // FORMAT TIMESTAMP
  // =========================================================

  const formatTimestamp = (timestamp) => {
    if (!timestamp) {
      return 'Unknown time';
    }

    try {
      let time = Number(timestamp);

      // DynamoDB old IoT records may have milliseconds
      // New API records use seconds
      if (time > 100000000000) {
        time = time / 1000;
      }

      const date = new Date(time * 1000);

      return date.toLocaleString();
    } catch (error) {
      return 'Unknown time';
    }
  };

  // =========================================================
  // AUTOMATIC REFRESH
  // =========================================================

  useEffect(() => {
    // Load messages immediately
    fetchMessages();

    // Refresh every 5 seconds
    const interval = setInterval(() => {
      fetchMessages();
    }, 5000);

    // Stop timer when app closes/unmounts
    return () => clearInterval(interval);
  }, []);

  // =========================================================
  // MANUAL REFRESH
  // =========================================================

  const handleRefresh = async () => {
    setRefreshing(true);

    await fetchMessages();

    setRefreshing(false);
  };

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  const sendMessage = async (msg = null) => {
    const text = msg || message;

    if (!text.trim()) {
      Alert.alert('Error', 'Please enter a message');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          button_id: 'CloudBridge-Mobile-App',
          message: text,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      });

      const responseText = await response.text();

      console.log('POST STATUS:', response.status);
      console.log('AWS RAW RESPONSE:', responseText);

      // Check HTTP error
      if (!response.ok) {
        throw new Error(
          `AWS returned HTTP ${response.status}\n\n${responseText}`
        );
      }

      let result;

      try {
        result = JSON.parse(responseText);
      } catch (error) {
        throw new Error(
          `AWS returned an invalid response:\n\n${responseText}`
        );
      }

      console.log('AWS PARSED RESPONSE:', result);

      // Normal Lambda response
      let success = result.status === 'success';

      // API Gateway response
      if (!success && result.body) {
        try {
          const body =
            typeof result.body === 'string'
              ? JSON.parse(result.body)
              : result.body;

          console.log('AWS BODY:', body);

          if (body.status === 'success') {
            success = true;
          }
        } catch (error) {
          console.log(
            'Could not parse AWS body:',
            result.body
          );
        }
      }

      // =====================================================
      // SUCCESS
      // =====================================================

      if (success) {
        setMessage('');

        Alert.alert(
          '✅ Success',
          'Message sent and stored!'
        );

        // Wait briefly for DynamoDB to contain the new item,
        // then refresh the history.
        setTimeout(() => {
          fetchMessages();
        }, 1000);
      } else {
        Alert.alert(
          '❌ AWS Error',
          `The request reached AWS, but AWS did not return success.\n\nResponse:\n${responseText}`
        );
      }
    } catch (error) {
      console.log('SEND ERROR:', error);

      Alert.alert(
        '❌ Send Failed',
        error.message ||
          'Something went wrong while sending the message.'
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // MESSAGE LABEL
  // =========================================================

  const getDirectionLabel = (item) => {
    if (
      item.source === 'slack' ||
      item.direction === 'slack-to-app'
    ) {
      return '💬 Slack → App';
    }

    if (
      item.direction === 'app-to-slack' ||
      item.source === 'api-gateway'
    ) {
      return '📱 App → Slack';
    }

    if (item.source === 'iot-core') {
      return '⚡ IoT → App';
    }

    return '📡 AWS';
  };

  // =========================================================
  // MESSAGE STATUS
  // =========================================================

  const getStatusText = (item) => {
    if (
      item.source === 'slack' ||
      item.direction === 'slack-to-app'
    ) {
      return '📥 Received from Slack';
    }

    if (
      item.direction === 'app-to-slack' ||
      item.source === 'api-gateway'
    ) {
      return '📤 Sent from App';
    }

    if (item.source === 'iot-core') {
      return '⚡ Received from IoT';
    }

    return '☁️ AWS Record';
  };

  // =========================================================
  // UI
  // =========================================================

  return (
    <View style={styles.container}>

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>
          🌉 Pulsnova
        </Text>

        <Text style={styles.subtitle}>
          Mobile Control
        </Text>

        <Text style={styles.connection}>
          🟢 AWS Connected
        </Text>
      </View>

      <ScrollView
        style={styles.content}

        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
      >

        {/* SEND MESSAGE */}
        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            📝 Send Message
          </Text>

          <TextInput
            style={styles.input}

            placeholder="Type your message..."

            placeholderTextColor="#888"

            value={message}

            onChangeText={setMessage}

            editable={!loading}

            multiline
          />

          <TouchableOpacity
            style={[
              styles.btn,
              loading && styles.btnDisabled,
            ]}

            onPress={() => sendMessage()}

            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading
                ? '⏳ Sending...'
                : '📤 Send'}
            </Text>
          </TouchableOpacity>

        </View>

        {/* QUICK COMMANDS */}
        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            ⚡ Quick Commands
          </Text>

          <View style={styles.grid}>

            <TouchableOpacity
              style={styles.quickBtn}

              onPress={() =>
                sendMessage(
                  'Check system status'
                )
              }
            >
              <Text style={styles.quickBtnText}>
                📊 Status
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}

              onPress={() =>
                sendMessage(
                  'Alert - High temperature'
                )
              }
            >
              <Text style={styles.quickBtnText}>
                🔥 Alert
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}

              onPress={() =>
                sendMessage(
                  'Start monitoring'
                )
              }
            >
              <Text style={styles.quickBtnText}>
                👁️ Monitor
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}

              onPress={() =>
                sendMessage(
                  'Good morning'
                )
              }
            >
              <Text style={styles.quickBtnText}>
                🌅 Morning
              </Text>
            </TouchableOpacity>

          </View>

        </View>

        {/* HISTORY */}
        <View style={styles.section}>

          <View style={styles.historyHeader}>

            <Text style={styles.sectionTitle}>
              📜 Messages ({history.length})
            </Text>

            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefresh}
            >
              <Text style={styles.refreshText}>
                🔄
              </Text>
            </TouchableOpacity>

          </View>

          {history.length === 0 ? (

            <Text style={styles.emptyText}>
              No messages yet...
            </Text>

          ) : (

            history
              .slice(0, 20)
              .map((item, idx) => (

                <View
                  key={item.id || idx}
                  style={[
                    styles.historyItem,

                    item.source === 'slack' ||
                    item.direction === 'slack-to-app'
                      ? styles.slackItem
                      : styles.appItem,
                  ]}
                >

                  {/* DIRECTION */}
                  <Text style={styles.directionText}>
                    {getDirectionLabel(item)}
                  </Text>

                  {/* TIME */}
                  <Text style={styles.historyTime}>
                    🕐 {item.timestamp}
                  </Text>

                  {/* MESSAGE */}
                  <Text style={styles.historyMessage}>
                    {item.message}
                  </Text>

                  {/* STATUS */}
                  <Text style={styles.historyStatus}>
                    {getStatusText(item)}
                  </Text>

                </View>

              ))

          )}

        </View>

      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>

        <Text style={styles.footerText}>
          CloudBridge v1.0 • Connected to AWS
        </Text>

        <Text style={styles.footerSubtext}>
          Auto-refresh: 5 seconds
        </Text>

      </View>

    </View>
  );
}

// =========================================================
// STYLES
// =========================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  header: {
    backgroundColor: '#16213e',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 5,
  },

  subtitle: {
    fontSize: 14,
    color: '#aaa',
  },

  connection: {
    fontSize: 12,
    color: '#00ff88',
    marginTop: 8,
  },

  content: {
    flex: 1,
    padding: 15,
  },

  section: {
    backgroundColor: '#16213e',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 12,
  },

  input: {
    backgroundColor: '#0f3460',
    color: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#00d4ff',
    minHeight: 60,
    textAlignVertical: 'top',
  },

  btn: {
    backgroundColor: '#00d4ff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },

  btnDisabled: {
    opacity: 0.5,
  },

  btnText: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#000',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  quickBtn: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#0f3460',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00d4ff',
  },

  quickBtnText: {
    color: '#00d4ff',
    fontWeight: '600',
    fontSize: 12,
  },

  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  refreshButton: {
    backgroundColor: '#0f3460',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },

  refreshText: {
    fontSize: 18,
  },

  historyItem: {
    backgroundColor: '#0f3460',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
  },

  appItem: {
    borderLeftColor: '#00d4ff',
  },

  slackItem: {
    borderLeftColor: '#00ff88',
  },

  directionText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 6,
  },

  historyTime: {
    fontSize: 11,
    color: '#888',
    marginBottom: 6,
  },

  historyMessage: {
    fontSize: 14,
    color: '#e0e0e0',
    marginBottom: 7,
  },

  historyStatus: {
    fontSize: 12,
    color: '#00ff88',
  },

  emptyText: {
    color: '#888',
    textAlign: 'center',
    paddingVertical: 20,
  },

  footer: {
    backgroundColor: '#0f3460',
    padding: 12,
  },

  footerText: {
    color: '#888',
    textAlign: 'center',
    fontSize: 12,
  },

  footerSubtext: {
    color: '#666',
    textAlign: 'center',
    fontSize: 10,
    marginTop: 3,
  },

});