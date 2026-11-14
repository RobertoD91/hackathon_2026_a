// TwinCiro — nodo ESP32 del plastico (Arduino core 3.x)
//
// Un solo firmware, due ruoli scelti DOPO il flash dal portale Wi-Fi:
//  - "semaforo": segue napoli/semafori/<id>/stato dal gemello/agenti; se per 5 s non arriva nulla
//    passa ai RIFLESSI (ciclo locale) e si coordina con i vicini in ESP-NOW (onda verde senza rete);
//  - "sensore": conta i passaggi davanti a un sensore IR e pubblica napoli/sensori/<id>/persone.
//
// Configurazione (Wi-Fi, broker MQTT, ruolo, id, zona...): al primo avvio l'ESP32 apre la rete
// "TwinCiro-XXXXXX" (password "twinciro"); collegati col telefono e compila il modulo.
// Per riconfigurare: tieni premuto il pulsante BOOT per 3 s, oppure scrivi "reset" sul monitor seriale.
//
// Librerie: WiFiManager (tzapu), PubSubClient (Nick O'Leary), ArduinoJson 7.x.
// Schede: ESP32, ESP32-S3, ESP32-C3 (pin di default sotto). Non ancora provato su hardware.

#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#if __has_include("versione.h")
#include "versione.h"
#endif
#ifndef TWINCIRO_VERSIONE
#define TWINCIRO_VERSIONE "dev"
#endif

// Tipi usati nei prototipi generati da Arduino: vanno dichiarati in cima.
enum Colore { ROSSO = 0, GIALLO = 1, VERDE = 2 };

// ---------------- pin per tipo di chip ----------------
#if defined(CONFIG_IDF_TARGET_ESP32S3)
const int PIN_A[3] = {4, 5, 6};      // testa A: rosso, giallo, verde
const int PIN_B[3] = {7, 15, 16};    // testa B
const int PIN_PULSANTE = 0;
const int PIN_SENSORE = 1;
const int PIN_LED = 2;
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
const int PIN_A[3] = {2, 3, 4};
const int PIN_B[3] = {5, 6, 7};
const int PIN_PULSANTE = 9;          // BOOT sulle schede C3
const int PIN_SENSORE = 10;
const int PIN_LED = 8;
#else                                // ESP32 classico (DevKit)
const int PIN_A[3] = {16, 17, 18};
const int PIN_B[3] = {19, 21, 22};
const int PIN_PULSANTE = 0;          // BOOT
const int PIN_SENSORE = 34;          // solo ingresso
const int PIN_LED = 2;
#endif

// ---------------- configurazione salvata ----------------
struct Config {
  String ruolo = "semaforo";        // semaforo | sensore
  String id = "mergellina";         // incrocio (semaforo) o nome del nodo (sensore)
  String zona = "rotonda_diaz";     // solo sensore
  String mqttHost = "192.168.50.10";
  int mqttPorta = 1883;
  String mqttUtente = "";
  String mqttPassword = "";
  bool capofila = false;            // semaforo: dà il tempo agli altri in modalità riflesso
  long offsetOnda = 0;              // semaforo: ritardo dell'onda verde (ms)
  int moltiplicatore = 200;         // sensore: persone vere per ogni passaggio contato
} cfg;

Preferences prefs;
WiFiClient wifi;
PubSubClient mqtt(wifi);
String idChip;

void caricaConfig() {
  prefs.begin("twinciro", true);
  cfg.ruolo = prefs.getString("ruolo", cfg.ruolo);
  cfg.id = prefs.getString("id", cfg.id);
  cfg.zona = prefs.getString("zona", cfg.zona);
  cfg.mqttHost = prefs.getString("host", cfg.mqttHost);
  cfg.mqttPorta = prefs.getInt("porta", cfg.mqttPorta);
  cfg.mqttUtente = prefs.getString("utente", cfg.mqttUtente);
  cfg.mqttPassword = prefs.getString("password", cfg.mqttPassword);
  cfg.capofila = prefs.getBool("capofila", cfg.capofila);
  cfg.offsetOnda = prefs.getLong("offset", cfg.offsetOnda);
  cfg.moltiplicatore = prefs.getInt("molt", cfg.moltiplicatore);
  prefs.end();
}

void salvaConfig() {
  prefs.begin("twinciro", false);
  prefs.putString("ruolo", cfg.ruolo);
  prefs.putString("id", cfg.id);
  prefs.putString("zona", cfg.zona);
  prefs.putString("host", cfg.mqttHost);
  prefs.putInt("porta", cfg.mqttPorta);
  prefs.putString("utente", cfg.mqttUtente);
  prefs.putString("password", cfg.mqttPassword);
  prefs.putBool("capofila", cfg.capofila);
  prefs.putLong("offset", cfg.offsetOnda);
  prefs.putInt("molt", cfg.moltiplicatore);
  prefs.end();
}

