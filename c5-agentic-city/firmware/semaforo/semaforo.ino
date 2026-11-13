// Semaforo del plastico — ESP32 (Arduino core 3.x)
//
// Due livelli, come il "sistema nervoso" della città:
//  - CERVELLO: segue lo stato che il gemello/gli agenti pubblicano su MQTT
//      napoli/semafori/<INCROCIO>/stato  {"a":"verde","b":"rosso","nome":"..."}
//  - RIFLESSI: se per RIFLESSO_DOPO_MS non arriva nulla (rete o broker giù) va avanti da solo
//      con un ciclo locale; i semafori vicini si coordinano in ESP-NOW (onda verde) senza rete.
//
// Hardware: 2 teste (A = via principale, B = traversa), 3 LED ciascuna (o moduli semaforo
// da 5 V con resistenze già montate). Pulsante opzionale: "arriva un pullman turistico".
//
// Librerie: PubSubClient (Nick O'Leary), ArduinoJson (Benoit Blanchon) 7.x.
// Compila con il core esp32 3.3.12; NON ANCORA PROVATO SU HARDWARE.

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ---------------- configurazione ----------------
const char* WIFI_SSID = "napoli-agentic";   // router dedicato portato in sede
const char* WIFI_PASS = "cambiami";
const char* MQTT_HOST = "192.168.50.10";    // portatile con Mosquitto
const uint16_t MQTT_PORT = 1883;
const char* INCROCIO = "mergellina";        // mergellina | chiaia_sanpasquale | chiaia_portico | vittoria_acton
const bool CAPOFILA = false;                // un solo nodo a true: dà il tempo agli altri in modalità riflesso
const uint32_t OFFSET_ONDA_MS = 0;          // ritardo dell'onda verde rispetto al capofila (es. 0, 6000, 12000, 18000)

// Pin: testa A (rosso, giallo, verde), testa B (rosso, giallo, verde), pulsante
const int PIN_A[3] = {16, 17, 18};
const int PIN_B[3] = {19, 21, 22};
const int PIN_PULSANTE = 0;                 // pulsante BOOT della scheda, o un pulsante esterno a GND

const uint32_t RIFLESSO_DOPO_MS = 5000;
// Ciclo locale (ms): A verde, A giallo, tutto rosso, B verde, B giallo, tutto rosso
const uint32_t FASI_MS[6] = {20000, 3000, 1000, 15000, 3000, 1000};

// ------------------------------------------------
enum Colore { ROSSO = 0, GIALLO = 1, VERDE = 2 };
WiFiClient wifi;
PubSubClient mqtt(wifi);
uint32_t ultimoComando = 0;
bool inRiflesso = false;
int32_t correzioneCiclo = 0;  // allineamento al capofila via ESP-NOW
uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

struct __attribute__((packed)) Battito {
  char tipo[4];        // "C5S"
  uint32_t ciclo_ms;   // posizione del capofila nel suo ciclo
};

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

String topicStato() { return String("napoli/semafori/") + INCROCIO + "/stato"; }

void ricevuto(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  mostra(daTesto(doc["a"]), daTesto(doc["b"]));
  ultimoComando = millis();
  if (inRiflesso) {
    inRiflesso = false;
    Serial.println("Torno a seguire gli agenti");
  }
}

void suEspNow(const esp_now_recv_info_t* info, const uint8_t* dati, int len) {
  if (CAPOFILA || len != sizeof(Battito)) return;
  Battito b;
  memcpy(&b, dati, sizeof(b));
  if (strncmp(b.tipo, "C5S", 3) != 0) return;
  uint32_t totale = 0;
  for (int i = 0; i < 6; i++) totale += FASI_MS[i];
  correzioneCiclo = (int32_t)((b.ciclo_ms + totale - OFFSET_ONDA_MS) % totale) - (int32_t)(millis() % totale);
}

void cicloLocale() {
  uint32_t totale = 0;
  for (int i = 0; i < 6; i++) totale += FASI_MS[i];
  uint32_t pos = (uint32_t)((int64_t)millis() + correzioneCiclo + totale) % totale;
  uint32_t acc = 0;
  int fase = 0;
  for (; fase < 6; fase++) {
    acc += FASI_MS[fase];
    if (pos < acc) break;
  }
  const Colore a[6] = {VERDE, GIALLO, ROSSO, ROSSO, ROSSO, ROSSO};
  const Colore b[6] = {ROSSO, ROSSO, ROSSO, VERDE, GIALLO, ROSSO};
  mostra(a[fase], b[fase]);

  static uint32_t ultimoBattito = 0;
  if (CAPOFILA && millis() - ultimoBattito > 1000) {
    ultimoBattito = millis();
    Battito bt = {{'C', '5', 'S', 0}, pos};
    esp_now_send(BROADCAST, (uint8_t*)&bt, sizeof(bt));
  }
}

void connettiMqtt() {
  static uint32_t ultimoTentativo = 0;
  if (mqtt.connected() || millis() - ultimoTentativo < 3000) return;
  ultimoTentativo = millis();
  String id = String("semaforo-") + INCROCIO;
  if (mqtt.connect(id.c_str())) {
    mqtt.subscribe(topicStato().c_str());
    Serial.println("MQTT connesso");
  }
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 3; i++) {
    pinMode(PIN_A[i], OUTPUT);
    pinMode(PIN_B[i], OUTPUT);
  }
  pinMode(PIN_PULSANTE, INPUT_PULLUP);
  mostra(ROSSO, ROSSO);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // ESP-NOW usa lo stesso canale del Wi-Fi: tutti i nodi devono essere sullo stesso router.
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(suEspNow);
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, BROADCAST, 6);
    peer.channel = 0;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
  }
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(ricevuto);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    connettiMqtt();
    mqtt.loop();
  }
  if (millis() - ultimoComando > RIFLESSO_DOPO_MS) {
    if (!inRiflesso) {
      inRiflesso = true;
      Serial.println("Nessun piano dagli agenti: modalità riflesso (ciclo locale + ESP-NOW)");
      if (mqtt.connected()) {
        String t = String("napoli/semafori/") + INCROCIO + "/riflesso";
        mqtt.publish(t.c_str(), "{\"modalita\":\"riflesso\"}");
      }
    }
    cicloLocale();
  }

  static bool premuto = false;
  if (digitalRead(PIN_PULSANTE) == LOW && !premuto) {
    premuto = true;
    if (mqtt.connected()) {
      mqtt.publish("napoli/eventi/manuale",
                   "{\"evento\":\"pullman_turistico\",\"veicoli\":25,\"da\":\"est_in\",\"a\":\"ovest_out\"}");
    }
  } else if (digitalRead(PIN_PULSANTE) == HIGH) {
    premuto = false;
  }
  delay(20);
}
