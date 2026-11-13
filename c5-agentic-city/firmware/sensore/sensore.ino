// Sensore di passaggio del plastico — ESP32 (Arduino core 3.x)
//
// Conta i passaggi davanti a un sensore IR (modulo ostacolo tipo FC-51, o barriera IR) e
// pubblica ogni 2 secondi quanti passaggi ci sono stati nell'ultimo minuto:
//   napoli/sensori/<NODO>/persone  {"zona":"rotonda_diaz","valore":7,"moltiplicatore":200}
// L'agente Folla somma valore × moltiplicatore alla stima della zona: sul plastico
// ogni mano o statuina che passa vale 200 persone vere.
//
// Con il modulo 5G/4G del team si può usare TinyGSM al posto del Wi-Fi (stesso MQTT):
// è il racconto giusto per Fastweb + Vodafone ("sensori della città sulla rete mobile").
//
// Librerie: PubSubClient. NON ANCORA COMPILATO NÉ PROVATO SU HARDWARE.

#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "napoli-agentic";
const char* WIFI_PASS = "cambiami";
const char* MQTT_HOST = "192.168.50.10";
const char* NODO = "varco_rotonda";
const char* ZONA = "rotonda_diaz";  // mergellina | rotonda_diaz | piazza_vittoria | castel_ovo | municipio | beverello | vomero
const int MOLTIPLICATORE = 200;
const int PIN_SENSORE = 34;         // uscita digitale del sensore IR (LOW = ostacolo)
const int PIN_LED = 2;

WiFiClient wifi;
PubSubClient mqtt(wifi);
const int FINESTRA = 30;            // 30 caselle da 2 s = 1 minuto
uint16_t caselle[FINESTRA] = {0};
int casella = 0;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SENSORE, INPUT);
  pinMode(PIN_LED, OUTPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  mqtt.setServer(MQTT_HOST, 1883);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    mqtt.connect((String("sensore-") + NODO).c_str());
  }
  mqtt.loop();

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
    char msg[128];
    snprintf(msg, sizeof(msg), "{\"zona\":\"%s\",\"valore\":%d,\"moltiplicatore\":%d}", ZONA, totale, MOLTIPLICATORE);
    String topic = String("napoli/sensori/") + NODO + "/persone";
    if (mqtt.connected()) mqtt.publish(topic.c_str(), msg);
    casella = (casella + 1) % FINESTRA;
    caselle[casella] = 0;
  }
  delay(5);
}