void stampaConfig() {
  Serial.printf("TwinCiro nodo %s (chip %s)\n", TWINCIRO_VERSIONE, idChip.c_str());
  Serial.printf("  ruolo=%s id=%s zona=%s\n", cfg.ruolo.c_str(), cfg.id.c_str(), cfg.zona.c_str());
  Serial.printf("  mqtt=%s:%d utente=%s\n", cfg.mqttHost.c_str(), cfg.mqttPorta, cfg.mqttUtente.c_str());
  Serial.printf("  capofila=%d offset=%ld moltiplicatore=%d\n", cfg.capofila, cfg.offsetOnda, cfg.moltiplicatore);
  Serial.printf("  wifi=%s ip=%s\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
}

void cancellaTutto() {
  Serial.println("Cancello la configurazione e riavvio nel portale...");
  prefs.begin("twinciro", false);
  prefs.clear();
  prefs.end();
  WiFiManager wm;
  wm.resetSettings();
  delay(500);
  ESP.restart();
}

// ---------------- portale di configurazione ----------------
void portale(bool forza) {
  WiFiManager wm;
  char porta[8], offset[12], molt[8];
  snprintf(porta, sizeof(porta), "%d", cfg.mqttPorta);
  snprintf(offset, sizeof(offset), "%ld", cfg.offsetOnda);
  snprintf(molt, sizeof(molt), "%d", cfg.moltiplicatore);
  WiFiManagerParameter pRuolo("ruolo", "Ruolo: semaforo oppure sensore", cfg.ruolo.c_str(), 12);
  WiFiManagerParameter pId("id", "Id (incrocio: mergellina, chiaia_sanpasquale, chiaia_portico, vittoria_acton; oppure nome del sensore)", cfg.id.c_str(), 40);
  WiFiManagerParameter pZona("zona", "Zona del sensore (mergellina, rotonda_diaz, piazza_vittoria, castel_ovo, municipio, beverello, vomero)", cfg.zona.c_str(), 24);
  WiFiManagerParameter pHost("host", "Broker MQTT (IP o nome)", cfg.mqttHost.c_str(), 64);
  WiFiManagerParameter pPorta("porta", "Porta MQTT", porta, 7);
  WiFiManagerParameter pUtente("utente", "Utente MQTT (vuoto se anonimo)", cfg.mqttUtente.c_str(), 40);
  WiFiManagerParameter pPassword("password", "Password MQTT", cfg.mqttPassword.c_str(), 64);
  WiFiManagerParameter pCapofila("capofila", "Semaforo capofila dell'onda verde (1 = sì)", cfg.capofila ? "1" : "0", 2);
  WiFiManagerParameter pOffset("offset", "Ritardo dell'onda verde in ms (es. 0, 6000, 12000)", offset, 10);
  WiFiManagerParameter pMolt("molt", "Persone vere per ogni passaggio (sensore)", molt, 6);
  for (WiFiManagerParameter* p : {&pRuolo, &pId, &pZona, &pHost, &pPorta, &pUtente, &pPassword, &pCapofila, &pOffset, &pMolt}) {
    wm.addParameter(p);
  }
  bool salvare = false;
  wm.setSaveParamsCallback([&salvare]() { salvare = true; });
  wm.setSaveConfigCallback([&salvare]() { salvare = true; });
  wm.setConfigPortalTimeout(300);
  wm.setTitle("TwinCiro");
  String ap = "TwinCiro-" + idChip;
  bool ok = forza ? wm.startConfigPortal(ap.c_str(), "twinciro") : wm.autoConnect(ap.c_str(), "twinciro");
  if (salvare) {
    cfg.ruolo = String(pRuolo.getValue()) == "sensore" ? "sensore" : "semaforo";
    cfg.id = pId.getValue();
    cfg.zona = pZona.getValue();
    cfg.mqttHost = pHost.getValue();
    cfg.mqttPorta = atoi(pPorta.getValue()) > 0 ? atoi(pPorta.getValue()) : 1883;
    cfg.mqttUtente = pUtente.getValue();
    cfg.mqttPassword = pPassword.getValue();
    cfg.capofila = String(pCapofila.getValue()) == "1";
    cfg.offsetOnda = atol(pOffset.getValue());
    cfg.moltiplicatore = atoi(pMolt.getValue()) > 0 ? atoi(pMolt.getValue()) : 200;
    salvaConfig();
    Serial.println("Configurazione salvata");
    if (forza) {  // riconfigurazione a nodo avviato: riparte pulito con i nuovi valori
      delay(500);
      ESP.restart();
    }
  }
  if (!ok) {
    Serial.println("Wi-Fi non configurato: riavvio");
    delay(1000);
    ESP.restart();
  }
}

// ---------------- MQTT ----------------
String topicNodo() { return "napoli/nodi/" + cfg.id + "/stato"; }

void pubblicaStato(bool online) {
  JsonDocument doc;
  doc["online"] = online;
  doc["ruolo"] = cfg.ruolo;
  doc["zona"] = cfg.zona;
  doc["versione"] = TWINCIRO_VERSIONE;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  char buf[200];
  serializeJson(doc, buf, sizeof(buf));
  mqtt.publish(topicNodo().c_str(), buf, true);
}

// ---------------- semaforo ----------------
uint32_t ultimoComando = 0;
bool inRiflesso = false;
int32_t correzioneCiclo = 0;
uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
const uint32_t RIFLESSO_DOPO_MS = 5000;
const uint32_t FASI_MS[6] = {20000, 3000, 1000, 15000, 3000, 1000};  // A verde, A giallo, rosso, B verde, B giallo, rosso

struct __attribute__((packed)) Battito {
  char tipo[4];
  uint32_t ciclo_ms;
};

uint32_t durataCiclo() {
  uint32_t t = 0;
  for (int i = 0; i < 6; i++) t += FASI_MS[i];
  return t;
}

Colore daTesto(const char* s) {
  if (!s) return ROSSO;
  if (strcmp(s, "verde") == 0) return VERDE;
  if (strcmp(s, "giallo") == 0) return GIALLO;
  return ROSSO;
}

void accendi(const int pin[3], Colore c) {
  for (int i = 0; i < 3; i++) digitalWrite(pin[i], i == c ? HIGH : LOW);
}

void mostra(Colore a, Colore b) {
  accendi(PIN_A, a);
  accendi(PIN_B, b);
}

void suEspNow(const esp_now_recv_info_t* info, const uint8_t* dati, int len) {
  if (cfg.capofila || len != sizeof(Battito)) return;
  Battito b;
  memcpy(&b, dati, sizeof(b));
  if (strncmp(b.tipo, "C5S", 3) != 0) return;
  uint32_t totale = durataCiclo();
  correzioneCiclo = (int32_t)((b.ciclo_ms + totale - (cfg.offsetOnda % totale)) % totale) - (int32_t)(millis() % totale);
}

void cicloLocale() {
  uint32_t totale = durataCiclo();
  uint32_t pos = (uint32_t)(((int64_t)millis() + correzioneCiclo + totale) % totale);
  uint32_t acc = 0;
  int fase = 0;
  for (; fase < 5; fase++) {
    acc += FASI_MS[fase];
    if (pos < acc) break;
  }
  const Colore a[6] = {VERDE, GIALLO, ROSSO, ROSSO, ROSSO, ROSSO};
  const Colore b[6] = {ROSSO, ROSSO, ROSSO, VERDE, GIALLO, ROSSO};
  mostra(a[fase], b[fase]);
  static uint32_t ultimoBattito = 0;
  if (cfg.capofila && millis() - ultimoBattito > 1000) {
    ultimoBattito = millis();
    Battito bt = {{'C', '5', 'S', 0}, pos};
    esp_now_send(BROADCAST, (uint8_t*)&bt, sizeof(bt));
  }
}

void avviaEspNow() {
  if (esp_now_init() != ESP_OK) return;
  esp_now_register_recv_cb(suEspNow);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;  // stesso canale del Wi-Fi: tutti i nodi sullo stesso router
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void loopSemaforo() {
  if (millis() - ultimoComando > RIFLESSO_DOPO_MS) {
    if (!inRiflesso) {
      inRiflesso = true;
      Serial.println("Nessun piano dagli agenti: modalità riflesso (ciclo locale + ESP-NOW)");
      if (mqtt.connected()) {
        String t = "napoli/semafori/" + cfg.id + "/riflesso";
        mqtt.publish(t.c_str(), "{\"modalita\":\"riflesso\"}");
      }
    }
    cicloLocale();
  }
}

// ---------------- sensore ----------------
const int FINESTRA = 30;  // 30 caselle da 2 s = 1 minuto
uint16_t caselle[FINESTRA] = {0};
int casella = 0;

void loopSensore() {
  static bool prima = HIGH;
  bool ora = digitalRead(PIN_SENSORE);
  if (prima == HIGH && ora == LOW) {  // fronte di discesa = un passaggio
    caselle[casella]++;
    digitalWrite(PIN_LED, HIGH);
  } else if (ora == HIGH) {
    digitalWrite(PIN_LED, LOW);
  }
  prima = ora;
  static uint32_t ultimo = 0;
  if (millis() - ultimo >= 2000) {
    ultimo = millis();
    int totale = 0;
    for (int i = 0; i < FINESTRA; i++) totale += caselle[i];
    if (mqtt.connected()) {
      JsonDocument doc;
      doc["zona"] = cfg.zona;
      doc["valore"] = totale;
      doc["moltiplicatore"] = cfg.moltiplicatore;
      char buf[128];
      serializeJson(doc, buf, sizeof(buf));
      String topic = "napoli/sensori/" + cfg.id + "/persone";
      mqtt.publish(topic.c_str(), buf);
    }
    casella = (casella + 1) % FINESTRA;
    caselle[casella] = 0;
  }
}

// ---------------- comune ----------------
void ricevuto(char* topic, byte* payload, unsigned int len) {
  if (cfg.ruolo != "semaforo") return;
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  mostra(daTesto(doc["a"]), daTesto(doc["b"]));
  ultimoComando = millis();
  if (inRiflesso) {
    inRiflesso = false;
    Serial.println("Torno a seguire gli agenti");
  }
}

void connettiMqtt() {
  static uint32_t ultimoTentativo = 0;
  if (mqtt.connected() || millis() - ultimoTentativo < 3000) return;
  ultimoTentativo = millis();
  String clientId = "twinciro-" + cfg.ruolo + "-" + cfg.id + "-" + idChip;
  const char* utente = cfg.mqttUtente.length() ? cfg.mqttUtente.c_str() : nullptr;
  const char* password = cfg.mqttPassword.length() ? cfg.mqttPassword.c_str() : nullptr;
  String lwt = topicNodo();
  if (mqtt.connect(clientId.c_str(), utente, password, lwt.c_str(), 0, true, "{\"online\":false}")) {
    Serial.println("MQTT connesso");
    pubblicaStato(true);
    if (cfg.ruolo == "semaforo") {
      String t = "napoli/semafori/" + cfg.id + "/stato";
      mqtt.subscribe(t.c_str());
    }
  } else {
    Serial.printf("MQTT non connesso (stato %d)\n", mqtt.state());
  }
}

void comandiSeriali() {
  static String riga;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      riga.trim();
      if (riga == "reset") cancellaTutto();
      else if (riga == "stato") stampaConfig();
      else if (riga == "portale") portale(true);
      else if (riga.length()) Serial.println("Comandi: stato, portale, reset");
      riga = "";
    } else if (riga.length() < 40) {
      riga += c;
    }
  }
}

