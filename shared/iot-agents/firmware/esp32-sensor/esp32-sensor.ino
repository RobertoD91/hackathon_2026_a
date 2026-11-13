// esp32-sensor: legge temperatura, luce e un pulsante e invia al hub
// POST /api/readings con il JSON del contratto (shared/iot-agents/CONTRATTO.md, sezione 1).
//
// - invio periodico ogni SEND_INTERVAL_MS con button: false;
// - alla pressione del pulsante invio immediato con button: true;
// - ts in ms epoch se l'ora NTP è sincronizzata, altrimenti omesso (lo mette il server).
//
// Configurazione in config.h (copia config.example.h). Vedi README.md per cablaggio e librerie.

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <sys/time.h>
#include <math.h>

// Valori ammessi per le opzioni di config.h
#define TEMP_NONE     0
#define TEMP_DHT22    1
#define TEMP_DS18B20  2
#define LIGHT_NONE    0
#define LIGHT_BH1750  1
#define LIGHT_LDR     2
#define NET_WIFI      1
#define NET_CELLULAR  2

#if __has_include("config.h")
#include "config.h"
#else
#error "Manca config.h: copia config.example.h in config.h e inserisci Wi-Fi, HUB_URL e DEVICE_ID"
#endif

#define FW_VERSION "0.1.0"

#if TEMP_SENSOR == TEMP_DHT22
#include <DHT.h>
DHT dht(DHT_PIN, DHT22);
#elif TEMP_SENSOR == TEMP_DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
#endif

#if LIGHT_SENSOR == LIGHT_BH1750
#include <Wire.h>
#include <BH1750.h>
BH1750 lightMeter;
bool bh1750Ok = false;
#endif

// ------------------------------------------------------------------ rete
// Punto di estensione per il 5G: implementa queste tre funzioni per il modem
// (vedi README, sezione "5G"). Il resto del firmware non cambia.

#if NET_MODE == NET_WIFI

bool netBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[net] connessione a %s", WIFI_SSID);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[net] Wi-Fi non connesso, riprovo più tardi");
    return false;
  }
  Serial.printf("[net] connesso, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

bool netConnected() { return WiFi.status() == WL_CONNECTED; }

int netSignal() { return WiFi.RSSI(); }

#elif NET_MODE == NET_CELLULAR
#error "NET_CELLULAR non ancora implementato: usa NET_WIFI con l'hotspot 5G (vedi README)"
// Traccia per il modem 5G (es. con la libreria TinyGSM):
//   bool netBegin()     → accendi il modem, modem.gprsConnect(APN), restituisci true se connesso
//   bool netConnected() → modem.isGprsConnected()
//   int  netSignal()    → modem.getSignalQuality()
// e in postJson() usa TinyGsmClient + ArduinoHttpClient al posto di HTTPClient.
#endif

// ------------------------------------------------------------------ ora (NTP)

void timeBegin() { configTime(0, 0, "pool.ntp.org", "time.google.com"); }

// true se l'ora è sincronizzata; scrive i millisecondi epoch come testo in buf.
bool epochMsString(char *buf, size_t len) {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec < 1700000000) return false;  // non ancora sincronizzata
  snprintf(buf, len, "%lu%03lu", (unsigned long)tv.tv_sec, (unsigned long)(tv.tv_usec / 1000));
  return true;
}

// ------------------------------------------------------------------ sensori

void sensorsBegin() {
#if TEMP_SENSOR == TEMP_DHT22
  dht.begin();
#elif TEMP_SENSOR == TEMP_DS18B20
  ds18b20.begin();
#endif
#if LIGHT_SENSOR == LIGHT_BH1750
  Wire.begin(I2C_SDA, I2C_SCL);
  bh1750Ok = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
  if (!bh1750Ok) Serial.println("[sensori] BH1750 non trovato: controlla SDA/SCL e indirizzo 0x23");
#elif LIGHT_SENSOR == LIGHT_LDR
  analogReadResolution(12);
#endif
#if BUTTON_PIN >= 0
  pinMode(BUTTON_PIN, INPUT_PULLUP);
#endif
#if LED_PIN >= 0
  pinMode(LED_PIN, OUTPUT);
#endif
}

float readTemperature() {
#if TEMP_SENSOR == TEMP_DHT22
  return dht.readTemperature();
#elif TEMP_SENSOR == TEMP_DS18B20
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  return t == DEVICE_DISCONNECTED_C ? NAN : t;
#else
  return NAN;
#endif
}

float readHumidity() {
#if TEMP_SENSOR == TEMP_DHT22
  return dht.readHumidity();
#else
  return NAN;
#endif
}