void pulsante() {
  static uint32_t premutoDa = 0;
  static bool inviato = false;
  if (digitalRead(PIN_PULSANTE) == LOW) {
    if (!premutoDa) premutoDa = millis();
    if (millis() - premutoDa > 3000) {
      Serial.println("Pulsante tenuto 3 s: apro il portale di configurazione");
      portale(true);
      premutoDa = 0;
    }
  } else {
    // pressione breve sul semaforo: "arriva un pullman turistico"
    if (premutoDa && millis() - premutoDa > 50 && millis() - premutoDa < 1000 && !inviato && mqtt.connected() &&
        cfg.ruolo == "semaforo") {
      mqtt.publish("napoli/eventi/manuale",
                   "{\"evento\":\"pullman_turistico\",\"veicoli\":25,\"da\":\"est_in\",\"a\":\"ovest_out\"}");
    }
    premutoDa = 0;
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  uint64_t mac = ESP.getEfuseMac();
  char buf[8];
  snprintf(buf, sizeof(buf), "%06X", (uint32_t)(mac >> 24) & 0xFFFFFF);
  idChip = buf;
  for (int i = 0; i < 3; i++) {
    pinMode(PIN_A[i], OUTPUT);
    pinMode(PIN_B[i], OUTPUT);
  }
  pinMode(PIN_PULSANTE, INPUT_PULLUP);
  pinMode(PIN_SENSORE, INPUT);
  pinMode(PIN_LED, OUTPUT);
  caricaConfig();
  Serial.printf("\nTwinCiro nodo %s · chip %s · ruolo %s\n", TWINCIRO_VERSIONE, idChip.c_str(), cfg.ruolo.c_str());

  if (cfg.ruolo == "semaforo") mostra(GIALLO, GIALLO);
  WiFi.mode(WIFI_STA);
  portale(false);  // si collega al Wi-Fi salvato, oppure apre il portale
  stampaConfig();
  if (cfg.ruolo == "semaforo") avviaEspNow();
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPorta);
  mqtt.setCallback(ricevuto);
  mqtt.setBufferSize(512);
}

void loop() {
  comandiSeriali();
  pulsante();
  if (WiFi.status() == WL_CONNECTED) {
    connettiMqtt();
    mqtt.loop();
    static uint32_t ultimoStato = 0;
    if (mqtt.connected() && millis() - ultimoStato > 60000) {
      ultimoStato = millis();
      pubblicaStato(true);
    }
  }
  if (cfg.ruolo == "semaforo") loopSemaforo();
  else loopSensore();
  delay(10);
}