float readLux() {
#if LIGHT_SENSOR == LIGHT_BH1750
  if (!bh1750Ok) return NAN;
  float lux = lightMeter.readLightLevel();
  return lux < 0 ? NAN : lux;
#elif LIGHT_SENSOR == LIGHT_LDR
  float v = analogRead(LDR_PIN) / 4095.0f;
  if (LDR_INVERT) v = 1.0f - v;
  return v * LDR_LUX_AT_MAX;
#else
  return NAN;
#endif
}

// ------------------------------------------------------------------ JSON e invio

// Aggiunge "chiave":valore se il valore è valido (i sensori in errore restituiscono NAN).
void appendNumber(String &s, const char *key, float value, int decimals, bool &first) {
  if (isnan(value)) return;
  if (!first) s += ',';
  first = false;
  s += '"';
  s += key;
  s += "\":";
  s += String(value, decimals);
}

String buildReading(bool button) {
  String s;
  s.reserve(400);
  s += "{\"deviceId\":\"" DEVICE_ID "\"";
  char ts[24];
  if (epochMsString(ts, sizeof(ts))) {
    s += ",\"ts\":";
    s += ts;
  }
  s += ",\"location\":{\"lat\":";
  s += String(LOCATION_LAT, 6);
  s += ",\"lon\":";
  s += String(LOCATION_LON, 6);
  s += ",\"zone\":\"" LOCATION_ZONE "\"}";

  s += ",\"readings\":{";
  bool first = true;
  appendNumber(s, "temperature_c", readTemperature(), 1, first);
  appendNumber(s, "humidity_pct", readHumidity(), 0, first);
  appendNumber(s, "light_lux", readLux(), 0, first);
#if BUTTON_PIN >= 0
  if (!first) s += ',';
  first = false;
  s += button ? "\"button\":true" : "\"button\":false";
#endif
  if (first) {  // nessun sensore configurato: almeno un valore, il contratto vuole readings non vuoto
    s += "\"uptime_s\":";
    s += String((unsigned long)(millis() / 1000));
  }
  s += '}';

  s += ",\"meta\":{\"fw\":\"" FW_VERSION "\",\"net\":\"" NET_LABEL "\",\"simulated\":false,\"rssi\":";
  s += String(netSignal());
  s += '}';
  s += '}';
  return s;
}

// Restituisce il codice HTTP (202 = accettata) o un numero negativo in caso di errore di rete.
int postJson(const String &path, const String &body) {
  HTTPClient http;
  String url = String(HUB_URL) + path;
  WiFiClientSecure secure;
  bool ok;
  if (url.startsWith("https://")) {
    if (HUB_INSECURE_TLS) secure.setInsecure();
    ok = http.begin(secure, url);
  } else {
    ok = http.begin(url);
  }
  if (!ok) return -100;
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(HUB_TOKEN) > 0) http.addHeader("Authorization", String("Bearer ") + HUB_TOKEN);
  int code = http.POST(body);
  if (code != 202) Serial.printf("[hub] risposta %d: %s\n", code, code > 0 ? http.getString().c_str() : http.errorToString(code).c_str());
  http.end();
  return code;
}

void blink() {
#if LED_PIN >= 0
  digitalWrite(LED_PIN, HIGH);
  delay(40);
  digitalWrite(LED_PIN, LOW);
#endif
}

bool sendReading(bool button) {
  if (!netConnected() && !netBegin()) return false;
  String body = buildReading(button);
  Serial.printf("[hub] POST /api/readings %s\n", body.c_str());
  int code = postJson("/api/readings", body);
  if (code == 202) blink();
  return code == 202;
}

// ------------------------------------------------------------------ setup e loop

unsigned long lastSend = 0;
int lastButton = HIGH;
unsigned long lastButtonChange = 0;

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[esp32-sensor %s] %s → %s\n", FW_VERSION, DEVICE_ID, HUB_URL);
  sensorsBegin();
  netBegin();
  timeBegin();
#if TEMP_SENSOR == TEMP_DHT22
  delay(2000);  // il DHT22 vuole ~2 s dopo l'accensione
#endif
}

void loop() {
#if BUTTON_PIN >= 0
  int b = digitalRead(BUTTON_PIN);
  if (b != lastButton && millis() - lastButtonChange > 50) {  // antirimbalzo
    lastButtonChange = millis();
    lastButton = b;
    if (b == LOW) {
      Serial.println("[pulsante] premuto: invio immediato");
      sendReading(true);
      lastSend = millis();
    }
  }
#endif
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    sendReading(false);
  }
  delay(10);
}
